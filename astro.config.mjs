// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';

import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
const NOINDEX_PATHS = ['/404/', '/en/404/', '/politique-de-confidentialite/', '/en/politique-de-confidentialite/'];

// astro.config.mjs runs outside Vite, so `import.meta.env` (populated by
// Vite for the rest of the app) isn't available here — same constraint
// editorial-engine/config/env.ts and scripts/content-integrity.mjs already
// work around by reading .env directly; mirrored rather than reinvented.
function loadEnv() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const envPath = path.join(__dirname, '.env');
  const env = { ...process.env };
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const i = line.indexOf('=');
      if (i > 0 && !line.trim().startsWith('#')) {
        const key = line.slice(0, i).trim();
        if (!(key in env)) env[key] = line.slice(i + 1).trim();
      }
    }
  }
  return env;
}

// One real `_updatedAt` per Journal article, keyed by its site path — used
// below to give the sitemap an honest <lastmod> instead of omitting it or
// guessing. Never fabricated: pages with no matching entry (everything
// that isn't a Journal detail page) simply get no lastmod, which is a
// valid, standard sitemap entry.
async function loadJournalLastmodByPath() {
  const env = loadEnv();
  if (!env.SANITY_PROJECT_ID || !env.SANITY_DATASET) return new Map();
  try {
    const { createClient } = await import('@sanity/client');
    const client = createClient({
      projectId: env.SANITY_PROJECT_ID,
      dataset: env.SANITY_DATASET,
      apiVersion: '2025-01-01',
      useCdn: false,
      perspective: 'published',
    });
    const docs = await client.fetch(
      '*[_type == "journal" && defined(slug.current)]{ lang, "slug": slug.current, _updatedAt }',
    );
    const map = new Map();
    for (const doc of docs) {
      const localePrefix = doc.lang === 'en' ? '/en' : '';
      map.set(`${localePrefix}/journal/${doc.slug}/`, doc._updatedAt);
    }
    return map;
  } catch {
    // Sitemap generation must never fail the build over a lastmod lookup —
    // worst case, those entries just get no lastmod (still a valid sitemap).
    return new Map();
  }
}

const journalLastmodByPath = await loadJournalLastmodByPath();

export default defineConfig({
  site: 'https://weblack.fr',
  integrations: [
    sitemap({
      filter: (page) => !NOINDEX_PATHS.some((path) => page.endsWith(path)),
      serialize(item) {
        const pathname = new URL(item.url).pathname;
        const lastmod = journalLastmodByPath.get(pathname);
        return lastmod ? { ...item, lastmod } : item;
      },
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
