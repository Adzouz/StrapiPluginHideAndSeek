'use strict';

module.exports = {
  admin: {
    type: 'admin',
    routes: [
      {
        method: 'GET',
        path: '/ticket',
        handler: 'game.ticket',
        config: { policies: [] },
      },
      {
        method: 'GET',
        path: '/ping',
        handler: 'game.ping',
        config: { policies: [] },
      },
    ],
  },
};
