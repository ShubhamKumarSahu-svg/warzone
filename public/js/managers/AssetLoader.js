/**
 * AssetLoader - Centralized asset loading with template caching
 * Handles GLB (blasters, characters) and GLTF+BIN (city builder, rpg tools)
 */
class AssetLoader {
  constructor(scene) {
    this.scene = scene;
    this.characterTemplates = {};   // name -> { meshes, animationGroups }
    this.weaponTemplates = {};      // weaponId -> { meshes }
    this.mapPieceTemplates = {};    // pieceName -> { meshes }
    this.animationLibrary = {};     // animName -> AnimationGroup
    this.accessoryTemplates = {};   // accessory name -> { meshes }
    this.loaded = false;
    this.onProgress = null;         // callback(percent, label)
  }

  // ─── Weapon Model Mapping ────────────────────────────
  static WEAPON_MODEL_MAP = {
    desert_eagle: 'blaster-h.glb',
    auto_pistol:  'blaster-c.glb',
    m416:         'blaster-d.glb',
    ak47:         'blaster-j.glb',
    m4a1_s:       'blaster-g.glb',
    mp5:          'blaster-b.glb',
    p90:          'blaster-i.glb',
    awp:          'blaster-e.glb'
  };

  // ─── Character List ──────────────────────────────────
  static CHARACTERS = ['Knight', 'Barbarian', 'Ranger', 'Rogue', 'Rogue_Hooded', 'Mage'];

  // ─── Class-to-character default mapping ──────────────
  static CHARACTER_FOR_TEAM = {
    0: 'Knight',    // Team Alpha default
    1: 'Barbarian'  // Team Bravo default
  };

  // ─── Preload All Assets ──────────────────────────────
  async preloadAll() {
    const steps = [
      { label: 'Loading animations...', fn: () => this.loadAnimations() },
      { label: 'Loading characters...', fn: () => this.loadCharacters() },
      { label: 'Loading weapons...',    fn: () => this.loadWeapons() },
      { label: 'Loading accessories...', fn: () => this.loadAccessories() }
    ];

    for (let i = 0; i < steps.length; i++) {
      if (this.onProgress) {
        this.onProgress(Math.round(((i) / steps.length) * 100), steps[i].label);
      }
      await steps[i].fn();
    }

    if (this.onProgress) this.onProgress(100, 'Ready!');
    this.loaded = true;
  }

  // ─── Animations ──────────────────────────────────────
  async loadAnimations() {
    const basePath = '/assets/characters_packs/Animations/gltf/Rig_Medium/';

    try {
      const moveResult = await BABYLON.SceneLoader.ImportMeshAsync('', basePath, 'Rig_Medium_MovementBasic.glb', this.scene);
      const generalResult = await BABYLON.SceneLoader.ImportMeshAsync('', basePath, 'Rig_Medium_General.glb', this.scene);

      // Store animation groups by name
      const allGroups = [...moveResult.animationGroups, ...generalResult.animationGroups];
      allGroups.forEach(ag => {
        this.animationLibrary[ag.name] = ag;
        ag.stop();
      });

      // Hide source meshes
      moveResult.meshes.forEach(m => { m.setEnabled(false); m.isPickable = false; });
      generalResult.meshes.forEach(m => { m.setEnabled(false); m.isPickable = false; });
    } catch (e) {
      console.warn('AssetLoader: Could not load animations, using fallback:', e.message);
    }
  }

  // ─── Characters ──────────────────────────────────────
  async loadCharacters() {
    const basePath = '/assets/characters_packs/Characters/gltf/';

    for (const name of AssetLoader.CHARACTERS) {
      try {
        const container = await BABYLON.SceneLoader.LoadAssetContainerAsync(basePath, `${name}.glb`, this.scene);
        this.characterTemplates[name] = container;
      } catch (e) {
        console.warn(`AssetLoader: Could not load character ${name}:`, e.message);
      }
    }
  }

