# Content Graph — V1

`src/lib/content-graph.ts` is a typed relation layer over the two relation fields that already exist in Sanity. It does not migrate any data and does not touch the Sanity schema. Four consumers now resolve their relations through it (see "Status" below).

```text
Sanity fields (unchanged)
  relatedWorkSlug / relatedWorkSlugs
        ↓
src/lib/content-graph.ts
  types the relations, derives a stable contentId, exposes typed helpers
        ↓
Pages (4 consumers — see Status)
  call the helpers instead of their own inline .filter() lookups
```

## Status

Four consumers have been migrated to the graph and resolve their relations through it instead of an inline lookup: `JournalDetail.astro` and `partners.astro`/`en/partners.astro` use `getProjectForArticle()` / `getProjectForPartner()`, and `WorkDetail.astro` uses `getRelatedProjects()`. The migration changed no visible behavior — verified against the generated HTML for every relation that exists in the current content.

`getCoveringArticles()`, `getPartnersOf()`, `resolveContentId()`, and `refFor()` remain unused by any consumer today. They exist as the documented, symmetric counterparts of the active helpers above (see "Helpers" below) for when a page needs the inverse lookup or cross-language identity — not dead code left over from a change, but API surface not yet called.

## Entities

Only types that actually exist in this project are modeled:

```text
work      → "Project" in the graph's vocabulary
journal   → "Article"
partners  → "Partner"
talent    → exists as a type and a route (talent/[slug]), 0 published entries today
```

`service`, `event`, `organization` and `person` are **not** modeled as entities — none of them exist as a Sanity content type in this project. Real events (ZE DÉFILÉ, NTA) are today represented as `work` entries themselves; `work.disciplines` is a free-text tag list, not a reference to a `service` entity. Inventing these entity types without real data behind them would violate this project's non-fabrication discipline (see the root `CLAUDE.md`).

## Stable identity — `contentId`

Sanity has no field that ties together the FR and EN documents for "the same" piece of content — they are two unrelated documents with unrelated `_id`s. `resolveContentId(type, lang, slug)` derives a locale-independent `contentId` (`"{type}:{canonicalSlug}"`):

- **Common case** (matching slug in both languages — true for every `work` entry and most `journal` entries today): the contentId falls out of the slug automatically, no configuration needed.
- **Exception**: when the FR and EN slugs genuinely differ for the same content, a hand-verified entry in `CONTENT_ID_ALIASES` bridges them. **This table is never inferred automatically.** As of this writing it has exactly one entry, for the NTA partnership announcement:

  ```text
  fr: l-agence-weblack-annonce-un-partenariat-avec-la-nuit-du-textile-africain-une-nouvelle-ambition-pour-la-creation-africaine
  en: partenariat-nuit-du-textile-africain
  ```

  Verified directly against live Sanity data before being added: both documents independently declare the same `relatedWorkSlug` (`nuit-du-textile-africain-bamako`), confirming they cover the same real announcement — not a guess.

### Adding an alias

Only add an entry to `CONTENT_ID_ALIASES` when you have personally confirmed, from the actual Sanity data (not from titles or dates alone), that two documents in different languages are the same content published under different slugs. A shared `relatedWorkSlug` pointing at the same project, as in the NTA case, is good corroborating evidence. When in doubt, leave it out — an unaliased pair simply isn't unified under one contentId; it does not break anything.

## Relation types

```text
CODE              SOURCE → TARGET     DIRECTIONALITY   STATUS
RELATED_PROJECT   work → work         symmetric         active — work.relatedWorkSlugs
COVERS_PROJECT    journal → work      directed          active — journal.relatedWorkSlug
PARTNER_OF        partners → work     directed          active — partners.relatedWorkSlug
RELATED_TALENT    work → talent       directed          dormant — no field exists yet
RELATED_SERVICE   work → (service)    directed          dormant — no Service entity exists
RELATED_EVENT     work → (event)      directed          dormant — no Event entity exists
```

