-- WEBLACK Opportunities — statut de publication des annonces.
--
-- STRICTEMENT ADDITIVE : une nouvelle table. À appliquer aux DEUX bases
-- (production et preview). Aucune table existante n'est touchée.
--
-- Le TEXTE des annonces vit dans src/data/opportunities.ts (source unique) ;
-- cette table ne porte que l'état opérationnel, réglé depuis /admin/ :
--   draft      brouillon      — page non servie (404)
--   review     vérification   — page non servie (404)
--   published  publiée        — page servie ; ouverte jusqu'à la date limite
--   closed     clôturée       — page servie, sans appel à candidater
-- Une annonce sans ligne ici est traitée comme un brouillon.
-- organizer_verified : 1 seulement après confirmation de l'organisateur et
-- du mandat de diffusion ; tant qu'il vaut 0, la page l'indique.

CREATE TABLE IF NOT EXISTS opportunities (
  slug TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('draft', 'review', 'published', 'closed')),
  organizer_verified INTEGER NOT NULL DEFAULT 0 CHECK (organizer_verified IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Première annonce : publiée à la demande de WEBLACK (2026-11-09),
-- organisateur et mandat de diffusion NON encore confirmés.
INSERT OR IGNORE INTO opportunities (slug, status, organizer_verified, created_at, updated_at)
VALUES ('zedefile-2027', 'published', 0, '2026-11-09T00:00:00.000Z', '2026-11-09T00:00:00.000Z');