  // ─── Weapons (Blasters) ──────────────────────────────
  async loadWeapons() {
    const basePath = '/assets/blasters/Models/GLB format/';

    for (const [weaponId, file] of Object.entries(AssetLoader.WEAPON_MODEL_MAP)) {
      try {
        const result = await BABYLON.SceneLoader.ImportMeshAsync('', basePath, file, this.scene);
        result.meshes.forEach(m => { m.setEnabled(false); m.isPickable = false; });
        this.weaponTemplates[weaponId] = result;
      } catch (e) {
        console.warn(`AssetLoader: Could not load weapon ${weaponId} (${file}):`, e.message);
      }
    }
  }

  // ─── Weapon Accessories ──────────────────────────────
  async loadAccessories() {
    const basePath = '/assets/blasters/Models/GLB format/';
    const accessories = ['scope-large-a.glb', 'scope-small.glb', 'silencer-small.glb', 'silencer-larger.glb', 'clip-small.glb', 'clip-large.glb'];

    for (const file of accessories) {
      try {
        const name = file.replace('.glb', '');
        const result = await BABYLON.SceneLoader.ImportMeshAsync('', basePath, file, this.scene);
        result.meshes.forEach(m => { m.setEnabled(false); m.isPickable = false; });
        this.accessoryTemplates[name] = result;
      } catch (e) {
        console.warn(`AssetLoader: Could not load accessory ${file}:`, e.message);
      }
    }
  }

  // ─── Instantiate a Weapon Viewmodel ──────────────────
  createWeaponViewmodel(weaponId, parentNode) {
    const template = this.weaponTemplates[weaponId];
    if (!template) return null;

    // Clone the root and all children
    const root = template.meshes[0].clone(weaponId + '_vm_' + Date.now());
    if (!root) return null;

    root.setEnabled(true);
    root.getChildMeshes().forEach(m => {
      m.setEnabled(true);
      m.isPickable = false;
    });

    // Parent to camera/weapon node
    root.parent = parentNode;
    root.scaling = new BABYLON.Vector3(0.5, 0.5, 0.5);
    root.position = new BABYLON.Vector3(0.3, -0.25, 0.5);
    root.rotation = new BABYLON.Vector3(0, Math.PI, 0);

    // Attach accessories based on weapon type
    if (weaponId === 'awp') {
      this._attachAccessory('scope-large-a', root, new BABYLON.Vector3(0, 0.12, 0.05));
    }
    if (weaponId === 'm4a1_s') {
      this._attachAccessory('silencer-small', root, new BABYLON.Vector3(0, 0, 0.7));
    }

    return root;
  }

  _attachAccessory(accessoryName, parentRoot, offset) {
    const template = this.accessoryTemplates[accessoryName];
    if (!template) return null;

    const acc = template.meshes[0].clone(accessoryName + '_' + Date.now());
    if (!acc) return null;
    acc.setEnabled(true);
    acc.getChildMeshes().forEach(m => { m.setEnabled(true); m.isPickable = false; });
    acc.parent = parentRoot;
    acc.position = offset;
    acc.scaling = new BABYLON.Vector3(1, 1, 1);
    return acc;
  }

  // ─── Instantiate a Character for Other Players ───────
  createPlayerCharacter(characterName, teamId) {
    const template = this.characterTemplates[characterName || AssetLoader.CHARACTER_FOR_TEAM[teamId] || 'Knight'];
    if (!template) return null;

    const inst = template.instantiateModelsToScene(name => 'player_' + Date.now() + '_' + name, false, { doNotInstantiate: true });
    const root = inst.rootNodes[0];
    if (!root) return null;

    root.getChildMeshes().forEach(m => {
      m.isPickable = false;
    });

    // Store animation groups in root for easy access
    root.animationGroups = inst.animationGroups;

    // Scale character to ~1.8 unit height (character models are roughly 1 unit)
    root.scaling = new BABYLON.Vector3(0.9, 0.9, 0.9);

    // Apply subtle team tint via emissive
    const tintColor = teamId === 0
      ? new BABYLON.Color3(0.15, 0.25, 0.6)
      : teamId === 1
        ? new BABYLON.Color3(0.6, 0.15, 0.15)
        : new BABYLON.Color3(0.3, 0.3, 0.15);

    root.getChildMeshes().forEach(m => {
      if (m.material) {
        // Clone material so tint doesn't affect template
        m.material = m.material.clone(m.material.name + '_t' + teamId);
        m.material.emissiveColor = tintColor;
      }
    });

    return root;
  }

