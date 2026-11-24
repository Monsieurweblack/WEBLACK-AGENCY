/**
 * Compétences spécialisées. Une seule orchestration centrale (orchestrator.ts)
 * choisit la compétence ; aucune compétence n'appelle un modèle de son côté,
 * ce qui évite de multiplier modèles et coûts.
 */
import type { SkillId } from "./types.ts";
import { normalize } from "./knowledge.ts";

export type Tool = "knowledge.search" | "handoff.prepare" | "brief.build";

export interface Skill {
  id: SkillId;
  /** Mots déclencheurs FR + EN (comparés sans accents). */
  triggers: string[];
  /** Liste blanche : une compétence ne peut mobiliser que ces outils. */
  tools: Tool[];
  /** Domaines de connaissance consultés. */
  domains: string[] | "all" | "sector";
}

export const SKILLS: Skill[] = [
  { id: "weblack_info", triggers: ["weblack", "agence", "agency", "qui etes", "who are", "fondateur", "founder", "methode", "method", "perspective", "vision", "divisions", "references", "collaborations"], tools: ["knowledge.search"], domains: ["weblack"] },
  { id: "talent_guidance", triggers: ["talent", "mannequin", "model", "candidature", "application", "photographe", "photographer", "styliste", "stylist", "artiste", "artist", "casting", "representation", "management"], tools: ["knowledge.search"], domains: "all" },
  { id: "creative_brief", triggers: ["campagne", "campaign", "defile", "show", "evenement", "event", "production", "direction artistique", "art direction", "contenu", "content", "creative"], tools: ["knowledge.search", "brief.build"], domains: "all" },
  { id: "consulting", triggers: ["strategie", "strategy", "positionnement", "positioning", "branding", "marque", "brand", "conseil", "consulting", "intelligence culturelle"], tools: ["knowledge.search", "brief.build"], domains: "all" },
  { id: "opportunities", triggers: ["opportunite", "opportunity", "opportunities", "appel a candidatures", "call for", "postuler", "apply", "zedefile", "deadline", "date limite"], tools: ["knowledge.search"], domains: "all" },
  { id: "sector_research", triggers: ["marche", "market", "luxe", "luxury", "fashion week", "salon", "haute couture", "pret a porter", "ready to wear", "tendance", "trend", "sponsoring", "partenariat", "partnership", "industrie", "industry", "chiffre", "statistique", "statistics"], tools: ["knowledge.search", "handoff.prepare"], domains: "sector" },
  { id: "project_builder", triggers: ["brief", "mon projet", "my project", "construire un projet", "build a project", "dossier", "cahier des charges"], tools: ["brief.build", "handoff.prepare", "knowledge.search"], domains: "all" },
  { id: "contact_handoff", triggers: ["contacter", "contact", "equipe", "team", "rendez vous", "meeting", "transmettre", "transmit", "parler a quelqu", "speak to someone", "humain", "human"], tools: ["handoff.prepare"], domains: [] },
  { id: "general", triggers: [], tools: ["knowledge.search"], domains: "all" },
  { id: "assistant_meta", triggers: ["malya", "qui es tu", "who are you", "que sais tu faire", "what can you do", "comment fonctionnes", "how do you work", "tu es une ia", "are you an ai", "tes limites", "your limits"], tools: [], domains: [] },
];

/** Ordre de départage quand plusieurs compétences sont à égalité : intention d'action d'abord. */
const PRIORITY: SkillId[] = ["contact_handoff", "project_builder", "talent_guidance", "opportunities", "consulting", "creative_brief", "sector_research", "weblack_info", "assistant_meta"];

export class ToolNotAllowed extends Error {}

export function assertToolAllowed(skill: SkillId, tool: Tool): void {
  const s = SKILLS.find((k) => k.id === skill);
  if (!s || !s.tools.includes(tool)) throw new ToolNotAllowed(`${skill} n'a pas accès à ${tool}`);
}

export interface Routing {
  skill: SkillId;
  confidence: "high" | "low";
  /** Deux compétences à égalité : seule situation justifiant une question. */
  tie?: [SkillId, SkillId];
}

export function route(message: string, history: { role: string; content: string }[] = []): Routing {
  const q = ` ${normalize(message).replace(/\s+/g, " ")} `;
  const hit = (trigger: string): boolean => {
    const t = normalize(trigger).trim().replace(/\s+/g, " ");
    return [`${t}`, `${t}s`, `${t}es`, `${t}x`].some((v) => q.includes(` ${v} `));
  };
  const scores = SKILLS.map((s) => ({ id: s.id, score: s.triggers.filter(hit).length }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scores.length === 0) {
    // Continuité : un message court (« et pour la mode ? ») reprend la compétence du tour précédent.
    const lastUser = [...history].reverse().find((h) => h.role === "user");
    if (lastUser && message.trim().split(/\s+/).length <= 6) {
      const prev = route(lastUser.content, []);
      if (prev.skill !== "general") return { skill: prev.skill, confidence: "low" };
    }
    return { skill: "general", confidence: "low" };
  }
  const top = scores.filter((x) => x.score === scores[0].score);
  if (top.length > 1) {
    const ids = top.map((x) => x.id);
    // Seule ambiguïté réellement utile à lever : stratégie de marque ou production créative.
    if (ids.length === 2 && ids.includes("consulting") && ids.includes("creative_brief")) {
      return { skill: "consulting", confidence: "low", tie: ["consulting", "creative_brief"] };
    }
    // Sinon l'intention d'action prime, puis la plus spécifique : pas de question inutile.
    const best = PRIORITY.find((p) => ids.includes(p));
    if (best) return { skill: best, confidence: "low" };
  }
  return { skill: scores[0].id, confidence: "high" };
}
