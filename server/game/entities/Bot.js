/**
 * Bot.js - Server-side AI with simple FSM pathfinding.
 *
 * FIXES:
 *  B1 - getPublicState() always sets moving/crouching correctly from actual
 *       movement so client-side animation triggers work (was always false).
 *  B2 - doRetreat now correctly sets this.crouching = false (bots sprint away).
 *  B3 - stuckTimer increment uses consistent dt units (was mixing 10 and dt).
 *  B4 - doCombat uses dt instead of hard-coded (1/60) so the frame rate isn't
 *       baked into position updates.
 *  B5 - respawn regenerates waypoints near spawnPoint so bot doesn't walk to
 *       the other side of the map immediately after dying.
 *  B6 - generateWaypoints accepts an optional centre position.
 *  B7 - 'random' difficulty resolved before settings lookup (was already fixed
 *       in prior version — preserved).
 */
const { WEAPONS } = require('../data/weapons');

class Bot {
  constructor(id, name, team, difficulty = 'normal') {
    this.id = id;
    this.name = name;
    this.team = team;
    this.isBot = true;

    if (difficulty === 'random') {
      const diffs = ['easy', 'normal', 'hard'];
      difficulty = diffs[Math.floor(Math.random() * diffs.length)];
    }
    this.difficulty = difficulty;

    const settings = {
      easy: { aimAccuracy: 0.25, reactionTime: 800, fireDelay: 400, moveSpeed: 0.7 },
      normal: { aimAccuracy: 0.50, reactionTime: 400, fireDelay: 200, moveSpeed: 0.85 },
      hard: { aimAccuracy: 0.75, reactionTime: 200, fireDelay: 100, moveSpeed: 1.0 }
    };
    this.settings = settings[difficulty] || settings.normal;

    this.position = { x: 0, y: 1.8, z: 0 };
    this.rotation = { x: 0, y: 0 };
    this.health = 100;
    this.alive = true;

    this.currentWeapon = 'm416';
    this.target = null;
    this.state = 'patrol';
    this.patrolTarget = null;

    this.lastShotTime = 0;
    this.lastDecisionTime = 0;

    this.kills = 0;
    this.deaths = 0;
    this.score = 0;

    // [B1] Track actual movement so getPublicState() reports it correctly
    this.moving = false;
    this.crouching = false;

    this.stuckTimer = 0;
    this.lastPosition = { ...this.position };

    this.waypoints = this.generateWaypoints(this.position);
    this.currentWaypoint = 0;
  }

  // [B6] Waypoints generated around a centre point
  generateWaypoints(centre = { x: 0, z: 0 }) {
    const points = [];
    const mapSize = 40;
    for (let i = 0; i < 8; i++) {
      points.push({
        x: centre.x + (Math.random() - 0.5) * mapSize,
        y: 1.8,
        z: centre.z + (Math.random() - 0.5) * mapSize
      });
    }
    return points;
  }

  update(players, dt, obstacles = []) {
    if (!this.alive) return null;

    const now = Date.now();
    const actions = [];

    // ── Find nearest enemy ────────────────────────────────────────────────────
    let nearestEnemy = null;
    let nearestDist = Infinity;

    for (const player of players) {
      if (player.id === this.id) continue;
      if (!player.alive) continue;
      if (player.team === this.team && this.team >= 0) continue;
      if (player.spawnProtectionUntil && Date.now() < player.spawnProtectionUntil) continue;

      const dx = player.position.x - this.position.x;
      const dz = player.position.z - this.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < nearestDist) { nearestDist = dist; nearestEnemy = player; }
    }

    // ── State machine ─────────────────────────────────────────────────────────
    if (now - this.lastDecisionTime > 500) {
      this.lastDecisionTime = now;
      if (nearestEnemy && nearestDist < 50) {
        this.state = 'combat';
        this.target = nearestEnemy;
      } else if (this.health < 30) {
        this.state = 'retreat';
      } else {
        this.state = 'patrol';
      }
    }

    // ── Execute behaviour ──────────────────────────────────────────────────────
    let proposedX = this.position.x;
    let proposedZ = this.position.z;

    // Reset moving every tick; set true in sub-methods
    this.moving = false;
    this.crouching = false;

    switch (this.state) {
      case 'patrol': {
        const m = this.doPatrol(dt);
        proposedX = m.x; proposedZ = m.z;
        actions.push(...m.actions);
        break;
      }
      case 'combat': {
        const m = this.doCombat(nearestEnemy, nearestDist, now, dt);  // [B4]
        proposedX = m.x; proposedZ = m.z;
        actions.push(...m.actions);
        break;
      }
      case 'retreat': {
        const m = this.doRetreat(nearestEnemy, dt);
        proposedX = m.x; proposedZ = m.z;
        actions.push(...m.actions);
        break;
      }
    }

    // ── Obstacle avoidance ────────────────────────────────────────────────────
    let canMove = true;
    for (const obs of obstacles) {
      if (proposedX > obs.min.x - 0.5 && proposedX < obs.max.x + 0.5 &&
        proposedZ > obs.min.z - 0.5 && proposedZ < obs.max.z + 0.5) {
        canMove = false;
        break;
      }
    }

