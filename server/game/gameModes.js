/**
 * Game Mode Definitions & Logic
 * Each mode defines rules, scoring, win conditions, and respawn behavior.
 */

const GAME_MODES = {
  // ─── Free For All ─────────────────────────────────────
  ffa: {
    id: 'ffa',
    name: 'Free For All',
    description: 'Every player for themselves. First to the kill limit wins.',
    minPlayers: 2,
    maxPlayers: 12,
    teams: false,
    scoreLimit: 30,
    timeLimit: 600, // 10 minutes in seconds
    respawnTime: 3,
    friendlyFire: false,
    scoringRules: {
      kill: 100,
      headshot_bonus: 50,
      death: 0,
      assist: 25
    }
  },

  // ─── Team Deathmatch ──────────────────────────────────
  tdm: {
    id: 'tdm',
    name: 'Team Deathmatch',
    description: 'Two teams battle for kills. First team to the limit wins.',
    minPlayers: 2,
    maxPlayers: 12,
    teams: true,
    teamCount: 2,
    teamNames: ['Alpha', 'Bravo'],
    teamColors: ['#4488ff', '#ff4444'],
    scoreLimit: 50,
    timeLimit: 600,
    respawnTime: 4,
    friendlyFire: false,
    scoringRules: {
      kill: 100,
      headshot_bonus: 50,
      death: 0,
      assist: 50
    }
  },

  // ─── Search and Destroy ───────────────────────────────
  snd: {
    id: 'snd',
    name: 'Search & Destroy',
    description: 'Attack plants the bomb, defense defuses. No respawns per round.',
    minPlayers: 2,
    maxPlayers: 10,
    teams: true,
    teamCount: 2,
    teamNames: ['Attackers', 'Defenders'],
    teamColors: ['#ff8800', '#44aa44'],
    roundsToWin: 7,
    roundTime: 120,
    respawnTime: -1, // No respawn
    friendlyFire: true,
    bombTimer: 40,
    defuseTime: 7,
    plantTime: 4,
    scoringRules: {
      kill: 200,
      headshot_bonus: 50,
      plant_bomb: 300,
      defuse_bomb: 500,
      round_win: 500
    },
    bombSites: ['A', 'B']
  },

  // ─── Plant and Defuse ─────────────────────────────────
  plant_defuse: {
    id: 'plant_defuse',
    name: 'Plant & Defuse',
    description: 'Tactical rounds: Prep → Engagement → Debrief. Best of 5.',
    minPlayers: 2,
    maxPlayers: 10,
    teams: true,
    teamCount: 2,
    teamNames: ['Attackers', 'Defenders'],
    teamColors: ['#ff8800', '#44aa44'],
    roundsToWin: 3,
    prepTime: 60,
    engagementTime: 150,
    debriefTime: 15,
    respawnTime: -1,
    friendlyFire: false,
    bombTimer: 40,
    defuseTime: 7,
    plantTime: 4,
    scoringRules: {
      kill: 200,
      headshot_bonus: 50,
      plant_bomb: 300,
      defuse_bomb: 500,
      round_win: 500
    },
    bombSites: ['A', 'B']
  },

  // ─── Domination ───────────────────────────────────────
  domination: {
    id: 'domination',
    name: 'Domination',
    description: 'Capture and hold control points to earn score.',
    minPlayers: 2,
    maxPlayers: 12,
    teams: true,
    teamCount: 2,
    teamNames: ['Alpha', 'Bravo'],
    teamColors: ['#4488ff', '#ff4444'],
    scoreLimit: 200,
    timeLimit: 600,
    respawnTime: 5,
    friendlyFire: false,
    captureTime: 8,
    pointsPerTick: 1,
    tickInterval: 5, // Score tick every 5 seconds
    controlPoints: ['A', 'B', 'C'],
    scoringRules: {
      kill: 50,
      headshot_bonus: 25,
      capture: 200,
      neutralize: 100
    }
  }
};

/**
 * Game Mode State Manager
 * Handles mode-specific state tracking
 */
class GameModeState {
  constructor(modeId) {
    this.mode = GAME_MODES[modeId];
    this.modeId = modeId;
    this.teamScores = {};
    this.playerScores = {};
    this.round = 1;
    this.roundPhase = 'playing'; // playing, round_end, game_end
    this.startTime = Date.now();
    this.roundStartTime = Date.now();
    this.roundWins = {};
    this.winner = null;

    // Mode-specific state
    if (modeId === 'snd') {
      this.bombPlanted = false;
      this.bombSite = null;
      this.bombPlantTime = 0;
      this.bombCarrier = null;
      this.alivePlayers = { 0: [], 1: [] };
    }

    if (modeId === 'plant_defuse') {
      this.bombPlanted = false;
      this.bombSite = null;
      this.bombPlantTime = 0;
      this.bombCarrier = null;
      this.alivePlayers = { 0: [], 1: [] };
      this.phase = 'preparation'; // preparation, engagement, debrief
      this.phaseStartTime = Date.now();
    }

    if (modeId === 'domination') {
      this.controlPoints = {};
      for (const cp of this.mode.controlPoints) {
        this.controlPoints[cp] = {
          owner: -1,
          captureProgress: 0,
          capturingTeam: -1,
          contested: false
        };
      }
      this.lastTickTime = Date.now();
    }

    // Initialize team scores
    if (this.mode.teams) {
      for (let i = 0; i < this.mode.teamCount; i++) {
        this.teamScores[i] = 0;
        if (modeId === 'snd') {
          this.roundWins[i] = 0;
        }
      }
    }
  }

