// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';

// https://astro.build/config
export default defineConfig({
  site: 'https://www.miladlab.ca',
  i18n: {
    locales: ['en', 'fr'],
    defaultLocale: 'en',
    routing: {
      prefixDefaultLocale: false,
    },
  },
  redirects: {
      '/cv': '/publications',
      '/visualization': '/projects',
      '/fr/cv': '/fr/publications',
      '/fr/visualization': '/fr/projects',
	},

  integrations: [react()],
});