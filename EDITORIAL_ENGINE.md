# Moteur éditorial — `editorial-engine/`

Outil en ligne de commande (Node, local — **ne fait pas partie du site déployé**) qui surveille des sources externes autorisées et en tire un article original dans la ligne éditoriale WEBLACK. Chaque article passe ensuite l'ensemble des contrôles — pertinence éditoriale, vérification factuelle, anti-fabrication, anti-copie et SEO — puis le Quality Gate. Seuls les articles qui satisfont tous les critères de publication partent automatiquement en ligne dans le même Sanity que le site (`journal`) ; les autres restent en brouillon pour relecture humaine, ou sont rejetés.

**Statut : PRODUCTION ACTIVE** — publication automatique protégée par le Quality Gate. Avec `EDITORIAL_MODE=publish` et les seuils 90/90, un article ne part en ligne que s'il franchit les huit portes, atteint ces scores **et** ne porte aucune affirmation non établie ; tout le reste devient un brouillon ou est rejeté. L'exécution persistante est assurée par une tâche du Planificateur de tâches Windows (`WEBLACK Editorial Engine`) qui lance un cycle `editorial:run` toutes les 60 minutes — voir « Programmer l'exécution » plus bas. Le détail des campagnes de validation est dans `editorial-engine/test-results/`.

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

`editorial-engine/sources/sources.json` porte la liste des flux, chacun avec une ligne `_verified` disant ce qui a réellement été vérifié et quand. **Trois tests conditionnent l'activation d'une source**, et une source qui en échoue un seul reste `enabled: false` avec le motif écrit noir sur blanc :

1. **Le flux existe et vit** — il se parse réellement et porte des articles récents.
2. **robots.txt autorise** — analysé groupe par groupe : le groupe `User-agent: *` doit autoriser le chemin du flux, **et** le site ne doit pas bloquer nommément les robots d'IA (`GPTBot`, `ClaudeBot`, `CCBot`). Un blocage nommé est un refus explicite, que ce moteur respecte même s'il n'est aucun de ces robots.
3. **Le flux porte du texte** — un flux réduit aux titres ne peut rien fonder : chaque article y coûterait deux appels de modèle pour finir rejeté faute de fait vérifiable.

```json
{ "name": "nom-court", "type": "rss", "url": "https://...", "enabled": true, "priority": 1, "lang": "en", "maxItemsPerCycle": 5 }
```

`maxItemsPerCycle` (5 par défaut) borne ce qu'un cycle prend dans un flux : les flux vont de 10 à 50 articles, et chacun coûte des appels réels qu'il devienne un brouillon ou non. Les articles arrivant du plus récent au plus ancien, prendre la tête de liste revient à prendre les plus frais.

Testez toujours une nouvelle source avec `npm run editorial:dry-run` avant de l'activer durablement.

**African fashion — angle mort assumé.** C'est la priorité éditoriale n°2 de WEBLACK, mais aucun flux automatisable n'a été trouvé : refus serveur, flux inexistants, blogs arrêtés, ou flux réduits aux titres. Le détail de ce qui a été testé est dans `_african_fashion_gap` (sources.json). Ce territoire passe donc par la voie manuelle — `npm run editorial:url -- <url>` — qui est exactement la façon dont l'article Lagos Fashion Week a été produit.

## Commandes

```bash
npm run editorial:test                    # vérifie config + connexion Sanity + base locale (aucune écriture)
npm run editorial:dry-run                 # cycle complet sur toutes les sources activées, sans jamais écrire dans Sanity
npm run editorial:run                     # cycle complet, écrit les brouillons (ou publie si le mode l'autorise)
npm run editorial:run -- --watch          # boucle continue (intervalle: EDITORIAL_INTERVAL_MINUTES)
npm run editorial:source -- <nom>         # une seule source de sources.json
npm run editorial:url -- <url>            # une URL donnée à la main, hors flux RSS
npm run editorial:review                  # file de revue: ce qui attend une décision humaine
npm run editorial:ledger                  # registre de production: cycles, décisions, coûts
npm run editorial:publish                 # sans argument: liste les brouillons en attente
npm run editorial:publish -- <documentId> # publie un brouillon précis, après relecture humaine
```

