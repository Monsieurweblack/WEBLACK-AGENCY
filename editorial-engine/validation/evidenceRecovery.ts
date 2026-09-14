import type { VerifiedFact, VerifiedFactSet } from "../generation/types.ts";
import { extractComparableTokens, containsRelationMarker, stems } from "./equivalences.ts";

export interface RecoveredEvidence {
  fact: VerifiedFact;
  /** Comparable tokens (figures, dates, times, seasons) the claim and the original fact genuinely share. */
  matchedTokens: string[];
  /** Share of the claim's content words also present in the original fact and its evidence. */
  overlapRatio: number;
}

/** A claim carrying no figures at all has no hard anchor, so it needs much stronger topical agreement before it may inherit someone else's proof. */
const OVERLAP_WITH_SHARED_FIGURE = 0.34;
const OVERLAP_WITHOUT_FIGURE = 0.6;
/** Cross-language pairs rarely reach a high ratio even when they describe the same fact, so a figure-anchored claim may also qualify on a small number of shared stems. Never on stems alone. */
const MIN_SHARED_STEMS_WITH_FIGURE = 2;
const MIN_SHARED_STEMS_WITHOUT_FIGURE = 3;

/**
 * Re-attaches a published claim to the proof it was actually written from.
 *
 * The post-writing fact check asks a model to re-find, in the raw source,
 * the excerpt backing each sentence of the finished article. It frequently
 * returns nothing even for sentences that restate a fact already confirmed
 * verbatim before writing — the Phase 4 campaign had every blocking claim
 * of four cases sitting at `sources: 0` while the matching fact was, word
 * for word, in the Evidence Pack. Those are false rejections, and this
 * resolves them by handing the claim back its original proof.
 *
 * What it must never become is a similarity pass. Lexical closeness alone
 * proves nothing, so three conditions hold simultaneously:
 *
 *   1. No new data. Every figure, date, time or season in the claim must
 *      already be in the candidate fact. A claim that introduces one more
 *      number than its source fact is not a restatement of it — "496 000"
 *      can inherit proof from "496,000", "497 000" can inherit nothing.
 *   2. Same subject. The claim's content words must genuinely overlap the
 *      fact's, so a claim cannot borrow proof from an unrelated fact that
 *      happens to mention the same year.
 *   3. No new relation. A claim asserting causality, motivation,
 *      consequence, comparison or dependency may only inherit proof from
 *      evidence that asserts one too.
 *
 * The recovered status is the original fact's own status, never better: a
 * PARTIALLY_VERIFIED fact yields a PARTIALLY_VERIFIED claim.
 */
export function recoverEvidence(claimText: string, claimType: string, pack: VerifiedFactSet | undefined): RecoveredEvidence | undefined {
  if (!pack) return undefined;
  // Direct speech is exempt by design: a quote is proven by being verbatim,
  // never by resembling a fact that means roughly the same thing.
  if (claimType === "quote") return undefined;

  const claimTokens = extractComparableTokens(claimText);
  const claimStems = stems(claimText);
  if (claimStems.length === 0) return undefined;
  const claimAssertsRelation = containsRelationMarker(claimText);
  const hasFigureAnchor = claimTokens.length > 0;

  let best: RecoveredEvidence | undefined;
  for (const fact of [...pack.verified, ...pack.partiallyVerified]) {
    const factText = `${fact.fact} ${fact.evidenceQuote} ${fact.evidenceTranslation}`;
    const factTokens = new Set(extractComparableTokens(factText));

    // 1 — no new data.
    if (!claimTokens.every((token) => factTokens.has(token))) continue;

    // 3 — no new relation.
    if (claimAssertsRelation && !containsRelationMarker(factText)) continue;

    // 2 — same subject.
    const factStems = new Set(stems(factText));
    const sharedStems = claimStems.filter((s) => factStems.has(s)).length;
    const overlapRatio = sharedStems / claimStems.length;
    const requiredRatio = hasFigureAnchor ? OVERLAP_WITH_SHARED_FIGURE : OVERLAP_WITHOUT_FIGURE;
    const requiredStems = hasFigureAnchor ? MIN_SHARED_STEMS_WITH_FIGURE : MIN_SHARED_STEMS_WITHOUT_FIGURE;
    if (sharedStems < requiredStems && overlapRatio < requiredRatio) continue;
    if (sharedStems === 0) continue;

    if (!best || overlapRatio > best.overlapRatio) {
      best = { fact, matchedTokens: claimTokens, overlapRatio };
    }
  }

  return best;
}

/**
 * Correction B, applied to claims the model DID manage to source itself:
 * the evidence may be genuine while the relation built on top of it is
 * invented. "She worked at Fendi, then at Dior" never licenses "her time
 * at Fendi led her to Dior".
 */
export function assertsUnsupportedRelation(claimText: string, evidenceTexts: string[]): boolean {
  if (!containsRelationMarker(claimText)) return false;
  return !evidenceTexts.some((text) => containsRelationMarker(text));
}
