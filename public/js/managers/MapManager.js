/**
 * MapManager – Builds 4 unique maps from PURE BabylonJS primitives
 *
 * NO GLB assets — everything is boxes, cylinders, spheres with colors.
 * Every shape has checkCollisions = true for bulletproof physics.
 *
 * Maps:
 *   cave     → Crystal Cavern (rock pillars, tunnels, stalagmites)
 *   city     → Neon City (colorful cubes as buildings, roads, street cover)
 *   fortress → Desert Fortress (sand walls, towers, courtyard)
 *   arctic   → Arctic Outpost (ice-blue military base, containers)
 */
class MapManager {
  constructor(scene) {
    this.scene = scene;
    this.meshes = [];
    this.obstacles = [];
    this.shadowGenerator = null;
    this._spawnPoints = [];
  }

  // ══════════════════════════════════════════════════════════════════════════════
  //  ENTRY POINT
  // ══════════════════════════════════════════════════════════════════════════════
  buildMap(mapData, assetLoader) {
    this.assetLoader = assetLoader;

    // Spawn points
    if (mapData.spawnPoints && Array.isArray(mapData.spawnPoints.ffa)) {
      this._spawnPoints = mapData.spawnPoints.ffa;
    } else if (Array.isArray(mapData.spawnPoints)) {
      this._spawnPoints = mapData.spawnPoints;
    } else {
      this._spawnPoints = this._defaultSpawnPoints(mapData);
    }

    // Theme router
    switch (mapData.theme) {
      case 'cave':     this._buildCave(mapData); break;
      case 'city':     this._buildCity(mapData); break;
      case 'fortress': this._buildFortress(mapData); break;
      case 'arctic':   this._buildArctic(mapData); break;
      default:         this._buildCity(mapData); break;
    }

    this._createLighting(mapData);
    this._createSkybox(mapData);
    this._visualiseSpawnPoints();
  }

  // ─── Spawn Points ─────────────────────────────────────────────────────────────

  _defaultSpawnPoints(mapData) {
    const half = ((mapData.size?.x || 80) / 2) - 5;
    return [
      { x: -half, y: 1.8, z: -half }, { x: half, y: 1.8, z: -half },
      { x: -half, y: 1.8, z: half },  { x: half, y: 1.8, z: half },
      { x: 0, y: 1.8, z: -half },     { x: 0, y: 1.8, z: half },
      { x: -half, y: 1.8, z: 0 },     { x: half, y: 1.8, z: 0 }
    ];
  }
  getSpawnPoints() { return this._spawnPoints; }
  getRandomSpawnPoint(teamId) {
    const pts = this._spawnPoints;
    if (!pts.length) return { x: 0, y: 1.8, z: 0 };
    const teamPts = teamId === 0 ? pts.filter(p => p.z < 0) : teamId === 1 ? pts.filter(p => p.z > 0) : pts;
    const pool = teamPts.length ? teamPts : pts;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  _visualiseSpawnPoints() {
    this._spawnPoints.forEach((pt, i) => {
      const disc = BABYLON.MeshBuilder.CreateDisc(`spawn_${i}`, { radius: 0.6, tessellation: 16 }, this.scene);
      disc.position.set(pt.x, 0.05, pt.z);
      disc.rotation.x = Math.PI / 2;
      const mat = new BABYLON.StandardMaterial(`spawnMat_${i}`, this.scene);
      mat.emissiveColor = new BABYLON.Color3(0.2, 1.0, 0.4);
      mat.alpha = 0.35;
      disc.material = mat;
    });
  }

  // ══════════════════════════════════════════════════════════════════════════════
  //  PRIMITIVE HELPERS
  // ══════════════════════════════════════════════════════════════════════════════

  // Create a colored box with mesh collider, add to scene + obstacle list
  _box(name, w, h, d, x, y, z, color, opts = {}) {
    const mesh = BABYLON.MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, this.scene);
    mesh.position.set(x, y, z);
    if (opts.rotY) mesh.rotation.y = opts.rotY;
    const mat = new BABYLON.StandardMaterial(`${name}_mat`, this.scene);
    mat.diffuseColor = new BABYLON.Color3(...color);
    mat.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
    if (opts.emissive) mat.emissiveColor = new BABYLON.Color3(...opts.emissive);
    if (opts.alpha) { mat.alpha = opts.alpha; mesh.hasVertexAlpha = true; }
    mesh.material = mat;
    mesh.checkCollisions = true;
    mesh.isPickable = true;
    mesh.receiveShadows = true;
    this.meshes.push(mesh);
    if (this.shadowGenerator) this.shadowGenerator.addShadowCaster(mesh);

    // Track as obstacle for server-side AABB
    if (!opts.noObstacle) {
      const halfW = w / 2, halfD = d / 2;
      this.obstacles.push({
        mesh,
        min: { x: x - halfW, z: z - halfD },
        max: { x: x + halfW, z: z + halfD },
        height: h
      });
    }
    return mesh;
  }

