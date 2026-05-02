/**
 * UIManager - HUD updates, kill feed, scoreboard, menus
 */
class UIManager {
  constructor() {
    this.elements = {};
    this.killFeedTimeout = [];
    this.cacheElements();
  }

  cacheElements() {
    const ids = [
      'health-bar', 'health-value', 'ammo-current', 'ammo-reserve', 'weapon-name',
      'kill-feed', 'match-timer', 'match-score', 'hit-marker', 'damage-indicator',
      'reload-indicator', 'death-screen', 'killed-by', 'respawn-countdown',
      'scoreboard-overlay', 'scoreboard-body', 'scoreboard-teams', 'scoreboard-title',
      'game-over-overlay', 'game-over-result', 'game-over-stats',
      'pause-menu', 'crosshair', 'chat-messages', 'chat-input', 'minimap-canvas',
      'ability-icon', 'ability-cooldown-arc', 'phase-banner', 'phase-title', 'phase-timer'
    ];
    ids.forEach(id => { this.elements[id] = document.getElementById(id); });
  }

  el(id) { return this.elements[id]; }

  updateHealth(hp) {
    const bar = this.el('health-bar');
    const val = this.el('health-value');
    if (bar) bar.style.width = hp + '%';
    if (val) val.textContent = Math.round(hp);
    if (val) val.style.color = hp < 30 ? '#ff4444' : hp < 60 ? '#ffaa00' : '#e0e8f0';
  }

  updateAmmo(current, reserve) {
    const cur = this.el('ammo-current');
    const res = this.el('ammo-reserve');
    if (cur) cur.textContent = current;
    if (res) res.textContent = reserve;
    if (cur) cur.style.color = current <= 5 ? '#ff4444' : '#e0e8f0';
  }

  updateWeaponName(name) {
    const el = this.el('weapon-name');
    if (el) el.textContent = name;
  }

  updateTimer(seconds) {
    const el = this.el('match-timer');
    if (!el) return;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    el.textContent = `${m}:${s.toString().padStart(2, '0')}`;
    if (seconds < 30) el.style.color = '#ff4444';
  }

  updateMatchScore(scoreData) {
    const el = this.el('match-score');
    if (!el || !scoreData) return;
    if (scoreData.teamScores) {
      const t = scoreData.teamScores;
      el.innerHTML = `<span style="color:#4488ff">${t[0] || 0}</span> — <span style="color:#ff4444">${t[1] || 0}</span>`;
    }
  }

  showHitMarker(headshot) {
    const el = this.el('hit-marker');
    if (!el) return;
    el.className = 'hit-marker active' + (headshot ? ' headshot' : '');
    setTimeout(() => { el.className = 'hit-marker'; }, 200);
  }

  showDamageIndicator() {
    const el = this.el('damage-indicator');
    if (!el) return;
    el.innerHTML = '<div class="damage-vignette"></div>';
    el.className = 'damage-indicator active';
    setTimeout(() => { el.className = 'damage-indicator'; }, 400);
  }

  showReloading(show) {
    const el = this.el('reload-indicator');
    if (el) el.className = show ? 'reload-indicator active' : 'reload-indicator';
  }

  showDeathScreen(killerName, respawnTime) {
    const el = this.el('death-screen');
    const kb = this.el('killed-by');
    if (kb) kb.textContent = killerName;
    if (el) el.className = 'death-screen active';

    let countdown = respawnTime;
    const cd = this.el('respawn-countdown');
    const interval = setInterval(() => {
      countdown--;
      if (cd) cd.textContent = countdown;
      if (countdown <= 0) clearInterval(interval);
    }, 1000);
  }

  hideDeathScreen() {
    const el = this.el('death-screen');
    if (el) el.className = 'death-screen';
  }

  addKillFeedEntry(killer, victim, weapon, headshot) {
    const feed = this.el('kill-feed');
    if (!feed) return;
    const entry = document.createElement('div');
    entry.className = 'kill-entry';
    entry.innerHTML = `<span class="killer">${killer}</span> <span class="weapon-tag">[${weapon}]</span>${headshot ? ' 💀' : ''} <span class="victim">${victim}</span>`;
    feed.appendChild(entry);
    setTimeout(() => { if (entry.parentNode) entry.parentNode.removeChild(entry); }, 5000);
    while (feed.children.length > 6) feed.removeChild(feed.firstChild);
  }

  updateScoreboard(scoreboard, selfId) {
    const body = this.el('scoreboard-body');
    const teams = this.el('scoreboard-teams');
    if (!body) return;

    body.innerHTML = '';
    if (scoreboard.teamScores && teams) {
      teams.innerHTML = `<span style="color:#4488ff">${scoreboard.teamScores[0] || 0}</span><span style="color:var(--text-dim)">vs</span><span style="color:#ff4444">${scoreboard.teamScores[1] || 0}</span>`;
    }

    (scoreboard.players || []).forEach(p => {
      const row = document.createElement('tr');
      if (p.id === selfId) row.className = 'self';
      row.innerHTML = `<td>${p.id === selfId ? '► ' : ''}${p.username || p.id.slice(0, 8)}</td><td>${p.kills}</td><td>${p.deaths}</td><td>${p.assists || 0}</td><td>${p.score}</td>`;
      body.appendChild(row);
    });
  }

  showScoreboard(show) {
    const el = this.el('scoreboard-overlay');
    if (el) el.className = show ? 'scoreboard-overlay active' : 'scoreboard-overlay';
  }

