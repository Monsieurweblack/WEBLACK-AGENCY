# PHASE 4 — Verified Fact Set avant rédaction — 2026-09-15

Correction unique : le rédacteur ne reçoit plus les faits bruts extraits, mais uniquement les faits **confirmés mot pour mot contre le texte réel de la source**. Aucun nouvel appel OpenAI : la preuve verbatim est produite par l'appel d'extraction existant (schéma enrichi), et la vérification réutilise les fonctions déjà écrites de `claimRegistry` (`verifyEvidenceAgainstSources` / `determineStatus`), en pur déterministe. Le fact-checking post-rédaction est conservé intact comme barrière finale. Aucun draft Sanity, aucune publication, `main` non touché.

Campagne relancée sur les **10 URLs identiques** aux campagnes Phase 2 et Phase 3 : une seule variable change, le avant/après est donc directement lisible.

## Résultats — 10 cas

| Test | Décision | Fact set remis au rédacteur (V/PV/écartés) | Claims post-rédaction (V/PV/UV/C) | Éditorial | Copy risk | SEO |
|---|---|---|---|---|---|---|
| A | REJECT | 15 / 2 / **3 écartés** | 1 / 4 / **0** / 0 | 78 | 15 | 100 |
| B | REJECT | 9 / 4 / **2 écartés** | 0 / 1 / 5 / 0 | 82 | 25 | 89 |
| C | REJECT | 11 / 1 / **4 écartés** | 0 / 0 / 7 / 0 | 85 | 15 | 56 |
| D | REJECT | 4 / 0 / **1 écarté** | 0 / 0 / 6 / 0 | 76 | 15 | 89 |
| E | SKIP (doublon) | — | — | — | — | — |
| F | SKIP (doublon) | — | — | — | — | — |
| G | **PASS (draft)** | 12 / 2 / 0 | 0 / 6 / 1 / 0 | 65 | 25 | 100 |
| H | REJECT | 4 / 2 / 0 | 0 / 1 / 4 / 0 | 79 | **50** | 100 |
| I | REJECT | 1 / 4 / 0 | 0 / 0 / 6 / 0 | 78 | 15 | 89 |
| J | SKIP (doublon) | — | — | — | — | — |

**PASS : 1 · REJECT : 6 · SKIP (dédoublonnage, sans génération) : 3.**

## Coût

43 appels OpenAI, **117 857 tokens**, 7 articles réellement générés (E/F/J sortent au dédoublonnage, coût quasi nul). Soit **6,1 appels par article** — strictement identique à la Phase 3 (6,25/article) : **aucun appel supplémentaire n'a été introduit**, conformément à la consigne. Le volume de tokens monte de ~14 k à ~16,8 k par article (schéma d'extraction enrichi + preuves transmises au rédacteur), soit ~0,037 USD estimés pour la campagne. Répartition : quality-control 52 290 (44 %), fact-extraction 22 566, seo-strategy 15 383, generation 15 349, analysis 11 074.

## Hallucinations — ce qui a changé

**Le filtre fonctionne et se mesure.** 10 faits invérifiables ont été écartés avant rédaction sur 4 cas, dont exactement ceux que la Phase 3 ne rattrapait qu'après coup :
- Test B : « Chiuri's collections for Dior helped the company quadruple revenues from 2.2 billion euros in 2017 to 8.7 billion euros in 2024 » — écarté avant rédaction. En Phase 3, ce chiffre était rédigé puis bloqué en aval. Il n'apparaît plus du tout dans l'article.
- Test A : 3 faits écartés ; résultat, **0 claim critique UNVERIFIED** en sortie, contre 4 en Phase 3. Le fact-check passe désormais sur ce cas.

**Taux de passage du fact-check : 3/7 (A, C, G) contre 1/7 en Phase 3.**

**Deux fuites réelles subsistent**, toutes deux interceptées par la barrière finale :
1. Test A — « La Milan Fashion Week **2023** » : année inventée (la source et les faits ne mentionnent que 2026 et 2025). Vraie hallucination, correctement bloquée par le contrôle éditorial.
2. Test B — « La première collection féminine de Chiuri pour Fendi sera présentée à Milan en février » : ce fait avait été **explicitement écarté** avant rédaction. Le rédacteur l'a reconstitué par déduction à partir d'un fait voisin conservé (« suivie du menswear en juin et de la couture en juillet »). Ni l'angle, ni le titre source, ni les mots-clés ne le contenaient. L'instruction réduit donc l'introduction de faits sans l'éliminer.

