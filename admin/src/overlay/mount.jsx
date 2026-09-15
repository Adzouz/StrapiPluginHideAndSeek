import * as React from 'react';
import { createRoot } from 'react-dom/client';

import { Overlay } from './Overlay';
import { injectStyles } from './styles';

const ROOT_ID = 'hide-and-seek-overlay';

/**
 * The admin panel has no injection zone that renders on every route, so the
 * overlay gets its own React root attached straight to the body. It survives
 * client-side navigation for free and never fights the admin's own tree.
 */
export const mountOverlay = () => {
  if (document.getElementById(ROOT_ID)) {
    return;
  }

  injectStyles();

  const container = document.createElement('div');

  container.id = ROOT_ID;
  container.className = 'hns-root';
  document.body.appendChild(container);

  createRoot(container).render(<Overlay />);
};
