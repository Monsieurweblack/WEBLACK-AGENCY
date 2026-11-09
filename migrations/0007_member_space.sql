-- Espace membre WEBLACK TALENT — connexion sans mot de passe (lien magique).
--
-- STRICTEMENT ADDITIVE : deux nouvelles tables, trois colonnes nullables
-- sur applications. À appliquer aux DEUX bases (production et preview).
--
-- Aucun mot de passe n'existe. Un lien de connexion porte un jeton aléatoire
-- de 256 bits dont seule l'empreinte SHA-256 est stockée ; il est à usage
-- unique (used_at, consommé par une mise à jour atomique) et expire après
-- 15 minutes. La session est tenue côté serveur (révocable) ; le cookie ne
-- contient qu'un identifiant aléatoire signé, jamais d'adresse e-mail.
--
-- Le niveau du membre (candidat, talent activé, talent représenté) n'est
-- PAS stocké ici : il se déduit des statuts de ses candidatures, seule
-- source de vérité (voir functions/lib/member.ts).

CREATE TABLE IF NOT EXISTS member_login_tokens (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,                -- adresse normalisée ayant demandé le lien
  token_hash TEXT NOT NULL UNIQUE,    -- SHA-256 hexadécimal du jeton ; le jeton lui-même n'est jamais stocké
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_member_login_tokens_email ON member_login_tokens (email);

CREATE TABLE IF NOT EXISTS member_sessions (
  id TEXT PRIMARY KEY,                -- identifiant aléatoire porté (signé) par le cookie
  email TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_member_sessions_email ON member_sessions (email);

-- Champs que le talent met lui-même à jour depuis son espace.
ALTER TABLE applications ADD COLUMN member_availability TEXT;      -- texte court (ex. « disponible à partir de mars, Paris et Dakar »)
ALTER TABLE applications ADD COLUMN member_contact_pref TEXT;      -- email | phone | none
ALTER TABLE applications ADD COLUMN member_updated_at TEXT;
