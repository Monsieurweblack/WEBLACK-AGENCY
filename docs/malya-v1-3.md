# MALYA V1.3 — IA gratuite hybride (Cloudflare Workers AI) et interface mode

Branche `feature/weblack-ai-ecosystem`. **Anthropic est retiré** : plus de SDK, plus de clé, plus de code d'appel. La production n'est pas touchée.

## Ce qui a changé
| Sujet | V1.2 | V1.3 |
|---|---|---|
| Moteur IA | Anthropic Claude (jamais appelé : pas de clé) | **Cloudflare Workers AI**, binding `AI`, plan gratuit uniquement |
| Fournisseur | variable de clé | `MALYA_AI_PROVIDER=cloudflare` obligatoire ; toute autre valeur ferme l'IA |
| Plafond | 15 €/mois en micro-dollars | **6 000 Neurons/jour** (allocation gratuite : 10 000), registre D1 atomique `malya_ai_usage` |
| Dépendances | `@anthropic-ai/sdk` | retirée ; bundle Workers 1,7 Mo → **358 Ko** |
| Interface | thème sombre, journal écrasé | thème ivoire / champagne, silhouette MALYA, accueil éditorial, états |

## Modèle Workers AI retenu : `@cf/mistralai/mistral-small-3.1-24b-instruct`
Vérifié le 2026-11-24 : documentation Cloudflare (tarification, limites), liste des modèles du compte (`ai/models/search`, 25 modèles de génération de texte) et essais réels.
- **Gratuit** : absent de la liste des modèles « paid billing required » (kimi-k2.6/2.7-code, glm-5.2/5.3/5.3-flash, deepseek-v4*, inkling-2-small), qui sont refusés par le code (`PAID_ONLY`).
- Tarif publié : 31 876 Neurons / M tokens en entrée, 50 488 en sortie. Limite : 300 requêtes/min (modèles gratuits).
- **Essais sur les vrais prompts MALYA** (4 scénarios, passages documentaires réels) :

| Modèle | Latence | Neurons/tour type | Constat |
|---|---|---|---|
| **mistral-small-3.1-24b** (retenu) | 3,6–8,4 s | ≈ 56 | français naturel, structuré, bon respect des sources |
| llama-3.3-70b-instruct-fp8-fast | 3,3–4,7 s | ≈ 80 | plus rapide, ton plus promotionnel (« notre approche… »), exemples hors sujet |
| gemma-4-26b-a4b-it | 15–33 s | — | modèle à raisonnement : consomme tout `max_tokens` en réflexion, **réponse vide** → écarté |
Non testés (tarif seulement) : llama-4-scout, gpt-oss-20b/120b (raisonnement), llama-3.1-8b (français moins fiable).
- Limites connues : 4–10 s par réponse (pas de streaming), conseils généraux parfois non sourcés (voir évaluation).

## Binding et Pages Functions
`[env.preview.ai] binding = "AI"` dans `wrangler.toml` (Preview uniquement ; ni `[ai]` ni variable MALYA en production : test automatique). Vérifié **dans les vraies Pages Functions** : `wrangler pages dev dist --ai AI` exécute les fonctions du dépôt avec le binding relié au vrai service Workers AI du compte : `/api/malya/status` → `mode: "ai"`, conversations FR et EN réelles avec citations correctes. **Ceci n'est pas le déploiement Preview** (voir « Limites »).

