/**
 * Orchestrateur central de MALYA : le seul endroit où une demande est
 * comprise, routée vers une compétence, appuyée sur des sources, puis
 * filtrée avant de repartir. Sans état : rien n'est conservé entre deux
 * appels (isolation des utilisateurs par construction).
 */
import type { ChatRequest, ChatResponse, Citation, KnowledgeEntry, Lang, SkillId } from "./types.ts";
import { KNOWLEDGE, isOutdated, retrieve, toCitation } from "./knowledge.ts";
import { detectLanguage } from "./language.ts";
import { LIMITS, cleanText, detectInjection, sanitizeOutput, validateTurns } from "./safety.ts";
import { SKILLS, assertToolAllowed, route } from "./skills.ts";
import { GroundedModel, hasEmotion, type ModelProvider } from "./model.ts";
import { asCategory, confirmHandoff, proposeHandoff, type HandoffCategory } from "./actions.ts";
import { normalizeConsent } from "./consent.ts";
import { REASON_LABEL, type Llm } from "./llm.ts";
import { buildPrompt } from "./prompt.ts";

export interface Deps {
  model?: ModelProvider;
  knowledge?: KnowledgeEntry[];
  /** Passerelle Anthropic. Absente ou refusée : MALYA répond en mode documentaire, et le dit. */
  llm?: Llm;
  now?: () => Date;
  /** Interrupteur d'urgence des fonctions sensibles (actions + mémoire). */
  sensitiveSuspended?: boolean;
  /** Journal des événements sensibles — sans contenu de conversation. */
  audit?: (event: AuditEvent) => void;
}

export interface AuditEvent {
  type: "injection_blocked" | "invalid_request" | "handoff_proposed" | "handoff_confirmed" | "handoff_rejected" | "tool_denied" | "llm_fallback";
  skill?: SkillId;
}

const SUGGESTIONS: Record<SkillId, Record<Lang, string[]>> = {
  weblack_info: { fr: ["Quelles sont les trois divisions ?", "Qu'est-ce que WEBLACK Perspective ?"], en: ["What are the three divisions?", "What is WEBLACK Perspective?"] },
  talent_guidance: { fr: ["Comment candidater comme talent ?", "Quelles collaborations WEBLACK a-t-elle menées ?"], en: ["How do I apply as talent?", "Which collaborations has WEBLACK run?"] },
  creative_brief: { fr: ["Je veux préparer un brief de campagne", "Quelles collaborations WEBLACK a-t-elle menées ?"], en: ["I want to prepare a campaign brief", "Which collaborations has WEBLACK run?"] },
  consulting: { fr: ["Construire un brief de stratégie de marque", "Qu'est-ce que WEBLACK Perspective ?"], en: ["Build a brand strategy brief", "What is WEBLACK Perspective?"] },
  opportunities: { fr: ["Où en est l'annonce ZEDEFILE 2027 ?", "Comment candidater comme talent ?"], en: ["Where does the ZEDEFILE 2027 listing stand?", "How do I apply as talent?"] },
  sector_research: { fr: ["Que peux-tu affirmer de façon vérifiée ?", "Transmettre ma question à l'équipe"], en: ["What can you state with verified sources?", "Pass my question to the team"] },
  project_builder: { fr: ["Ouvrir le Project Builder", "Qu'est-ce que WEBLACK Perspective ?"], en: ["Open the Project Builder", "What is WEBLACK Perspective?"] },
  contact_handoff: { fr: ["Préparer un message pour l'équipe", "Ouvrir le Project Builder"], en: ["Prepare a message for the team", "Open the Project Builder"] },
  assistant_meta: { fr: ["Présente WEBLACK", "Ouvrir le Project Builder"], en: ["Introduce WEBLACK", "Open the Project Builder"] },
  general: { fr: ["Présente WEBLACK", "Comment candidater comme talent ?", "Ouvrir le Project Builder"], en: ["Introduce WEBLACK", "How do I apply as talent?", "Open the Project Builder"] },
};

const FROM_HINT: Record<string, SkillId> = { talent: "talent_guidance", creative: "creative_brief", consulting: "consulting", opportunities: "opportunities", contact: "contact_handoff" };

const BLOCKED: Record<Lang, string> = {
  fr: "Je ne peux pas donner suite à cette demande : elle cherche à modifier mes consignes ou à accéder à des informations que je ne dois pas divulguer. Je reste disponible pour toute question sur WEBLACK ou votre projet.",
  en: "I can't act on this request: it tries to change my instructions or to reach information I must not disclose. I'm still happy to help with any question about WEBLACK or your project.",
};
const INVALID: Record<Lang, string> = {
  fr: "Votre message n'a pas pu être traité (vide, trop long ou mal formé).",
  en: "Your message could not be processed (empty, too long or malformed).",
};
const SUSPENDED: Record<Lang, string> = {
  fr: "Cette fonction est momentanément suspendue. La conversation reste disponible.",
  en: "This function is temporarily suspended. The conversation remains available.",
};

