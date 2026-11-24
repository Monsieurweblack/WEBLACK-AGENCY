/**
 * Couche modèle. V1 : aucun appel à un modèle de langage payant.
 *
 * `ModelProvider` est l'interface qu'un fournisseur autorisé (ex. API
 * Claude) implémentera plus tard SANS toucher à l'orchestrateur, aux
 * garde-fous ni aux tests. `GroundedModel` est le seul fournisseur livré :
 * déterministe, il ne dit que ce que la base de connaissances soutient et
 * étiquette chaque information selon sa fiabilité.
 */
import type { KnowledgeEntry, Lang, Reliability, SkillId } from "./types.ts";
import { normalize } from "./knowledge.ts";

export interface ModelInput {
  lang: Lang;
  skill: SkillId;
  message: string;
  entries: KnowledgeEntry[];
  /** Domaine hors couverture : la base n'a aucune entrée vérifiée. */
  uncovered: boolean;
  firstTurn: boolean;
}

export interface ModelProvider {
  readonly name: string;
  generate(input: ModelInput): Promise<string>;
}

const RELIABILITY_LABEL: Record<Reliability, Record<Lang, string>> = {
  verified: { fr: "Vérifié", en: "Verified" },
  historical: { fr: "Historique", en: "Historical" },
  estimate: { fr: "Estimation", en: "Estimate" },
  hypothesis: { fr: "Hypothèse", en: "Hypothesis" },
};

export function reliabilityLabel(r: Reliability, lang: Lang): string {
  return RELIABILITY_LABEL[r][lang];
}

const EMOTION = /\b(stress\w*|anxieu\w*|angoiss\w*|decourag\w*|perdu\w*|submerg\w*|inquiet\w*|peur|epuis\w*|frustr\w*|overwhelm\w*|anxious|worried|nervous|discourag\w*|lost|scared|exhausted|stressed|frustrated)\b/;
const CORRECTION = /(tu te trompes|c est faux|c est incorrect|erreur|you are wrong|you're wrong|that is wrong|that's wrong|incorrect|mistake|pas correct)/;
const GREETING = /^(bonjour|salut|bonsoir|hello|hi|hey|coucou)\b/;

export function hasEmotion(message: string): boolean {
  return EMOTION.test(normalize(message));
}

export class GroundedModel implements ModelProvider {
  readonly name = "grounded-v1";

  async generate(i: ModelInput): Promise<string> {
    const fr = i.lang === "fr";
    const q = normalize(i.message);
    const parts: string[] = [];

    if (EMOTION.test(q)) {
      parts.push(fr
        ? "Je comprends que cette situation puisse être pesante. Allons-y pas à pas."
        : "I understand this situation can feel heavy. Let's take it one step at a time.");
    }
    if (CORRECTION.test(q)) {
      parts.push(fr
        ? "Merci de me le signaler : je peux me tromper. Dites-moi ce qui est inexact et, si possible, la source ; je corrigerai ma réponse, et si l'erreur vient de ma base, je la marquerai pour vérification."
        : "Thank you for pointing that out: I can be wrong. Tell me what is inaccurate and, if you can, the source; I will correct my answer, and if the error comes from my knowledge base I will flag it for review.");
      return parts.join("\n\n");
    }

    if (i.skill === "assistant_meta") {
      parts.push(fr
        ? "Je suis MALYA, l'intelligence de WEBLACK. Je peux présenter l'agence, ses trois divisions et sa méthode, vous orienter vers Talent, Creative ou Consulting, expliquer les opportunités publiées et vous aider à construire un brief de projet. Mes limites : je suis une IA, je ne recherche pas sur internet, je ne consulte que ma base documentaire (chaque information est datée, sourcée et classée par fiabilité) et je n'envoie jamais rien sans votre validation explicite."
        : "I am MALYA, WEBLACK's intelligence. I can introduce the agency, its three divisions and its method, point you to Talent, Creative or Consulting, explain the published opportunities and help you build a project brief. My limits: I am an AI, I do not search the internet, I only use my documentary base (every item is dated, sourced and graded by reliability) and I never send anything without your explicit confirmation.");
      return parts.join("\n\n");
    }

    if (i.entries.length > 0) {
      for (const e of i.entries.slice(0, 2)) {
        parts.push(`${e.text[i.lang]}\n— ${reliabilityLabel(e.reliability, i.lang)} · ${e.source.label} · ${e.verifiedAt}`);
      }
      const tail = this.tail(i);
      if (tail) parts.push(tail);
      return parts.join("\n\n");
    }

    if (i.skill === "general" && GREETING.test(q) && i.firstTurn) {
      parts.push(fr
        ? "Bonjour, je suis MALYA, l'intelligence de WEBLACK. Dites-moi librement ce que vous cherchez : présenter un projet, candidater comme talent, comprendre nos divisions ou une opportunité publiée."
        : "Hello, I am MALYA, WEBLACK's intelligence. Tell me freely what you are looking for: presenting a project, applying as talent, understanding our divisions or a published opportunity.");
      return parts.join("\n\n");
    }

    if (i.skill === "project_builder" || i.skill === "contact_handoff") {
      parts.push(fr
        ? "Je peux vous aider à structurer votre demande. Décrivez-la comme vous voulez, ou ouvrez le Project Builder pour obtenir un brief clair. Je ne transmettrai rien à l'équipe sans votre validation explicite."
        : "I can help you structure your request. Describe it however you like, or open the Project Builder to get a clear brief. I will not pass anything on to the team without your explicit confirmation.");
      return parts.join("\n\n");
    }

    // Aucun appui documentaire : aveu honnête, jamais d'invention.
    parts.push(i.uncovered
      ? (fr
        ? "Je n'ai pas encore de connaissance vérifiée sur ce sujet dans ma base : je préfère ne pas vous donner de chiffres, de noms ni de dates que je ne pourrais pas sourcer. Je peux en revanche transmettre votre question à l'équipe WEBLACK (avec votre accord), ou vous présenter ce que WEBLACK fait réellement."
        : "I do not yet have verified knowledge on this topic in my base: I would rather not give you figures, names or dates I cannot source. I can, however, pass your question on to the WEBLACK team (with your consent), or present what WEBLACK actually does.")
      : (fr
        ? "Je n'ai pas trouvé d'information vérifiée qui réponde précisément à votre question. Pouvez-vous la reformuler, ou me dire ce que vous cherchez à accomplir ?"
        : "I did not find verified information that answers your question precisely. Could you rephrase it, or tell me what you are trying to achieve?"));
    return parts.join("\n\n");
  }

  private tail(i: ModelInput): string {
    const fr = i.lang === "fr";
    if (i.skill === "talent_guidance") return fr ? "Vous pouvez déposer votre candidature sur la page Talent ; je peux vous aider à préparer ce que vous y direz." : "You can apply on the Talent page; I can help you prepare what you will say there.";
    if (i.skill === "consulting" || i.skill === "creative_brief") return fr ? "Si vous avez un projet en tête, le Project Builder transforme vos idées en brief exploitable." : "If you have a project in mind, the Project Builder turns your ideas into a usable brief.";
    return "";
  }
}