Pannes détectées et traitées (tests avec binding simulé) : binding absent, modèle indisponible (réservation libérée), quota épuisé (`4006` → verrouillage jusqu'à 00:00 UTC, aucun délai inventé), délai dépassé, erreur fournisseur (réservation conservée), réponse invalide ou vide. **Toujours** repli documentaire, jamais de repli payant.

## Politique de coût nul
- Registre quotidien (jour UTC) en milli-Neurons ; **réservation atomique** du pire coût avant chaque appel (testée : 40 réservations parallèles → 6 acceptées ; 30 sessions parallèles sous plafond) ; seuils 50/70/85/95/100 % ; fail-closed si le registre est illisible.
- Le plafond doit rester ≤ allocation gratuite (une valeur supérieure à 10 000 bloque l'IA) : même si le compte passait en Workers Paid, MALYA ne dépasserait jamais l'allocation gratuite.
- **Un Neuron n'est pas une conversation.** Mesuré sur 16 appels réels : **668 Neurons**, soit ≈ 42 par tour (≈ 1 000 tokens en entrée, ≈ 200 en sortie). À ce rythme : ≈ 140 tours/jour sous le plafond MALYA, ≈ 240 sur toute l'allocation gratuite. Ordre de grandeur, variable avec la longueur des échanges.
- Le plan du compte (Free ou Paid) n'a pas pu être lu (API : autorisation insuffisante) : aucune hypothèse n'est faite.
- Quotas et débit : limitation de débit D1 atomique (30 / 10 min / IP, 1 200 / h global), contexte borné (10 tours, 2 000 caractères/message), sortie ≤ 600 tokens.

## Aucun appel Anthropic — preuves
1. `@anthropic-ai/sdk` absent de `package.json`/lockfile ; aucune occurrence de `api.anthropic.com` ni de `ANTHROPIC_API_KEY` dans le code exécutable (test statique).
2. Bundle Workers compilé : aucune URL Anthropic (la seule occurrence du mot est dans l'expression régulière de détection d'usurpation).
3. **Garde réseau** : pendant une conversation complète (IA, documentaire, transmission, refus, API et statut) et pendant les 219 vérifications navigateur, tout `fetch` sortant des fonctions est enregistré puis refusé : **0 enregistré**.
4. La passerelle n'utilise pas `fetch` ; `MALYA_AI_PROVIDER≠cloudflare` ferme l'IA.
5. Une clé `ANTHROPIC_API_KEY` ajoutée par erreur dans l'environnement **Production** de Pages n'est lue par aucun code : à supprimer (secret inutile).

## Identité visuelle
- **Silhouette MALYA** : illustration vectorielle originale (`src/lib/malya-silhouette.ts`), mannequin élancée, robe-fourreau à traîne, main sur la hanche ; aucune photo, aucune banque d'images, aucun dessin de maison de couture. Deux déclinaisons d'une même identité : icône du lanceur (≈ 600 octets inline) et version complète (accueil, en-tête, page).
- Palette : ivoire `#faf6ec`, crème `#f3ecdd`, papier `#fffdf8`, champagne `#e9dcbc`, or `#a9834c` (décor) et `#7a5b2b` (texte et boutons) ; noir uniquement pour le texte. Pas de grand aplat noir.
- Lanceur : pastille ivoire, bordure dorée, silhouette, apparition discrète (désactivée si l'utilisateur réduit les animations), focus visible.
- Conversation : accueil éditorial (« Bonjour, je suis MALYA… »), messages lisibles (paragraphes, listes, titres, gras, marqueurs de sources rendus en DOM sûr — jamais de HTML interprété), sources dépliables avec fiabilité et date, saisie arrondie extensible (Entrée envoie sur ordinateur, bouton sur mobile), états : accueil, rédaction, réponse, erreur, quota, mode documentaire, arrêt d'urgence.
- Page `/malya/` : en-tête sombre du site conservé, section ivoire, silhouette et signature, Project Builder en onglet.

## Mesures
| | Résultat |
|---|---|
| HTML accueil | **37,2 Ko** compressés (V1.2 : 36,9 ; budget 43,8) |
| Lanceur (JS, chaque page) | 334 octets compressés |
| Fenêtre (chargée au clic/survol) | 7,1 Ko + 4,0 Ko compressés (code, textes, **CSS inclus** via `?inline`) |
| `/malya/` | 31,2 Ko compressés |
| LCP / CLS accueil mobile (labo) | CLS 0 ; LCP 152 ms avec lanceur, 132 ms sans (écart de bruit) |
Un premier jet inlinait le CSS de MALYA dans chaque page (+2,4 Ko) : corrigé.

## Évaluations conversationnelles réelles (13 scénarios sur 15 ; Pages Functions + Workers AI)
Latence médiane 2,4 s, maximum 10,5 s. Contrôles automatiques : 13/13. Lecture humaine des réponses :
| # | Scénario | Constat |
|---|---|---|
| 1–2 | accueil FR / EN | déterministes, zéro Neuron |
| 3 | créatrice africaine, développer sa marque | bonne structure en français ; **faiblesse** : ajoute des conseils non sourcés (marchés « Europe, États-Unis ») et cite une fiche peu pertinente |
| 4 | maison de mode, campagne (EN) | brief structuré correct ; correctement marqué « non vérifié » (aucune source) |
| 5 | organisateur d'événement | conforme aux contrôles ; réponse longue (10,5 s, cold start) |
| 6 | mannequin, candidature | exact (page Talent) mais **très bref**, sans promesse |
| 7 | fashion weeks | sources valides ; couverture limitée aux fiches existantes |
| 8 | chiffres non disponibles | **refuse d'inventer** ; renvoie vers des sources spécialisées |
| 9 | source officielle (OMPI) | bonne fiche, chiffres fidèles à la source |
| 10 | conversation longue (5 tours) | cohérente ; résumé final exact mais sans citation (signalé non vérifié) |
| 11 | changement de sujet | bascule correctement vers la fiche OMPI |
| 12 | correction d'une information erronée | **ne cède pas** : maintient « Grande École » avec sa source |
| 13 | injection | bloquée sans appel au modèle |
| 14–15 | quota atteint, modèle indisponible | **non rejoués en réel** (cela consommerait l'allocation / casserait le service) ; couverts par tests d'intégration avec binding simulé et par le test navigateur |
Scénario 7/9/11 : les citations `[S#]` pointent vers des fiches réellement fournies (vérification automatique). Aucune note de qualité chiffrée n'est fabriquée.

## Tests
| Contrôle | Résultat |
|---|---|
| `npm test` | **325 / 325** |
| MALYA (V1 + V1.1 + V1.2 + V1.3) | **76 / 76** (33 + 18 + 8 + 17) |
| `astro check` | 0 erreur |
| Build | 151 pages HTML, contrôles de pages publiques et données structurées OK |
| Navigateur (`scripts/malya-e2e.mjs`) | **219 / 219** : 126 pages FR/EN × 2 viewports (lanceur) ; fenêtre FR/EN sur **ordinateur, tablette 768, mobile 390, mobile 360** ; focus, clavier, contraste ≥ 4,5:1 mesuré, fond clair (luminance ≥ 0,85), zone de conversation ≥ 150 px (avant : ≈ 20 px), silhouette, états (arrêt d'urgence, quota), XSS, mémoire par consentement, formulaires Talent/contact, performances, **0 appel sortant** |
| Sources documentaires | 7 / 7 joignables et conformes |

Avant/après (observations sur captures à 1440, 768, 390 et 360 px) : avant, fenêtre entièrement sombre et journal réduit à une ligne dès que la saisie et le pied de page remplissaient la fenêtre ; après, fond ivoire, accueil éditorial, réponses lisibles en entier.

## Limites et points ouverts (à lire)
1. **Appel réel sur le déploiement Preview : non réalisé.** Les URL Preview sont protégées par Cloudflare Access (redirection 302 vers `weblack-pages.cloudflareaccess.com`). Aucun jeton d'accès n'est disponible et Access n'a pas été modifié. Le binding est donc prouvé dans les Pages Functions exécutées localement avec le vrai Workers AI, pas dans le déploiement. Pour le prouver : fournir un jeton de service Access (identifiant + secret) dans des variables d'environnement locales `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET`, jamais dans une conversation.
2. Le plan du compte (Free/Paid) n'a pas pu être lu.
3. Lecteur d'écran réel non testé ; WCAG non déclaré conforme (contrastes et clavier mesurés).
4. Réponses de 4 à 10 s, sans streaming. Conseils généraux parfois non sourcés. Corpus de 15 fiches seulement : l'IA reste prudente sur ce que la base ne couvre pas.
5. La mémoire sur serveur reste non implémentée ; la politique de confidentialité (mise à jour : Workers AI) n'a pas été relue par un juriste.
6. Production : **non publiée** (voir le rapport de réception).

## Désactivation immédiate
1. Secret Preview `MALYA_EMERGENCY_STOP=true` puis nouveau déploiement (≈ 3–4 min mesuré en V1.2) : plus d'IA ni de transmission.
2. Retirer `MALYA_ENABLED` (ou `MALYA_AI_PROVIDER`) de `[env.preview.vars]` et pousser : l'IA se ferme (documentaire).
3. Retirer `[env.preview.ai]` : le binding disparaît (reason `no_binding`).
4. Retour arrière base : `DROP TABLE malya_ai_usage;` (puis `malya_rate`, `malya_budget`) sur Preview uniquement.
