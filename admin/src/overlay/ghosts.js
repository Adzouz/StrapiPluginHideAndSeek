import { ROLE } from '../pluginId';
import { peersRef } from '../net/client';

const SMOOTHING = 0.25;

const icon = (role) => (role === ROLE.SEEKER ? '🔦' : '👻');

const createNode = (peer) => {
  const el = document.createElement('div');

  el.className = 'hns-ghost';
  el.style.setProperty('--hns-color', peer.color);
  el.innerHTML =
    '<div class="hns-ghost__ring"></div>' +
    '<div class="hns-ghost__body"></div>' +
    '<div class="hns-ghost__name"></div>';

  return {
    el,
    body: el.querySelector('.hns-ghost__body'),
    label: el.querySelector('.hns-ghost__name'),
    pos: { x: peer.x, y: peer.y },
  };
};

/**
 * Positions come in at the server tick rate; this layer interpolates them on
 * every animation frame so cursors glide instead of stuttering. It writes to
 * the DOM directly — putting 20Hz of coordinates through React would re-render
 * the whole overlay for nothing.
 */
export const createGhostLayer = (container) => {
  const nodes = new Map();
  let frame = null;

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

      node.target = peer;
      node.el.classList.toggle('hns-ghost--pinging', Boolean(peer.pinging));
      node.el.style.setProperty('--hns-progress', String(peer.catchProgress ?? 0));
      node.body.textContent = icon(peer.role);
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

      const x = node.pos.x * window.innerWidth;
      const y = node.pos.y * window.innerHeight;

      node.el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    });

    frame = window.requestAnimationFrame(draw);
  };

  frame = window.requestAnimationFrame(draw);

  return () => {
    window.cancelAnimationFrame(frame);
    nodes.forEach((node) => node.el.remove());
    nodes.clear();
  };
};
