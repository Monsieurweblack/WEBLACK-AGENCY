# MALYA / WEBLACK AI — rapport technique V1

> **V1.1 :** ce document décrit la V1 (commit `0094f53`). Les évolutions (connexion Anthropic, budget, base documentaire sourcée, lanceur global, mémoire locale par conversation, supervision) sont décrites dans [`docs/malya-v1-1/`](malya-v1-1/architecture.md). Plusieurs « limites » ci-dessous ont changé : modèle de langage (désormais prévu, désactivé sans clé), présence sur toutes les pages (faite), corpus (7 sources sectorielles ajoutées). Mémoire serveur, comptes, chiffrement et sauvegardes restent **non réalisés**.

Branche : `feature/weblack-ai-ecosystem` (depuis `origin/main` 9bc65fd). Rien n'est fusionné dans `main`, rien n'est déployé.
Fondations d'une plateforme d'intelligence sectorielle, **pas** un chatbot branché sur un modèle externe : la V1 n'appelle aucun service payant.

## 1. Ce qui est réellement implémenté

| Domaine | Réalisation | Fichiers |
|---|---|---|
| Orchestration centrale | Une seule fonction `handleTurn` : validation → détection d'injection → routage → recherche documentaire → génération → filtrage de sortie → proposition d'action. Sans état. | `functions/lib/malya/orchestrator.ts` |
| Compétences | 9 compétences (WEBLACK, Talent, Creative, Consulting, Opportunities, recherche sectorielle, Project Builder, transmission, méta) + « général ». Routage par mots entiers FR/EN, continuité sur messages courts, clarification **uniquement** à égalité de deux compétences. Liste blanche d'outils par compétence, appliquée par `assertToolAllowed`. | `skills.ts` |
| Base de connaissances | Schéma : source, date, fiabilité (vérifié / historique / estimation / hypothèse), provenance. Contrôle d'ingestion qui refuse toute entrée incomplète. 14 domaines sectoriels déclarés. | `knowledge.ts` |
| Couche modèle | Interface `ModelProvider` + `GroundedModel` déterministe (ne dit que ce que la base soutient, étiquette la fiabilité, reconnaît émotions et erreurs sans prétendre ressentir). | `model.ts` |
| Sécurité | Bornage/nettoyage des entrées, détection d'injection FR/EN (y compris dans l'historique fourni par le client), filtre de sortie (images, liens tiers, balises, motifs de secrets), anti-injection d'en-tête mail. | `safety.ts` |
| Consentement | Mémoire locale au navigateur uniquement, activée par case à cocher, expirée à 30 jours, 40 tours max, effaçable. | `consent.ts`, `src/scripts/malya.ts` |
| Actions externes | Seule action : préparer un e-mail à l'équipe. Proposition → confirmation sur empreinte SHA-256 du contenu exact → brouillon `mailto:` que l'utilisateur envoie lui-même (deux validations humaines). | `actions.ts` |
| Project Builder | Brief structuré (module pur partagé navigateur/serveur/tests), champs mémorisés seulement avec consentement. | `projectBrief.ts` |
| Point d'entrée HTTP | `POST /api/malya/chat` : désactivé par défaut, même origine obligatoire, JSON strict, corps ≤ 16 Ko, 30 req/10 min par IP hachée (KV existant), échec fermé sans compteur, journal sans contenu, interrupteur d'urgence. | `functions/api/malya/chat.ts` |
| Interface | Pages `/malya/` et `/en/malya/` (noindex, hors sitemap) : conversation, sources dépliables avec fiabilité et date, suggestions, consentement, Project Builder en onglets (clavier : flèches). Texte inséré via `textContent` uniquement. | `MalyaChat.astro`, `malya-copy.ts` |

## 2. Base de connaissances — état honnête

Le jeu de départ contient **8 entrées**, toutes issues du brief du fondateur ou de l'annonce déjà publiée sur weblack.fr (identité, vision, 3 divisions, méthode Perspective, collaborations vérifiées, annonce ZEDEFILE 2027 avec organisateur non confirmé).
Les **13 autres domaines sectoriels** (mode internationale/africaine, luxe, mannequinat, fashion business, salons, marchés, etc.) sont **déclarés mais vides** : aucune source primaire n'a été fournie, donc rien n'a été écrit. MALYA répond alors qu'elle n'a pas de connaissance vérifiée et propose de transmettre la question. Enrichir = ajouter des entrées validées par `validateEntry`.

## 3. Critères de validation du brief

