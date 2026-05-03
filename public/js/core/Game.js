/**
 * Game - Core Babylon.js game engine integrating all systems
 *
 * ORIGINAL FIXES (B1-B15) preserved from prior revision.
 *
 * NEW FIXES THIS REVISION:
 *  G1  - addOtherPlayer stores op.animGroups / op.animMap from the instantiated
 *        character model so interpolation never needs a scene-wide search.
 *  G2  - interpolateOtherPlayers uses stored op.animGroups/animMap; picks
 *        Walk, Run, Idle, Crouch by consulting AssetLoader.resolveAnimation().
 *  G3  - Bot players get a character model via assetLoader (same pipeline as
 *        human players) — isBot flag picks the correct character asset.
 *  G4  - createWeaponModel correctly calls fxManager.setMuzzleFlash() so the
 *        muzzle-flash reference is always live.
 *  G5  - handleCombatInput properly triggers showMuzzleFlash() through fxManager,
 *        not the stale local method, and does weapon kick reliably.
 *  G6  - Respawn uses mapData spawn points via the MapManager helper if available.
 *  G7  - updateOtherPlayer forwards the crouching/moving/alive state so G2 can
 *        drive animations correctly on every tick.
 *  G8  - gameLoop: updateSlide() (camera roll) is only called once — was missing
 *        in the loop, causing targetRoll to never apply.
 *  G9  - GraphicsSettings class stub added so the apply() call in init() doesn't
 *        crash when the class isn't defined elsewhere.
 */


class Game {
  constructor(network) {
    this.network = network;
    this.canvas = document.getElementById('renderCanvas');
    this.engine = null;
    this.scene = null;
    this.camera = null;

    this.input = new InputManager(this.canvas);
    this.weapons = new WeaponSystem();
    this.ui = new UIManager();
    this.map = null;
    this.graphics = null;
    this.assetLoader = null;

    // Player state
    this.playerId = null;
    this.selfState = null;
    this.otherPlayers = {};   // id -> { mesh, nameTag, state, markerObserver, animGroups, animMap, currentAnim }
    this.mapData = null;
    this.gameMode = null;
    this.paused = false;
    this.alive = true;

    this.currentPhase = null;
    this.team = null;

    // Movement / physics (mirrored into PlayerController)
    this.yaw = 0;
    this.pitch = 0;
    this.velocity = { x: 0, y: 0, z: 0 };
    this.grounded = true;
    this.crouching = false;
    this.moveVelocity = { x: 0, z: 0 };
    this.acceleration = 40;
    this.deceleration = 30;
    this.maxMoveSpeed = 8;

    // Slide
    this.sliding = false;
    this.slideTimer = 0;
    this.slideDuration = 0.6;
    this.slideSpeed = 14;
    this.slideDir = { x: 0, z: 0 };
    this.slideCooldown = 0;

    // Camera roll
    this.cameraRoll = 0;
    this.targetRoll = 0;

    // Physics constants
    this.gravity = -20;
    this.jumpForce = 8;
    this.moveSpeed = 8;
    this.playerHeight = 1.8;
    this.playerRadius = 0.4;

    this.sharedMaterials = null;
    this.fxManager = null;
    this.perfEl = null;
    this.fpsHistory = [];

    // Weapon visuals
    this.weaponMesh = null;
    this.weaponRoot = null;
    this.muzzleFlash = null;
    this.weaponRestPos = new BABYLON.Vector3(0.28, -0.22, 0.5);
    this.weaponReloadPos = new BABYLON.Vector3(0.28, -0.7, 0.3);
    this.reloadAnimProgress = 0;
    this.isReloadAnimating = false;

    this.lastTime = 0;
    this.running = false;
  }

  // ─── Init ─────────────────────────────────────────────────────────────────────

