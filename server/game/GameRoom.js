const { v4: uuidv4 } = require('uuid');
const Player = require('./Player');
const { Bot, BOT_NAMES } = require('./Bot');
const { WEAPONS, calculateDamage, getSpread } = require('./weapons');
const { GAME_MODES, GameModeState } = require('./gameModes');
const { OPERATIVES, executeAbility } = require('./Operative');

// ─── Map Definitions ────────────────────────────────────
const MAPS = {
  warehouse: {
    id: 'warehouse',
    name: 'Warehouse',
    size: { x: 60, z: 60 },
    spawnPoints: {
      ffa: [
        { x: -20, y: 1.8, z: -20 }, { x: 20, y: 1.8, z: -20 },
        { x: -20, y: 1.8, z: 20 },  { x: 20, y: 1.8, z: 20 },
        { x: 0, y: 1.8, z: 0 },     { x: -10, y: 1.8, z: 10 },
        { x: 10, y: 1.8, z: -10 },  { x: 15, y: 1.8, z: 15 }
      ],
      team: [
        [
          { x: -25, y: 1.8, z: -5 }, { x: -25, y: 1.8, z: 5 },
          { x: -22, y: 1.8, z: 0 },  { x: -28, y: 1.8, z: 0 },
          { x: -25, y: 1.8, z: -10 }, { x: -25, y: 1.8, z: 10 }
        ],
        [
          { x: 25, y: 1.8, z: -5 },  { x: 25, y: 1.8, z: 5 },
          { x: 22, y: 1.8, z: 0 },   { x: 28, y: 1.8, z: 0 },
          { x: 25, y: 1.8, z: -10 }, { x: 25, y: 1.8, z: 10 }
        ]
      ]
    },
    bombSites: {
      A: { x: -15, y: 0, z: 15 },
      B: { x: 15, y: 0, z: -15 }
    },
    controlPoints: {
      A: { x: -18, y: 0, z: 0 },
      B: { x: 0, y: 0, z: 0 },
      C: { x: 18, y: 0, z: 0 }
    },
    // Obstacles / collision boxes (simplified AABB)
    obstacles: [
      { min: { x: -5, z: -5 }, max: { x: 5, z: 5 }, height: 3 },  // center crate
      { min: { x: -15, z: -2 }, max: { x: -10, z: 2 }, height: 4 },
      { min: { x: 10, z: -2 }, max: { x: 15, z: 2 }, height: 4 },
      { min: { x: -3, z: 15 }, max: { x: 3, z: 20 }, height: 2.5 },
      { min: { x: -3, z: -20 }, max: { x: 3, z: -15 }, height: 2.5 },
      { min: { x: -25, z: -25 }, max: { x: -20, z: -20 }, height: 3 },
      { min: { x: 20, z: 20 }, max: { x: 25, z: 25 }, height: 3 },
      { min: { x: -12, z: 10 }, max: { x: -8, z: 14 }, height: 2 },
      { min: { x: 8, z: -14 }, max: { x: 12, z: -10 }, height: 2 },
    ]
  },
  gridlock: {
    id: 'gridlock',
    name: 'Gridlock',
    theme: 'downtown',
    size: { x: 70, z: 70 },
    spawnPoints: {
      ffa: [
        { x: -25, y: 1.8, z: -25 }, { x: 25, y: 1.8, z: -25 },
        { x: -25, y: 1.8, z: 25 },  { x: 25, y: 1.8, z: 25 },
        { x: 0, y: 1.8, z: 25 },    { x: 0, y: 1.8, z: -25 },
        { x: -25, y: 1.8, z: 0 },   { x: 25, y: 1.8, z: 0 }
      ],
      team: [
        [ // Attackers (NW)
          { x: -28, y: 1.8, z: -28 }, { x: -25, y: 1.8, z: -25 },
          { x: -22, y: 1.8, z: -22 }, { x: -28, y: 1.8, z: -22 },
          { x: -22, y: 1.8, z: -28 }, { x: -25, y: 1.8, z: -28 }
        ],
        [ // Defenders (SE)
          { x: 28, y: 1.8, z: 28 }, { x: 25, y: 1.8, z: 25 },
          { x: 22, y: 1.8, z: 22 }, { x: 28, y: 1.8, z: 22 },
          { x: 22, y: 1.8, z: 28 }, { x: 25, y: 1.8, z: 28 }
        ]
      ]
    },
    bombSites: {
      A: { x: -15, y: 4, z: 18 },
      B: { x: 18, y: 0, z: -15 }
    },
    controlPoints: {
      A: { x: -20, y: 0, z: 0 },
      B: { x: 0, y: 0, z: 0 },
      C: { x: 20, y: 0, z: 0 }
    },
    obstacles: [
      { min: { x: -18, z: 12 }, max: { x: -8, z: 22 }, height: 10 }, // Building A
      { min: { x: 12, z: -22 }, max: { x: 22, z: -8 }, height: 6 },  // Building B
      { min: { x: -22, z: -12 }, max: { x: -12, z: -2 }, height: 8 }, // Building C
      { min: { x: 12, z: 12 }, max: { x: 22, z: 22 }, height: 12 },   // Building D
      { min: { x: -6, z: -4 }, max: { x: 6, z: 4 }, height: 2.5 },    // Center Vehicles
      { min: { x: -28, z: -8 }, max: { x: -22, z: 8 }, height: 15 },  // Tall corner NW
      { min: { x: 22, z: -8 }, max: { x: 28, z: 8 }, height: 15 },    // Tall corner SE
      // Extra obstacles for complexity
      { min: { x: -8, z: -18 }, max: { x: 8, z: -12 }, height: 6 },
      { min: { x: -8, z: 12 }, max: { x: 8, z: 18 }, height: 6 },
      { min: { x: -28, z: -28 }, max: { x: -20, z: -20 }, height: 8 },
      { min: { x: 20, z: 20 }, max: { x: 28, z: 28 }, height: 8 }
    ]
  },
  plaza: {
    id: 'plaza',
    name: 'City Plaza',
    theme: 'downtown',
    size: { x: 80, z: 80 },
    spawnPoints: {
      ffa: [
        { x: -35, y: 1.8, z: -35 }, { x: 35, y: 1.8, z: -35 },
        { x: -35, y: 1.8, z: 35 },  { x: 35, y: 1.8, z: 35 },
        { x: 0, y: 1.8, z: 35 },    { x: 0, y: 1.8, z: -35 },
        { x: -35, y: 1.8, z: 0 },   { x: 35, y: 1.8, z: 0 }
      ],
      team: [
        [{ x: -30, y: 1.8, z: -30 }, { x: -35, y: 1.8, z: -25 }, { x: -25, y: 1.8, z: -35 }, { x: -30, y: 1.8, z: -25 }, { x: -25, y: 1.8, z: -30 }, { x: -35, y: 1.8, z: -35 }],
        [{ x: 30, y: 1.8, z: 30 }, { x: 35, y: 1.8, z: 25 }, { x: 25, y: 1.8, z: 35 }, { x: 30, y: 1.8, z: 25 }, { x: 25, y: 1.8, z: 30 }, { x: 35, y: 1.8, z: 35 }]
      ]
    },
    obstacles: [
      // Central monument / cover
      { type: 'watertower', min: { x: -3, z: -3 }, max: { x: 3, z: 3 }, height: 10 },
      // Four outer corners (Tall buildings)
      { type: 'building_H', min: { x: -38, z: -38 }, max: { x: -22, z: -22 }, height: 20 },
      { type: 'building_H', min: { x: 22, z: -38 }, max: { x: 38, z: -22 }, height: 20 },
      { type: 'building_H', min: { x: -38, z: 22 }, max: { x: -22, z: 38 }, height: 20 },
      { type: 'building_H', min: { x: 22, z: 22 }, max: { x: 38, z: 38 }, height: 20 },
      // Scattered cover (benches, dumpsters, cars)
      { type: 'dumpster', min: { x: -12, z: -2 }, max: { x: -8, z: 2 }, height: 2 },
      { type: 'dumpster', min: { x: 8, z: -2 }, max: { x: 12, z: 2 }, height: 2 },
      { type: 'car_hatchback', min: { x: -2, z: 15 }, max: { x: 2, z: 20 }, height: 3 },
      { type: 'car_stationwagon', min: { x: -2, z: -20 }, max: { x: 2, z: -15 }, height: 3 },
      { type: 'bench', min: { x: -15, z: -15 }, max: { x: -13, z: -11 }, height: 1.5 },
      { type: 'bench', min: { x: 13, z: 11 }, max: { x: 15, z: 15 }, height: 1.5 },
      { type: 'bush', min: { x: 15, z: -15 }, max: { x: 18, z: -12 }, height: 2 },
      { type: 'bush', min: { x: -18, z: 12 }, max: { x: -15, z: 15 }, height: 2 }
    ]
  },
  suburbs: {
    id: 'suburbs',
    name: 'Suburban Street',
    theme: 'downtown',
    size: { x: 100, z: 40 },
    spawnPoints: {
      ffa: [
        { x: -45, y: 1.8, z: 0 }, { x: 45, y: 1.8, z: 0 },
        { x: -25, y: 1.8, z: 15 }, { x: 25, y: 1.8, z: 15 },
        { x: -25, y: 1.8, z: -15 }, { x: 25, y: 1.8, z: -15 },
        { x: 0, y: 1.8, z: 15 }, { x: 0, y: 1.8, z: -15 }
      ],
      team: [
        [{ x: -45, y: 1.8, z: 0 }, { x: -40, y: 1.8, z: 5 }, { x: -40, y: 1.8, z: -5 }, { x: -45, y: 1.8, z: 5 }, { x: -45, y: 1.8, z: -5 }, { x: -35, y: 1.8, z: 0 }],
        [{ x: 45, y: 1.8, z: 0 }, { x: 40, y: 1.8, z: 5 }, { x: 40, y: 1.8, z: -5 }, { x: 45, y: 1.8, z: 5 }, { x: 45, y: 1.8, z: -5 }, { x: 35, y: 1.8, z: 0 }]
      ]
    },
    obstacles: [
      // Top row of houses
      { type: 'building_B', min: { x: -30, z: 8 }, max: { x: -20, z: 18 }, height: 8 },
      { type: 'building_C', min: { x: -10, z: 8 }, max: { x: 0, z: 18 }, height: 8 },
      { type: 'building_A', min: { x: 10, z: 8 }, max: { x: 20, z: 18 }, height: 8 },
      { type: 'building_E', min: { x: 30, z: 8 }, max: { x: 40, z: 18 }, height: 8 },
      // Bottom row of houses
      { type: 'building_F', min: { x: -30, z: -18 }, max: { x: -20, z: -8 }, height: 8 },
      { type: 'building_A', min: { x: -10, z: -18 }, max: { x: 0, z: -8 }, height: 8 },
      { type: 'building_D', min: { x: 10, z: -18 }, max: { x: 20, z: -8 }, height: 8 },
      { type: 'building_C', min: { x: 30, z: -18 }, max: { x: 40, z: -8 }, height: 8 },
      // Cars on the street (Z=0)
      { type: 'car_sedan', min: { x: -15, z: -2 }, max: { x: -11, z: 2 }, height: 3 },
      { type: 'car_taxi', min: { x: 5, z: -2 }, max: { x: 9, z: 2 }, height: 3 },
      { type: 'car_police', min: { x: 25, z: -2 }, max: { x: 29, z: 2 }, height: 3 },
      // Streetlights and hydrants
      { type: 'streetlight', min: { x: -20, z: 5 }, max: { x: -19, z: 6 }, height: 5 },
      { type: 'streetlight', min: { x: 20, z: -6 }, max: { x: 21, z: -5 }, height: 5 },
      { type: 'firehydrant', min: { x: 0, z: 6 }, max: { x: 1, z: 7 }, height: 1.5 }
    ]
  }
};

