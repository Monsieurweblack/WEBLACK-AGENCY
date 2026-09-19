#!/usr/bin/env node
/**
 * WEBLACK Content Integrity — detects broken relations, invalid slugs, date
 * anomalies, missing required fields, broken/suspicious image references and
 * potential entity-naming variations across the Sanity-backed content
 * (talent, work, journal, partners).
 *
 * This is a DETECTION tool, not a correction tool: it never writes to
 * Sanity, never renames slugs, never merges entities it "thinks" are the
 * same, and never treats a future date as wrong. When it cannot be certain,
 * it reports a WARNING (or INFO) and leaves the decision to a human — see
 * docs/content-integrity.md for the full rule reference and rationale.
 *
 * Usage: npm run integrity
 * Exit code: 1 if any ERROR was found, 0 otherwise (WARNING/INFO never fail
 * the run) — safe to wire into CI as a non-blocking-until-you-want-it gate.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@sanity/client";
import { LOCALE_CODES, ENABLED_LOCALE_CODES } from "../src/i18n/locales.ts";
import { resolveContentId, CONTENT_ID_ALIASES } from "../src/lib/content-graph.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// Env loading — mirrors the pattern already used by the site's own build
// (src/lib/content.ts reads these via import.meta.env, which only exists
// inside Astro/Vite; this is a plain Node script, so .env is read directly).
// ---------------------------------------------------------------------------
function loadEnv() {
  const envPath = path.join(ROOT, ".env");
  const env = { ...process.env };
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const i = line.indexOf("=");
      if (i > 0 && !line.trim().startsWith("#")) {
        const key = line.slice(0, i).trim();
        if (!(key in env)) env[key] = line.slice(i + 1).trim();
      }
    }
  }
  return env;
}

const env = loadEnv();

if (!env.SANITY_PROJECT_ID || !env.SANITY_DATASET) {
  console.error("ERROR: SANITY_PROJECT_ID / SANITY_DATASET not set (checked process.env and .env).");
  process.exit(1);
}

const client = createClient({
  projectId: env.SANITY_PROJECT_ID,
  dataset: env.SANITY_DATASET,
  apiVersion: "2025-01-01",
  useCdn: true,
});

// Optional: with a write/read token available, drafts become visible too —
// used only to distinguish "target is an unpublished draft" from "target
// does not exist at all" (see rule R3). Entirely optional; the tool remains
// fully useful without it.
const draftClient = env.SANITY_WRITE_TOKEN
  ? createClient({
      projectId: env.SANITY_PROJECT_ID,
      dataset: env.SANITY_DATASET,
      apiVersion: "2025-01-01",
      useCdn: false,
      token: env.SANITY_WRITE_TOKEN,
      perspective: "raw",
    })
  : null;

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------
const PROJECTION = `{
  _id, _type, _updatedAt, lang, "slug": slug.current,
  title, name, client, year, startDate, location, disciplines,
  category, format, publishDate, author, excerpt, description,
  context, challenge, role, creativeResponse,
  relatedWorkSlug, relatedWorkSlugs,
  coverImage, portraitImage, gallery, galleryImages,
  bio, body,
  seo, featured
}`;

const docs = await client.fetch(`*[_type in ["talent","work","journal","partners"]]${PROJECTION}`);

let draftSlugsByTypeLang = null;
if (draftClient) {
  try {
    const draftDocs = await draftClient.fetch(
      `*[_type in ["work","partners"] && _id in path("drafts.**")]{_type, lang, "slug": slug.current}`,
    );
    draftSlugsByTypeLang = new Map();
    for (const d of draftDocs) {
      const key = `${d._type}:${d.lang}`;
      if (!draftSlugsByTypeLang.has(key)) draftSlugsByTypeLang.set(key, new Set());
      draftSlugsByTypeLang.get(key).add(d.slug);
    }
  } catch {
    // Token present but query failed (permissions, network) — degrade gracefully.
    draftSlugsByTypeLang = null;
  }
}

// ---------------------------------------------------------------------------
// Index
// ---------------------------------------------------------------------------
const byType = { talent: [], work: [], journal: [], partners: [] };
for (const d of docs) byType[d._type]?.push(d);

/** type -> lang -> slug -> doc */
const indexByTypeLangSlug = new Map();
for (const [type, list] of Object.entries(byType)) {
  for (const d of list) {
    const key = `${type}:${d.lang}`;
    if (!indexByTypeLangSlug.has(key)) indexByTypeLangSlug.set(key, new Map());
    const bucket = indexByTypeLangSlug.get(key);
    if (!bucket.has(d.slug)) bucket.set(d.slug, []);
    bucket.get(d.slug).push(d);
  }
}