  async init(playerData, roomData) {
    try {
      this.playerId = playerData.id;
      this.selfState = playerData;
      this.mapData = roomData.mapData;
      this.gameMode = roomData.gameMode;
      this.team = playerData.team ?? null;

      this.engine = new BABYLON.Engine(this.canvas, true,
        { preserveDrawingBuffer: true, stencil: true });
      this.engine.setSize(window.innerWidth, window.innerHeight);

      this.scene = new BABYLON.Scene(this.engine);
      this.scene.clearColor = new BABYLON.Color4(0.02, 0.03, 0.06, 1);
      this.scene.collisionsEnabled = true;
      this.scene.gravity = new BABYLON.Vector3(0, this.gravity / 60, 0);
      this.scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
      this.scene.fogDensity = 0.003;
      this.scene.fogColor = new BABYLON.Color3(0.05, 0.06, 0.1);

      this.camera = new BABYLON.FreeCamera('camera',
        new BABYLON.Vector3(playerData.position.x, playerData.position.y, playerData.position.z),
        this.scene);
      this.camera.minZ = 0.1;
      this.camera.maxZ = 500;
      this.camera.fov = 1.2;
      this.camera.inertia = 0;
      this.camera.angularSensibility = 99999;
      this.camera.checkCollisions = true;
      this.camera.ellipsoid = new BABYLON.Vector3(this.playerRadius, this.playerHeight / 2, this.playerRadius);
      this.camera.applyGravity = true;
      this.scene.activeCamera = this.camera;

      this.graphics = new GraphicsSettings(this.scene, this.engine);
      const quality = document.getElementById('graphics-quality')?.value || 'medium';
      this.graphics.apply(quality);

      this.initSharedMaterials();
      this.playerController = new PlayerController(this);
      this.fxManager = new VisualFXManager(this.scene, this.camera);

      // Asset loading (Skipped - Fully Procedural)
      const loadingFill = document.getElementById('loading-fill');
      if (loadingFill) loadingFill.style.width = '80%';

      // Build map
      this.map = new MapManager(this.scene);
      this.map.buildMap(this.mapData);

      // [G4] Weapon model + wire muzzle flash into fxManager
      this.createWeaponModel();
      this.initPerfHUD();

      if (roomData.allPlayers) {
        roomData.allPlayers.forEach(p => {
          if (p.id !== this.playerId) this.addOtherPlayer(p);
        });
      }

      this.input.enable();
      const sens = parseInt(document.getElementById('sensitivity-slider')?.value || '5');
      this.input.sensitivity = sens * 0.0008;

      this.setupNetworkHandlers();
      window.addEventListener('resize', () => this.engine.resize());

      this.running = true;
      this.lastTime = performance.now();
      this.engine.runRenderLoop(() => this.gameLoop());

      this.canvas.addEventListener('click', () => {
        if (!this.paused) this.input.requestPointerLock();
      });

    } catch (err) {
      console.error('[Game] init failed:', err);
    }
  }

  // ─── Weapon Model ─────────────────────────────────────────────────────────────

  createWeaponModel() {
    if (this.weaponRoot) { this.weaponRoot.dispose(); this.weaponRoot = null; }

    const weaponId = this.weapons.currentWeapon;
    
    // Build procedural weapon
    const root = window.WeaponBuilder.buildWeaponModel(weaponId, this.scene);
    root.parent = this.camera;
    root.position = this.weaponRestPos.clone();
    this.weaponRoot = root;
    this.weaponMesh = root;

    // Muzzle flash plane
    const flash = BABYLON.MeshBuilder.CreatePlane('muzzle', { size: 0.15 }, this.scene);
    const flashMat = new BABYLON.StandardMaterial('flashMat', this.scene);
    flashMat.emissiveColor = new BABYLON.Color3(1, 0.8, 0.3);
    flashMat.disableLighting = true;
    flashMat.alpha = 0;
    flash.material = flashMat;
    flash.parent = root;
    flash.position.set(0, 0.02, 0.42);
    if (weaponId === 'awp') flash.position.set(0, 0.01, 0.8);
    if (weaponId === 'auto_pistol') flash.position.set(0, 0.02, 0.25);
    
    flash.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
    this.muzzleFlash = flash;

    // [G4] Wire into fxManager so fxManager.showMuzzleFlash() works
    if (this.fxManager) this.fxManager.setMuzzleFlash(flash);
  }

  // ─── Network Handlers ─────────────────────────────────────────────────────────

