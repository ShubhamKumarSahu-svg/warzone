/**
 * Game - Core Babylon.js game engine integrating all systems
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
    this.otherPlayers = {};  // id -> { mesh, nameTag, state }
    this.mapData = null;
    this.gameMode = null;
    this.paused = false;
    this.alive = true;

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
    this.playerId = playerData.id;
    this.selfState = playerData;
    this.mapData = roomData.mapData;
    this.gameMode = roomData.gameMode;

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
    this.camera.angularSensibility = 99999; // We handle mouse ourselves
    this.camera.checkCollisions = true;
    this.camera.ellipsoid = new BABYLON.Vector3(this.playerRadius, this.playerHeight / 2, this.playerRadius);
    this.camera.applyGravity = true;
    this.scene.activeCamera = this.camera;

    this.scene.activeCamera = this.camera;

    // Graphics settings
    this.graphics = new GraphicsSettings(this.scene, this.engine);
    const quality = document.getElementById('graphics-quality')?.value || 'medium';
    this.graphics.apply(quality);

    // Initialize shared systems (must be before addOtherPlayer which uses sharedMaterials)
    this.initSharedMaterials();
    this.initTrailPool();

    // Preload 3D assets (characters, weapons) with loading bar feedback
    this.assetLoader = new AssetLoader(this.scene);
    const loadingFill = document.getElementById('loading-fill');
    this.assetLoader.onProgress = (pct, label) => {
      if (loadingFill) loadingFill.style.width = (30 + pct * 0.5) + '%';
      const tipEl = document.getElementById('loading-tip');
      if (tipEl) tipEl.textContent = label;
    };
    await this.assetLoader.preloadAll();

    // Build map (needs assetLoader for City Builder tiles)
    this.map = new MapManager(this.scene);
    this.map.buildMap(this.mapData, this.assetLoader);

    // Create weapon viewmodel (GLB blaster or fallback boxes)
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

    // Request pointer lock on click
    this.canvas.addEventListener('click', () => {
      if (!this.paused) this.input.requestPointerLock();
    });
  }

  createWeaponModel() {
    if (this.weaponRoot) { this.weaponRoot.dispose(); this.weaponRoot = null; }

    // Root node parented to camera
    const root = new BABYLON.TransformNode('weaponRoot', this.scene);
    root.parent = this.camera;
    root.position = this.weaponRestPos.clone();
    this.weaponRoot = root;

    // Try to load GLB blaster model from AssetLoader
    const weaponId = this.weapons.currentWeapon;
    const glbModel = this.assetLoader ? this.assetLoader.createWeaponViewmodel(weaponId, root) : null;

    if (glbModel) {
      // GLB loaded successfully — use it
      this.weaponMesh = glbModel;
    } else {
      // Fallback: procedural box weapon
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

    // Muzzle flash (always add)
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
      // Update other players
      const seen = new Set();
      (msg.players || []).forEach(p => {
        seen.add(p.id);
        if (this.otherPlayers[p.id]) {
          this.updateOtherPlayer(p);
        } else {
          this.addOtherPlayer(p);
        }
      });
      // Remove gone players
      for (const id of Object.keys(this.otherPlayers)) {
        if (!seen.has(id)) this.removeOtherPlayer(id);
      }

      // Update self from server
      if (msg.self) {
        this.selfState = msg.self;
        this.alive = msg.self.alive;
        this.ui.updateHealth(msg.self.health);
      }

      // Scoreboard
      if (msg.scoreboard) {
        this.ui.updateScoreboard(msg.scoreboard, this.playerId);
        this.ui.updateTimer(msg.scoreboard.timeRemaining);
        this.ui.updateMatchScore(msg.scoreboard);
        this.ui.updateMinimap(
          this.camera.position,
          msg.players,
          this.mapData?.size?.x || 60
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
        // Rebuild viewmodel with new weapon's GLB blaster
        this.createWeaponModel();
      }
    });

    net.on('game_event', (msg) => {
      if (msg.event?.type === 'game_over') {
        this.handleGameOver(msg.event);
      }
    });

    net.on('game_over', (msg) => {
      this.handleGameOver(msg);
    });

    net.on('chat', (msg) => {
      this.ui.addChatMessage(msg.username, msg.message);
    });

    net.on('game_start', (msg) => {
      // Game starting
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

    net.on('game_event', (msg) => {
      if (msg.event?.type === 'game_over') {
        this.handleGameOver(msg.event);
      } else if (msg.event?.type === 'phase_change') {
        this.currentPhase = msg.event.phase;
        this.ui.showPhaseBanner(msg.event.phase, msg.event.timeLimit, msg.event.round);
      } else if (msg.event?.type === 'round_end') {
        const text = msg.event.winnerTeam === this.team ? "ROUND WON" : "ROUND LOST";
        this.ui.showPhaseBanner("DEBRIEF", 15, text);
      }
    });
  }

  // ─── Other Players ──────────────────────────────────
  addOtherPlayer(data) {
    if (this.otherPlayers[data.id]) return;

    // Try to use GLB character model from AssetLoader
    const characterModel = this.assetLoader
      ? this.assetLoader.createPlayerCharacter(null, data.team)
      : null;

    let root, torso, head;

    if (characterModel) {
      // GLB character loaded
      root = characterModel;
      root.position.set(data.position.x, data.position.y - 0.9, data.position.z);
      torso = root; // reference the root for shadow casting
      head = root;  // simplified reference

      // Add shadow casting for child meshes
      if (this.map) {
        root.getChildMeshes().forEach(m => this.map.addShadowCaster(m));
      }
    } else {
      // Fallback: procedural box character
      root = new BABYLON.TransformNode('proot_' + data.id, this.scene);
      root.position.set(data.position.x, data.position.y - 0.9, data.position.z);

      const bodyMat = this.sharedMaterials.team[data.team] || this.sharedMaterials.team[2];
      const skinMat = this.sharedMaterials.skin;
      const darkMat = this.sharedMaterials.dark;

      torso = BABYLON.MeshBuilder.CreateBox('torso_' + data.id, { width: 0.5, height: 0.65, depth: 0.3 }, this.scene);
      torso.parent = root; torso.position.y = 0.55; torso.material = bodyMat;
      head = BABYLON.MeshBuilder.CreateSphere('head_' + data.id, { diameter: 0.38, segments: 10 }, this.scene);
      head.parent = root; head.position.y = 1.15; head.material = skinMat;
      const helmet = BABYLON.MeshBuilder.CreateSphere('helmet_' + data.id, { diameter: 0.42, segments: 8, slice: 0.5 }, this.scene);
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

    // Name tag (always add above character)
    const nameplane = BABYLON.MeshBuilder.CreatePlane('name_' + data.id, { width: 2, height: 0.3 }, this.scene);
    nameplane.parent = root;
    nameplane.position.y = characterModel ? 2.2 : 1.7;
    nameplane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
    const nameTex = new BABYLON.DynamicTexture('nameTex_' + data.id, { width: 256, height: 40 }, this.scene);
    const nameCtx = nameTex.getContext();
    nameCtx.clearRect(0, 0, 256, 40);
    nameCtx.fillStyle = '#ffffff';
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

    this.otherPlayers[data.id] = { mesh: root, state: data, head, torso };
  }

  updateOtherPlayer(data) {
    const op = this.otherPlayers[data.id];
    if (!op) return;

    // Store server target for frame-rate independent interpolation
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

    this.handleInput(dt);
    this.weapons.updateRecoil(dt);
    this.updateReloadAnim(dt);
    this.updateSlide(dt);
    this.updateTrails(dt);
    this.interpolateOtherPlayers(dt);
    this.updatePerfHUD(dt);
    this.scene.render();
  }

  handleInput(dt) {
    if (!this.alive || !this.input.locked) return;

    // Mouse look — Babylon FreeCamera: rotation.y+ = left, rotation.x+ = down
    const mouseDelta = this.input.getMouseDelta();
    this.yaw += mouseDelta.dx;    // track our own yaw (positive = right)
    this.pitch += mouseDelta.dy;  // track our own pitch (positive = down)
    this.pitch = Math.max(-Math.PI / 2.1, Math.min(Math.PI / 2.1, this.pitch));

    // Apply recoil (kick upward = decrease pitch toward negative)
    this.pitch -= this.weapons.recoilOffset.y;
    this.yaw += this.weapons.recoilOffset.x;

    // Map to Babylon rotation (flip yaw sign, pitch is same direction)
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;

    // Movement with acceleration/deceleration
    const move = this.input.getMovement();
    const isMoving = move.forward !== 0 || move.right !== 0;

    // Babylon FreeCamera faces -Z at rotation.y=0, so negate yaw for movement
    const moveYaw = -this.yaw;

    // Slide initiation: Shift + moving forward + grounded + not already sliding
    if (this.input.isKeyDown('ShiftLeft') && this.grounded && isMoving && !this.sliding && this.slideCooldown <= 0) {
      this.sliding = true;
      this.slideTimer = this.slideDuration;
      this.slideCooldown = 1.0;
      const moveAngle = Math.atan2(move.right, move.forward) + moveYaw;
      this.slideDir = { x: Math.sin(moveAngle), z: Math.cos(moveAngle) };
    }

    if (!this.sliding) {
      if (isMoving) {
        const moveAngle = Math.atan2(move.right, move.forward) + moveYaw;
        const targetVx = Math.sin(moveAngle) * this.maxMoveSpeed;
        const targetVz = Math.cos(moveAngle) * this.maxMoveSpeed;
        // Frame-rate independent exponential smoothing
        const t = 1 - Math.exp(-this.acceleration * dt);
        this.moveVelocity.x += (targetVx - this.moveVelocity.x) * t;
        this.moveVelocity.z += (targetVz - this.moveVelocity.z) * t;
      } else {
        // Friction deceleration
        const t = 1 - Math.exp(-this.deceleration * dt);
        this.moveVelocity.x *= (1 - t);
        this.moveVelocity.z *= (1 - t);
      }
      const speedMult = this.crouching ? 0.5 : 1.0;
      this.camera.position.x += this.moveVelocity.x * speedMult * dt;
      this.camera.position.z += this.moveVelocity.z * speedMult * dt;
    }

    // Jump
    if (this.input.isKeyDown('Space') && this.grounded) {
      this.velocity.y = this.jumpForce;
      this.grounded = false;
    }

    // Gravity
    this.velocity.y += this.gravity * dt;
    this.camera.position.y += this.velocity.y * dt;

    if (this.camera.position.y <= this.playerHeight) {
      this.camera.position.y = this.playerHeight;
      this.velocity.y = 0;
      this.grounded = true;
    }

    // Crouch (also crouching during slide)
    this.crouching = this.sliding || this.input.isKeyDown('KeyC') || this.input.isKeyDown('ControlLeft');

    // Clamp to map bounds
    const halfX = (this.mapData?.size?.x || 60) / 2 - 1;
    const halfZ = (this.mapData?.size?.z || 60) / 2 - 1;
    this.camera.position.x = Math.max(-halfX, Math.min(halfX, this.camera.position.x));
    this.camera.position.z = Math.max(-halfZ, Math.min(halfZ, this.camera.position.z));

    this.camera.position.x = Math.max(-halfX, Math.min(halfX, this.camera.position.x));
    this.camera.position.z = Math.max(-halfZ, Math.min(halfZ, this.camera.position.z));

    // Disable weapons/abilities if not in engagement phase for plant_defuse
    const isPrep = this.currentPhase === 'preparation' || this.currentPhase === 'debrief';
    if (isPrep) {
      this.weapons.shooting = false;
      this.ui.updateCrosshairSpread(false);
    } else {
      // Shooting
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

      // Reload with animation
      if (this.input.isKeyDown('KeyR') && !this.weapons.reloading) {
        this.input.keys['KeyR'] = false;
        const wd = this.weapons.getWeaponData();
        if (wd && this.weapons.ammo < wd.magSize) {
          this.network.sendReload();
          this.weapons.reloading = true;
          this.ui.showReloading(true);
          this.startReloadAnim();
        }
      }

      // Ability
      if (this.input.isKeyDown('KeyQ')) {
        this.input.keys['KeyQ'] = false;
        this.network.sendAbility();
      }
    }

    // Weapon switch
    if (this.input.isKeyDown('Digit1')) {
      this.input.keys['Digit1'] = false;
      this.network.sendWeaponSwitch('primary');
    }
    if (this.input.isKeyDown('Digit2')) {
      this.input.keys['Digit2'] = false;
      this.network.sendWeaponSwitch('secondary');
    }

    // Scoreboard
    this.ui.showScoreboard(this.input.isKeyDown('Tab'));

    // Pause
    if (this.input.isKeyDown('Escape')) {
      this.input.keys['Escape'] = false;
      this.togglePause();
    }

    // Chat
    if (this.input.isKeyDown('KeyT')) {
      this.input.keys['KeyT'] = false;
      this.openChat();
    }

    // Send position to server
    this.network.sendInput({
      position: { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z },
      rotation: { x: this.pitch, y: moveYaw },
      moving: isMoving,
      crouching: this.crouching,
      grounded: this.grounded,
      jumping: !this.grounded,
      seq: this.input.consumeInputSeq()
    });
  }

  showMuzzleFlash() {
    if (!this.muzzleFlash) return;
    this.muzzleFlash.material.alpha = 1;
    // Weapon kick animation
    if (this.weaponRoot) {
      this.weaponRoot.position.z = this.weaponRestPos.z - 0.06;
      setTimeout(() => { if (this.weaponRoot && !this.isReloadAnimating) this.weaponRoot.position.z = this.weaponRestPos.z; }, 60);
    }
    setTimeout(() => { if (this.muzzleFlash) this.muzzleFlash.material.alpha = 0; }, 40);

    // Bullet trail
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

    // Reuse pooled mesh
    BABYLON.MeshBuilder.CreateLines('trail', {
      points: [start, end],
      instance: slot.mesh
    });

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

    this.reloadAnimProgress += dt * 2.0; // animation speed

    if (this.reloadAnimProgress < 1.0) {
      // Phase 1: gun moves down & tilts (0 → 1)
      const t = this.reloadAnimProgress;
      const ease = t * t; // ease-in
      this.weaponRoot.position = BABYLON.Vector3.Lerp(this.weaponRestPos, this.weaponReloadPos, ease);
      this.weaponRoot.rotation.x = ease * 0.5;
    } else if (this.reloadAnimProgress < 2.0) {
      // Phase 2: gun comes back up (1 → 2)
      const t = this.reloadAnimProgress - 1.0;
      const ease = 1 - (1 - t) * (1 - t); // ease-out
      this.weaponRoot.position = BABYLON.Vector3.Lerp(this.weaponReloadPos, this.weaponRestPos, ease);
      this.weaponRoot.rotation.x = (1 - ease) * 0.5;
    } else {
      // Done
      this.weaponRoot.position = this.weaponRestPos.clone();
      this.weaponRoot.rotation.x = 0;
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
      this.targetRoll = 0.08; // camera tilt during slide
      this.playerHeight = 1.2;
      if (this.slideTimer <= 0) {
        this.sliding = false;
        this.playerHeight = 1.8;
      }
    } else {
      // Strafe tilt
      const move = this.input.getMovement();
      this.targetRoll = move.right * -0.03;
    }

    // Smooth camera roll
    this.cameraRoll += (this.targetRoll - this.cameraRoll) * (1 - Math.exp(-10 * dt));
    this.camera.rotation.z = this.cameraRoll;
  }

  togglePause() {
    this.paused = !this.paused;
    this.ui.showPauseMenu(this.paused);
    if (this.paused) {
      this.input.exitPointerLock();
    }
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
        setTimeout(() => this.input.requestPointerLock(), 100);
      } else if (e.key === 'Escape') {
        chatInput.value = '';
        chatInput.classList.remove('active');
        chatInput.blur();
        chatInput.removeEventListener('keydown', handler);
        setTimeout(() => this.input.requestPointerLock(), 100);
      }
    };
    chatInput.addEventListener('keydown', handler);
  }

  handleGameOver(data) {
    this.running = false;
    this.input.exitPointerLock();

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

  // ─── Shared Materials (O(1) instead of O(n×5)) ─────
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

  // ─── Bullet Trail Pool ─────────────────────────────
  initTrailPool() {
    for (let i = 0; i < this.trailPoolSize; i++) {
      const trail = BABYLON.MeshBuilder.CreateLines('trail_' + i, {
        points: [BABYLON.Vector3.Zero(), BABYLON.Vector3.One()],
        updatable: true
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

  // ─── Other Player Interpolation ────────────────────
  interpolateOtherPlayers(dt) {
    const lerpSpeed = 12;
    const t = 1 - Math.exp(-lerpSpeed * dt);
    for (const op of Object.values(this.otherPlayers)) {
      if (!op.targetPosition) continue;
      op.mesh.position = BABYLON.Vector3.Lerp(op.mesh.position, op.targetPosition, t);
      const dAngle = op.targetRotation - op.mesh.rotation.y;
      op.mesh.rotation.y += dAngle * t;
    }
  }

  // ─── Performance HUD ──────────────────────────────
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
    this.perfEl.textContent =
      `FPS: ${fps} (avg: ${avgFps}) | Meshes: ${meshCount} | Ping: ${ping}ms`;
  }

  playAbilityEffect(msg) {
    const pos = new BABYLON.Vector3(msg.position.x, msg.position.y, msg.position.z);
    
    if (msg.abilityId === 'wall_charge') {
      // Explosion VFX
      BABYLON.ParticleHelper.CreateAsync("explosion", this.scene).then((set) => {
        set.systems.forEach(s => {
          s.emitter = pos;
        });
        set.start();
      });
      
      // Camera shake if near
      const dist = BABYLON.Vector3.Distance(this.camera.position, pos);
      if (dist < 20) {
        const shakeIntensity = Math.max(0, (20 - dist) / 20) * 0.5;
        this.targetRoll += (Math.random() - 0.5) * shakeIntensity;
        this.pitch -= shakeIntensity * 0.1;
      }
    } 
    else if (msg.abilityId === 'recon_drone') {
      // Visual drone
      const drone = BABYLON.MeshBuilder.CreateBox('drone_' + msg.playerId, {size: 0.3}, this.scene);
      drone.position = pos.clone();
      drone.position.y += 3;
      
      const droneMat = new BABYLON.StandardMaterial('droneMat', this.scene);
      droneMat.emissiveColor = new BABYLON.Color3(0, 0.8, 1);
      drone.material = droneMat;
      
      // Animate drone up and spin
      this.scene.onBeforeRenderObservable.add(() => {
        if (!drone.isDisposed()) {
          drone.rotation.y += 0.1;
          drone.position.y += Math.sin(performance.now() * 0.005) * 0.01;
        }
      });
      
      setTimeout(() => drone.dispose(), msg.duration || 5000);
      
      // Show revealed enemies on minimap
      if (msg.playerId === this.playerId) {
        msg.revealed.forEach(r => {
          this.ui.showPingOnMinimap(r.position, msg.duration || 5000);
        });
      }
    }

    // Start cooldown UI for the player who used it
    if (msg.playerId === this.playerId) {
      const cooldownMs = msg.abilityId === 'wall_charge' ? 45000 : 30000;
      this.ui.updateAbilityCooldown(Date.now() + cooldownMs);
    }
  }

  destroy() {
    this.running = false;
    this.input.disable();
    this.input.exitPointerLock();
    if (this.perfEl) { this.perfEl.remove(); this.perfEl = null; }
    if (this.assetLoader) { this.assetLoader.dispose(); this.assetLoader = null; }
    if (this.engine) {
      this.engine.stopRenderLoop();
      this.scene?.dispose();
      this.engine.dispose();
    }
    this.otherPlayers = {};
  }
}
