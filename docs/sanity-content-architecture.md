# Contenus administrables : sources de vérité et publication

Ce document dit, pour chaque fonction du site, **où vit la donnée qui fait foi**, qui la modifie et comment la modification atteint `weblack.fr`. Il a été établi le 2026-11-10 à partir du code réellement présent dans deux dépôts :

- `WEBSITE WEBLACK`, ce dépôt (github.com/Monsieurweblack/WEBLACK-AGENCY) : le site Astro et les fonctions Cloudflare Pages ;
- `WEBLACK-STUDIO` (github.com/Monsieurweblack/WEBLACK-STUDIO), dossier voisin : Sanity Studio, projet `pzpm4xjp`, dataset `production`, application hébergée `yeedmda7hveeshgojxw8dtjr` (https://weblack.sanity.studio/).

## Sources de vérité

| Fonction | Source de vérité | Qui modifie | Lu par le site |
|---|---|---|---|
| Accueil, paramètres du site, Journal, Projets, Talents publiés, Partenaires (fiches et logos), Équipe, Expertises, Live, Boutique, réglages de la candidature Talent | Sanity | Équipe WEBLACK dans Studio | Au build (`src/lib/content.ts`) |
| Agenda (`event`), WEBLACK Now (`nowSignal`) | Sanity | Moteur éditorial (`editorial-engine/`), corrigeable dans Studio | Au build |
| **Opportunities** (`opportunity`) | **Sanity** (depuis le 2026-11-10) | Équipe WEBLACK dans Studio, menu « Opportunités » | Au build ; clôture à la date limite réappliquée à la requête |
| Candidatures Talent, photos déposées, historique, e-mails | D1 + KV (Cloudflare) | Formulaire public, `/admin/` | Jamais publié |
| Demandes commerciales, pipeline, audit, contacts (RGPD) | D1 | `/admin/` | Jamais publié |
| Espace membre (liens, sessions, mises à jour du profil) | D1 | La personne concernée | Jamais publié |
| Indicateurs du tableau de bord | D1 (lecture) + GA4 (lecture seule, non relié) | — | `/admin/` uniquement |

Règle : **aucune donnée personnelle ni opérationnelle dans Sanity**. Le dataset `production` est lisible publiquement ; une candidature, une demande, une photo déposée pour évaluation ou un journal d'audit n'y a pas sa place. Le tableau de bord n'y lit rien de personnel.

### Opportunities : pourquoi Sanity, et ce qui a été retiré

Avant le 2026-11-10, le texte des annonces était dans le code (`src/data/opportunities.ts`) et leur statut dans D1 (table `opportunities`, migration 0008), réglé depuis `/admin/`. Deux sources pour une même annonce, et une équipe qui ne pouvait pas créer d'annonce sans développeur.

Désormais :

- **tout** est dans le document Sanity `opportunity` : contenu FR/EN, visuels (fichiers originaux dans Sanity), statut éditorial, date limite, territoire, profils concernés, conditions, organisateur, source, date de vérification, confirmation de l'organisateur ;
- `src/lib/opportunities.ts` normalise chaque document ; un document publié mais incomplet est **écarté** (avertissement dans le journal de build), jamais affiché à moitié, jamais bloquant pour le build ;
- la passerelle `functions/opportunities/[[path]].ts` ne lit plus aucune base : elle relit `data-status` / `data-deadline` dans la page servie pour afficher l'annonce clôturée dès l'échéance, sans attendre une reconstruction ;
- l'API `/api/admin/opportunities` et sa table D1 ne sont plus utilisées. La table `opportunities` est **conservée telle quelle** (aucune suppression, migration non destructive) ; elle peut être supprimée plus tard par une migration explicite, après sauvegarde.

Statuts (champ « Statut éditorial ») :

| Statut | Sur le site |
|---|---|
| Brouillon (non publié dans Studio) | Rien. Un brouillon n'est jamais lu (perspective `published`). |
| En vérification | Rien, même publié dans Studio. |
| En ligne | Page + catalogue ; ouverte jusqu'à la date limite, puis affichée clôturée automatiquement. |
| Clôturée | Page lisible, sans bouton de contact. |
| Archivée | Page conservée (clôturée), rangée dans « Archives » du catalogue. |

« Organisateur et mandat de diffusion confirmés » : à cocher seulement après confirmation écrite ; la date de confirmation devient alors obligatoire.

### Creative Directory : volontairement non créé

Aucun type `directory`/profil public n'a été ajouté. Il faut d'abord : un modèle de profil validé, une procédure éditoriale, un consentement explicite à la publication (validation juridique en attente). Les candidatures et les photos déposées pour évaluation ne doivent jamais servir à le peupler.

## De la publication dans Studio au site en ligne

```text
Studio → Publier
   ↓  webhook Sanity « WEBLACK WEB » (dataset production)
Deploy hook Cloudflare Pages « sanity-publish » (branche main)
   ↓
npm run build → déploiement en production (≈ 2 à 4 min)
```

État vérifié le 2026-11-10 :

- deux webhooks Sanity pointent vers Cloudflare : « WEBLACK WEB » (actif : ses livraisons correspondent aux déploiements `deploy_hook` de Cloudflare) et « Cloudflare Production Deploy » (aucune livraison journalisée) ;
- deux deploy hooks Cloudflare nommés `sanity-publish` existent sur `main` (créés le 2026-09-11 et le 2026-10-06) ;
- preuve : les publications du 2026-11-09 à 18:32 (Accueil, Paramètres du site) ont déclenché deux déploiements `deploy_hook` réussis la même seconde.

Les URL de deploy hook sont des secrets : jamais dans Git, le frontend ou un journal. Pour les lire ou les modifier : Cloudflare → Pages → `weblack` → Settings → Builds → Deploy hooks ; Sanity → manage → projet `pzpm4xjp` → API → Webhooks.

## Retour arrière

- **Site** : redéployer le commit précédent (`git revert` du commit Opportunities → push sur `main`), ou dans Cloudflare Pages « Rollback » sur le déploiement précédent. Le tag `opportunities-visuals-2026-11-09` pointe sur la dernière version « contenu dans le code ».
- **Studio** : le type `opportunity` est purement additif ; revenir au commit `29dd26a` du dépôt Studio puis `npm run studio:deploy`. Les documents `opportunity` restent dans le dataset sans effet.
- **Contenu** : l'historique de chaque document est dans Studio (« Historique »), restaurable version par version.
