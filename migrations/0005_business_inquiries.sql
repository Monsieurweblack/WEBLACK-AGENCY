-- Demandes commerciales (brief WEBLACK) — Growth Sprint 1.
--
-- STRICTEMENT ADDITIVE : deux nouvelles tables, aucune modification des
-- tables de candidature. Même base D1 que les candidatures (même liaison DB,
-- aucune nouvelle ressource) ; la preview a sa propre base, à migrer de la
-- même façon (voir wrangler.toml [env.preview]).
--
-- Une ligne = une demande reçue et confirmée au visiteur. Le visiteur ne voit
-- « demande reçue » qu'après l'écriture de cette ligne (functions/api/
-- business-inquiry.ts). La notification à l'équipe est suivie à part
-- (notify_status) : un e-mail non parti ne fait jamais disparaître la demande.
--
-- Conservation : une demande est supprimée trois ans après sa dernière mise à
-- jour (functions/lib/inquiryStore.ts, purgeExpiredInquiries) — durée
-- annoncée dans la politique de confidentialité.

CREATE TABLE IF NOT EXISTS business_inquiries (
  id TEXT PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,      -- affichée au visiteur, ex. WBL-3F9A21C0
  submission_id TEXT UNIQUE,           -- tiré par le navigateur : un double envoi retrouve la même demande
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'NEW',  -- NEW | TO_QUALIFY | CONTACTED | PROPOSAL_SENT | NEGOTIATION | WON | LOST
  lang TEXT NOT NULL,                  -- fr | en
  division TEXT NOT NULL,              -- talent | creative | consulting | unsure
  service TEXT NOT NULL,               -- valeur de functions/lib/inquiryOptions.ts
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  organisation TEXT,
  country TEXT NOT NULL,               -- code ISO 3166-1 alpha-2
  description TEXT NOT NULL,
  timeline TEXT,
  budget TEXT,
  -- Canal d'origine : jamais d'identifiant personnel, seulement d'où vient la demande.
  channel TEXT NOT NULL,               -- utm_source, domaine référent, ou "direct"
  entry_point TEXT,                    -- page/appel qui a ouvert le brief (ex. creative, contact, home)
  utm_medium TEXT,
  utm_campaign TEXT,
  -- Notification interne
  notify_status TEXT NOT NULL DEFAULT 'pending', -- pending | sent | failed | not_configured
  notify_attempts INTEGER NOT NULL DEFAULT 0,
  notify_error TEXT,                   -- code technique uniquement
  notified_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_business_inquiries_status ON business_inquiries (status);
CREATE INDEX IF NOT EXISTS idx_business_inquiries_created ON business_inquiries (created_at);

-- Journal commercial : changements de statut et notes internes, horodatés.
CREATE TABLE IF NOT EXISTS business_inquiry_events (
  id TEXT PRIMARY KEY,
  inquiry_id TEXT NOT NULL REFERENCES business_inquiries (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  kind TEXT NOT NULL,                  -- status | note
  from_status TEXT,
  to_status TEXT,
  note TEXT
);

CREATE INDEX IF NOT EXISTS idx_business_inquiry_events_inquiry ON business_inquiry_events (inquiry_id);
