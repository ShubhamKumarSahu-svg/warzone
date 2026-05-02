/**
 * MapManager - Builds the 3D environment using Babylon.js
 *
 * FIXES:
 *  M1 - Spawn point system: getSpawnPoints() / getRandomSpawnPoint() helpers.
 *  M2 - buildCityMap greatly expanded: benches, boxes, road network, RPG props,
 *       crate clusters around bomb sites, watertower, decorative scatter.
 *  M3 - createObstacles uses a richer building-type map and the preloaded
 *       getCityProp() fast-path for synchronous placement.
 *  M4 - createDetails uses city props (bench, box_A, box_B) instead of pure
 *       procedural geometry so the map looks hand-crafted.
 *  M5 - Shadow generator exposed as this.shadowGenerator (was local).
 *  M6 - dispose() now clears obstacle list too.
 */
class MapManager {
  constructor(scene) {
    this.scene = scene;
    this.meshes = [];
    this.obstacles = [];          // { mesh, min, max, height }
    this.shadowGenerator = null;  // [M5] public so Game.js can add casters
    this.assetLoader = null;
    this._spawnPoints = [];       // [M1]
  }

  // ─── Entry Point ─────────────────────────────────────────────────────────────

  buildMap(mapData, assetLoader) {
    this.assetLoader = assetLoader;
    
    if (mapData.spawnPoints && Array.isArray(mapData.spawnPoints.ffa)) {
      this._spawnPoints = mapData.spawnPoints.ffa;
    } else if (Array.isArray(mapData.spawnPoints)) {
      this._spawnPoints = mapData.spawnPoints;
    } else {
      this._spawnPoints = this._defaultSpawnPoints(mapData);
    }

    if (mapData.theme === 'downtown') {
      this._buildBase(mapData);
      this.buildCityMap(mapData);
    } else {
      this.createGround(mapData);
      this.createWalls(mapData);
      this.createObstacles(mapData);
      this.createDetails(mapData);
    }
    this.createLighting();
    this.createSkybox();
  }

  // ─── [M1] Spawn Points ───────────────────────────────────────────────────────

  _defaultSpawnPoints(mapData) {
    const half = ((mapData.size?.x || 60) / 2) - 5;
    return [
      { x: -half, y: 1.8, z: -half },
      { x: half, y: 1.8, z: -half },
      { x: -half, y: 1.8, z: half },
      { x: half, y: 1.8, z: half },
      { x: 0, y: 1.8, z: -half },
      { x: 0, y: 1.8, z: half },
      { x: -half, y: 1.8, z: 0 },
      { x: half, y: 1.8, z: 0 }
    ];
  }

  getSpawnPoints() { return this._spawnPoints; }

  getRandomSpawnPoint(teamId) {
    const pts = this._spawnPoints;
    if (!pts.length) return { x: 0, y: 1.8, z: 0 };
    // Crude team-side split: team 0 gets lower-z half, team 1 upper-z half
    const teamPts = teamId === 0
      ? pts.filter(p => p.z < 0)
      : teamId === 1
        ? pts.filter(p => p.z > 0)
        : pts;
    const pool = teamPts.length ? teamPts : pts;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // Visualise spawn points as small glowing discs (debug / minimap)
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

  // ─── Ground plane shared by city maps ────────────────────────────────────────

  _buildBase(mapData) {
    const size = mapData.size || { x: 70, z: 70 };
    const ground = BABYLON.MeshBuilder.CreateGround('cityGround',
      { width: size.x, height: size.z, subdivisions: 4 }, this.scene);
    const mat = new BABYLON.StandardMaterial('groundMat', this.scene);
    mat.diffuseColor = new BABYLON.Color3(0.12, 0.12, 0.12);
    mat.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);
    ground.material = mat;
    ground.receiveShadows = true;
    ground.checkCollisions = true;
    this.meshes.push(ground);
  }

  // ─── [M2] City Map ───────────────────────────────────────────────────────────

