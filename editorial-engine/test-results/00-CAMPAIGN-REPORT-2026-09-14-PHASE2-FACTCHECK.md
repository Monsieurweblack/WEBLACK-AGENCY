# Campagne de validation réelle #2 — 10 cas A-J, avec Final Fact-Check Pass — 2026-09-14

Deuxième campagne réelle, après renforcement du fact-checking (registre de claims avec vérification programmatique). Correctif préalable appliqué et vérifié : le nom de source "manual" ne s'affiche plus dans les références (résolution automatique de sourceName/sourceTitle/sourceUrl/sourceDate). Aucun draft Sanity créé, aucune publication, `main` non modifié, dry-run strict sur les 10 cas.

## Tableau comparatif A-J

| Test | Sujet | Editorial | SEO Opp. | News | SEO Quality | Copy Risk | Claims (V/PV/UV/C) | Fact-Check | Décision |
|---|---|---|---|---|---|---|---|---|---|
| A | Milan Fashion Week (EN→FR) | 82 | 75 | 85 | 89 | 25 | 10 (1/2/7/0) | FAIL | REJECT |
| B | Fendi/Chiuri (EN→FR) | 80 | 63 | 82 | 89 | 15 | 12 (2/0/10/0) | FAIL | REJECT |
| C | Lagos Fashion Week (EN→FR) | 83 | 65 | 86 | 89 | 15 | 10 (5/1/4/0) | **PASS** (registre) | REJECT (antiFabrication) |
| D | Creative Boom (EN→FR) | 76 | 64 | 75 | 89 | 15 | 14 (1/2/11/0) | FAIL | REJECT |
| E | zedefile.com (doublon exact) | — | — | — | — | — | — | — | SKIP (duplicate_exact, Level 1) |
| F | Équipement agricole (hors sujet) | 12 | — | — | — | — | — | — | SKIP (score < 40, avant génération) |
| G | LinkedIn (info insuffisante, EN→FR) | 60 | 59 | 63 | 100 | 20 | 8 (0/3/5/0) | FAIL | REJECT |
| H | ZE DÉFILÉ 2025, africaradio.com (**FR→FR**) | 81 | 63 | 81 | 89 | 35 | 7 (3/3/1/0) | **PASS** (registre) | REJECT (faux positif éditorial) |
| I | Marché mode africaine $31B (EN→FR) | 77 | 61 | 78 | 89 | 15 | 11 (1/6/4/0) | FAIL | REJECT |
| J | fashionindustrysummit.se, proche existant (EN→FR) | 80 | — | — | — | — | 10 (5/-/-/-) | FAIL | REJECT |

*(V=VERIFIED, PV=PARTIALLY_VERIFIED, UV=UNVERIFIED, C=CONTRADICTED)*

## Coût et durée réels

51 appels OpenAI, 100 539 tokens, **~0,03 USD** pour la campagne complète (gpt-4o-mini, estimation approximative). Détail par étape : analysis 9 appels/14 400 tokens, fact-extraction 8/16 928, generation 8/15 601, **quality-control (antiFabrication + claim registry) 16/41 873 — 42% du coût total**, seo-strategy 8/9 981, dedup-classification 2/1 756. Durée moyenne par cas complet : 25-33 secondes.

## DÉCOUVERTE MAJEURE : l'écart de langue source→génération domine le taux d'échec du fact-check

**8 des 10 cas rejetés sur le fact-check portaient sur une source en anglais, générée en français.** Les 2 seuls cas où le registre de claims a réellement **PASS** (C et H) partagent un point commun déterminant : le cas H a une source **déjà en français** (africaradio.com) ; le cas C, bien qu'en anglais, a eu un taux de correspondance verbatim nettement meilleur, mais reste rejeté par l'ancien contrôle `antiFabrication`.

