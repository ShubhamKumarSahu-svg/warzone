/**
 * Bot.js — Human-Like AI with Line-of-Sight & Skill Tiers
 *
 * KEY FEATURES:
 *  ✅ Line-of-sight (LOS) — bots can NOT see/shoot through walls
 *  ✅ Skill tiers — noob / easy / normal / hard / pro with realistic stats
 *  ✅ Human movement — strafing, crouching, sliding, peeking, retreating
 *  ✅ Reaction time — bots don't snap-aim instantly, delay varies by skill
 *  ✅ Smart combat — different engagement ranges, cover-seeking, push/hold
 *  ✅ Waypoints scale to actual map size
 *  ✅ Stuck recovery — teleport to nearest clear waypoint
 */
const { WEAPONS } = require('../data/weapons');

// ─── Line-of-Sight Helper ─────────────────────────────────────────────────────
// Returns true if there's a clear line between two positions (no obstacles block)
function hasLineOfSight(from, to, obstacles) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist < 0.1) return true;

  const dirX = dx / dist;
  const dirZ = dz / dist;

  for (const obs of obstacles) {
    // Ray-AABB intersection (2D, XZ plane)
    let tmin = -Infinity;
    let tmax = Infinity;

    // X axis
    if (Math.abs(dirX) > 1e-6) {
      let t1 = (obs.min.x - from.x) / dirX;
      let t2 = (obs.max.x - from.x) / dirX;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
    } else {
      if (from.x < obs.min.x || from.x > obs.max.x) continue;
    }

    // Z axis
    if (Math.abs(dirZ) > 1e-6) {
      let t1 = (obs.min.z - from.z) / dirZ;
      let t2 = (obs.max.z - from.z) / dirZ;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
    } else {
      if (from.z < obs.min.z || from.z > obs.max.z) continue;
    }

    // Check if ray hits this obstacle BETWEEN from and to
    if (tmin <= tmax && tmax > 0 && tmin < dist) {
      return false; // Wall blocks LOS
    }
  }
  return true;
}

// ─── Point-in-AABB check ──────────────────────────────────────────────────────
function isInsideObstacle(x, z, obstacles, pad = 0.6) {
  for (const obs of obstacles) {
    if (x > obs.min.x - pad && x < obs.max.x + pad &&
        z > obs.min.z - pad && z < obs.max.z + pad) {
      return true;
    }
  }
  return false;
}

