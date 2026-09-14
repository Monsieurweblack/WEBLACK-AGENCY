# PHASE 3 — Correction du fact-checking multilingue — 2026-09-14

Correction ciblée de la stratégie de preuve du registre de claims (`validation/claimRegistry.ts`), suivie d'une nouvelle campagne réelle A-J sur les **mêmes 10 URLs réelles que la campagne précédente** (avant/après directement comparable). Aucune tolérance assouplie, aucune confiance LLM utilisée comme preuve, aucun draft Sanity créé, aucune publication, `main` non modifié.

## 1. Rapport technique

### Le problème exact (rappel)

La campagne précédente montrait qu'un fait réel, correctement traduit (« 496,000 visitors » → « 496 000 visiteurs ») était marqué `UNVERIFIED` avec **zéro source citée**, parce que le modèle de fact-check devait citer une preuve verbatim dans une langue différente de celle du claim publié, et échouait à le faire de façon fiable.

### Architecture ajoutée

Le registre de claims distingue désormais 5 stratégies de preuve (`EvidenceType` / `VerificationMethod`), appliquées dans cet ordre de robustesse :

1. **exactEvidence** (`EXACT`) — la citation apparaît mot pour mot dans la source.
2. **normalizedEvidence** (`NORMALIZED`) — idem après normalisation (ponctuation, guillemets, apostrophes, séparateurs de milliers, casse).
3. **translatedEvidence** (`CROSS_LANGUAGE`) — la source est dans une autre langue : la citation d'origine est confirmée verbatim dans la source (preuve canonique, jamais remplacée par sa traduction), ET les éléments factuels atomiques comparables incluent au moins un champ « dur » (quantité ou date) qui concorde avec le claim publié.
4. **semanticEvidence** (`SEMANTIC`) — même mécanisme, mais seuls des champs « mous » (sujet, action, lieu, personne...) sont comparables — plus faible, toujours fondé sur des champs, jamais sur « le LLM pense que c'est probablement vrai ».
5. **independentEvidence** (`INDEPENDENT_SOURCE`) — une source primaire, ou deux sources secondaires indépendantes concordantes (règle §8 déjà existante, inchangée).

Chaque claim porte désormais : `sourceLanguage`, `claimLanguage`, `publishedClaim`, `evidenceQuote` (texte original, preuve canonique), `evidenceTranslation` (traduction de travail, jamais une preuve en soi), `evidenceType`, `verificationMethod`.

### Les deux étapes de vérification, jamais court-circuitées

**Étape 1 — la citation est-elle réelle ?** `evidenceQuote` doit apparaître verbatim (ou quasi-verbatim après normalisation) dans le texte réel de la source, dans la langue de la source. Si non : l'entrée est rejetée intégralement, quel que soit le type de claim — aucune traduction ne peut « sauver » une citation qui n'existe pas.

**Étape 2 — la citation soutient-elle réellement ce qui est publié ?** C'est l'étape qui manquait avant cette phase, et qui s'est révélée nécessaire dès le premier test réel (voir § Bug 2 ci-dessous) :
- Pour une citation directe (`type: "quote"`) : le claim publié lui-même doit contenir cette citation verbatim — vérifié contre le texte publié, pas contre la source. Une citation traduite ne peut, par construction, jamais passer ce test (tolérance zéro préservée).
- Pour tout autre type, si la source est dans la même langue que le claim : en l'absence d'éléments factuels comparables, la correspondance verbatim de l'étape 1 suffit (comportement historique préservé). Tout écart réel sur un champ comparable bloque quand même.
- Si la source est dans une langue différente : la comparaison programmatique des éléments factuels (`compareFactElements`) DOIT aboutir à une correspondance — un résultat « rien à comparer » n'est **jamais** traité comme une réussite (règle explicite du brief : ne jamais transformer un UNVERIFIED en VERIFIED faute de mieux).

Un écart sur un champ « dur » (quantité, date) → `CONTRADICTED`. Un écart uniquement sur un champ « mou » (action, sujet, causalité) → `UNVERIFIED`, jamais confondu avec une contradiction chiffrée.

