# Moteur éditorial — `editorial-engine/`

Outil en ligne de commande (Node, local — **ne fait pas partie du site déployé**) qui surveille des sources externes autorisées, en tire un article original dans la ligne éditoriale WEBLACK, et le crée comme **brouillon** dans le même Sanity que le site (`journal`), pour relecture avant publication.

**Statut : NO-GO production.** Aucun test de génération réelle n'a encore été exécuté (pas de `OPENAI_API_KEY` dans cet environnement) — voir `editorial-engine/test-results/` pour le détail des campagnes de validation menées jusqu'ici.

## Architecture de robustesse (hardening)

- **Dédoublonnage à 5 niveaux** (`validation/dedupe.ts`) : URL canonique exacte → hash de contenu exact → similarité de titre → comparaison d'entités locale → classification LLM (uniquement en zone ambiguë, pour limiter le coût). Décision structurée `{decision, confidence, reason, matchedArticleId, needsReview}` — ne bloque jamais un article pour le seul partage d'une personne/marque (`same_entity_different_event` n'est jamais bloquant).
- **Fact-check structuré** (`validation/antiFabrication.ts`) : chaque affirmation de l'article est représentée individuellement (`{claim, supported, sourceEvidence, confidence}`), pas juste une liste de fautes.
- **Anti-copie scoré** (`validation/antiCopy.ts`) : `copyRiskScore` 0-100 combinant chevauchement lexical et plus longue séquence de mots identiques à la source, seuil configurable (`COPY_RISK_BLOCK_THRESHOLD`).
- **Quality Gate final** (`validation/qualityGate.ts`) : agrège tous les contrôles en une décision unique `publish|draft|reject` — une seule erreur critique (fact-check, anti-copie, éditorial, schéma, dédoublonnage bloquant) suffit à rejeter ; le SEO n'est jamais bloquant.
- **WEBLACK Editorial Bible** (`config/weblack-editorial-bible.json`, généré par `npm run editorial:bible`) : déduite par analyse réelle des articles Journal existants dans Sanity (longueurs, catégories utilisées, observations sur le champ auteur) + règles explicites du projet — jamais inventée.
- **Observabilité** (`logs/observability.ts`) : chaque appel OpenAI trace `run_id`, modèle, étape, latence, tokens, succès/échec — jamais la clé elle-même.
- **Retry/backoff** (`intelligence/openaiClient.ts`) : 3 tentatives, backoff exponentiel, 429/5xx retryables, 4xx non retryables (échec rapide). Un retry ne peut jamais produire deux articles différents pour la même source (même requête rejouée, jamais une nouvelle génération).
- **Modèles configurables par tâche** : `OPENAI_MODEL_ANALYSIS`, `OPENAI_MODEL_WRITING`, `OPENAI_MODEL_FACTCHECK`.
- **Tests unitaires** (`editorial-engine/tests/`, `npm run editorial:test-unit`) : 53 tests sur base SQLite isolée + lectures Sanity réelles en lecture seule.

## Couche SEO & News Intelligence

- **SEO Opportunity Engine** (`seo/opportunityEngine.ts`) : `searchDemand` et `competition` sont **toujours** `"unknown"` — ce moteur n'a accès à aucune donnée réelle de volume de recherche, jamais de chiffre inventé. `seoOpportunityScore` ne moyenne que les signaux réellement disponibles (fraîcheur, newsworthiness, pertinence WEBLACK, potentiel evergreen, potentiel SEO éditorial).
- **Newsworthiness** (`seo/newsworthiness.ts`) : classification BREAKING/NEWS/TREND/ANALYSIS/REPORT/EVERGREEN — `BREAKING` exige à la fois une date de publication réelle de moins de 6h ET une importance/nouveauté très élevées, jamais utilisé par défaut.
- **Stratégie de mots-clés** (`intelligence/keywordStrategy.ts`) : mot-clé principal, secondaires, entités et intention de recherche déduits des faits déjà vérifiés — jamais de bourrage, jamais d'entité inventée.
- **Maillage interne** (`seo/internalLinking.ts`) : chaque suggestion pointe vers un slug Sanity interrogé en direct au moment de la suggestion — aucun lien vers une page qui n'existe pas.
- **SEO Quality Gate** (`seo/seoQualityGate.ts`) : `seoScore /100`, jamais bloquant à lui seul (`blocksPublication: false` toujours).
- **Priorité combinée** (`seo/priority.ts`) : `CRITICAL/HIGH/NORMAL/LOW/REJECT` à partir des 3 scores — un sujet sous la barre éditoriale WEBLACK (score < 40) est toujours `REJECT`, quels que soient ses scores SEO/news.
- **Structured data** (`src/components/pages/JournalDetail.astro`) : `Article`/`NewsArticle` déjà présent et amélioré (image en tableau, `publisher.logo` en `ImageObject`, `mainEntityOfPage` en objet `WebPage`) — jamais dupliqué avec les blocs `Organization`/`WebSite` de `Seo.astro`.
- **Sitemap `lastmod`** (`astro.config.mjs`) : dates réelles (`_updatedAt` Sanity) pour les pages Journal, absent partout ailleurs plutôt que deviné.
- **Fraîcheur de contenu** (`seo/contentFreshness.ts`, `npm run editorial:freshness`) : détecte les articles jamais mis à jour depuis leur publication — ne modifie jamais `publishDate`.
- **Search Console** (`intelligence/searchConsole.ts`) : non connecté dans cet environnement — échoue explicitement plutôt que de simuler des impressions/clics/position. Google Analytics (GA4), lui, est déjà en production (`src/layouts/BaseLayout.astro`).
- **Boucle de feedback SEO** (`seo/feedbackLoop.ts`) : logique de recommandation (IMPROVE_TITLE/IMPROVE_META/EXPAND_CONTENT/UPDATE_CONTENT/INTERNAL_LINKING/NO_ACTION) testée avec des données synthétiques — l'exécution réelle attend la connexion Search Console.
- **Tableau de bord** (`database/dashboard.ts`, `npm run editorial:dashboard`) : sujets détectés/rejetés, articles brouillon/publiés, erreurs — agrégé depuis l'historique local réel.

**Correctif critique découvert pendant cette phase** : les requêtes Sanity du site (`src/lib/content.ts`) n'excluaient pas les brouillons — un article créé en `drafts.` par ce moteur aurait pu apparaître sur le site public au prochain build. Corrigé via `perspective: "published"` sur le client Sanity (une seule ligne, protège les 8 points de requête à la fois), vérifié empiriquement en créant puis supprimant un vrai brouillon de test.

## Ce que ce n'est pas

- Ce n'est pas une fonction serverless ni une route Next.js : le site est un build Astro 100% statique, sans backend. Ce moteur tourne en dehors du site, sur votre machine ou un petit serveur que vous contrôlez.
- Ce n'est pas un système qui publie seul par défaut. `EDITORIAL_MODE=draft` (la valeur par défaut) crée systématiquement un brouillon Sanity, jamais un article visible sur `weblack.fr`.
- Ce n'est pas un système qui invente du contenu : chaque étape (extraction de faits, analyse, rédaction) est instruite de n'utiliser que ce qui est réellement présent dans la source, avec un contrôle qualité qui bloque l'écriture si un chiffre apparaît dans l'article sans être dans les faits extraits.

## Installation

```bash
npm install   # déjà fait si vous avez lancé npm install à la racine du site
cp .env.example .env   # si pas déjà fait — puis renseigner les valeurs
```

Variables requises dans `.env` (voir `.env.example` pour la liste complète et leur rôle) :
- `SANITY_PROJECT_ID`, `SANITY_DATASET`, `SANITY_WRITE_TOKEN` — déjà utilisés par le site, réutilisés tels quels (rôle "editor", jamais le token de déploiement du Studio).
- `OPENAI_API_KEY` — requis dès la première étape d'analyse. Sans elle, le moteur va jusqu'à l'ingestion et le dédoublonnage puis s'arrête proprement avec une erreur claire.
- `EDITORIAL_DEFAULT_AUTHOR` — la signature apposée sur tout article généré. Jamais inventée automatiquement : le moteur refuse de générer un article tant que cette variable n'est pas renseignée.
- `EDITORIAL_MODE`, `AUTO_PUBLISH_SCORE`, `AUTO_PUBLISH_CONFIDENCE` — voir "Publication automatique" ci-dessous.

## Sources

`editorial-engine/sources/sources.json` est livré **vide**. Aucune source n'a été présélectionnée : chaque flux RSS a ses propres conditions d'utilisation, et en ajouter un sans les avoir vérifiées irait contre la discipline de non-fabrication du projet (CLAUDE.md). Pour en ajouter une :

```json
{
  "sources": [
    { "name": "nom-court", "type": "rss", "url": "https://...", "enabled": true, "priority": 1, "lang": "fr" }
  ]
}
```

Testez toujours une nouvelle source avec `npm run editorial:dry-run` avant de l'activer durablement.

## Commandes

```bash
npm run editorial:test                    # vérifie config + connexion Sanity + base locale (aucune écriture)
npm run editorial:dry-run                 # cycle complet sur toutes les sources activées, sans jamais écrire dans Sanity
npm run editorial:run                     # cycle complet, écrit les brouillons (ou publie si le mode l'autorise)
npm run editorial:run -- --watch          # boucle continue (intervalle: EDITORIAL_INTERVAL_MINUTES)
npm run editorial:source -- <nom>         # une seule source de sources.json
npm run editorial:url -- <url>            # une URL donnée à la main, hors flux RSS
npm run editorial:publish                 # sans argument: liste les brouillons en attente
npm run editorial:publish -- <documentId> # publie un brouillon précis, après relecture humaine
```

## Pipeline (ce qui se passe à chaque article)

```text
Source (RSS ou URL manuelle)
  → ingestion (titre, texte, date, auteur, image — jamais devinés)
  → dédoublonnage (hash local + similarité de titre contre le Journal WEBLACK existant)
  → analyse éditoriale (OpenAI, note 0-100 sur la pertinence pour WEBLACK)
  → extraction de faits (OpenAI, strictement limité à ce qui est dans la source)
  → rédaction (OpenAI, réécriture originale dans la ligne WEBLACK — jamais une paraphrase mécanique)
  → contrôle qualité (longueur, catégorie valide, chiffres non-sourcés détectés, répétitions)
  → écriture Sanity (brouillon par défaut)
```

Chaque étape est journalisée dans `editorial-engine/logs/AAAA-MM-JJ.log` et dans l'historique local (`editorial-engine/database/history.sqlite3`, SQLite — ni l'un ni l'autre n'est envoyé dans git).

