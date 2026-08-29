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
