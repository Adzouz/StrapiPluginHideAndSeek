'use strict';

const config = require('./config');
const controllers = require('./controllers');
const { protectPlayers } = require('./middlewares/protect-players');
const realtime = require('./realtime');
const routes = require('./routes');
const services = require('./services');

module.exports = {
  register() {},

  bootstrap({ strapi }) {
    realtime.setup({ strapi });
    protectPlayers({ strapi });
  },

  destroy() {
    realtime.teardown();
  },

  config,
  controllers,
  routes,
  services,
  contentTypes: {},
};
