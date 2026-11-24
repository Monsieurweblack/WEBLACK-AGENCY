-- MALYA V1.2 — limitation de débit ATOMIQUE (remplace le compteur KV, non atomique, pour MALYA).
-- Additif et réversible : DROP TABLE malya_rate. Aucune donnée personnelle : la clé est un
-- hachage tronqué de l'IP (ou « global »), la fenêtre est fixe et les lignes expirent.
CREATE TABLE IF NOT EXISTS malya_rate (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,  -- ms epoch du début de la fenêtre courante
  count INTEGER NOT NULL
);
