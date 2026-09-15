import "./setup.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ENGINE_ROOT } from "../config/env.ts";
import { acquireCycleLock, releaseCycleLock } from "../scheduler/cycleLock.ts";

const LOCK_FILE = path.join(ENGINE_ROOT, "logs", "cycle.lock");

function clearLock() {
  if (fs.existsSync(LOCK_FILE)) fs.unlinkSync(LOCK_FILE);
}

/**
 * Regression from the first real production cycle: a second run started
 * while the first was still alive, and both processed the same feeds —
 * every article analysed, written and fact-checked twice, with one pipeline
 * reaching PASS on an article the other rejected.
 */
test("a second cycle refuses to start while a live one holds the lock", () => {
  clearLock();
  assert.equal(acquireCycleLock(), true, "the first cycle takes the lock");

  // A live lock held by this very process is the strongest possible case of
  // "someone else is already running".
  assert.equal(acquireCycleLock(), false, "a concurrent cycle must refuse rather than double-process every source");

  releaseCycleLock();
  assert.equal(fs.existsSync(LOCK_FILE), false, "releasing removes the lock");
});

test("a lock left behind by a dead process is taken over, not treated as a permanent block", () => {
  clearLock();
  // pid 1 exists on POSIX but is not us; use an implausibly high pid that no
  // live process will own, which is exactly the crashed-owner situation.
  fs.writeFileSync(LOCK_FILE, JSON.stringify({ pid: 999_999_999, startedAt: "2026-01-01T00:00:00.000Z" }), "utf8");

  assert.equal(acquireCycleLock(), true, "a stale lock must never block production forever");
  releaseCycleLock();
  clearLock();
});

test("an unreadable lock file does not wedge production", () => {
  clearLock();
  fs.writeFileSync(LOCK_FILE, "{ not json", "utf8");
  assert.equal(acquireCycleLock(), true);
  releaseCycleLock();
  clearLock();
});