  buildCityMap(mapData) {
    const al = this.assetLoader;

    // ── Buildings from obstacle list ──────────────────────────────────────────
    if (mapData.obstacles) {
      mapData.obstacles.forEach((obs, i) => {
        const cx = (obs.min.x + obs.max.x) / 2;
        const cz = (obs.min.z + obs.max.z) / 2;
        const h = obs.height || 5;
        const w = obs.max.x - obs.min.x;
        const d = obs.max.z - obs.min.z;

        // Pick building type
        const buildingType = obs.type || this._buildingTypeForHeight(h);

        if (buildingType && al) {
          al.placeMapPiece(buildingType, new BABYLON.Vector3(cx, 0, cz)).then(mesh => {
            if (!mesh) return;
            if (!buildingType.startsWith('car_') && buildingType !== 'watertower') {
              mesh.rotation.y = (Math.PI / 2) * (i % 4);
            }
            if (this.shadowGenerator) this.shadowGenerator.addShadowCaster(mesh);
          });
        }

        // Invisible collision box always created
        const box = BABYLON.MeshBuilder.CreateBox(`col_${i}`,
          { width: w, height: h, depth: d }, this.scene);
        box.position.set(cx, h / 2, cz);
        box.isVisible = false;
        box.checkCollisions = true;
        this.obstacles.push({ mesh: box, min: obs.min, max: obs.max, height: h });
      });
    }

    // ── Road network ──────────────────────────────────────────────────────────
    if (al) {
      const roadOffsets = [
        { x: -20, z: 10 }, { x: -10, z: 10 }, { x: 0, z: 10 }, { x: 10, z: 10 }, { x: 20, z: 10 },
        { x: -20, z: -10 }, { x: -10, z: -10 }, { x: 0, z: -10 }, { x: 10, z: -10 }, { x: 20, z: -10 },
        // Cross roads
        { x: -10, z: 0, rot: Math.PI / 2 }, { x: 10, z: 0, rot: Math.PI / 2 }
      ];
      roadOffsets.forEach(r => {
        al.placeMapPiece('road_straight',
          new BABYLON.Vector3(r.x, 0.01, r.z), r.rot || 0);
      });
      // Road corners at intersections
      [[-10, 10], [10, 10], [-10, -10], [10, -10]].forEach(([x, z], i) => {
        al.placeMapPiece('road_corner',
          new BABYLON.Vector3(x, 0.01, z), (Math.PI / 2) * i);
      });
    }

    // ── Bomb sites & control points ───────────────────────────────────────────
    if (mapData.bombSites) {
      Object.entries(mapData.bombSites).forEach(([name, pos]) => {
        this.createZoneMarker(name, pos, new BABYLON.Color3(0.8, 0.2, 0.0));
        this._decorateBombSite(name, pos);   // [M2] extra dressing
      });
    }
    if (mapData.controlPoints) {
      Object.entries(mapData.controlPoints).forEach(([name, pos]) => {
        this.createZoneMarker(name, pos, new BABYLON.Color3(0.8, 0.8, 0.0));
      });
    }

    // ── General scatter props ─────────────────────────────────────────────────
    if (al) {
      this._scatterCityProps(mapData);
    }

    this._visualiseSpawnPoints();
  }

  // [M2] Decorate a bomb site with crates, benches, RPG props
  _decorateBombSite(name, pos) {
    const al = this.assetLoader;
    if (!al) return;

    // Async fire-and-forget
    const decorate = async () => {
      const offsets = [
        { dx: 0, dz: 0, prop: 'anvil', rpg: true },
        { dx: 2, dz: 1, prop: 'lantern', rpg: true },
        { dx: -2, dz: -1, prop: 'tool_wood_A', rpg: true },
        { dx: 3, dz: -2, prop: 'axe_1handed', rpg: true },
        { dx: -3, dz: 2, prop: 'bow_withString', rpg: true }
      ];

      for (const o of offsets) {
        try {
          if (o.rpg) {
            await al.placeRPGProp(o.prop, {
              x: pos.x + o.dx, y: 0, z: pos.z + o.dz
            });
          }
        } catch (_) { /* ignore missing props */ }
      }

      // Also place some crates using city builder
      const crateProps = ['box_A', 'box_B', 'box_A'];
      for (let i = 0; i < crateProps.length; i++) {
        const mesh = al.getCityProp
          ? al.getCityProp(crateProps[i], {
            x: pos.x + (i - 1) * 1.5,
            y: 0,
            z: pos.z + 2.5
          }, Math.random() * Math.PI)
          : await al.placeMapPiece(crateProps[i], new BABYLON.Vector3(
            pos.x + (i - 1) * 1.5, 0, pos.z + 2.5
          ));
        if (mesh && this.shadowGenerator) this.shadowGenerator.addShadowCaster(mesh);
      }

      // Bench near the site
      const bench = al.getCityProp
        ? al.getCityProp('bench', { x: pos.x + 4, y: 0, z: pos.z }, Math.PI / 2)
        : await al.placeMapPiece('bench', new BABYLON.Vector3(pos.x + 4, 0, pos.z), Math.PI / 2);
      if (bench && this.shadowGenerator) this.shadowGenerator.addShadowCaster(bench);
    };

    decorate().catch(() => { });
  }