class Bot {
  constructor(id, name, team, difficulty = 'normal') {
    this.id = id;
    this.name = name;
    this.team = team;
    this.isBot = true;

    // Resolve random difficulty
    if (difficulty === 'random') {
      const diffs = ['noob', 'easy', 'normal', 'hard', 'pro'];
      difficulty = diffs[Math.floor(Math.random() * diffs.length)];
    }
    this.difficulty = difficulty;

    // ─── Skill Tiers ────────────────────────────────────────────────────────
    const settings = {
      noob: {
        aimAccuracy: 0.12,     // terrible aim
        reactionTime: 1200,    // very slow reaction
        fireDelay: 600,        // long delay between shots
        moveSpeed: 0.55,       // slow movement
        headShotChance: 0.02,  // almost never headshots
        crouchChance: 0.05,    // rarely crouches
        strafeChance: 0.2,     // mostly runs straight
        slideChance: 0.0,      // never slides
        engageRange: 30,       // only sees close targets
        aimJitter: 0.25,       // aim wobbles a lot
      },
      easy: {
        aimAccuracy: 0.30,
        reactionTime: 800,
        fireDelay: 400,
        moveSpeed: 0.70,
        headShotChance: 0.05,
        crouchChance: 0.15,
        strafeChance: 0.35,
        slideChance: 0.05,
        engageRange: 40,
        aimJitter: 0.15,
      },
      normal: {
        aimAccuracy: 0.55,
        reactionTime: 450,
        fireDelay: 200,
        moveSpeed: 0.85,
        headShotChance: 0.12,
        crouchChance: 0.30,
        strafeChance: 0.55,
        slideChance: 0.15,
        engageRange: 55,
        aimJitter: 0.08,
      },
      hard: {
        aimAccuracy: 0.78,
        reactionTime: 250,
        fireDelay: 120,
        moveSpeed: 1.0,
        headShotChance: 0.22,
        crouchChance: 0.50,
        strafeChance: 0.70,
        slideChance: 0.30,
        engageRange: 70,
        aimJitter: 0.04,
      },
      pro: {
        aimAccuracy: 0.92,
        reactionTime: 120,
        fireDelay: 60,
        moveSpeed: 1.1,
        headShotChance: 0.35,
        crouchChance: 0.60,
        strafeChance: 0.85,
        slideChance: 0.45,
        engageRange: 90,
        aimJitter: 0.015,
      }
    };
    this.settings = settings[difficulty] || settings.normal;

    // ─── State ──────────────────────────────────────────────────────────────
    this.position = { x: 0, y: 1.8, z: 0 };
    this.rotation = { x: 0, y: 0 };
    this.health = 100;
    this.alive = true;

    this.currentWeapon = 'm416';
    this.target = null;
    this.state = 'patrol'; // patrol | combat | retreat | hold
    this.patrolTarget = null;

    this.lastShotTime = 0;
    this.lastDecisionTime = 0;
    this._targetAcquiredTime = 0; // when we first spotted the target (for reaction delay)
    this._hasReacted = false;     // has reaction delay passed?

    this.kills = 0;
    this.deaths = 0;
    this.score = 0;

    this.moving = false;
    this.crouching = false;
    this.sliding = false;

    this.stuckTimer = 0;
    this.lastPosition = { ...this.position };

    // Strafe state
    this._strafeDir = 1;
    this._strafeTimer = 0;
    this._slideTimer = 0;

    // Waypoints (will be regenerated on respawn with map-aware sizing)
    this._mapSize = 60;
    this.waypoints = this.generateWaypoints(this.position);
    this.currentWaypoint = 0;
  }

  // ─── Waypoints Scaled to Map ──────────────────────────────────────────────
  generateWaypoints(centre = { x: 0, z: 0 }, mapSize) {
    const size = mapSize || this._mapSize || 60;
    const half = (size / 2) - 5;
    const points = [];
    for (let i = 0; i < 10; i++) {
      points.push({
        x: Math.max(-half, Math.min(half, centre.x + (Math.random() - 0.5) * size * 0.8)),
        y: 1.8,
        z: Math.max(-half, Math.min(half, centre.z + (Math.random() - 0.5) * size * 0.8))
      });
    }
    return points;
  }

