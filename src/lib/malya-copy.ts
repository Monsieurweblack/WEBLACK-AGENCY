/** Textes de l'interface MALYA (FR/EN). Gardés hors de ui.ts pour ne pas alourdir le dictionnaire global. */
import type { Lang } from "../i18n/utils";

export const MALYA_SIGNATURE = "The Intelligence Behind Every Creative Opportunity.";

export interface MalyaCopy {
  seoTitle: string; seoDescription: string; eyebrow: string; lead: string;
  tabChat: string; tabBuilder: string;
  logLabel: string; inputLabel: string; placeholder: string; send: string; sending: string;
  aiNotice: string; sources: string; verification: Record<"verified" | "mixed" | "unverified" | "none", string>;
  reliability: Record<"verified" | "historical" | "estimate" | "hypothesis", string>;
  consentLabel: string; consentHelp: string; clear: string; cleared: string;
  you: string; malya: string;
  suspended: string; rateLimited: string; error: string; offline: string;
  proposalTitle: string; proposalConfirm: string; proposalCancel: string; proposalCancelled: string; openMail: string;
  builder: Record<"title" | "lead" | "kind" | "goal" | "audience" | "timeline" | "budget" | "location" | "notes" | "generate" | "result" | "copy" | "copied" | "send" | "errorGoal", string>;
  kinds: Record<"talent" | "campaign" | "event" | "brand-strategy" | "other", string>;
  modeAi: string; modeDoc: string; outdated: string; conversationLabel: string; newConversation: string; newConversationDone: string; conversations: string;
  launcher: string; launcherClose: string; openFull: string; dialogTitle: string;
  welcomeTitle: string; welcomeText: string; typing: string; hintSend: string; statusAi: string; statusDoc: string; statusStop: string; statusOff: string;
  noticeQuota: string; noticeEmergency: string; noticeDoc: string; sendIcon: string; figure: string;
  privacyTitle: string;
  suggestions: string[];
  hints: Record<string, string[]>;
}

