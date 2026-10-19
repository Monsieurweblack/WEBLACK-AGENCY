-- Candidature Talent v4 — archivage Google Drive.
--
-- STRICTEMENT ADDITIVE : trois nouvelles tables, aucune modification des
-- tables existantes. D1 reste la source de vérité : Drive est une copie
-- d'archive, synchronisée après l'enregistrement du dossier (voir
-- functions/lib/driveSync.ts). Une panne Drive ne touche jamais au dossier.

-- État d'archivage d'un dossier. Ligne écrite DANS LA MÊME TRANSACTION que
-- le dossier (status pending_sync), puis mise à jour par la synchronisation.
CREATE TABLE IF NOT EXISTS drive_sync (
  application_id TEXT PRIMARY KEY REFERENCES applications (id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending_sync', -- pending_sync | syncing | synced | sync_failed
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,          -- code technique uniquement (ex. oauth_invalid_grant, drive_quota:userRateLimitExceeded)
  folder_id TEXT,           -- identifiant du dossier Drive [REFERENCE] — jamais exposé hors administration
  last_synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_drive_sync_status ON drive_sync (status);

-- Fichiers effectivement présents dans Drive, vérifiés après téléversement.
-- source_id = identifiant de la photo (KV) ou 'summary' : une reprise ne
-- téléverse jamais deux fois la même source.
CREATE TABLE IF NOT EXISTS drive_files (
  application_id TEXT NOT NULL REFERENCES applications (id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  drive_file_id TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (application_id, source_id)
);

-- Dossiers communs (WEBLACK TALENTS, année, Candidatures) : retrouvés une
-- fois puis mis en cache, pour ne jamais en créer deux.
CREATE TABLE IF NOT EXISTS drive_folders (
  path TEXT PRIMARY KEY,    -- ex. 'root', '2026', '2026/Candidatures'
  folder_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
