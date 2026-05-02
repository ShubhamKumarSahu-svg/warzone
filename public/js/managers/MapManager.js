/**
 * MapManager - Builds the 3D environment using Babylon.js
 */
class MapManager {
  constructor(scene) {
    this.scene = scene;
    this.meshes = [];
    this.obstacles = [];
  }

  buildMap(mapData, assetLoader) {
    this.assetLoader = assetLoader;
    if (mapData.theme === 'downtown') {
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

  buildCityMap(mapData) {
    if (!this.assetLoader) return;

    // Ground plane
    const size = mapData.size || { x: 70, z: 70 };
    const ground = BABYLON.MeshBuilder.CreateGround('cityGround', { width: size.x, height: size.z, subdivisions: 2 }, this.scene);
    const mat = new BABYLON.StandardMaterial('groundMat', this.scene);
    mat.diffuseColor = new BABYLON.Color3(0.12, 0.12, 0.12);
    mat.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);
    ground.material = mat;
    ground.receiveShadows = true;
    ground.checkCollisions = true;
    this.meshes.push(ground);

    // Place buildings using obstacles data
    if (mapData.obstacles) {
      mapData.obstacles.forEach((obs, i) => {
        const cx = (obs.min.x + obs.max.x) / 2;
        const cz = (obs.min.z + obs.max.z) / 2;
        
        let buildingType = obs.type;
        if (!buildingType) {
          if (obs.height >= 15) buildingType = 'building_G'; // Tall corner
          else if (obs.height >= 12) buildingType = 'building_D'; // A-site
          else if (obs.height >= 10) buildingType = 'building_C';
          else if (obs.height >= 8) buildingType = 'building_B';
          else if (obs.height >= 6) buildingType = 'building_E';
          else buildingType = null; // No default building for small heights unless specified
        }

        if (buildingType) {
          this.assetLoader.placeMapPiece(buildingType, new BABYLON.Vector3(cx, 0, cz)).then(mesh => {
            if (mesh) {
              // Rotate randomly unless it's a specific type of prop
              if (!buildingType.includes('car_') && !buildingType.includes('watertower')) {
                mesh.rotation.y = (Math.PI / 2) * (i % 4);
              }
              this.addShadowCaster(mesh);
            }
          });
        } else if (obs.height < 5 && !obs.type) {
          // Fallback legacy behavior for gridlock center
          this.assetLoader.placeMapPiece('car_police', new BABYLON.Vector3(cx - 2, 0, cz)).then(car => {
            if (car) { car.rotation.y = Math.PI / 4; this.addShadowCaster(car); }
          });
          this.assetLoader.placeMapPiece('car_taxi', new BABYLON.Vector3(cx + 2, 0, cz)).then(taxi => {
            if (taxi) { taxi.rotation.y = -Math.PI / 6; this.addShadowCaster(taxi); }
          });
        }

        // Invisible collision box
        const w = obs.max.x - obs.min.x;
        const d = obs.max.z - obs.min.z;
        const box = BABYLON.MeshBuilder.CreateBox('col_' + i, { width: w, height: obs.height, depth: d }, this.scene);
        box.position.set(cx, obs.height / 2, cz);
        box.isVisible = false;
        box.checkCollisions = true;
      });
    }

    // Place RPG Props at Bomb Site B
    if (mapData.bombSites && mapData.bombSites.B) {
      const pos = mapData.bombSites.B;
      this.assetLoader.placeRPGProp('anvil', new BABYLON.Vector3(pos.x, 0, pos.z));
      this.assetLoader.placeRPGProp('lantern', new BABYLON.Vector3(pos.x + 2, 0, pos.z + 1));
      this.assetLoader.placeRPGProp('tool_wood_A', new BABYLON.Vector3(pos.x - 2, 0, pos.z - 1));
    }

    // Place Roads
    for (let x = -20; x <= 20; x += 10) {
      this.assetLoader.placeMapPiece('road_straight', new BABYLON.Vector3(x, 0, 10));
      this.assetLoader.placeMapPiece('road_straight', new BABYLON.Vector3(x, 0, -10));
    }

    // Create markers
    if (mapData.bombSites) {
      Object.entries(mapData.bombSites).forEach(([name, pos]) => {
        this.createZoneMarker(name, pos, new BABYLON.Color3(0.8, 0.2, 0.0));
      });
    }
  }

  createGround(mapData) {
    const size = mapData.size || { x: 60, z: 60 };
    const ground = BABYLON.MeshBuilder.CreateGround('ground', { width: size.x, height: size.z, subdivisions: 2 }, this.scene);
    const mat = new BABYLON.StandardMaterial('groundMat', this.scene);
    mat.diffuseColor = new BABYLON.Color3(0.18, 0.2, 0.22);
    mat.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);
    ground.material = mat;
    ground.receiveShadows = true;
    ground.checkCollisions = true;
    this.meshes.push(ground);

    // Grid lines on ground
    const gridMat = new BABYLON.StandardMaterial('gridMat', this.scene);
    gridMat.diffuseColor = new BABYLON.Color3(0.22, 0.24, 0.26);
    gridMat.specularColor = BABYLON.Color3.Black();
    gridMat.alpha = 0.3;

    for (let i = -size.x / 2; i <= size.x / 2; i += 5) {
      const line = BABYLON.MeshBuilder.CreateBox('gridX_' + i, { width: 0.03, height: 0.01, depth: size.z }, this.scene);
      line.position.x = i; line.position.y = 0.01;
      line.material = gridMat;
    }
    for (let i = -size.z / 2; i <= size.z / 2; i += 5) {
      const line = BABYLON.MeshBuilder.CreateBox('gridZ_' + i, { width: size.x, height: 0.01, depth: 0.03 }, this.scene);
      line.position.z = i; line.position.y = 0.01;
      line.material = gridMat;
    }
  }