## Publication automatique — à activer en connaissance de cause

Par défaut (`EDITORIAL_MODE=draft`), **rien n'est jamais publié automatiquement**. Pour l'activer :

```
EDITORIAL_MODE=publish
AUTO_PUBLISH_SCORE=90
AUTO_PUBLISH_CONFIDENCE=90
```

Même en mode `publish`, un article n'est publié directement que si **toutes** ces conditions sont vraies : score éditorial ≥ seuil, score de confiance (fiabilité) ≥ seuil, pas de doublon détecté, contrôle qualité passé. Si une seule condition échoue, l'article retombe en brouillon — il n'y a pas de chemin qui contourne le contrôle qualité.

Recommandation : pour un site avec la discipline de non-fabrication de WEBLACK (voir CLAUDE.md), garder `EDITORIAL_MODE=draft` et publier à la main via `npm run editorial:publish -- <id>` après relecture, au moins le temps de valider la qualité réelle des articles générés sur plusieurs cycles.

## Programmer l'exécution

Cloudflare Pages ne peut pas héberger ce moteur (le site est statique, sans runtime serveur). Options réelles :
- Laisser `npm run editorial:run -- --watch` tourner sur une machine que vous contrôlez (VPS, mini-PC, ou votre poste avec le Planificateur de tâches Windows).
- Déclencher `npm run editorial:run` sur un calendrier externe (ex. une GitHub Action planifiée, un cron sur un petit serveur) plutôt que `--watch`.

