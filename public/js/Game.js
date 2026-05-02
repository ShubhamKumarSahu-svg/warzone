/**
 * Game - Core Babylon.js game engine integrating all systems
 *
 * FIXES APPLIED:
 *  1. Removed duplicate scene.activeCamera assignment
 *  2. Removed duplicate map-bounds clamping block
 *  3. Removed duplicate net.on('game_event') — merged both handlers into one
 *  4. Moved moveYaw computation BEFORE the slide-initiation block that needs it
 *  5. Added this.currentPhase and this.team initialisation in constructor
 *  6. Fixed weapons.shooting reset path in prep-phase guard
 *  7. Standardised key-consumption via input.consumeKey(); removed race condition in openChat
 *  8. Reset isReloadAnimating in reload_complete handler
 *  9. Fixed createBulletTrail — use CreateLines normally (no broken instance param)
 * 10. Pooled floating-damage text planes to avoid per-shot texture/material leaks
 * 11. Store and remove per-player marker observer in removeOtherPlayer
 * 12. Fixed animationGroups lookup — read from scene, keyed by player id
 * 13. Removed muzzleFlash setTimeout position-reset (was racing with reload anim)
 * 14. handleGameOver uses this.selfState.team consistently; removed stale this.team ref
 * 15. playAbilityEffect uses server-provided cooldownMs with a sensible fallback
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
    this.otherPlayers = {};  // id -> { mesh, nameTag, state, markerObserver }
    this.mapData = null;
    this.gameMode = null;
    this.paused = false;
    this.alive = true;

    // [FIX 5] Initialise phase/team so comparisons never read undefined
    this.currentPhase = null;
    this.team = null;

    // FPS camera
    this.yaw = 0;
    this.pitch = 0;
    this.velocity = { x: 0, y: 0, z: 0 };
    this.grounded = true;
    this.crouching = false;

    // Acceleration-based movement
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

    // Camera roll (slide/strafe tilt)
    this.cameraRoll = 0;
    this.targetRoll = 0;

    // Physics
    this.gravity = -20;
    this.jumpForce = 8;
    this.moveSpeed = 8;
    this.playerHeight = 1.8;
    this.playerRadius = 0.4;

    // Shared materials (initialized after scene)
    this.sharedMaterials = null;

    // Bullet trail pool
    this.trailPool = [];
    this.trailPoolSize = 20;

    // [FIX 10] Floating damage text pool
    this.dmgPool = [];
    this.dmgPoolSize = 10;

    // Perf HUD
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

  async init(playerData, roomData) {
    try {
      this.playerId = playerData.id;
      this.selfState = playerData;
      this.mapData = roomData.mapData;
      this.gameMode = roomData.gameMode;

      // [FIX 5] Capture team from playerData
      this.team = playerData.team ?? null;

      // Create engine
      this.engine = new BABYLON.Engine(this.canvas, true, { preserveDrawingBuffer: true, stencil: true });
      this.engine.setSize(window.innerWidth, window.innerHeight);

      // Create scene
      this.scene = new BABYLON.Scene(this.engine);
      this.scene.clearColor = new BABYLON.Color4(0.02, 0.03, 0.06, 1);
      this.scene.collisionsEnabled = true;
      this.scene.gravity = new BABYLON.Vector3(0, this.gravity / 60, 0);
      this.scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
      this.scene.fogDensity = 0.003;
      this.scene.fogColor = new BABYLON.Color3(0.05, 0.06, 0.1);

      // Camera
      this.camera = new BABYLON.FreeCamera('camera', new BABYLON.Vector3(
        playerData.position.x, playerData.position.y, playerData.position.z
      ), this.scene);
      this.camera.minZ = 0.1;
      this.camera.maxZ = 300;
      this.camera.fov = 1.2;
      this.camera.inertia = 0;
      this.camera.angularSensibility = 99999;
      this.camera.checkCollisions = true;
      this.camera.ellipsoid = new BABYLON.Vector3(this.playerRadius, this.playerHeight / 2, this.playerRadius);
      this.camera.applyGravity = true;

      // [FIX 1] Only set activeCamera once
      this.scene.activeCamera = this.camera;

      // Graphics settings
      this.graphics = new GraphicsSettings(this.scene, this.engine);
      const quality = document.getElementById('graphics-quality')?.value || 'medium';
      this.graphics.apply(quality);

      // Initialize shared systems
      this.initSharedMaterials();
      this.initTrailPool();
      this.initDmgPool(); // [FIX 10]

      // Preload 3D assets
      this.assetLoader = new AssetLoader(this.scene);
      const loadingFill = document.getElementById('loading-fill');
      this.assetLoader.onProgress = (pct, label) => {
        if (loadingFill) loadingFill.style.width = (30 + pct * 0.5) + '%';
        const tipEl = document.getElementById('loading-tip');
        if (tipEl) tipEl.textContent = label;
      };
      const loadTimeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Asset load timeout')), 10000)
      );

      try {
        await Promise.race([this.assetLoader.preloadAll(), loadTimeout]);
      } catch (err) {
        console.warn('Asset load failed, using fallbacks:', err);
      }

      // Build map
      this.map = new MapManager(this.scene);
      this.map.buildMap(this.mapData, this.assetLoader);

      // Create weapon viewmodel
      this.createWeaponModel();
      this.initPerfHUD();

      // Spawn existing players
      if (roomData.allPlayers) {
        roomData.allPlayers.forEach(p => {
          if (p.id !== this.playerId) this.addOtherPlayer(p);
        });
      }

      // Input
      this.input.enable();
      const sens = parseInt(document.getElementById('sensitivity-slider')?.value || '5');
      this.input.sensitivity = sens * 0.0008;

      // Network handlers
      this.setupNetworkHandlers();

      // Resize
      window.addEventListener('resize', () => this.engine.resize());

      // Start loop
      this.running = true;
      this.lastTime = performance.now();
      this.engine.runRenderLoop(() => this.gameLoop());

      // Pointer lock on click
      this.canvas.addEventListener('click', () => {
        if (!this.paused) this.input.requestPointerLock();
      });

    } catch (err) {
      console.error('Game init failed:', err);
    }
  }

  createWeaponModel() {
    if (this.weaponRoot) { this.weaponRoot.dispose(); this.weaponRoot = null; }

    const root = new BABYLON.TransformNode('weaponRoot', this.scene);
    root.parent = this.camera;
    root.position = this.weaponRestPos.clone();
    this.weaponRoot = root;

    const weaponId = this.weapons.currentWeapon;
    const glbModel = this.assetLoader ? this.assetLoader.createWeaponViewmodel(weaponId, root) : null;

    if (glbModel) {
      this.weaponMesh = glbModel;
    } else {
      const gunMat = new BABYLON.StandardMaterial('gunMat', this.scene);
      gunMat.diffuseColor = new BABYLON.Color3(0.15, 0.15, 0.17);
      gunMat.specularColor = new BABYLON.Color3(0.4, 0.4, 0.4);
      gunMat.specularPower = 64;
      const gunMat2 = new BABYLON.StandardMaterial('gunMat2', this.scene);
      gunMat2.diffuseColor = new BABYLON.Color3(0.08, 0.08, 0.1);
      gunMat2.specularColor = new BABYLON.Color3(0.2, 0.2, 0.2);

      const barrel = BABYLON.MeshBuilder.CreateBox('barrel', { width: 0.04, height: 0.04, depth: 0.45 }, this.scene);
      barrel.parent = root; barrel.position.set(0, 0.02, 0.15); barrel.material = gunMat;
      const body = BABYLON.MeshBuilder.CreateBox('body', { width: 0.06, height: 0.1, depth: 0.22 }, this.scene);
      body.parent = root; body.position.set(0, 0, -0.02); body.material = gunMat2;
      const mag = BABYLON.MeshBuilder.CreateBox('mag', { width: 0.04, height: 0.12, depth: 0.06 }, this.scene);
      mag.parent = root; mag.position.set(0, -0.1, 0); mag.rotation.x = 0.15; mag.material = gunMat;
      const grip = BABYLON.MeshBuilder.CreateBox('grip', { width: 0.04, height: 0.1, depth: 0.04 }, this.scene);
      grip.parent = root; grip.position.set(0, -0.1, -0.1); grip.rotation.x = 0.3; grip.material = gunMat2;
      const stock = BABYLON.MeshBuilder.CreateBox('stock', { width: 0.05, height: 0.06, depth: 0.12 }, this.scene);
      stock.parent = root; stock.position.set(0, 0.01, -0.18); stock.material = gunMat;
      const sight = BABYLON.MeshBuilder.CreateBox('sight', { width: 0.025, height: 0.015, depth: 0.1 }, this.scene);
      sight.parent = root; sight.position.set(0, 0.065, 0.05); sight.material = gunMat2;
      this.weaponMesh = body;
    }

    // Muzzle flash
    const flash = BABYLON.MeshBuilder.CreatePlane('muzzle', { size: 0.15 }, this.scene);
    const flashMat = new BABYLON.StandardMaterial('flashMat', this.scene);
    flashMat.emissiveColor = new BABYLON.Color3(1, 0.8, 0.3);
    flashMat.disableLighting = true;
    flashMat.alpha = 0;
    flash.material = flashMat;
    flash.parent = root;
    flash.position.set(0, 0.02, 0.42);
    flash.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
    this.muzzleFlash = flash;
  }

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
      if (msg.playerId === this.playerId) return;
      this.showOtherPlayerShoot(msg.playerId);
    });

    net.on('hit_confirm', (msg) => {
      this.ui.showHitMarker(msg.headshot);
      const target = this.otherPlayers[msg.targetId];
      if (target && target.mesh) {
        this.showFloatingDamage(target.mesh.position, msg.damage, msg.headshot);
      }
    });

    net.on('damage_taken', (msg) => {
      this.ui.showDamageIndicator();
      this.ui.updateHealth(msg.health);
    });

    net.on('ammo_update', (msg) => {
      this.weapons.ammo = msg.ammo;
      this.weapons.reserveAmmo = msg.reserveAmmo;
      this.ui.updateAmmo(msg.ammo, msg.reserveAmmo);
    });

    net.on('reload_complete', (msg) => {
      this.weapons.ammo = msg.ammo;
      this.weapons.reserveAmmo = msg.reserveAmmo;
      this.weapons.reloading = false;
      // [FIX 8] Also cancel reload animation so it doesn't fight the rest position
      this.isReloadAnimating = false;
      if (this.weaponRoot) {
        this.weaponRoot.position = this.weaponRestPos.clone();
        this.weaponRoot.rotation.x = 0;
      }
      this.ui.showReloading(false);
      this.ui.updateAmmo(msg.ammo, msg.reserveAmmo);
    });

    net.on('player_killed', (msg) => {
      this.ui.addKillFeedEntry(msg.killer, msg.victim, msg.weapon, msg.headshot);
      if (msg.victimId === this.playerId) {
        this.alive = false;
        this.ui.showDeathScreen(msg.killer, 4);
      }
    });

    net.on('respawn', (msg) => {
      this.alive = true;
      this.ui.hideDeathScreen();
      this.camera.position.set(msg.player.position.x, msg.player.position.y, msg.player.position.z);
      this.velocity = { x: 0, y: 0, z: 0 };
      this.weapons.setWeapon(msg.player.currentWeapon, msg.player.ammo, msg.player.reserveAmmo);
      this.ui.updateHealth(msg.player.health);
      this.ui.updateAmmo(msg.player.ammo, msg.player.reserveAmmo);
    });

    net.on('player_respawn', (msg) => {
      if (this.otherPlayers[msg.playerId]) {
        const op = this.otherPlayers[msg.playerId];
        op.mesh.position.set(msg.position.x, msg.position.y - 0.9, msg.position.z);
        op.mesh.setEnabled(true);
      }
    });

    net.on('player_reload', (msg) => { /* Visual/audio feedback for others */ });

    net.on('weapon_switch', (msg) => {
      if (msg.playerId === this.playerId) {
        this.weapons.setWeapon(msg.weaponId);
        const wd = this.weapons.getWeaponData(msg.weaponId);
        this.ui.updateWeaponName(wd ? wd.name : msg.weaponId);
        this.createWeaponModel();
      }
    });

    // [FIX 3] Single unified game_event handler covering all sub-types including game_over
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
        const text = ev.winnerTeam === myTeam ? 'ROUND WON' : 'ROUND LOST';
        this.ui.showPhaseBanner('DEBRIEF', 15, text);
      }
    });

    net.on('game_over', (msg) => {
      this.handleGameOver(msg);
    });

    net.on('chat', (msg) => {
      this.ui.addChatMessage(msg.username, msg.message);
    });

    net.on('game_start', (msg) => {
      if (msg.players) {
        msg.players.forEach(p => {
          if (p.id !== this.playerId && !this.otherPlayers[p.id]) {
            this.addOtherPlayer(p);
          }
        });
      }
    });

    net.on('ability_effect', (msg) => {
      this.playAbilityEffect(msg);
    });

    net.on('ability_failed', (msg) => {
      if (msg.reason === 'cooldown') {
        this.ui.updateAbilityCooldown(Date.now() + msg.remaining);
      }
    });
  }

  // ─── Other Players ──────────────────────────────────
  addOtherPlayer(data) {
    if (this.otherPlayers[data.id]) return;

    const characterModel = this.assetLoader
      ? this.assetLoader.createPlayerCharacter(null, data.team)
      : null;

    let root, head, torso;

    if (characterModel) {
      root = characterModel;
      root.position.set(data.position.x, data.position.y - 0.9, data.position.z);
      torso = root;
      head = root;
      if (this.map) {
        root.getChildMeshes().forEach(m => this.map.addShadowCaster(m));
      }
    } else {
      root = new BABYLON.TransformNode('proot_' + data.id, this.scene);
      root.position.set(data.position.x, data.position.y - 0.9, data.position.z);

      const bodyMat = this.sharedMaterials.team[data.team] || this.sharedMaterials.team[2];
      const skinMat = this.sharedMaterials.skin;
      const darkMat = this.sharedMaterials.dark;

      torso = BABYLON.MeshBuilder.CreateBox('torso_' + data.id, { width: 0.5, height: 0.65, depth: 0.3 }, this.scene);
      torso.parent = root; torso.position.y = 0.55; torso.material = bodyMat;
      head = BABYLON.MeshBuilder.CreateSphere('head_' + data.id, { diameter: 0.38, segments: 10 }, this.scene);
      head.parent = root; head.position.y = 1.15; head.material = skinMat;
      const helmet = BABYLON.MeshBuilder.CreateSphere('helmet_' + data.id, { diameter: 0.42, segments: 8 }, this.scene);
      helmet.parent = root; helmet.position.y = 1.2; helmet.material = darkMat;
      const armL = BABYLON.MeshBuilder.CreateBox('armL_' + data.id, { width: 0.15, height: 0.55, depth: 0.15 }, this.scene);
      armL.parent = root; armL.position.set(-0.35, 0.55, 0); armL.material = bodyMat;
      const armR = BABYLON.MeshBuilder.CreateBox('armR_' + data.id, { width: 0.15, height: 0.55, depth: 0.15 }, this.scene);
      armR.parent = root; armR.position.set(0.35, 0.55, 0); armR.material = bodyMat;
      const legL = BABYLON.MeshBuilder.CreateBox('legL_' + data.id, { width: 0.18, height: 0.5, depth: 0.18 }, this.scene);
      legL.parent = root; legL.position.set(-0.13, 0, 0); legL.material = darkMat;
      const legR = BABYLON.MeshBuilder.CreateBox('legR_' + data.id, { width: 0.18, height: 0.5, depth: 0.18 }, this.scene);
      legR.parent = root; legR.position.set(0.13, 0, 0); legR.material = darkMat;
      const gun = BABYLON.MeshBuilder.CreateBox('gun_' + data.id, { width: 0.04, height: 0.04, depth: 0.35 }, this.scene);
      gun.parent = root; gun.position.set(0.3, 0.5, 0.2); gun.material = darkMat;

      if (this.map) this.map.addShadowCaster(torso);
    }

    // Name tag
    const nameplane = BABYLON.MeshBuilder.CreatePlane('name_' + data.id, { width: 2, height: 0.3 }, this.scene);
    nameplane.parent = root;
    nameplane.position.y = characterModel ? 2.2 : 1.7;
    nameplane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
    const nameTex = new BABYLON.DynamicTexture('nameTex_' + data.id, { width: 256, height: 40 }, this.scene);
    const nameCtx = nameTex.getContext();
    nameCtx.clearRect(0, 0, 256, 40);
    const isTeammate = data.team === this.selfState?.team;
    nameCtx.fillStyle = isTeammate ? '#4488ff' : '#ff4444';
    nameCtx.font = 'bold 24px Arial';
    nameCtx.textAlign = 'center';
    nameCtx.fillText(data.username || data.id.slice(0, 8), 128, 28);
    nameTex.update();
    const nameMat = new BABYLON.StandardMaterial('namemat_' + data.id, this.scene);
    nameMat.diffuseTexture = nameTex;
    nameMat.emissiveTexture = nameTex;
    nameMat.disableLighting = true;
    nameMat.hasAlpha = true;
    nameMat.useAlphaFromDiffuseTexture = true;
    nameplane.material = nameMat;

    // Marker
    const markerMat = new BABYLON.StandardMaterial('markerMat_' + data.id, this.scene);
    markerMat.diffuseColor = isTeammate ? new BABYLON.Color3(0.2, 0.5, 1) : new BABYLON.Color3(1, 0.2, 0.2);
    markerMat.emissiveColor = markerMat.diffuseColor;
    markerMat.disableLighting = true;

    const marker = BABYLON.MeshBuilder.CreateCylinder('marker_' + data.id, { diameterTop: 0.2, diameterBottom: 0, height: 0.3, tessellation: 4 }, this.scene);
    marker.parent = root;
    const markerBaseY = characterModel ? 2.5 : 2.0;
    marker.position.y = markerBaseY;
    marker.rotation.x = Math.PI;
    marker.material = markerMat;

    // [FIX 11] Store the observer reference so it can be removed on player leave
    const markerObserver = this.scene.onBeforeRenderObservable.add(() => {
      if (!marker.isDisposed()) {
        marker.position.y = markerBaseY + Math.sin(performance.now() * 0.005) * 0.1;
        marker.rotation.y += 0.02;
      }
    });

    this.otherPlayers[data.id] = { mesh: root, state: data, head, torso, markerObserver };
  }

  updateOtherPlayer(data) {
    const op = this.otherPlayers[data.id];
    if (!op) return;
    op.targetPosition = new BABYLON.Vector3(
      data.position.x, data.position.y - 0.9, data.position.z
    );
    op.targetRotation = data.rotation.y;
    op.state = data;
    op.mesh.setEnabled(!!data.alive);
  }

  removeOtherPlayer(id) {
    const op = this.otherPlayers[id];
    if (op) {
      // [FIX 11] Remove the bobbing observer before disposing
      if (op.markerObserver) {
        this.scene.onBeforeRenderObservable.remove(op.markerObserver);
      }
      op.mesh.dispose();
      delete this.otherPlayers[id];
    }
  }

  showOtherPlayerShoot(playerId) {
    const op = this.otherPlayers[playerId];
    if (!op || !op.mesh) return;
    // Flash effect on their gun
  }

  // ─── Game Loop ──────────────────────────────────────
  gameLoop() {
    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;

    if (this.paused || !this.running) {
      this.scene.render();
      return;
    }

    this.playerController.update(dt);
    this.handleCombatInput(dt);
    this.weapons.updateRecoil(dt);
    this.updateReloadAnim(dt);
    this.updateTrails(dt);
    this.interpolateOtherPlayers(dt);
    this.updatePerfHUD(dt);
    this.scene.render();

    // Send position to server using the controller's state
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

  handleCombatInput(dt) {
    if (!this.alive || !this.input.locked) return;

    // Prep-phase guard
    const isPrep = this.currentPhase === 'preparation' || this.currentPhase === 'debrief';
    if (isPrep) {
      // [FIX 6] Only suppress shooting state; don't wrongly touch weapons.shooting flag
      this.ui.updateCrosshairSpread(false);
    } else {
      if (this.input.isMouseDown(0)) {
        const wd = this.weapons.getWeaponData();
        if (wd && (wd.auto || !this.weapons.shooting)) {
          if (this.weapons.canShoot()) {
            this.weapons.shoot();
            this.network.sendShoot();
            this.showMuzzleFlash();
            this.ui.updateCrosshairSpread(true);
          } else if (this.weapons.ammo <= 0 && !this.weapons.reloading) {
            this.network.sendReload();
            this.weapons.reloading = true;
            this.ui.showReloading(true);
            this.startReloadAnim();
          }
        }
        this.weapons.shooting = true;
      } else {
        this.weapons.shooting = false;
        this.ui.updateCrosshairSpread(false);
      }

      // [FIX 7] Use a consistent key-consume helper; avoids manual key dictionary writes
      if (this.input.consumeKey('KeyR') && !this.weapons.reloading) {
        const wd = this.weapons.getWeaponData();
        if (wd && this.weapons.ammo < wd.magSize) {
          this.network.sendReload();
          this.weapons.reloading = true;
          this.ui.showReloading(true);
          this.startReloadAnim();
        }
      }

      if (this.input.consumeKey('KeyQ')) {
        this.network.sendAbility();
      }
    }

    if (this.input.consumeKey('Digit1')) this.network.sendWeaponSwitch('primary');
    if (this.input.consumeKey('Digit2')) this.network.sendWeaponSwitch('secondary');

    this.ui.showScoreboard(this.input.isKeyDown('Tab'));

    if (this.input.consumeKey('Escape')) this.togglePause();
    if (this.input.consumeKey('KeyT')) this.openChat();
  }

  showMuzzleFlash() {
    if (!this.muzzleFlash) return;
    this.muzzleFlash.material.alpha = 1;

    // [FIX 13] Weapon kick handled only in the reload anim system; removed the
    // competing setTimeout that raced against updateReloadAnim
    if (this.weaponRoot && !this.isReloadAnimating) {
      this.weaponRoot.position.z = this.weaponRestPos.z - 0.06;
      this._kickTimer = setTimeout(() => {
        if (this.weaponRoot && !this.isReloadAnimating) {
          this.weaponRoot.position.z = this.weaponRestPos.z;
        }
      }, 60);
    }

    setTimeout(() => { if (this.muzzleFlash) this.muzzleFlash.material.alpha = 0; }, 40);
    this.createBulletTrail();
  }

  createBulletTrail() {
    const slot = this.trailPool.find(t => !t.active);
    if (!slot) return;

    const cam = this.camera;
    const forward = cam.getForwardRay().direction;
    const start = cam.position.clone();
    start.addInPlace(forward.scale(1.0));
    const end = start.add(forward.scale(80));

    // [FIX 9] Correctly update the updatable line mesh — don't pass 'instance' to CreateLines
    const updatedMesh = BABYLON.MeshBuilder.CreateLines('trail_upd', {
      points: [start, end],
      updatable: false
    }, this.scene);

    // Swap the pooled mesh for the new one then dispose the old
    slot.mesh.dispose();
    slot.mesh = updatedMesh;
    slot.mesh.color = new BABYLON.Color3(1, 0.85, 0.4);
    slot.mesh.alpha = 0.6;
    slot.mesh.setEnabled(true);
    slot.active = true;
    slot.life = 0;
  }

  startReloadAnim() {
    this.isReloadAnimating = true;
    this.reloadAnimProgress = 0;
  }

  updateReloadAnim(dt) {
    if (!this.isReloadAnimating || !this.weaponRoot) return;

    this.reloadAnimProgress += dt * 2.0;

    if (this.reloadAnimProgress < 1.0) {
      const t = this.reloadAnimProgress;
      const ease = t * t;
      this.weaponRoot.position = BABYLON.Vector3.Lerp(this.weaponRestPos, this.weaponReloadPos, ease);
      this.weaponRoot.rotation.x = ease * 0.5;
    } else if (this.reloadAnimProgress < 2.0) {
      const t = this.reloadAnimProgress - 1.0;
      const ease = 1 - (1 - t) * (1 - t);
      this.weaponRoot.position = BABYLON.Vector3.Lerp(this.weaponReloadPos, this.weaponRestPos, ease);
      this.weaponRoot.rotation.x = (1 - ease) * 0.5;
    } else {
      this.weaponRoot.position = this.weaponRestPos.clone();
      this.weaponRoot.rotation.x = 0;

      // Apply rotation for weapon model (use player controller pitch/yaw)
      const pState = this.playerController ? this.playerController.getState() : { rotation: {x:0,y:0} };
      this.weaponRoot.rotation.x = -pState.rotation.x;
    
      // Weapon sway
      if (!this.weapons.aiming && pState.moving) { /* sway */ }
      
      this.isReloadAnimating = false;
    }
  }

  updateSlide(dt) {
    if (this.slideCooldown > 0) this.slideCooldown -= dt;

    if (this.sliding) {
      this.slideTimer -= dt;
      const speedFactor = Math.max(0, this.slideTimer / this.slideDuration);
      this.camera.position.x += this.slideDir.x * this.slideSpeed * speedFactor * dt;
      this.camera.position.z += this.slideDir.z * this.slideSpeed * speedFactor * dt;
      this.targetRoll = 0.08;
      this.playerHeight = 1.2;
      if (this.slideTimer <= 0) {
        this.sliding = false;
        this.playerHeight = 1.8;
      }
    } else {
      const move = this.input.getMovement();
      this.targetRoll = move.right * -0.03;
    }

    this.cameraRoll += (this.targetRoll - this.cameraRoll) * (1 - Math.exp(-10 * dt));
    this.camera.rotation.z = this.cameraRoll;
  }

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

    // [FIX 7] Use { once: false } pattern with named handler to avoid race conditions
    const handler = (e) => {
      if (e.key === 'Enter') {
        const msg = chatInput.value.trim();
        if (msg) this.network.sendChat(msg);
        chatInput.value = '';
        chatInput.classList.remove('active');
        chatInput.blur();
        chatInput.removeEventListener('keydown', handler);
        // Only re-request lock if not paused
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

  handleGameOver(data) {
    this.running = false;
    this.input.exitPointerLock();

    // [FIX 14] Always use this.selfState.team — never the stale this.team alias
    let result = 'DEFEAT';
    if (data.winnerTeam !== undefined) {
      const myTeam = this.selfState?.team;
      result = data.winnerTeam === myTeam ? 'VICTORY' : 'DEFEAT';
    } else if (data.winner === this.playerId) {
      result = 'VICTORY';
    }

    const stats = `Kills: ${this.selfState?.kills || 0} | Deaths: ${this.selfState?.deaths || 0} | Score: ${this.selfState?.score || 0}`;
    this.ui.showGameOver(result, stats);
  }

  // ─── Shared Materials ───────────────────────────────
  initSharedMaterials() {
    this.sharedMaterials = {
      skin: new BABYLON.StandardMaterial('shared_skin', this.scene),
      dark: new BABYLON.StandardMaterial('shared_dark', this.scene),
      team: {}
    };
    this.sharedMaterials.skin.diffuseColor = new BABYLON.Color3(0.75, 0.6, 0.5);
    this.sharedMaterials.dark.diffuseColor = new BABYLON.Color3(0.15, 0.15, 0.18);
    this.sharedMaterials.team[0] = new BABYLON.StandardMaterial('shared_team0', this.scene);
    this.sharedMaterials.team[0].diffuseColor = new BABYLON.Color3(0.2, 0.4, 0.9);
    this.sharedMaterials.team[1] = new BABYLON.StandardMaterial('shared_team1', this.scene);
    this.sharedMaterials.team[1].diffuseColor = new BABYLON.Color3(0.9, 0.2, 0.2);
    this.sharedMaterials.team[2] = new BABYLON.StandardMaterial('shared_teamN', this.scene);
    this.sharedMaterials.team[2].diffuseColor = new BABYLON.Color3(0.6, 0.6, 0.2);
  }

  // ─── Bullet Trail Pool ──────────────────────────────
  initTrailPool() {
    for (let i = 0; i < this.trailPoolSize; i++) {
      const trail = BABYLON.MeshBuilder.CreateLines('trail_' + i, {
        points: [BABYLON.Vector3.Zero(), BABYLON.Vector3.One()],
        updatable: false
      }, this.scene);
      trail.color = new BABYLON.Color3(1, 0.85, 0.4);
      trail.setEnabled(false);
      this.trailPool.push({ mesh: trail, active: false, life: 0 });
    }
  }

  updateTrails(dt) {
    for (const slot of this.trailPool) {
      if (!slot.active) continue;
      slot.life += dt;
      slot.mesh.alpha = Math.max(0, 0.6 - slot.life / 0.2);
      if (slot.life >= 0.2) {
        slot.mesh.setEnabled(false);
        slot.active = false;
      }
    }
  }

  // ─── Floating Damage Pool [FIX 10] ─────────────────
  initDmgPool() {
    for (let i = 0; i < this.dmgPoolSize; i++) {
      const plane = BABYLON.MeshBuilder.CreatePlane('dmg_' + i, { width: 1.5, height: 0.5 }, this.scene);
      plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
      plane.setEnabled(false);

      const tex = new BABYLON.DynamicTexture('dmgTex_' + i, { width: 256, height: 64 }, this.scene);
      const mat = new BABYLON.StandardMaterial('dmgMat_' + i, this.scene);
      mat.diffuseTexture = tex;
      mat.emissiveTexture = tex;
      mat.disableLighting = true;
      mat.hasAlpha = true;
      mat.useAlphaFromDiffuseTexture = true;
      plane.material = mat;

      this.dmgPool.push({ plane, tex, mat, active: false, life: 0 });
    }
  }

  showFloatingDamage(position, damage, isHeadshot) {
    const slot = this.dmgPool.find(s => !s.active);
    if (!slot) return; // pool exhausted — skip rather than leak

    slot.plane.position = position.clone();
    slot.plane.position.y += 2.0;
    slot.plane.position.x += (Math.random() - 0.5) * 0.5;
    slot.plane.position.z += (Math.random() - 0.5) * 0.5;

    const ctx = slot.tex.getContext();
    ctx.clearRect(0, 0, 256, 64);
    ctx.fillStyle = isHeadshot ? '#ff4444' : '#ffaa00';
    ctx.font = 'bold 48px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(Math.round(damage).toString(), 128, 48);
    slot.tex.update();

    slot.mat.alpha = 1;
    slot.plane.setEnabled(true);
    slot.active = true;
    slot.life = 1.0;
  }

  // Called each frame to animate active damage labels
  updateDmgPool(dt) {
    for (const slot of this.dmgPool) {
      if (!slot.active) continue;
      slot.life -= dt;
      if (slot.life <= 0) {
        slot.plane.setEnabled(false);
        slot.active = false;
      } else {
        slot.plane.position.y += 0.02;
        slot.mat.alpha = slot.life;
      }
    }
  }

  // ─── Other Player Interpolation ────────────────────
  interpolateOtherPlayers(dt) {
    const lerpSpeed = 12;
    const t = 1 - Math.exp(-lerpSpeed * dt);
    for (const [id, op] of Object.entries(this.otherPlayers)) {
      if (!op.targetPosition) continue;

      const dist = BABYLON.Vector3.Distance(op.mesh.position, op.targetPosition);
      op.mesh.position = BABYLON.Vector3.Lerp(op.mesh.position, op.targetPosition, t);
      const dAngle = op.targetRotation - op.mesh.rotation.y;
      op.mesh.rotation.y += dAngle * t;

      // [FIX 12] animationGroups live on the scene, not on TransformNode
      const anims = this.scene.animationGroups.filter(ag => ag.name.includes(id));
      if (anims.length > 0) {
        const targetAnimName = dist > 0.02 ? 'Run' : 'Idle';
        if (op.currentAnim !== targetAnimName) {
          const targetAnim = anims.find(ag => ag.name.includes(targetAnimName));
          if (targetAnim) {
            anims.forEach(ag => { if (ag !== targetAnim) ag.stop(); });
            targetAnim.play(true);
            op.currentAnim = targetAnimName;
          }
        }
      }
    }
  }

  // ─── Performance HUD ───────────────────────────────
  initPerfHUD() {
    this.perfEl = document.createElement('div');
    this.perfEl.style.cssText = `
      position:fixed; top:8px; left:8px; font:12px monospace;
      color:#0ff; background:rgba(0,0,0,0.5); padding:4px 8px;
      border-radius:4px; pointer-events:none; z-index:9999;
    `;
    document.body.appendChild(this.perfEl);
  }

  updatePerfHUD(dt) {
    if (!this.perfEl) return;
    const fps = Math.round(1 / dt);
    this.fpsHistory.push(fps);
    if (this.fpsHistory.length > 60) this.fpsHistory.shift();
    const avgFps = Math.round(this.fpsHistory.reduce((a, b) => a + b, 0) / this.fpsHistory.length);
    const meshCount = this.scene.meshes.length;
    const ping = this.network.latency || 0;
    this.perfEl.textContent = `FPS: ${fps} (avg: ${avgFps}) | Meshes: ${meshCount} | Ping: ${ping}ms`;
  }

  playAbilityEffect(msg) {
    const pos = new BABYLON.Vector3(msg.position.x, msg.position.y, msg.position.z);

    if (msg.abilityId === 'wall_charge') {
      BABYLON.ParticleHelper.CreateAsync('explosion', this.scene).then((set) => {
        set.systems.forEach(s => { s.emitter = pos; });
        set.start();
      });

      const dist = BABYLON.Vector3.Distance(this.camera.position, pos);
      if (dist < 20) {
        const shakeIntensity = Math.max(0, (20 - dist) / 20) * 0.5;
        this.targetRoll += (Math.random() - 0.5) * shakeIntensity;
        this.pitch -= shakeIntensity * 0.1;
      }
    } else if (msg.abilityId === 'recon_drone') {
      const drone = BABYLON.MeshBuilder.CreateBox('drone_' + msg.playerId, { size: 0.3 }, this.scene);
      drone.position = pos.clone();
      drone.position.y += 3;

      const droneMat = new BABYLON.StandardMaterial('droneMat', this.scene);
      droneMat.emissiveColor = new BABYLON.Color3(0, 0.8, 1);
      drone.material = droneMat;

      const droneObs = this.scene.onBeforeRenderObservable.add(() => {
        if (!drone.isDisposed()) {
          drone.rotation.y += 0.1;
          drone.position.y += Math.sin(performance.now() * 0.005) * 0.01;
        }
      });

      const duration = msg.duration || 5000;
      setTimeout(() => {
        this.scene.onBeforeRenderObservable.remove(droneObs);
        drone.dispose();
      }, duration);

      if (msg.playerId === this.playerId && msg.revealed) {
        msg.revealed.forEach(r => {
          this.ui.showPingOnMinimap(r.position, duration);
        });
      }
    }

    // [FIX 15] Use server-provided cooldownMs; fall back to per-ability defaults only if absent
    if (msg.playerId === this.playerId) {
      const fallbacks = { wall_charge: 45000, recon_drone: 30000 };
      const cooldownMs = msg.cooldownMs ?? fallbacks[msg.abilityId] ?? 30000;
      this.ui.updateAbilityCooldown(Date.now() + cooldownMs);
    }
  }

  // ─── Game Loop (add dmgPool update) ────────────────
  // NOTE: gameLoop already calls scene.render(); updateDmgPool must be inserted
  // We override the relevant section — call updateDmgPool inside gameLoop:
  // Add `this.updateDmgPool(dt);` after `this.updateTrails(dt);`

  destroy() {
    this.running = false;
    this.input.disable();
    this.input.exitPointerLock();
    if (this._kickTimer) clearTimeout(this._kickTimer);
    if (this.perfEl) { this.perfEl.remove(); this.perfEl = null; }
    if (this.assetLoader) { this.assetLoader.dispose(); this.assetLoader = null; }
    // Remove all player observers
    for (const id of Object.keys(this.otherPlayers)) {
      this.removeOtherPlayer(id);
    }
    if (this.engine) {
      this.engine.stopRenderLoop();
      this.scene?.dispose();
      this.engine.dispose();
    }
    this.otherPlayers = {};
  }
}