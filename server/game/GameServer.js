const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const { GameRoom } = require('./GameRoom');
const { GAME_MODES } = require('./gameModes');
const { WEAPONS } = require('./weapons');
const DB = require('../db');
const { JWT_SECRET } = require('../auth');

class GameServer {
  constructor(wss) {
    this.wss = wss;
    this.rooms = new Map();
    this.playerRooms = new Map(); // playerId -> roomId
    this.connections = new Map(); // ws -> { playerId, userId, username }

    // Create default rooms
    this.createDefaultRooms();

    // Handle connections
    wss.on('connection', (ws, req) => this.handleConnection(ws, req));

    // Cleanup interval
    setInterval(() => this.cleanup(), 30000);

    console.log('[GameServer] Initialized');
  }

  createDefaultRooms() {
    // Create one room per game mode with bots
    const defaultRooms = [
      { name: 'TDM #1', mode: 'tdm', bots: 4 },
      { name: 'FFA Arena', mode: 'ffa', bots: 3 },
      { name: 'S&D Competitive', mode: 'snd', bots: 4 },
      { name: 'Domination', mode: 'domination', bots: 4 }
    ];

    for (const room of defaultRooms) {
      const id = uuidv4();
      this.rooms.set(id, new GameRoom(id, {
        name: room.name,
        mode: room.mode,
        bots: room.bots
      }));
    }
  }