## Sécurité

- Aucun secret n'est dans le dépôt : `.env` est gitignored (vérifié), `.env.example` ne contient que des noms de variables.
- Toutes les écritures Sanity se font depuis ce processus Node local, jamais depuis le navigateur — il n'y a pas de code de ce moteur dans le bundle Astro.
- Le moteur ne contourne jamais un paywall, une authentification ou une protection technique — si l'extraction échoue (page protégée, contenu vide), l'erreur est remontée telle quelle, jamais simulée.

## Dépannage

- `OPENAI_API_KEY absent` → normal tant que la clé n'est pas renseignée ; tout le pipeline jusqu'au dédoublonnage reste testable sans elle (`npm run editorial:test`, `npm run editorial:url -- <url>`).
- `EDITORIAL_DEFAULT_AUTHOR absent` → renseigner la variable ; le moteur refuse volontairement de générer un article sans signature explicite.
- Une source RSS échoue → vérifier l'URL et sa disponibilité dans `editorial-engine/logs/`, qui journalise l'erreur précise par source.
- Un article jugé "doublon" à tort → vérifier le rapport de similarité dans les logs (`DUPLICATE CHECK`) ; le seuil est à 60% de recouvrement de mots avec un titre déjà publié.

## Ce qui a délibérément été adapté par rapport à un système générique

- Pas de `createOrGetAuthor()` / `createOrGetCategory()` créant des documents : dans ce schéma Sanity, `author` est un simple texte et `category` une liste fermée, pas des références vers des documents séparés. Les créer aurait inventé une relation de schéma qui n'existe pas.
- Pas d'import automatique d'image de couverture : réutiliser l'image d'une source sans licence vérifiée serait une copie non autorisée. `uploadImageFromUrl()` existe mais refuse tout appel sans licence explicitement confirmée ; en pratique, un article généré n'a pas de `coverImage` et un éditeur en ajoute une à la main dans Studio avant publication.
- `status`/`draft` n'est pas un champ ajouté au schéma : Sanity gère nativement brouillon/publié via l'id du document (`drafts.<id>`), donc rien n'a été ajouté au schéma `journal` pour ce projet.