function findBySlug(type, lang, slug) {
  return indexByTypeLangSlug.get(`${type}:${lang}`)?.get(slug)?.[0] ?? null;
}

function findDraftBySlug(type, lang, slug) {
  return draftSlugsByTypeLang?.get(`${type}:${lang}`)?.has(slug) ?? false;
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------
const findings = [];
function report(level, scope, message) {
  findings.push({ level, scope, message });
}

function label(d) {
  return `[${d._type.toUpperCase()}/${d.lang}] ${d.slug ?? d._id}`;
}

// --- R1: required fields ----------------------------------------------------
const REQUIRED_FIELDS = {
  talent: ["name", "role", "category", "country", "portraitImage"],
  work: [
    "title",
    "client",
    "year",
    "startDate",
    "location",
    "disciplines",
    "context",
    "challenge",
    "role",
    "creativeResponse",
    "coverImage",
  ],
  journal: ["title", "excerpt", "category", "publishDate", "coverImage", "body"],
  partners: ["name", "description", "location", "coverImage"],
};

function isEmpty(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

for (const [type, list] of Object.entries(byType)) {
  for (const d of list) {
    for (const field of REQUIRED_FIELDS[type]) {
      if (isEmpty(d[field])) {
        report("ERROR", label(d), `Missing required field: "${field}"`);
      }
    }
    if (isEmpty(d.location) === false) {
      if (isEmpty(d.location.city)) report("WARNING", label(d), "Location is missing a city");
      if (isEmpty(d.location.country)) report("WARNING", label(d), "Location is missing a country");
    }
  }
}

// --- R2: slug integrity ------------------------------------------------------
for (const [, list] of Object.entries(byType)) {
  for (const d of list) {
    if (isEmpty(d.slug)) {
      report("ERROR", label(d), 'Missing required field: "slug"');
      continue;
    }
    if (/\s/.test(d.slug)) {
      report("ERROR", label(d), `Invalid slug (contains whitespace): "${d.slug}"`);
    } else if (/\//.test(d.slug)) {
      report("ERROR", label(d), `Invalid slug (contains "/", would corrupt routing): "${d.slug}"`);
    } else if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(d.slug)) {
      report("WARNING", label(d), `Slug does not follow kebab-case convention: "${d.slug}"`);
    }
  }
}

// duplicate slug within the same type + lang
for (const [key, bucket] of indexByTypeLangSlug) {
  for (const [slug, matches] of bucket) {
    if (matches.length > 1) {
      const [type, lang] = key.split(":");
      report(
        "ERROR",
        `[${type.toUpperCase()}/${lang}]`,
        `Duplicate slug "${slug}" used by ${matches.length} documents (${matches.map((m) => m._id).join(", ")})`,
      );
    }
  }
}

// --- R3: broken relation detection ------------------------------------------
function checkRelatedWork(d, slug) {
  if (isEmpty(slug)) return;
  const target = findBySlug("work", d.lang, slug);
  if (target) return;
  if (findDraftBySlug("work", d.lang, slug)) {
    report("WARNING", label(d), `relatedWorkSlug "${slug}" exists only as an unpublished draft`);
  } else {
    report("ERROR", label(d), `Broken relatedWorkSlug: "${slug}" does not exist in work/${d.lang}`);
  }
}

for (const d of byType.journal) checkRelatedWork(d, d.relatedWorkSlug);
for (const d of byType.partners) checkRelatedWork(d, d.relatedWorkSlug);

for (const d of byType.work) {
  for (const slug of d.relatedWorkSlugs ?? []) {
    if (slug === d.slug) {
      report("WARNING", label(d), "relatedWorkSlugs references itself");
      continue;
    }
    const target = findBySlug("work", d.lang, slug);
    if (!target) {
      if (findDraftBySlug("work", d.lang, slug)) {
        report("WARNING", label(d), `relatedWorkSlugs "${slug}" exists only as an unpublished draft`);
      } else {
        report("ERROR", label(d), `Broken relatedWorkSlugs entry: "${slug}" does not exist in work/${d.lang}`);
      }
    }
  }
}

// --- R4: locale / translation coverage --------------------------------------
// Generic over every *enabled* locale (fr/en today) — nb/zh join this loop
// automatically the day they're enabled in src/i18n/locales.ts, with zero
// code change here. Matched by contentId, not raw slug, so a pair like the
// NTA journal article (different FR/EN slugs, unified via
// content-graph.ts's CONTENT_ID_ALIASES) is correctly recognized as
// translated instead of being flagged as missing on both sides.
for (const type of Object.keys(byType)) {
  const slugsByLocale = new Map(
    ENABLED_LOCALE_CODES.map((locale) => [
      locale,
      new Set(indexByTypeLangSlug.get(`${type}:${locale}`)?.keys() ?? []),
    ]),
  );
  const localesWithContent = ENABLED_LOCALE_CODES.filter((locale) => slugsByLocale.get(locale).size > 0);

  for (const locale of ENABLED_LOCALE_CODES) {
    if (slugsByLocale.get(locale).size === 0 && localesWithContent.length > 0) {
      report(
        "WARNING",
        `[${type.toUpperCase()}]`,
        `0 ${locale.toUpperCase()} documents, but ${localesWithContent.map((l) => l.toUpperCase()).join("/")} has content`,
      );
    }
  }

  const contentIdsByLocale = new Map(
    ENABLED_LOCALE_CODES.map((locale) => [
      locale,
      new Set([...slugsByLocale.get(locale)].map((slug) => resolveContentId(type, locale, slug))),
    ]),
  );
  for (const locale of ENABLED_LOCALE_CODES) {
    for (const slug of slugsByLocale.get(locale)) {
      const contentId = resolveContentId(type, locale, slug);
      for (const other of ENABLED_LOCALE_CODES) {
        if (other === locale) continue;
        if (!contentIdsByLocale.get(other).has(contentId)) {
          report("INFO", `[${type.toUpperCase()}]`, `No ${other.toUpperCase()} translation for slug "${slug}" (${locale.toUpperCase()})`);
        }
      }
    }
  }
}

// --- R9: locale integrity ----------------------------------------------------
// Unknown locale value: a document's `lang` field must be one of the
// registered locale codes (src/i18n/locales.ts) — catches a typo'd or
// otherwise invalid lang value that would otherwise silently sort content
// into a bucket nothing on the site ever queries.
for (const [, list] of Object.entries(byType)) {
  for (const d of list) {
    if (!LOCALE_CODES.includes(d.lang)) {
      report("ERROR", label(d), `Unknown locale "${d.lang}" — not one of: ${LOCALE_CODES.join(", ")}`);
    }
  }
}

// Incoherent linguistic relation: every slug declared in
// content-graph.ts's CONTENT_ID_ALIASES must correspond to a document that
// actually exists — an alias is a human-verified claim ("these two slugs
// are the same content"); if either side no longer exists (renamed,
// unpublished), the claim itself is now wrong and must be flagged, not
// silently trusted.
for (const alias of CONTENT_ID_ALIASES) {
  for (const [locale, slug] of Object.entries(alias.slugs)) {
    if (!findBySlug(alias.type, locale, slug)) {
      report(
        "ERROR",
        "[CONTENT_ID_ALIASES]",
        `Alias for ${alias.type} declares ${locale}="${slug}", but no such document exists — the alias in src/lib/content-graph.ts is now stale`,
      );
    }
  }
}

// --- R5: date integrity ------------------------------------------------------
const now = new Date();
function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d; // undefined = invalid format
}

