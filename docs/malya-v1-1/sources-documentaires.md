# Sources documentaires — Verified Fashion Knowledge Engine

## Schéma d'une entrée (`KnowledgeEntry`, contrôlé par `validateEntry`)
`id`, `title` FR/EN, `domain` (14 domaines), `text` FR/EN (reformulation courte, jamais une copie), `keywords`, `source {label, kind, url}`, `author`, `publishedAt?`, `consultedAt`, `verifiedAt`, `nextReviewAt`, `lang`, `reliability` (`verified` · `historical` · `estimate` · `hypothesis`), `validation` (`draft` · `machine-checked` · `human-validated`), `provenance`, `contradicts?`.

L'ingestion **refuse** : champ manquant ou date invalide ; « verified » hors brief du fondateur sans URL ; brouillon « verified » ; texte ressemblant à une instruction (injection indirecte).

## Ce qui est intégré (15 entrées)
**8 entrées WEBLACK** fournies par le fondateur (identité, vision, 3 divisions, méthode Perspective, collaborations vérifiées, annonce ZEDEFILE 2027 — organisateur non confirmé) : `human-validated`.

**7 entrées sectorielles**, lues sur la page officielle citée le 2026-11-24, `verified` (source primaire) mais `machine-checked` — **pas encore relues par WEBLACK** :
| Entrée | Source | Domaine |
|---|---|---|
| `fhcm-role` | fhcm.paris | haute couture / prêt-à-porter |
| `fhcm-cnmi-protocole` | fhcm.paris (actualités, juin 2026) | fashion weeks |
| `cnmi-milano-fashion-week` | cameramoda.it | fashion weeks |
| `ifm-grande-ecole` | ifmparis.fr | fashion business |
| `ompi-la-haye-dessins` | wipo.int/hague | créateurs / designers |
| `unesco-convention-2005` | unesco.org | industries créatives |
| `safw-presentation` | safashionweek.co.za | fashion weeks |

Chaque entrée précise ce que la page **ne dit pas** (ex. gouvernance de l'appellation « Haute Couture », opérateur et dates de SAFW) et MALYA ne l'invente pas.

## Ce qui n'est PAS intégré
- Sources testées mais introuvables (HTTP 404 le 2026-11-24) : Lagos Fashion Week (`/about/` et accueil), pages OMPI « mode », UNESCO « économie créative ». Rien n'a été écrit à leur place.
- **Aucune entrée** pour : luxe et maisons, mannequinat, marchés internationaux et africains, partenariats/sponsoring, direction artistique, branding, production de défilés, mode africaine et diaspora (domaines déclarés, **vides**). MALYA répond qu'elle n'a pas de connaissance vérifiée plutôt que d'en inventer. Les chiffres de marché, prix, salaires, disponibilités sont refusés par une garde d'attribut (une fiche voisine ne « répond » pas à une question de taille de marché).
- Aucune aspiration massive de contenu protégé : uniquement des métadonnées, des liens et des reformulations courtes.

## Recherche (lexicale hybride, sans infrastructure vectorielle payante)
Racinisation FR/EN, synonymes bilingues, expressions, pondération mots-clés > titre > texte, **couverture de concepts** (une fiche doit couvrir au moins deux concepts distincts de la question), garde d'attribut, pénalité et exclusion des fiches obsolètes pour les questions d'actualité, signalement des contradictions. Le modèle ne reçoit que les passages utiles (4 au plus, moins sous tension budgétaire), balisés `<doc>` et traités comme des **données**.

## Enrichir la base (procédure)
1. Lire la source primaire (institution, fédération, organisateur, texte officiel). 2. Rédiger une reformulation courte et dater la consultation. 3. Ajouter l'entrée dans `corpus.ts` avec `validation: "machine-checked"`. 4. `npm test` (le contrôle d'ingestion couvre tout le corpus). 5. Relecture par WEBLACK → `human-validated`. 6. Revoir à `nextReviewAt` (rapport : administration → « obsolètes » et « à relire »).
