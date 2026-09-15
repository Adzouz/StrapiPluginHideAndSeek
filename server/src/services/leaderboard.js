'use strict';

const STORE_KEY = 'leaderboard';
const MAX_ROWS = 100;

const FOUND_POINTS = 10;
const SURVIVED_POINTS = 20;

const emptyRow = (player) => ({
  id: player.id,
  name: player.name,
  color: player.color,
  rounds: 0,
  seekerRounds: 0,
  found: 0,
  caught: 0,
  survived: 0,
});

/**
 * Running totals across rounds, kept in the core store rather than a content
 * type: a game plugin has no business adding a collection to somebody's Content
 * Manager, and one aggregate row per player is all a leaderboard needs.
 */
module.exports = ({ strapi }) => {
  const store = () => strapi.store({ type: 'plugin', name: 'hide-and-seek' });

  let cache = null;

  const load = async () => {
    if (!cache) {
      cache = (await store().get({ key: STORE_KEY })) ?? {};
    }

    return cache;
  };

  const points = (row) => row.found * FOUND_POINTS + row.survived * SURVIVED_POINTS;

  const rows = async () => {
    const data = await load();

    return Object.values(data)
      .map((row) => ({ ...row, points: points(row) }))
      .sort(
        (a, b) => b.points - a.points || b.found - a.found || a.name.localeCompare(b.name)
      )
      .slice(0, MAX_ROWS);
  };

  /**
   * @param participants one entry per player who actually had a role in the round
   */
  const record = async (participants = []) => {
    const data = await load();

    participants.forEach((participant) => {
      const row = data[participant.id] ?? emptyRow(participant);

      // Names and colours can change between rounds; always keep the latest.
      row.name = participant.name;
      row.color = participant.color;
      row.rounds += 1;
      row.found += participant.found;

      if (participant.startedAs === 'seeker') {
        row.seekerRounds += 1;
      }

      if (participant.caught) {
        row.caught += 1;
      }

      if (participant.survived) {
        row.survived += 1;
      }

      data[participant.id] = row;
    });

    cache = data;
    await store().set({ key: STORE_KEY, value: data });

    return rows();
  };

  return { rows, record };
};
