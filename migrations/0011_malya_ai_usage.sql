-- MALYA V1.3 — registre d'usage Workers AI en Neurons, par jour UTC (l'allocation gratuite se réinitialise à 00:00 UTC).
-- Additif et réversible : DROP TABLE malya_ai_usage. Aucun contenu de conversation.
-- L'ancienne table malya_budget (V1.1, micro-dollars) n'est plus utilisée et n'est pas supprimée.
CREATE TABLE IF NOT EXISTS malya_ai_usage (
  day TEXT PRIMARY KEY,                        -- 'AAAA-MM-JJ' (UTC)
  committed_milli INTEGER NOT NULL DEFAULT 0,  -- milli-Neurons réservés + dépensés (1 Neuron = 1 000)
  settled_milli INTEGER NOT NULL DEFAULT 0,    -- milli-Neurons réconciliés sur l'usage réel (tokens)
  calls INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  quota_hits INTEGER NOT NULL DEFAULT 0,       -- refus « allocation épuisée » renvoyés par Workers AI
  blocked INTEGER NOT NULL DEFAULT 0,          -- appels non effectués faute de plafond
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