class GameRoom {
  constructor(id, options = {}) {
    this.id = id;
    this.name = options.name || `Room ${id.slice(0, 4)}`;
    this.modeId = options.mode || 'tdm';
    this.mapId = options.map || 'warehouse';
    this.map = MAPS[this.mapId];
    this.mode = GAME_MODES[this.modeId];
    this.maxPlayers = options.maxPlayers || this.mode.maxPlayers;
    this.botCount = options.bots || 0;
    this.password = options.password || null;

    this.players = new Map();  // id -> Player
    this.bots = new Map();     // id -> Bot
    this.clients = new Map();  // id -> ws connection

    this.gameState = new GameModeState(this.modeId);
    this.phase = 'waiting';    // waiting, playing, ended
    this.tickRate = 20;        // Server ticks per second
    this.tickInterval = null;
    this.lastTickTime = Date.now();

    // Kill feed
    this.killFeed = [];

    // Damage tracking for assists
    this.damageTracker = {}; // victimId -> { attackerId: totalDamage }
  }

  addPlayer(ws, id, username, userId, loadout) {
    const team = this.gameState.getSpawnTeam(this.players.size);
    const player = new Player(id, username, team);
    player.userId = userId;

    if (loadout) {
      player.setLoadout(loadout.primary, loadout.secondary);
    }

    const spawn = this.getSpawnPoint(team);
    player.respawn(spawn);

    this.players.set(id, player);
    this.clients.set(id, ws);
    this.gameState.addPlayer(id, team);

    // Add bots first so they count toward minPlayers
    if (this.phase === 'waiting' && this.bots.size === 0 && this.botCount > 0) {
      this.addBots(this.botCount);
    }

    // Start game if enough players (human + bots)
    if (this.phase === 'waiting' && this.getPlayerCount() >= this.mode.minPlayers) {
      this.startGame();
    }

    return player;
  }

