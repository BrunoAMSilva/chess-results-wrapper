// @ts-check
import { defineConfig } from 'astro/config';

import node from '@astrojs/node';

// https://astro.build/config
export default defineConfig({
  output: 'server',

  server: {
    allowedHosts: true,
  },

  adapter: node({
    mode: 'standalone',
  }),
});