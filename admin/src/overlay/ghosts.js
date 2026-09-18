import { t } from '../i18n';
import { ROLE } from '../pluginId';
import { ownMarkerRef, peersRef } from '../net/client';

const SMOOTHING = 0.25;

const ICON = {
  [ROLE.SEEKER]: '🔦',
  [ROLE.HIDER]: '🥷',
  [ROLE.SPECTATOR]: '👻',
};

/** Caught players are ghosts whatever they became, and only spectators see them. */
const appearance = (peer) => {
  if (peer.role === ROLE.SPECTATOR || (peer.caught && peer.role !== ROLE.SEEKER)) {
    return { icon: ICON[ROLE.SPECTATOR], variant: 'spectator' };
  }

  return { icon: ICON[peer.role] ?? ICON[ROLE.SPECTATOR], variant: peer.role };
};

const createNode = (peer) => {
  const el = document.createElement('div');

  el.className = 'hns-ghost';
  el.innerHTML =
    '<div class="hns-ghost__ring"></div>' +
    '<div class="hns-ghost__body"></div>' +
    '<div class="hns-ghost__name"></div>';

  return {
    el,
    body: el.querySelector('.hns-ghost__body'),
    label: el.querySelector('.hns-ghost__name'),
    pos: { x: peer.x, y: peer.y },
    variant: null,
  };
};

const place = (el, pos) => {
  el.style.transform = `translate3d(${pos.x * window.innerWidth}px, ${pos.y * window.innerHeight}px, 0)`;
};

/**
 * Positions come in at the server tick rate; this layer interpolates them on
 * every animation frame so cursors glide instead of stuttering. It writes to
 * the DOM directly — putting 20Hz of coordinates through React would re-render
 * the whole overlay for nothing.
 */
export const createGhostLayer = (container) => {
  const nodes = new Map();
  let own = null;
  let frame = null;

  const drawOwnMarker = () => {
    const marker = ownMarkerRef.current;

    if (!marker) {
      if (own) {
        own.el.remove();
        own = null;
      }

      return;
    }

    if (!own) {
      own = createNode(marker);
      own.el.classList.add('hns-ghost--own');
      own.body.textContent = ICON[ROLE.HIDER];
      own.label.textContent = t('overlay.you');
      container.appendChild(own.el);
    }

    // No smoothing: this is the authoritative position, shown raw so the player
    // can see exactly how far behind their cursor the game has them.
    own.pos = marker;
    place(own.el, own.pos);
  };

  const draw = () => {
    const peers = peersRef.current;
    const seen = new Set();

    peers.forEach((peer) => {
      seen.add(peer.id);

      let node = nodes.get(peer.id);

      if (!node) {
        node = createNode(peer);
        nodes.set(peer.id, node);
        container.appendChild(node.el);
      }

      const { icon, variant } = appearance(peer);

      if (node.variant !== variant) {
        node.variant = variant;
        node.el.classList.remove('hns-ghost--seeker', 'hns-ghost--hider', 'hns-ghost--spectator');
        node.el.classList.add(`hns-ghost--${variant}`);
      }

      node.target = peer;
      node.el.classList.toggle('hns-ghost--pinging', Boolean(peer.pinging));
      node.el.classList.toggle('hns-ghost--away', Boolean(peer.away));
      node.el.style.setProperty('--hns-progress', String(peer.catchProgress ?? 0));
      node.body.textContent = peer.away ? '💤' : icon;
      node.label.textContent = peer.name;
    });

    nodes.forEach((node, id) => {
      if (seen.has(id)) {
        return;
      }

      node.el.remove();
      nodes.delete(id);
    });

    nodes.forEach((node) => {
      node.pos.x += (node.target.x - node.pos.x) * SMOOTHING;
      node.pos.y += (node.target.y - node.pos.y) * SMOOTHING;
      place(node.el, node.pos);
    });

    drawOwnMarker();

    frame = window.requestAnimationFrame(draw);
  };

  frame = window.requestAnimationFrame(draw);

  return () => {
    window.cancelAnimationFrame(frame);
    nodes.forEach((node) => node.el.remove());
    nodes.clear();
    own?.el.remove();
  };
};