  removePlayer(id) {
    this.players.delete(id);
    this.clients.delete(id);
    this.gameState.removePlayer(id);

    // End game if not enough players
    if (this.phase === 'playing' && this.getPlayerCount() < this.mode.minPlayers) {
      this.endGame('not_enough_players');
    }
  }

  addBots(count) {
    for (let i = 0; i < count; i++) {
      const id = `bot_${uuidv4().slice(0, 8)}`;
      const name = BOT_NAMES[i % BOT_NAMES.length];
      const team = this.gameState.getSpawnTeam(this.players.size + this.bots.size);
      const bot = new Bot(id, `[BOT] ${name}`, team, 'random');
      const spawn = this.getSpawnPoint(team);
      bot.respawn(spawn);
      this.bots.set(id, bot);
      this.gameState.addPlayer(id, team);
    }
  }

  getPlayerCount() {
    return this.players.size + this.bots.size;
  }

  getSpawnPoint(team) {
    let spawns;
    if (this.mode.teams && this.map.spawnPoints.team) {
      spawns = this.map.spawnPoints.team[team] || this.map.spawnPoints.ffa;
    } else {
      spawns = this.map.spawnPoints.ffa;
    }

    // Pick random spawn, preferring ones far from enemies
    const idx = Math.floor(Math.random() * spawns.length);
    return { ...spawns[idx] };
  }

