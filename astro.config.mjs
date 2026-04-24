// @ts-check
import { defineConfig } from 'astro/config';

import node from '@astrojs/node';
import chessDevToolbar from './dev-toolbar/integration.ts';

// https://astro.build/config
export default defineConfig({
  output: 'server',

  adapter: node({
    mode: 'standalone',
  }),

  vite: {
    optimizeDeps: {
      exclude: ['firebase/app', 'firebase/analytics', 'firebase/auth'],
    },
  },

  integrations: [chessDevToolbar()],
});