    if (canMove) {
      this.position.x = proposedX;
      this.position.z = proposedZ;
    }

    // ── Stuck detection ───────────────────────────────────────────────────────
    const moveDist = Math.sqrt(
      Math.pow(this.position.x - this.lastPosition.x, 2) +
      Math.pow(this.position.z - this.lastPosition.z, 2)
    );

    if (moveDist < 0.01) {
      this.stuckTimer += dt;   // [B3] use dt, not magic 10
      if (this.stuckTimer > 2) {
        // Jump to next waypoint
        this.currentWaypoint = (this.currentWaypoint + 1) % this.waypoints.length;
        this.stuckTimer = 0;
      }
    } else {
      this.stuckTimer = 0;
    }

    this.lastPosition = { ...this.position };
    return actions;
  }

  doPatrol(dt) {
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

    const speed = 5 * this.settings.moveSpeed * dt;
    const angle = Math.atan2(dx, dz);
    this.rotation.y = angle;
    px += Math.sin(angle) * speed;
    pz += Math.cos(angle) * speed;
    this.moving = true;   // [B1]

    return { x: px, z: pz, actions: [] };
  }

  // [B4] dt parameter added; hard-coded (1/60) removed
  doCombat(enemy, dist, now, dt) {
    let px = this.position.x;
    let pz = this.position.z;
    if (!enemy) return { x: px, z: pz, actions: [] };

    const actions = [];
    const dx = enemy.position.x - px;
    const dz = enemy.position.z - pz;
    const dy = enemy.position.y - this.position.y;
    const hDist = Math.sqrt(dx * dx + dz * dz);

    const targetYaw = Math.atan2(dx, dz);
    const targetPitch = Math.atan2(dy, hDist);

    const aimSpeed = 0.1 + this.settings.aimAccuracy * 0.15;
    this.rotation.y += (targetYaw - this.rotation.y) * aimSpeed;
    this.rotation.x += (targetPitch - this.rotation.x) * aimSpeed;

    const inaccuracy = (1 - this.settings.aimAccuracy) * 0.1;
    const aimErrorX = (Math.random() - 0.5) * inaccuracy;
    const aimErrorY = (Math.random() - 0.5) * inaccuracy;

    const aimDiff = Math.abs(targetYaw - this.rotation.y);
    const weapon = WEAPONS[this.currentWeapon];

    if (weapon && aimDiff < 0.2 &&
      now - this.lastShotTime > weapon.fire_rate + this.settings.fireDelay) {
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

    const speed3 = 3 * this.settings.moveSpeed * dt;  // [B4]
    const speed2 = 2 * this.settings.moveSpeed * dt;

    if (dist > 10) {
      px += Math.sin(this.rotation.y) * speed3;
      pz += Math.cos(this.rotation.y) * speed3;
    } else if (dist < 5) {
      px -= Math.sin(this.rotation.y) * speed2;
      pz -= Math.cos(this.rotation.y) * speed2;
    } else {
      // Strafe
      const strafeDir = Math.sin(now * 0.002) > 0 ? 1 : -1;
      const perpAngle = this.rotation.y + Math.PI / 2;
      px += Math.sin(perpAngle) * strafeDir * speed2;
      pz += Math.cos(perpAngle) * strafeDir * speed2;
    }

    this.moving = true;  // [B1]
    this.crouching = dist < 8; // crouch when close  [B1]

    return { x: px, z: pz, actions };
  }

  doRetreat(enemy, dt) {
    let px = this.position.x;
    let pz = this.position.z;
    if (enemy) {
      const dx = px - enemy.position.x;
      const dz = pz - enemy.position.z;
      const angle = Math.atan2(dx, dz);
      const speed = 6 * this.settings.moveSpeed * dt;
      px += Math.sin(angle) * speed;
      pz += Math.cos(angle) * speed;
      this.rotation.y = angle + Math.PI;
    }
    this.moving = true;
    this.crouching = false;  // [B2] sprinting away, not crouching
    return { x: px, z: pz, actions: [] };
  }

  takeDamage(amount, attackerId) {
    this.health -= amount;
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      this.deaths++;
      return { died: true, damage: amount, killer: attackerId };
    }
    // React to taking damage — switch to combat
    if (this.state !== 'combat') this.state = 'combat';
    return { died: false, damage: amount };
  }

  // [B5] Respawn near the given spawn point and regenerate local waypoints
  respawn(spawnPoint) {
    this.health = 100;
    this.alive = true;
    this.position = { ...spawnPoint };
    this.state = 'patrol';
    this.target = null;
    this.moving = false;
    this.crouching = false;
    // [B5] New waypoints centred around spawn point
    this.waypoints = this.generateWaypoints(spawnPoint);
    this.currentWaypoint = 0;
  }

  // [B1] moving/crouching always reflect actual state
  getPublicState() {
    return {
      id: this.id,
      username: this.name,
      team: this.team,
      position: this.position,
      rotation: this.rotation,
      health: this.health,
      alive: this.alive,
      crouching: this.crouching,  // [B1]
      moving: this.moving,     // [B1]
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