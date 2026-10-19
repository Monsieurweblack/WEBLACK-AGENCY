# Archivage Google Drive des candidatures WEBLACK TALENTS

## Ce que fait l'intégration

Chaque candidature enregistrée (D1 + photos dans KV, la source de vérité) est ensuite copiée dans le Google Drive de **weblackconsulting@gmail.com** :

```
WEBLACK TALENTS / 2026 / Candidatures / A1B2C3D4 /
    A1B2C3D4-recapitulatif.txt
    A1B2C3D4-portrait.jpg · A1B2C3D4-profil.jpg · A1B2C3D4-en-pied.jpg · A1B2C3D4-complementaire-1.jpg
```

- Noms de dossiers et de fichiers : la **référence** seule, jamais un nom ni une adresse.
- Chaque élément porte des propriétés techniques invisibles (`weblackApplicationId`, `weblackSourceId`) qui le relient au dossier D1 : une reprise retrouve ce qui existe et ne crée jamais de doublon.
- Un fichier n'est déclaré archivé qu'après **relecture du dossier Drive** (présence et taille de chaque fichier), puis contrôle de l'**absence de partage public** sur le dossier et chacun de ses fichiers.
- États suivis dans l'administration : `pending_sync` (en attente), `syncing`, `synced` (archivé), `sync_failed` (échec, avec un code technique : `oauth_invalid_grant`, `drive_quota:…`, `timeout`…).
- Une panne Drive ne touche jamais la candidature : elle reste enregistrée, ses photos restent dans le stockage existant, l'archivage est relancé automatiquement (6 tentatives espacées) ou à la main (« Relancer l'archivage »). Une autorisation révoquée n'est pas relancée en boucle : elle attend une nouvelle autorisation puis une relance manuelle.
- **E-mail de confirmation** : il signifie « candidature enregistrée », jamais « archivée dans Drive ». Il part dès l'enregistrement, indépendamment de l'archivage.
- **Suppression** d'un dossier dans l'administration : le dossier Drive part d'abord à la **corbeille** (récupérable 30 jours). Si Drive refuse, rien n'est supprimé.

## Autorisations utilisées (moindre privilège)

| Permission | Pourquoi |
|---|---|
| `drive.file` | Créer des dossiers/fichiers et lire **uniquement ceux créés par l'application**. Aucun accès au reste du Drive. |
| `openid`, `email` | Vérifier, au moment de l'autorisation, que le compte est bien weblackconsulting@gmail.com. |

Pas de compte de service (il n'a pas d'espace dans un Drive personnel). Les secrets — `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_DRIVE_REFRESH_TOKEN` — vivent uniquement dans les secrets Cloudflare Pages.

## Mise en service (à faire une fois, connecté en weblackconsulting@gmail.com)

1. **Projet Google Cloud** : https://console.cloud.google.com → créer un projet (ex. « WEBLACK TALENTS Archive »).
2. **API** : « API et services » → « Bibliothèque » → **Google Drive API** → Activer.
3. **Écran de consentement** (« Google Auth Platform ») :
   - Type d'utilisateur **Externe** ; nom de l'application ; e-mail d'assistance weblackconsulting@gmail.com.
   - Accès aux données : ajouter `…/auth/drive.file`, `openid`, `email` (aucune de ces permissions n'impose une vérification Google).
   - Audience : **Publier l'application** (statut « En production »). En mode « Test », Google fait expirer le jeton au bout de 7 jours et l'archivage s'arrêterait (`oauth_invalid_grant`). Un écran « application non validée » peut s'afficher à la connexion : c'est attendu pour une application interne, continuer.
4. **Identifiants** : « Clients » → Créer un client → type **Application de bureau** → noter l'ID client et le code secret.
5. **Autoriser et enregistrer les secrets** (terminal PowerShell, dans le dossier du site, wrangler déjà connecté) :
   ```powershell
   node scripts/google-drive/authorize.mjs --dry-run
   ```
   Le script **demande** l'ID client puis le code secret (saisie masquée : collez, puis Entrée). Ne les tapez pas dans une commande `$env:…="…"` : PowerShell conserverait le code secret en clair dans son historique. Il ouvre ensuite la page Google (choisir weblackconsulting@gmail.com ; sur « application non validée » → « Paramètres avancés » → « Accéder à … »), vérifie le compte et la permission, teste l'accès Drive. Résultat attendu : `Compte vérifié : weblackconsulting@gmail.com. Permission : drive.file. Accès Drive testé : OK.`

   Puis, pour enregistrer réellement les trois secrets dans Cloudflare (jamais affichés) :
   ```powershell
   node scripts/google-drive/authorize.mjs
   ```
   Résultat attendu : trois lignes `Secret Cloudflare enregistré : …`.

   | Message | Correction |
   |---|---|
   | « L'ID client ne ressemble pas à un ID Google » | Recopier l'ID complet (se termine par `.apps.googleusercontent.com`) |
   | « Compte autorisé inattendu » | Relancer en choisissant weblackconsulting@gmail.com |
   | « La permission Google Drive (drive.file) n'a pas été accordée » | Relancer et cocher l'accès à Drive |
   | « Accès Drive refusé (HTTP 403) » | API Drive non activée (étape 2) ou mauvais projet sélectionné |
   | « Google n'a pas fourni de jeton de renouvellement » | Retirer l'accès sur https://myaccount.google.com/permissions, relancer |
   | `redirect_uri_mismatch` | Client créé en « Application Web » : refaire l'étape 4 en « Application de bureau » |
6. **Redéployer** (les secrets s'appliquent au déploiement suivant) : pousser un commit sur `main`, ou « Réessayer le déploiement » dans le tableau de bord Cloudflare Pages.
7. **Vérifier** dans `/admin/candidatures/` : « Tester la connexion Drive » → « connexion vérifiée », puis « Relancer l'archivage en attente » pour les dossiers reçus avant l'autorisation.

## Conservation et confidentialité

- Le dossier Drive suit le dossier de l'administration : supprimer une candidature met son archive à la corbeille, que Google vide au bout de 30 jours. La politique de conservation annoncée aux candidats (notice Sanity) s'applique donc en supprimant les dossiers depuis l'administration.
- Ne jamais activer « Partager → Tous les utilisateurs disposant du lien » : la synchronisation le détecte et passe le dossier en `public_permission_detected`.
- La notice de confidentialité (Sanity) doit mentionner Google (Google Drive) parmi les prestataires et les transferts hors UE possibles — à faire valider.
