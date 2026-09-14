import crypto from "node:crypto";

/** One run_id per processArticle() call — threads through every OpenAI call for that source so traces, retries and the local run history can all be correlated back to the same logical attempt (§10, §12). */
export function newRunId(): string {
  return crypto.randomUUID();
}
