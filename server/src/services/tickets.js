'use strict';

const crypto = require('crypto');

const TTL_MS = 30_000;

/**
 * Short-lived, single-use handshake tickets. The admin panel asks for one over
 * the authenticated REST route, then hands it to the socket server — so the
 * socket layer never has to know how Strapi stores admin sessions.
 */
module.exports = () => {
  const tickets = new Map();

  const sweep = () => {
    const now = Date.now();

    tickets.forEach((value, key) => {
      if (value.expiresAt <= now) {
        tickets.delete(key);
      }
    });
  };

  return {
    issue(user) {
      sweep();

      const ticket = crypto.randomBytes(24).toString('hex');

      tickets.set(ticket, {
        expiresAt: Date.now() + TTL_MS,
        user: {
          id: user.id,
          firstname: user.firstname,
          lastname: user.lastname,
          username: user.username,
          email: user.email,
        },
      });

      return { ticket, expiresIn: TTL_MS };
    },

    consume(ticket) {
      sweep();

      const entry = tickets.get(ticket);

      if (!entry) {
        return null;
      }

      tickets.delete(ticket);

      return entry.user;
    },
  };
};
