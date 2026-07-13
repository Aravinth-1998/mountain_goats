const { scoreOf } = require('../scoring/scoring');

function getTeamOfPlayer(room, playerId) {
  if (!room.teamMode) return null;
  return room.teams ? room.teams.find((t) => t.members.includes(playerId)) : null;
}

function getTeamById(room, teamId) {
  if (!room.teams) return null;
  return room.teams.find((t) => t.id === teamId);
}

function areTeammates(room, p1Id, p2Id) {
  if (!room.teamMode) return false;
  const t1 = getTeamOfPlayer(room, p1Id);
  const t2 = getTeamOfPlayer(room, p2Id);
  return t1 && t2 && t1.id === t2.id;
}

function teamScoreOf(room, team) {
  let total = 0;
  team.members.forEach((pid) => {
    const p = room.players.find((pl) => pl.id === pid);
    if (p) total += scoreOf(room, p);
  });
  return total;
}

function teamTopsOf(room, team) {
  let n = 0;
  room.mountains.forEach((m, i) => {
    const hasTop = team.members.some((pid) => {
      const p = room.players.find((pl) => pl.id === pid);
      return p && p.pos[i] >= m.height;
    });
    if (hasTop) n++;
  });
  return n;
}

function teamHighestTopValue(room, team) {
  let v = 0;
  room.mountains.forEach((m, i) => {
    const hasTop = team.members.some((pid) => {
      const p = room.players.find((pl) => pl.id === pid);
      return p && p.pos[i] >= m.height;
    });
    if (hasTop && m.value > v) v = m.value;
  });
  return v;
}

function teamHasSummit(room, player, mountainIndex) {
  if (!room.teamMode) return false;
  const team = getTeamOfPlayer(room, player.id);
  if (!team) return false;
  const m = room.mountains[mountainIndex];
  return team.members.some((pid) => {
    if (pid === player.id) return false;
    const p = room.players.find((pl) => pl.id === pid);
    return p && p.pos[mountainIndex] >= m.height;
  });
}

module.exports = {
  getTeamOfPlayer,
  getTeamById,
  areTeammates,
  teamScoreOf,
  teamTopsOf,
  teamHighestTopValue,
  teamHasSummit,
};
