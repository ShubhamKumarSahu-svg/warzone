const express = require('express');
const jwt = require('jsonwebtoken');
const DB = require('./db');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'fps-game-secret-key-change-in-production';
const TOKEN_EXPIRY = '7d';

// ─── Middleware ──────────────────────────────────────────
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Token required' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
}

// ─── Routes ─────────────────────────────────────────────

// POST /api/auth/signup
router.post('/signup', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  if (username.length < 3 || username.length > 20) {
    return res.status(400).json({ error: 'Username must be 3-20 characters' });
  }
  if (password.length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters' });
  }
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return res.status(400).json({ error: 'Username can only contain letters, numbers, and underscores' });
  }

  const result = DB.createUser(username, password);
  if (!result) {
    return res.status(409).json({ error: 'Username already taken' });
  }

  const token = jwt.sign({ id: result.id, username: result.username }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
  const user = DB.getUser(result.id);

  res.json({ token, user });
});

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const authResult = DB.authenticateUser(username, password);
  if (!authResult) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign({ id: authResult.id, username: authResult.username }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
  const user = DB.getUser(authResult.id);

  res.json({ token, user });
});

// GET /api/auth/profile
router.get('/profile', authenticateToken, (req, res) => {
  const user = DB.getUser(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
});

// PUT /api/auth/loadout
router.put('/loadout', authenticateToken, (req, res) => {
  const { primary, secondary } = req.body;
  const user = DB.getUser(req.user.id);

  if (!user) return res.status(404).json({ error: 'User not found' });

  // Validate weapons are unlocked
  if (primary && !user.unlocked_weapons.includes(primary)) {
    return res.status(400).json({ error: 'Primary weapon not unlocked' });
  }
  if (secondary && !user.unlocked_weapons.includes(secondary)) {
    return res.status(400).json({ error: 'Secondary weapon not unlocked' });
  }

  DB.updateLoadout(
    req.user.id,
    primary || user.selected_primary,
    secondary || user.selected_secondary
  );

  res.json({ success: true });
});

// GET /api/auth/history
router.get('/history', authenticateToken, (req, res) => {
  const history = DB.getMatchHistory(req.user.id);
  res.json({ history });
});

// GET /api/leaderboard
router.get('/leaderboard', (req, res) => {
  const leaderboard = DB.getLeaderboard();
  res.json({ leaderboard });
});

module.exports = { router, authenticateToken, JWT_SECRET };
