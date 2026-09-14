import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDbPath = path.join(__dirname, `.test-${process.pid}-${Date.now()}.sqlite3`);
process.env.EDITORIAL_TEST_DB = testDbPath;

// Never touch the real Sanity write token from unit tests — dedupe.ts's
// Level 3+ path needs a live Sanity read, which is exercised separately by
// the real-source dry-run campaign (editorial-engine/test-results/), not
// by these fast, offline unit tests. Tests that would reach Sanity are
// written to test the pure/local logic paths instead (see dedupe.test.ts).

process.on("exit", () => {
  try {
    fs.unlinkSync(testDbPath);
  } catch {
    // best-effort cleanup
  }
});
