-- Candidature Talent v2 — profil professionnel structuré.
--
-- STRICTEMENT ADDITIVE : cinq colonnes nullables, aucune suppression, aucun
-- renommage, aucune réécriture de ligne. Les dossiers antérieurs gardent
-- NULL dans ces colonnes et restent lisibles par l'administration (qui
-- affiche alors simplement l'absence de valeur).
--
-- Les autres nouveautés du formulaire réutilisent des colonnes existantes :
--   languages        -> tableau JSON de codes ISO 639 (au lieu d'un texte libre)
--   mobility         -> code local | national | international
--   desired_projects -> tableau JSON de codes de projets
--   motivation       -> présentation personnelle (1500 caractères max)
--   portfolio_links  -> une URL par ligne, chacune validée côté serveur
--   country          -> code ISO 3166-1 alpha-2
--   phone            -> format E.164 (+221771234567)
--
-- Procédure d'application en production : voir le message de commit
-- associé (point de restauration D1 Time Travel relevé avant exécution,
-- comptage des lignes avant/après).

ALTER TABLE applications ADD COLUMN talent_category TEXT;
ALTER TABLE applications ADD COLUMN talent_category_other TEXT;
ALTER TABLE applications ADD COLUMN experience_duration TEXT;
ALTER TABLE applications ADD COLUMN languages_other TEXT;
ALTER TABLE applications ADD COLUMN submission_lang TEXT;
