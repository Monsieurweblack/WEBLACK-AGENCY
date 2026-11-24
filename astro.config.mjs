// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';

import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
const NOINDEX_PATHS = ['/404/', '/en/404/', '/politique-de-confidentialite/', '/en/politique-de-confidentialite/', '/admin/', '/admin/candidatures/', '/admin/demandes/', '/espace/', '/en/espace/', '/malya/', '/en/malya/'];

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

// Un vrai `_updatedAt` par document de contenu, indexé par son chemin sur
// le site — pour que le sitemap porte un <lastmod> honnête plutôt que de
// l'omettre ou de l'inventer.
//
// Seul le Journal était couvert. Les autres types n'avaient donc aucune
// date : pour un moteur, une étude de cas corrigée hier et une page
// inchangée depuis deux ans se présentaient exactement pareil, et rien ne
// l'incitait à repasser. Les quatre types que le site publie en pages de
// détail sont désormais lus en une seule requête — ils vivent dans le même
// dataset, les interroger séparément multipliait les allers-retours sans
// rien apporter.
//
// Les segments d'URL sont ceux des routes réelles (src/pages/) : ils ne
// coïncident PAS avec les noms de types Sanity (`work` →
// /selected-work/, `partners` → /partners/, qui est une page unique sans
// détail et n'entre donc pas ici). Jamais fabriqué : un type ou une page
// sans correspondance n'obtient simplement pas de lastmod, ce qui reste
// une entrée de sitemap parfaitement valide.
/** @type {Record<string, string>} */
const SITEMAP_ROUTE_SEGMENT = {
  journal: 'journal',
  work: 'selected-work',
  talent: 'talent',
  opportunity: 'opportunities',
};

async function loadContentLastmodByPath() {
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
    const types = Object.keys(SITEMAP_ROUTE_SEGMENT);
    const docs = await client.fetch(
      `*[_type in $types && defined(slug.current)]{ _type, lang, "slug": slug.current, _updatedAt }`,
      { types },
    );
    const map = new Map();
    for (const doc of docs) {
      const segment = SITEMAP_ROUTE_SEGMENT[doc._type];
      if (!segment) continue;
      // Les opportunités n'ont pas de champ `lang` : un même document sert
      // les deux langues (textes FR et EN dans le même document). Les deux
      // chemins portent donc la même date, ce qui est exact.
      const prefixes = doc.lang === 'en' ? ['/en'] : doc.lang === 'fr' ? [''] : ['', '/en'];
      for (const prefix of prefixes) {
        map.set(`${prefix}/${segment}/${doc.slug}/`, doc._updatedAt);
      }
    }
    return map;
  } catch {
    // La génération du sitemap ne doit jamais faire échouer le build pour
    // une recherche de lastmod — au pire, ces entrées n'en ont pas.
    return new Map();
  }
}

const contentLastmodByPath = await loadContentLastmodByPath();

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
  // Variantes d'images générées UNIQUEMENT à la compilation (sharp, outil
  // d'images officiel d'Astro) — aucune transformation à l'exécution.
  // Réglages choisis par mesure contre le banding sur fond #0A0A0A
  // (comparatifs PR 0) : chroma 4:4:4 partout, qualité fixée à l'appel
  // (AVIF 90, WebP 95 — voir src/components/media/RemoteImage.astro).
  image: {
    service: {
      entrypoint: 'astro/assets/services/sharp',
      config: {
        avif: { chromaSubsampling: '4:4:4' },
        webp: { smartSubsample: true },
        jpeg: { mozjpeg: true, chromaSubsampling: '4:4:4' },
      },
    },
  },
  integrations: [
    sitemap({
      // Un sitemap liste des PAGES. Le flux RSS, la carte /llms.txt et les
      // fichiers .ics d'un live sont des ressources machine : les y faire
      // figurer ferait signaler par la Search Console des « URL non
      // indexables » sur un site qui n'en a par ailleurs aucune.
      filter: (page) =>
        !NOINDEX_PATHS.some((path) => page.endsWith(path)) &&
        !/\.(xml|txt|ics|json)$/.test(new URL(page).pathname),
      serialize(item) {
        const pathname = new URL(item.url).pathname;
        const lastmod = contentLastmodByPath.get(pathname);
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
    build: {
      /*
       * Scripts de l'accueil servis en fichiers (mis en cache, non répétés
       * dans chaque HTML) plutôt qu'inlinés : le HTML de l'accueil doit tenir
       * en deux allers-retours TCP (≈ 43 Ko compressés). Au-delà, un
       * troisième aller-retour retardait le premier rendu sur réseau lent
       * (Lighthouse Slow 4G simulé, mesuré le 2026-11-05). Tout le reste :
       * comportement par défaut (undefined → seuil de 4 Ko).
       */
      assetsInlineLimit: (file) =>
        /(HeroHome|DivisionsChapters)\.astro_astro_type_script/.test(file) ? false : undefined,
    },
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
    '/talent/apply': '/talent/candidature',
    '/en/talent/apply': '/en/talent/candidature',
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