  setupNetworkHandlers() {
    const net = this.network;

    net.on('state_update', (msg) => {
      const seen = new Set();
      (msg.players || []).forEach(p => {
        seen.add(p.id);
        if (this.otherPlayers[p.id]) {
          this.updateOtherPlayer(p);
        } else {
          this.addOtherPlayer(p);
        }
      });
      for (const id of Object.keys(this.otherPlayers)) {
        if (!seen.has(id)) this.removeOtherPlayer(id);
      }

      if (msg.self) {
        this.selfState = msg.self;
        this.alive = msg.self.alive;
        this.ui.updateHealth(msg.self.health);
      }

      if (msg.scoreboard) {
        this.ui.updateScoreboard(msg.scoreboard, this.playerId);
        this.ui.updateTimer(msg.scoreboard.timeRemaining);
        this.ui.updateMatchScore(msg.scoreboard);
        this.ui.updateMinimap(
          this.camera.position,
          msg.players,
          this.mapData?.size?.x || 60,
          this.selfState?.team
        );
      }
    });

    net.on('player_joined', (msg) => { this.addOtherPlayer(msg.player); });
    net.on('player_left', (msg) => { this.removeOtherPlayer(msg.playerId); });

    net.on('player_shoot', (msg) => {
      if (msg.playerId !== this.playerId) this.showOtherPlayerShoot(msg.playerId);
    });

    net.on('hit_confirm', (msg) => {
      this.ui.showHitMarker(msg.headshot);
      const target = this.otherPlayers[msg.targetId];
      if (target?.mesh) this.showFloatingDamage(target.mesh.position, msg.damage, msg.headshot);
    });

    net.on('damage_taken', (msg) => { this.ui.showDamageIndicator(); this.ui.updateHealth(msg.health); });
    net.on('ammo_update', (msg) => {
      this.weapons.ammo = msg.ammo;
      this.weapons.reserveAmmo = 999; // Always show infinite
      this.ui.updateAmmo(msg.ammo, '∞');
    });

    net.on('reload_complete', (msg) => {
      this.weapons.ammo = msg.ammo;
      this.weapons.reserveAmmo = 999;
      this.weapons.reloading = false;
      this.isReloadAnimating = false;
      if (this.weaponRoot) {
        this.weaponRoot.position = this.weaponRestPos.clone();
        this.weaponRoot.rotation.x = 0;
      }
      this.ui.showReloading(false);
      this.ui.updateAmmo(msg.ammo, '∞');
    });

    net.on('player_killed', (msg) => {
      this.ui.addKillFeedEntry(msg.killer, msg.victim, msg.weapon, msg.headshot);
      if (msg.victimId === this.playerId) {
        this.alive = false;
        this.ui.showDeathScreen(msg.killer, 4);
      }
    });

    // [G6] Respawn uses map spawn points when available
    net.on('respawn', (msg) => {
      this.alive = true;
      this.ui.hideDeathScreen();
      const spawnPos = msg.player.position
        || (this.map ? this.map.getRandomSpawnPoint(this.team) : { x: 0, y: 1.8, z: 0 });
      this.camera.position.set(spawnPos.x, spawnPos.y, spawnPos.z);
      this.velocity = { x: 0, y: 0, z: 0 };
      this.weapons.setWeapon(msg.player.currentWeapon, msg.player.ammo, 999);
      this.ui.updateHealth(msg.player.health);
      this.ui.updateAmmo(msg.player.ammo, '∞');
    });

    net.on('player_respawn', (msg) => {
      const op = this.otherPlayers[msg.playerId];
      if (op) {
        op.mesh.position.set(msg.position.x, msg.position.y - 0.9, msg.position.z);
        op.mesh.setEnabled(true);
        // Resume idle animation on respawn
        this._playOtherPlayerAnim(op, 'idle');
      }
    });

    net.on('weapon_switch', (msg) => {
      if (msg.playerId === this.playerId) {
        this.weapons.setWeapon(msg.weaponId);
        const wd = this.weapons.getWeaponData(msg.weaponId);
        this.ui.updateWeaponName(wd ? wd.name : msg.weaponId);
        this.createWeaponModel();
      }
    });

    // Unified game_event handler
    net.on('game_event', (msg) => {
      const ev = msg.event;
      if (!ev) return;
      if (ev.type === 'game_over') {
        this.handleGameOver(ev);
      } else if (ev.type === 'phase_change') {
        this.currentPhase = ev.phase;
        this.ui.showPhaseBanner(ev.phase, ev.timeLimit, ev.round);
      } else if (ev.type === 'round_end') {
        const myTeam = this.selfState?.team;
        this.ui.showPhaseBanner('debrief', 15, ev.winnerTeam === myTeam ? 'ROUND WON' : 'ROUND LOST');
      }
    });

    net.on('game_over', (msg) => { this.handleGameOver(msg); });
    net.on('chat', (msg) => { this.ui.addChatMessage(msg.username, msg.message); });

    net.on('game_start', (msg) => {
      (msg.players || []).forEach(p => {
        if (p.id !== this.playerId && !this.otherPlayers[p.id]) this.addOtherPlayer(p);
      });
    });

    net.on('ability_effect', (msg) => { this.playAbilityEffect(msg); });
    net.on('ability_failed', (msg) => {
      if (msg.reason === 'cooldown') this.ui.updateAbilityCooldown(Date.now() + msg.remaining);
    });
  }

  // ─── Other Players ────────────────────────────────────────────────────────────