**"Dormant" means exactly that**: the code (`RELATED_TALENT`, `RELATED_SERVICE`, `RELATED_EVENT`) is reserved in `RELATION_REGISTRY` with `active: false` so a future addition has a name and a documented slot to fill, not a system to design from scratch. No resolver function exists for them, and none should be added until a real Sanity field (for `RELATED_TALENT`) or a real content type (for `RELATED_SERVICE` / `RELATED_EVENT`) exists. Treating a dormant type as functional anywhere in the UI would be exactly the kind of fabricated capability this project explicitly avoids.

### Why CLIENT and SPONSOR are not modeled

`work.client` is free text (e.g. `"Maison de Couture « Marie Kaba »"`) — not a reference to any entity. Building a `CLIENT` or `SPONSOR` relation to an `Organization` would require either a new Sanity schema field (outside this repository) or guessing which `partners` entry a given `client` string refers to. The second option is exactly the kind of inference this project's Content Integrity discipline forbids ("ne devine jamais") — Content Integrity's own `[ENTITY]` warning (`docs/content-integrity.md`) already flags likely name variants for a human to review; the Content Graph does not silently resolve them into an edge.

## Directionality and reciprocity

`RELATED_PROJECT` is symmetric: declaring `relatedWorkSlugs` on project A pointing at project B is enough — `getRelatedProjects()` surfaces the edge from both A's and B's page without B needing its own declaration. `COVERS_PROJECT` and `PARTNER_OF` are directed and are not artificially made bidirectional; an article "covers" a project, a project doesn't "cover" its articles back — the inverse lookup (`getCoveringArticles`, `getProjectForPartner`) is a different, explicitly named helper, not the same relation read backwards.

## Helpers

All resolvers are pure functions — no network calls, no hidden global graph traversal. Each takes the source entry plus an already-fetched, same-language candidate list (pages already call `getEntriesByLang` once per collection; the graph doesn't re-fetch):

```ts
resolveContentId(type, lang, slug): ContentId
refFor(type, entry): ContentRef

getRelatedProjects(project, allProjectsSameLang): WorkEntry[]       // RELATED_PROJECT, both directions
getCoveringArticles(project, articlesSameLang): JournalEntry[]       // inverse of COVERS_PROJECT
getProjectForArticle(article, projectsSameLang): WorkEntry | null    // COVERS_PROJECT direct
getPartnersOf(project, partnersSameLang): PartnerEntry[]             // inverse of PARTNER_OF
getProjectForPartner(partner, projectsSameLang): WorkEntry | null    // PARTNER_OF direct
```

A relation whose target can't be found simply isn't included in the returned array — no thrown error, no broken link rendered. A page using these helpers should treat an empty result as "don't render this section" (never render a "Related Projects" heading with nothing under it).

## Validation

The Content Graph does not introduce a second validation system. It reads the exact same two fields (`relatedWorkSlug`, `relatedWorkSlugs`) that `scripts/content-integrity.mjs` (rule R3) already validates against real published/draft content — the order is:

```text
Content → Content Integrity (npm run integrity) → Content Graph resolution
```

Run `npm run integrity` first; a relation it reports as broken will simply resolve to nothing here, silently, by design (see Helpers above) rather than crashing a page build. `content-integrity.mjs` has not been modified as part of this step — extending it to also validate `CONTENT_ID_ALIASES` entries is a natural follow-up, not yet implemented.

## Limits of this V1

- Not every helper is consumed yet — `getCoveringArticles()`, `getPartnersOf()`, `resolveContentId()`, and `refFor()` have no caller today (see Status).
- `RELATED_TALENT` / `RELATED_SERVICE` / `RELATED_EVENT` are names and registry entries only, not working relations.
- `CLIENT` / `SPONSOR` / `Organization` are out of scope entirely, not just dormant — they would require a Sanity schema change this repository does not control.
- No `Location` entity — `{city, country}` stays an inline field on `work`/`partners`.
- `CONTENT_ID_ALIASES` is hand-maintained; nothing detects a *new* FR/EN slug mismatch and prompts you to add an alias for it (that would be a natural Content Integrity addition, not yet built).
- Reciprocity is computed at read time by scanning `allProjectsSameLang` — fine at the current scale (4 projects); if the `work` collection grows into the hundreds, this candidate list should be indexed by slug once per page render rather than linearly scanned per relation (not needed yet, noted for later).