  // ─── Main Update ──────────────────────────────────────────────────────────
  update(players, dt, obstacles = []) {
    if (!this.alive) return null;

    const now = Date.now();
    const actions = [];

    // ── Find nearest VISIBLE enemy ──────────────────────────────────────────
    let nearestEnemy = null;
    let nearestDist = Infinity;

    for (const player of players) {
      if (player.id === this.id) continue;
      if (!player.alive) continue;
      if (player.team === this.team && this.team >= 0) continue;
      if (player.spawnProtectionUntil && now < player.spawnProtectionUntil) continue;

      const dx = player.position.x - this.position.x;
      const dz = player.position.z - this.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      // Must be within engagement range for this difficulty
      if (dist > this.settings.engageRange) continue;

      // ★ LINE-OF-SIGHT CHECK — cannot see through walls!
      if (!hasLineOfSight(this.position, player.position, obstacles)) continue;

      if (dist < nearestDist) {
        nearestDist = dist;
        nearestEnemy = player;
      }
    }

    // ── State Machine ───────────────────────────────────────────────────────
    if (now - this.lastDecisionTime > 400) {
      this.lastDecisionTime = now;

      if (nearestEnemy && nearestDist < this.settings.engageRange) {
        // First time seeing this target? Start reaction timer
        if (this.target !== nearestEnemy) {
          this._targetAcquiredTime = now;
          this._hasReacted = false;
        }
        this.state = 'combat';
        this.target = nearestEnemy;
      } else if (this.health < 30 && this.target) {
        this.state = 'retreat';
      } else {
        this.state = 'patrol';
        this.target = null;
        this._hasReacted = false;
      }

      // Randomize strafe direction periodically
      this._strafeTimer -= 0.4;
      if (this._strafeTimer <= 0) {
        this._strafeDir = Math.random() > 0.5 ? 1 : -1;
        this._strafeTimer = 1.0 + Math.random() * 2.0;
      }
    }

    // ── Check reaction time ─────────────────────────────────────────────────
    if (this.target && !this._hasReacted) {
      if (now - this._targetAcquiredTime >= this.settings.reactionTime) {
        this._hasReacted = true;
      }
    }

    // ── Execute Behaviour ───────────────────────────────────────────────────
    let proposedX = this.position.x;
    let proposedZ = this.position.z;

    this.moving = false;
    this.crouching = false;

    // Slide decay
    if (this._slideTimer > 0) {
      this._slideTimer -= dt;
      this.sliding = this._slideTimer > 0;
    } else {
      this.sliding = false;
    }

    switch (this.state) {
      case 'patrol': {
        const m = this._doPatrol(dt, obstacles);
        proposedX = m.x; proposedZ = m.z;
        actions.push(...m.actions);
        break;
      }
      case 'combat': {
        const m = this._doCombat(nearestEnemy, nearestDist, now, dt, obstacles);
        proposedX = m.x; proposedZ = m.z;
        actions.push(...m.actions);
        break;
      }
      case 'retreat': {
        const m = this._doRetreat(nearestEnemy, dt, obstacles);
        proposedX = m.x; proposedZ = m.z;
        actions.push(...m.actions);
        break;
      }
    }

    // ── Obstacle Collision ──────────────────────────────────────────────────
    if (!isInsideObstacle(proposedX, proposedZ, obstacles)) {
      this.position.x = proposedX;
      this.position.z = proposedZ;
    } else {
      // Try X-only or Z-only movement
      if (!isInsideObstacle(proposedX, this.position.z, obstacles)) {
        this.position.x = proposedX;
      } else if (!isInsideObstacle(this.position.x, proposedZ, obstacles)) {
        this.position.z = proposedZ;
      }
      // else stuck — don't move
    }

    // ── Map Bounds ──────────────────────────────────────────────────────────
    const half = (this._mapSize / 2) - 1;
    this.position.x = Math.max(-half, Math.min(half, this.position.x));
    this.position.z = Math.max(-half, Math.min(half, this.position.z));

    // ── Stuck Detection ─────────────────────────────────────────────────────
    const moveDist = Math.sqrt(
      Math.pow(this.position.x - this.lastPosition.x, 2) +
      Math.pow(this.position.z - this.lastPosition.z, 2)
    );

    if (moveDist < 0.01) {
      this.stuckTimer += dt;
      if (this.stuckTimer > 2.5) {
        this.currentWaypoint = (this.currentWaypoint + 1) % this.waypoints.length;
        this.stuckTimer = 0;
        // If really stuck, regenerate waypoints
        if (this.stuckTimer > 5) {
          this.waypoints = this.generateWaypoints(this.position);
          this.currentWaypoint = 0;
        }
      }
    } else {
      this.stuckTimer = 0;
    }

    this.lastPosition = { ...this.position };
    return actions;
  }

  // ─── PATROL — walk between waypoints ──────────────────────────────────────
  _doPatrol(dt, obstacles) {
    let px = this.position.x;
    let pz = this.position.z;
    if (!this.waypoints.length) return { x: px, z: pz, actions: [] };

    const wp = this.waypoints[this.currentWaypoint];
    const dx = wp.x - px;
    const dz = wp.z - pz;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < 2) {
      this.currentWaypoint = (this.currentWaypoint + 1) % this.waypoints.length;
      this.moving = false;
      return { x: px, z: pz, actions: [] };
    }