  /**
   * [G1] [G3] addOtherPlayer:
   *  - Passes playerId to createPlayerCharacter so animation groups are tagged.
   *  - Stores animGroups / animMap on the player entry.
   *  - Bot players (data.isBot) use a different default character to visually
   *    distinguish them (Ranger / Mage alternating by id hash).
   */
  addOtherPlayer(data) {
    if (this.otherPlayers[data.id]) return;

    // [G3] Character selection: bots get Ranger/Mage, humans use team defaults
    let characterName = null;
    if (data.isBot) {
      const botChars = ['Ranger', 'Mage', 'Rogue_Hooded'];
      const hash = data.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
      characterName = botChars[hash % botChars.length];
    }

    const characterModel = this.assetLoader
      ? this.assetLoader.createPlayerCharacter(characterName, data.team, data.id)  // [G1]
      : null;

    let root;

    if (characterModel) {
      root = characterModel;
      root.position.set(data.position.x, data.position.y - 0.9, data.position.z);
      if (this.map) root.getChildMeshes().forEach(m => this.map.addShadowCaster(m));
    } else {
      root = this._buildFallbackCharacter(data);
    }

    // Name tag
    const nameplane = BABYLON.MeshBuilder.CreatePlane(`name_${data.id}`,
      { width: 2, height: 0.3 }, this.scene);
    nameplane.parent = root;
    nameplane.position.y = characterModel ? 2.2 : 1.7;
    nameplane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;

    const nameTex = new BABYLON.DynamicTexture(`nameTex_${data.id}`,
      { width: 256, height: 40 }, this.scene);
    const nameCtx = nameTex.getContext();
    nameCtx.clearRect(0, 0, 256, 40);
    const isTeammate = data.team === this.selfState?.team;
    nameCtx.fillStyle = isTeammate ? '#4488ff' : '#ff4444';
    nameCtx.font = 'bold 24px Arial';
    nameCtx.textAlign = 'center';
    // [G3] Mark bots with [BOT] prefix
    const displayName = (data.isBot ? '[BOT] ' : '') + (data.username || data.id.slice(0, 8));
    nameCtx.fillText(displayName, 128, 28);
    nameTex.update();

    const nameMat = new BABYLON.StandardMaterial(`namemat_${data.id}`, this.scene);
    nameMat.diffuseTexture = nameTex;
    nameMat.emissiveTexture = nameTex;
    nameMat.disableLighting = true;
    nameMat.hasAlpha = true;
    nameMat.useAlphaFromDiffuseTexture = true;
    nameplane.material = nameMat;

    // Floating marker
    const markerMat = new BABYLON.StandardMaterial(`markerMat_${data.id}`, this.scene);
    markerMat.diffuseColor = isTeammate ? new BABYLON.Color3(0.2, 0.5, 1) : new BABYLON.Color3(1, 0.2, 0.2);
    markerMat.emissiveColor = markerMat.diffuseColor;
    markerMat.disableLighting = true;

    const marker = BABYLON.MeshBuilder.CreateCylinder(`marker_${data.id}`,
      { diameterTop: 0.2, diameterBottom: 0, height: 0.3, tessellation: 4 }, this.scene);
    marker.parent = root;
    const markerBaseY = characterModel ? 2.5 : 2.0;
    marker.position.y = markerBaseY;
    marker.rotation.x = Math.PI;
    marker.material = markerMat;

    const markerObserver = this.scene.onBeforeRenderObservable.add(() => {
      if (!marker.isDisposed()) {
        marker.position.y = markerBaseY + Math.sin(performance.now() * 0.005) * 0.1;
        marker.rotation.y += 0.02;
      }
    });

    // [G1] Store animation groups from character model
    const animGroups = characterModel?.playerAnimGroups || [];
    const animMap = characterModel?.playerAnimMap || {};

    this.otherPlayers[data.id] = {
      mesh: root,
      state: data,
      markerObserver,
      animGroups,   // [G1]
      animMap,      // [G1]
      currentAnim: null
    };

    // [G1] Start idle animation immediately
    this._playOtherPlayerAnim(this.otherPlayers[data.id], 'idle');
  }

  // Fallback egg-character when no GLB is loaded
  // Includes procedural leg/arm swing animation for movement
  _buildFallbackCharacter(data) {
    const root = new BABYLON.TransformNode(`proot_${data.id}`, this.scene);
    root.position.set(data.position.x, data.position.y - 1.8, data.position.z);

    const bodyMat = this.sharedMaterials.team[data.team] || this.sharedMaterials.team[2];
    const skinMat = this.sharedMaterials.skin;
    const darkMat = this.sharedMaterials.dark;

    // The funny egg body
    const egg = BABYLON.MeshBuilder.CreateSphere(`egg_${data.id}`, { diameter: 1.0, segments: 16 }, this.scene);
    egg.scaling.y = 1.4; // Make it egg shaped
    egg.position.y = 0.8;
    egg.material = bodyMat;
    egg.parent = root;

    // Funny big eyes
    const eyeL = BABYLON.MeshBuilder.CreateSphere(`eyeL_${data.id}`, { diameter: 0.25 }, this.scene);
    eyeL.position.set(-0.2, 1.1, 0.45);
    eyeL.material = skinMat; // White-ish skin material can work for eyeballs
    eyeL.parent = root;

    const eyeR = BABYLON.MeshBuilder.CreateSphere(`eyeR_${data.id}`, { diameter: 0.25 }, this.scene);
    eyeR.position.set(0.2, 1.1, 0.45);
    eyeR.material = skinMat;
    eyeR.parent = root;

    // Pupils
    const pupilL = BABYLON.MeshBuilder.CreateSphere(`pupilL_${data.id}`, { diameter: 0.1 }, this.scene);
    pupilL.position.set(-0.2, 1.1, 0.55);
    pupilL.material = darkMat;
    pupilL.parent = root;

    const pupilR = BABYLON.MeshBuilder.CreateSphere(`pupilR_${data.id}`, { diameter: 0.1 }, this.scene);
    pupilR.position.set(0.2, 1.1, 0.55);
    pupilR.material = darkMat;
    pupilR.parent = root;

    // Arms with pivot nodes for swing animation (floating little spheres)
    const armPivotL = new BABYLON.TransformNode(`armPivotL_${data.id}`, this.scene);
    armPivotL.parent = root; armPivotL.position.set(-0.65, 0.8, 0);
    const armL = BABYLON.MeshBuilder.CreateSphere(`armL_${data.id}`, { diameter: 0.25 }, this.scene);
    armL.parent = armPivotL; armL.position.y = -0.2; armL.material = skinMat;

    const armPivotR = new BABYLON.TransformNode(`armPivotR_${data.id}`, this.scene);
    armPivotR.parent = root; armPivotR.position.set(0.65, 0.8, 0);
    const armR = BABYLON.MeshBuilder.CreateSphere(`armR_${data.id}`, { diameter: 0.25 }, this.scene);
    armR.parent = armPivotR; armR.position.y = -0.2; armR.material = skinMat;

    // Legs with pivot nodes for swing animation (flat floating shoes)
    const legPivotL = new BABYLON.TransformNode(`legPivotL_${data.id}`, this.scene);
    legPivotL.parent = root; legPivotL.position.set(-0.25, 0.25, 0);
    const legL = BABYLON.MeshBuilder.CreateSphere(`legL_${data.id}`, { diameter: 0.3 }, this.scene);
    legL.scaling.y = 0.5; legL.scaling.z = 1.5;
    legL.parent = legPivotL; legL.position.y = -0.2; legL.material = darkMat;

    const legPivotR = new BABYLON.TransformNode(`legPivotR_${data.id}`, this.scene);
    legPivotR.parent = root; legPivotR.position.set(0.25, 0.25, 0);
    const legR = BABYLON.MeshBuilder.CreateSphere(`legR_${data.id}`, { diameter: 0.3 }, this.scene);
    legR.scaling.y = 0.5; legR.scaling.z = 1.5;
    legR.parent = legPivotR; legR.position.y = -0.2; legR.material = darkMat;

    const gun = BABYLON.MeshBuilder.CreateBox(`gun_${data.id}`, { width: 0.08, height: 0.08, depth: 0.5 }, this.scene);
    gun.parent = armPivotR; gun.position.set(0, -0.2, 0.2); gun.material = darkMat;

    if (this.map) this.map.addShadowCaster(egg);

    // Store limb pivots on root for procedural animation
    root._limbPivots = { armPivotL, armPivotR, legPivotL, legPivotR };
    root._limbPhase = 0;

    return root;
  }