  // [M2] Scatter benches, boxes, crates around the map
  _scatterCityProps(mapData) {
    const al = this.assetLoader;
    const scatterPoints = [
      { x: -18, z: 0, prop: 'bench', rot: Math.PI / 2 },
      { x: 18, z: 0, prop: 'bench', rot: -Math.PI / 2 },
      { x: 0, z: -18, prop: 'bench', rot: 0 },
      { x: 0, z: 18, prop: 'bench', rot: Math.PI },
      { x: -5, z: -5, prop: 'box_A', rot: 0.4 },
      { x: 5, z: -5, prop: 'box_A', rot: -0.3 },
      { x: -5, z: 5, prop: 'box_B', rot: 0.2 },
      { x: 5, z: 5, prop: 'box_B', rot: -0.2 },
      { x: -12, z: -12, prop: 'box_A', rot: 0.8 },
      { x: 12, z: 12, prop: 'box_A', rot: -0.5 },
      { x: -12, z: 12, prop: 'box_B', rot: 1.0 },
      { x: 12, z: -12, prop: 'box_B', rot: 0.7 }
    ];

    scatterPoints.forEach(sp => {
      const mesh = al.getCityProp
        ? al.getCityProp(sp.prop, { x: sp.x, y: 0, z: sp.z }, sp.rot)
        : null;
      if (mesh) {
        if (this.shadowGenerator) this.shadowGenerator.addShadowCaster(mesh);
      } else {
        // Async fallback
        al.placeMapPiece(sp.prop, new BABYLON.Vector3(sp.x, 0, sp.z), sp.rot)
          .then(m => {
            if (m && this.shadowGenerator) this.shadowGenerator.addShadowCaster(m);
          }).catch(() => { });
      }
    });

    // Watertower on one corner
    al.placeMapPiece('watertower', new BABYLON.Vector3(-22, 0, -22), 0)
      .then(m => { if (m && this.shadowGenerator) this.shadowGenerator.addShadowCaster(m); })
      .catch(() => { });

    // Arrow decorations (RPG props) near alleyways
    const arrowSpots = [
      { x: -15, z: 5 }, { x: 15, z: -5 }, { x: -5, z: 15 }, { x: 5, z: -15 }
    ];
    arrowSpots.forEach(pt => {
      al.placeRPGProp('arrow_bow', { x: pt.x, y: 0, z: pt.z }, Math.random() * Math.PI)
        .catch(() => { });
    });
  }

  // ─── Height → building-type helper ───────────────────────────────────────────

  _buildingTypeForHeight(h) {
    if (h >= 15) return 'building_G';
    if (h >= 12) return 'building_D';
    if (h >= 10) return 'building_C';
    if (h >= 8) return 'building_B';
    if (h >= 6) return 'building_E';
    if (h >= 4) return 'building_A';
    return null; // very short — leave to caller
  }

  // ─── Flat-map helpers ─────────────────────────────────────────────────────────

  createGround(mapData) {
    const size = mapData.size || { x: 60, z: 60 };
    const ground = BABYLON.MeshBuilder.CreateGround('ground',
      { width: size.x, height: size.z, subdivisions: 4 }, this.scene);
    const mat = new BABYLON.StandardMaterial('groundMat', this.scene);
    mat.diffuseColor = new BABYLON.Color3(0.18, 0.20, 0.22);
    mat.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);
    ground.material = mat;
    ground.receiveShadows = true;
    ground.checkCollisions = true;
    this.meshes.push(ground);