    const speed = 4.5 * this.settings.moveSpeed * dt;
    const angle = Math.atan2(dx, dz);
    this.rotation.y = angle;
    px += Math.sin(angle) * speed;
    pz += Math.cos(angle) * speed;
    this.moving = true;

    return { x: px, z: pz, actions: [] };
  }

  // ─── COMBAT — engage enemy with human-like tactics ────────────────────────
  _doCombat(enemy, dist, now, dt, obstacles) {
    let px = this.position.x;
    let pz = this.position.z;
    if (!enemy) return { x: px, z: pz, actions: [] };

    const actions = [];
    const dx = enemy.position.x - px;
    const dz = enemy.position.z - pz;
    const dy = (enemy.position.y || 1.8) - (this.position.y || 1.8);
    const hDist = Math.sqrt(dx * dx + dz * dz);

    // ── Aim toward enemy (with jitter for realism) ──────────────────────────
    const targetYaw = Math.atan2(dx, dz);
    const targetPitch = Math.atan2(dy, hDist);

    const aimSpeed = 0.08 + this.settings.aimAccuracy * 0.18;

    // Add human-like jitter that decreases with skill
    const jitter = this.settings.aimJitter;
    const jitterX = (Math.random() - 0.5) * jitter;
    const jitterY = (Math.random() - 0.5) * jitter * 0.5;

    this.rotation.y += (targetYaw + jitterX - this.rotation.y) * aimSpeed;
    this.rotation.x += (targetPitch + jitterY - this.rotation.x) * aimSpeed;

    // ── Shooting (only after reaction delay) ────────────────────────────────
    if (this._hasReacted) {
      const inaccuracy = (1 - this.settings.aimAccuracy) * 0.12;
      const aimErrorX = (Math.random() - 0.5) * inaccuracy;
      const aimErrorY = (Math.random() - 0.5) * inaccuracy;

      const aimDiff = Math.abs(targetYaw - this.rotation.y);
      const weapon = WEAPONS[this.currentWeapon];

      if (weapon && aimDiff < 0.25 &&
        now - this.lastShotTime > weapon.fire_rate + this.settings.fireDelay) {

        // ★ FINAL LOS CHECK — don't shoot through walls
        if (hasLineOfSight(this.position, enemy.position, obstacles)) {
          this.lastShotTime = now;
          actions.push({
            type: 'shoot',
            direction: {
              x: Math.sin(this.rotation.y + aimErrorX),
              y: Math.sin(this.rotation.x + aimErrorY),
              z: Math.cos(this.rotation.y + aimErrorX)
            }
          });
        }
      }
    }

    // ── Movement Tactics ────────────────────────────────────────────────────
    const baseSpeed = 3.5 * this.settings.moveSpeed * dt;
    const strafeSpeed = 2.5 * this.settings.moveSpeed * dt;

    if (dist > 25) {
      // ── Long range: push forward ──────────────────────────────────────────
      px += Math.sin(this.rotation.y) * baseSpeed;
      pz += Math.cos(this.rotation.y) * baseSpeed;
      this.moving = true;

      // Skilled bots may slide to close distance
      if (Math.random() < this.settings.slideChance * 0.3 && this._slideTimer <= 0) {
        this._slideTimer = 0.6;
        this.sliding = true;
      }

    } else if (dist > 12) {
      // ── Mid range: strafe while shooting ──────────────────────────────────
      if (Math.random() < this.settings.strafeChance) {
        const perpAngle = this.rotation.y + Math.PI / 2;
        px += Math.sin(perpAngle) * this._strafeDir * strafeSpeed;
        pz += Math.cos(perpAngle) * this._strafeDir * strafeSpeed;
      } else {
        // Sometimes push in
        px += Math.sin(this.rotation.y) * baseSpeed * 0.5;
        pz += Math.cos(this.rotation.y) * baseSpeed * 0.5;
      }
      this.moving = true;

      // Crouch while shooting at mid-range (smaller hitbox)
      if (Math.random() < this.settings.crouchChance) {
        this.crouching = true;
      }

    } else if (dist > 4) {
      // ── Close range: aggressive strafe ────────────────────────────────────
      const perpAngle = this.rotation.y + Math.PI / 2;
      const strafeIntensity = strafeSpeed * 1.3;
      px += Math.sin(perpAngle) * this._strafeDir * strafeIntensity;
      pz += Math.cos(perpAngle) * this._strafeDir * strafeIntensity;
      this.moving = true;

      // Crouch-spam at close range (skilled bots)
      if (Math.random() < this.settings.crouchChance * 1.5) {
        this.crouching = Math.random() > 0.4; // toggle
      }

      // Slide dodge at close range
      if (Math.random() < this.settings.slideChance * 0.5 && this._slideTimer <= 0) {
        this._slideTimer = 0.5;
        this.sliding = true;
        this.crouching = true;
      }

    } else {
      // ── Very close: backpedal while shooting ──────────────────────────────
      px -= Math.sin(this.rotation.y) * baseSpeed;
      pz -= Math.cos(this.rotation.y) * baseSpeed;
      this.moving = true;
    }

    return { x: px, z: pz, actions };
  }

  // ─── RETREAT — run away, slide for speed ──────────────────────────────────
  _doRetreat(enemy, dt, obstacles) {
    let px = this.position.x;
    let pz = this.position.z;

    if (enemy) {
      const dx = px - enemy.position.x;
      const dz = pz - enemy.position.z;
      const angle = Math.atan2(dx, dz);
      const speed = 6 * this.settings.moveSpeed * dt;
      px += Math.sin(angle) * speed;
      pz += Math.cos(angle) * speed;
      this.rotation.y = angle + Math.PI; // face away

      // Slide for burst speed when retreating (skilled bots)
      if (Math.random() < this.settings.slideChance && this._slideTimer <= 0) {
        this._slideTimer = 0.7;
        this.sliding = true;
        this.crouching = true;
      }
    }

    this.moving = true;
    if (!this.sliding) this.crouching = false; // sprint, don't crouch

    // If health recovered, switch back to patrol
    if (this.health > 50) {
      this.state = 'patrol';
    }

    return { x: px, z: pz, actions: [] };
  }

  // ─── Damage Handling ──────────────────────────────────────────────────────
  takeDamage(amount, attackerId) {
    this.health -= amount;
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      this.deaths++;
      return { died: true, damage: amount, killer: attackerId };
    }
    // React to damage — enter combat or retreat
    if (this.health < 25) {
      this.state = 'retreat';
    } else if (this.state !== 'combat') {
      this.state = 'combat';
    }
    return { died: false, damage: amount };
  }

  // ─── Respawn ──────────────────────────────────────────────────────────────
  respawn(spawnPoint) {
    this.health = 100;
    this.alive = true;
    this.position = { ...spawnPoint };
    this.state = 'patrol';
    this.target = null;
    this.moving = false;
    this.crouching = false;
    this.sliding = false;
    this._hasReacted = false;
    this._slideTimer = 0;
    this.waypoints = this.generateWaypoints(spawnPoint);
    this.currentWaypoint = 0;
  }

  // ─── Public State ─────────────────────────────────────────────────────────
  getPublicState() {
    return {
      id: this.id,
      username: this.name,
      team: this.team,
      position: this.position,
      rotation: this.rotation,
      health: this.health,
      alive: this.alive,
      crouching: this.crouching || this.sliding,
      moving: this.moving,
      currentWeapon: this.currentWeapon,
      reloading: false,
      isBot: true
    };
  }
}

const BOT_NAMES = [
  'Phantom', 'Shadow', 'Blitz', 'Reaper', 'Ghost',
  'Viper', 'Storm', 'Fury', 'Nova', 'Apex',
  'Havoc', 'Rogue', 'Sniper', 'Tank', 'Scout'
];

module.exports = { Bot, BOT_NAMES };