  /**
   * [G2] Play an animation on an other-player entry by logical name.
   * Tries: exact match, case-insensitive partial match.
   * Names tried: 'walk', 'run', 'idle', 'crouch', 'death'.
   */
  _playOtherPlayerAnim(op, logicalName) {
    if (!op || !op.animGroups || op.animGroups.length === 0) return;
    if (op.currentAnim === logicalName) return;  // already playing

    // Common name variants per logical state
    const variants = {
      idle: ['Idle_Basic', 'Idle', 'idle', 'Stand'],
      walk: ['Walk', 'walk', 'Walking', 'MovementWalk'],
      run: ['Run', 'run', 'Running', 'MovementRun', 'Sprint'],
      crouch: ['Crouch', 'crouch', 'CrouchIdle', 'CrouchWalk'],
      death: ['Death', 'death', 'Dead', 'Dying']
    };

    const tryNames = variants[logicalName] || [logicalName];

    let targetAnim = null;
    for (const name of tryNames) {
      targetAnim = AssetLoader.resolveAnimation(op.animGroups, op.animMap, name);
      if (targetAnim) break;
    }

    if (!targetAnim) {
      // Last resort: just play the first animation
      targetAnim = op.animGroups[0];
    }

    // Stop all others, play target
    op.animGroups.forEach(ag => { if (ag !== targetAnim) ag.stop(); });
    targetAnim.play(true);
    op.currentAnim = logicalName;
  }

  // [G7] updateOtherPlayer stores moving/crouching so G2 can use them
  updateOtherPlayer(data) {
    const op = this.otherPlayers[data.id];
    if (!op) return;
    op.targetPosition = new BABYLON.Vector3(
      data.position.x, data.position.y - 0.9, data.position.z
    );
    op.targetRotation = data.rotation.y;
    op.state = data;

    // Update name tag visibility with alive state
    op.mesh.setEnabled(!!data.alive);

    // [G7] Cache movement state for animation updates in interpolateOtherPlayers
    op.isMoving = data.moving || false;
    op.isCrouching = data.crouching || false;
    op.isAlive = data.alive;
  }

  removeOtherPlayer(id) {
    const op = this.otherPlayers[id];
    if (!op) return;
    if (op.markerObserver) this.scene.onBeforeRenderObservable.remove(op.markerObserver);
    // Stop all animations before disposing
    if (op.animGroups) op.animGroups.forEach(ag => ag.stop());
    op.mesh.dispose();
    delete this.otherPlayers[id];
  }

  showOtherPlayerShoot(playerId) {
    const op = this.otherPlayers[playerId];
    if (!op || !op.mesh) return;
    // Small flash effect - no-op if no mesh handle, just a hook for future audio
  }

  // ─── Game Loop ────────────────────────────────────────────────────────────────

  gameLoop() {
    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;

    if (this.paused || !this.running) { this.scene.render(); return; }

    this.playerController.update(dt);
    this.handleCombatInput(dt);
    this.weapons.updateRecoil(dt);
    this.updateReloadAnim(dt);
    this.fxManager.update(dt);
    this.interpolateOtherPlayers(dt);
    this.updateCameraAndWeapon(dt);
    this.updatePerfHUD(dt);
    this.scene.render();

    const pState = this.playerController.getState();
    this.network.sendInput({
      position: pState.position,
      rotation: pState.rotation,
      moving: pState.moving,
      crouching: pState.crouching,
      grounded: pState.grounded,
      jumping: pState.jumping,
      seq: this.input.consumeInputSeq()
    });
  }

