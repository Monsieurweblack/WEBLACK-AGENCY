# Déploiement — WEBLACK L'Agence

Le site est un site **statique** généré par Astro (`npm run build` → dossier `dist/`). Aucun serveur Node n'est nécessaire en production : n'importe quel hébergement de fichiers statiques convient.

## Avant de publier — à compléter

Trois éléments sont encore des gabarits à finaliser dans le code source avant une mise en ligne publique :

1. **Mentions légales** (`src/pages/mentions-legales.astro` + `src/pages/en/mentions-legales.astro`) : raison sociale, SIRET, hébergeur — actuellement `[À compléter]`.
2. **Nom de domaine réel** : `astro.config.mjs` (`site: 'https://www.weblack.fr'`) et `public/robots.txt` — à ajuster si le domaine final diffère.
3. **Formulaire de contact** : fonctionne déjà via un lien `mailto:` vers `weblackconsulting@gmail.com` (aucune infrastructure requise) — à remplacer par un vrai backend si vous préférez un envoi silencieux depuis le site.

Une fois ces points ajustés, relancer `npm run build` avant de publier.

---

## Option A — Hostinger (hébergement mutualisé)

1. Dans `weblack-dist-hostinger.zip`, tout le contenu est déjà prêt à l'emploi (fichiers HTML/CSS/JS statiques).
2. Se connecter à **hPanel** → **Gestionnaire de fichiers**, ouvrir le dossier `public_html` (ou le sous-dossier du domaine concerné).
3. Supprimer les fichiers par défaut présents (ex. `default.php`), puis importer/déposer le **contenu** du zip (pas le zip lui-même : décompressez-le d'abord, ou utilisez l'option "Extraire" du gestionnaire de fichiers après upload).
4. Vérifier que `index.html` se trouve directement à la racine de `public_html`.
5. Activer le certificat SSL gratuit (Hostinger → SSL) si ce n'est pas automatique.

Alternative : upload via FTP (FileZilla) avec les identifiants fournis par Hostinger, en déposant le contenu du zip dans `public_html`.

## Option B — Cloudflare Pages (production officielle, déjà en place)

C'est la plateforme réellement utilisée pour `weblack.fr` / `www.weblack.fr`. Le projet Cloudflare Pages `weblack` est connecté nativement au dépôt GitHub `Monsieurweblack/WEBLACK-AGENCY` (intégration Git de Cloudflare, pas de GitHub Actions) :

```text
git push origin main
        ↓
Cloudflare Pages — intégration Git native (déclenchement automatique)
        ↓
npm run build → dist/
        ↓
weblack.pages.dev / weblack.fr / www.weblack.fr
```

- **Déclencheur** : tout push sur `main` (`production_branch: main`) — confirmé, aucune action manuelle requise.
- **Build command** : `npm run build`
- **Build output directory** : `dist`
- **Variables d'environnement configurées côté Cloudflare** : `SANITY_PROJECT_ID`, `SANITY_DATASET`
- **Preview deployments** : activés pour toutes les branches (utile pour prévisualiser une branche avant de merger sur `main`, sans affecter la production)

**Il n'existe volontairement aucun workflow GitHub Actions pour ce déploiement** — l'intégration Git native de Cloudflare joue déjà ce rôle. Ne pas en recréer un : cela produirait un second pipeline de production concurrent pour la même cible.

**Déploiement manuel (`wrangler`) — dépannage exceptionnel uniquement :**

```bash
npx wrangler pages deploy dist --project-name=weblack --branch=main
```

Cette commande n'est **pas nécessaire** pour un déploiement normal (le push suffit) — à réserver à un cas de récupération (ex. redéployer un ancien commit sans repasser par `git push`, ou déployer depuis une machine où le dépôt n'a pas accès à GitHub).

### Republier automatiquement après une modification dans Sanity Studio (actif)

Mis à jour le 2026-11-10 : la chaîne est **en service**. Les deploy hooks Cloudflare Pages existent bien, et sont lisibles par l'API (`GET …/pages/projects/weblack/deploy_hooks`) ; la note précédente qui les disait « absents de l'API » était inexacte.

```text
Sanity Studio → Publier → webhook Sanity « WEBLACK WEB » → deploy hook Cloudflare « sanity-publish » (main) → build + production
```