const FR: MalyaCopy = {
  seoTitle: "MALYA — l'intelligence de WEBLACK", seoDescription: "MALYA, l'interlocutrice IA de WEBLACK : présentez un projet, comprenez les divisions et la méthode, construisez un brief.",
  eyebrow: "WEBLACK AI", lead: "Posez votre question librement. MALYA s'appuie sur une base documentaire datée et sourcée, et ne transmet rien à l'équipe sans votre validation.",
  tabChat: "Conversation", tabBuilder: "Project Builder",
  logLabel: "Conversation avec MALYA", inputLabel: "Votre message", placeholder: "Écrivez à MALYA…", send: "Envoyer", sending: "MALYA réfléchit…",
  aiNotice: "MALYA est une intelligence artificielle. Vérifiez les informations importantes auprès de l'équipe.",
  sources: "Sources", verification: { verified: "Réponse appuyée sur des sources vérifiées", mixed: "Réponse mêlant informations vérifiées et non vérifiées", unverified: "Aucune source vérifiée pour cette réponse", none: "" },
  reliability: { verified: "Vérifié", historical: "Historique", estimate: "Estimation", hypothesis: "Hypothèse" },
  consentLabel: "Garder cette conversation sur cet appareil", consentHelp: "Stockage local au navigateur, 30 jours maximum, jamais envoyé à nos serveurs. Décochez ou effacez à tout moment.", clear: "Effacer la conversation", cleared: "Conversation effacée de cet appareil.",
  you: "Vous", malya: "MALYA",
  suspended: "MALYA n'est pas disponible pour le moment.", rateLimited: "Trop de messages en peu de temps. Patientez quelques minutes.", error: "Une erreur est survenue. Réessayez dans un instant.", offline: "Connexion impossible. Vérifiez votre réseau.",
  proposalTitle: "Action à valider", proposalConfirm: "Préparer le brouillon", proposalCancel: "Annuler", proposalCancelled: "Action annulée. Rien n'a été préparé.", openMail: "Ouvrir dans ma messagerie",
  builder: { title: "Project Builder", lead: "Décrivez votre projet. MALYA assemble un brief clair que vous pouvez copier ou transmettre à l'équipe après validation.", kind: "Type de projet", goal: "Objectif du projet", audience: "Public visé (facultatif)", timeline: "Calendrier (facultatif)", budget: "Budget indicatif (facultatif)", location: "Lieu ou marché (facultatif)", notes: "Précisions (facultatif)", generate: "Générer le brief", result: "Votre brief", copy: "Copier le brief", copied: "Brief copié.", send: "Préparer l'envoi à l'équipe", errorGoal: "Décrivez l'objectif en quelques mots au moins (10 caractères)." },
  kinds: { talent: "Talent (management, représentation)", campaign: "Campagne / production de contenu", event: "Événement / défilé", "brand-strategy": "Stratégie de marque", other: "Autre" },
  modeAi: "Réponses générées par l'IA à partir de sources vérifiées", modeDoc: "Mode documentaire (sans IA générative)", outdated: "source à revoir", conversationLabel: "Conversation", newConversation: "Nouvelle conversation", newConversationDone: "Nouvelle conversation ouverte.", conversations: "Vos conversations",
  launcher: "Parler à MALYA", launcherClose: "Fermer MALYA", openFull: "Ouvrir en plein écran", dialogTitle: "MALYA — WEBLACK AI",
  welcomeTitle: "Bonjour, je suis MALYA.", welcomeText: "Je vous accompagne dans vos projets de mode, de création, de communication et de développement professionnel. Que souhaitez-vous explorer aujourd'hui ?", typing: "MALYA rédige…", hintSend: "Entrée pour envoyer · Maj+Entrée pour passer à la ligne", statusAi: "Disponible · IA, sources vérifiées", statusDoc: "Disponible · mode documentaire", statusStop: "Suspendue · arrêt d'urgence", statusOff: "Indisponible", noticeQuota: "L'allocation gratuite d'IA du jour est atteinte : MALYA continue en mode documentaire.", noticeEmergency: "Le service est suspendu (arrêt d'urgence) : plus d'IA ni d'action externe.", noticeDoc: "Mode documentaire : MALYA répond depuis sa base de sources vérifiées, sans IA générative.", sendIcon: "Envoyer", figure: "Silhouette de MALYA",
  privacyTitle: "MALYA est une IA · Confidentialité et mémoire",
  suggestions: ["Présente WEBLACK", "Comment candidater comme talent ?", "Ouvrir le Project Builder"],
  hints: { talent: ["Comment candidater comme talent ?", "Quelles collaborations WEBLACK a-t-elle menées ?"], creative: ["Je veux préparer un brief de campagne", "Quelles collaborations WEBLACK a-t-elle menées ?"], consulting: ["Construire un brief de stratégie de marque", "Qu'est-ce que WEBLACK Perspective ?"], opportunities: ["Où en est l'annonce ZEDEFILE 2027 ?"], contact: ["Préparer un message pour l'équipe"] },
};