### Deux bugs réels trouvés et corrigés pendant l'implémentation (tests déterministes + test réel)

**Bug 1 — comparaison de dates trop stricte.** Le premier test réel (« 496,000 visitors » / cas critique) a échoué : le modèle avait rempli le champ `date` avec seulement le nom du mois (« septembre » / « September », sans jour ni année), que `normalizeDateString` ne savait pas parser — les deux valeurs, bien qu'identiques en substance, devenaient `undefined`, et le code traitait alors ce champ comme un **désaccord** plutôt que comme « rien à comparer ». Corrigé : (a) reconnaissance d'un nom de mois seul, normalisé en `month:MM` ; (b) un champ dur non parsable des deux côtés est désormais ignoré (ni comparé, ni compté comme mismatch) plutôt que traité comme une contradiction — une limite de parseur ne doit jamais devenir une accusation de contradiction.

**Bug 2 — le modèle extrayait `sourceFactElements` dans la langue de la source (anglais) au lieu de la langue du claim (français)**, rendant toute comparaison de champs « mous » vouée à l'échec par construction (comparer des mots anglais à des mots français). Corrigé en renforçant le prompt système avec une règle impérative explicite et un exemple travaillé complet (source anglaise → claim français → décomposition attendue dans les deux objets, en français).

Après ces deux corrections, le test réel critique (reproduction exacte du cas A de la campagne précédente) passe de façon reproductible sur deux exécutions réelles consécutives : `PARTIALLY_VERIFIED` via `CROSS_LANGUAGE`, avec la source, la citation originale ET sa traduction effectivement citées — exactement le comportement attendu.

## 2. Rapport des tests

### Tests déterministes ajoutés (`tests/claimRegistry.test.ts`)

29 tests au total (7 tests de référence conservés/adaptés + 3 tests unitaires des primitives + 15 tests A-O multilingues du brief + 2 tests de composition + 2 tests réels end-to-end). Résultat : **29/29 PASS**, y compris les deux tests réels contre le modèle en production (exécutés deux fois pour vérifier la reproductibilité).

Points notables de la matrice A-O :
- **A, B, C, D, F** (chiffres, dates, noms, lieux, devises EN→FR) : `VERIFIED`/`PARTIALLY_VERIFIED` via `translatedEvidence`/`semanticEvidence` — le mécanisme fonctionne.
- **E** (citation traduite) : `UNVERIFIED` — confirmé, tolérance zéro préservée même quand les éléments factuels concordent.
- **G** (traduction volontairement incorrecte) : `UNVERIFIED`, écart « mou » détecté sur l'action.
- **I, J** (chiffre/date modifié) : `CONTRADICTED`, écart « dur » détecté.
- **K** (relation causale modifiée, chiffre correct — le test central de cette phase) : `UNVERIFIED`, **pas** `VERIFIED` — la citation existe et le chiffre concorde, mais le sujet et l'action ne concordent pas ; le système vérifie bien le **sens factuel**, pas seulement les chiffres, comme exigé.
- **N, O** (source primaire vs secondaire, anglophones) : `VERIFIED` / `PARTIALLY_VERIFIED` respectivement — la règle §8 continue de s'appliquer au-dessus de la vérification multilingue.

