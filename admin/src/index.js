import { PuzzlePiece } from '@strapi/icons';

import { PLUGIN_ID } from './pluginId';
import { startClient } from './net/client';
import { mountOverlay } from './overlay/mount';

export default {
  register(app) {
    app.widgets.register({
      id: 'lobby',
      pluginId: PLUGIN_ID,
      icon: PuzzlePiece,
      title: {
        id: `${PLUGIN_ID}.widget.title`,
        defaultMessage: 'Hide & Seek',
      },
      component: async () => {
        const { LobbyWidget } = await import('./components/LobbyWidget');

        return LobbyWidget;
      },
    });
  },

  bootstrap() {
    // The overlay has to exist on every admin route, not just the homepage.
    mountOverlay();
    startClient();
  },

  async registerTrads({ locales }) {
    const imports = locales.map(async (locale) => {
      try {
        const { default: data } = await import(`./translations/${locale}.json`);

        return { data, locale };
      } catch {
        return { data: {}, locale };
      }
    });

    return Promise.all(imports);
  },
};
