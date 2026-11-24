# Anthropic et budget — configuration, tarifs, contrôle

## Modèle et tarifs (relevés dans la documentation officielle le 2026-11-24)
Sources : <https://platform.claude.com/docs/en/about-claude/pricing> et <https://platform.claude.com/docs/en/models/overview>.

| Modèle (ID API) | Entrée | Sortie | Note |
|---|---|---|---|
| `claude-haiku-5-5` (défaut) | 0,10 $/MTok | 0,50 $/MTok | au-delà de 100 000 tokens de prompt : 0,50 / 2,50 |
| `claude-sonnet-5-5` | 2 $/MTok | 10 $/MTok | |
| `claude-opus-5-5` | 4 $/MTok | 20 $/MTok | |

Les prix vivent dans `functions/lib/malya/pricing.ts` avec `PRICING_VERIFIED_AT` (affiché dans l'administration). **Un modèle sans tarif connu est refusé** (`unknown_model`). Revérifier avant toute activation.

## Variables (selon la convention existante : secrets Cloudflare, jamais dans Git)
| Variable | Rôle |
|---|---|
| `ANTHROPIC_API_KEY` | **secret** — clé API, lue seulement par `llm.ts` côté serveur |
| `MALYA_ENABLED` | `true` pour servir l'API (sinon 503) — en clair, dans `wrangler.toml` `[env.preview.vars]` |
| `MALYA_MODEL` | modèle (défaut `claude-haiku-5-5`) |
| `MALYA_MONTHLY_BUDGET_EUR` | plafond mensuel (défaut 15) |
| `MALYA_FX_USD_PER_EUR` | hypothèse de change (défaut 1,0 ; voir ci-dessous) |
| `MALYA_EMERGENCY_STOP` | **secret du tableau de bord** ; `true` : coupe Anthropic, transmissions, outils, mémoire serveur ; le documentaire reste servi (effet après nouveau déploiement) |
| `MALYA_SENSITIVE_SUSPENDED` | `true` : coupe seulement les actions sensibles |

Le binding D1 `DB` est requis pour le registre. Aucune valeur n'est versionnée (un test parcourt le dépôt à la recherche de motifs de clé).

## Appel
SDK officiel `@anthropic-ai/sdk` (1.13.0), `maxRetries: 0` (un retry automatique pourrait facturer deux fois), délai 25 s, `max_tokens` borné par l'état du budget, `output_config.effort: "low"`, `thinking` laissé par défaut. Compilé avec `wrangler pages functions build` (bundle Workers valide).
**Non exercé contre l'API réelle** : aucune clé ni dépense autorisée dans cette livraison. La forme de requête suit les types du SDK ; le premier appel de préproduction doit être observé (voir procédure).

## Registre budgétaire (D1, `malya_budget`)
Une ligne par mois UTC : montant engagé, dépense réconciliée, appels, erreurs, refus, appels bloqués, tokens. Aucun contenu de conversation.

**Réservation atomique** : avant chaque appel, le pire coût (prompt estimé par excès — 1 token pour 2 caractères +20 % — plus `max_tokens` en sortie) est réservé par une seule instruction `UPDATE … WHERE engagé + montant ≤ plafond`. D1 la sérialise : requêtes parallèles et sessions multiples ne peuvent pas dépasser le plafond (testé : 40 réservations simultanées, 30 sessions via la passerelle). Après l'appel, la réservation est remplacée par le coût réel ; une erreur 4xx la libère ; une erreur incertaine (délai, 5xx) la conserve.

**Fail-closed** : registre illisible, `DB` absent, tarif inconnu, plafond nul → aucun appel payant, mode documentaire.

| Seuil du plafond | État | Comportement |
|---|---|---|
| < 50 % | normal | 1 400 tokens de sortie, 12 tours, 4 passages |
| ≥ 50 % | surveillance | idem (visible dans l'administration) |
| ≥ 70 % | limité | 1 000 tokens, 6 tours, 3 passages |
| ≥ 85 % | strict | 700 tokens, 3 tours, 2 passages |
| ≥ 95 % | suspendu | plus aucun appel payant |
| ≥ 100 % | bloqué | idem jusqu'au mois suivant |

**Change** (vérifié V1.2 : BCE, 2026-11-23, 1 € = 1,0939 $) : la facturation est en USD. Plafond effectif = 15 € × `MALYA_FX_USD_PER_EUR` × 0,90 = **13,50 $** avec le défaut 1,0 (hypothèse volontairement basse : tant que 1 € vaut plus de 1 $, le plafond réel est inférieur à 15 €) ; la marge de 10 % couvre taxes ou frais éventuels. Le taux n'est pas récupéré automatiquement : le vérifier et l'ajuster.

**Ordres de grandeur (estimations, non mesurées en production)** : un tour typique (≈ 1 200 tokens en entrée, 300 en sortie) coûte ≈ 270 micro-dollars ; le pire cas réservé est ≈ 1,4 millier. À 13,50 $ cela représente de l'ordre de 50 000 tours typiques, ou ≈ 9 600 tours au pire cas.

## Économies
Modèle économique par défaut ; sortie bornée ; contexte tronqué ; salutations, présentation de MALYA, transmissions et faits simples traités sans modèle ; aucun cache de réponses (confidentialité). Le mode documentaire reste disponible à budget épuisé.
