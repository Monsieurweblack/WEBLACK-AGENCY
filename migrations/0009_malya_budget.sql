-- MALYA V1.1 — registre budgétaire centralisé (additif, réversible : DROP TABLE malya_budget).
-- Une ligne par mois UTC. Aucun contenu de conversation n'est stocké ici : uniquement
-- des compteurs et des montants en micro-dollars (1 USD = 1 000 000).
CREATE TABLE IF NOT EXISTS malya_budget (
  month TEXT PRIMARY KEY,                       -- 'AAAA-MM' (UTC)
  committed_micro INTEGER NOT NULL DEFAULT 0,   -- dépensé + réservé par les appels en cours
  settled_micro INTEGER NOT NULL DEFAULT 0,     -- dépense réconciliée sur l'usage réel
  calls INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  refusals INTEGER NOT NULL DEFAULT 0,
  blocked INTEGER NOT NULL DEFAULT 0,           -- appels non effectués faute de budget
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