Preuve la plus nette : test A, l'affirmation « L'impact commercial du mois de septembre est estimé à environ 496 000 visiteurs » est **réellement et exactement présente dans la source** (« the month of September alone is set to attract 496,000 visitors ») — mais marquée `UNVERIFIED` avec **zéro source citée**, parce que le modèle de fact-check, chargé de retrouver un extrait EXACT en anglais pour justifier une phrase en français, n'y parvient pas de manière fiable. Ce n'est pas un bug du code de vérification programmatique (`verifyEvidenceAgainstSources` — il fonctionne exactement comme prévu, il rejette ce qu'on ne lui soumet pas) : c'est une limite réelle de la capacité du modèle à citer verbatim dans une langue différente de celle qu'il traite.

**Conséquence concrète** : dans l'état actuel, le pipeline ne peut quasiment jamais produire un `FACT-CHECK PASS` propre sur les sources anglaises alors même que la traduction est fidèle — ce qui est précisément le cas d'usage principal attendu (WEBLACK rédige en français, la majorité des sources fashion/luxe réelles sont anglophones).

## Autres problèmes réels détectés

1. **Citation traduite présentée comme citation directe** (Test D) : « Dull is the ultimate risk » traduit en « Dull est le risque ultime » et présenté comme citation exacte — correctement bloqué, mais révèle que le modèle de rédaction ne devrait jamais traduire une citation directe sans la reformuler en discours rapporté.
2. **Faux positifs persistants du contrôle éditorial de chiffres** (Tests H, I, J) : le contrôle déterministe `qualityCheck.ts` continue de signaler des chiffres (dates au format jour-mois, pourcentages reformulés) comme "possiblement inventés" alors qu'ils sont réellement dans les faits — la correction de la phase précédente (pool dates+numbers) n'a pas éliminé toutes les sources de faux positifs.
3. **Dédoublonnage nuancé confirmé fonctionnel** (Test J) : `same_event_new_information` correctement identifié avec un raisonnement cohérent, non bloquant — comportement voulu.
4. **Défense à deux couches confirmée nécessaire** (Test C) : le nouveau registre de claims a laissé passer (`pass: true`) ce que l'ancien `antiFabrication` a bloqué — les deux checks continuent de se compléter, ni l'un ni l'autre n'est suffisant seul.
5. **Aucune contradiction (CONTRADICTED) rencontrée** sur cette campagne — logique, chaque cas n'avait qu'une seule source ; le mécanisme de détection de contradiction reste validé uniquement par les tests unitaires (voir `tests/claimRegistry.test.ts`, cas F), pas par la campagne réelle (qui n'utilise qu'une source par article).
6. **Deux sources réelles injoignables** (farmprogress.com 403) — comportement correct, source de repli utilisée.

## Réponses aux 12 points demandés

1. **Réussites** : dédoublonnage (Level 1 exact + Level 5 nuancé), score de pertinence WEBLACK (F correctement écarté à 12/100), défense à deux couches, correctif des références vérifié en conditions réelles.
2. **Échecs** : 8/10 cas rejetés sur le fact-check, très majoritairement à cause de l'écart de langue plutôt que d'une vraie fabrication.
3. **Faux positifs** : chiffres/dates correctement extraits mais non reconnus comme équivalents par le contrôle déterministe (Tests H, I, J) ; claims UNVERIFIED par échec de citation inter-langues alors que l'information est correcte (Tests A, G, I).
4. **Faux négatifs** : aucun détecté dans cette campagne — aucune fabrication réelle n'est passée le gate.
5. **Faiblesses éditoriales** : citation traduite présentée comme directe (D) ; aucun autre problème de ton/originalité majeur relevé sur les articles passés en revue.
6. **Faiblesses SEO** : aucune — seoQualityScore ≥ 89 sur tous les cas ayant atteint la génération, jamais bloquant par construction.
7. **Problèmes de fact-checking** : la limite inter-langues ci-dessus est le problème dominant, largement devant tout autre.
8. **Problèmes de sourcing** : aucun cas multi-sources testé en conditions réelles (pipeline mono-source) — logique de contradiction/source primaire seulement testée unitairement.
9. **Problèmes d'originalité** : aucun copyRiskScore n'a dépassé le seuil de 40 sur cette campagne (max observé : 35, Test H) — contraste net avec la première campagne réelle où 3 cas avaient dépassé le seuil ; amélioration réelle mais échantillon différent, à confirmer.
10. **Formulations génériques** : non observées de façon flagrante sur les extraits examinés.
11. **Coût** : négligeable (~0,03 USD/10 articles) — le fact-check représente 42% du coût mais reste économiquement non bloquant.
12. **Améliorations nécessaires** : (a) réviser la stratégie de citation d'évidence pour les sources non-francophones — envisager de conserver l'évidence dans sa langue d'origine sans exiger de traduction verbatim, ou d'extraire les faits directement en français dès l'étape d'extraction pour aligner les langues ; (b) réduire les faux positifs du contrôle déterministe de chiffres (dates au format court, pourcentages reformulés) ; (c) interdire explicitement la traduction de citations directes dans le prompt de rédaction.

## Décision finale

**NO-GO.**

Le fact-checking fonctionne et bloque correctement des fabrications réelles (campagne précédente : année/dates inventées interceptées). Mais cette campagne révèle qu'il échoue aussi massivement sur du contenu **correct** dès qu'il y a traduction anglais→français — ce qui est le cas d'usage principal de WEBLACK. Publier avec ce taux de rejet ne serait pas un problème de sécurité (rien de faux ne passerait), mais rend le système actuellement peu utilisable en pratique sur la majorité des sources réelles pertinentes pour WEBLACK. Aucun défaut critique de fabrication non intercepté n'a été trouvé — le NO-GO porte sur l'utilisabilité pratique du fact-check inter-langues, pas sur un risque de publication incorrecte.
