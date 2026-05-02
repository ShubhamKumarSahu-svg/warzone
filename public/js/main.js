/**
 * main.js - Application entry point, screen management, auth flow
 */

// ─── State ──────────────────────────────────────────────
let currentUser = null;
let authToken = null;
let network = null;
let game = null;
let roomsList = [];
let weaponDefs = {};

// ─── Screen Management ─────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

// ─── Auth ───────────────────────────────────────────────
function showAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
  if (tab === 'login') {
    document.getElementById('btn-login-tab').classList.add('active');
    document.getElementById('login-form').classList.add('active');
  } else {
    document.getElementById('btn-signup-tab').classList.add('active');
    document.getElementById('signup-form').classList.add('active');
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error || 'Login failed'; return; }
    authToken = data.token;
    currentUser = data.user;
    localStorage.setItem('fps_token', authToken);
    enterLobby();
  } catch (err) {
    errEl.textContent = 'Connection error';
  }
}

async function handleSignup(e) {
  e.preventDefault();
  const username = document.getElementById('signup-username').value.trim();
  const password = document.getElementById('signup-password').value;
  const errEl = document.getElementById('signup-error');

  try {
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error || 'Signup failed'; return; }
    authToken = data.token;
    currentUser = data.user;
    localStorage.setItem('fps_token', authToken);
    enterLobby();
  } catch (err) {
    errEl.textContent = 'Connection error';
  }
}

function handleLogout() {
  localStorage.removeItem('fps_token');
  authToken = null;
  currentUser = null;
  if (network) network.disconnect();
  showScreen('auth-screen');
}

// ─── Lobby ──────────────────────────────────────────────
async function enterLobby() {
  showScreen('lobby-screen');
  updateLobbyUI();

  // Connect WebSocket
  if (!network) network = new NetworkManager();
  if (!network.connected) {
    try {
      await network.connect();
    } catch (e) {
      console.error('WS connect failed:', e);
      return;
    }
  }
  network.authenticate(authToken);

  network.on('authenticated', (msg) => {
    currentUser = msg.user;
    network.playerId = msg.playerId;
    updateLobbyUI();
  });

  network.on('rooms_list', (msg) => {
    roomsList = msg.rooms || [];
    if (msg.weapons) weaponDefs = msg.weapons;
    renderRooms();
    renderWeaponSelects();
    fetchLeaderboard();
  });

  network.on('room_created', (msg) => {
    // Room created, will auto-join
  });

  network.on('joined_room', (msg) => {
    startGame(msg);
  });

  network.on('auth_error', (msg) => {
    localStorage.removeItem('fps_token');
    showScreen('auth-screen');
  });

  network.on('error', (msg) => {
    alert(msg.error || 'Error');
  });

  network.on('disconnected', () => {
    if (game) { game.destroy(); game = null; }
    showScreen('auth-screen');
  });
}

function updateLobbyUI() {
  if (!currentUser) return;
  document.getElementById('lobby-username').textContent = currentUser.username;
  document.getElementById('user-level-badge').textContent = `LV ${currentUser.level}`;

  // XP bar
  const xpLevels = [0,100,250,500,800,1200,1700,2300,3000,3800,4700,5700,6800,8000,9300];
  const curLevelXP = xpLevels[currentUser.level - 1] || 0;
  const nextLevelXP = xpLevels[currentUser.level] || curLevelXP + 1000;
  const progress = ((currentUser.xp - curLevelXP) / (nextLevelXP - curLevelXP)) * 100;
  document.getElementById('xp-fill').style.width = Math.min(100, Math.max(0, progress)) + '%';

  // Stats
  const kd = currentUser.total_deaths > 0 ? (currentUser.total_kills / currentUser.total_deaths).toFixed(2) : currentUser.total_kills.toFixed(2);
  document.getElementById('stat-kd').textContent = kd;
  document.getElementById('stat-kills').textContent = currentUser.total_kills || 0;
  document.getElementById('stat-wins').textContent = currentUser.matches_won || 0;
  document.getElementById('stat-matches').textContent = currentUser.matches_played || 0;
}

function renderRooms() {
  const container = document.getElementById('rooms-list');
  container.innerHTML = '';
  if (roomsList.length === 0) {
    container.innerHTML = '<p style="color:var(--text-dim);text-align:center;padding:20px;">No rooms available</p>';
    return;
  }
  roomsList.forEach(room => {
    const card = document.createElement('div');
    card.className = 'room-card';
    card.onclick = () => joinRoom(room.id);
    card.innerHTML = `
      <div class="room-info">
        <h4>${room.name}</h4>
        <p>${room.modeName} • ${room.map}</p>
      </div>
      <div class="room-meta">
        <div class="room-players">${room.playerCount}/${room.maxPlayers}</div>
        <div class="room-mode">${room.phase}</div>
      </div>`;
    container.appendChild(card);
  });
}

