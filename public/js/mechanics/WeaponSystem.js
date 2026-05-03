/**
 * Client-side weapon data (mirrors server stats for UI feedback).
 * Actual damage/hit is server-authoritative.
 *
 * WEAPON NAMES — unique codenames instead of real-world brands.
 * RESERVE AMMO — infinite. Magazine must reload, but the pool never runs out.
 */
const WEAPON_DATA = {
  desert_eagle: { name: 'Nighthawk .50', category: 'Pistol', fireRate: 400, reloadTime: 2200, magSize: 7, auto: false, recoilV: 2.0, recoilH: 0.8 },
  auto_pistol:  { name: 'Viper-9',      category: 'Pistol', fireRate: 80,  reloadTime: 1800, magSize: 18, auto: true, recoilV: 0.6, recoilH: 0.4 },
  ak47:         { name: 'Ironclad-47',   category: 'Assault Rifle', fireRate: 100, reloadTime: 2500, magSize: 30, auto: true, recoilV: 1.6, recoilH: 1.0 },
  m416:         { name: 'Phantom MK4',   category: 'Assault Rifle', fireRate: 90,  reloadTime: 2300, magSize: 30, auto: true, recoilV: 0.9, recoilH: 0.5 },
  m4a1_s:       { name: 'Spectre-S',     category: 'Assault Rifle', fireRate: 95,  reloadTime: 2400, magSize: 25, auto: true, recoilV: 0.7, recoilH: 0.4 },
  mp5:          { name: 'Stinger-5',     category: 'SMG', fireRate: 65,  reloadTime: 2000, magSize: 30, auto: true, recoilV: 0.5, recoilH: 0.3 },
  p90:          { name: 'Hornet-90',     category: 'SMG', fireRate: 55,  reloadTime: 2800, magSize: 50, auto: true, recoilV: 0.5, recoilH: 0.4 },
  awp:          { name: 'Longbow Elite', category: 'Sniper', fireRate: 1500, reloadTime: 3500, magSize: 5, auto: false, recoilV: 3.5, recoilH: 1.2, scope: true }
};

class WeaponSystem {
  constructor() {
    this.currentWeapon = 'm416';
    this.ammo = 30;
    this.reserveAmmo = 999;  // infinite display
    this.reloading = false;
    this.lastShotTime = 0;
    this.recoilOffset = { x: 0, y: 0 };
    this.shooting = false;
    this.aiming = false; // ADS state
  }

  getWeaponData(id) {
    return WEAPON_DATA[id || this.currentWeapon];
  }

  canShoot() {
    if (this.reloading) return false;
    if (this.ammo <= 0) return false;
    const w = this.getWeaponData();
    if (!w) return false;
    return (Date.now() - this.lastShotTime) >= w.fireRate;
  }

  shoot() {
    if (!this.canShoot()) return false;
    this.lastShotTime = Date.now();
    this.ammo--;

    const w = this.getWeaponData();
    // Reduced recoil when ADS
    const recoilMult = this.aiming ? 0.5 : 1.0;
    this.recoilOffset.y += w.recoilV * 0.001 * recoilMult * (0.8 + Math.random() * 0.4);
    this.recoilOffset.x += (Math.random() - 0.5) * w.recoilH * 0.001 * recoilMult;

    return true;
  }

  // Returns true if ammo is empty and we should auto-reload
  needsAutoReload() {
    if (this.reloading) return false;
    if (this.ammo <= 0) return true;
    return false;
  }

  // Returns true if a manual reload is valid (not full, not already reloading)
  canReload() {
    if (this.reloading) return false;
    const w = this.getWeaponData();
    if (!w) return false;
    return this.ammo < w.magSize; // Only reload if not full
  }

  updateRecoil(dt) {
    // Frame-rate independent recoil recovery using half-life decay
    const halfLife = 0.08; // seconds to recover to 50%
    const decay = Math.exp(-Math.LN2 / halfLife * dt);
    this.recoilOffset.x *= decay;
    this.recoilOffset.y *= decay;
  }

  setWeapon(id, ammo, reserve) {
    this.currentWeapon = id;
    if (ammo !== undefined) this.ammo = ammo;
    this.reserveAmmo = 999; // Always infinite
    this.reloading = false;
    this.recoilOffset = { x: 0, y: 0 };
    this.aiming = false;
  }
}

