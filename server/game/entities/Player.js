const { WEAPONS, calculateDamage } = require('../data/weapons');

/**
 * Server-side Player representation.
 * All authoritative state lives here.
 */
class Player {
  constructor(id, username, team = -1) {
    this.id = id;
    this.username = username;
    this.team = team;
    this.userId = null; // DB user id

    // ─── Transform ────────────────────────────────────
    this.position = { x: 0, y: 1.8, z: 0 };
    this.rotation = { x: 0, y: 0 };
    this.velocity = { x: 0, y: 0, z: 0 };

    // ─── State ────────────────────────────────────────
    this.health = 100;
    this.maxHealth = 100;
    this.alive = true;
    this.crouching = false;
    this.jumping = false;
    this.moving = false;
    this.grounded = true;
    this.respawnTimer = 0;
    this.spawnProtectionUntil = Date.now() + 3000; // 3s spawn protection

    // ─── Operative ───────────────────────────────────
    this.operative = 'vega';
    this.abilityCooldownEnd = 0;

    // ─── Weapons ──────────────────────────────────────
    this.primaryWeapon = 'm416';
    this.secondaryWeapon = 'desert_eagle';
    this.currentWeapon = 'm416';
    this.ammo = {};
    this.reserveAmmo = {};
    this.reloading = false;
    this.reloadEndTime = 0;
    this.lastShotTime = 0;
    this.consecutiveShots = 0;
    this.lastShotResetTime = 0;

    this.initAmmo();

    // ─── Stats ────────────────────────────────────────
    this.kills = 0;
    this.deaths = 0;
    this.score = 0;
    this.damageDealt = 0;
    this.lastDamagedBy = null;
    this.lastDamageTime = 0;

    // ─── Network ──────────────────────────────────────
    this.lastInputSeq = 0;
    this.lastUpdateTime = Date.now();
    this.ping = 0;
  }

  initAmmo() {
    for (const [id, weapon] of Object.entries(WEAPONS)) {
      this.ammo[id] = weapon.magazine_size;
      this.reserveAmmo[id] = weapon.reserve_ammo;
    }
  }

  setLoadout(primary, secondary) {
    if (WEAPONS[primary]) this.primaryWeapon = primary;
    if (WEAPONS[secondary]) this.secondaryWeapon = secondary;
    this.currentWeapon = this.primaryWeapon;
    this.initAmmo();
  }

  switchWeapon(slot) {
    const prev = this.currentWeapon;
    if (slot === 'primary') this.currentWeapon = this.primaryWeapon;
    else if (slot === 'secondary') this.currentWeapon = this.secondaryWeapon;

    if (prev !== this.currentWeapon) {
      this.reloading = false;
      this.consecutiveShots = 0;
    }
    return this.currentWeapon;
  }

  canShoot() {
    if (!this.alive) return false;
    if (this.reloading) return false;

    const weapon = WEAPONS[this.currentWeapon];
    if (!weapon) return false;

    const now = Date.now();
    if (now - this.lastShotTime < weapon.fire_rate) return false;
    if (this.ammo[this.currentWeapon] <= 0) return false;

    return true;
  }

  shoot() {
    if (!this.canShoot()) return null;

    const weapon = WEAPONS[this.currentWeapon];
    const now = Date.now();

    this.ammo[this.currentWeapon]--;
    this.lastShotTime = now;

    // Track consecutive shots for spread increase
    if (now - this.lastShotResetTime > 300) {
      this.consecutiveShots = 0;
    }
    this.consecutiveShots++;
    this.lastShotResetTime = now;

    return {
      weaponId: this.currentWeapon,
      position: { ...this.position },
      rotation: { ...this.rotation },
      consecutiveShots: this.consecutiveShots,
      moving: this.moving,
      jumping: !this.grounded,
      crouching: this.crouching
    };
  }

  startReload() {
    if (!this.alive) return false;
    if (this.reloading) return false;

    const weapon = WEAPONS[this.currentWeapon];
    if (!weapon) return false;

    // Don't reload if magazine is already full
    if (this.ammo[this.currentWeapon] >= weapon.magazine_size) return false;
    // Reserve is infinite — no check needed

    this.reloading = true;
    this.reloadEndTime = Date.now() + weapon.reload_time;
    return true;
  }

  finishReload() {
    if (!this.reloading) return;

    const weapon = WEAPONS[this.currentWeapon];
    // Infinite reserve — always fill magazine to full
    this.ammo[this.currentWeapon] = weapon.magazine_size;
    this.reloading = false;
    this.consecutiveShots = 0;
  }

  takeDamage(amount, attackerId) {
    if (!this.alive) return { died: false, damage: 0 };

    // Spawn protection
    if (Date.now() < this.spawnProtectionUntil) return { died: false, damage: 0 };

    const actualDamage = Math.min(amount, this.health);
    this.health -= actualDamage;
    this.lastDamagedBy = attackerId;
    this.lastDamageTime = Date.now();

    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      this.deaths++;
      return { died: true, damage: actualDamage, killer: attackerId };
    }

    return { died: false, damage: actualDamage };
  }

  respawn(spawnPoint) {
    this.health = this.maxHealth;
    this.alive = true;
    this.position = { ...spawnPoint };
    this.velocity = { x: 0, y: 0, z: 0 };
    this.reloading = false;
    this.consecutiveShots = 0;
    this.currentWeapon = this.primaryWeapon;
    this.initAmmo();
    this.lastDamagedBy = null;
    this.spawnProtectionUntil = Date.now() + 3000; // 3s invulnerability
  }

  updatePosition(pos, rot, state) {
    // Server-side validation of movement
    const dx = pos.x - this.position.x;
    const dy = pos.y - this.position.y;
    const dz = pos.z - this.position.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    // Anti-cheat: limit max movement speed (generous to allow for lag)
    const maxSpeed = 25; // units per update
    if (dist > maxSpeed) {
      // Reject: too fast, likely speed hack
      return false;
    }

    this.position = { x: pos.x, y: pos.y, z: pos.z };
    this.rotation = { x: rot.x, y: rot.y };
    this.moving = state.moving || false;
    this.crouching = state.crouching || false;
    this.grounded = state.grounded !== undefined ? state.grounded : true;
    this.jumping = state.jumping || false;
    this.lastUpdateTime = Date.now();
    return true;
  }

  getPublicState() {
    return {
      id: this.id,
      username: this.username,
      team: this.team,
      position: this.position,
      rotation: this.rotation,
      health: this.health,
      alive: this.alive,
      crouching: this.crouching,
      moving: this.moving,
      currentWeapon: this.currentWeapon,
      reloading: this.reloading,
      operative: this.operative
    };
  }

  getPrivateState() {
    return {
      ...this.getPublicState(),
      ammo: this.ammo[this.currentWeapon],
      reserveAmmo: this.reserveAmmo[this.currentWeapon],
      kills: this.kills,
      deaths: this.deaths,
      score: this.score,
      abilityCooldownEnd: this.abilityCooldownEnd
    };
  }
}

module.exports = Player;
