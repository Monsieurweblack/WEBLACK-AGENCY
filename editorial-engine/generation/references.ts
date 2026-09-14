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

export function buildReferencesBlock(registeredSources: RegisteredSource[]): PortableBlock[] {
  const heading: PortableBlock = {
    _type: "block",
    _key: crypto.randomUUID(),
    style: "h3",
    children: [{ _type: "span", _key: crypto.randomUUID(), text: "Références", marks: [] }],
    markDefs: [],
  };
  const list: PortableBlock = {
    _type: "block",
    _key: crypto.randomUUID(),
    style: "normal",
    children: [
      {
        _type: "span",
        _key: crypto.randomUUID(),
        text: `Sources consultées : ${registeredSources.map((s) => `${s.source.sourceName} (${s.source.url})`).join(" · ")}`,
        marks: [],
      },
    ],
    markDefs: [],
  };
  return [heading, list];
}