  createWalls(mapData) {
    const size = mapData.size || { x: 60, z: 60 };
    const wallH = 6, wallT = 0.5;
    const wallMat = new BABYLON.StandardMaterial('wallMat', this.scene);
    wallMat.diffuseColor = new BABYLON.Color3(0.12, 0.14, 0.18);
    wallMat.specularColor = new BABYLON.Color3(0.02, 0.02, 0.02);

    const wallData = [
      { w: size.x + wallT, d: wallT, px: 0, pz: -size.z / 2 },
      { w: size.x + wallT, d: wallT, px: 0, pz: size.z / 2 },
      { w: wallT, d: size.z + wallT, px: -size.x / 2, pz: 0 },
      { w: wallT, d: size.z + wallT, px: size.x / 2, pz: 0 }
    ];

    wallData.forEach((wd, i) => {
      const wall = BABYLON.MeshBuilder.CreateBox('wall_' + i, { width: wd.w, height: wallH, depth: wd.d }, this.scene);
      wall.position.set(wd.px, wallH / 2, wd.pz);
      wall.material = wallMat;
      wall.checkCollisions = true;
      wall.receiveShadows = true;
      this.meshes.push(wall);
    });
  }

  createObstacles(mapData) {
    if (!mapData.obstacles) return;
    const colors = [
      new BABYLON.Color3(0.25, 0.15, 0.1),
      new BABYLON.Color3(0.15, 0.2, 0.15),
      new BABYLON.Color3(0.2, 0.18, 0.12),
      new BABYLON.Color3(0.12, 0.12, 0.18),
    ];

    mapData.obstacles.forEach((obs, i) => {
      const w = obs.max.x - obs.min.x;
      const d = obs.max.z - obs.min.z;
      const h = obs.height || 3;
      const cx = (obs.min.x + obs.max.x) / 2;
      const cz = (obs.min.z + obs.max.z) / 2;

      // Place City Builder asset if AssetLoader is available
      if (this.assetLoader) {
        let buildingType = obs.type;
        if (!buildingType) {
          if (h >= 15) buildingType = 'building_G';
          else if (h >= 10) buildingType = 'building_D';
          else if (h >= 8) buildingType = 'building_C';
          else if (h >= 6) buildingType = 'building_B';
          else buildingType = 'building_E';
        }

        this.assetLoader.placeMapPiece(buildingType, new BABYLON.Vector3(cx, 0, cz)).then(mesh => {
          if (mesh) {
            if (!buildingType.includes('car_') && !buildingType.includes('watertower')) {
              mesh.rotation.y = (Math.PI / 2) * (i % 4);
            }
            this.addShadowCaster(mesh);
          }
        });

        // Invisible collision box
        const box = BABYLON.MeshBuilder.CreateBox('col_' + i, { width: w, height: h, depth: d }, this.scene);
        box.position.set(cx, h / 2, cz);
        box.isVisible = false;
        box.checkCollisions = true;
        this.obstacles.push({ mesh: box, min: obs.min, max: obs.max, height: h });
      } else {
        // Fallback to block
        const box = BABYLON.MeshBuilder.CreateBox('obstacle_' + i, { width: w, height: h, depth: d }, this.scene);
        box.position.set(cx, h / 2, cz);
        const mat = new BABYLON.StandardMaterial('obsMat_' + i, this.scene);
        mat.diffuseColor = colors[i % colors.length];
        mat.specularColor = new BABYLON.Color3(0.03, 0.03, 0.03);
        box.material = mat;
        box.checkCollisions = true;
        box.receiveShadows = true;
        this.meshes.push(box);
        this.obstacles.push({ mesh: box, min: obs.min, max: obs.max, height: h });
      }
    });

    // Control points / bomb sites visual markers
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
    const disc = BABYLON.MeshBuilder.CreateDisc('zone_' + name, { radius: 3, tessellation: 32 }, this.scene);
    disc.position.set(pos.x, 0.05, pos.z);
    disc.rotation.x = Math.PI / 2;
    const mat = new BABYLON.StandardMaterial('zoneMat_' + name, this.scene);
    mat.diffuseColor = color;
    mat.emissiveColor = color.scale(0.3);
    mat.alpha = 0.4;
    disc.material = mat;
  }

