# Campagne de validation réelle — 10 cas — 2026-09-14

Première exécution du pipeline complet avec un vrai `OPENAI_API_KEY` (modèle `gpt-4o-mini`, non surchargé par tâche). Aucune publication, aucun draft Sanity créé (dry-run strict sur les 10 cas). 10 sources réelles, aucune fabriquée.

## Tableau des résultats

| Test | Sujet | Editorial | Fact-check | Copy Risk | SEO | News | Décision | Cause principale |
|---|---|---|---|---|---|---|---|---|
| A | Milan Fashion Week | 90 | FAIL (4 non supportées) | 20 (OK) | 89 | 90/REPORT | REJECT | **Fabrication réelle** : année "2023" et dates "16-26 sept." inventées (vraies dates : 22-28 sept. 2026) |
| B | Fendi / Chiuri | 83 | PASS | 15 (OK) | 78 | — | REJECT | **Fabrication réelle** : "automne-hiver 2026" absent des faits extraits — connaissance générale injectée |
| C | Lagos Fashion Week SS26 | 81 | PASS | 75 (FAIL) | 78 | — | REJECT | Copie trop proche de la source + confusion d'années |
| D | Creative Boom (stratégie 2026) | 76 | PASS | 60 (FAIL) | 78 | — | REJECT | Copie trop proche + faux positif probable (extraction de faits incomplète, "2026" pourtant dans le titre source) |
| E | Milan Fashion Week (répétition de A) | — | FAIL (3 non supportées) | 20 (OK) | — | — | REJECT | Fabrication de type similaire à A ; **dédoublonnage Level 1 non déclenché car le dry-run n'écrit jamais dans l'historique local (comportement voulu)** |
| F | Semiconductor Industry Association | 25 | — | — | — | REJECT (pré-génération) | SKIP | Correctement jugé hors sujet WEBLACK avant toute génération — aucun coût engagé |
| G | LinkedIn (annonce intervenants) | 70 | FAIL | — | — | — | REJECT | Fabrication de chiffres (2026, 24) |
| H | ZE DÉFILÉ 2025 (africaradio.com) | 83 | FAIL | 50 (FAIL) | — | — | REJECT | Copie + fabrication ; **dédoublonnage a manqué la parenté réelle avec l'article WEBLACK existant (similarité titre 14%, sous le seuil)** |
| I | African Fashion Industry $31B | 86 | PASS (0 non supportée) | — (OK) | — | — | REJECT | **Faux positif confirmé** : "un quart" (texte) converti en "25%" (chiffre) par la génération — conversion exacte, pas une invention, mais mon contrôle ne reconnaît que les correspondances exactes de chiffres |
| J | zedefile.com (site officiel) | — | — | — | — | — | SKIP (doublon) | **Dédoublonnage correct** : `duplicate_semantic`, 80% confiance, correctement apparié à l'article WEBLACK réel sur ZE DÉFILÉ |

## Statistiques

- **8/8** articles ayant atteint la génération ont été **rejetés** par le Quality Gate final — **0 draft créé**.
- **2/10** correctement écartés avant génération (F : score bas, J : doublon détecté) — comportement souhaité, aucun coût gaspillé.
- Score éditorial moyen (articles générés) : 81.4 — médiane 83 — meilleur 90 (A) — pire 25 (F, écarté avant génération).
- Coût réel mesuré : **61 appels OpenAI, 91 098 tokens, ~0,03 USD** pour l'ensemble de la campagne (10 sources, modèle gpt-4o-mini) — estimation approximative, tarification à vérifier sur la facturation réelle du compte.
- Temps : chaque cas complet (ingestion → 6 appels OpenAI) prend ~25-40 secondes.

## Erreurs critiques et problèmes récurrents

1. **Fabrications réelles confirmées** (A, B) : le modèle de génération invente occasionnellement une date/année absente des faits fournis, en s'appuyant sur sa connaissance générale plutôt que sur la source. **Le système les a interceptées dans les deux cas** — aucune n'aurait été publiée.
2. **Le fact-checker LLM (`antiFabrication`) a un angle mort** : dans Test A, il a validé comme "supportée" une phrase contenant une année et des dates fabriquées, en la qualifiant de "reformulation directe" — c'est le contrôle déterministe des chiffres qui a rattrapé l'erreur. La défense à deux couches est nécessaire ; ni l'une ni l'autre seule n'aurait suffi.
3. **Copie trop proche de la source** (C, H, et partiellement D) : `copyRiskScore` a dépassé le seuil de blocage (40) sur 3 cas sur 8 — la génération a parfois tendance à trop coller à la structure de la source plutôt qu'à la restructurer réellement, exactement le risque que la Phase 10 demandait de surveiller.
4. **Faux positifs dans mon contrôle de chiffres** (D probable, I confirmé) : deux causes distinctes identifiées et documentées — (a) l'extraction de faits peut omettre un chiffre pourtant présent dans la source ; (b) une conversion texte→chiffre légitime ("un quart" → "25%") n'est pas reconnue comme équivalente. Corrigé partiellement pendant cette campagne (voir commit), la limite (b) reste ouverte.
5. **Dédoublonnage réel, deux résultats opposés** : a correctement bloqué un vrai doublon (J, `duplicate_semantic` à 80% de confiance, bon article apparié) mais a manqué une parenté réelle plus subtile (H, 14% de similarité de titre, sous le seuil même après l'abaissement à 20% fait lors du hardening précédent).
6. **Non-déterminisme réel confirmé** : un même cas ambigu (page officielle Nordic Summit) a reçu 3 verdicts différents sur 3 appels identiques (`duplicate_exact`, `same_event_new_information`, `duplicate_exact`) — limite inhérente à la classification par LLM, pas un bug.
7. **Deux sources réelles injoignables** en cours de campagne (fashionista.com 403, dn-africa.com fetch failed) — comportement correct (aucun contournement tenté), sources de repli utilisées.

## Bugs corrigés pendant cette campagne (voir commit)

- `qualityCheck.ts` : le contrôle de chiffres ne vérifiait que `facts.numbers`, pas `facts.dates` — un chiffre correctement extrait comme date (ex. une année) était signalé comme "possiblement inventé". Corrigé.
- Deux tests unitaires supposaient à tort l'absence de clé OpenAI dans l'environnement ; corrigés pour s'adapter dynamiquement (skip explicite avec raison, ou assertions robustes au non-déterminisme réel) plutôt que de fournir un faux signal d'échec.

## Conclusion de la campagne

Le système de sécurité (Quality Gate, anti-fabrication, anti-copie, dédoublonnage) **fonctionne** — il a empêché la création de tout brouillon à partir d'un contenu fabriqué ou trop proche de sa source, sur 8 tentatives réelles. Mais **aucun article n'était prêt à publier avec seulement des corrections mineures** : soit à cause d'une fabrication réelle (A, B, G), soit d'un excès de proximité avec la source (C, H), soit d'un faux positif de mon propre contrôle (D, I). Le taux de rejet de 100% sur les articles générés est un signal fort, pas un accident statistique.