  addPlayer(playerId, team = -1) {
    this.playerScores[playerId] = {
      kills: 0,
      deaths: 0,
      score: 0,
      assists: 0,
      team
    };

    if (this.modeId === 'snd' && team >= 0) {
      if (!this.alivePlayers[team]) this.alivePlayers[team] = [];
      this.alivePlayers[team].push(playerId);
    }
    if (this.modeId === 'plant_defuse' && team >= 0) {
      if (!this.alivePlayers[team]) this.alivePlayers[team] = [];
      this.alivePlayers[team].push(playerId);
    }
  }

  removePlayer(playerId) {
    const pScore = this.playerScores[playerId];
    if ((this.modeId === 'snd' || this.modeId === 'plant_defuse') && pScore) {
      const team = pScore.team;
      if (this.alivePlayers[team]) {
        this.alivePlayers[team] = this.alivePlayers[team].filter(id => id !== playerId);
      }
    }
    delete this.playerScores[playerId];
  }

  onKill(killerId, victimId, isHeadshot) {
    const rules = this.mode.scoringRules;
    let events = [];

    // Update killer score
    if (this.playerScores[killerId]) {
      this.playerScores[killerId].kills++;
      this.playerScores[killerId].score += rules.kill;
      if (isHeadshot) {
        this.playerScores[killerId].score += rules.headshot_bonus;
      }

      // Team score for TDM/FFA
      if (this.modeId === 'tdm') {
        const team = this.playerScores[killerId].team;
        this.teamScores[team] = (this.teamScores[team] || 0) + 1;
      }
    }

    // Update victim
    if (this.playerScores[victimId]) {
      this.playerScores[victimId].deaths++;
    }

    // FFA individual score check
    if (this.modeId === 'ffa') {
      if (this.playerScores[killerId] && this.playerScores[killerId].kills >= this.mode.scoreLimit) {
        this.winner = killerId;
        this.roundPhase = 'game_end';
        events.push({ type: 'game_over', winner: killerId });
      }
    }

    // TDM team score check
    if (this.modeId === 'tdm') {
      for (const [team, score] of Object.entries(this.teamScores)) {
        if (score >= this.mode.scoreLimit) {
          this.winner = parseInt(team);
          this.roundPhase = 'game_end';
          events.push({ type: 'game_over', winnerTeam: parseInt(team) });
        }
      }
    }

    // SnD - track alive players
    if (this.modeId === 'snd' && this.playerScores[victimId]) {
      const victimTeam = this.playerScores[victimId].team;
      this.alivePlayers[victimTeam] = this.alivePlayers[victimTeam].filter(id => id !== victimId);

      // Check if team is eliminated
      if (this.alivePlayers[victimTeam].length === 0) {
        const winnerTeam = victimTeam === 0 ? 1 : 0;
        events.push(...this.endRound(winnerTeam));
      }
    }

    return events;
  }

  // SnD specific
  endRound(winnerTeam) {
    let events = [];
    this.roundWins[winnerTeam]++;
    this.roundPhase = 'round_end';

    events.push({
      type: 'round_end',
      winnerTeam,
      roundWins: { ...this.roundWins },
      round: this.round
    });

    if (this.roundWins[winnerTeam] >= this.mode.roundsToWin) {
      this.winner = winnerTeam;
      this.roundPhase = 'game_end';
      events.push({ type: 'game_over', winnerTeam });
    }

    return events;
  }

  startNewRound() {
    this.round++;
    this.roundPhase = 'playing';
    this.roundStartTime = Date.now();
    this.bombPlanted = false;
    this.bombSite = null;
    this.bombCarrier = null;

    // Reset alive players
    for (const team of Object.keys(this.alivePlayers)) {
      this.alivePlayers[team] = Object.entries(this.playerScores)
        .filter(([_, data]) => data.team === parseInt(team))
        .map(([id]) => id);
    }

    // Swap teams every round
    if (this.round % 2 === 0) {
      // Swap attack/defense
    }
  }