  createLighting() {
    // Hemisphere (ambient)
    const hemi = new BABYLON.HemisphericLight('hemiLight', new BABYLON.Vector3(0, 1, 0), this.scene);
    hemi.intensity = 0.4;
    hemi.diffuse = new BABYLON.Color3(0.6, 0.65, 0.75);
    hemi.groundColor = new BABYLON.Color3(0.15, 0.12, 0.1);

    // Directional (sun) with shadows
    const dir = new BABYLON.DirectionalLight('dirLight', new BABYLON.Vector3(-0.5, -1, 0.5), this.scene);
    dir.position = new BABYLON.Vector3(20, 40, -20);
    dir.intensity = 0.8;
    dir.diffuse = new BABYLON.Color3(1.0, 0.95, 0.85);

    const shadowGen = new BABYLON.ShadowGenerator(1024, dir);
    shadowGen.useBlurExponentialShadowMap = true;
    shadowGen.blurKernel = 16;
    shadowGen.darkness = 0.3;
    this.shadowGenerator = shadowGen;

    // Accent point lights
    const accents = [
      { pos: [-15, 4, -15], color: [0.2, 0.4, 0.8] },
      { pos: [15, 4, 15], color: [0.8, 0.3, 0.1] },
      { pos: [0, 5, 0], color: [0.3, 0.6, 0.3] }
    ];
    accents.forEach((a, i) => {
      const pl = new BABYLON.PointLight('accent_' + i, new BABYLON.Vector3(...a.pos), this.scene);
      pl.diffuse = new BABYLON.Color3(...a.color);
      pl.intensity = 0.5;
      pl.range = 20;
    });
  }

  createSkybox() {
    const skybox = BABYLON.MeshBuilder.CreateBox('skyBox', { size: 500 }, this.scene);
    const skyMat = new BABYLON.StandardMaterial('skyMat', this.scene);
    skyMat.backFaceCulling = false;
    skyMat.disableLighting = true;
    skyMat.diffuseColor = new BABYLON.Color3(0, 0, 0);
    skyMat.specularColor = new BABYLON.Color3(0, 0, 0);
    skyMat.emissiveColor = new BABYLON.Color3(0.02, 0.03, 0.06);
    skybox.material = skyMat;
    skybox.infiniteDistance = true;
  }

  createDetails(mapData) {
    // Barrel clusters
    const barrelMat = new BABYLON.StandardMaterial('barrelMat', this.scene);
    barrelMat.diffuseColor = new BABYLON.Color3(0.15, 0.3, 0.15);
    const barrelPositions = [
      [-8, 12], [8, -12], [-18, -8], [18, 8], [0, 20], [0, -20]
    ];
    barrelPositions.forEach(([x, z], i) => {
      const barrel = BABYLON.MeshBuilder.CreateCylinder('barrel_' + i, { height: 1.2, diameter: 0.7, tessellation: 12 }, this.scene);
      barrel.position.set(x, 0.6, z);
      barrel.material = barrelMat;
      barrel.receiveShadows = true;
      if (this.shadowGenerator) this.shadowGenerator.addShadowCaster(barrel);
    });

    // Crate stacks
    const crateMat = new BABYLON.StandardMaterial('crateMat', this.scene);
    crateMat.diffuseColor = new BABYLON.Color3(0.35, 0.25, 0.15);
    const cratePositions = [[-12, -18], [14, 18], [-22, 12], [22, -12]];
    cratePositions.forEach(([x, z], i) => {
      for (let s = 0; s < 2; s++) {
        const crate = BABYLON.MeshBuilder.CreateBox('crate_' + i + '_' + s, { size: 1.2 }, this.scene);
        crate.position.set(x + (s * 0.3), 0.6 + s * 1.2, z);
        crate.rotation.y = Math.random() * 0.3;
        crate.material = crateMat;
        crate.receiveShadows = true;
        if (this.shadowGenerator) this.shadowGenerator.addShadowCaster(crate);
      }
    });
  }

  addShadowCaster(mesh) {
    if (this.shadowGenerator) this.shadowGenerator.addShadowCaster(mesh);
  }

  dispose() {
    this.meshes.forEach(m => m.dispose());
    this.meshes = [];
    this.obstacles = [];
  }
}