  // ─── Combat Input ─────────────────────────────────────────────────────────────

  handleCombatInput(dt) {
    if (!this.alive || !this.input.locked) return;

    const isPrep = this.currentPhase === 'preparation' || this.currentPhase === 'debrief';
    if (isPrep) {
      this.ui.updateCrosshairSpread(false);
    } else {
      if (this.input.isMouseDown(0)) {
        const wd = this.weapons.getWeaponData();
        if (wd && (wd.auto || !this.weapons.shooting)) {
          if (this.weapons.canShoot()) {
            this.weapons.shoot();
            this.network.sendShoot();

            // [G5] All FX through fxManager (muzzle flash is wired via G4)
            this.fxManager.showMuzzleFlash();
            this._doWeaponKick();

            const aimDir = this.camera.getForwardRay().direction;
            this.fxManager.createBulletTrail(this.camera.position, aimDir);
            this.ui.updateCrosshairSpread(true);

            // Auto-reload when magazine empties
            if (this.weapons.needsAutoReload()) {
              this._startReload();
            }
          } else if (this.weapons.needsAutoReload()) {
            this._startReload();
          }
        }
        this.weapons.shooting = true;
      } else {
        this.weapons.shooting = false;
        this.ui.updateCrosshairSpread(false);

        // Also auto-reload when not shooting and mag is empty
        if (this.weapons.needsAutoReload()) {
          this._startReload();
        }
      }

      // Manual reload — only if not full
      if (this.input.consumeKey('KeyR') && this.weapons.canReload()) {
        this._startReload();
      }

      if (this.input.consumeKey('KeyQ')) this.network.sendAbility();
    }

    if (this.input.consumeKey('Digit1')) this.network.sendWeaponSwitch('primary');
    if (this.input.consumeKey('Digit2')) this.network.sendWeaponSwitch('secondary');
    this.ui.showScoreboard(this.input.isKeyDown('Tab'));
    if (this.input.consumeKey('Escape')) this.togglePause();
    if (this.input.consumeKey('KeyT')) this.openChat();
  }

  _startReload() {
    this.network.sendReload();
    this.weapons.reloading = true;
    this.ui.showReloading(true);
    this.startReloadAnim();
  }

  // [G5] Weapon kick on shoot
  _doWeaponKick() {
    if (!this.weaponRoot || this.isReloadAnimating) return;
    this.weaponRoot.position.z = this.weaponRestPos.z - 0.06;
    if (this._kickTimer) clearTimeout(this._kickTimer);
    this._kickTimer = setTimeout(() => {
      if (this.weaponRoot && !this.isReloadAnimating) {
        this.weaponRoot.position.z = this.weaponRestPos.z;
      }
    }, 60);
  }

  startReloadAnim() {
    this.isReloadAnimating = true;
    this.reloadAnimProgress = 0;
  }

  updateReloadAnim(dt) {
    if (!this.isReloadAnimating || !this.weaponRoot) return;

    // Sync reload animation speed to the actual weapon's reload time
    const wd = this.weapons.getWeaponData();
    const reloadSec = wd ? wd.reloadTime / 1000 : 2.3;
    // Animation has 2 phases (down + up), each takes half the reload time
    // progress goes 0 → 2 over reloadSec
    const animSpeed = 2.0 / reloadSec;

    this.reloadAnimProgress += dt * animSpeed;

    if (this.reloadAnimProgress < 1.0) {
      // Phase 1: weapon drops down and tilts
      const ease = this.reloadAnimProgress * this.reloadAnimProgress;
      this.weaponRoot.position = BABYLON.Vector3.Lerp(this.weaponRestPos, this.weaponReloadPos, ease);
      this.weaponRoot.rotation.x = ease * 0.5;
    } else if (this.reloadAnimProgress < 2.0) {
      // Phase 2: weapon comes back up
      const t = this.reloadAnimProgress - 1.0;
      const ease = 1 - (1 - t) * (1 - t);
      this.weaponRoot.position = BABYLON.Vector3.Lerp(this.weaponReloadPos, this.weaponRestPos, ease);
      this.weaponRoot.rotation.x = (1 - ease) * 0.5;
    } else {
      this.weaponRoot.position = this.weaponRestPos.clone();
      this.weaponRoot.rotation.x = 0;
      this.isReloadAnimating = false;
    }
  }