  // Domination tick
  dominationTick() {
    if (this.modeId !== 'domination') return [];
    const now = Date.now();
    if (now - this.lastTickTime < this.mode.tickInterval * 1000) return [];

    this.lastTickTime = now;
    let events = [];

    for (const [cp, state] of Object.entries(this.controlPoints)) {
      if (state.owner >= 0) {
        this.teamScores[state.owner] = (this.teamScores[state.owner] || 0) + this.mode.pointsPerTick;
      }
    }

    // Check win
    for (const [team, score] of Object.entries(this.teamScores)) {
      if (score >= this.mode.scoreLimit) {
        this.winner = parseInt(team);
        this.roundPhase = 'game_end';
        events.push({ type: 'game_over', winnerTeam: parseInt(team) });
      }
    }

    events.push({
      type: 'score_update',
      teamScores: { ...this.teamScores }
    });

    return events;
  }

  checkTimeLimit() {
    const elapsed = (Date.now() - this.startTime) / 1000;
    const timeLimit = this.modeId === 'snd' ? this.mode.roundTime : this.mode.timeLimit;

    if (elapsed >= timeLimit && this.roundPhase === 'playing') {
      this.roundPhase = 'game_end';

      // Determine winner by score
      if (this.mode.teams) {
        let maxScore = -1;
        let winTeam = 0;
        for (const [team, score] of Object.entries(this.teamScores)) {
          if (score > maxScore) {
            maxScore = score;
            winTeam = parseInt(team);
          }
        }
        this.winner = winTeam;
        return [{ type: 'game_over', winnerTeam: winTeam, reason: 'time' }];
      } else {
        let maxKills = -1;
        let winnerId = null;
        for (const [id, data] of Object.entries(this.playerScores)) {
          if (data.kills > maxKills) {
            maxKills = data.kills;
            winnerId = id;
          }
        }
        this.winner = winnerId;
        return [{ type: 'game_over', winner: winnerId, reason: 'time' }];
      }
    }
    return [];
  }

  updatePhase() {
    if (this.modeId !== 'plant_defuse' || this.roundPhase !== 'playing') return [];

    const elapsed = (Date.now() - this.phaseStartTime) / 1000;
    const events = [];

    if (this.phase === 'preparation' && elapsed >= this.mode.prepTime) {
      this.phase = 'engagement';
      this.phaseStartTime = Date.now();
      events.push({ type: 'phase_change', phase: this.phase, timeLimit: this.mode.engagementTime, round: this.round });
    }
    else if (this.phase === 'engagement' && elapsed >= this.mode.engagementTime) {
      this.phase = 'debrief';
      this.phaseStartTime = Date.now();
      // Defenders win if time runs out and bomb not planted
      const winTeam = 1;
      this.roundWins[winTeam]++;
      events.push({ type: 'round_end', winnerTeam: winTeam, reason: 'time' });
      events.push({ type: 'phase_change', phase: this.phase, timeLimit: this.mode.debriefTime, winnerTeam: winTeam });
      
      if (this.roundWins[winTeam] >= this.mode.roundsToWin) {
        this.winner = winTeam;
        events.push({ type: 'game_over', winnerTeam: winTeam });
      }
    }
    else if (this.phase === 'debrief' && elapsed >= this.mode.debriefTime) {
      this.round++;
      this.phase = 'preparation';
      this.phaseStartTime = Date.now();
      events.push({ type: 'round_start', round: this.round });
      events.push({ type: 'phase_change', phase: this.phase, timeLimit: this.mode.prepTime, round: this.round });
    }

    return events;
  }

  getScoreboard() {
    const players = Object.entries(this.playerScores)
      .map(([id, data]) => ({ id, ...data }))
      .sort((a, b) => b.score - a.score);

    return {
      mode: this.modeId,
      players,
      teamScores: this.mode.teams ? this.teamScores : null,
      round: this.round,
      roundWins: this.modeId === 'snd' ? this.roundWins : null,
      controlPoints: this.modeId === 'domination' ? this.controlPoints : null,
      timeRemaining: this.getTimeRemaining()
    };
  }

  getTimeRemaining() {
    const timeLimit = this.modeId === 'snd' ? this.mode.roundTime : this.mode.timeLimit;
    const elapsed = (Date.now() - (this.modeId === 'snd' ? this.roundStartTime : this.startTime)) / 1000;
    return Math.max(0, Math.floor(timeLimit - elapsed));
  }

  getSpawnTeam(playerCount) {
    // Auto-balance teams
    if (!this.mode.teams) return -1;

    const teamCounts = {};
    for (let i = 0; i < this.mode.teamCount; i++) teamCounts[i] = 0;

    for (const data of Object.values(this.playerScores)) {
      if (data.team >= 0) teamCounts[data.team]++;
    }

    let minTeam = 0;
    let minCount = Infinity;
    for (const [team, count] of Object.entries(teamCounts)) {
      if (count < minCount) {
        minCount = count;
        minTeam = parseInt(team);
      }
    }
    return minTeam;
  }
}

module.exports = { GAME_MODES, GameModeState };