## Pipeline (ce qui se passe à chaque article)

```text
Source (RSS ou URL manuelle)
  → ingestion (titre, texte, date, auteur, image — jamais devinés)
  → dédoublonnage (hash local, empreinte de contenu, similarité de titre, puis classification)
  → analyse éditoriale (note 0-100 sur la pertinence pour WEBLACK ; < 40 = abandon)
  → extraction de faits (strictement limité à la source, chaque fait accompagné de sa citation verbatim)
  → VERIFIED FACT SET (vérification programmatique de chaque citation contre le texte réel de la source ;
      un fait invérifiable est écarté AVANT rédaction, le rédacteur ne le voit jamais)
  → newsworthiness + stratégie SEO (mot-clé principal fixé avant rédaction, pas constaté après)
  → rédaction WEBLACK (uniquement à partir des faits vérifiés ; les faits fragiles sont signalés
      comme à attribuer explicitement)
  → fact-check adverse (registre de claims : chaque affirmation publiée doit retrouver sa preuve,
      y compris par récupération depuis le fact set ; relations causales non sourcées bloquées)
  → anti-copie · SEO Quality Gate · Quality Gate éditorial
  → écriture Sanity (brouillon uniquement)
```

Blocages absolus du Quality Gate, jamais assouplis pour augmenter la production : une affirmation critique non supportée, un chiffre non supporté, une citation non supportée ou une contradiction suffisent chacun, seuls, à rejeter l'article.

## Traçabilité

Trois journaux complémentaires, tous locaux et hors git :

| Fichier | Contenu |
| --- | --- |
| `logs/AAAA-MM-JJ.log` | journal lisible, une ligne par étape |
| `logs/AAAA-MM-JJ-traces.jsonl` | un enregistrement par appel de modèle : `run_id`, étape, latence, tokens |
| `logs/production-ledger.jsonl` | **un enregistrement par article produit** : `run_id`, `cycle_id`, source, décision PASS/REVIEW/REJECT, motif, étape d'arrêt, claims et preuves, scores, identifiant du brouillon Sanity, coût, durée |
| `database/history.sqlite3` | historique servant au dédoublonnage entre cycles |

`npm run editorial:ledger` résume les cycles ; `npm run editorial:review` liste ce qui attend un humain. Aucun de ces fichiers ne contient de clé d'API : les traces ne portent que des métadonnées d'appel.

**PUBLIÉ** met l'article en ligne sans relecture. **PASS** crée un brouillon Sanity. **REVIEW** n'en crée aucun et part dans la file de revue. **REJECT** est ignoré — mais enregistré, pour que le même article ne soit pas re-analysé et re-facturé au cycle suivant.

## Publication automatique

`EDITORIAL_MODE=publish` autorise un article à partir en ligne sans intervention. Repasser à `draft` suffit à tout arrêter, immédiatement et sans autre changement.

Pour être publié sans relecture, un article doit réunir **toutes** ces conditions :

1. les huit portes passent (fact-check, anti-fabrication, anti-copie, éditorial, SEO, schéma, dédoublonnage) ;
2. score éditorial ≥ `AUTO_PUBLISH_SCORE` (90) **et** confiance ≥ `AUTO_PUBLISH_CONFIDENCE` (90) ;
3. **aucune affirmation non établie**, quelle que soit son importance — pas seulement aucune affirmation bloquante.

La troisième condition n'existe que pour la publication. Un brouillon laisse un rédacteur entre le moteur et le lecteur, et peut absorber une affirmation qu'on n'a pas su sourcer ; une page en ligne, non. Un article qui bute sur cette condition est quand même rédigé, devient un brouillon, et le Quality Gate écrit pourquoi il a été retenu.

