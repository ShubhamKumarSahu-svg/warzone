
class VisualFXManager {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;

    this.trailPool = [];
    this.trailPoolSize = 12;
    this.initTrailPool();

    this.dmgPool = [];
    this.dmgPoolSize = 15;
    this.initDmgPool();

    this.muzzleFlash = null;   // Set via setMuzzleFlash()
  }


  setMuzzleFlash(mesh) {
    this.muzzleFlash = mesh;
  }

  // [V1] Robust null / disposed guard
  showMuzzleFlash() {
    if (!this.muzzleFlash || this.muzzleFlash.isDisposed()) return;
    const mat = this.muzzleFlash.material;
    if (!mat) return;
    mat.alpha = 1;
    setTimeout(() => {
      if (this.muzzleFlash && !this.muzzleFlash.isDisposed() && mat) {
        mat.alpha = 0;
      }
    }, 40);
  }

  // ─── Bullet Trails ───────────────────────────────────────────────────────────

  initTrailPool() {
    for (let i = 0; i < this.trailPoolSize; i++) {
      const trail = BABYLON.MeshBuilder.CreateLines(`trail_${i}`, {
        points: [BABYLON.Vector3.Zero(), BABYLON.Vector3.One()],
        updatable: false
      }, this.scene);
      trail.color = new BABYLON.Color3(1, 0.85, 0.4);
      trail.alpha = 0;
      trail.setEnabled(false);
      this.trailPool.push({ mesh: trail, active: false, life: 0 });
    }
  }

  // [V2] Fixed slot reuse: dispose old mesh first, then assign new one
  createBulletTrail(startPos, directionVec) {
    const slot = this.trailPool.find(t => !t.active);
    if (!slot) return;

    const start = startPos.clone();
    start.addInPlace(directionVec.scale(1.0));
    const end = start.add(directionVec.scale(80));

    // [V2] Dispose the recycled mesh before replacing
    if (slot.mesh && !slot.mesh.isDisposed()) slot.mesh.dispose();

    const newMesh = BABYLON.MeshBuilder.CreateLines(`trail_upd_${Date.now()}`, {
      points: [start, end],
      updatable: false
    }, this.scene);
    newMesh.color = new BABYLON.Color3(1, 0.85, 0.4);
    newMesh.alpha = 0.6;
    newMesh.setEnabled(true);

    slot.mesh = newMesh;
    slot.active = true;
    slot.life = 0;
  }

  updateTrails(dt) {
    for (const slot of this.trailPool) {
      if (!slot.active || !slot.mesh || slot.mesh.isDisposed()) continue;
      slot.life += dt;
      slot.mesh.alpha = Math.max(0, 0.6 - slot.life / 0.2);
      if (slot.life >= 0.2) {
        slot.mesh.setEnabled(false);
        slot.active = false;
      }
    }
  }

  // ─── Floating Damage Numbers ──────────────────────────────────────────────────

  // [V3] Corrected material setup
  initDmgPool() {
    for (let i = 0; i < this.dmgPoolSize; i++) {
      const plane = BABYLON.MeshBuilder.CreatePlane(`dmg_${i}`,
        { width: 1.5, height: 0.5 }, this.scene);
      plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
      plane.setEnabled(false);
      plane.isPickable = false;

      const tex = new BABYLON.DynamicTexture(`dmgTex_${i}`,
        { width: 256, height: 64 }, this.scene);

      const mat = new BABYLON.StandardMaterial(`dmgMat_${i}`, this.scene);
      mat.diffuseTexture = tex;    // [V3] assign diffuse first
      mat.emissiveTexture = tex;    // then emissive
      mat.disableLighting = true;
      mat.hasAlpha = true;
      mat.useAlphaFromDiffuseTexture = true;
      mat.backFaceCulling = false;
      plane.material = mat;

      this.dmgPool.push({ plane, tex, mat, active: false, life: 0, maxLife: 1.0 });
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
    ctx.font = `bold ${isHeadshot ? 52 : 44}px Arial`;
    ctx.textAlign = 'center';
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 6;
    ctx.fillText(Math.round(damage).toString(), 128, isHeadshot ? 50 : 46);
    if (isHeadshot) {
      ctx.font = 'bold 18px Arial';
      ctx.fillStyle = '#ffdddd';
      ctx.fillText('HEADSHOT', 128, 20);
    }
    slot.tex.update();

    slot.mat.alpha = 1;
    slot.plane.setEnabled(true);
    slot.active = true;
    slot.life = 1.0;
    slot.maxLife = 1.0;
  }

  // [V4] Consistent float speed
  updateDmgPool(dt) {
    for (const slot of this.dmgPool) {
      if (!slot.active) continue;
      slot.life -= dt;
      if (slot.life <= 0) {
        slot.plane.setEnabled(false);
        slot.active = false;
      } else {
        const lifeRatio = slot.life / slot.maxLife;
        slot.plane.position.y += 1.5 * dt;  // [V4] consistent float
        slot.mat.alpha = Math.min(1, lifeRatio * 2); // fade in first half kept full
      }
    }
  }

  // ─── Explosions ───────────────────────────────────────────────────────────────

  playExplosion(pos) {
    BABYLON.ParticleHelper.CreateAsync('explosion', this.scene)
      .then(set => {
        set.systems.forEach(s => { s.emitter = pos; });
        set.start();
      })
      .catch(() => { });
  }

  // ─── Update ───────────────────────────────────────────────────────────────────

  // [V5] Guard against late ticks after scene disposed
  update(dt) {
    if (!this.scene || this.scene.isDisposed) return;
    this.updateTrails(dt);
    this.updateDmgPool(dt);
  }
}