    // Grid lines
    const gridMat = new BABYLON.StandardMaterial('gridMat', this.scene);
    gridMat.diffuseColor = new BABYLON.Color3(0.22, 0.24, 0.26);
    gridMat.specularColor = BABYLON.Color3.Black();
    gridMat.alpha = 0.3;

    for (let i = -size.x / 2; i <= size.x / 2; i += 5) {
      const line = BABYLON.MeshBuilder.CreateBox(`gx_${i}`,
        { width: 0.03, height: 0.01, depth: size.z }, this.scene);
      line.position.x = i; line.position.y = 0.01; line.material = gridMat;
    }
    for (let i = -size.z / 2; i <= size.z / 2; i += 5) {
      const line = BABYLON.MeshBuilder.CreateBox(`gz_${i}`,
        { width: size.x, height: 0.01, depth: 0.03 }, this.scene);
      line.position.z = i; line.position.y = 0.01; line.material = gridMat;
    }
  }

  createWalls(mapData) {
    const size = mapData.size || { x: 60, z: 60 };
    const wallH = 6, wallT = 0.5;
    const wallMat = new BABYLON.StandardMaterial('wallMat', this.scene);
    wallMat.diffuseColor = new BABYLON.Color3(0.12, 0.14, 0.18);
    wallMat.specularColor = new BABYLON.Color3(0.02, 0.02, 0.02);

    [
      { w: size.x + wallT, d: wallT, px: 0, pz: -size.z / 2 },
      { w: size.x + wallT, d: wallT, px: 0, pz: size.z / 2 },
      { w: wallT, d: size.z + wallT, px: -size.x / 2, pz: 0 },
      { w: wallT, d: size.z + wallT, px: size.x / 2, pz: 0 }
    ].forEach((wd, i) => {
      const wall = BABYLON.MeshBuilder.CreateBox(`wall_${i}`,
        { width: wd.w, height: wallH, depth: wd.d }, this.scene);
      wall.position.set(wd.px, wallH / 2, wd.pz);
      wall.material = wallMat;
      wall.checkCollisions = true;
      wall.receiveShadows = true;
      this.meshes.push(wall);
    });
  }

  // [M3] createObstacles – uses preloaded city props via getCityProp fast-path
  createObstacles(mapData) {
    if (!mapData.obstacles) return;

    const fallbackColors = [
      new BABYLON.Color3(0.25, 0.15, 0.1),
      new BABYLON.Color3(0.15, 0.2, 0.15),
      new BABYLON.Color3(0.2, 0.18, 0.12),
      new BABYLON.Color3(0.12, 0.12, 0.18)
    ];

    mapData.obstacles.forEach((obs, i) => {
      const w = obs.max.x - obs.min.x;
      const d = obs.max.z - obs.min.z;
      const h = obs.height || 3;
      const cx = (obs.min.x + obs.max.x) / 2;
      const cz = (obs.min.z + obs.max.z) / 2;

      if (this.assetLoader) {
        const buildingType = obs.type || this._buildingTypeForHeight(h);

        if (buildingType) {
          // Try synchronous fast-path first
          const mesh = this.assetLoader.getCityProp
            ? this.assetLoader.getCityProp(buildingType, { x: cx, y: 0, z: cz })
            : null;

          if (mesh) {
            if (!buildingType.startsWith('car_') && buildingType !== 'watertower') {
              mesh.rotation.y = (Math.PI / 2) * (i % 4);
            }
            this.addShadowCaster(mesh);
          } else {
            // Async fallback
            this.assetLoader.placeMapPiece(buildingType, new BABYLON.Vector3(cx, 0, cz))
              .then(m => {
                if (!m) return;
                if (!buildingType.startsWith('car_') && buildingType !== 'watertower') {
                  m.rotation.y = (Math.PI / 2) * (i % 4);
                }
                this.addShadowCaster(m);
              }).catch(() => { });
          }
        }

        // Invisible collision box
        const box = BABYLON.MeshBuilder.CreateBox(`col_${i}`,
          { width: w, height: h, depth: d }, this.scene);
        box.position.set(cx, h / 2, cz);
        box.isVisible = false;
        box.checkCollisions = true;
        this.obstacles.push({ mesh: box, min: obs.min, max: obs.max, height: h });

      } else {
        // Pure fallback — coloured block
        const box = BABYLON.MeshBuilder.CreateBox(`obstacle_${i}`,
          { width: w, height: h, depth: d }, this.scene);
        box.position.set(cx, h / 2, cz);
        const mat = new BABYLON.StandardMaterial(`obsMat_${i}`, this.scene);
        mat.diffuseColor = fallbackColors[i % fallbackColors.length];
        mat.specularColor = new BABYLON.Color3(0.03, 0.03, 0.03);
        box.material = mat;
        box.checkCollisions = true;
        box.receiveShadows = true;
        this.meshes.push(box);
        this.obstacles.push({ mesh: box, min: obs.min, max: obs.max, height: h });
      }
    });

    if (mapData.controlPoints) {
      Object.entries(mapData.controlPoints).forEach(([name, pos]) => {
        this.createZoneMarker(name, pos, new BABYLON.Color3(0.8, 0.8, 0.0));
      });
    }
    if (mapData.bombSites) {
      Object.entries(mapData.bombSites).forEach(([name, pos]) => {
        this.createZoneMarker(name, pos, new BABYLON.Color3(0.8, 0.2, 0.0));
      });
    }
  }

  createZoneMarker(name, pos, color) {
    const disc = BABYLON.MeshBuilder.CreateDisc(`zone_${name}`,
      { radius: 3, tessellation: 32 }, this.scene);
    disc.position.set(pos.x, 0.05, pos.z);
    disc.rotation.x = Math.PI / 2;
    const mat = new BABYLON.StandardMaterial(`zoneMat_${name}`, this.scene);
    mat.diffuseColor = color;
    mat.emissiveColor = color.scale(0.3);
    mat.alpha = 0.45;
    disc.material = mat;
  }

  // [M4] createDetails – uses city props where possible ─────────────────────────

  createDetails(mapData) {
    const al = this.assetLoader;

    // Barrel clusters (procedural fallback looks fine)
    const barrelMat = new BABYLON.StandardMaterial('barrelMat', this.scene);
    barrelMat.diffuseColor = new BABYLON.Color3(0.15, 0.3, 0.15);

    [[-8, 12], [8, -12], [-18, -8], [18, 8], [0, 20], [0, -20]].forEach(([x, z], i) => {
      const b = BABYLON.MeshBuilder.CreateCylinder(`barrel_${i}`,
        { height: 1.2, diameter: 0.7, tessellation: 12 }, this.scene);
      b.position.set(x, 0.6, z);
      b.material = barrelMat;
      b.receiveShadows = true;
      this.addShadowCaster(b);
    });

    if (al) {
      // [M4] Place actual city benches along the walls
      const benchSpots = [
        { x: -20, z: 5, rot: Math.PI / 2 }, { x: 20, z: -5, rot: -Math.PI / 2 },
        { x: 5, z: 20, rot: Math.PI }, { x: -5, z: -20, rot: 0 }
      ];
      benchSpots.forEach(bs => {
        const mesh = al.getCityProp
          ? al.getCityProp('bench', { x: bs.x, y: 0, z: bs.z }, bs.rot)
          : null;
        if (mesh) {
          this.addShadowCaster(mesh);
        } else {
          al.placeMapPiece('bench', new BABYLON.Vector3(bs.x, 0, bs.z), bs.rot)
            .then(m => { if (m) this.addShadowCaster(m); }).catch(() => { });
        }
      });

      // [M4] Place box crates instead of plain cubes
      const boxSpots = [
        { x: -12, z: -18, prop: 'box_A' }, { x: 14, z: 18, prop: 'box_B' },
        { x: -22, z: 12, prop: 'box_A' }, { x: 22, z: -12, prop: 'box_B' }
      ];
      boxSpots.forEach((bs, i) => {
        const mesh = al.getCityProp
          ? al.getCityProp(bs.prop, { x: bs.x, y: 0, z: bs.z }, Math.random() * 0.5)
          : null;
        if (mesh) {
          this.addShadowCaster(mesh);
        } else {
          al.placeMapPiece(bs.prop, new BABYLON.Vector3(bs.x, 0, bs.z))
            .then(m => { if (m) this.addShadowCaster(m); }).catch(() => { });
        }
      });

      // [M4] RPG props as environmental atmosphere
      const rpgSpots = [
        { x: -8, z: -8, prop: 'lantern' },
        { x: 8, z: 8, prop: 'lantern' },
        { x: -8, z: 8, prop: 'anvil' },
        { x: 8, z: -8, prop: 'anvil' },
        { x: 0, z: 8, prop: 'axe_1handed' },
        { x: 0, z: -8, prop: 'axe_2handed' }
      ];
      rpgSpots.forEach(rs => {
        al.placeRPGProp(rs.prop, { x: rs.x, y: 0, z: rs.z }, Math.random() * Math.PI)
          .catch(() => { });
      });

    } else {
      // Pure procedural crates fallback
      const crateMat = new BABYLON.StandardMaterial('crateMat', this.scene);
      crateMat.diffuseColor = new BABYLON.Color3(0.35, 0.25, 0.15);
      [[-12, -18], [14, 18], [-22, 12], [22, -12]].forEach(([x, z], i) => {
        for (let s = 0; s < 2; s++) {
          const crate = BABYLON.MeshBuilder.CreateBox(`crate_${i}_${s}`, { size: 1.2 }, this.scene);
          crate.position.set(x + s * 0.3, 0.6 + s * 1.2, z);
          crate.rotation.y = Math.random() * 0.3;
          crate.material = crateMat;
          crate.receiveShadows = true;
          this.addShadowCaster(crate);
        }
      });
    }

    this._visualiseSpawnPoints();
  }

  // ─── Lighting ─────────────────────────────────────────────────────────────────

  createLighting() {
    const hemi = new BABYLON.HemisphericLight('hemi', new BABYLON.Vector3(0, 1, 0), this.scene);
    hemi.intensity = 0.4;
    hemi.diffuse = new BABYLON.Color3(0.6, 0.65, 0.75);
    hemi.groundColor = new BABYLON.Color3(0.15, 0.12, 0.1);

    const dir = new BABYLON.DirectionalLight('sun', new BABYLON.Vector3(-0.5, -1, 0.5), this.scene);
    dir.position = new BABYLON.Vector3(20, 40, -20);
    dir.intensity = 0.8;
    dir.diffuse = new BABYLON.Color3(1.0, 0.95, 0.85);

    // [M5] Shadow generator stored on this so assetLoader placements can add casters
    this.shadowGenerator = new BABYLON.ShadowGenerator(1024, dir);
    this.shadowGenerator.useBlurExponentialShadowMap = true;
    this.shadowGenerator.blurKernel = 16;
    this.shadowGenerator.darkness = 0.3;

    // Accent point lights
    [
      { pos: [-15, 4, -15], color: [0.2, 0.4, 0.8] },
      { pos: [15, 4, 15], color: [0.8, 0.3, 0.1] },
      { pos: [0, 5, 0], color: [0.3, 0.6, 0.3] }
    ].forEach((a, i) => {
      const pl = new BABYLON.PointLight(`accent_${i}`, new BABYLON.Vector3(...a.pos), this.scene);
      pl.diffuse = new BABYLON.Color3(...a.color);
      pl.intensity = 0.5;
      pl.range = 20;
    });
  }

  // ─── Skybox ───────────────────────────────────────────────────────────────────

  createSkybox() {
    const skybox = BABYLON.MeshBuilder.CreateBox('skyBox', { size: 500 }, this.scene);
    const skyMat = new BABYLON.StandardMaterial('skyMat', this.scene);
    skyMat.backFaceCulling = false;
    skyMat.disableLighting = true;
    skyMat.diffuseColor = BABYLON.Color3.Black();
    skyMat.specularColor = BABYLON.Color3.Black();
    skyMat.emissiveColor = new BABYLON.Color3(0.02, 0.03, 0.06);
    skybox.material = skyMat;
    skybox.infiniteDistance = true;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  addShadowCaster(mesh) {
    if (!this.shadowGenerator || !mesh) return;
    if (mesh.getChildMeshes) {
      mesh.getChildMeshes().forEach(m => this.shadowGenerator.addShadowCaster(m));
    } else {
      this.shadowGenerator.addShadowCaster(mesh);
    }
  }

  // [M6] dispose
  dispose() {
    this.meshes.forEach(m => { if (!m.isDisposed()) m.dispose(); });
    this.obstacles.forEach(o => { if (o.mesh && !o.mesh.isDisposed()) o.mesh.dispose(); });
    this.meshes = [];
    this.obstacles = [];
  }
}