  handleConnection(ws, req) {
    const connId = uuidv4();
    console.log(`[GameServer] New connection: ${connId}`);

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        this.handleMessage(ws, connId, msg);
      } catch (err) {
        console.error('[GameServer] Message parse error:', err.message);
      }
    });

    ws.on('close', () => {
      this.handleDisconnect(ws, connId);
    });

    ws.on('error', (err) => {
      console.error('[GameServer] WebSocket error:', err.message);
    });

    // Send available rooms
    ws.send(JSON.stringify({
      type: 'rooms_list',
      rooms: this.getRoomList(),
      weapons: WEAPONS,
      gameModes: GAME_MODES
    }));
  }

  handleMessage(ws, connId, msg) {
    switch (msg.type) {
      case 'authenticate':
        this.handleAuth(ws, connId, msg);
        break;

      case 'join_room':
        this.handleJoinRoom(ws, connId, msg);
        break;

      case 'create_room':
        this.handleCreateRoom(ws, connId, msg);
        break;

      case 'leave_room':
        this.handleLeaveRoom(ws, connId);
        break;

      case 'player_input':
        this.handlePlayerInput(connId, msg);
        break;

      case 'shoot':
        this.handleShoot(connId);
        break;

      case 'reload':
        this.handleReload(connId);
        break;

      case 'weapon_switch':
        this.handleWeaponSwitch(connId, msg.slot);
        break;

      case 'chat':
        this.handleChat(connId, msg);
        break;

      case 'ping':
        ws.send(JSON.stringify({ type: 'pong', time: msg.time, serverTime: Date.now() }));
        break;

      case 'get_rooms':
        ws.send(JSON.stringify({ type: 'rooms_list', rooms: this.getRoomList() }));
        break;

      default:
        break;
    }
  }

  handleAuth(ws, connId, msg) {
    try {
      const decoded = jwt.verify(msg.token, JWT_SECRET);
      const user = DB.getUser(decoded.id);

      if (!user) {
        ws.send(JSON.stringify({ type: 'auth_error', error: 'User not found' }));
        return;
      }

      this.connections.set(ws, {
        connId,
        playerId: connId,
        userId: user.id,
        username: user.username,
        loadout: {
          primary: user.selected_primary,
          secondary: user.selected_secondary
        }
      });

      ws.send(JSON.stringify({
        type: 'authenticated',
        user,
        playerId: connId
      }));

      console.log(`[GameServer] Authenticated: ${user.username}`);
    } catch (err) {
      ws.send(JSON.stringify({ type: 'auth_error', error: 'Invalid token' }));
    }
  }

  handleJoinRoom(ws, connId, msg) {
    const conn = this.connections.get(ws);
    if (!conn) {
      ws.send(JSON.stringify({ type: 'error', error: 'Not authenticated' }));
      return;
    }

    const room = this.rooms.get(msg.roomId);
    if (!room) {
      ws.send(JSON.stringify({ type: 'error', error: 'Room not found' }));
      return;
    }

    if (room.players.size >= room.maxPlayers) {
      ws.send(JSON.stringify({ type: 'error', error: 'Room is full' }));
      return;
    }

    if (room.password && msg.password !== room.password) {
      ws.send(JSON.stringify({ type: 'error', error: 'Wrong password' }));
      return;
    }

    // Leave current room if in one
    if (this.playerRooms.has(connId)) {
      this.handleLeaveRoom(ws, connId);
    }

    const player = room.addPlayer(ws, connId, conn.username, conn.userId, conn.loadout);
    this.playerRooms.set(connId, msg.roomId);

    ws.send(JSON.stringify({
      type: 'joined_room',
      room: room.getInfo(),
      player: player.getPrivateState(),
      mapData: room.map,
      gameMode: room.mode,
      allPlayers: room.getAllPlayerStates()
    }));

    // Notify others
    room.broadcast({
      type: 'player_joined',
      player: player.getPublicState()
    }, connId);

    console.log(`[GameServer] ${conn.username} joined room ${room.name}`);
  }

  handleCreateRoom(ws, connId, msg) {
    const conn = this.connections.get(ws);
    if (!conn) return;

    const id = uuidv4();
    const room = new GameRoom(id, {
      name: msg.name || `${conn.username}'s Room`,
      mode: msg.mode || 'tdm',
      map: msg.map || 'warehouse',
      maxPlayers: msg.maxPlayers || 12,
      bots: msg.bots || 0,
      password: msg.password || null
    });

    this.rooms.set(id, room);

    ws.send(JSON.stringify({
      type: 'room_created',
      room: room.getInfo()
    }));

    // Auto-join
    this.handleJoinRoom(ws, connId, { roomId: id });
  }

  handleLeaveRoom(ws, connId) {
    const roomId = this.playerRooms.get(connId);
    if (!roomId) return;

    const room = this.rooms.get(roomId);
    if (room) {
      room.removePlayer(connId);
      room.broadcast({ type: 'player_left', playerId: connId });

      // Remove empty non-default rooms
      if (room.players.size === 0 && !this.isDefaultRoom(roomId)) {
        room.destroy();
        this.rooms.delete(roomId);
      }
    }

    this.playerRooms.delete(connId);
  }

  handlePlayerInput(connId, msg) {
    const roomId = this.playerRooms.get(connId);
    if (!roomId) return;

    const room = this.rooms.get(roomId);
    if (!room) return;

    room.handlePlayerInput(connId, msg);
  }

  handleShoot(connId) {
    const roomId = this.playerRooms.get(connId);
    if (!roomId) return;

    const room = this.rooms.get(roomId);
    if (room) room.handleShoot(connId);
  }

  handleReload(connId) {
    const roomId = this.playerRooms.get(connId);
    if (!roomId) return;

    const room = this.rooms.get(roomId);
    if (room) room.handleReload(connId);
  }

  handleWeaponSwitch(connId, slot) {
    const roomId = this.playerRooms.get(connId);
    if (!roomId) return;

    const room = this.rooms.get(roomId);
    if (room) room.handleWeaponSwitch(connId, slot);
  }

  handleChat(connId, msg) {
    const roomId = this.playerRooms.get(connId);
    if (!roomId) return;

    const room = this.rooms.get(roomId);
    const conn = [...this.connections.entries()].find(([_, c]) => c.connId === connId);
    if (!room || !conn) return;

    room.broadcast({
      type: 'chat',
      username: conn[1].username,
      message: msg.message?.slice(0, 200) || ''
    });
  }

  handleDisconnect(ws, connId) {
    this.handleLeaveRoom(ws, connId);
    this.connections.delete(ws);
    console.log(`[GameServer] Disconnected: ${connId}`);
  }

  getRoomList() {
    return Array.from(this.rooms.values()).map(r => r.getInfo());
  }

  isDefaultRoom(roomId) {
    // First 4 rooms are defaults
    const keys = [...this.rooms.keys()];
    return keys.indexOf(roomId) < 4;
  }

  cleanup() {
    // Remove empty custom rooms older than 5 minutes
    for (const [id, room] of this.rooms) {
      if (room.players.size === 0 && !this.isDefaultRoom(id)) {
        if (room.phase === 'ended') {
          room.destroy();
          this.rooms.delete(id);
        }
      }
    }
  }
}

module.exports = GameServer;
