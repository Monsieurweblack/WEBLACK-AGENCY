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

## Option B — Cloudflare Pages (recommandé, gratuit, CDN mondial)

**Méthode simple (upload direct, sans Git) :**
1. Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages** → **Upload assets**.
2. Glisser-déposer le contenu du dossier `dist/` (ou le zip `weblack-dist-hostinger.zip` décompressé).
3. Cloudflare génère une URL `*.pages.dev` immédiatement ; ajouter ensuite votre domaine personnalisé dans **Custom domains**.

**Méthode avec Git (recommandé pour les mises à jour futures) :**
1. Pousser `weblack-source.zip` (décompressé) vers un dépôt GitHub/GitLab.
2. Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
3. Sélectionner le dépôt, puis configurer :
   - **Build command** : `npm run build`
   - **Build output directory** : `dist`
   - **Node version** : 22 (variable d'environnement `NODE_VERSION=22`)
4. Chaque `git push` redéploie automatiquement le site.

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
