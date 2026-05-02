const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, '..', 'data', 'game.db');
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

let db = null;

function saveDB() {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

async function initDB() {
  const SQL = await initSqlJs();
  try {
    if (fs.existsSync(DB_PATH)) {
      const buf = fs.readFileSync(DB_PATH);
      db = new SQL.Database(buf);
    } else {
      db = new SQL.Database();
    }
  } catch (e) {
    db = new SQL.Database();
  }

  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    level INTEGER DEFAULT 1,
    xp INTEGER DEFAULT 0,
    total_kills INTEGER DEFAULT 0,
    total_deaths INTEGER DEFAULT 0,
    matches_played INTEGER DEFAULT 0,
    matches_won INTEGER DEFAULT 0,
    unlocked_weapons TEXT DEFAULT '["desert_eagle","m416"]',
    selected_primary TEXT DEFAULT 'm416',
    selected_secondary TEXT DEFAULT 'desert_eagle'
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS match_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    game_mode TEXT NOT NULL,
    kills INTEGER DEFAULT 0,
    deaths INTEGER DEFAULT 0,
    score INTEGER DEFAULT 0,
    xp_earned INTEGER DEFAULT 0,
    result TEXT DEFAULT 'loss'
  )`);

  saveDB();
  // Auto-save every 30s
  setInterval(saveDB, 30000);
  console.log('[DB] Initialized');
  return db;
}

// ─── XP / Level ──────────────────────────────────────────
const XP_PER_LEVEL = [
  0,100,250,500,800,1200,1700,2300,3000,3800,
  4700,5700,6800,8000,9300,10700,12200,13800,15500,17300,
  19200,21200,23300,25500,27800,30200,32700,35300,38000,40800
];

const WEAPON_UNLOCKS = {
  1:['desert_eagle','m416'], 3:['auto_pistol'], 5:['mp5'],
  8:['ak47'], 12:['awp'], 15:['p90'], 20:['m4a1_s']
};

function calculateLevel(totalXP) {
  for (let i = XP_PER_LEVEL.length - 1; i >= 0; i--) {
    if (totalXP >= XP_PER_LEVEL[i]) return i + 1;
  }
  return 1;
}

// ─── Helpers ─────────────────────────────────────────────
function getRow(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    const cols = stmt.getColumnNames();
    const vals = stmt.get();
    stmt.free();
    const row = {};
    cols.forEach((c, i) => row[c] = vals[i]);
    return row;
  }
  stmt.free();
  return null;
}

function getAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    const cols = stmt.getColumnNames();
    const vals = stmt.get();
    const row = {};
    cols.forEach((c, i) => row[c] = vals[i]);
    rows.push(row);
  }
  stmt.free();
  return rows;
}

// ─── DB API ──────────────────────────────────────────────
const DB = {
  initDB,
  createUser(username, password) {
    const hash = bcrypt.hashSync(password, 10);
    try {
      db.run('INSERT INTO users (username, password_hash) VALUES (?, ?)', [username, hash]);
      const row = getRow('SELECT last_insert_rowid() as id');
      saveDB();
      return { id: row.id, username };
    } catch (err) {
      return null;
    }
  },

  authenticateUser(username, password) {
    const user = getRow('SELECT * FROM users WHERE username = ?', [username]);
    if (!user) return null;
    if (!bcrypt.compareSync(password, user.password_hash)) return null;
    return { id: user.id, username: user.username, level: user.level, xp: user.xp };
  },

  getUser(id) {
    const user = getRow(
      `SELECT id, username, level, xp, total_kills, total_deaths,
              matches_played, matches_won, unlocked_weapons,
              selected_primary, selected_secondary FROM users WHERE id = ?`, [id]);
    if (!user) return null;
    user.unlocked_weapons = JSON.parse(user.unlocked_weapons || '["desert_eagle","m416"]');
    return user;
  },

  addMatchResult(userId, gameMode, kills, deaths, score, won) {
    const xpEarned = Math.floor(kills * 50 + score * 10 + (won ? 200 : 50));
    db.run('UPDATE users SET xp = xp + ?, total_kills = total_kills + ?, total_deaths = total_deaths + ?, matches_played = matches_played + 1 WHERE id = ?',
      [xpEarned, kills, deaths, userId]);
    if (won) db.run('UPDATE users SET matches_won = matches_won + 1 WHERE id = ?', [userId]);
    db.run('INSERT INTO match_history (user_id, game_mode, kills, deaths, score, xp_earned, result) VALUES (?,?,?,?,?,?,?)',
      [userId, gameMode, kills, deaths, score, xpEarned, won ? 'win' : 'loss']);

    const user = getRow('SELECT * FROM users WHERE id = ?', [userId]);
    const newLevel = calculateLevel(user.xp);
    let newUnlocks = [];
    if (newLevel > user.level) {
      db.run('UPDATE users SET level = ? WHERE id = ?', [newLevel, userId]);
      const unlocked = JSON.parse(user.unlocked_weapons || '[]');
      for (const [lvl, weapons] of Object.entries(WEAPON_UNLOCKS)) {
        if (newLevel >= parseInt(lvl)) {
          for (const w of weapons) {
            if (!unlocked.includes(w)) { unlocked.push(w); newUnlocks.push(w); }
          }
        }
      }
      if (newUnlocks.length > 0) {
        db.run('UPDATE users SET unlocked_weapons = ? WHERE id = ?', [JSON.stringify(unlocked), userId]);
      }
    }
    saveDB();
    return { xpEarned, newLevel: newLevel > user.level ? newLevel : user.level, newUnlocks, totalXP: user.xp };
  },

  updateLoadout(userId, primary, secondary) {
    db.run('UPDATE users SET selected_primary = ?, selected_secondary = ? WHERE id = ?', [primary, secondary, userId]);
    saveDB();
  },

  getLeaderboard() {
    return getAll('SELECT username, level, total_kills, total_deaths, matches_won FROM users ORDER BY level DESC, xp DESC LIMIT 50');
  },

  WEAPON_UNLOCKS, XP_PER_LEVEL, calculateLevel
};

module.exports = DB;