  // ─── Load a City Builder Map Piece (GLTF+BIN) ───────
  async loadMapPiece(pieceName) {
    if (this.mapPieceTemplates[pieceName]) {
      return this.mapPieceTemplates[pieceName];
    }

    const basePath = '/assets/city_builder/Assets/gltf/';
    try {
      const result = await BABYLON.SceneLoader.ImportMeshAsync('', basePath, `${pieceName}.gltf`, this.scene);
      result.meshes.forEach(m => { m.setEnabled(false); m.isPickable = false; });
      this.mapPieceTemplates[pieceName] = result;
      return result;
    } catch (e) {
      console.warn(`AssetLoader: Could not load map piece ${pieceName}:`, e.message);
      return null;
    }
  }

  // ─── Place a City Builder Piece Instance ─────────────
  async placeMapPiece(pieceName, position, rotation = 0, scale = 1) {
    let template = this.mapPieceTemplates[pieceName];
    if (!template) {
      template = await this.loadMapPiece(pieceName);
    }
    if (!template) return null;

    const instance = template.meshes[0].clone(pieceName + '_' + Date.now());
    if (!instance) return null;

    instance.setEnabled(true);
    instance.getChildMeshes().forEach(m => {
      m.setEnabled(true);
      m.checkCollisions = true;
      m.receiveShadows = true;
    });

    instance.position = new BABYLON.Vector3(position.x || 0, position.y || 0, position.z || 0);
    instance.rotation.y = rotation;
    if (scale !== 1) instance.scaling = new BABYLON.Vector3(scale, scale, scale);

    return instance;
  }

  // ─── Load RPG Tool Prop (GLTF+BIN) ──────────────────
  async placeRPGProp(propName, position, rotation = 0, scale = 1) {
    const basePath = '/assets/rpg_tools/Assets/gltf/';

    try {
      const result = await BABYLON.SceneLoader.ImportMeshAsync('', basePath, `${propName}.gltf`, this.scene);
      const root = result.meshes[0];
      root.position = new BABYLON.Vector3(position.x || 0, position.y || 0, position.z || 0);
      root.rotation.y = rotation;
      if (scale !== 1) root.scaling = new BABYLON.Vector3(scale, scale, scale);

      root.getChildMeshes().forEach(m => {
        m.checkCollisions = false;
        m.receiveShadows = true;
        m.isPickable = false;
      });

      return root;
    } catch (e) {
      console.warn(`AssetLoader: Could not load RPG prop ${propName}:`, e.message);
      return null;
    }
  }

  // ─── Dispose All Templates ───────────────────────────
  dispose() {
    for (const t of Object.values(this.characterTemplates)) {
      t.dispose();
    }
    for (const t of Object.values(this.weaponTemplates)) {
      t.meshes.forEach(m => m.dispose());
    }
    for (const t of Object.values(this.accessoryTemplates)) {
      t.meshes.forEach(m => m.dispose());
    }
    for (const t of Object.values(this.mapPieceTemplates)) {
      t.meshes.forEach(m => m.dispose());
    }
    this.characterTemplates = {};
    this.weaponTemplates = {};
    this.accessoryTemplates = {};
    this.mapPieceTemplates = {};
    this.animationLibrary = {};
  }
}
