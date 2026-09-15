import fs from "node:fs";
import path from "node:path";
import { ENGINE_ROOT } from "../config/env.ts";
import { log } from "../logs/logger.ts";

const LOCK_FILE = path.join(ENGINE_ROOT, "logs", "cycle.lock");

/**
 * Stops two production cycles from running at the same time.
 *
 * Found the hard way during the first real cycle: a second run was started
 * while the first was still alive, and both processed the same feeds
 * concurrently. Nothing was corrupted — the slug check and the run history
 * held — but every article was analysed, written and fact-checked twice,
 * and two pipelines racing on the same source produced a PASS on one side
 * and a REJECT on the other for the same article. In scheduled operation
 * this is not an edge case: any cycle that runs longer than the interval
 * between cycles overlaps the next one.
 *
 * The lock records the owning pid, so a lock left behind by a process that
 * died (crash, kill, machine restart) is detected as stale and taken over
 * rather than blocking production forever.
 */
export function acquireCycleLock(): boolean {
  const existing = readLock();
  if (existing) {
    if (isAlive(existing.pid)) {
      log("SOURCE FOUND", `Cycle déjà en cours (pid ${existing.pid}, démarré ${existing.startedAt}) — abandon pour ne pas traiter les mêmes sources deux fois.`);
      return false;
    }
    log("SOURCE FOUND", `Verrou orphelin trouvé (pid ${existing.pid} n'existe plus) — repris.`);
  }
  fs.writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), "utf8");
  return true;
}

export function releaseCycleLock(): void {
  const existing = readLock();
  // Only ever release our own lock: a stale-takeover race must not let one
  // process delete the lock another one legitimately holds.
  if (existing && existing.pid !== process.pid) return;
  if (fs.existsSync(LOCK_FILE)) fs.unlinkSync(LOCK_FILE);
}

function readLock(): { pid: number; startedAt: string } | undefined {
  if (!fs.existsSync(LOCK_FILE)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(LOCK_FILE, "utf8"));
  } catch {
    return undefined; // unreadable lock is treated as absent rather than blocking production forever
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0 tests existence without touching the process
    return true;
  } catch {
    return false;
  }
}
