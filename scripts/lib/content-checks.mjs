/**
 * Pure, synchronous content-validation rules shared by content-integrity.mjs
 * and its tests. Kept out of content-integrity.mjs itself because that
 * script fetches from Sanity at module load — importing it anywhere (tests
 * included) would trigger a live network call as a side effect.
 */

export function isEmpty(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

const WINDOWS_PATH_RE = /^[A-Za-z]:\\|\\Users\\|^\/[A-Za-z]:\\/;
const UNIX_ABSOLUTE_PATH_RE = /^\/(?:home|Users|var|etc|tmp|mnt)\//;

/**
 * Classifies an image url field WITHOUT any network access. Returns
 * { valid: true } or { valid: false, reason } — `reason` is a stable code,
 * not the human-readable message (content-integrity.mjs owns wording).
 *
 * Deliberately does not flag a bare "/photos/..." root-relative path as a
 * local filesystem path — that's this project's real, supported convention
 * for site-served images (see CLAUDE.md), distinct from an accidental
 * absolute OS path like "/Users/..." or "C:\...".
 */
export function classifyImageUrl(url) {
  if (isEmpty(url)) return { valid: false, reason: "empty" };
  if (typeof url !== "string") return { valid: false, reason: "not-a-string" };
  if (WINDOWS_PATH_RE.test(url) || url.includes("\\")) {
    return { valid: false, reason: "windows-path" };
  }
  if (url.startsWith("/")) {
    if (UNIX_ABSOLUTE_PATH_RE.test(url)) return { valid: false, reason: "unix-absolute-path" };
    return { valid: true, kind: "local" };
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, reason: "invalid-url" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { valid: false, reason: "non-http-protocol" };
  }
  return { valid: true, kind: "remote", hostname: parsed.hostname };
}

/** Whether a relatedWorkSlug/relatedWorkSlugs target is a real, known work in the given lang. */
export function isKnownWorkSlug(slug, knownWorkSlugsForLang) {
  return knownWorkSlugsForLang.has(slug);
}

/** The rule Étape 5 depends on: any ERROR-level finding must fail the process. */
export function computeExitCode(findings) {
  return findings.some((f) => f.level === "ERROR") ? 1 : 0;
}
