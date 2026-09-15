'use strict';

const PLUGIN_ID = 'hide-and-seek';

/** Engine.io endpoint. Namespaced so it cannot clash with another plugin's socket server. */
const SOCKET_PATH = `/${PLUGIN_ID}/socket.io`;

const STATUS = {
  LOBBY: 'lobby',
  COUNTDOWN: 'countdown',
  HIDING: 'hiding',
  HUNTING: 'hunting',
  OVER: 'over',
};

const ROLE = {
  SEEKER: 'seeker',
  HIDER: 'hider',
  SPECTATOR: 'spectator',
};

/** Colours handed out to players, in order, so everyone is visually distinct. */
const PALETTE = [
  '#7b79ff',
  '#f29d41',
  '#5cb176',
  '#ee5e52',
  '#4945ff',
  '#d02b20',
  '#328048',
  '#be5d01',
  '#a5a5ff',
  '#66b7f1',
  '#c0362c',
  '#9736e8',
];

module.exports = { PLUGIN_ID, SOCKET_PATH, STATUS, ROLE, PALETTE };
