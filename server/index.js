const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const DB = require('./db');
const { router: authRouter } = require('./auth');
const GameServer = require('./game/core/GameServer');

async function main() {
  await DB.initDB();

  const app = express();
  const server = http.createServer(app);
  const PORT = process.env.PORT || 3000;

  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use('/api/auth', authRouter);
  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
  app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

  const wss = new WebSocketServer({ server, path: '/ws' });
  const gameServer = new GameServer(wss);

  server.listen(PORT, () => {
    console.log(`\n  WARZONE FPS SERVER running on http://localhost:${PORT}\n`);
  });
}

main().catch(err => { console.error('Startup failed:', err); process.exit(1); });