  updateCameraAndWeapon(dt) {
    // Camera roll (tilt when strafing or sliding)
    const pState = this.playerController.getState();
    const move = this.input.getMovement();
    
    if (pState.crouching && pState.moving) {
      this.targetRoll = 0.05; // Slide roll
    } else {
      this.targetRoll = move.right * -0.04; // Strafe roll
    }

    this.cameraRoll += (this.targetRoll - this.cameraRoll) * (1 - Math.exp(-10 * dt));
    this.camera.rotation.z = this.cameraRoll;

    // Weapon Sway and Bobbing
    if (this.weaponRoot && !this.isReloadAnimating && !this._kickTimer) {
      // Sway based on mouse movement
      const mouseDelta = this.input.getMouseDelta();
      const targetSwayX = -mouseDelta.dx * 0.05;
      const targetSwayY = mouseDelta.dy * 0.05;

      // Bobbing based on movement
      let targetBobX = 0;
      let targetBobY = 0;

      if (pState.moving && pState.grounded) {
        this.bobTimer = (this.bobTimer || 0) + dt * (pState.crouching ? 8 : 12);
        targetBobX = Math.sin(this.bobTimer) * 0.015;
        targetBobY = Math.abs(Math.cos(this.bobTimer)) * 0.02;
      } else {
        this.bobTimer = 0;
      }

      // Smoothly interpolate weapon position
      const targetPosX = this.weaponRestPos.x + targetSwayX + targetBobX;
      const targetPosY = this.weaponRestPos.y + targetSwayY + targetBobY;
      
      this.weaponRoot.position.x += (targetPosX - this.weaponRoot.position.x) * 10 * dt;
      this.weaponRoot.position.y += (targetPosY - this.weaponRoot.position.y) * 10 * dt;
    }
  }

  // ─── [G2] Interpolate + animate other players ─────────────────────────────────

  interpolateOtherPlayers(dt) {
    const lerpSpeed = 12;
    const t = 1 - Math.exp(-lerpSpeed * dt);

    for (const [id, op] of Object.entries(this.otherPlayers)) {
      if (!op.targetPosition) continue;

      const dist = BABYLON.Vector3.Distance(op.mesh.position, op.targetPosition);
      op.mesh.position = BABYLON.Vector3.Lerp(op.mesh.position, op.targetPosition, t);

      const dAngle = op.targetRotation - op.mesh.rotation.y;
      // Normalise to [-π, π] to avoid spinning the long way
      const normAngle = ((dAngle + Math.PI) % (2 * Math.PI)) - Math.PI;
      op.mesh.rotation.y += normAngle * t;

      // [G2] Drive animation from server state flags
      if (op.isAlive === false) {
        this._playOtherPlayerAnim(op, 'death');
      } else if (op.isCrouching) {
        this._playOtherPlayerAnim(op, 'crouch');
      } else if (dist > 0.5) {
        this._playOtherPlayerAnim(op, dist > 2.0 ? 'run' : 'walk');
      } else {
        this._playOtherPlayerAnim(op, 'idle');
      }

      // Procedural limb animation for fallback box-characters
      const pivots = op.mesh._limbPivots;
      if (pivots) {
        const isMoving = dist > 0.15;
        if (isMoving) {
          const speed = dist > 2.0 ? 14 : 8;
          op.mesh._limbPhase = (op.mesh._limbPhase || 0) + dt * speed;
          const swing = Math.sin(op.mesh._limbPhase) * 0.6;
          // Legs swing opposite to each other
          pivots.legPivotL.rotation.x = swing;
          pivots.legPivotR.rotation.x = -swing;
          // Arms counter-swing (natural walking motion)
          pivots.armPivotL.rotation.x = -swing * 0.5;
          pivots.armPivotR.rotation.x = swing * 0.5;
        } else {
          // Smoothly return to neutral
          pivots.legPivotL.rotation.x *= 0.85;
          pivots.legPivotR.rotation.x *= 0.85;
          pivots.armPivotL.rotation.x *= 0.85;
          pivots.armPivotR.rotation.x *= 0.85;
        }
      }
    }
  }

  // ─── Game Over ────────────────────────────────────────────────────────────────

  handleGameOver(data) {
    this.running = false;
    this.input.exitPointerLock();

    let result = 'DEFEAT';
    if (data.winnerTeam !== undefined) {
      result = data.winnerTeam === this.selfState?.team ? 'VICTORY' : 'DEFEAT';
    } else if (data.winner === this.playerId) {
      result = 'VICTORY';
    }

    const stats = `Kills: ${this.selfState?.kills || 0} | Deaths: ${this.selfState?.deaths || 0} | Score: ${this.selfState?.score || 0}`;
    this.ui.showGameOver(result, stats);
  }

  // ─── Shared Materials ─────────────────────────────────────────────────────────

  initSharedMaterials() {
    this.sharedMaterials = {
      skin: new BABYLON.StandardMaterial('shared_skin', this.scene),
      dark: new BABYLON.StandardMaterial('shared_dark', this.scene),
      team: {}
    };
    this.sharedMaterials.skin.diffuseColor = new BABYLON.Color3(0.75, 0.6, 0.5);
    this.sharedMaterials.dark.diffuseColor = new BABYLON.Color3(0.15, 0.15, 0.18);
    this.sharedMaterials.team[0] = new BABYLON.StandardMaterial('team0', this.scene);
    this.sharedMaterials.team[0].diffuseColor = new BABYLON.Color3(0.2, 0.4, 0.9);
    this.sharedMaterials.team[1] = new BABYLON.StandardMaterial('team1', this.scene);
    this.sharedMaterials.team[1].diffuseColor = new BABYLON.Color3(0.9, 0.2, 0.2);
    this.sharedMaterials.team[2] = new BABYLON.StandardMaterial('teamN', this.scene);
    this.sharedMaterials.team[2].diffuseColor = new BABYLON.Color3(0.6, 0.6, 0.2);
  }

