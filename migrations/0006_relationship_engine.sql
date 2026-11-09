-- WEBLACK Relationship Engine v1 — cycle de vie Talent, pipeline commercial, audit.
--
-- STRICTEMENT ADDITIVE : nouvelles tables et colonnes nullables uniquement.
-- Aucune suppression, aucun renommage, aucune réécriture de données
-- existantes. À appliquer aux DEUX bases (production et preview), comme les
-- migrations précédentes (voir docs/RELATIONSHIP_ENGINE.md).
--
-- Les nouveaux statuts (candidatures : INFO_REQUESTED, INTERVIEW, SELECTED,
-- TALENT_POOL, REPRESENTED ; demandes : QUALIFIED, REPLIED, MEETING,
-- FOLLOW_UP) ne demandent aucun changement de schéma : la colonne status est
-- un TEXT libre, la liste fermée vit dans le code (applicationTypes.ts,
-- inquiryOptions.ts) — la même liste valide l'API et alimente l'interface.

-- Historique d'une candidature : changements de statut et notes internes, horodatés.
CREATE TABLE IF NOT EXISTS application_events (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  kind TEXT NOT NULL,                 -- status | note
  from_status TEXT,
  to_status TEXT,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_application_events_application ON application_events (application_id);

-- Pipeline commercial : prochaine action et valeur estimée (saisies par l'équipe, jamais par le visiteur).
ALTER TABLE business_inquiries ADD COLUMN next_action TEXT;
ALTER TABLE business_inquiries ADD COLUMN next_action_at TEXT;     -- YYYY-MM-DD
ALTER TABLE business_inquiries ADD COLUMN estimated_value INTEGER; -- euros, estimation interne
ALTER TABLE business_inquiries ADD COLUMN sector TEXT;
CREATE INDEX IF NOT EXISTS idx_business_inquiries_next_action ON business_inquiries (next_action_at);

-- Journal d'audit des actions d'administration. Jamais de donnée personnelle
-- en clair : type d'action, cible (type + identifiant technique), détail
-- technique court (ex. ancien → nouveau statut).
CREATE TABLE IF NOT EXISTS admin_audit (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  action TEXT NOT NULL,               -- application.status | application.delete | inquiry.update | inquiry.delete | contact.export | …
  target_type TEXT NOT NULL,          -- application | inquiry | contact
  target_id TEXT NOT NULL,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit (created_at);