Preuve observée : publications du 2026-11-09 à 18:32 → deux déploiements de production de type `deploy_hook`, réussis. Détail, sources de vérité et retour arrière : `docs/sanity-content-architecture.md`.

Points ouverts :

- deux webhooks Sanity (« WEBLACK WEB » et « Cloudflare Production Deploy ») et deux deploy hooks `sanity-publish` coexistent ; un seul couple suffit. Supprimer le webhook inutilisé et son deploy hook depuis les tableaux de bord (action manuelle, droits administrateur) ;
- le filtre GROQ du webhook n'est pas lisible par les jetons disponibles : vérifier dans Sanity → API → Webhooks qu'il inclut `opportunity` (ou ne filtre pas par type), et qu'il exclut les brouillons : `!(_id in path("drafts.**"))`.

---

## Candidatures WEBLACK TALENTS — e-mails et dossiers PDF

**Ouverture de la campagne** : uniquement `applicationsOpen` du document Sanity `talentApplicationSettings`. `minorsAllowed` doit rester `false`. Si Sanity ne répond pas, le formulaire refuse l'envoi (« service momentanément indisponible ») — jamais ouvert par défaut.

**Migrations D1** (`migrations/`) : toujours additives, appliquées en production AVANT de pousser le code qui en dépend, avec un point de restauration relevé au préalable (`npx wrangler d1 time-travel info weblack-talent-applications`).

**E-mails** (Resend, même compte que la newsletter) :
- Clé : secret Cloudflare `NEWSLETTER_API_KEY` (jamais dans le dépôt).
- Expéditeur : `RESEND_FROM` dans `wrangler.toml` — doit appartenir à un domaine **vérifié** dans Resend (weblack.fr).
- Notification équipe : champ `internalNotificationEmail` du document Sanity (ou secret `TALENT_APPLICATION_NOTIFY_EMAIL`, prioritaire s'il existe).
- Chaque dossier écrit, dans la même transaction, deux lignes `email_outbox` (confirmation candidat, notification équipe). Un échec du fournisseur ne fait jamais perdre la candidature : la ligne passe en « Échec » avec un code technique (ex. `http_403:validation_error`), visible dans `/admin/candidatures/`, avec un bouton « Relancer les e-mails en attente ». 5 tentatives maximum par e-mail ; clé d'idempotence Resend = identifiant de la ligne (pas de doublon chez le destinataire).
- « Accepté par le fournisseur » ne prouve pas la réception en boîte de réception : vérifier ponctuellement sur une adresse de test, et ajouter un enregistrement DMARC à weblack.fr (absent au 19/10/2026) pour la délivrabilité.

**Archivage Google Drive** : copie de chaque dossier dans le Drive de weblackconsulting@gmail.com, après l'enregistrement, avec suivi et relance dans l'administration. Mise en service et autorisations : [docs/google-drive.md](docs/google-drive.md).

**Dossiers PDF** (`public/downloads/`) : générés par `node --experimental-strip-types scripts/talent-pdf/generate.mjs` à partir des libellés de `src/i18n/ui.ts` — à relancer après toute modification de ces libellés (le test `scripts/lib/talentPdf.test.mjs` échoue tant que les PDF publiés ne correspondent pas). Les dossiers PDF arrivent par e-mail à l'adresse de contact, avec l'objet « Candidature PDF — … » / « PDF application — … » : aucun traitement automatique ni confirmation ; un filtre Gmail sur ces objets permet de les isoler (libellé « WEBLACK TALENTS / PDF »).

---

## Relancer le site en local

```bash
npm install
npm run dev      # développement, http://localhost:4321
npm run build    # build de production dans dist/
npm run preview  # prévisualiser le build de production
```

Node.js 22+ est requis (`engines.node` dans `package.json`).

## Contenu du projet

- `src/content/` — tous les textes éditoriaux (pôles, actualités, événements, talents, études de cas), au format Markdown avec front-matter.
- `src/pages/` — les routes du site (racine = français, `en/` = anglais).
- `src/i18n/ui.ts` — dictionnaire de traduction pour tous les libellés d'interface (nav, boutons, labels).
- `public/photos/` — photographies WEBLACK réelles utilisées sur le site.
- `src/assets/logo/` — déclinaisons du logo (favicon, header/footer).