Suite complète du moteur (`tests/*.test.ts`) : **86 tests passants, 2 skip documentés** (aucune régression sur le dédoublonnage, l'anti-copie, la qualité éditoriale, le SEO).

### Séquence de clôture obligatoire

```
npm run editorial:test    → OK (OpenAI configuré, 130 modèles ; Sanity OK, 9 articles ; auteur "Monsieur W." OK)
npx tsc --noEmit           → 0 erreur
npx astro check             → 158 fichiers, 0 erreur / 0 avertissement / 0 hint
npm run build                → 47 pages, succès
```

## 3. Nouvelle campagne réelle A-J (mêmes 10 URLs que la campagne précédente)

| Test | Sujet | Editorial | SEO Opp. | News | SEO Qual. | Copy Risk | Claims (V/PV/UV/C) | Décision |
|---|---|---|---|---|---|---|---|---|
| A | Milan Fashion Week, wwd.com (EN→FR) | 83 | n/d | n/d | 89 | 65 | 6 (0/2/4/0) | REJECT |
| B | Fendi/Chiuri, wwd.com (EN→FR) | 81 | 59 | 83 | 89 | 15 | 5 (0/0/5/0) | REJECT |
| C | Lagos Fashion Week, guzangs.com (EN→FR) | **87** | 68 | 90 | 78 | 15 | 4 (0/0/4/0, tous non-critiques) | **DRAFT (PASS complet)** |
| D | Creative Boom (EN→FR) | 77 | 67 | 80 | 89 | 10 | 6 (0/0/6/0) | REJECT |
| E | zedefile.com (doublon exact) | — | — | — | — | — | — | SKIP (duplicate_exact, coût nul) |
| F | farmequip.org (hors sujet) | — | — | — | — | — | — | SKIP (duplicate_exact sur run antérieur, coût nul) |
| G | LinkedIn (info insuffisante, EN→FR) | 69 | 57 | 72 | 100 | 20 | 5 (1/1/3/0) | REJECT |
| H | africaradio.com (FR→FR) | 77 | 56 | 77 | 89 | 55 | 3 (0/0/3/0) | REJECT |
| I | riotimesonline.com, $31B (EN→FR) | 83 | 71 | 86 | 89 | 15 | 8 (0/2/6/0) | REJECT |
| J | fashionindustrysummit.se (proche existant) | — | — | — | — | — | — | SKIP (duplicate_semantic, 85% confiance) |

*(V=VERIFIED, PV=PARTIALLY_VERIFIED, UV=UNVERIFIED, C=CONTRADICTED)*

### Coût et durée réels

50 appels OpenAI, **111 451 tokens**, ~0,035 USD estimés (gpt-4o-mini). Répartition : analysis 8/12 987, fact-extraction 8/17 243, generation 8/16 192, **quality-control 16/52 435 (47 % du coût)**, seo-strategy 8/10 849, dedup-classification 2/1 745. Le fact-check multilingue coûte légèrement plus cher qu'avant (47 % contre 42 %) — cohérent avec le schéma enrichi (éléments factuels, traduction) — reste négligeable en valeur absolue.

## 4. Comparaison avec la campagne précédente (mêmes 10 sources réelles)

**Le correctif fonctionne, de façon démontrée sur données réelles, pas seulement en test unitaire :**

- **Test A** (le cas qui a motivé cette phase) : en Phase 2, le claim des visiteurs était `UNVERIFIED` avec **zéro source citée**. En Phase 3, sur un nouveau tirage du même article, deux claims critiques atteignent `PARTIALLY_VERIFIED` via `SEMANTIC` avec preuve anglaise ET traduction française effectivement citées (la date du salon, le rôle de Carlo Capasa) — le mécanisme de citation cross-langue fonctionne concrètement, pas seulement sur le cas synthétique du test unitaire.
- **Test C** : premier **PASS complet** de tout le projet (Phase 1, Phase 2 et Phase 3 confondues) — `factCheck: pass`, `copyCheck: pass`, `editorialCheck: pass`, décision `draft`. À nuancer : les 4 claims extraits étaient tous classés « significant » (non bloquants), pas « critical » — le succès tient autant à une extraction de claims moins hasardeuse par le modèle qu'à la vérification multilingue elle-même sur ce cas précis.
- **Test G** : passe de 0 claim vérifié (Phase 2) à 1 `VERIFIED` + 1 `PARTIALLY_VERIFIED` (Phase 3) — amélioration réelle, mais reste rejeté par ailleurs.
- **Test I** : passe de 0 claim vérifié (Phase 2, `claimRegistryPass: false`) à 2 `PARTIALLY_VERIFIED` (Phase 3) — même conclusion.

**Ce qui reste rejeté, et pourquoi c'est maintenant un signal de meilleure qualité :** sur les 6 cas ayant atteint la génération (A, B, C, D, G, H, I), la majorité des claims encore `UNVERIFIED` le sont pour des raisons qui ne relèvent plus de la barrière linguistique :
- **Aucune preuve du tout citée par le modèle** (`sources: []`) pour des chiffres très précis (« 31 milliards de dollars en 2023 », « 1,5 million d'emplois », « 23 milliards de dollars d'importations ») — cohérent avec le problème déjà identifié en Phase 1/2 : la génération invente des statistiques précises au-delà de ce que dit réellement la source. C'est un problème de génération, pas de fact-check — le fact-check fait ici exactement son travail en bloquant ces inventions.
- **Écart « mou » réel** (citation authentique, mais ne soutenant pas ce qui est publié) — ex. Test A : « près de 141 000 visiteurs, dont la moitié de l'étranger » cite une vraie phrase de la source mais avec un sujet/verbe qui ne correspond pas exactement à ce qui est publié.
- **Citations attribuées non vérifiables** (Test D : propos prêtés à des professionnels nommés, non retrouvés verbatim).

**Nouveau point de variance non lié au fix** : Test H (africaradio.com, seule source déjà en français) a un `copyRiskScore` de 55 cette fois contre 35 en Phase 2, sur un nouveau tirage du même article — rappel que la génération reste non déterministe d'un run à l'autre sur la même source, indépendamment du fact-check.

## 5. Faux positifs / faux négatifs

- **Faux négatifs** : aucun trouvé — aucune fabrication n'est passée le gate sur cette campagne, ni sur les tests déterministes (K en particulier le prouve explicitement : chiffre correct + causalité fausse = toujours bloqué).
- **Faux positifs corrigés pendant l'implémentation** : les deux bugs de date/langue ci-dessus produisaient de faux `CONTRADICTED`/`UNVERIFIED` sur des faits réels — corrigés avant la campagne, pas pendant (conformément à la consigne de ne pas ajuster le système en cours de campagne).
- **Faux positif résiduel non corrigé** : le contrôle déterministe de chiffres (`qualityCheck.ts`) continue occasionnellement de signaler des nombres réels comme « possiblement inventés » (Tests G, H, I) — limitation déjà documentée en Phase 2, toujours présente, non traitée dans cette phase (hors périmètre : le brief demandait de corriger la stratégie de preuve multilingue, pas ce contrôle-là).

## 6. Améliorations encore nécessaires

1. **Génération encore trop encline à inventer des statistiques précises** (Test I notamment) — le fact-check les bloque correctement, mais cela reste la première cause de rejet ; un resserrement du prompt de génération (n'énoncer un chiffre que s'il est explicitement dans les faits extraits) réduirait le taux de rejet sans toucher au fact-check.
2. Le contrôle déterministe de chiffres/dates de `qualityCheck.ts` reste une source de faux positifs mineurs.
3. Le mécanisme de citation cross-langue n'a été exercé, en conditions réelles, que sur des sources à un seul champ dur comparable à la fois (date OU quantité) — sa robustesse sur des claims combinant plusieurs champs durs simultanément reste à observer sur davantage de cas réels.

## 7. Décision finale

**NO-GO — mais avec un déblocage réel et mesuré.**

La limitation structurelle qui motivait cette phase est corrigée et démontrée sur données réelles : un fait anglais correctement traduit peut désormais atteindre `VERIFIED`/`PARTIALLY_VERIFIED` avec une preuve source ET sa traduction réellement citées, sans aucun assouplissement de la tolérance (le test K le prouve : un chiffre juste avec une causalité fausse reste bloqué). Un cas (Test C) atteint même un PASS complet, une première pour ce projet.

Cela dit, le NO-GO reste justifié : sur les 6 cas ayant atteint la génération dans cette campagne, un seul (C) est publiable en l'état, et son succès tient en partie à une extraction de claims moins ambitieuse plutôt qu'à une preuve que l'ensemble du pipeline produit systématiquement un contenu fiable. La cause de rejet dominante a changé de nature (de « barrière linguistique empêchant toute preuve » à « la génération invente encore des chiffres précis que le fact-check bloque correctement ») — un progrès réel, mais qui déplace le problème vers la génération plutôt que de le résoudre entièrement. Aucun signal de sécurité n'est en cause : le système continue de bloquer correctement tout ce qui doit l'être.