| # | Critère | Statut | Preuve |
|---|---|---|---|
| 1 | Conversations FR/EN naturelles | **Partiel** : langue détectée, continuité, émotions, corrections, clarification ciblée testées. Naturel limité par un modèle déterministe (réponses composées, pas générées). | malya.test.ts §1 |
| 2 | Orchestration des compétences | Oui (routage + liste blanche d'outils) | §2 |
| 3 | Réponses traçables | Oui (citations source/date/fiabilité ; ingestion refusée sans traçabilité) | §3 |
| 4 | Non-vérifié signalé | Oui (aucun chiffre inventé ; hors couverture = aveu explicite) | §4 |
| 5 | Mémoire et consentement | Oui, côté client. Pas de mémoire serveur en V1. | §5 + e2e navigateur |
| 6 | Aucune fuite entre utilisateurs | Oui par construction (serveur sans état, rien stocké) + blocage des demandes d'accès à autrui | §6 |
| 7 | Actions externes validées | Oui (proposition, empreinte, confirmation, envoi manuel ; interrupteur d'urgence) | §7 |
| 8 | Sécurité couverte par tests | Oui pour ce qui est implémenté (voir limites) | §8 |
| 9 | Accessible et responsive | Vérifié dans un navigateur (desktop et 360 px, FR/EN) : pas de débordement, libellés, clavier, cibles ≥ 40 px. **Contrastes non mesurés**, lecteur d'écran réel non testé. | e2e (hors dépôt) |
| 10 | Aucune régression | `npm test` : 282/282 (249 existants + 33 nouveaux) ; build 150 pages ; accueil 36,6 Ko brotli (budget 43,8 Ko) ; seul fichier existant modifié : `astro.config.mjs` (+2 chemins noindex). | |

## 4. Limites (à ne pas masquer)

- **Pas de modèle de langage.** Aucun fournisseur autorisé ni coût validé : les réponses sont composées depuis la base. Brancher un fournisseur = implémenter `ModelProvider` ; les garde-fous, tests et sorties filtrées restent.
- **Pas de recherche externe** ni de comparaison de ressources en ligne : le brief demande « rechercher des ressources autorisées », mais aucune source n'a été autorisée.
- **Pas de comptes ni de persistance serveur.** La reprise de conversation est locale à un appareil ; le « retrouver les informations d'un projet » n'existe qu'ainsi. Cela suppose, pour une vraie mémoire serveur : authentification, D1, chiffrement, politique de rétention, sauvegardes testées. Non construit.
- **Pas de chiffrement des données sensibles, ni de sauvegarde/restauration** : il n'y a aucune donnée sensible conservée en V1. Les exigences correspondantes sont donc **non couvertes**, pas satisfaites.
- **Traçabilité des actions sensibles minimale** : événements (type + compétence, sans contenu) dans les logs Cloudflare. Pas de table d'audit dédiée.
- **Détection d'injection par motifs** : efficace contre les attaques courantes testées, contournable par reformulation. Défense en profondeur (liste blanche d'outils, filtrage de sortie, pas de secret ni de donnée à exfiltrer), mais pas une garantie. Une évaluation adverse régulière reste à mettre en place.
- **Limitation de débit par fenêtre fixe** sur KV, non atomique (même mécanisme que le reste du site).
- **Présence discrète sur toutes les pages : non faite.** Ajouter un lanceur au gabarit modifie le HTML de chaque page, et l'accueil a un budget de poids strict. Les pages portent déjà le paramètre `?from=talent|creative|consulting|opportunities|contact` pour des suggestions contextuelles ; un lien depuis le site est une décision à prendre.
- **Qualité éditoriale FR/EN** des textes de l'interface à relire par un humain.

## 5. Risques résiduels

1. Les réponses « historique/estimation/hypothèse » sont prévues par le schéma mais le jeu de départ n'en contient aucune : leur rendu est testé en unitaire, pas en usage réel.
2. L'adresse de destination des transmissions est celle de contact publique du site (`weblackconsulting@gmail.com`) ; à confirmer.
3. Le consentement est un stockage local : un utilisateur sur appareil partagé doit penser à effacer (bouton prévu).
4. En l'absence de variable `MALYA_ENABLED=true`, l'API répond 503 : c'est voulu.

## 6. Activer / suspendre / revenir en arrière

- Activer (hors production tant qu'aucune autorisation) : variable Pages `MALYA_ENABLED=true`. Le binding KV `PHOTOS` est requis (déjà présent).
- Suspension d'urgence des actions sensibles : `MALYA_SENSITIVE_SUSPENDED=true` (la conversation reste disponible).
- Arrêt complet : retirer `MALYA_ENABLED`.
- Retour arrière : la branche n'est pas fusionnée ; il suffit de ne pas la fusionner. Aucun changement de base de données, aucun secret ajouté.

## 7. Prochaines décisions

Choix d'un fournisseur de modèle et plafond de dépense ; sources primaires à ingérer par domaine (et par qui elles sont validées) ; présence sur le site ; besoin de comptes/mémoire serveur (et donc cadre RGPD) ; relecture des textes.