for (const [type, list] of Object.entries(byType)) {
  for (const d of list) {
    if (type === "journal" && d.publishDate !== undefined && d.publishDate !== null) {
      const pub = parseDate(d.publishDate);
      if (pub === undefined) {
        report("ERROR", label(d), `Invalid publishDate format: "${d.publishDate}"`);
      } else if (pub) {
        if (pub.getTime() > now.getTime()) {
          report("WARNING", label(d), `Future publish date (${d.publishDate}) — confirm this is intentional (scheduled)`);
        }
        const updated = parseDate(d._updatedAt);
        if (updated && updated.getTime() < pub.getTime() - 1000) {
          report("WARNING", label(d), `_updatedAt (${d._updatedAt}) predates publishDate (${d.publishDate})`);
        }
      }
    }
    if (type === "work" && d.startDate) {
      const start = parseDate(d.startDate);
      if (start === undefined) {
        report("ERROR", label(d), `Invalid startDate format: "${d.startDate}"`);
      } else if (start && typeof d.year === "number" && start.getUTCFullYear() !== d.year) {
        report(
          "WARNING",
          label(d),
          `"year" field (${d.year}) does not match startDate's year (${start.getUTCFullYear()})`,
        );
      }
    }
  }
}

// Cross-lang date drift for the same slug (same conceptual content, paired by slug)
for (const type of Object.keys(byType)) {
  const frMap = indexByTypeLangSlug.get(`${type}:fr`) ?? new Map();
  const enMap = indexByTypeLangSlug.get(`${type}:en`) ?? new Map();
  for (const [slug, [frDoc]] of frMap) {
    const enMatch = enMap.get(slug)?.[0];
    if (!enMatch) continue;
    const dateField = type === "journal" ? "publishDate" : type === "work" ? "startDate" : null;
    if (!dateField) continue;
    const a = parseDate(frDoc[dateField]);
    const b = parseDate(enMatch[dateField]);
    if (a && b) {
      const diffDays = Math.abs(a.getTime() - b.getTime()) / 86_400_000;
      if (diffDays > 30) {
        report(
          "WARNING",
          `[${type.toUpperCase()}] slug "${slug}"`,
          `Potential date inconsistency between FR and EN versions: ${frDoc[dateField]} (fr) vs ${enMatch[dateField]} (en) — ${Math.round(diffDays)} days apart`,
        );
      }
    }
  }
}

