/**
 * NetworkManager - WebSocket client for game server communication
 */
class NetworkManager {
  constructor() {
    this.ws = null;
    this.connected = false;
    this.playerId = null;
    this.token = null;
    this.handlers = {};
    this.pingInterval = null;
    this.lastPing = 0;
    this.latency = 0;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
      const url = `${protocol}://${location.host}/ws`;
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.connected = true;
        console.log('[NET] Connected');
        this.startPing();
        resolve();
      };

      this.ws.onclose = () => {
        this.connected = false;
        this.stopPing();
        console.log('[NET] Disconnected');
        this.emit('disconnected');
      };

      this.ws.onerror = (err) => {
        console.error('[NET] Error:', err);
        reject(err);
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.handleMessage(msg);
        } catch (e) {
          console.error('[NET] Parse error:', e);
        }
      };
    });
  }

  handleMessage(msg) {
    if (msg.type === 'pong') {
      this.latency = Date.now() - msg.time;
      return;
    }
    this.emit(msg.type, msg);
  }

  send(msg) {
    if (this.ws && this.connected) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  authenticate(token) {
    this.token = token;
    this.send({ type: 'authenticate', token });
  }

  joinRoom(roomId, password) {
    this.send({ type: 'join_room', roomId, password });
  }

  createRoom(options) {
    this.send({ type: 'create_room', ...options });
  }

  leaveRoom() {
    this.send({ type: 'leave_room' });
  }

  sendInput(input) {
    this.send({ type: 'player_input', ...input });
  }

  sendShoot() {
    this.send({ type: 'shoot' });
  }

  sendReload() {
    this.send({ type: 'reload' });
  }

  sendWeaponSwitch(slot) {
    this.send({ type: 'weapon_switch', slot });
  }

  sendChat(message) {
    this.send({ type: 'chat', message });
  }

  getRooms() {
    this.send({ type: 'get_rooms' });
  }

  startPing() {
    this.pingInterval = setInterval(() => {
      this.send({ type: 'ping', time: Date.now() });
    }, 2000);
  }

  stopPing() {
    if (this.pingInterval) clearInterval(this.pingInterval);
  }

  // Event system
  on(event, handler) {
    if (!this.handlers[event]) this.handlers[event] = [];
    this.handlers[event].push(handler);
  }

  off(event, handler) {
    if (!this.handlers[event]) return;
    this.handlers[event] = this.handlers[event].filter(h => h !== handler);
  }

  emit(event, data) {
    if (this.handlers[event]) {
      this.handlers[event].forEach(h => h(data));
    }
  }

  disconnect() {
    this.stopPing();
    if (this.ws) this.ws.close();
  }
}