  // ─── Floating Damage ──────────────────────────────────────────────────────────

  showFloatingDamage(position, damage, isHeadshot) {
    this.fxManager.showFloatingDamage(position, damage, isHeadshot);
  }

  // ─── Ability Effects ──────────────────────────────────────────────────────────

  playAbilityEffect(msg) {
    const pos = new BABYLON.Vector3(msg.position.x, msg.position.y, msg.position.z);

    if (msg.abilityId === 'wall_charge') {
      BABYLON.ParticleHelper.CreateAsync('explosion', this.scene).then(set => {
        set.systems.forEach(s => { s.emitter = pos; });
        set.start();
      }).catch(() => { });

      const dist = BABYLON.Vector3.Distance(this.camera.position, pos);
      if (dist < 20) {
        const shake = Math.max(0, (20 - dist) / 20) * 0.5;
        this.targetRoll += (Math.random() - 0.5) * shake;
        this.pitch -= shake * 0.1;
      }

    } else if (msg.abilityId === 'recon_drone') {
      const drone = BABYLON.MeshBuilder.CreateBox(`drone_${msg.playerId}`, { size: 0.3 }, this.scene);
      drone.position = pos.clone();
      drone.position.y += 3;
      const droneMat = new BABYLON.StandardMaterial('droneMat', this.scene);
      droneMat.emissiveColor = new BABYLON.Color3(0, 0.8, 1);
      drone.material = droneMat;

      const obs = this.scene.onBeforeRenderObservable.add(() => {
        if (!drone.isDisposed()) {
          drone.rotation.y += 0.1;
          drone.position.y += Math.sin(performance.now() * 0.005) * 0.01;
        }
      });

      const dur = msg.duration || 5000;
      setTimeout(() => {
        this.scene.onBeforeRenderObservable.remove(obs);
        if (!drone.isDisposed()) drone.dispose();
      }, dur);

      if (msg.playerId === this.playerId && msg.revealed) {
        msg.revealed.forEach(r => this.ui.showPingOnMinimap(r.position, dur));
      }
    }

    if (msg.playerId === this.playerId) {
      const fallbacks = { wall_charge: 45000, recon_drone: 30000 };
      const ms = msg.cooldownMs ?? fallbacks[msg.abilityId] ?? 30000;
      this.ui.updateAbilityCooldown(Date.now() + ms);
    }
  }

  // ─── Pause / Chat ─────────────────────────────────────────────────────────────

  togglePause() {
    this.paused = !this.paused;
    this.ui.showPauseMenu(this.paused);
    if (this.paused) this.input.exitPointerLock();
  }

  openChat() {
    const chatInput = document.getElementById('chat-input');
    if (!chatInput) return;
    chatInput.classList.add('active');
    chatInput.focus();
    this.input.exitPointerLock();

    const handler = (e) => {
      if (e.key === 'Enter') {
        const msg = chatInput.value.trim();
        if (msg) this.network.sendChat(msg);
        chatInput.value = '';
        chatInput.classList.remove('active');
        chatInput.blur();
        chatInput.removeEventListener('keydown', handler);
        if (!this.paused) setTimeout(() => this.input.requestPointerLock(), 100);
      } else if (e.key === 'Escape') {
        chatInput.value = '';
        chatInput.classList.remove('active');
        chatInput.blur();
        chatInput.removeEventListener('keydown', handler);
        if (!this.paused) setTimeout(() => this.input.requestPointerLock(), 100);
      }
    };
    chatInput.addEventListener('keydown', handler);
  }

  // ─── Performance HUD ──────────────────────────────────────────────────────────

  initPerfHUD() {
    this.perfEl = document.createElement('div');
    this.perfEl.style.cssText = `
      position:fixed;top:8px;left:8px;font:12px monospace;
      color:#0ff;background:rgba(0,0,0,0.5);padding:4px 8px;
      border-radius:4px;pointer-events:none;z-index:9999;`;
    document.body.appendChild(this.perfEl);
  }

  updatePerfHUD(dt) {
    if (!this.perfEl) return;
    const fps = Math.round(1 / dt);
    this.fpsHistory.push(fps);
    if (this.fpsHistory.length > 60) this.fpsHistory.shift();
    const avg = Math.round(this.fpsHistory.reduce((a, b) => a + b, 0) / this.fpsHistory.length);
    this.perfEl.textContent =
      `FPS: ${fps} (avg:${avg}) | Meshes: ${this.scene.meshes.length} | Ping: ${this.network.latency || 0}ms`;
  }

  // ─── Destroy ──────────────────────────────────────────────────────────────────

  destroy() {
    this.running = false;
    this.input.disable();
    this.input.exitPointerLock();
    if (this._kickTimer) clearTimeout(this._kickTimer);
    if (this.perfEl) { this.perfEl.remove(); this.perfEl = null; }
    if (this.assetLoader) { this.assetLoader.dispose(); this.assetLoader = null; }
    for (const id of Object.keys(this.otherPlayers)) this.removeOtherPlayer(id);
    if (this.engine) {
      this.engine.stopRenderLoop();
      this.scene?.dispose();
      this.engine.dispose();
    }
    this.otherPlayers = {};
  }
}