const EN: MalyaCopy = {
  seoTitle: "MALYA — WEBLACK's intelligence", seoDescription: "MALYA, WEBLACK's AI counterpart: present a project, understand the divisions and method, build a brief.",
  eyebrow: "WEBLACK AI", lead: "Ask freely. MALYA relies on a dated, sourced documentary base, and passes nothing on to the team without your confirmation.",
  tabChat: "Conversation", tabBuilder: "Project Builder",
  logLabel: "Conversation with MALYA", inputLabel: "Your message", placeholder: "Write to MALYA…", send: "Send", sending: "MALYA is thinking…",
  aiNotice: "MALYA is an artificial intelligence. Please check important information with the team.",
  sources: "Sources", verification: { verified: "Answer based on verified sources", mixed: "Answer mixing verified and unverified information", unverified: "No verified source for this answer", none: "" },
  reliability: { verified: "Verified", historical: "Historical", estimate: "Estimate", hypothesis: "Hypothesis" },
  consentLabel: "Keep this conversation on this device", consentHelp: "Stored locally in your browser for 30 days at most, never sent to our servers. Untick or clear at any time.", clear: "Clear conversation", cleared: "Conversation cleared from this device.",
  you: "You", malya: "MALYA",
  suspended: "MALYA is not available right now.", rateLimited: "Too many messages in a short time. Please wait a few minutes.", error: "Something went wrong. Please try again shortly.", offline: "Connection failed. Check your network.",
  proposalTitle: "Action to confirm", proposalConfirm: "Prepare the draft", proposalCancel: "Cancel", proposalCancelled: "Action cancelled. Nothing was prepared.", openMail: "Open in my mail app",
  builder: { title: "Project Builder", lead: "Describe your project. MALYA assembles a clear brief you can copy or pass to the team after you confirm.", kind: "Project type", goal: "Project goal", audience: "Target audience (optional)", timeline: "Timeline (optional)", budget: "Indicative budget (optional)", location: "Location or market (optional)", notes: "Details (optional)", generate: "Generate the brief", result: "Your brief", copy: "Copy the brief", copied: "Brief copied.", send: "Prepare sending to the team", errorGoal: "Describe the goal in a few words at least (10 characters)." },
  kinds: { talent: "Talent (management, representation)", campaign: "Campaign / content production", event: "Event / fashion show", "brand-strategy": "Brand strategy", other: "Other" },
  modeAi: "AI-generated answers grounded in verified sources", modeDoc: "Documentary mode (no generative AI)", outdated: "source due for review", conversationLabel: "Conversation", newConversation: "New conversation", newConversationDone: "New conversation opened.", conversations: "Your conversations",
  launcher: "Talk to MALYA", launcherClose: "Close MALYA", openFull: "Open full screen", dialogTitle: "MALYA — WEBLACK AI",
  welcomeTitle: "Hello, I'm MALYA.", welcomeText: "I support you in your fashion, creative, communication and professional development projects. What would you like to explore today?", typing: "MALYA is writing…", hintSend: "Enter to send · Shift+Enter for a new line", statusAi: "Available · AI, verified sources", statusDoc: "Available · documentary mode", statusStop: "Suspended · emergency stop", statusOff: "Unavailable", noticeQuota: "Today's free AI allocation is reached: MALYA continues in documentary mode.", noticeEmergency: "The service is suspended (emergency stop): no AI and no external action.", noticeDoc: "Documentary mode: MALYA answers from its base of verified sources, without generative AI.", sendIcon: "Send", figure: "MALYA silhouette",
  privacyTitle: "MALYA is an AI · Privacy and memory",
  suggestions: ["Introduce WEBLACK", "How do I apply as talent?", "Open the Project Builder"],
  hints: { talent: ["How do I apply as talent?", "Which collaborations has WEBLACK run?"], creative: ["I want to prepare a campaign brief", "Which collaborations has WEBLACK run?"], consulting: ["Build a brand strategy brief", "What is WEBLACK Perspective?"], opportunities: ["Where does the ZEDEFILE 2027 listing stand?"], contact: ["Prepare a message for the team"] },
};

export const malyaCopy = (lang: Lang): MalyaCopy => (lang === "en" ? EN : FR);

/** Sous-ensemble sérialisé dans la page / le lanceur (le reste n'a pas à être envoyé au navigateur). */
export function clientCopy(c: MalyaCopy) {
  return {
    sending: c.sending, suspended: c.suspended, rateLimited: c.rateLimited, error: c.error, offline: c.offline, cleared: c.cleared,
    proposalCancelled: c.proposalCancelled, reliability: c.reliability, verification: c.verification, sources: c.sources, you: c.you, malya: c.malya,
    proposalTitle: c.proposalTitle, proposalConfirm: c.proposalConfirm, proposalCancel: c.proposalCancel, openMail: c.openMail,
    modeAi: c.modeAi, modeDoc: c.modeDoc, outdated: c.outdated, conversationLabel: c.conversationLabel, newConversationDone: c.newConversationDone,
    errorGoal: c.builder.errorGoal, copied: c.builder.copied,
    welcomeTitle: c.welcomeTitle, welcomeText: c.welcomeText, typing: c.typing, hintSend: c.hintSend, statusAi: c.statusAi, statusDoc: c.statusDoc, statusStop: c.statusStop, statusOff: c.statusOff, noticeQuota: c.noticeQuota, noticeEmergency: c.noticeEmergency, noticeDoc: c.noticeDoc, sendIcon: c.sendIcon, figure: c.figure,
  };
}
