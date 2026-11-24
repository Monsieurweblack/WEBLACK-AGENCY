/**
 * Tests MALYA V1.2 — limitation de débit atomique (D1), parallélisme via l'API,
 * migrations, politique de confidentialité, scripts de vérification.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkMalyaRate, hit, LIMITS, pruneRate } from "./malya/rateLimit.ts";
import { onRequestPost as chat } from "../api/malya/chat.ts";
import { SqliteD1 } from "./testDoubles.ts";

const asDb = (d: SqliteD1) => d as unknown as D1Database;
const T0 = Date.parse("2026-11-24T10:00:00Z");
const req = (ip: string) => new Request("https://weblack.fr/x", { headers: { "CF-Connecting-IP": ip } });

test("débit : exactement `limit` requêtes passent par fenêtre, même lancées en parallèle (atomicité D1)", async () => {
  const db = new SqliteD1();
  const results = await Promise.all(Array.from({ length: 200 }, () => hit(asDb(db), "ip:test", 30, 600, T0)));
  assert.equal(results.filter((r) => r.allowed).length, 30);
  assert.equal(Math.max(...results.map((r) => r.count)), 200);
});

test("débit : la fenêtre se réinitialise, les IP sont indépendantes et le plafond global s'applique", async () => {
  const db = new SqliteD1();
  for (let i = 0; i < 31; i += 1) await hit(asDb(db), "ip:a", 30, 600, T0);
  assert.equal((await hit(asDb(db), "ip:a", 30, 600, T0 + 1000)).allowed, false);
  assert.equal((await hit(asDb(db), "ip:b", 30, 600, T0 + 1000)).allowed, true, "autre IP");
  assert.equal((await hit(asDb(db), "ip:a", 30, 600, T0 + 601_000)).allowed, true, "nouvelle fenêtre");
  const g = new SqliteD1();
  const v: boolean[] = [];
  for (let i = 0; i < LIMITS.global.limit + 5; i += 1) v.push((await checkMalyaRate(asDb(g), req("10.0." + (i % 250) + "." + Math.floor(i / 250)), T0)).ok);
  assert.equal(v.filter(Boolean).length, LIMITS.global.limit, "plafond global : l'attaque distribuée est coupée");
});

test("débit : échec fermé (base absente ou illisible) et aucune IP en clair", async () => {
  assert.deepEqual(await checkMalyaRate(undefined, req("1.2.3.4"), T0), { ok: false, reason: "unavailable", retryAfter: 60 });
  const db = new SqliteD1();
  db.unavailable = true;
  assert.equal((await checkMalyaRate(asDb(db), req("1.2.3.4"), T0)).ok, false);
  db.unavailable = false;
  await checkMalyaRate(asDb(db), req("203.0.113.77"), T0);
  const keys = (db.db.prepare("SELECT key FROM malya_rate").all() as { key: string }[]).map((r) => r.key);
  assert.ok(keys.includes("global") && keys.some((k) => /^ip:[0-9a-f]{24}$/.test(k)));
  assert.ok(!keys.join(",").includes("203.0.113.77"));
});

test("débit : les fenêtres expirées sont purgées, pas les actives", async () => {
  const db = new SqliteD1();
  await hit(asDb(db), "ip:old", 30, 600, T0 - 3 * 86_400_000);
  await hit(asDb(db), "ip:new", 30, 600, T0);
  await pruneRate(asDb(db), T0);
  const keys = (db.db.prepare("SELECT key FROM malya_rate").all() as { key: string }[]).map((r) => r.key);
  assert.deepEqual(keys, ["ip:new"]);
});

test("API : 80 requêtes simultanées d'une même IP → exactement 30 réponses, 50 refus 429", async () => {
  const db = new SqliteD1();
  const env = { MALYA_ENABLED: "true", DB: asDb(db) };
  const mk = () => new Request("https://weblack.fr/api/malya/chat", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://weblack.fr", "CF-Connecting-IP": "198.51.100.9" }, body: JSON.stringify({ message: "Bonjour" }) });
  const res = await Promise.all(Array.from({ length: 80 }, () => chat({ request: mk(), env, params: {} })));
  const codes = res.map((r) => r.status);
  assert.equal(codes.filter((c) => c === 200).length, 30);
  assert.equal(codes.filter((c) => c === 429).length, 50);
  assert.ok(res.find((r) => r.status === 429)!.headers.get("Retry-After"));
});

test("API : sans base D1 la limitation échoue fermé (503), et le service n'est jamais servi sans compteur", async () => {
  const r = await chat({ request: new Request("https://weblack.fr/api/malya/chat", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://weblack.fr" }, body: JSON.stringify({ message: "Bonjour" }) }), env: { MALYA_ENABLED: "true" }, params: {} });
  assert.equal(r.status, 503);
});

test("migration 0010 : additive, sans suppression, idempotente ; 0009 et 0010 s'appliquent dans l'ordre", () => {
  const sql = readFileSync(new URL("../../migrations/0010_malya_rate_limit.sql", import.meta.url), "utf8");
  assert.doesNotMatch(sql.replace(/--.*$/gm, ""), /\b(DROP|DELETE|ALTER)\b/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS malya_rate/);
  const db = new SqliteD1();
  db.db.exec(sql);
  const t = (db.db.prepare("SELECT name FROM sqlite_master WHERE name IN ('malya_budget','malya_rate') ORDER BY name").all() as { name: string }[]).map((r) => r.name);
  assert.deepEqual(t, ["malya_budget", "malya_rate"]);
});

test("confidentialité : la politique FR et EN décrit MALYA, Anthropic, la mémoire locale et la conservation", () => {
  for (const [file, words] of [
    ["../../src/pages/politique-de-confidentialite.astro", ["MALYA", "Anthropic", "30 jours", "n'est pas enregistré sur nos serveurs", "consentement"]],
    ["../../src/pages/en/politique-de-confidentialite.astro", ["MALYA", "Anthropic", "30 days", "not recorded on our servers", "consent"]],
  ] as const) {
    const text = readFileSync(new URL(file, import.meta.url), "utf8");
    for (const w of words) assert.ok(text.includes(w), `${file} : « ${w} » absent`);
  }
});

test("scripts : le test d'appel réel refuse de dépenser sans confirmation explicite ni clé", () => {
  const src = readFileSync(new URL("../../scripts/malya-live-check.mjs", import.meta.url), "utf8");
  assert.match(src, /--confirm-spend/);
  assert.match(src, /process\.env\.ANTHROPIC_API_KEY/);
  assert.doesNotMatch(src, /process\.argv[^;\n]*API_KEY/);
  assert.match(src, /MALYA_MONTHLY_BUDGET_EUR: "0\.05"/);
});

test("configuration : MALYA n'est activée que dans l'environnement Preview de wrangler.toml, jamais en production", () => {
  const toml = readFileSync(new URL("../../wrangler.toml", import.meta.url), "utf8");
  const previewAt = toml.indexOf("[env.preview]");
  const top = toml.slice(0, previewAt);
  const preview = toml.slice(previewAt);
  assert.doesNotMatch(top, /MALYA_/, "aucune variable MALYA dans la configuration de production");
  assert.match(preview, /MALYA_ENABLED = "true"/);
  assert.match(preview, /MALYA_MONTHLY_BUDGET_EUR = "15"/);
  assert.doesNotMatch(toml, /ANTHROPIC_API_KEY\s*=/, "la clé n'est jamais dans le dépôt");
  assert.doesNotMatch(toml, /MALYA_EMERGENCY_STOP\s*=/, "l'arrêt d'urgence est un secret du tableau de bord");
});
