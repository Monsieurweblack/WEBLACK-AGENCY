# MALYA V1.2 — déploiement Preview (24 novembre 2026)

> **⚠ Remplacé par la V1.3 pour le fournisseur d'IA :** Anthropic a été retiré (aucune clé, aucun SDK, aucun appel) au profit de Cloudflare Workers AI (plan gratuit). Les passages sur Anthropic, les tarifs en dollars, le budget de 15 €/mois et `ANTHROPIC_API_KEY` sont historiques : voir [`docs/malya-v1-3.md`](malya-v1-3.md).


Branche `feature/weblack-ai-ecosystem`. **Aucune opération sur la production, `main` inchangée (`9bc65fd`).**

## Résumé honnête
MALYA est déployée et testée en **Preview**, en **mode documentaire** (sans IA générative). **Aucun appel réel à l'API Anthropic n'a été effectué** : il n'existe aucune clé `ANTHROPIC_API_KEY` accessible (ni dans l'environnement local, ni dans Cloudflare Preview ou Production, ni via un profil `ant`), et une clé ne doit pas être collée dans une conversation. L'API Anthropic n'est donc **pas activée**. Tous les contrôles qui conditionnent son activation sont en place et prouvés ; il reste à poser la clé.

## Ce qui a changé en V1.2
| Sujet | Avant | Après |
|---|---|---|
| Limitation de débit | compteur KV (lire puis écrire : non atomique) | **D1 atomique** (migration 0010) : par IP hachée + plafond global ; échec fermé |
| Confidentialité | MALYA absente de la politique | section « MALYA » FR/EN décrivant le traitement réel (**à valider juridiquement**) |
| Variables Cloudflare | posées dans le tableau de bord (**ignorées** : `wrangler.toml` fait foi) | variables en clair dans `[env.preview.vars]` ; secrets seuls dans le tableau de bord |
| Sources | 7 entrées lues une fois | `scripts/malya-sources-check.mjs` : 7/7 joignables et conformes |
| Appel réel | non prévu | `scripts/malya-live-check.mjs` (refuse sans `--confirm-spend` et sans clé) |

## État de Cloudflare (Preview)
- Projet Pages `weblack`, branche de production `main` (non touchée).
- Préproduction : `https://3858b2b4.weblack.pages.dev` (commit `f04adce`) et alias `https://feature-weblack-ai-ecosystem.weblack.pages.dev`.
- Base : `weblack-talent-applications-preview` (`4a89b60d-d374-4300-a6cf-f28ab4fb28d1`), binding `DB` ; KV `PHOTOS` Preview `5afed0f7…`. Production : `7bc900c3…`, **aucune table `malya_*`** (contrôle en lecture seule).
- Migrations appliquées **à la main** sur la base Preview uniquement, après vérification du nom et de l'identifiant : `0009_malya_budget.sql`, `0010_malya_rate_limit.sql` (additives, sans `DROP/DELETE/ALTER/INSERT/UPDATE` — le script d'application le refuse). La base Preview n'a pas de table `d1_migrations` : `wrangler d1 migrations apply` aurait tenté de rejouer tout l'historique, il n'a pas été utilisé.
- Secrets Preview : `MALYA_EMERGENCY_STOP` (secret, valeur `false`). `ANTHROPIC_API_KEY` : **absente**.
- Variables Preview (`wrangler.toml`) : `MALYA_ENABLED=true`, `MALYA_MODEL=claude-haiku-5-5`, `MALYA_MONTHLY_BUDGET_EUR=15`, `MALYA_FX_USD_PER_EUR=1.0`. Aucune variable MALYA en production (test automatique).

