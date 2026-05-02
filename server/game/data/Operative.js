const OPERATIVES = {
  vega: {
    id: 'vega',
    name: 'Vega',
    role: 'Breacher',
    characterModel: 'Knight',
    ability: {
      id: 'wall_charge',
      name: 'Breach Charge',
      cooldownMs: 45000,
      radius: 5,
      damage: 80,
      falloff: 0.5,
      duration: 0
    },
    defaultPrimary: 'ak47',
    defaultSecondary: 'desert_eagle'
  },
  prism: {
    id: 'prism',
    name: 'Prism',
    role: 'Recon',
    characterModel: 'Ranger',
    ability: {
      id: 'recon_drone',
      name: 'Recon Drone',
      cooldownMs: 30000,
      radius: 15,
      damage: 0,
      duration: 5000
    },
    defaultPrimary: 'm4a1_s',
    defaultSecondary: 'auto_pistol'
  }
};

/**
 * Execute an operative's ability. Server-authoritative.
 * @param {object} operative - OPERATIVES entry
 * @param {Player} player - the player using the ability
 * @param {GameRoom} gameRoom - current game room
 * @returns {object} result with success flag and effect data
 */
function executeAbility(operative, player, gameRoom) {
  const ability = operative.ability;
  const now = Date.now();

  if (!player.alive) return { success: false, reason: 'dead' };
  if (player.abilityCooldownEnd && now < player.abilityCooldownEnd) {
    return { success: false, reason: 'cooldown', remaining: player.abilityCooldownEnd - now };
  }

  player.abilityCooldownEnd = now + ability.cooldownMs;

  if (ability.id === 'wall_charge') {
    return executeWallCharge(ability, player, gameRoom);
  }

  if (ability.id === 'recon_drone') {
    return executeReconDrone(ability, player, gameRoom);
  }

  return { success: false, reason: 'unknown_ability' };
}

function executeWallCharge(ability, player, gameRoom) {
  const results = [];
  const allTargets = [...gameRoom.players.values(), ...gameRoom.bots.values()];

  for (const target of allTargets) {
    if (target.id === player.id) continue;
    if (!target.alive) continue;
    if (gameRoom.mode.teams && target.team === player.team && player.team >= 0) continue;

    const dx = target.position.x - player.position.x;
    const dz = target.position.z - player.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist <= ability.radius) {
      const dmgFactor = 1 - (dist / ability.radius) * ability.falloff;
      const dmg = Math.round(ability.damage * dmgFactor);
      const result = target.takeDamage(dmg, player.id);
      results.push({ targetId: target.id, damage: dmg, died: result.died });
      if (result.died) {
        gameRoom.handleKill(player.id, target.id, false);
      }
    }
  }

  return {
    success: true,
    abilityId: ability.id,
    position: { ...player.position },
    results
  };
}

function executeReconDrone(ability, player, gameRoom) {
  const revealed = [];
  const allTargets = [...gameRoom.players.values(), ...gameRoom.bots.values()];

  for (const target of allTargets) {
    if (target.id === player.id) continue;
    if (!target.alive) continue;
    if (gameRoom.mode.teams && target.team === player.team && player.team >= 0) continue;

    const dx = target.position.x - player.position.x;
    const dz = target.position.z - player.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist <= ability.radius) {
      revealed.push({ id: target.id, position: { ...target.position } });
    }
  }

  return {
    success: true,
    abilityId: ability.id,
    position: { ...player.position },
    revealed,
    duration: ability.duration
  };
}

module.exports = { OPERATIVES, executeAbility };
