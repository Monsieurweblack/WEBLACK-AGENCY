# WEBLACK Relationship Engine v1

Socle relationnel commun aux trois divisions (Talent, Créatif, Consulting) : il
réunit au même endroit les candidatures, les demandes commerciales et les
personnes derrière elles. Livré le 2026-11-09 (branche
`feature/relationship-engine-v1`, migration `0006`).

## Ce que fait le système

| Fonction | Où | Remarque |
|---|---|---|
| Cycle de vie Talent en 11 étapes | `/admin/candidatures/` · `functions/lib/applicationTypes.ts` | Nouvelle candidature → En cours d'examen → Informations demandées → À contacter → Présélectionnée → Entretien → Sélectionnée → Vivier → Représentée → Non retenue / Archivée |
| Historique horodaté de chaque dossier | table `application_events` | Changement de statut + entrée d'historique écrits dans la même transaction |
| Recherche multicritère Talent | `GET /api/admin/applications?q=&category=&country=&status=` | Paramètres liés, jamais concaténés |
| Pipeline commercial en 11 étapes | `/admin/demandes/` · `functions/lib/inquiryOptions.ts` | Nouveau → À qualifier → Qualifié → Contacté → A répondu → Rendez-vous → Proposition envoyée → Négociation → Gagné / Perdu / À relancer plus tard |
| Prochaine action, date, valeur estimée, secteur | colonnes ajoutées à `business_inquiries` | Saisis par l'équipe uniquement ; la valeur est une estimation interne |
| Contacts dédupliqués | `GET /api/admin/contacts` · `functions/lib/contacts.ts` | Calculés à la volée par adresse e-mail normalisée — aucune table à synchroniser |
| Export RGPD (droit d'accès) | `POST /api/admin/contacts/export` | Adresse dans le corps, jamais dans l'URL ; chaque export est journalisé |
| Journal d'audit | table `admin_audit` · `functions/lib/audit.ts` | Action + cible technique + détail court ; aucune donnée personnelle |
| Tableau de bord de direction | `/admin/` · `GET /api/admin/metrics` | Données réelles de D1, datées ; alertes et relances dues |

### Distinctions qui ne se confondent jamais

- **Sélectionnée** : retenue pour un projet ou une étape. Ce n'est pas un contrat.
- **Vivier** : conservée pour de futures opportunités. Suppose que la personne
  en a été informée, selon la politique de confidentialité.
- **Représentée** : uniquement après signature d'un contrat de représentation.
- **Client** (segment) : au moins une demande commerciale au statut « Gagné ».
  Un **prospect** est toute autre personne ayant envoyé une demande.

## Architecture

- **Données** : Cloudflare D1, même base que les candidatures (`DB`). La
  preview a sa propre base (`weblack-talent-applications-preview`). Toute
  migration s'applique **aux deux**.
- **API** : Cloudflare Pages Functions sous `functions/api/admin/*`, toutes
  protégées par `requireAdmin` (cookie de session signé, voir
  `functions/lib/adminSession.ts`).
- **Interface** : pages Astro statiques `src/pages/admin/*` (non indexées,
  `robots: noindex` et `Disallow: /admin/`), pilotées côté client.
- **Contenus éditoriaux** : restent dans Sanity. Aucune donnée personnelle
  n'y est écrite.
- **E-mails** : compte Resend existant (confirmation candidat, notification
  équipe, notification des demandes).
- **Audience** : GA4, avec consentement. **Non relié au tableau de bord** :
  aucun accès à l'API GA4 n'est configuré. Le tableau de bord l'indique.

## Administration au quotidien

1. Ouvrir `/admin/` et se connecter avec le mot de passe d'administration.
2. Traiter la section **À traiter** : relances dues, notifications non
   parties, dossiers en attente depuis plus de 7 jours, dossiers à supprimer
   selon la politique de conservation.
3. Dans **Demandes commerciales**, mettre à jour le statut et la **prochaine
   action avec sa date** après chaque échange. La relance remonte au tableau
   de bord le jour venu.
4. Dans **Candidatures Talent**, faire avancer chaque dossier. L'historique
   se constitue automatiquement.
5. Pour une demande d'accès d'une personne, chercher son adresse dans
   **Contacts** puis **Exporter (RGPD)** : le fichier JSON rassemble tout ce
   que la base détient.
6. Pour une demande d'effacement, supprimer chaque dossier concerné depuis
   sa fiche (candidature ou demande). L'archive Drive part à la corbeille et
   la suppression est journalisée.

## Conservation

| Donnée | Durée | Mécanisme |
|---|---|---|
| Demande commerciale | 3 ans après la dernière mise à jour | Purge automatique à chaque ouverture de la liste des demandes |
| Candidature non retenue ou archivée | 3 mois | **Signalée** au tableau de bord ; suppression **manuelle** après vérification (pas de suppression automatique de dossiers Talent) |
| Journal d'audit | Pas de purge automatique | Aucune donnée personnelle ; à réexaminer si le volume grandit |

## Sauvegarde et restauration

- **D1 Time Travel** (inclus dans D1) permet de restaurer une base à un
  instant des 30 derniers jours :
  `npx wrangler d1 time-travel info weblack-talent-applications`, puis
  `npx wrangler d1 time-travel restore weblack-talent-applications --timestamp=<ISO>`.
  La restauration est **destructive** pour les écritures postérieures : à
  décider par une personne habilitée.
- **Export ponctuel** : `npx wrangler d1 export weblack-talent-applications --remote --output=backup.sql`.
  Le fichier contient des données personnelles : à stocker chiffré et hors du dépôt.
- **Site** : retour arrière Cloudflare Pages avec
  `node scripts/rollback-production.mjs <tag> --dry-run`, puis sans `--dry-run`.
  Les migrations `0005` et `0006` sont additives : une version antérieure du
  site fonctionne avec la base migrée.

## Coûts récurrents

Aucun service ni abonnement ajouté. Tout tient dans l'existant :
Cloudflare Pages, Functions, D1 et KV (offres actuelles du compte), Resend
(compte existant) et Sanity (projet existant). Les volumes actuels (quelques
dizaines de lignes) sont très loin des limites gratuites de D1.

## Différé, et pourquoi

| Produit | Statut | Ce qui manque pour avancer |
|---|---|---|
| Espace personnel talent / membre (connexion) | Non commencé | Décision sur l'authentification (lien magique par e-mail recommandé, sans mot de passe) ; validation juridique des droits d'accès |
| WEBLACK Network / Creative Directory publics | Non commencé | Consentement explicite de publication par profil ; règles de visibilité validées ; premiers profils réels |
| WEBLACK Opportunities | Non commencé | Opportunités réelles et organisateurs vérifiés ; processus de vérification écrit |
| WEBLACK Academy | Non commencé | Programme, formateurs, dates et prix réels |
| Programme Partners | Partiel (demandes via le brief) | Accords de partenariat vérifiables avant tout affichage |
| Abonnés newsletter dans la vue Contacts | Non relié | Synchronisation Resend → D1 à décider (base légale, fréquence) |
| GA4 dans le tableau de bord | Non relié | Compte de service Google avec accès en lecture à la propriété GA4 |
| Automatisations de relance par e-mail | Non activé | Modèles de messages validés ; base légale par cas ; validation humaine avant envoi |
