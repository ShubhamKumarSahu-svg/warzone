class VisualFXManager {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    
    // Trail Pool
    this.trailPool = [];
    this.trailPoolSize = 10;
    this.initTrailPool();

    // Damage Text Pool
    this.dmgPool = [];
    this.dmgPoolSize = 15;
    this.initDmgPool();

    // Muzzle Flash Reference
    this.muzzleFlash = null;
  }

  setMuzzleFlash(mesh) {
    this.muzzleFlash = mesh;
  }

  showMuzzleFlash() {
    if (!this.muzzleFlash) return;
    this.muzzleFlash.material.alpha = 1;
    setTimeout(() => { if (this.muzzleFlash) this.muzzleFlash.material.alpha = 0; }, 40);
  }

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

  createBulletTrail(startPos, directionVec) {
    const slot = this.trailPool.find(t => !t.active);
    if (!slot) return;

    const start = startPos.clone();
    start.addInPlace(directionVec.scale(1.0));
    const end = start.add(directionVec.scale(80));

    const updatedMesh = BABYLON.MeshBuilder.CreateLines('trail_upd', {
      points: [start, end],
      updatable: false
    }, this.scene);

    slot.mesh.dispose();
    slot.mesh = updatedMesh;
    slot.mesh.color = new BABYLON.Color3(1, 0.85, 0.4);
    slot.mesh.alpha = 0.6;
    slot.mesh.setEnabled(true);
    slot.active = true;
    slot.life = 0;
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
    if (!slot) return; 

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

  playExplosion(pos) {
    BABYLON.ParticleHelper.CreateAsync('explosion', this.scene).then((set) => {
      set.systems.forEach(s => { s.emitter = pos; });
      set.start();
    });
  }

  update(dt) {
    this.updateTrails(dt);
    this.updateDmgPool(dt);
  }
}