// --- R6: entity name consistency (heuristic, WARNING only) ------------------
function normalizeName(s) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents (combining diacritical marks)
    .toLowerCase()
    .replace(/["«»'']/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const nameOccurrences = []; // { raw, normalized, source }
for (const d of byType.work) {
  if (d.client) nameOccurrences.push({ raw: d.client, source: label(d) + " client" });
}
for (const d of byType.partners) {
  if (d.name) nameOccurrences.push({ raw: d.name, source: label(d) + " name" });
}

const seenPairs = new Set();
for (let i = 0; i < nameOccurrences.length; i++) {
  for (let j = i + 1; j < nameOccurrences.length; j++) {
    const a = nameOccurrences[i];
    const b = nameOccurrences[j];
    if (a.raw === b.raw) continue;
    const na = normalizeName(a.raw);
    const nb = normalizeName(b.raw);
    if (na === nb) continue; // identical once normalized — not a variation worth flagging
    const related = na.includes(nb) || nb.includes(na);
    if (related) {
      const pairKey = [a.raw, b.raw].sort().join("||");
      if (seenPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);
      report(
        "WARNING",
        "[ENTITY]",
        `Potential naming variation: "${a.raw}" (${a.source}) vs "${b.raw}" (${b.source})`,
      );
    }
  }
}

// --- R7: SEO hygiene (INFO only) ---------------------------------------------
for (const [, list] of Object.entries(byType)) {
  for (const d of list) {
    if (d.seo?.title && d.seo.title.length > 60) {
      report("INFO", label(d), `SEO title longer than the recommended 60 characters (${d.seo.title.length})`);
    }
    if (d.seo?.description && d.seo.description.length > 160) {
      report("INFO", label(d), `SEO description longer than the recommended 160 characters (${d.seo.description.length})`);
    }
  }
}

// --- R8: image integrity ------------------------------------------------------
const EXPECTED_EXTERNAL_IMAGE_HOSTS = new Set(["cdn.sanity.io", "images.unsplash.com"]);

function collectImages(d) {
  const images = [];
  for (const field of ["coverImage", "portraitImage"]) {
    if (d[field]) images.push({ field, image: d[field] });
  }
  for (const field of ["gallery", "galleryImages"]) {
    for (const image of d[field] ?? []) images.push({ field, image });
  }
  return images;
}

async function checkImageUrl(d, field, url) {
  if (isEmpty(url)) {
    report("ERROR", label(d), `Image field "${field}" has an empty url`);
    return;
  }
  if (/^[A-Za-z]:\\|\\Users\\|^\/[A-Za-z]:\\/.test(url) || url.includes("\\")) {
    report("ERROR", label(d), `Image field "${field}" contains a local file system path, not a URL: "${url}"`);
    return;
  }
  if (url.startsWith("/")) {
    const localPath = path.join(ROOT, "public", url);
    if (!fs.existsSync(localPath)) {
      report("ERROR", label(d), `Image field "${field}" references a local file that does not exist: "${url}"`);
    }
    return;
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    report("ERROR", label(d), `Image field "${field}" is not a valid URL: "${url}"`);
    return;
  }
  if (!EXPECTED_EXTERNAL_IMAGE_HOSTS.has(parsed.hostname) && parsed.hostname !== "weblack.fr") {
    report(
      "WARNING",
      label(d),
      `Image field "${field}" is hosted on an unexpected external domain (${parsed.hostname}) — verify this is a stable, owned resource rather than a hotlink`,
    );
  }
  if (parsed.hostname === "weblack.fr") {
    report(
      "WARNING",
      label(d),
      `Image field "${field}" uses an absolute self-referential URL instead of a relative path: "${url}"`,
    );
  }
  try {
    const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(8000) });
    const contentType = res.headers.get("content-type") ?? "";
    if (!res.ok) {
      report("ERROR", label(d), `Image field "${field}" returned HTTP ${res.status}: "${url}"`);
    } else if (!contentType.startsWith("image/")) {
      report(
        "ERROR",
        label(d),
        `Image field "${field}" does not return image content (content-type: "${contentType || "unknown"}"): "${url}"`,
      );
    }
  } catch {
    report("WARNING", label(d), `Could not verify remote image "${field}" (network error or timeout): "${url}"`);
  }
}