## Newsletter

Un numéro n'est préparé que pour un article **réellement publié** — jamais pour un brouillon, qui a encore une décision humaine devant lui.

Ce n'est délibérément pas un appel de modèle. Tout ce dont un numéro a besoin existe déjà dans un article passé par la vérification des affirmations, le fact-check adverse, l'anti-fabrication et les portes. Demander à un modèle de réécrire ça en objet « plus accrocheur » rouvrirait, dans le seul artefact qui atterrit directement dans une boîte mail et ne peut plus être corrigé après envoi, exactement la surface d'hallucination que toute la chaîne existe pour fermer. L'objet **est** le titre, le preheader **est** l'excerpt, le corps reprend les premiers paragraphes de l'article mot pour mot.

| Mode | Comportement |
| --- | --- |
| `immediate` | éligible à l'envoi dès la publication |
| `scheduled` | retenu jusqu'à `NEWSLETTER_SCHEDULE_DELAY_HOURS` après la publication |
| `digest` | retenu jusqu'à regroupement explicite — **valeur par défaut** |

```bash
npm run editorial:newsletter                   # file des numéros et état de l'envoi
npm run editorial:newsletter -- preview [id]   # aperçu texte d'un numéro
npm run editorial:newsletter -- digest         # regroupe ce qui attend, sans envoyer
npm run editorial:newsletter -- send           # envoie ce qui est dû
```

Aucun fournisseur d'e-mail n'est configuré sur ce projet, et aucun n'est inventé : tant que `NEWSLETTER_PROVIDER`, `NEWSLETTER_API_KEY`, `NEWSLETTER_FROM` et `NEWSLETTER_AUDIENCE_ID` ne sont pas renseignés, `send` refuse de s'exécuter et le dit. Les numéros restent `queued`, jamais marqués `sent` — une newsletter faussement enregistrée comme délivrée se cache pendant des semaines.

## Article ou NewsArticle

Le champ `format` décide, au rendu, si la page déclare `NewsArticle` ou `Article` en données structurées. La déclaration se mérite : le format choisi par le modèle est accepté pour tout **sauf** « news », qui n'est conservé que si le classifieur déterministe — lequel exige un vrai horodatage de publication, pas une impression de fraîcheur — confirme BREAKING ou NEWS. La résolution ne peut que rétrograder une sur-déclaration, jamais en fabriquer une : annoncer à Google qu'une analyse intemporelle est une actualité est une fausse déclaration de données structurées, et elle se paie.

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

### Installé sur ce poste

Une tâche **Planificateur de tâches Windows** nommée `WEBLACK Editorial Engine` exécute un cycle unique (`editorial:run`, sans `--watch`) toutes les 60 minutes, avec un second déclencheur à l'ouverture de session pour reprendre après un redémarrage. Elle lance `node.exe` directement, répertoire de travail à la racine du projet ; aucune clé n'y figure — le moteur lit `.env` depuis le disque comme en ligne de commande.

```powershell
Get-ScheduledTask -TaskName "WEBLACK Editorial Engine"      # état
Get-ScheduledTaskInfo -TaskName "WEBLACK Editorial Engine"  # dernière exécution, prochaine
Start-ScheduledTask -TaskName "WEBLACK Editorial Engine"    # forcer un cycle
Disable-ScheduledTask -TaskName "WEBLACK Editorial Engine"  # tout arrêter
```

Deux garde-fous se superposent contre les cycles simultanés : `MultipleInstances=IgnoreNew` côté Windows, et le verrou à pid du moteur, qui refuse un second cycle et reprend un verrou laissé par un processus mort.

**Limite assumée** : la tâche s'exécute sous la session de l'utilisateur (`InteractiveToken`), donc uniquement lorsqu'il est connecté — elle reprend d'elle-même à l'ouverture de session après un redémarrage. La faire tourner session fermée exigerait d'enregistrer le mot de passe du compte Windows dans le Planificateur, ce qui n'a pas été fait.

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
