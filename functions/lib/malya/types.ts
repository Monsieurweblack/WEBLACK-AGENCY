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

export interface KnowledgeEntry {
  id: string;
  /** Domaine de la taxonomie sectorielle (voir knowledge.ts). */
  domain: string;
  title: Record<Lang, string>;
  text: Record<Lang, string>;
  keywords: string[];
  source: Source;
  /** Date de vérification ISO (AAAA-MM-JJ). Obligatoire. */
  verifiedAt: string;
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
  confirm?: { digest: string; draft: string };
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
  clarification?: boolean;
}
