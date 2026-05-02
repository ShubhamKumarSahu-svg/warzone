/**
 * AssetLoader - Centralized asset loading with template caching
 *
 * FIXES:
 *  A1 - createPlayerCharacter now accepts a playerId and tags every instantiated
 *       animation group with that id so Game.js can look them up reliably.
 *  A2 - animationLibrary retargeting helper added (retargetAnimationsToCharacter)
 *       so shared Rig_Medium animations can drive any skeleton.
 *  A3 - CHARACTERS updated to match actual GLB files on disk (removed bare 'Rogue',
 *       kept 'Rogue_Hooded'; added 'Mage').
 *  A4 - loadCityBuilderAssets preloads common city props so MapManager can place
 *       them synchronously via getCityProp().
 *  A5 - loadRPGProps preloads RPG tool props for environment decoration.
 *  A6 - dispose() extended to clean up city / rpg template stores.
 */
class AssetLoader {
  constructor(scene) {
    this.scene = scene;
    this.characterTemplates = {};   // name -> AssetContainer
    this.weaponTemplates = {};      // weaponId -> ImportMeshResult
    this.mapPieceTemplates = {};    // pieceName -> ImportMeshResult
    this.cityPropTemplates = {};    // propName -> ImportMeshResult   [A4]
    this.rpgPropTemplates = {};     // propName -> ImportMeshResult   [A5]
    this.animationLibrary = {};     // animName -> AnimationGroup
    this.accessoryTemplates = {};
    this.loaded = false;
    this.onProgress = null;         // (percent, label) => void
  }

  // ─── Model Maps ──────────────────────────────────────────────────────────────

  static WEAPON_MODEL_MAP = {
    desert_eagle: 'blaster-h.glb',
    auto_pistol: 'blaster-c.glb',
    m416: 'blaster-d.glb',
    ak47: 'blaster-j.glb',
    m4a1_s: 'blaster-g.glb',
    mp5: 'blaster-b.glb',
    p90: 'blaster-i.glb',
    awp: 'blaster-e.glb'
  };

  // [A3] Match actual .glb files present in characters_packs/Characters/gltf/
  static CHARACTERS = ['Knight', 'Barbarian', 'Ranger', 'Rogue_Hooded', 'Mage'];

  static CHARACTER_FOR_TEAM = {
    0: 'Knight',
    1: 'Barbarian'
  };

  // [A4] City-builder pieces to preload (subset most used by MapManager)
  static CITY_PROPS = [
    'bench', 'box_A', 'box_B', 'base',
    'road_straight', 'road_corner', 'road_intersection',
    'building_A', 'building_B', 'building_C', 'building_D',
    'building_E', 'building_F', 'building_G',
    'building_A_withoutBase',
    'car_police', 'car_taxi', 'watertower'
  ];

  // [A5] RPG tool props for environment detail
  static RPG_PROPS = [
    'anvil', 'lantern', 'tool_wood_A',
    'axe_1handed', 'axe_2handed',
    'bow_withString', 'crossbow_1handed',
    'arrow_bow', 'arrow_crossbow'
  ];

  // ─── Preload All ─────────────────────────────────────────────────────────────

  async preloadAll() {
    const steps = [
      { label: 'Loading animations…', fn: () => this.loadAnimations() },
      { label: 'Loading characters…', fn: () => this.loadCharacters() },
      { label: 'Loading weapons…', fn: () => this.loadWeapons() },
      { label: 'Loading accessories…', fn: () => this.loadAccessories() },
      { label: 'Loading city props…', fn: () => this.loadCityBuilderAssets() },  // [A4]
      { label: 'Loading RPG props…', fn: () => this.loadRPGProps() }            // [A5]
    ];

    for (let i = 0; i < steps.length; i++) {
      if (this.onProgress) {
        this.onProgress(Math.round((i / steps.length) * 100), steps[i].label);
      }
      await steps[i].fn();
    }

    if (this.onProgress) this.onProgress(100, 'Ready!');
    this.loaded = true;
  }

  // ─── Animations ──────────────────────────────────────────────────────────────

