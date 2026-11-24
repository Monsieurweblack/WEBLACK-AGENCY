/**
 * Project Builder — assemble un brief structuré à partir de champs libres.
 * Module pur, partagé entre l'interface (navigateur) et les tests : une
 * seule source de vérité pour le format du brief.
 */
import { cleanText } from "./safety.ts";

export const PROJECT_KINDS = ["talent", "campaign", "event", "brand-strategy", "other"] as const;
export type ProjectKind = (typeof PROJECT_KINDS)[number];

export interface ProjectFields {
  kind: ProjectKind;
  goal: string;
  audience?: string;
  timeline?: string;
  budget?: string;
  location?: string;
  notes?: string;
}

const KIND_LABEL: Record<ProjectKind, { fr: string; en: string }> = {
  talent: { fr: "Talent (management, représentation)", en: "Talent (management, representation)" },
  campaign: { fr: "Campagne / production de contenu", en: "Campaign / content production" },
  event: { fr: "Événement / défilé", en: "Event / fashion show" },
  "brand-strategy": { fr: "Stratégie de marque", en: "Brand strategy" },
  other: { fr: "Autre", en: "Other" },
};

const CAP = { goal: 600, short: 200, notes: 800 };

export function buildBrief(fields: ProjectFields, lang: "fr" | "en"): { ok: true; text: string } | { ok: false; reason: "kind" | "goal" } {
  if (!(PROJECT_KINDS as readonly string[]).includes(fields.kind)) return { ok: false, reason: "kind" };
  const goal = cleanText(fields.goal ?? "").slice(0, CAP.goal);
  if (goal.length < 10) return { ok: false, reason: "goal" };
  const L = lang === "fr"
    ? { title: "Brief de projet — WEBLACK", kind: "Type de projet", goal: "Objectif", audience: "Public visé", timeline: "Calendrier", budget: "Budget indicatif", location: "Lieu / marché", notes: "Précisions", foot: "Brief préparé avec MALYA. Les informations ci-dessus sont déclaratives." }
    : { title: "Project brief — WEBLACK", kind: "Project type", goal: "Goal", audience: "Target audience", timeline: "Timeline", budget: "Indicative budget", location: "Location / market", notes: "Details", foot: "Brief prepared with MALYA. The information above is self-declared." };
  const line = (label: string, v?: string, cap = CAP.short) => {
    const c = cleanText(v ?? "").slice(0, cap);
    return c ? `${label} : ${c}` : "";
  };
  const text = [
    L.title,
    "",
    `${L.kind} : ${KIND_LABEL[fields.kind][lang]}`,
    `${L.goal} : ${goal}`,
    line(L.audience, fields.audience),
    line(L.timeline, fields.timeline),
    line(L.budget, fields.budget),
    line(L.location, fields.location),
    line(L.notes, fields.notes, CAP.notes),
    "",
    L.foot,
  ].filter((l, i, a) => l !== "" || (a[i - 1] !== "" && i !== a.length - 1) || l === "").join("\n");
  return { ok: true, text };
}
