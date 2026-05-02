/**
 * Weapon definitions with full stats for server-authoritative validation.
 * The client uses a subset of these for rendering/feedback.
 */
const WEAPONS = {
  // ─── Pistols ───────────────────────────────────────────
  desert_eagle: {
    id: 'desert_eagle',
    name: 'Desert Eagle',
    category: 'pistol',
    damage: 55,
    headshot_multiplier: 2.5,
    fire_rate: 400,        // ms between shots
    reload_time: 2200,     // ms
    magazine_size: 7,
    reserve_ammo: 35,
    recoil: { vertical: 4.5, horizontal: 1.8, recovery: 0.85 },
    spread: { base: 0.02, moving: 0.05, jumping: 0.15 },
    range: { max: 80, falloff_start: 30, min_damage: 0.5 },
    movement_speed: 1.0,
    equip_time: 500,
    bullet_type: 'hitscan',
    unlock_level: 1
  },

  auto_pistol: {
    id: 'auto_pistol',
    name: 'Auto-9',
    category: 'pistol',
    damage: 22,
    headshot_multiplier: 2.0,
    fire_rate: 80,
    reload_time: 1800,
    magazine_size: 18,
    reserve_ammo: 90,
    recoil: { vertical: 1.5, horizontal: 1.0, recovery: 0.92 },
    spread: { base: 0.03, moving: 0.06, jumping: 0.18 },
    range: { max: 50, falloff_start: 20, min_damage: 0.4 },
    movement_speed: 1.0,
    equip_time: 400,
    bullet_type: 'hitscan',
    auto: true,
    unlock_level: 3
  },

  // ─── Assault Rifles ────────────────────────────────────
  ak47: {
    id: 'ak47',
    name: 'AK-47',
    category: 'assault_rifle',
    damage: 36,
    headshot_multiplier: 2.5,
    fire_rate: 100,
    reload_time: 2500,
    magazine_size: 30,
    reserve_ammo: 90,
    recoil: { vertical: 3.8, horizontal: 2.5, recovery: 0.78 },
    spread: { base: 0.015, moving: 0.04, jumping: 0.2 },
    range: { max: 100, falloff_start: 40, min_damage: 0.6 },
    movement_speed: 0.88,
    equip_time: 700,
    bullet_type: 'hitscan',
    auto: true,
    unlock_level: 8
  },

  m416: {
    id: 'm416',
    name: 'M416',
    category: 'assault_rifle',
    damage: 31,
    headshot_multiplier: 2.2,
    fire_rate: 90,
    reload_time: 2300,
    magazine_size: 30,
    reserve_ammo: 90,
    recoil: { vertical: 2.2, horizontal: 1.2, recovery: 0.88 },
    spread: { base: 0.012, moving: 0.035, jumping: 0.18 },
    range: { max: 100, falloff_start: 45, min_damage: 0.55 },
    movement_speed: 0.9,
    equip_time: 650,
    bullet_type: 'hitscan',
    auto: true,
    unlock_level: 1
  },

  m4a1_s: {
    id: 'm4a1_s',
    name: 'M4A1-S',
    category: 'assault_rifle',
    damage: 33,
    headshot_multiplier: 2.3,
    fire_rate: 95,
    reload_time: 2400,
    magazine_size: 25,
    reserve_ammo: 75,
    recoil: { vertical: 1.8, horizontal: 0.9, recovery: 0.91 },
    spread: { base: 0.01, moving: 0.03, jumping: 0.16 },
    range: { max: 110, falloff_start: 50, min_damage: 0.6 },
    movement_speed: 0.9,
    equip_time: 650,
    bullet_type: 'hitscan',
    auto: true,
    suppressed: true,
    unlock_level: 20
  },

  // ─── SMGs ─────────────────────────────────────────────
  mp5: {
    id: 'mp5',
    name: 'MP5',
    category: 'smg',
    damage: 24,
    headshot_multiplier: 2.0,
    fire_rate: 65,
    reload_time: 2000,
    magazine_size: 30,
    reserve_ammo: 120,
    recoil: { vertical: 1.4, horizontal: 0.8, recovery: 0.93 },
    spread: { base: 0.025, moving: 0.035, jumping: 0.12 },
    range: { max: 60, falloff_start: 20, min_damage: 0.4 },
    movement_speed: 0.95,
    equip_time: 500,
    bullet_type: 'hitscan',
    auto: true,
    unlock_level: 5
  },

  p90: {
    id: 'p90',
    name: 'P90',
    category: 'smg',
    damage: 21,
    headshot_multiplier: 2.0,
    fire_rate: 55,
    reload_time: 2800,
    magazine_size: 50,
    reserve_ammo: 100,
    recoil: { vertical: 1.2, horizontal: 1.0, recovery: 0.9 },
    spread: { base: 0.028, moving: 0.04, jumping: 0.14 },
    range: { max: 55, falloff_start: 18, min_damage: 0.35 },
    movement_speed: 0.95,
    equip_time: 550,
    bullet_type: 'hitscan',
    auto: true,
    unlock_level: 15
  },

  // ─── Snipers ──────────────────────────────────────────
  awp: {
    id: 'awp',
    name: 'AWP',
    category: 'sniper',
    damage: 115,
    headshot_multiplier: 3.0,
    fire_rate: 1500,
    reload_time: 3500,
    magazine_size: 5,
    reserve_ammo: 20,
    recoil: { vertical: 8.0, horizontal: 3.0, recovery: 0.6 },
    spread: { base: 0.005, moving: 0.15, jumping: 0.4, scoped: 0.001 },
    range: { max: 200, falloff_start: 100, min_damage: 0.9 },
    movement_speed: 0.8,
    equip_time: 900,
    bullet_type: 'hitscan',
    scope_zoom: 4.0,
    unlock_level: 12
  }
};

/**
 * Calculate actual damage considering distance, armor, headshot, etc.
 */
function calculateDamage(weaponId, distance, isHeadshot, targetMoving) {
  const weapon = WEAPONS[weaponId];
  if (!weapon) return 0;

  let damage = weapon.damage;

  // Headshot multiplier
  if (isHeadshot) {
    damage *= weapon.headshot_multiplier;
  }

  // Distance falloff
  if (distance > weapon.range.falloff_start) {
    const falloffRange = weapon.range.max - weapon.range.falloff_start;
    const falloffDist = distance - weapon.range.falloff_start;
    const falloffFactor = Math.max(
      weapon.range.min_damage,
      1.0 - (falloffDist / falloffRange) * (1.0 - weapon.range.min_damage)
    );
    damage *= falloffFactor;
  }

  // Beyond max range = no damage
  if (distance > weapon.range.max) {
    damage = 0;
  }

  return Math.round(damage);
}

/**
 * Get weapon spread based on player state
 */
function getSpread(weaponId, isMoving, isJumping, isScoped, shotsFired) {
  const weapon = WEAPONS[weaponId];
  if (!weapon) return 0;

  let spread = weapon.spread.base;

  if (isJumping) {
    spread = weapon.spread.jumping;
  } else if (isMoving) {
    spread = weapon.spread.moving;
  }

  if (isScoped && weapon.spread.scoped !== undefined) {
    spread = weapon.spread.scoped;
  }

  // Consecutive shots increase spread
  spread += shotsFired * 0.003;

  return spread;
}

module.exports = { WEAPONS, calculateDamage, getSpread };
