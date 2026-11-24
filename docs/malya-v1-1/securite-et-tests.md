# Sécurité, tests et procédures

Défense en profondeur ; aucune sécurité absolue n'est promise.

## Couches
1. **Entrée** : bornage (2 000 caractères, 20 tours), nettoyage des caractères invisibles, détection d'injection FR/EN/ES/DE/IT/PT (consignes à ignorer, extraction du prompt, exfiltration, accès à autrui, usurpation « développeur », désactivation des garde-fous/du budget). **L'historique fourni par le client est traité comme non fiable.** Une injection ne déclenche jamais d'appel payant.
2. **Documents = données** : à l'ingestion, tout texte ressemblant à une instruction est refusé ; dans le prompt, les passages sont balisés `<doc>`, leurs chevrons neutralisés, et le système interdit de suivre une consigne trouvée dans un document.
3. **Outils** : liste blanche par compétence (`assertToolAllowed`) ; la seule action est de *préparer* un brouillon `mailto:`, après proposition, confirmation liée à l'empreinte SHA-256 du contenu **et de la catégorie** (Talent, Consulting, Creative, Événement, Partenariat, Général), puis envoi manuel par l'utilisateur. Aucun e-mail n'est envoyé par le serveur.
4. **Sortie** : liens non autorisés, images, balises et motifs de secrets retirés ; marqueurs `[S#]` inventés supprimés ; sans citation → « non vérifié ». Interface : `textContent` uniquement (XSS testé).
5. **API** : désactivée par défaut, même origine obligatoire, JSON strict, 16 Ko, aucune réponse mise en cache. **Limitation de débit atomique en D1 (V1.2)** : 30 requêtes / 10 min par IP hachée et 1 200 / h au global (une seule instruction `INSERT … ON CONFLICT … RETURNING`), échec fermé si la base est illisible, purge déterministe des fenêtres expirées.
6. **Secrets** : `ANTHROPIC_API_KEY` lu uniquement dans `llm.ts` côté serveur ; la passerelle ne journalise rien ; les erreurs du fournisseur ne sont jamais renvoyées ; un test parcourt le dépôt (motifs `sk-ant-…`, affectations de clé) ; le bundle Workers ne contient pas de clé.
7. **Audit** : événements sensibles (injection bloquée, repli du fournisseur, proposition/confirmation/rejet de transmission) journalisés **sans contenu** (type + compétence). Pas de table d'audit dédiée.
8. **Arrêt d'urgence** : `MALYA_EMERGENCY_STOP=true` → plus d'appel Anthropic, de transmission ni de mémoire serveur ; le documentaire reste servi.
9. **Administration** : `GET /api/admin/malya` derrière la session admin existante (503 non configurée, 401 sans session ou session falsifiée) : état du service, fournisseur (clé configurée oui/non, jamais la clé), budget, couverture et obsolescence de la base, compétences. **Aucune conversation.** Pas d'écran dédié : lecture JSON uniquement.

## Résultats mesurés (exécution du 2026-11-24)
| Contrôle | Résultat |
|---|---|
| `npm test` (dépôt entier) | **326 / 326** |
| dont MALYA : V1 `malya.test.ts` + V1.1 `malya-v11.test.ts` | **77 / 77** (33 + 44) |
| `astro check` | 0 erreur |
| Build | 133 pages Astro, 151 HTML, contrôles de pages publiques et de données structurées OK |
| Navigateur `scripts/malya-e2e.mjs` | **108 / 108** |
| Compilation Workers (`wrangler pages functions build`) | OK (≈ 1,7 Mo) |

