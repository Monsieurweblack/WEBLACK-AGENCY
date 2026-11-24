/**
 * MALYA — types communs. Aucun import : ce module est partagé par
 * l'orchestrateur, le point d'entrée HTTP et les tests.
 */
export type Lang = "fr" | "en";

/**
 * Niveau de fiabilité d'une connaissance. Distinction imposée par le brief :
 * une information vérifiée n'est jamais présentée comme une estimation.
 */
export type Reliability = "verified" | "historical" | "estimate" | "hypothesis";

export type SourceKind = "owner-brief" | "primary" | "institutional" | "professional" | "documentary";

export interface Source {
  label: string;
  kind: SourceKind;
  /** URL publique éventuelle. Jamais fabriquée : absente si inconnue. */
  url?: string;
}

export type ValidationStatus = "draft" | "machine-checked" | "human-validated";

export interface KnowledgeEntry {
  id: string;
  /** Domaine de la taxonomie sectorielle (voir knowledge.ts). */
  domain: string;
  title: Record<Lang, string>;
  text: Record<Lang, string>;
  keywords: string[];
  source: Source;
  /** Auteur ou institution à l'origine de l'information. */
  author: string;
  /** Date de publication de la source, si connue (AAAA-MM-JJ). */
  publishedAt?: string;
  /** Date de consultation de la source (AAAA-MM-JJ). */
  consultedAt: string;
  /** Date de dernière vérification ISO (AAAA-MM-JJ). Obligatoire. */
  verifiedAt: string;
  /** Prochaine révision prévue ; passée, l'entrée est signalée obsolète. */
  nextReviewAt: string;
  /** Langue du contenu source. */
  lang: Lang;
  /** Étape de validation : seul « human-validated » a été relu par WEBLACK. */
  validation: ValidationStatus;
  /** Entrées avec lesquelles celle-ci est en contradiction connue. */
  contradicts?: string[];
  reliability: Reliability;
  /** Chaîne de traçabilité : d'où vient l'information, qui l'a validée. */
  provenance: string;
}

export interface Citation {
  id: string;
  title: string;
  source: string;
  url?: string;
  verifiedAt: string;
  reliability: Reliability;
  /** Marqueur [S#] utilisé dans la réponse du modèle. */
  ref?: string;
  /** Entrée dont la date de révision est dépassée. */
  outdated?: boolean;
}

export type SkillId =
  | "weblack_info"
  | "talent_guidance"
  | "creative_brief"
  | "consulting"
  | "opportunities"
  | "sector_research"
  | "project_builder"
  | "contact_handoff"
  | "assistant_meta"
  | "general";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ConsentState {
  /** Mémoire locale des conversations (côté navigateur uniquement en V1). */
  memory: boolean;
}

export interface ActionProposal {
  kind: "transmit_request";
  category: "talent" | "consulting" | "creative" | "event" | "partnership" | "general";
  /** Empreinte du contenu : la confirmation doit la reproduire à l'identique. */
  digest: string;
  summary: string;
  /** Destinataire affiché à l'utilisateur avant qu'il valide. */
  recipient: string;
}

export interface ChatRequest {
  message: string;
  history?: ChatTurn[];
  lang?: Lang;
  consent?: Partial<ConsentState>;
  /** Page d'où vient l'utilisateur (suggestions contextuelles). */
  from?: string;
  /** Contenu à transmettre (ex. brief du Project Builder) : renvoie une proposition à valider, rien d'autre. */
  proposeDraft?: string;
  /** Confirmation explicite d'une action proposée. */
  confirm?: { digest: string; draft: string; category?: string };
  /** Catégorie d'une proposition (ex. issue du Project Builder). */
  proposeCategory?: string;
}

export interface ChatResponse {
  reply: string;
  lang: Lang;
  skill: SkillId;
  citations: Citation[];
  /** Résumé de vérification affiché à l'utilisateur. */
  verification: "verified" | "mixed" | "unverified" | "none";
  suggestions: string[];
  proposal?: ActionProposal;
  /** Brouillon prêt à ouvrir dans le client mail — seulement après confirmation. */
  handoff?: { mailto: string };
  blocked?: "injection" | "invalid" | "suspended";
  /** Mode réel de cette réponse : modèle (ai) ou base documentaire seule. */
  mode?: "ai" | "documentary";
  /** Raison lorsque le mode documentaire est imposé (clé absente, budget, arrêt…). */
  modeReason?: string;
  /** Code machine de la raison (pour l'état affiché : arrêt d'urgence, quota, documentaire…). */
  modeCode?: string;
  clarification?: boolean;
}