  showGameOver(result, stats) {
    const el = this.el('game-over-overlay');
    const res = this.el('game-over-result');
    const st = this.el('game-over-stats');
    if (res) {
      res.textContent = result;
      res.style.color = result === 'VICTORY' ? '#00ff88' : '#ff4444';
    }
    if (st) st.innerHTML = stats;
    if (el) el.className = 'game-over-overlay active';
  }

  hideGameOver() {
    const el = this.el('game-over-overlay');
    if (el) el.className = 'game-over-overlay';
  }

  showPauseMenu(show) {
    const el = this.el('pause-menu');
    if (el) el.className = show ? 'pause-menu active' : 'pause-menu';
  }

  updateCrosshairSpread(shooting) {
    const el = this.el('crosshair');
    if (el) el.className = shooting ? 'crosshair spread' : 'crosshair';
  }

  addChatMessage(name, message) {
    const el = this.el('chat-messages');
    if (!el) return;
    const msg = document.createElement('div');
    msg.className = 'chat-msg';
    msg.innerHTML = `<span class="chat-name">${name}:</span> ${message}`;
    el.appendChild(msg);
    el.scrollTop = el.scrollHeight;
    while (el.children.length > 50) el.removeChild(el.firstChild);
  }

  updateMinimap(selfPos, players, mapSize) {
    const canvas = this.el('minimap-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    const scale = w / (mapSize || 60);

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(10,14,23,0.8)';
    ctx.fillRect(0, 0, w, h);

    // Draw self
    const sx = w / 2, sy = h / 2;
    ctx.fillStyle = '#00f0ff';
    ctx.beginPath();
    ctx.arc(sx, sy, 4, 0, Math.PI * 2);
    ctx.fill();

    // Other players relative to self
    if (players && selfPos) {
      players.forEach(p => {
        if (!p.alive) return;
        const rx = (p.position.x - selfPos.x) * scale + w / 2;
        const ry = (p.position.z - selfPos.z) * scale + h / 2;
        if (rx < 0 || rx > w || ry < 0 || ry > h) return;
        ctx.fillStyle = p.team === 0 ? '#4488ff' : p.team === 1 ? '#ff4444' : '#ffaa00';
        ctx.beginPath();
        ctx.arc(rx, ry, 3, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    // Draw active pings
    if (this.minimapPings) {
      const now = Date.now();
      this.minimapPings = this.minimapPings.filter(p => now < p.expires);
      this.minimapPings.forEach(p => {
        const rx = (p.position.x - selfPos.x) * scale + w / 2;
        const ry = (p.position.z - selfPos.z) * scale + h / 2;
        if (rx >= 0 && rx <= w && ry >= 0 && ry <= h) {
          ctx.fillStyle = '#ff0000';
          ctx.beginPath();
          ctx.arc(rx, ry, 5, 0, Math.PI * 2);
          ctx.fill();
          // Radar ping pulse effect
          const pulse = (now % 1000) / 1000;
          ctx.strokeStyle = `rgba(255, 0, 0, ${1 - pulse})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(rx, ry, 5 + pulse * 10, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    }
  }

  showPingOnMinimap(position, duration) {
    if (!this.minimapPings) this.minimapPings = [];
    this.minimapPings.push({
      position,
      expires: Date.now() + duration
    });
  }

  updateAbilityCooldown(cooldownEnd) {
    if (this.cooldownInterval) clearInterval(this.cooldownInterval);
    const icon = this.el('ability-icon');
    const arc = this.el('ability-cooldown-arc');
    if (!icon || !arc) return;

    const tick = () => {
      const now = Date.now();
      if (now >= cooldownEnd) {
        icon.style.opacity = '1';
        arc.style.height = '0%';
        clearInterval(this.cooldownInterval);
      } else {
        icon.style.opacity = '0.3';
        // Assume max 45s cooldown for display scaling
        const pct = Math.min(100, ((cooldownEnd - now) / 45000) * 100);
        arc.style.height = `${pct}%`;
      }
    };
    
    tick();
    if (Date.now() < cooldownEnd) {
      this.cooldownInterval = setInterval(tick, 100);
    }
  }

  showPhaseBanner(phase, duration, subtitle) {
    const banner = this.el('phase-banner');
    const titleEl = this.el('phase-title');
    const timerEl = this.el('phase-timer');
    if (!banner || !titleEl || !timerEl) return;

    if (this.phaseTimerInterval) clearInterval(this.phaseTimerInterval);

    let phaseName = phase.toUpperCase();
    if (subtitle && phase === 'engagement') phaseName = `ROUND ${subtitle} - ENGAGEMENT`;
    else if (subtitle && phase !== 'engagement') phaseName = subtitle;

    titleEl.textContent = phaseName;
    banner.className = `phase-banner active phase-${phase}`;

    let seconds = duration;
    const update = () => {
      if (seconds <= 0) {
        if (phase === 'debrief' || phase === 'preparation') banner.className = 'phase-banner';
        clearInterval(this.phaseTimerInterval);
        return;
      }
      const m = Math.floor(seconds / 60);
      const s = Math.floor(seconds % 60);
      timerEl.textContent = `${m}:${s.toString().padStart(2, '0')}`;
      seconds--;
    };
    
    update();
    this.phaseTimerInterval = setInterval(update, 1000);
    
    // Auto-hide engagement banner after 5 seconds
    if (phase === 'engagement') {
      setTimeout(() => {
        banner.className = 'phase-banner';
      }, 5000);
    }
  }
}