  // Create a colored cylinder
  _cylinder(name, diameter, h, x, y, z, color, opts = {}) {
    const mesh = BABYLON.MeshBuilder.CreateCylinder(name, {
      diameter, height: h, tessellation: opts.tessellation || 12
    }, this.scene);
    mesh.position.set(x, y, z);
    const mat = new BABYLON.StandardMaterial(`${name}_mat`, this.scene);
    mat.diffuseColor = new BABYLON.Color3(...color);
    mat.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);
    if (opts.emissive) mat.emissiveColor = new BABYLON.Color3(...opts.emissive);
    mesh.material = mat;
    mesh.checkCollisions = true;
    mesh.isPickable = true;
    mesh.receiveShadows = true;
    this.meshes.push(mesh);
    if (this.shadowGenerator) this.shadowGenerator.addShadowCaster(mesh);

    if (!opts.noObstacle) {
      const r = diameter / 2;
      this.obstacles.push({
        mesh,
        min: { x: x - r, z: z - r },
        max: { x: x + r, z: z + r },
        height: h
      });
    }
    return mesh;
  }

  // Ground plane
  _ground(sizeX, sizeZ, color) {
    const ground = BABYLON.MeshBuilder.CreateGround('ground', { width: sizeX, height: sizeZ, subdivisions: 2 }, this.scene);
    const mat = new BABYLON.StandardMaterial('groundMat', this.scene);
    mat.diffuseColor = new BABYLON.Color3(...color);
    mat.specularColor = new BABYLON.Color3(0.02, 0.02, 0.02);
    ground.material = mat;
    ground.receiveShadows = true;
    ground.checkCollisions = true;
    this.meshes.push(ground);
    return ground;
  }

  // Boundary walls
  _walls(sizeX, sizeZ, h, color) {
    const wallT = 1;
    [
      { w: sizeX + wallT, d: wallT, px: 0, pz: -sizeZ / 2 },
      { w: sizeX + wallT, d: wallT, px: 0, pz: sizeZ / 2 },
      { w: wallT, d: sizeZ + wallT, px: -sizeX / 2, pz: 0 },
      { w: wallT, d: sizeZ + wallT, px: sizeX / 2, pz: 0 }
    ].forEach((wd, i) => {
      this._box(`wall_${i}`, wd.w, h, wd.d, wd.px, h / 2, wd.pz, color, { noObstacle: true });
    });
  }

  // Place obstacles from server map data
  _placeObstacles(mapData) {
    if (!mapData.obstacles) return;
    mapData.obstacles.forEach((obs, i) => {
      const w = obs.max.x - obs.min.x;
      const d = obs.max.z - obs.min.z;
      const h = obs.height || 4;
      const cx = (obs.min.x + obs.max.x) / 2;
      const cz = (obs.min.z + obs.max.z) / 2;

      if (obs.shape === 'cylinder') {
        const diam = Math.min(w, d);
        this._cylinder(`obs_${i}`, diam, h, cx, h / 2, cz, obs.color || [0.4, 0.4, 0.4], {
          emissive: obs.emissive
        });
      } else {
        this._box(`obs_${i}`, w, h, d, cx, h / 2, cz, obs.color || [0.4, 0.4, 0.4], {
          rotY: obs.rotY || 0,
          emissive: obs.emissive
        });
      }
    });
  }

  // ══════════════════════════════════════════════════════════════════════════════
  //  MAP 1: CRYSTAL CAVERN
  //  Dark cave with rock pillars, tunnels, stalagmites, glowing crystals
  // ══════════════════════════════════════════════════════════════════════════════
  _buildCave(mapData) {
    const sx = mapData.size?.x || 100;
    const sz = mapData.size?.z || 100;

    // Dark rocky ground
    this._ground(sx, sz, [0.08, 0.06, 0.05]);

    // Cave ceiling (low box overhead)
    const ceiling = this._box('ceiling', sx, 1, sz, 0, 18, 0, [0.06, 0.05, 0.04], { noObstacle: true });

    // Rough cave walls — tall, dark
    this._walls(sx, sz, 18, [0.1, 0.08, 0.06]);

    // Place server-defined obstacles
    this._placeObstacles(mapData);

    // Bomb/control markers
    this._placeMarkers(mapData);
  }

  // ══════════════════════════════════════════════════════════════════════════════
  //  MAP 2: NEON CITY
  //  Bright colored buildings, roads painted on ground, street cover
  // ══════════════════════════════════════════════════════════════════════════════
  _buildCity(mapData) {
    const sx = mapData.size?.x || 120;
    const sz = mapData.size?.z || 120;

    // Asphalt ground
    this._ground(sx, sz, [0.1, 0.1, 0.12]);

    // Road markings (flat bright strips)
    this._buildRoads(sx, sz);

    // Boundary walls (chain-link style)
    this._walls(sx, sz, 8, [0.15, 0.15, 0.18]);

    // Place buildings from server
    this._placeObstacles(mapData);

    // Markers
    this._placeMarkers(mapData);
  }

  _buildRoads(sx, sz) {
    const halfX = sx / 2, halfZ = sz / 2;
    const roadColor = [0.2, 0.2, 0.22];
    const lineColor = [0.9, 0.8, 0.2];

    // Main horizontal road
    this._box('road_h', sx - 4, 0.05, 8, 0, 0.02, 0, roadColor, { noObstacle: true });
    this._box('road_line_h', sx - 4, 0.06, 0.3, 0, 0.03, 0, lineColor, { noObstacle: true });

    // Main vertical road
    this._box('road_v', 8, 0.05, sz - 4, 0, 0.02, 0, roadColor, { noObstacle: true });
    this._box('road_line_v', 0.3, 0.06, sz - 4, 0, 0.03, 0, lineColor, { noObstacle: true });

    // Cross roads
    if (halfX > 30) {
      this._box('road_h2a', sx - 4, 0.05, 6, 0, 0.02, -halfZ * 0.55, roadColor, { noObstacle: true });
      this._box('road_h2b', sx - 4, 0.05, 6, 0, 0.02, halfZ * 0.55, roadColor, { noObstacle: true });
    }
    if (halfZ > 30) {
      this._box('road_v2a', 6, 0.05, sz - 4, -halfX * 0.55, 0.02, 0, roadColor, { noObstacle: true });
      this._box('road_v2b', 6, 0.05, sz - 4, halfX * 0.55, 0.02, 0, roadColor, { noObstacle: true });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════
  //  MAP 3: DESERT FORTRESS
  //  Sand-colored fort with thick walls, guard towers, inner courtyard
  // ══════════════════════════════════════════════════════════════════════════════
  _buildFortress(mapData) {
    const sx = mapData.size?.x || 110;
    const sz = mapData.size?.z || 110;

    // Sandy ground
    this._ground(sx, sz, [0.55, 0.42, 0.25]);

    // Fortress outer walls (thick)
    const wH = 10, wT = 3;
    const sand = [0.65, 0.5, 0.3];
    this._box('fwall_n', sx, wH, wT, 0, wH / 2, -sz / 2 + wT / 2, sand);
    this._box('fwall_s', sx, wH, wT, 0, wH / 2, sz / 2 - wT / 2, sand);
    this._box('fwall_w', wT, wH, sz, -sx / 2 + wT / 2, wH / 2, 0, sand);
    this._box('fwall_e', wT, wH, sz, sx / 2 - wT / 2, wH / 2, 0, sand);

    // Place from server data
    this._placeObstacles(mapData);

    // Markers
    this._placeMarkers(mapData);
  }

  // ══════════════════════════════════════════════════════════════════════════════
  //  MAP 4: ARCTIC OUTPOST
  //  Ice-blue military compound with containers, bunkers, watch towers
  // ══════════════════════════════════════════════════════════════════════════════
  _buildArctic(mapData) {
    const sx = mapData.size?.x || 120;
    const sz = mapData.size?.z || 120;

    // Snow ground
    this._ground(sx, sz, [0.75, 0.8, 0.85]);

    // Perimeter fence
    this._walls(sx, sz, 6, [0.4, 0.45, 0.5]);

    // Place from server data
    this._placeObstacles(mapData);

    // Markers
    this._placeMarkers(mapData);
  }

  // ══════════════════════════════════════════════════════════════════════════════
  //  ZONE MARKERS (bomb sites, control points)
  // ══════════════════════════════════════════════════════════════════════════════
  _placeMarkers(mapData) {
    if (mapData.bombSites) {
      Object.entries(mapData.bombSites).forEach(([name, pos]) => {
        this._createZoneMarker(name, pos, [0.9, 0.2, 0.0]);
      });
    }
    if (mapData.controlPoints) {
      Object.entries(mapData.controlPoints).forEach(([name, pos]) => {
        this._createZoneMarker(name, pos, [0.9, 0.8, 0.1]);
      });
    }
  }

  _createZoneMarker(label, pos, color) {
    const disc = BABYLON.MeshBuilder.CreateDisc(`zone_${label}`, { radius: 3, tessellation: 32 }, this.scene);
    disc.position.set(pos.x, 0.06, pos.z);
    disc.rotation.x = Math.PI / 2;
    const mat = new BABYLON.StandardMaterial(`zoneMat_${label}`, this.scene);
    mat.emissiveColor = new BABYLON.Color3(...color);
    mat.alpha = 0.5;
    mat.disableLighting = true;
    disc.material = mat;
    disc.checkCollisions = false;

    // Glowing pillar
    this._box(`zonePillar_${label}`, 0.3, 6, 0.3, pos.x, 3, pos.z, color, {
      emissive: color, noObstacle: true
    });
  }

  // ══════════════════════════════════════════════════════════════════════════════
  //  LIGHTING (per-theme)
  // ══════════════════════════════════════════════════════════════════════════════
  _createLighting(mapData) {
    const theme = mapData.theme || 'city';
    const hemi = new BABYLON.HemisphericLight('hemi', new BABYLON.Vector3(0, 1, 0), this.scene);
    const dir = new BABYLON.DirectionalLight('sun', new BABYLON.Vector3(-0.5, -1, 0.5), this.scene);

    switch (theme) {
      case 'cave':
        hemi.intensity = 0.25;
        hemi.diffuse = new BABYLON.Color3(0.3, 0.25, 0.2);
        hemi.groundColor = new BABYLON.Color3(0.05, 0.04, 0.03);
        dir.intensity = 0.3;
        dir.diffuse = new BABYLON.Color3(0.4, 0.35, 0.3);
        dir.position = new BABYLON.Vector3(0, 30, 0);
        break;
      case 'fortress':
        hemi.intensity = 0.6;
        hemi.diffuse = new BABYLON.Color3(0.9, 0.85, 0.7);
        hemi.groundColor = new BABYLON.Color3(0.3, 0.25, 0.15);
        dir.intensity = 1.2;
        dir.diffuse = new BABYLON.Color3(1.0, 0.9, 0.7);
        dir.position = new BABYLON.Vector3(40, 60, -30);
        break;
      case 'arctic':
        hemi.intensity = 0.65;
        hemi.diffuse = new BABYLON.Color3(0.7, 0.8, 0.95);
        hemi.groundColor = new BABYLON.Color3(0.2, 0.25, 0.35);
        dir.intensity = 0.9;
        dir.diffuse = new BABYLON.Color3(0.85, 0.9, 1.0);
        dir.position = new BABYLON.Vector3(30, 50, -40);
        break;
      default: // city
        hemi.intensity = 0.5;
        hemi.diffuse = new BABYLON.Color3(0.6, 0.65, 0.8);
        hemi.groundColor = new BABYLON.Color3(0.15, 0.12, 0.1);
        dir.intensity = 0.9;
        dir.diffuse = new BABYLON.Color3(1.0, 0.92, 0.8);
        dir.position = new BABYLON.Vector3(40, 60, -40);
    }

    this.shadowGenerator = new BABYLON.ShadowGenerator(2048, dir);
    this.shadowGenerator.useBlurExponentialShadowMap = true;
    this.shadowGenerator.blurKernel = 32;
    this.shadowGenerator.darkness = 0.3;

    // Accent lights from map data
    if (mapData.lights) {
      mapData.lights.forEach((l, i) => {
        const pl = new BABYLON.PointLight(`accent_${i}`, new BABYLON.Vector3(l.x, l.y, l.z), this.scene);
        pl.diffuse = new BABYLON.Color3(...l.color);
        pl.intensity = l.intensity || 0.6;
        pl.range = l.range || 30;
      });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════
  //  SKYBOX (per-theme)
  // ══════════════════════════════════════════════════════════════════════════════
  _createSkybox(mapData) {
    const theme = mapData.theme || 'city';
    const skybox = BABYLON.MeshBuilder.CreateBox('skyBox', { size: 800 }, this.scene);
    const mat = new BABYLON.StandardMaterial('skyMat', this.scene);
    mat.backFaceCulling = false;
    mat.disableLighting = true;
    mat.diffuseColor = BABYLON.Color3.Black();
    mat.specularColor = BABYLON.Color3.Black();

    switch (theme) {
      case 'cave':     mat.emissiveColor = new BABYLON.Color3(0.02, 0.02, 0.015); break;
      case 'fortress': mat.emissiveColor = new BABYLON.Color3(0.15, 0.12, 0.08); break;
      case 'arctic':   mat.emissiveColor = new BABYLON.Color3(0.08, 0.1, 0.15); break;
      default:         mat.emissiveColor = new BABYLON.Color3(0.03, 0.04, 0.1); break;
    }

    skybox.material = mat;
    skybox.infiniteDistance = true;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  //  HELPERS
  // ══════════════════════════════════════════════════════════════════════════════

  addShadowCaster(mesh) {
    if (!this.shadowGenerator || !mesh) return;
    if (mesh.getChildMeshes) {
      mesh.getChildMeshes().forEach(m => this.shadowGenerator.addShadowCaster(m));
    } else {
      this.shadowGenerator.addShadowCaster(mesh);
    }
  }

  dispose() {
    this.meshes.forEach(m => { if (!m.isDisposed()) m.dispose(); });
    this.obstacles.forEach(o => { if (o.mesh && !o.mesh.isDisposed()) o.mesh.dispose(); });
    this.meshes = [];
    this.obstacles = [];
  }
}