## Erreurs factuelles / faux positifs

Le blocage dominant n'est plus la rédaction mais **le vérificateur post-rédaction, qui ne cite aucune preuve pour des faits pourtant démontrés**. Sur les cas B, D, H et I, **100 % des claims bloquants ont `sources: 0`**, et plusieurs correspondent mot pour mot à des faits du fact set :

| Claim bloqué (UNVERIFIED) | Fait correspondant remis au rédacteur |
|---|---|
| « Chiuri a débuté sa carrière chez Fendi en 1989 » | VERIFIED — « Chiuri kicked off her career at Fendi in 1989 » |
| « 31 milliards de dollars, soit 1,2 % du marché mondial » | PARTIALLY_VERIFIED — « UNESCO valued the African fashion industry at about 31 billion US dollars in 2023, near 1.2 percent » |
| « plus de 1,5 million de postes » | PARTIALLY_VERIFIED — « The sector supports more than 1.5 million jobs across the continent » |
| « environ 23 milliards de dollars d'importations » | PARTIALLY_VERIFIED — « The continent still imports about 23 billion dollars of clothing and fabric a year » |

Ce sont des **rejets à tort** : le rédacteur a fait son travail, le vérificateur ne retrouve pas la preuve. Conformément à la consigne, la barrière finale n'a pas été touchée pour autant.

Deux classes de faux positifs subsistent aussi dans le contrôle déterministe de chiffres (elles bloquent C à elles seules) :
- **Conversion horaire** : « 2 p.m. CET » (fait vérifié) rédigé « 14 heures » → « 14 » signalé comme inventé.
- **Abréviation de saison** : « Spring/Summer 2026 » (fait vérifié) rédigé « SS26 » → « 26 » signalé comme inventé.

Corrigés en revanche dans cette phase : le séparateur de milliers français (« 141 000 » vs « 141,000 ») et les chiffres fondés uniquement sur `factEvidence`, qui produisaient des faux positifs systématiques dès que le rédacteur travaillait à partir de faits vérifiés (3 tests de non-régression ajoutés).

## Copy risk

Inchangé et non problématique sur 6 cas sur 7 (10–25, seuil 40). Une seule exception, **Test H à 50** — seule source déjà francophone, donc la plus exposée à la reprise littérale : le rédacteur travaillant désormais à partir d'extraits sources français, la tentation de reprendre leur formulation augmente. À surveiller si d'autres sources francophones sont ajoutées.

## Qualité éditoriale et SEO

Scores éditoriaux stables (65–85, moyenne 77,6 — Phase 3 : 78,3). Aucune dégradation mesurable du ton malgré la contrainte factuelle renforcée.

Côté SEO, la remontée de la stratégie de mots-clés **avant** la rédaction (même appel, simple réordonnancement) porte : le mot-clé principal est désormais placé naturellement par le rédacteur, et l'avertissement « mot-clé principal absent du titre et de l'excerpt » — présent sur 6 cas sur 7 en Phase 3 — a disparu. Score SEO 100/100 sur A, G et H. Une régression isolée : **C tombe à 56** (titre SEO et meta description trop longs), le rédacteur ayant cherché à caser le mot-clé long « Lagos Fashion Week SS26 trends ».

## Décision

**NO-GO.**

La correction demandée fonctionne et se mesure : les faits invérifiables sont supprimés avant rédaction, le fact-check passe sur 3 cas contre 1, et la fabrication chiffrée la plus nette de la Phase 3 a disparu de l'article au lieu d'être rattrapée en aval. Le coût par article est inchangé en nombre d'appels.

Mais 1 seul article sur 7 franchit toutes les barrières, et surtout la nature du blocage a changé : ce n'est plus la rédaction qui invente, c'est **le vérificateur final qui rejette des faits vérifiés sans citer de preuve**. Publier dans cet état reviendrait à jeter des articles corrects. Le point de blocage — et donc le sujet de la prochaine phase — est désormais la capacité du vérificateur post-rédaction à retrouver et citer la preuve, pas la discipline factuelle du rédacteur.

Restent à traiter, par ordre d'impact : (1) sous-citation du vérificateur final ; (2) les deux classes de faux positifs chiffrés (horaires, abréviations de saison) ; (3) la fuite par déduction du test B ; (4) le copy risk sur sources francophones.
