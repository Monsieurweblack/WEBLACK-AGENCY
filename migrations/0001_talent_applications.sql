-- Candidatures Talent — dossiers privés, jamais dans le dataset Sanity public
-- (lisible anonymement, voir audit). Toutes les colonnes sensibles restent
-- ici ; les photos vivent dans KV (functions/lib/photos.ts), référencées
-- par id seulement.

CREATE TABLE IF NOT EXISTS applications (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'RECEIVED', -- RECEIVED | REVIEWING | TO_CONTACT | SHORTLISTED | REJECTED | ARCHIVED

  -- 01 — Profil
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  birth_date TEXT NOT NULL,
  city TEXT NOT NULL,
  country TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  instagram TEXT,
  languages TEXT,

  -- Mineur : le parcours représentant légal reste désactivé tant que
  -- talentApplicationSettings.minorsAllowed (Sanity) n'est pas activé par
  -- l'équipe — voir submit.ts. Colonnes présentes dès maintenant pour ne pas
  -- nécessiter de migration le jour où ce parcours est validé.
  is_minor INTEGER NOT NULL DEFAULT 0,
  legal_guardian_name TEXT,
  legal_guardian_email TEXT,
  legal_guardian_phone TEXT,

  -- 02 — Mensurations (tout facultatif, aucun seuil éliminatoire)
  height_cm REAL,
  chest_cm REAL,
  waist_cm REAL,
  hips_cm REAL,
  shoe_size TEXT,
  shoe_system TEXT,
  clothing_size TEXT,
  inseam_cm REAL,
  hair_color TEXT,
  eye_color TEXT,

  -- 03 — Expérience et portfolio
  experience_level TEXT NOT NULL,
  past_missions TEXT,
  projects_json TEXT, -- jusqu'à 3 projets : [{"name":"","role":"","year":""}]
  current_agency TEXT,
  exclusivity TEXT,
  portfolio_links TEXT, -- une URL par ligne
  skills TEXT,
  training TEXT,

  -- 04 — Disponibilités et motivation
  availability TEXT,
  mobility TEXT,
  desired_projects TEXT,
  motivation TEXT,

  -- 05 — Vérification
  accuracy_confirmed INTEGER NOT NULL,
  privacy_notice_version TEXT NOT NULL,

  -- Admin uniquement
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_applications_status ON applications (status);
CREATE INDEX IF NOT EXISTS idx_applications_created ON applications (created_at);

CREATE TABLE IF NOT EXISTS application_photos (
  id TEXT PRIMARY KEY, -- identique à la clé KV
  application_id TEXT NOT NULL REFERENCES applications (id) ON DELETE CASCADE,
  role TEXT NOT NULL, -- portrait | profile | full_length | extra
  content_type TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_photos_application ON application_photos (application_id);