  startGame() {
    this.phase = 'playing';
    this.gameState.startTime = Date.now();

    // Add bots if not already added
    if (this.botCount > 0 && this.bots.size === 0) {
      this.addBots(this.botCount);
    }

    this.broadcast({
      type: 'game_start',
      mode: this.modeId,
      map: this.mapId,
      mapData: this.map,
      players: this.getAllPlayerStates()
    });

    // Start game loop
    this.tickInterval = setInterval(() => this.tick(), 1000 / this.tickRate);
  }

  endGame(reason = 'completed') {
    this.phase = 'ended';

    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }

    const scoreboard = this.gameState.getScoreboard();

    this.broadcast({
      type: 'game_over',
      reason,
      scoreboard,
      winner: this.gameState.winner
    });

    // Return match results for DB
    return {
      scoreboard,
      winner: this.gameState.winner
    };
  }

  tick() {
    const now = Date.now();
    const dt = (now - this.lastTickTime) / 1000;
    this.lastTickTime = now;

    if (this.phase !== 'playing') return;

    // Update bots
    const allEntities = [...this.players.values(), ...this.bots.values()];
    const mapObstacles = MAPS[this.mapId]?.obstacles || [];
    for (const [id, bot] of this.bots) {
      const actions = bot.update(allEntities, dt, mapObstacles);
      if (actions) {
        for (const action of actions) {
          if (action.type === 'shoot') {
            this.handleBotShoot(bot, action.direction);
          }
        }
      }
    }

    // Handle respawns
    for (const [id, player] of this.players) {
      if (!player.alive && player.respawnTimer > 0) {
        player.respawnTimer -= dt;
        if (player.respawnTimer <= 0) {
          const spawn = this.getSpawnPoint(player.team);
          player.respawn(spawn);
          this.sendTo(id, { type: 'respawn', player: player.getPrivateState() });
          this.broadcast({ type: 'player_respawn', playerId: id, position: player.position }, id);
        }
      }
    }

    // Bot respawns
    for (const [id, bot] of this.bots) {
      if (!bot.alive) {
        if (!bot._respawnTimer) bot._respawnTimer = this.mode.respawnTime;
        bot._respawnTimer -= dt;
        if (bot._respawnTimer <= 0) {
          const spawn = this.getSpawnPoint(bot.team);
          bot.respawn(spawn);
          bot._respawnTimer = 0;
          this.broadcast({ type: 'player_respawn', playerId: id, position: bot.position });
        }
      }
    }

    // Check reload completions
    for (const [id, player] of this.players) {
      if (player.reloading && now >= player.reloadEndTime) {
        player.finishReload();
        this.sendTo(id, {
          type: 'reload_complete',
          ammo: player.ammo[player.currentWeapon],
          reserveAmmo: player.reserveAmmo[player.currentWeapon]
        });
      }
    }

    // Game mode ticks
    if (this.modeId === 'domination') {
      const events = this.gameState.dominationTick();
      for (const event of events) {
        this.broadcast({ type: 'game_event', event });
        if (event.type === 'game_over') this.endGame();
      }
    }

    if (this.modeId === 'plant_defuse') {
      const events = this.gameState.updatePhase();
      for (const event of events) {
        this.broadcast({ type: 'game_event', event });
        if (event.type === 'game_over') this.endGame();
      }
    }

    // Time limit check
    const timeEvents = this.gameState.checkTimeLimit();
    for (const event of timeEvents) {
      this.broadcast({ type: 'game_event', event });
      if (event.type === 'game_over') this.endGame('time');
    }

    // Send state update to all clients
    this.broadcastState();
  }

  handlePlayerInput(playerId, input) {
    const player = this.players.get(playerId);
    if (!player || !player.alive) return;

    // Update position (client-predicted, server-validated)
    if (input.position && input.rotation) {
      const valid = player.updatePosition(input.position, input.rotation, {
        moving: input.moving,
        crouching: input.crouching,
        grounded: input.grounded,
        jumping: input.jumping
      });

      if (!valid) {
        // Send correction
        this.sendTo(playerId, {
          type: 'position_correction',
          position: player.position,
          seq: input.seq
        });
      }
    }

    player.lastInputSeq = input.seq || 0;
  }

  handleShoot(playerId) {
    if (this.modeId === 'plant_defuse' && this.gameState.phase !== 'engagement') return;

    const player = this.players.get(playerId);
    if (!player) return;

    const shotData = player.shoot();
    if (!shotData) return;

    // Perform hitscan
    const hitResult = this.performHitscan(player, shotData);

    // Broadcast shot event (visual/audio feedback)
    this.broadcast({
      type: 'player_shoot',
      playerId,
      weaponId: shotData.weaponId,
      position: shotData.position,
      rotation: shotData.rotation
    });

    // Send ammo update to shooter
    this.sendTo(playerId, {
      type: 'ammo_update',
      ammo: player.ammo[player.currentWeapon],
      reserveAmmo: player.reserveAmmo[player.currentWeapon]
    });

    if (hitResult) {
      this.processHit(playerId, hitResult);
    }
  }

  handleBotShoot(bot, direction) {
    // Simple ray against all players
    const allTargets = [...this.players.values(), ...this.bots.values()]
      .filter(p => p.id !== bot.id && p.alive && (p.team !== bot.team || bot.team < 0));

    for (const target of allTargets) {
      const dx = target.position.x - bot.position.x;
      const dy = target.position.y - bot.position.y;
      const dz = target.position.z - bot.position.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      // Simple cone check
      const dotProduct = (direction.x * dx + direction.y * dy + direction.z * dz) / dist;
      if (dotProduct > 0.9) {
        const weapon = WEAPONS[bot.currentWeapon];
        const damage = calculateDamage(bot.currentWeapon, dist, Math.random() < 0.1, target.moving);

        if (damage > 0) {
          const hitResult = {
            targetId: target.id,
            damage,
            headshot: Math.random() < 0.1,
            distance: dist
          };
          this.processHit(bot.id, hitResult);
          break;
        }
      }
    }
  }

  performHitscan(shooter, shotData) {
    const weapon = WEAPONS[shotData.weaponId];
    if (!weapon) return null;

    // Calculate shot direction with spread
    const spread = getSpread(
      shotData.weaponId,
      shotData.moving,
      shotData.jumping,
      false,
      shotData.consecutiveShots
    );

    const yaw = shotData.rotation.y + (Math.random() - 0.5) * spread;
    const pitch = shotData.rotation.x + (Math.random() - 0.5) * spread;

    const dir = {
      x: Math.sin(yaw) * Math.cos(pitch),
      y: Math.sin(pitch),
      z: Math.cos(yaw) * Math.cos(pitch)
    };

    // Check all potential targets
    let closestHit = null;
    let closestDist = weapon.range.max;

    // Check map walls
    const map = MAPS[this.mapId];
    if (map && map.obstacles) {
      for (const obs of map.obstacles) {
        const hit = this.rayBoxIntersect(shotData.position, dir, obs.min, obs.max, obs.height || 3);
        if (hit && hit.distance < closestDist) {
          closestDist = hit.distance;
          closestHit = null; // Wall blocks the shot
        }
      }
    }

    const allTargets = [...this.players.values(), ...this.bots.values()];

    for (const target of allTargets) {
      if (target.id === shooter.id) continue;
      if (!target.alive) continue;

      // Team check
      if (this.mode.teams && !this.mode.friendlyFire) {
        if (target.team === shooter.team && shooter.team >= 0) continue;
      }

      // Ray-sphere intersection (simplified hitbox)
      const bodyRadius = target.crouching ? 0.4 : 0.45;
      const bodyHeight = target.crouching ? 1.2 : 1.8;

      const hit = this.raySphereIntersect(
        shotData.position, dir,
        target.position, bodyRadius, bodyHeight
      );

      if (hit && hit.distance < closestDist) {
        // Determine headshot
        const hitY = shotData.position.y + dir.y * hit.distance;
        const headThreshold = target.position.y + (target.crouching ? 0.8 : 1.4);
        const isHeadshot = hitY > headThreshold;

        closestDist = hit.distance;
        closestHit = {
          targetId: target.id,
          distance: hit.distance,
          headshot: isHeadshot,
          damage: calculateDamage(shotData.weaponId, hit.distance, isHeadshot)
        };
      }
    }

    return closestHit;
  }

  raySphereIntersect(origin, dir, center, radius, height) {
    // Simplified cylinder intersection
    const dx = origin.x - center.x;
    const dz = origin.z - center.z;

    const a = dir.x * dir.x + dir.z * dir.z;
    const b = 2 * (dx * dir.x + dz * dir.z);
    const c = dx * dx + dz * dz - radius * radius;

    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return null;

    const t = (-b - Math.sqrt(discriminant)) / (2 * a);
    if (t < 0) return null;

    // Check height
    const hitY = origin.y + dir.y * t;
    if (hitY < center.y - 0.5 || hitY > center.y + height * 0.5) return null;

    return { distance: t };
  }

  rayBoxIntersect(origin, dir, min, max, height) {
    let tmin = -Infinity, tmax = Infinity;

    // Helper for each axis
    const checkAxis = (originP, dirP, minP, maxP) => {
      if (Math.abs(dirP) < 1e-6) {
        if (originP < minP || originP > maxP) return false;
      } else {
        let t1 = (minP - originP) / dirP;
        let t2 = (maxP - originP) / dirP;
        if (t1 > t2) { const temp = t1; t1 = t2; t2 = temp; }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) return false;
      }
      return true;
    };

    if (!checkAxis(origin.x, dir.x, min.x, max.x)) return null;
    if (!checkAxis(origin.y, dir.y, 0, height)) return null;
    if (!checkAxis(origin.z, dir.z, min.z, max.z)) return null;

    if (tmax < 0) return null;
    return { distance: tmin > 0 ? tmin : tmax };
  }

  processHit(attackerId, hitResult) {
    const target = this.players.get(hitResult.targetId) || this.bots.get(hitResult.targetId);
    if (!target || !target.alive) return;

    // Track damage for assists
    if (!this.damageTracker[hitResult.targetId]) {
      this.damageTracker[hitResult.targetId] = {};
    }
    this.damageTracker[hitResult.targetId][attackerId] =
      (this.damageTracker[hitResult.targetId][attackerId] || 0) + hitResult.damage;

    const result = target.takeDamage(hitResult.damage, attackerId);

    // Notify the attacker of hit
    if (this.clients.has(attackerId)) {
      this.sendTo(attackerId, {
        type: 'hit_confirm',
        targetId: hitResult.targetId,
        damage: result.damage,
        headshot: hitResult.headshot,
        targetHealth: target.health,
        killed: result.died
      });
    }

    // Notify victim of damage
    if (this.clients.has(hitResult.targetId)) {
      this.sendTo(hitResult.targetId, {
        type: 'damage_taken',
        damage: result.damage,
        attackerId,
        health: target.health,
        direction: this.getDamageDirection(target, this.players.get(attackerId) || this.bots.get(attackerId))
      });
    }

    if (result.died) {
      this.handleKill(attackerId, hitResult.targetId, hitResult.headshot);
    }
  }

  handleKill(killerId, victimId, headshot) {
    const killer = this.players.get(killerId) || this.bots.get(killerId);
    const victim = this.players.get(victimId) || this.bots.get(victimId);

    if (killer) {
      killer.kills++;
    }

    // Game mode scoring
    const events = this.gameState.onKill(killerId, victimId, headshot);

    // Set respawn timer
    if (this.mode.respawnTime >= 0) {
      if (victim instanceof Player) {
        victim.respawnTimer = this.mode.respawnTime;
      }
    }

    // Kill feed
    const killEntry = {
      killer: killer ? killer.username || killer.name : 'Unknown',
      killerId,
      victim: victim ? victim.username || victim.name : 'Unknown',
      victimId,
      weapon: killer ? killer.currentWeapon : 'unknown',
      headshot,
      timestamp: Date.now()
    };
    this.killFeed.push(killEntry);
    if (this.killFeed.length > 10) this.killFeed.shift();

    // Broadcast kill
    this.broadcast({
      type: 'player_killed',
      ...killEntry
    });

    // Handle assists
    const damageMap = this.damageTracker[victimId] || {};
    for (const [assisterId, dmg] of Object.entries(damageMap)) {
      if (assisterId !== killerId && dmg > 20) {
        if (this.gameState.playerScores[assisterId]) {
          this.gameState.playerScores[assisterId].assists++;
          this.gameState.playerScores[assisterId].score += this.mode.scoringRules.assist || 0;
        }
      }
    }
    delete this.damageTracker[victimId];

    // Handle game events
    for (const event of events) {
      this.broadcast({ type: 'game_event', event });
      if (event.type === 'game_over') {
        this.endGame();
      }
    }
  }

  getDamageDirection(victim, attacker) {
    if (!attacker) return 0;
    const dx = attacker.position.x - victim.position.x;
    const dz = attacker.position.z - victim.position.z;
    return Math.atan2(dx, dz);
  }

  handleReload(playerId) {
    const player = this.players.get(playerId);
    if (!player) return;

    if (player.startReload()) {
      this.broadcast({
        type: 'player_reload',
        playerId,
        weaponId: player.currentWeapon
      });
    }
  }

  handleWeaponSwitch(playerId, slot) {
    const player = this.players.get(playerId);
    if (!player) return;

    const newWeapon = player.switchWeapon(slot);
    this.broadcast({
      type: 'weapon_switch',
      playerId,
      weaponId: newWeapon
    });
  }

  handleAbility(playerId) {
    const player = this.players.get(playerId);
    if (!player) return;

    const operative = OPERATIVES[player.operative];
    if (!operative) return;

    const result = executeAbility(operative, player, this);
    if (!result.success) {
      this.sendTo(playerId, {
        type: 'ability_failed',
        reason: result.reason,
        remaining: result.remaining
      });
      return;
    }

    this.broadcast({
      type: 'ability_effect',
      playerId,
      operative: player.operative,
      ...result
    });
  }

  broadcastState() {
    const states = this.getAllPlayerStates();
    const scoreboard = this.gameState.getScoreboard();

    for (const [id, ws] of this.clients) {
      const player = this.players.get(id);
      if (!player) continue;

      try {
        ws.send(JSON.stringify({
          type: 'state_update',
          players: states.filter(s => s.id !== id),
          self: player.getPrivateState(),
          scoreboard,
          seq: player.lastInputSeq,
          serverTime: Date.now()
        }));
      } catch (e) {
        // Connection issue
      }
    }
  }

  getAllPlayerStates() {
    const states = [];
    for (const player of this.players.values()) {
      states.push(player.getPublicState());
    }
    for (const bot of this.bots.values()) {
      states.push(bot.getPublicState());
    }
    return states;
  }

  broadcast(msg, excludeId = null) {
    const data = JSON.stringify(msg);
    for (const [id, ws] of this.clients) {
      if (id === excludeId) continue;
      try {
        ws.send(data);
      } catch (e) {
        // Connection issue
      }
    }
  }

  sendTo(id, msg) {
    const ws = this.clients.get(id);
    if (ws) {
      try {
        ws.send(JSON.stringify(msg));
      } catch (e) {
        // Connection issue
      }
    }
  }

  getInfo() {
    return {
      id: this.id,
      name: this.name,
      mode: this.modeId,
      modeName: this.mode.name,
      map: this.mapId,
      playerCount: this.players.size,
      botCount: this.bots.size,
      maxPlayers: this.maxPlayers,
      phase: this.phase,
      hasPassword: !!this.password
    };
  }

  destroy() {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
    }
    this.players.clear();
    this.bots.clear();
    this.clients.clear();
  }
}

module.exports = { GameRoom, MAPS };