for (const [, list] of Object.entries(byType)) {
  for (const d of list) {
    for (const { field, image } of collectImages(d)) {
      await checkImageUrl(d, field, image?.url);
    }
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const errors = findings.filter((f) => f.level === "ERROR");
const warnings = findings.filter((f) => f.level === "WARNING");
const infos = findings.filter((f) => f.level === "INFO");

console.log("WEBLACK CONTENT INTEGRITY\n");

if (errors.length) {
  console.log("ERRORS");
  console.log("------\n");
  for (const f of errors) console.log(`${f.scope}\n${f.message}\n`);
}

if (warnings.length) {
  console.log("WARNINGS");
  console.log("--------\n");
  for (const f of warnings) console.log(`${f.scope}\n${f.message}\n`);
}

if (infos.length) {
  console.log("INFO");
  console.log("----\n");
  for (const f of infos) console.log(`${f.scope}\n${f.message}\n`);
}

console.log("SUMMARY");
console.log("-------");
console.log(`Errors: ${errors.length}`);
console.log(`Warnings: ${warnings.length}`);
console.log(`Info: ${infos.length}`);
console.log(`\nStatus: ${errors.length > 0 ? "FAIL" : "PASS"}`);

if (!draftClient) {
  console.log(
    "\n(Note: SANITY_WRITE_TOKEN not set — broken relations could not be checked against draft content; " +
      "a missing target is always reported as ERROR even if it exists as an unpublished draft.)",
  );
}

process.exit(errors.length > 0 ? 1 : 0);