function categorize(skill: SkillId, message: string): HandoffCategory {
  if (/\b(partenariat|partenaire|sponsor\w*|partnership|partner)\b/i.test(message)) return "partnership";
  if (/\b(defile|défilé|evenement|événement|event|show|fashion week)\b/i.test(message)) return "event";
  if (skill === "talent_guidance") return "talent";
  if (skill === "consulting") return "consulting";
  if (skill === "creative_brief") return "creative";
  return "general";
}

function empty(lang: Lang, reply: string, extra: Partial<ChatResponse>): ChatResponse {
  return { reply, lang, skill: "general", citations: [], verification: "none", suggestions: [], ...extra };
}

export async function handleTurn(req: ChatRequest, deps: Deps = {}): Promise<ChatResponse> {
  const knowledge = deps.knowledge ?? KNOWLEDGE;
  const now = deps.now ? deps.now() : new Date();
  const model = deps.model ?? new GroundedModel();
  const audit = deps.audit ?? (() => {});
  const pageLang: Lang = req.lang === "en" ? "en" : "fr";
  const consent = normalizeConsent(req.consent);
  void consent; // le serveur ne stocke rien : le consentement ne pilote que le client

  // ── Proposition d'envoi d'un contenu préparé par l'utilisateur ───────
  if (typeof req.proposeDraft === "string") {
    if (deps.sensitiveSuspended) return empty(pageLang, SUSPENDED[pageLang], { blocked: "suspended" });
    const proposal = await proposeHandoff(req.proposeDraft, pageLang, asCategory(req.proposeCategory));
    if (!proposal) {
      audit({ type: "invalid_request" });
      return empty(pageLang, INVALID[pageLang], { blocked: "invalid" });
    }
    audit({ type: "handoff_proposed", skill: "project_builder" });
    return empty(pageLang, pageLang === "fr" ? "Voici ce que je propose de préparer. Relisez, puis validez si cela vous convient." : "Here is what I propose to prepare. Review it, then confirm if it suits you.", { skill: "project_builder", proposal });
  }

  // ── Confirmation d'une action proposée ───────────────────────────────
  if (req.confirm) {
    if (deps.sensitiveSuspended) return empty(pageLang, SUSPENDED[pageLang], { blocked: "suspended" });
    if (typeof req.confirm.digest !== "string" || typeof req.confirm.draft !== "string") {
      audit({ type: "invalid_request" });
      return empty(pageLang, INVALID[pageLang], { blocked: "invalid" });
    }
    const handoff = await confirmHandoff(req.confirm.draft, req.confirm.digest, pageLang, asCategory(req.confirm.category));
    if (!handoff) {
      audit({ type: "handoff_rejected" });
      return empty(pageLang, pageLang === "fr" ? "La confirmation ne correspond pas à ce qui a été proposé : rien n'a été préparé." : "The confirmation does not match what was proposed: nothing was prepared.", { blocked: "invalid" });
    }
    audit({ type: "handoff_confirmed" });
    return empty(pageLang, pageLang === "fr" ? "Voici votre brouillon. Il s'ouvrira dans votre messagerie : relisez-le puis envoyez-le vous-même." : "Here is your draft. It will open in your mail app: review it, then send it yourself.", { handoff });
  }

  // ── Validation de l'entrée ───────────────────────────────────────────
  if (typeof req.message !== "string") {
    audit({ type: "invalid_request" });
    return empty(pageLang, INVALID[pageLang], { blocked: "invalid" });
  }
  const message = cleanText(req.message);
  const turns = validateTurns(req.history);
  if (!message || message.length > LIMITS.messageChars || !turns.ok) {
    audit({ type: "invalid_request" });
    return empty(pageLang, INVALID[pageLang], { blocked: "invalid" });
  }
  const lang = detectLanguage(message, pageLang);

  // L'historique est fourni par le client : il est donc traité comme non fiable, au même titre que le message.
  if (detectInjection(message) || turns.turns.some((t) => t.role === "user" && detectInjection(t.content))) {
    audit({ type: "injection_blocked" });
    return empty(lang, BLOCKED[lang], { blocked: "injection", suggestions: SUGGESTIONS.general[lang] });
  }

  // ── Compréhension et routage ─────────────────────────────────────────
  let routing = route(message, turns.turns);
  if (routing.skill === "general" && req.from && FROM_HINT[req.from]) routing = { skill: FROM_HINT[req.from], confidence: "low" };
  const skill = SKILLS.find((s) => s.id === routing.skill);

  if (routing.tie && !turns.turns.length && !hasEmotion(message)) {
    const fr = lang === "fr";
    return {
      reply: fr
        ? "Pour bien vous répondre : votre question relève-t-elle plutôt de la stratégie de marque, ou de la production (campagne, défilé, événement) ?"
        : "To answer you well: is your question more about brand strategy, or about production (campaign, show, event)?",
      lang, skill: routing.skill, citations: [], verification: "none", clarification: true,
      suggestions: fr ? ["Stratégie de marque", "Production créative"] : ["Brand strategy", "Creative production"],
    };
  }

  // ── Recherche documentaire (outil autorisé par la compétence) ────────
  let retrieved: ReturnType<typeof retrieve> = [];
  let uncovered = false;
  if (skill && skill.tools.includes("knowledge.search")) {
    assertToolAllowed(routing.skill, "knowledge.search");
    const pool = skill.domains === "all"
      ? knowledge
      : skill.domains === "sector"
        ? knowledge.filter((e) => e.domain !== "weblack") // connaissance sectorielle uniquement : un fait WEBLACK ne répond pas à une question de marché
        : knowledge.filter((e) => (skill.domains as string[]).includes(e.domain));
    // Requête de recherche = message + dernier message utilisateur : résout « et pour la mode ? ».
    const lastUser = [...turns.turns].reverse().find((t) => t.role === "user");
    const query = lastUser && message.split(/\s+/).length <= 6 ? lastUser.content + " " + message : message;
    retrieved = retrieve(query, pool, 4, now);
    if (retrieved.length === 0 && routing.skill === "sector_research") uncovered = true;
  }
  const entries = retrieved.map((r) => r.entry);
  const outdatedIds = new Set(retrieved.filter((r) => r.outdated).map((r) => r.entry.id));

  // ── Choix du moteur : modèle seulement si nécessaire (coût) ──────────
  const simpleDeterministic =
    routing.skill === "assistant_meta" ||
    routing.skill === "contact_handoff" ||
    (routing.skill === "general" && entries.length === 0 && message.split(/\s+/).length <= 3) ||
    (routing.skill === "weblack_info" && entries.length > 0 && retrieved[0].score >= 9 && message.split(/\s+/).length <= 8 && turns.turns.length === 0);

  let mode: "ai" | "documentary" = "documentary";
  let modeReason: string | undefined;
  let reply = "";
  let citations: Citation[] = entries.slice(0, 2).map((e) => toCitation(e, lang, now));
  let verification: ChatResponse["verification"] | undefined;

  if (!simpleDeterministic) {
    if (!deps.llm) {
      modeReason = REASON_LABEL.no_api_key[lang];
    } else {
      const plan = await deps.llm.plan();
      if (!plan.ok) {
        modeReason = REASON_LABEL[plan.reason][lang];
        if (plan.reason !== "disabled") audit({ type: "llm_fallback", skill: routing.skill });
      } else {
        const built = buildPrompt({ lang, skill: routing.skill, message, history: turns.turns, entries, outdatedIds, limits: plan.limits, from: req.from });
        const out = await deps.llm.call({ system: built.system, messages: built.messages, inputChars: built.inputChars, limits: plan.limits });
        if (out.ok) {
          mode = "ai";
          // Les marqueurs [S#] ne sont retenus que s'ils désignent un passage réellement fourni.
          const cited = new Map<string, KnowledgeEntry>();
          let text = out.text.replace(/\[S(\d+)\]/g, (m, n: string) => {
            const e = built.refs.get("S" + n);
            if (!e) return "";
            cited.set("S" + n, e);
            return m;
          });
          text = text.replace(/[ \t]+([.,;:])/g, "$1");
          reply = text;
          citations = [...cited.entries()].map(([ref, e]) => ({ ...toCitation(e, lang, now), ref }));
          verification = citations.length === 0 ? "unverified" : citations.every((c) => c.reliability === "verified" && !c.outdated) ? "verified" : "mixed";
        } else {
          modeReason = REASON_LABEL[out.reason][lang];
          audit({ type: "llm_fallback", skill: routing.skill });
        }
      }
    }
  }

  if (mode === "documentary") {
    reply = await model.generate({ lang, skill: routing.skill, message, entries, uncovered, firstTurn: turns.turns.length === 0 });
    citations = entries.slice(0, 2).map((e) => toCitation(e, lang, now));
  }

  const allowed = ["https://weblack.fr/", ...citations.flatMap((c) => (c.url ? [c.url] : []))];
  reply = sanitizeOutput(reply, allowed);
  verification = verification ?? (citations.length === 0 ? "unverified" : citations.every((c) => c.reliability === "verified" && !c.outdated) ? "verified" : "mixed");

  const response: ChatResponse = { reply, lang, skill: routing.skill, citations, verification, suggestions: SUGGESTIONS[routing.skill][lang], mode, ...(modeReason ? { modeReason } : {}) };

  // ── Action externe : proposée, jamais exécutée ───────────────────────
  if ((routing.skill === "contact_handoff" || routing.skill === "sector_research") && !deps.sensitiveSuspended) {
    const wantsHandoff = routing.skill === "contact_handoff" || uncovered;
    if (wantsHandoff) {
      try {
        assertToolAllowed(routing.skill, "handoff.prepare");
        const proposal = await proposeHandoff(message, lang, categorize(routing.skill, message));
        if (proposal) {
          response.proposal = proposal;
          audit({ type: "handoff_proposed", skill: routing.skill });
        }
      } catch {
        audit({ type: "tool_denied", skill: routing.skill });
      }
    }
  }
  return response;
}