Le test navigateur couvre : 126 pages publiques FR/EN × 2 viewports (lanceur unique, visible, sans chevauchement d'un élément porteur de contrôles ou de texte, sans débordement horizontal, aucun appel API et aucun téléchargement du moteur au chargement) ; fenêtre FR/EN sur ordinateur et mobile 360 px (focus, nom accessible, Échap, retour du focus, réouverture, 40 Tab sans fuite du focus, contour de focus 2 px, plein écran mobile, cibles ≥ 24 px et boutons ≥ 40 px, **contraste mesuré ≥ 4,5:1 sur 11 éléments**) ; mode IA et documentaire ; XSS ; consentement, expiration 30 jours, conversations séparées, retrait, effacement, isolation entre navigateurs ; formulaires Talent et contact utilisables avec le lanceur ; LCP/CLS accueil mobile avec et sans lanceur (CLS 0 ; LCP 160 ms contre 148 ms : écart de bruit).
HTML de l'accueil : **36,9 Ko compressés** (budget 43,8 Ko ; +0,3 Ko pour le lanceur).

## Limites des vérifications (à lire)
- **Aucun appel à l'API Anthropic réelle** (pas de clé, pas de dépense autorisée) : le fournisseur est une doublure ; les évaluations conversationnelles portent sur le **pipeline** (prompt, citations, repli, budget), **pas sur la qualité des réponses de Claude**. La qualité réelle doit être évaluée en préproduction.
- **Pas de lecteur d'écran réel** (NVDA, VoiceOver…) : accessibilité vérifiée par noms accessibles, rôles, clavier et contrastes mesurés. **WCAG n'est pas déclaré conforme.** La page `/malya/` n'a pas eu de mesure de contraste dédiée (seule la fenêtre l'a eue).
- Le test de chevauchement ignore volontairement un panneau photo sticky décoratif de `/talent/candidature/` (desktop) recouvert par le coin du lanceur ; aucun contrôle ni texte n'est masqué.
- LCP/CLS : mesures de laboratoire locales, 3 passes, pas de données de visiteurs réels.
- Détection d'injection par motifs : bloque les attaques testées, pas toute reformulation ; d'où les couches 2 à 6. Une évaluation adverse régulière reste à planifier.
- Limitation de débit à fenêtre fixe (atomique depuis la V1.2, D1) ; elle ne distingue pas les utilisateurs derrière une même IP (réseau d'entreprise, NAT).
- Les migrations n'ont pas été appliquées sur une base distante.

## Procédure de préproduction (aucune n'a été exécutée)
1. **Ne jamais** appliquer sur la base de production. Migrations 0009 et 0010 sur la base de **préproduction** uniquement (voir `docs/malya-v1-2-preview.md` : la base Preview n'a pas de table `d1_migrations`, donc `wrangler d1 migrations apply` rejouerait tout l'historique et ne doit PAS être utilisé). Retour arrière : `DROP TABLE malya_budget; DROP TABLE malya_rate;`.
2. Variables : **les variables en clair vivent dans `wrangler.toml` `[env.preview.vars]`** (le tableau de bord ne les lit pas quand ce fichier existe) ; seuls les **secrets** se posent dans le tableau de bord Cloudflare Pages → Preview : `ANTHROPIC_API_KEY` et `MALYA_EMERGENCY_STOP`.
3. Poser en plus une **limite de dépense mensuelle dans la Console Anthropic** (≤ 15 $) : seconde barrière indépendante du code.
4. Vérifier : `GET /api/malya/status` → `mode: "ai"` ; 1 conversation FR + 1 EN ; `GET /api/admin/malya` (session admin) → `budget.calls`, tokens, coût ; première requête observée dans la Console Anthropic (forme de la requête et paramètre `output_config.effort` à confirmer sur le modèle choisi).
5. Relire le corpus (passer les entrées en `human-validated`), compléter la politique de confidentialité (transfert vers Anthropic), puis seulement alors demander l'autorisation de production.

## Désactivation
Coupure immédiate (≈ 1 s) : révoquer la clé dans la Console Anthropic (MALYA retombe en documentaire). Coupure du fournisseur et des actions : secret `MALYA_EMERGENCY_STOP=true` puis nouveau déploiement (mesuré : ≈ 3 à 4 min). Coupure des seules actions : `MALYA_SENSITIVE_SUSPENDED=true`. Arrêt complet de l'API : retirer `MALYA_ENABLED`. Retrait du lanceur : retirer `<MalyaLauncher>` de `BaseLayout.astro`. Aucune de ces opérations ne demande de migration.
