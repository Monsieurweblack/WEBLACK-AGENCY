# Content Integrity

`npm run integrity` audits the site's Sanity content (talent, work, journal, partners) for technical inconsistencies — broken relations, invalid slugs, missing required fields, suspicious dates, and broken or suspicious image references. It is a **detection** tool: it never modifies content, never renames a slug, never merges two entity names it thinks refer to the same thing, and never treats a future date as an error.

```text
Existing Content (Sanity, both languages)
        ↓
scripts/content-integrity.mjs
        ↓
ERRORS / WARNINGS / INFO
        ↓
A human reviews and fixes in the Sanity Studio
```

## Running it

```bash
npm run integrity
```

Reads `SANITY_PROJECT_ID` / `SANITY_DATASET` from `.env` (same variables the site's own build uses). Exit code is `1` if any `ERROR` was found, `0` otherwise — `WARNING` and `INFO` never fail the run, so it's safe to wire into CI later as a gate without it blocking on subjective findings.

If `SANITY_WRITE_TOKEN` is also present in `.env`, the tool additionally checks whether a broken relation's target exists as an **unpublished draft** rather than not existing at all (see "Broken relations" below) — this is optional; the tool is fully useful without it.

## What it checks

### Required fields — ERROR

Each content type has a set of fields the site's templates assume are present (see `REQUIRED_FIELDS` in the script, derived directly from the TypeScript interfaces in `src/lib/content.ts`). A missing or empty required field is reported as an `ERROR`, because nothing in the current pipeline validates this at write time — Sanity's schema lives outside this repository, so a document can be saved with an empty required field and the site will silently render "undefined" or a blank section.

### Slug integrity — ERROR / WARNING

- Missing slug, slug containing whitespace, or slug containing `/` → `ERROR` (these break routing or indicate the raw name was saved instead of a real slug).
- Slug not in kebab-case (`some-slug-like-this`) → `WARNING` (still resolves as a literal path segment, but inconsistent with every other slug in the project).
- Same slug used twice within the same content type **and** language → `ERROR` (the site's slug lookup — `getEntryBySlugAndLang` — takes the first match silently; a duplicate is a real, undetected routing collision).

### Broken relations — ERROR / WARNING

The only relation fields that actually exist in this codebase are `relatedWorkSlug` (singular, on `journal` and `partners`, pointing at a `work` entry — resolved by the site as `/selected-work/{slug}`) and `relatedWorkSlugs` (plural, on `work`, self-referential). There is no `relatedTalentSlug`, `relatedEventSlug`, `relatedPartnerSlug`, etc. anywhere in the code — the checks reflect exactly this, not a hypothetical richer model.

A relation is checked **within the same language**: a French journal article's `relatedWorkSlug` must point to a French `work` entry, matching how `localizedPath(lang, ...)` builds the link.

- Target does not exist anywhere (published or draft) → `ERROR`.
- Target exists only as an unpublished draft (only detectable with `SANITY_WRITE_TOKEN` set) → `WARNING`, not `ERROR` — the reference isn't technically broken, it's just not live yet.
- A `work` entry listing itself in `relatedWorkSlugs` → `WARNING`.

### Locale / translation coverage — WARNING / INFO

- A whole content type with entries in one language and zero in the other (e.g. all partners are FR-only) → `WARNING`, because a whole page (`/en/partners`) will render empty.
- An individual entry with no counterpart at the same slug in the other language → `INFO`. This is expected and common in this project (not every article is bilingual), so it is not an error or warning — it exists purely as an inventory of translation coverage. It does not duplicate or re-implement the hreflang logic in `src/components/layout/Seo.astro` (see "What this does not do").

### Date integrity — ERROR / WARNING

- Unparseable date string → `ERROR`.
- A journal article's `publishDate` in the future → `WARNING`, never `ERROR` — a future date can be a deliberately scheduled article.
- A journal article's `_updatedAt` earlier than its own `publishDate` → `WARNING` (unusual, worth a look, not proof of a bug).
- A `work` entry's `year` field not matching the year in its own `startDate` → `WARNING`.
- The FR and EN versions of the same slug (journal `publishDate`, work `startDate`) differing by more than 30 days → `WARNING` ("potential date inconsistency between FR and EN versions").

### Entity name consistency — WARNING only, heuristic

Collects `work.client` and `partners.name` across the dataset, normalizes each (strip accents, quotes, punctuation, case), and flags pairs where one normalized name contains the other but they aren't identical — e.g. `"Ze Défilé by WaxFashion"` vs `"ZE DEFILE by WAXFASHION PARIS"`. This is a heuristic for a human to review, not a decision that the two names refer to the same entity — the tool **never merges or renames** anything. Two names that normalize to be exactly equal (e.g. differing only by `«»` vs `""` quote style between languages) are treated as consistent and are not flagged.

### Image integrity — ERROR / WARNING

- Missing/empty image URL → `ERROR`.
- A URL that looks like a local Windows file system path (e.g. `C:\Users\...`) leaked into the field → `ERROR`. This exact bug happened once already in production on this project (a `coverImage.url` briefly contained a local `C:\Users\...` path) — this check exists specifically to catch a repeat.
- A local path (`/photos/...`) that doesn't correspond to a real file in `public/` → `ERROR`.
- A remote URL that returns a non-2xx status, or whose `content-type` isn't `image/*` → `ERROR` (catches, for example, a Facebook page URL accidentally pasted into an image field instead of an actual image link).
- A remote URL on a host outside the two currently expected external providers (`cdn.sanity.io`, `images.unsplash.com`) → `WARNING` — flags hotlinked third-party images (e.g. `i.pinimg.com`) that WEBLACK doesn't control and that can disappear or start blocking hotlinking at any time.
- An absolute `https://weblack.fr/...` URL used where every other entry in the project uses a relative `/photos/...` path → `WARNING` (inconsistent, and would silently point at the wrong host in a preview/staging environment).

Network checks use an 8-second timeout and degrade to a `WARNING` ("could not verify") rather than crashing the whole run if a host is unreachable.

### SEO hygiene — INFO only

`seo.title` over 60 characters or `seo.description` over 160 characters → `INFO`. This does **not** touch canonical URLs, hreflang, or the sitemap — that logic already exists and was already fixed in `src/components/layout/Seo.astro` / `src/layouts/BaseLayout.astro`; this tool only flags on-page metadata length as a courtesy.

## What this does not do (by design)

- **No automatic correction.** Nothing is ever renamed, re-dated, re-slugged, or deleted by this tool. Every finding ends with a human decision in the Sanity Studio.
- **No Content Graph.** This tool validates the relation fields that already exist; it does not introduce a generic `ContentGraph`/`KnowledgeGraph` abstraction. That is a separate, larger piece of future work.
- **No rich-text link scanning.** `journal.body` / `talent.bio` are Portable Text; this tool checks that the field isn't empty (required-field check) but does not parse internal links embedded inside the body copy itself. A broken link typed inside an article's prose will not be caught today — a known limitation, not an oversight.
- **No semantic comparison of translated content.** Two documents can share an image but have alt text that doesn't actually describe compatible content in each language — this kind of issue requires human judgment (or a much fuzzier NLP-based check) and is intentionally left to manual review; the "False Positive Risk" section of the integrity report from each run should be read with this in mind.
- **No NB-NO / ZH-CN.** The locale checks operate generically over whatever `lang` values exist in Sanity (currently `fr`/`en` only) — no locale-specific logic was added in this phase.

## Fixing what it finds

1. Run `npm run integrity` and read the report.
2. For each `ERROR`: open the referenced document in the Sanity Studio (`https://weblack.sanity.studio/`), locate the field named in the message, and correct it directly at the source. Do not patch around it in the Astro templates.
3. For each `WARNING`: use judgment — some are genuine issues (a real naming inconsistency), others are intentional and fine (a deliberately scheduled future article). The tool cannot tell the difference; that's the point of it being a warning rather than an error.
4. Re-run `npm run integrity` to confirm the fix and check nothing else regressed.
5. Content changes made only in Sanity (no code commit) still need a redeploy to appear live — see `DEPLOYMENT.md`.

## Extending it

The rules live as clearly separated blocks in `scripts/content-integrity.mjs` (`R1` required fields, `R2` slugs, `R3` relations, `R4` locale coverage, `R5` dates, `R6` entity names, `R7` SEO hygiene, `R8` images). Add a new rule as its own block that pushes to the same `findings` array via `report(level, scope, message)` — do not build a second, parallel validation system.