function renderWeaponSelects() {
  const primarySel = document.getElementById('primary-select');
  const secondarySel = document.getElementById('secondary-select');
  if (!primarySel || !secondarySel || !currentUser) return;

  const unlocked = currentUser.unlocked_weapons || ['desert_eagle', 'm416'];
  primarySel.innerHTML = '';
  secondarySel.innerHTML = '';

  Object.entries(WEAPON_DATA || {}).forEach(([id, w]) => {
    if (!unlocked.includes(id)) return;
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = `${w.name} (${w.category})`;
    if (w.category === 'Pistol') {
      secondarySel.appendChild(opt);
    } else {
      primarySel.appendChild(opt.cloneNode(true));
    }
    // Also add to the other if it makes sense
    if (w.category !== 'Pistol') {
      primarySel.appendChild(opt);
    } else {
      secondarySel.appendChild(opt);
    }
  });

  primarySel.value = currentUser.selected_primary || 'm416';
  secondarySel.value = currentUser.selected_secondary || 'desert_eagle';
}

async function updateLoadout() {
  const primary = document.getElementById('primary-select')?.value;
  const secondary = document.getElementById('secondary-select')?.value;
  if (!authToken) return;
  try {
    await fetch('/api/auth/loadout', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
      body: JSON.stringify({ primary, secondary })
    });
  } catch (e) { /* silent */ }
}

function updateOperative() {
  const operativeId = document.getElementById('operative-select')?.value;
  if (!operativeId || !network || !network.connected) return;
  network.sendSelectOperative(operativeId);
}

function updateGraphicsQuality() {
  if (game && game.graphics) {
    game.graphics.apply(document.getElementById('graphics-quality').value);
  }
}

async function fetchLeaderboard() {
  try {
    const res = await fetch('/api/auth/leaderboard');
    if (!res.ok) return;
    const data = await res.json();
    const panel = document.getElementById('leaderboard-panel');
    panel.innerHTML = '';
    (data.leaderboard || []).forEach((entry, i) => {
      const div = document.createElement('div');
      div.className = 'lb-entry';
      div.innerHTML = `<span class="lb-name">${i + 1}. ${entry.username}</span><span class="lb-level">LV${entry.level} | ${entry.total_kills}K</span>`;
      panel.appendChild(div);
    });
  } catch (e) { /* silent */ }
}

function joinRoom(roomId) {
  if (!network || !network.connected) return;
  showScreen('loading-screen');
  const fill = document.getElementById('loading-fill');
  if (fill) fill.style.width = '30%';
  network.joinRoom(roomId);
}

function createRoom() {
  if (!network || !network.connected) return;
  const name = document.getElementById('room-name-input')?.value || '';
  const mode = document.getElementById('room-mode-select')?.value || 'tdm';
  const bots = parseInt(document.getElementById('bot-count')?.value || '2');
  showScreen('loading-screen');
  const fill = document.getElementById('loading-fill');
  if (fill) fill.style.width = '20%';
  network.createRoom({ name, mode, bots });
}

// ─── Game ───────────────────────────────────────────────
async function startGame(roomData) {
  const fill = document.getElementById('loading-fill');
  if (fill) fill.style.width = '60%';

  game = new Game(network);
  await game.init(
    { id: network.playerId, ...roomData.player },
    roomData
  );

  if (fill) fill.style.width = '100%';
  setTimeout(() => {
    showScreen('game-screen');
    game.engine.resize();

    // Set initial weapon name
    const wd = game.weapons.getWeaponData();
    if (wd) game.ui.updateWeaponName(wd.name);
    game.ui.updateAmmo(roomData.player.ammo || 30, roomData.player.reserveAmmo || 90);
  }, 300);
}

function leaveGame() {
  if (game) { game.destroy(); game = null; }
  if (network) network.leaveRoom();
  showScreen('lobby-screen');
  if (network) network.getRooms();
}

function resumeGame() {
  if (game) game.togglePause();
}

// ─── Settings Sliders ───────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const sensSlider = document.getElementById('sensitivity-slider');
  const sensVal = document.getElementById('sensitivity-value');
  if (sensSlider && sensVal) {
    sensSlider.addEventListener('input', () => {
      sensVal.textContent = sensSlider.value;
      if (game && game.input) game.input.sensitivity = parseInt(sensSlider.value) * 0.0008;
    });
  }

  const volSlider = document.getElementById('volume-slider');
  const volVal = document.getElementById('volume-value');
  if (volSlider && volVal) {
    volSlider.addEventListener('input', () => { volVal.textContent = volSlider.value; });
  }

  // Check stored token
  const storedToken = localStorage.getItem('fps_token');
  if (storedToken) {
    authToken = storedToken;
    fetch('/api/auth/profile', { headers: { 'Authorization': `Bearer ${authToken}` } })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => { currentUser = data.user; enterLobby(); })
      .catch(() => { localStorage.removeItem('fps_token'); showScreen('auth-screen'); });
  } else {
    showScreen('auth-screen');
  }
});