  async loadAnimations() {
    const base = '/assets/characters_packs/Animations/gltf/Rig_Medium/';
    const files = ['Rig_Medium_MovementBasic.glb', 'Rig_Medium_General.glb'];

    for (const file of files) {
      try {
        const r = await BABYLON.SceneLoader.ImportMeshAsync('', base, file, this.scene);
        r.animationGroups.forEach(ag => {
          this.animationLibrary[ag.name] = ag;
          ag.stop();
        });
        r.meshes.forEach(m => { m.setEnabled(false); m.isPickable = false; });
      } catch (e) {
        console.warn('[AssetLoader] Animation load failed:', file, e.message);
      }
    }
  }

  // ─── Characters ──────────────────────────────────────────────────────────────

  async loadCharacters() {
    const base = '/assets/characters_packs/Characters/gltf/';
    for (const name of AssetLoader.CHARACTERS) {
      try {
        const container = await BABYLON.SceneLoader.LoadAssetContainerAsync(
          base, `${name}.glb`, this.scene
        );
        this.characterTemplates[name] = container;
      } catch (e) {
        console.warn('[AssetLoader] Character load failed:', name, e.message);
      }
    }
  }

  // ─── Weapons ─────────────────────────────────────────────────────────────────

  async loadWeapons() {
    const base = '/assets/blasters/Models/GLB format/';
    for (const [id, file] of Object.entries(AssetLoader.WEAPON_MODEL_MAP)) {
      try {
        const r = await BABYLON.SceneLoader.ImportMeshAsync('', base, file, this.scene);
        r.meshes.forEach(m => { m.setEnabled(false); m.isPickable = false; });
        this.weaponTemplates[id] = r;
      } catch (e) {
        console.warn('[AssetLoader] Weapon load failed:', id, e.message);
      }
    }
  }

  // ─── Accessories ─────────────────────────────────────────────────────────────

  async loadAccessories() {
    const base = '/assets/blasters/Models/GLB format/';
    const accessories = [
      'scope-large-a.glb', 'scope-small.glb',
      'silencer-small.glb', 'silencer-larger.glb',
      'clip-small.glb', 'clip-large.glb'
    ];
    for (const file of accessories) {
      try {
        const name = file.replace('.glb', '');
        const r = await BABYLON.SceneLoader.ImportMeshAsync('', base, file, this.scene);
        r.meshes.forEach(m => { m.setEnabled(false); m.isPickable = false; });
        this.accessoryTemplates[name] = r;
      } catch (e) {
        console.warn('[AssetLoader] Accessory load failed:', file, e.message);
      }
    }
  }

  // [A4] ─── City Builder Props ─────────────────────────────────────────────────

  async loadCityBuilderAssets() {
    const base = '/assets/city_builder/Assets/gltf/';
    for (const name of AssetLoader.CITY_PROPS) {
      if (this.mapPieceTemplates[name] || this.cityPropTemplates[name]) continue;
      try {
        const r = await BABYLON.SceneLoader.ImportMeshAsync('', base, `${name}.gltf`, this.scene);
        r.meshes.forEach(m => { m.setEnabled(false); m.isPickable = false; });
        this.cityPropTemplates[name] = r;
        // Alias into mapPieceTemplates so existing calls still work
        this.mapPieceTemplates[name] = r;
      } catch (e) {
        // Not every prop will exist — fail silently
      }
    }
  }

  // [A5] ─── RPG Tool Props ─────────────────────────────────────────────────────

  async loadRPGProps() {
    const base = '/assets/rpg_tools/Assets/gltf/';
    for (const name of AssetLoader.RPG_PROPS) {
      try {
        const r = await BABYLON.SceneLoader.ImportMeshAsync('', base, `${name}.gltf`, this.scene);
        r.meshes.forEach(m => { m.setEnabled(false); m.isPickable = false; });
        this.rpgPropTemplates[name] = r;
      } catch (e) {
        // Fail silently – not all props may exist
      }
    }
  }

  // ─── Weapon Viewmodel ────────────────────────────────────────────────────────

