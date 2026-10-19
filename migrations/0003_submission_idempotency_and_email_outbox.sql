-- Candidature Talent v3 — soumission idempotente et suivi des e-mails.
--
-- STRICTEMENT ADDITIVE : une colonne nullable, un index unique (les NULL des
-- dossiers antérieurs n'entrent pas en conflit entre eux dans SQLite), une
-- nouvelle table. Aucune suppression, aucun renommage, aucune réécriture.
--
-- submission_id : identifiant tiré une fois par le navigateur pour un
-- formulaire donné. Un double clic, une reprise après coupure réseau ou une
-- requête rejouée retrouvent le dossier déjà enregistré au lieu d'en créer
-- un second (voir functions/api/talent-application/submit.ts).
--
-- email_outbox : un e-mail à envoyer est écrit DANS LA MÊME TRANSACTION que
-- le dossier. « Candidature enregistrée » et « e-mail envoyé » sont deux
-- états distincts : un échec du fournisseur laisse la ligne en attente, à
-- relancer, sans jamais toucher au dossier. Aucune adresse ni donnée
-- personnelle n'y est copiée — le destinataire est relu dans le dossier au
-- moment de l'envoi ; last_error ne contient qu'un code technique.

ALTER TABLE applications ADD COLUMN submission_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_applications_submission ON applications (submission_id);

CREATE TABLE IF NOT EXISTS email_outbox (
  id TEXT PRIMARY KEY,               -- sert aussi de clé d'idempotence côté fournisseur
  application_id TEXT NOT NULL REFERENCES applications (id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                -- candidate_confirmation | admin_notification
  status TEXT NOT NULL DEFAULT 'pending', -- pending | sending | sent | failed
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,                   -- code technique uniquement (ex. http_403:validation_error)
  provider_message_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sent_at TEXT,
  UNIQUE (application_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_email_outbox_status ON email_outbox (status);
