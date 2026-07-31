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
const PLAYER_COLORS = [
  '#e63946',
  '#4f7cff',
  '#06d6a0',
  '#ff6b9d',
  '#1eb5db',
  '#40916c',
  '#c1121f',
  '#1e40af',
  '#22c55e',
  '#e67e22',
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
const TEAM_PALETTE_INDICES = [
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
];
const TEAM_PALETTES = TEAM_PALETTE_INDICES.map((indices) => indices.map((i) => PLAYER_COLORS[i]));
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
  BOT_NAME_POOLS,
  TEAM_COLORS,
  TEAM_NAMES,
  TEAM_PALETTE_INDICES,
  TEAM_PALETTES,
  TEAM_CONFIGS,
};