## Contrôle financier
- Plafond : 15 €/mois → **13,50 $** (taux configuré 1,0 × marge 10 %). Taux BCE du 2026-11-23 : 1 € = 1,0939 $ → dépense réelle maximale ≈ **12,34 €**. Le plafond réel de 15 € n'est donc pas atteignable tant que 1 € vaut plus de 0,90 $.
- Réservation atomique du pire coût avant chaque appel, réconciliation sur l'usage réel, seuils 50/70/85/95/100 %, blocage si le registre est indisponible : **prouvés sur la vraie D1 Preview** (40 réservations parallèles de 1 500 contre un plafond de 10 000 → 6 acceptées, engagé 9 000) et en test unitaire (30 sessions parallèles).
- **Limite côté Anthropic : non configurée** (la Console Anthropic n'est pas accessible depuis ce poste). À poser avant d'ajouter la clé : limite de dépense mensuelle ≤ 15 $ dans la Console. Tant que ce n'est pas fait, le **seul** garde-fou est le registre du code.
- Coût réellement mesuré : **0 $** (aucun appel facturable ; registre Preview vide : 0 appel, 0 token).

## Résultats mesurés
| Contrôle | Résultat |
|---|---|
| `npm test` (dépôt entier) | **336 / 336** |
| MALYA (V1 + V1.1 + V1.2) | **87 / 87** (33 + 44 + 10) |
| Build Astro / `astro check` / compilation Workers | OK / 0 erreur / OK |
| Navigateur local (`scripts/malya-e2e.mjs`) | **108 / 108** |
| **Preview réelle** (API, sécurité, pages, navigateur) | **66 / 66** |
| Sources documentaires | 7 / 7 conformes |
| HTML accueil | 36,9 Ko compressés (budget 43,8 Ko) |

Le test Preview couvre : statut ; conversations FR et EN réelles (Cloudflare Functions + D1 Preview) ; référence à un message précédent ; question de marché chiffrée sans invention ; injection directe et espagnole ; transmission proposée jamais exécutée (catégorie Partenariat) ; origine étrangère, absence d'Origin, type, méthode, taille ; administration non accessible ; registre sans appel payant ; IP hachée ; limitation de débit réelle (30 passent, la 31e = 429) ; 16 pages en HTTP 200 ; section MALYA publiée dans la politique ; sitemap sans MALYA ; CSP sans domaine Anthropic ; **production sans lanceur ni API MALYA** ; lanceur, absence d'appel au chargement, dialogue FR/EN, Échap, zéro erreur console sur ordinateur et mobile 360 px.

## Ce qui n'a pas été fait (et pourquoi)
1. **Appel réel Anthropic** : pas de clé. Procédure : poser `ANTHROPIC_API_KEY` en **secret** Preview dans le tableau de bord, poser la limite côté Console, relancer un déploiement Preview, puis `ANTHROPIC_API_KEY=… node --experimental-strip-types scripts/malya-live-check.mjs --confirm-spend` (budget de test 0,05 €, base jetable, ≈ 0,001 $ attendus) et enfin `/api/malya/status` → `mode: "ai"`.
2. Paramètre `output_config.effort: "low"` sur `claude-haiku-5-5` : non vérifié sur l'API réelle (le script ci-dessus le fera).
3. Qualité conversationnelle réelle de Claude non évaluée.
4. Administration : l'environnement Preview n'a ni `ADMIN_PASSWORD` ni `ADMIN_SESSION_SECRET` : `/api/admin/malya` y répond 503 (testé), donc la supervision n'a pas été exercée sur Preview.
5. Lecteur d'écran réel ; WCAG non déclaré conforme.
6. Mémoire sur serveur : toujours non implémentée.
7. L'arrêt d'urgence a été éprouvé en réel pour la coupure du fournisseur (statut `emergency_stop`) ; le blocage des transmissions pendant l'arrêt est couvert par les tests unitaires uniquement (l'appel de contrôle en réel a reçu un 429 de ma propre limitation de débit, donc il ne prouve rien).
8. Politique de confidentialité : texte rédigé d'après le comportement réel, **non relu par un juriste** ; mécanisme de transfert hors UE pour Anthropic non documenté.

## Désactivation immédiate
1. **Instantané (≈ 1 s)** : révoquer la clé dans la Console Anthropic → MALYA répond en documentaire.
2. **≈ 3 à 4 min (mesuré)** : secret Preview `MALYA_EMERGENCY_STOP=true` puis « Retry deployment » → plus d'appel Anthropic, plus de transmission.
3. Arrêt complet de l'API : retirer `MALYA_ENABLED` de `wrangler.toml` `[env.preview.vars]` et pousser.
4. Retrait du lanceur : retirer `<MalyaLauncher>` de `BaseLayout.astro`.
5. Retour arrière base : `DROP TABLE malya_budget; DROP TABLE malya_rate;` (Preview).
