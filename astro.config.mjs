// @ts-check
import { defineConfig } from 'astro/config';

import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
const NOINDEX_PATHS = ['/404/', '/en/404/', '/politique-de-confidentialite/', '/en/politique-de-confidentialite/'];

export default defineConfig({
  site: 'https://weblack.fr',
  integrations: [
    sitemap({
      filter: (page) => !NOINDEX_PATHS.some((path) => page.endsWith(path)),
    }),
  ],
  i18n: {
    locales: ['fr', 'en'],
    defaultLocale: 'fr',
    routing: {
      prefixDefaultLocale: false,
    },
  },
  vite: {
    plugins: [tailwindcss()],
  },
  redirects: {
    '/institut': '/about',
    '/en/institut': '/en/about',
    '/poles': '/about',
    '/en/poles': '/en/about',
    '/a-propos': '/about',
    '/en/a-propos': '/en/about',
    '/talents': '/talent',
    '/en/talents': '/en/talent',
    '/talents/[slug]': '/talent/[slug]',
    '/en/talents/[slug]': '/en/talent/[slug]',
    '/evenements': '/selected-work',
    '/en/evenements': '/en/selected-work',
    '/etudes-de-cas': '/selected-work',
    '/en/etudes-de-cas': '/en/selected-work',
    '/actualites': '/journal',
    '/en/actualites': '/en/journal',
    '/partenaires': '/partners',
    '/en/partenaires': '/en/partners',
  },
});
