# MALYA V1.1 — architecture réellement implémentée

Branche `feature/weblack-ai-ecosystem`, base V1 `0094f53`. Rien n'est déployé ni fusionné dans `main`.

## Flux d'une requête

```
navigateur ──POST /api/malya/chat──► chat.ts (origine, JSON, taille, débit KV)
                                        │
                                        ▼
                               orchestrator.handleTurn
   1 validation + nettoyage ─ 2 détection d'injection ─ 3 routage de compétence (liste blanche d'outils)
   4 recherche documentaire hybride (knowledge.ts)  ─ 5 choix du moteur :
        déterministe (salutation, présentation, transmission, fait simple)  → GroundedModel, 0 dépense
        sinon → llm.plan() (interrupteurs, clé, tarif, budget) → buildPrompt → llm.call()
                   réservation atomique D1 → SDK Anthropic → réconciliation de l'usage réel
   6 filtre de sortie (liens, images, secrets) ─ 7 citations [S#] vérifiées ─ 8 proposition d'action éventuelle
```

À chaque défaillance avant l'appel (clé absente, budget, registre, arrêt d'urgence, erreur fournisseur), MALYA répond en **mode documentaire** et le dit (`mode`, `modeReason`). Rien n'est simulé.

## Compétences
Les neuf compétences de la V1 sont conservées et vérifiées (`skills.ts`) : WEBLACK, Talent, Creative, Consulting, Opportunities, recherche sectorielle (Fashion Research), Project Builder, transmission, méta, plus une compétence « générale » qui interroge toute la base. Un seul appel modèle par tour, jamais un par compétence. Départage des égalités : l'intention d'action d'abord ; une seule question de clarification subsiste (stratégie de marque ou production).

## Fichiers
| Rôle | Fichier |
|---|---|
| Orchestration | `functions/lib/malya/orchestrator.ts`, `skills.ts` |
| Fournisseur et budget | `llm.ts`, `prompt.ts`, `pricing.ts`, `budget.ts`, `migrations/0009_malya_budget.sql` |
| Connaissances | `knowledge.ts`, `corpus.ts` |
| Sécurité | `safety.ts`, `actions.ts`, `serverMemory.ts` |
| Mémoire locale | `consent.ts`, `src/scripts/malya-core.ts` |
| API | `functions/api/malya/chat.ts`, `status.ts`, `functions/api/admin/malya.ts` |
| Interface | `MalyaLauncher.astro` (toutes les pages), `malya-widget.ts` (chargé à la demande), `MalyaChat.astro` + `malya.ts` (page `/malya/`) |
| Tests | `functions/lib/malya.test.ts`, `malya-v11.test.ts`, `scripts/malya-e2e.mjs` |

## Présence sur le site
Un bouton (336 octets de JS compressé) sur toutes les pages publiques FR/EN, sauf `/malya/` et `/admin/`. Le moteur (≈ 6,7 Ko compressés) n'est téléchargé qu'au survol, au focus ou au clic ; **aucun appel d'API au chargement d'une page**. La fenêtre est une `<dialog>` native (focus piégé, Échap, arrière-plan inerte, focus restitué).
