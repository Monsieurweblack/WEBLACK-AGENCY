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
  // Le CSS global (Tailwind compilé, ~70Ko) était lié en <link
  // rel="stylesheet"> externe, injecté par Astro à un point fixe de <head>
  // (juste après le JSON-LD du Seo) que réordonner les composants du layout
  // ne déplace pas — vérifié en essayant. Sur une connexion mobile lente,
  // le navigateur peint une première fois avec les seuls styles UA par
  // défaut (aucune media query mobile appliquée) avant que cette feuille
  // externe n'arrive et ne corrige la mise en page : c'est le flash
  // desktop→mobile signalé en production.
  //
  // 'always' inline ce CSS directement dans le HTML de chaque page : plus
  // aucune requête réseau séparée à attendre avant qu'il s'applique, donc
  // plus de fenêtre possible pour ce flash — mesuré : FCP passe de ~4.0s à
  // ~1.4s sous Slow 4G + CPU×4. Coût mesuré en contrepartie sous ces mêmes
  // conditions extrêmes : LCP +1.3s (le HTML transporte ~70Ko de plus avant
  // d'atteindre l'image du Hero) et le CSS n'est plus mis en cache une
  // seule fois entre pages (il l'était via /_astro/*, immutable un an).
  // Accepté : le bug signalé porte sur la mise en page au premier rendu,
  // pas sur la vitesse d'apparition de l'image ; et ce coût est mesuré sans
  // la compression Brotli que Cloudflare applique réellement en
  // production, donc surestimé ici.
  build: {
    inlineStylesheets: 'always',
  },
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
