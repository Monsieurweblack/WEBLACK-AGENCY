import fs from "node:fs";
import path from "node:path";
import { ENGINE_ROOT } from "../config/env.ts";
import type { EditorialSource } from "./types.ts";

const SOURCES_PATH = path.join(ENGINE_ROOT, "sources", "sources.json");

export function loadSources(): EditorialSource[] {
  const raw = JSON.parse(fs.readFileSync(SOURCES_PATH, "utf8"));
  const sources: unknown[] = raw.sources ?? [];
  for (const s of sources) {
    if (typeof s !== "object" || s === null) throw new Error("sources.json: invalid entry (not an object)");
    const src = s as Partial<EditorialSource>;
    if (!src.name || !src.type || !src.url) {
      throw new Error(`sources.json: entry missing name/type/url — ${JSON.stringify(s)}`);
    }
    if (src.type !== "rss" && src.type !== "manual") {
      throw new Error(`sources.json: unknown type "${src.type}" for source "${src.name}"`);
    }
  }
  return sources as EditorialSource[];
}

export function enabledSources(): EditorialSource[] {
  return loadSources()
    .filter((s) => s.enabled)
    .sort((a, b) => a.priority - b.priority);
}

export function findSource(name: string): EditorialSource {
  const source = loadSources().find((s) => s.name === name);
  if (!source) throw new Error(`Source inconnue: "${name}". Voir editorial-engine/sources/sources.json.`);
  return source;
}