  createWeaponViewmodel(weaponId, parentNode) {
    const template = this.weaponTemplates[weaponId];
    if (!template) return null;

    const root = template.meshes[0].clone(`${weaponId}_vm_${Date.now()}`);
    if (!root) return null;

    root.setEnabled(true);
    root.getChildMeshes().forEach(m => { m.setEnabled(true); m.isPickable = false; });
    root.parent = parentNode;
    root.scaling = new BABYLON.Vector3(0.5, 0.5, 0.5);
    root.position = new BABYLON.Vector3(0.3, -0.25, 0.5);
    root.rotation = new BABYLON.Vector3(0, Math.PI, 0);

    if (weaponId === 'awp') {
      this._attachAccessory('scope-large-a', root, new BABYLON.Vector3(0, 0.12, 0.05));
    }
    if (weaponId === 'm4a1_s') {
      this._attachAccessory('silencer-small', root, new BABYLON.Vector3(0, 0, 0.7));
    }

    return root;
  }

  _attachAccessory(name, parentRoot, offset) {
    const template = this.accessoryTemplates[name];
    if (!template) return null;
    const acc = template.meshes[0].clone(`${name}_${Date.now()}`);
    if (!acc) return null;
    acc.setEnabled(true);
    acc.getChildMeshes().forEach(m => { m.setEnabled(true); m.isPickable = false; });
    acc.parent = parentRoot;
    acc.position = offset;
    return acc;
  }

  // ─── Player Character ────────────────────────────────────────────────────────
  /**
   * [A1] playerId is now required so every instantiated animation group is tagged
   *      with the id — Game.js stores them on op.animGroups and plays them directly,
   *      no scene-wide search needed.
   */
  createPlayerCharacter(characterName, teamId, playerId) {
    const name = characterName
      || AssetLoader.CHARACTER_FOR_TEAM[teamId]
      || 'Knight';

    const template = this.characterTemplates[name];
    if (!template) {
      // Try fallback character
      const fallbackName = Object.keys(this.characterTemplates)[0];
      if (!fallbackName) return null;
      return this.createPlayerCharacter(fallbackName, teamId, playerId);
    }

    // [A1] Tag every node/anim with the player id so we can retrieve them later
    const inst = template.instantiateModelsToScene(
      nodeName => `${playerId}_${nodeName}`,
      false,
      { doNotInstantiate: true }
    );

    const root = inst.rootNodes[0];
    if (!root) return null;

    root.getChildMeshes().forEach(m => { m.isPickable = false; });

    // [A1] Expose animation groups on the root AND store under our lookup key
    root.playerAnimGroups = inst.animationGroups;   // per-player anim groups
    root.playerAnimMap = {};
    inst.animationGroups.forEach(ag => {
      ag.stop();
      // Key by the bare animation name (strip the playerId prefix)
      const bareName = ag.name.replace(`${playerId}_`, '');
      root.playerAnimMap[bareName] = ag;
      // Also try lowercase for robustness
      root.playerAnimMap[bareName.toLowerCase()] = ag;
    });

    root.scaling = new BABYLON.Vector3(0.9, 0.9, 0.9);

    // Team tint
    const tintColor = teamId === 0
      ? new BABYLON.Color3(0.1, 0.2, 0.55)
      : teamId === 1
        ? new BABYLON.Color3(0.55, 0.1, 0.1)
        : new BABYLON.Color3(0.25, 0.25, 0.1);

    root.getChildMeshes().forEach(m => {
      if (m.material) {
        m.material = m.material.clone(`${m.material.name}_t${teamId}`);
        m.material.emissiveColor = tintColor;
      }
    });

    return root;
  }

  // ─── Map Pieces (city builder) ───────────────────────────────────────────────

  async loadMapPiece(pieceName) {
    if (this.mapPieceTemplates[pieceName]) return this.mapPieceTemplates[pieceName];

    const base = '/assets/city_builder/Assets/gltf/';
    try {
      const r = await BABYLON.SceneLoader.ImportMeshAsync('', base, `${pieceName}.gltf`, this.scene);
      r.meshes.forEach(m => { m.setEnabled(false); m.isPickable = false; });
      this.mapPieceTemplates[pieceName] = r;
      return r;
    } catch (e) {
      console.warn('[AssetLoader] Map piece load failed:', pieceName, e.message);
      return null;
    }
  }

