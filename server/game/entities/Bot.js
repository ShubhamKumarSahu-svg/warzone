/**
 * Basic AI Bot with simple pathfinding and decision making.
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

    // Difficulty settings
    const settings = {
      easy:   { aimAccuracy: 0.25, reactionTime: 800, fireDelay: 400, moveSpeed: 0.7 },
      normal: { aimAccuracy: 0.50, reactionTime: 400, fireDelay: 200, moveSpeed: 0.85 },
      hard:   { aimAccuracy: 0.75, reactionTime: 200, fireDelay: 100, moveSpeed: 1.0 }
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
    this.moving = true;
    this.crouching = false;
    this.stuckTimer = 0;
    this.lastPosition = { ...this.position };

    // Waypoints for patrol
    this.waypoints = this.generateWaypoints();
    this.currentWaypoint = 0;
  }

  generateWaypoints() {
    const points = [];
    const mapSize = 40;
    for (let i = 0; i < 8; i++) {
      points.push({
        x: (Math.random() - 0.5) * mapSize,
        y: 1.8,
        z: (Math.random() - 0.5) * mapSize
      });
    }
    return points;
  }

  update(players, dt, obstacles = []) {
    if (!this.alive) return null;

    const now = Date.now();
    const actions = [];

    // Find nearest enemy
    let nearestEnemy = null;
    let nearestDist = Infinity;

    for (const player of players) {
      if (player.id === this.id) continue;
      if (!player.alive) continue;
      if (player.team === this.team && this.team >= 0) continue;
      // Skip spawn-protected players
      if (player.spawnProtectionUntil && Date.now() < player.spawnProtectionUntil) continue;

      const dx = player.position.x - this.position.x;
      const dz = player.position.z - this.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist < nearestDist) {
        nearestDist = dist;
        nearestEnemy = player;
      }
    }

    // Decision making
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

    // Execute behavior
    let proposedX = this.position.x;
    let proposedZ = this.position.z;

    switch (this.state) {
      case 'patrol': {
        const move = this.doPatrol(dt);
        proposedX = move.x;
        proposedZ = move.z;
        actions.push(...move.actions);
        break;
      }
      case 'combat': {
        const move = this.doCombat(nearestEnemy, nearestDist, now);
        proposedX = move.x;
        proposedZ = move.z;
        actions.push(...move.actions);
        break;
      }
      case 'retreat': {
        const move = this.doRetreat(nearestEnemy, dt);
        proposedX = move.x;
        proposedZ = move.z;
        actions.push(...move.actions);
        break;
      }
    }

    // Map collision check
    let canMove = true;
    for (const obs of obstacles) {
      // Very basic bounding box check
      if (proposedX > obs.min.x - 0.5 && proposedX < obs.max.x + 0.5 &&
          proposedZ > obs.min.z - 0.5 && proposedZ < obs.max.z + 0.5) {
        canMove = false;
        break;
      }
    }

    if (canMove) {
      this.position.x = proposedX;
      this.position.z = proposedZ;
    } else {
      // If stuck, pick new random waypoint
      this.stuckTimer += 10; 
    }

    // Stuck detection
    const moveDist = Math.sqrt(
      Math.pow(this.position.x - this.lastPosition.x, 2) +
      Math.pow(this.position.z - this.lastPosition.z, 2)
    );
    if (moveDist < 0.01) {
      this.stuckTimer += dt;
      if (this.stuckTimer > 2) {
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
      return { x: px, z: pz, actions: [] };
    }

    // Move toward waypoint
    const speed = 5 * this.settings.moveSpeed * dt;
    const angle = Math.atan2(dx, dz);
    this.rotation.y = angle;

    px += Math.sin(angle) * speed;
    pz += Math.cos(angle) * speed;
    this.moving = true;

    return { x: px, z: pz, actions: [] };
  }

  doCombat(enemy, dist, now) {
    let px = this.position.x;
    let pz = this.position.z;
    if (!enemy) return { x: px, z: pz, actions: [] };
    const actions = [];

    // Aim at enemy
    const dx = enemy.position.x - px;
    const dz = enemy.position.z - pz;
    const dy = (enemy.position.y) - this.position.y;
    const hDist = Math.sqrt(dx * dx + dz * dz);

    const targetYaw = Math.atan2(dx, dz);
    const targetPitch = Math.atan2(dy, hDist);

    // Smooth aim with accuracy factor
    const aimSpeed = 0.1 + this.settings.aimAccuracy * 0.15;
    this.rotation.y += (targetYaw - this.rotation.y) * aimSpeed;
    this.rotation.x += (targetPitch - this.rotation.x) * aimSpeed;

    // Add inaccuracy
    const inaccuracy = (1 - this.settings.aimAccuracy) * 0.1;
    const aimErrorX = (Math.random() - 0.5) * inaccuracy;
    const aimErrorY = (Math.random() - 0.5) * inaccuracy;

    // Shoot if aimed roughly
    const aimDiff = Math.abs(targetYaw - this.rotation.y);
    const weapon = WEAPONS[this.currentWeapon];

    if (aimDiff < 0.2 && now - this.lastShotTime > weapon.fire_rate + this.settings.fireDelay) {
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

    // Strafe during combat
    if (dist > 10) {
      // Move closer
      px += Math.sin(this.rotation.y) * 3 * (1 / 60);
      pz += Math.cos(this.rotation.y) * 3 * (1 / 60);
    } else if (dist < 5) {
      // Back up
      px -= Math.sin(this.rotation.y) * 2 * (1 / 60);
      pz -= Math.cos(this.rotation.y) * 2 * (1 / 60);
    } else {
      // Strafe
      const strafeDir = Math.sin(now * 0.002) > 0 ? 1 : -1;
      const perpAngle = this.rotation.y + Math.PI / 2;
      px += Math.sin(perpAngle) * strafeDir * 2 * (1 / 60);
      pz += Math.cos(perpAngle) * strafeDir * 2 * (1 / 60);
    }
    this.moving = true;

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
    this.state = 'combat';
    return { died: false, damage: amount };
  }

  respawn(spawnPoint) {
    this.health = 100;
    this.alive = true;
    this.position = { ...spawnPoint };
    this.state = 'patrol';
    this.target = null;
  }

  getPublicState() {
    return {
      id: this.id,
      username: this.name,
      team: this.team,
      position: this.position,
      rotation: this.rotation,
      health: this.health,
      alive: this.alive,
      crouching: this.crouching,
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
