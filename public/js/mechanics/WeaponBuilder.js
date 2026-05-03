class WeaponBuilder {
  /**
   * Build a procedural 3D weapon model based on the weapon ID.
   * Returns a BABYLON.TransformNode containing the meshes.
   */
  static buildWeaponModel(weaponId, scene) {
    const root = new BABYLON.TransformNode(`weapon_${weaponId}`, scene);

    // Standard Materials
    const darkMat = new BABYLON.StandardMaterial('gun_dark', scene);
    darkMat.diffuseColor = new BABYLON.Color3(0.1, 0.1, 0.15);
    darkMat.specularColor = new BABYLON.Color3(0.2, 0.2, 0.2);

    const metalMat = new BABYLON.StandardMaterial('gun_metal', scene);
    metalMat.diffuseColor = new BABYLON.Color3(0.3, 0.35, 0.4);
    metalMat.specularColor = new BABYLON.Color3(0.8, 0.8, 0.9);
    metalMat.specularPower = 64;

    const accentMat = new BABYLON.StandardMaterial('gun_accent', scene);
    accentMat.diffuseColor = new BABYLON.Color3(0.8, 0.2, 0.1);
    
    const woodMat = new BABYLON.StandardMaterial('gun_wood', scene);
    woodMat.diffuseColor = new BABYLON.Color3(0.4, 0.2, 0.05);

    // Build specific weapon geometry based on ID
    switch (weaponId) {
      case 'desert_eagle':
        // Nighthawk .50: Blocky, heavy pistol
        {
          const barrel = BABYLON.MeshBuilder.CreateBox('barrel', { width: 0.05, height: 0.06, depth: 0.25 }, scene);
          barrel.parent = root; barrel.position.set(0, 0.02, 0.1); barrel.material = metalMat;
          
          const grip = BABYLON.MeshBuilder.CreateBox('grip', { width: 0.04, height: 0.12, depth: 0.05 }, scene);
          grip.parent = root; grip.position.set(0, -0.06, -0.05); grip.rotation.x = 0.2; grip.material = darkMat;
          
          const sight = BABYLON.MeshBuilder.CreateBox('sight', { width: 0.01, height: 0.02, depth: 0.02 }, scene);
          sight.parent = root; sight.position.set(0, 0.06, 0.2); sight.material = accentMat;
        }
        break;

      case 'auto_pistol':
        // Viper-9: Compact, sleek pistol
        {
          const barrel = BABYLON.MeshBuilder.CreateBox('barrel', { width: 0.03, height: 0.04, depth: 0.2 }, scene);
          barrel.parent = root; barrel.position.set(0, 0.02, 0.1); barrel.material = darkMat;
          
          const grip = BABYLON.MeshBuilder.CreateBox('grip', { width: 0.03, height: 0.1, depth: 0.04 }, scene);
          grip.parent = root; grip.position.set(0, -0.04, -0.02); grip.rotation.x = 0.1; grip.material = darkMat;
          
          const laser = BABYLON.MeshBuilder.CreateCylinder('laser', { diameter: 0.01, height: 0.05 }, scene);
          laser.parent = root; laser.position.set(0, -0.01, 0.18); laser.rotation.x = Math.PI / 2; laser.material = accentMat;
        }
        break;

      case 'ak47':
        // Ironclad-47: Classic wood & metal rifle
        {
          const body = BABYLON.MeshBuilder.CreateBox('body', { width: 0.04, height: 0.08, depth: 0.25 }, scene);
          body.parent = root; body.position.set(0, 0.0, 0); body.material = metalMat;

          const barrel = BABYLON.MeshBuilder.CreateCylinder('barrel', { diameter: 0.02, height: 0.35 }, scene);
          barrel.parent = root; barrel.position.set(0, 0.01, 0.3); barrel.rotation.x = Math.PI / 2; barrel.material = metalMat;
          
          const woodGuard = BABYLON.MeshBuilder.CreateBox('guard', { width: 0.05, height: 0.04, depth: 0.15 }, scene);
          woodGuard.parent = root; woodGuard.position.set(0, 0.0, 0.2); woodGuard.material = woodMat;

          const stock = BABYLON.MeshBuilder.CreateBox('stock', { width: 0.04, height: 0.1, depth: 0.2 }, scene);
          stock.parent = root; stock.position.set(0, -0.03, -0.2); stock.rotation.x = -0.1; stock.material = woodMat;

          const mag = BABYLON.MeshBuilder.CreateBox('mag', { width: 0.03, height: 0.15, depth: 0.05 }, scene);
          mag.parent = root; mag.position.set(0, -0.1, 0.05); mag.rotation.x = 0.3; mag.material = darkMat;

          const grip = BABYLON.MeshBuilder.CreateBox('grip', { width: 0.03, height: 0.1, depth: 0.04 }, scene);
          grip.parent = root; grip.position.set(0, -0.08, -0.1); grip.rotation.x = 0.2; grip.material = woodMat;
        }
        break;

      case 'm416':
      case 'm4a1_s':
        // Phantom MK4 / Spectre-S: Modern tactical rifle
        {
          const body = BABYLON.MeshBuilder.CreateBox('body', { width: 0.05, height: 0.09, depth: 0.3 }, scene);
          body.parent = root; body.position.set(0, 0.0, 0); body.material = darkMat;

          const barrelLen = weaponId === 'm4a1_s' ? 0.5 : 0.3;
          const barrel = BABYLON.MeshBuilder.CreateCylinder('barrel', { diameter: weaponId === 'm4a1_s' ? 0.04 : 0.02, height: barrelLen }, scene);
          barrel.parent = root; barrel.position.set(0, 0.01, 0.15 + barrelLen/2); barrel.rotation.x = Math.PI / 2; barrel.material = darkMat;
          
          const stock = BABYLON.MeshBuilder.CreateBox('stock', { width: 0.04, height: 0.1, depth: 0.18 }, scene);
          stock.parent = root; stock.position.set(0, -0.02, -0.24); stock.material = darkMat;

          const mag = BABYLON.MeshBuilder.CreateBox('mag', { width: 0.03, height: 0.12, depth: 0.06 }, scene);
          mag.parent = root; mag.position.set(0, -0.1, 0.05); mag.rotation.x = 0.1; mag.material = metalMat;

          const grip = BABYLON.MeshBuilder.CreateBox('grip', { width: 0.03, height: 0.1, depth: 0.04 }, scene);
          grip.parent = root; grip.position.set(0, -0.08, -0.12); grip.rotation.x = 0.3; grip.material = darkMat;

          const sight = BABYLON.MeshBuilder.CreateBox('sight', { width: 0.04, height: 0.04, depth: 0.06 }, scene);
          sight.parent = root; sight.position.set(0, 0.06, 0.05); sight.material = darkMat;
        }
        break;

      case 'mp5':
      case 'p90':
        // SMGs
        {
          const isP90 = weaponId === 'p90';
          const body = BABYLON.MeshBuilder.CreateBox('body', { width: 0.06, height: isP90 ? 0.15 : 0.08, depth: 0.25 }, scene);
          body.parent = root; body.position.set(0, 0.0, 0); body.material = darkMat;

          const barrel = BABYLON.MeshBuilder.CreateCylinder('barrel', { diameter: 0.03, height: 0.15 }, scene);
          barrel.parent = root; barrel.position.set(0, isP90 ? 0.02 : 0.01, 0.2); barrel.rotation.x = Math.PI / 2; barrel.material = metalMat;
          
          if (isP90) {
            // P90 top magazine
            const mag = BABYLON.MeshBuilder.CreateBox('mag', { width: 0.04, height: 0.02, depth: 0.2 }, scene);
            mag.parent = root; mag.position.set(0, 0.08, 0.05); mag.material = metalMat;
          } else {
            // MP5 curved magazine
            const mag = BABYLON.MeshBuilder.CreateBox('mag', { width: 0.03, height: 0.15, depth: 0.05 }, scene);
            mag.parent = root; mag.position.set(0, -0.1, 0.05); mag.rotation.x = 0.3; mag.material = metalMat;
          }

          const grip = BABYLON.MeshBuilder.CreateBox('grip', { width: 0.04, height: 0.1, depth: 0.04 }, scene);
          grip.parent = root; grip.position.set(0, -0.08, isP90 ? 0.05 : -0.1); grip.rotation.x = 0.2; grip.material = darkMat;
        }
        break;

      case 'awp':
        // Longbow Elite: Massive sniper rifle
        {
          const body = BABYLON.MeshBuilder.CreateBox('body', { width: 0.05, height: 0.08, depth: 0.4 }, scene);
          body.parent = root; body.position.set(0, 0.0, 0); body.material = darkMat;

          const barrel = BABYLON.MeshBuilder.CreateCylinder('barrel', { diameter: 0.02, height: 0.6 }, scene);
          barrel.parent = root; barrel.position.set(0, 0.01, 0.5); barrel.rotation.x = Math.PI / 2; barrel.material = metalMat;
          
          const stock = BABYLON.MeshBuilder.CreateBox('stock', { width: 0.04, height: 0.12, depth: 0.25 }, scene);
          stock.parent = root; stock.position.set(0, -0.02, -0.3); stock.material = darkMat;

          const scopeBase = BABYLON.MeshBuilder.CreateBox('scopeBase', { width: 0.02, height: 0.04, depth: 0.1 }, scene);
          scopeBase.parent = root; scopeBase.position.set(0, 0.06, 0); scopeBase.material = darkMat;

          const scope = BABYLON.MeshBuilder.CreateCylinder('scope', { diameter: 0.05, height: 0.25 }, scene);
          scope.parent = root; scope.position.set(0, 0.08, 0); scope.rotation.x = Math.PI / 2; scope.material = darkMat;

          const mag = BABYLON.MeshBuilder.CreateBox('mag', { width: 0.04, height: 0.08, depth: 0.08 }, scene);
          mag.parent = root; mag.position.set(0, -0.08, 0.05); mag.material = darkMat;

          const grip = BABYLON.MeshBuilder.CreateBox('grip', { width: 0.03, height: 0.1, depth: 0.04 }, scene);
          grip.parent = root; grip.position.set(0, -0.08, -0.15); grip.rotation.x = 0.3; grip.material = darkMat;
        }
        break;

      default:
        // Generic boxy gun
        {
          const barrel = BABYLON.MeshBuilder.CreateBox('barrel', { width: 0.04, height: 0.04, depth: 0.45 }, scene);
          barrel.parent = root; barrel.position.set(0, 0.02, 0.15); barrel.material = darkMat;
          const body = BABYLON.MeshBuilder.CreateBox('body', { width: 0.06, height: 0.1, depth: 0.22 }, scene);
          body.parent = root; body.position.set(0, 0, -0.02); body.material = metalMat;
          const mag = BABYLON.MeshBuilder.CreateBox('mag', { width: 0.04, height: 0.12, depth: 0.06 }, scene);
          mag.parent = root; mag.position.set(0, -0.1, 0); mag.rotation.x = 0.15; mag.material = darkMat;
          const grip = BABYLON.MeshBuilder.CreateBox('grip', { width: 0.04, height: 0.1, depth: 0.04 }, scene);
          grip.parent = root; grip.position.set(0, -0.1, -0.1); grip.rotation.x = 0.3; grip.material = darkMat;
        }
        break;
    }

    return root;
  }
}
window.WeaponBuilder = WeaponBuilder;