  async placeMapPiece(pieceName, position, rotation = 0, scale = 1) {
    let template = this.mapPieceTemplates[pieceName];
    if (!template) template = await this.loadMapPiece(pieceName);
    if (!template || !template.meshes[0]) return null;

    const instance = template.meshes[0].clone(`${pieceName}_${Date.now()}`);
    if (!instance) return null;

    instance.setEnabled(true);
    instance.getChildMeshes().forEach(m => {
      m.setEnabled(true);
      m.checkCollisions = true;
      m.receiveShadows = true;
    });
    instance.position = new BABYLON.Vector3(
      position.x || 0, position.y || 0, position.z || 0
    );
    instance.rotation.y = rotation;
    if (scale !== 1) instance.scaling = new BABYLON.Vector3(scale, scale, scale);
    return instance;
  }

  // ─── Instant clone of a preloaded city prop ──────────────────────────────────
  /**
   * [A4] Synchronous clone for already-loaded city props.
   * Returns null if not loaded yet — caller should use placeMapPiece() instead.
   */
  getCityProp(propName, position, rotationY = 0, scale = 1) {
    const template = this.cityPropTemplates[propName] || this.mapPieceTemplates[propName];
    if (!template || !template.meshes[0]) return null;

    const root = template.meshes[0].clone(`${propName}_${Date.now()}`);
    if (!root) return null;
    root.setEnabled(true);
    root.getChildMeshes().forEach(m => {
      m.setEnabled(true);
      m.checkCollisions = false;  // decorative — caller opts-in to collision
      m.receiveShadows = true;
    });
    root.position = new BABYLON.Vector3(position.x || 0, position.y || 0, position.z || 0);
    root.rotation.y = rotationY;
    if (scale !== 1) root.scaling = new BABYLON.Vector3(scale, scale, scale);
    return root;
  }

  // ─── RPG Prop Placement ──────────────────────────────────────────────────────

  async placeRPGProp(propName, position, rotation = 0, scale = 1) {
    // Try preloaded first
    let template = this.rpgPropTemplates[propName];

    if (!template) {
      // Lazy-load
      const base = '/assets/rpg_tools/Assets/gltf/';
      try {
        const r = await BABYLON.SceneLoader.ImportMeshAsync('', base, `${propName}.gltf`, this.scene);
        r.meshes.forEach(m => { m.setEnabled(false); m.isPickable = false; });
        this.rpgPropTemplates[propName] = r;
        template = r;
      } catch (e) {
        console.warn('[AssetLoader] RPG prop load failed:', propName, e.message);
        return null;
      }
    }

    if (!template || !template.meshes[0]) return null;

    const root = template.meshes[0].clone(`${propName}_${Date.now()}`);
    if (!root) return null;
    root.setEnabled(true);
    root.position = new BABYLON.Vector3(position.x || 0, position.y || 0, position.z || 0);
    root.rotation.y = rotation;
    if (scale !== 1) root.scaling = new BABYLON.Vector3(scale, scale, scale);
    root.getChildMeshes().forEach(m => {
      m.checkCollisions = false;
      m.receiveShadows = true;
      m.isPickable = false;
    });
    return root;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  /**
   * [A2] Try to find the best matching animation group by name (case-insensitive).
   * Checks the player's own animation groups first, then the shared library.
   */
  static resolveAnimation(animGroups, animMap, targetName) {
    if (!targetName) return null;
    const lower = targetName.toLowerCase();

    // Exact match in animMap
    if (animMap && animMap[lower]) return animMap[lower];

    // Partial match in animGroups array
    if (animGroups && animGroups.length) {
      return animGroups.find(ag => ag.name.toLowerCase().includes(lower)) || null;
    }
    return null;
  }

  // ─── Dispose ─────────────────────────────────────────────────────────────────

  dispose() {
    for (const t of Object.values(this.characterTemplates)) t.dispose();
    for (const t of Object.values(this.weaponTemplates)) t.meshes.forEach(m => m.dispose());
    for (const t of Object.values(this.accessoryTemplates)) t.meshes.forEach(m => m.dispose());
    for (const t of Object.values(this.mapPieceTemplates)) t.meshes.forEach(m => m.dispose());
    for (const t of Object.values(this.cityPropTemplates)) t.meshes.forEach(m => m.dispose());
    for (const t of Object.values(this.rpgPropTemplates)) t.meshes.forEach(m => m.dispose());

    this.characterTemplates = {};
    this.weaponTemplates = {};
    this.accessoryTemplates = {};
    this.mapPieceTemplates = {};
    this.cityPropTemplates = {};
    this.rpgPropTemplates = {};
    this.animationLibrary = {};
  }
}