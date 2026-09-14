# Campagne de tests — 2026-09-14

7 sources réelles (Tests A-G), recherchées via web search, aucune fabriquée. Objectif : valider ingestion + dédoublonnage en conditions réelles avant la disponibilité d'une clé OpenAI (analyse/extraction/rédaction non exécutables sans elle — voir le rapport principal).

| Test | Sujet | URL | Résultat |
|---|---|---|---|
| A | Mode internationale | wwd.com — Milan Fashion Week Sept. 2026 | Ingestion OK, dédup OK (distinct), bloqué à l'analyse (pas de clé) |
| B | Maison de luxe | wwd.com — Maria Grazia Chiuri chez Fendi | Ingestion OK, dédup OK (distinct), bloqué à l'analyse |
| C | Mode africaine | guzangs.com — Lagos Fashion Week SS26 | Ingestion OK, dédup OK (distinct), bloqué à l'analyse |
| D | Business créatif | creativeboom.com — plans stratégiques créatifs 2026 | Ingestion OK, dédup OK (distinct), bloqué à l'analyse |
| E | Proche d'un article existant | fashionindustrysummit.se — page officielle du même événement que l'article WEBLACK déjà publié | Ingestion OK, **dédoublonnage NON déclenché** (similarité de titre ~23-29%, sous le seuil de 35%) — voir "Problème détecté" ci-dessous |
| F | Peu pertinent pour WEBLACK | semiconductors.org — actualité semi-conducteurs | Ingestion OK, dédup OK (distinct) ; le score de pertinence n'a pas pu être calculé (pas de clé) pour confirmer qu'il serait bien bas |
| G | Information insuffisante | linkedin.com — post d'annonce, titre = liste de hashtags | Ingestion techniquement réussie mais titre non exploitable en l'état — bon révélateur qu'un contrôle qualité sur le titre est nécessaire en aval |

Note : la première tentative pour le Test B (fashionista.com) a échoué avec une erreur HTTP 403 — le site bloque la récupération automatisée. Comportement correct et attendu : aucun contournement n'a été tenté (conformément à l'interdiction de contourner une protection technique), une autre source a été utilisée à la place.

## Problème détecté : dédoublonnage par titre insensible aux reformulations

Le Test E est le cas le plus important de cette campagne. L'article WEBLACK existant a pour titre "Nordic Fashion Industry Summit 2026 : la mode nordique à l'heure de l'IA" (FR) / "Nordic Fashion Industry Summit 2026: Nordic Fashion Enters the Age of AI" (EN). La page officielle de ce même événement, "Nordic Fashion Industry Summit | 24 September, Jacy'z - Göteborg", n'a que 4 mots réellement en commun avec chaque titre WEBLACK ("Nordic Fashion Industry Summit"), ce qui donne une similarité de recouvrement de mots de ~23-29% — sous le seuil de 35% qui déclenche même la classification LLM ambiguë ajoutée cette phase.

**Conséquence concrète** : si une clé OpenAI avait été présente, cette source aurait été traitée comme un sujet totalement nouveau, pas comme un possible doublon du même événement déjà couvert — alors qu'un humain reconnaît immédiatement qu'il s'agit du même sommet.

**Correction appliquée dans cette même phase** : seuil bas de la zone ambiguë abaissé de 0.35 à 0.2 (`editorial-engine/validation/dedupe.ts`). Re-testé directement avec les mêmes données réelles : le cas Test E déclenche maintenant correctement `needsReview: true` (similarité mesurée 27% contre le titre EN existant) au lieu d'être silencieusement classé "distinct". Vérifié par exécution réelle, pas seulement relu.

**Limite restante, non corrigée cette phase** : la comparaison reste un recouvrement de mots bruts, pas une comparaison d'entités nommées. Un abaissement de seuil réduit le risque mais ne l'élimine pas (un autre cas pourrait tomber sous 20%). Une vraie correction structurelle comparerait les entités nommées (nom d'événement, marque, personne) extraites de chaque titre plutôt que l'ensemble des mots — non implémentée ici, à considérer pour une phase ultérieure.
