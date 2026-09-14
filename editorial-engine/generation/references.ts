import crypto from "node:crypto";
import type { PortableBlock } from "./types.ts";
import type { RegisteredSource, RegisteredClaim } from "../validation/claimRegistry.ts";

/**
 * §"RÉFÉRENCES" — appended to the article body (a plain Portable Text
 * heading + paragraph, using the schema's existing block/image array; no
 * new Sanity field). Included only when sources add real transparency
 * value: multiple sources, or at least one critical/quote/statistic claim
 * that benefits from visible attribution — never as a blanket footer, and
 * never as license to lean on the source's own structure (anti-copy stays
 * fully independent of this).
 */
export function shouldIncludeReferences(registeredSources: RegisteredSource[], claims: RegisteredClaim[]): boolean {
  if (registeredSources.length >= 2) return true;
  return claims.some((c) => c.importance === "critical" || c.type === "quote" || c.type === "statistic");
}

function formatDate(publishedAt: string | undefined): string | undefined {
  if (!publishedAt) return undefined;
  const d = new Date(publishedAt);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString().slice(0, 10);
}

/** One line per source: name, article title, date when known, URL — every field resolved from real ingestion metadata (ingestion/url.ts, ingestion/rss.ts), never a placeholder. */
function formatReference(registered: RegisteredSource): string {
  const { source } = registered;
  const date = formatDate(source.publishedAt);
  const parts = [source.sourceName, `« ${source.title} »`, date, source.url].filter(Boolean);
  return `— ${parts.join(" — ")}`;
}

export function buildReferencesBlock(registeredSources: RegisteredSource[]): PortableBlock[] {
  const heading: PortableBlock = {
    _type: "block",
    _key: crypto.randomUUID(),
    style: "h3",
    children: [{ _type: "span", _key: crypto.randomUUID(), text: "Références", marks: [] }],
    markDefs: [],
  };
  const intro: PortableBlock = {
    _type: "block",
    _key: crypto.randomUUID(),
    style: "normal",
    children: [{ _type: "span", _key: crypto.randomUUID(), text: "Sources consultées :", marks: [] }],
    markDefs: [],
  };
  const sourceLines: PortableBlock[] = registeredSources.map((s) => ({
    _type: "block",
    _key: crypto.randomUUID(),
    style: "normal",
    children: [{ _type: "span", _key: crypto.randomUUID(), text: formatReference(s), marks: [] }],
    markDefs: [],
  }));
  return [heading, intro, ...sourceLines];
}
