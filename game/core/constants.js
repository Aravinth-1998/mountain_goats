const MOUNTAIN_DEFS = [
  { value: 5, height: 4, fullStack: 12, color: '#4a8f3c' },
  { value: 6, height: 4, fullStack: 11, color: '#c9772f' },
  { value: 7, height: 3, fullStack: 10, color: '#9c4f3a' },
  { value: 8, height: 3, fullStack: 9, color: '#6b7280' },
  { value: 9, height: 2, fullStack: 8, color: '#3f7fa6' },
  { value: 10, height: 2, fullStack: 7, color: '#aab8c9' },
];
const BONUS_DEFS = [15, 12, 9, 6];
const NUM_DICE = 4;
const MAX_PLAYERS = 10;
// 5 red + 5 blue + 5 green + 5 other (no white/black/gold/silver).
const PLAYER_COLORS = [
  // Red (dark -> light)
  '#9d0208',
  '#c1121f',
  '#e63946',
  '#ff5c5c',
  '#ff8fab',
  // Blue (dark -> light)
  '#1e40af',
  '#1d4ed8',
  '#3b82f6',
  '#4f7cff',
  '#93c5fd',
  // Green (dark -> light)
  '#15803d',
  '#40916c',
  '#22c55e',
  '#06d6a0',
  '#86efac',
  // Other
  '#a855f7', // purple
  '#e67e22', // orange
  '#ec4899', // magenta
  '#92400e', // brown
  '#7c3aed', // violet
];
const BOT_NAME_POOLS = [
  ['Zorro', 'Zenith'],
  ['Ymir', 'Yeti'],
  ['Xenon', 'Xander'],
  ['Wolf', 'Wraith'],
  ['Vector', 'Viper'],
  ['Umbra', 'Ursula'],
  ['Titan', 'Talon'],
  ['Storm', 'Specter'],
  ['Raven', 'Rogue'],
];

const TEAM_COLORS = ['#e63946', '#4f7cff', '#06d6a0'];
const TEAM_NAMES = ['Red', 'Blue', 'Green'];
const PLAYER_COLOR_GROUPS = [
  PLAYER_COLORS.slice(0, 5),
  PLAYER_COLORS.slice(5, 10),
  PLAYER_COLORS.slice(10, 15),
  PLAYER_COLORS.slice(15, 20),
];
// Full 5 shades per team (Red / Blue / Green).
const TEAM_PALETTES = [
  PLAYER_COLOR_GROUPS[0],
  PLAYER_COLOR_GROUPS[1],
  PLAYER_COLOR_GROUPS[2],
];
const TEAM_CONFIGS = [
  { total: 4, teams: 2, perTeam: 2 },
  { total: 6, teams: 2, perTeam: 3 },
  { total: 6, teams: 3, perTeam: 2 },
];

module.exports = {
  MOUNTAIN_DEFS,
  BONUS_DEFS,
  NUM_DICE,
  MAX_PLAYERS,
  PLAYER_COLORS,
  PLAYER_COLOR_GROUPS,
  BOT_NAME_POOLS,
  TEAM_COLORS,
  TEAM_NAMES,
  TEAM_PALETTES,
  TEAM_CONFIGS,
};
