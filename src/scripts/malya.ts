/**
 * Interface MALYA (navigateur). Règles :
 *  - tout texte venant du serveur est inséré via textContent (jamais innerHTML) ;
 *  - la mémoire locale n'existe qu'avec consentement, expire et s'efface ;
 *  - aucune action n'est exécutée sans clic de confirmation de l'utilisateur.
 */
import { buildBrief, PROJECT_KINDS, type ProjectKind } from "../../functions/lib/malya/projectBrief";
import { normalizeConsent, pruneMemory, type StoredTurn } from "../../functions/lib/malya/consent";

type Reliability = "verified" | "historical" | "estimate" | "hypothesis";
interface Citation { id: string; title: string; source: string; url?: string; verifiedAt: string; reliability: Reliability }
interface Proposal { digest: string; summary: string; recipient: string }
interface Reply {
  reply: string; citations: Citation[]; verification: "verified" | "mixed" | "unverified" | "none";
  suggestions: string[]; proposal?: Proposal; handoff?: { mailto: string }; blocked?: string; error?: string;
}

const root = document.querySelector<HTMLElement>("[data-malya]");
if (root) init(root);

function init(root: HTMLElement) {
  const lang = root.dataset.lang === "en" ? "en" : "fr";
  const copy = JSON.parse(root.dataset.copy ?? "{}");
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const log = $("malya-log"), form = $<HTMLFormElement>("malya-form"), input = $<HTMLTextAreaElement>("malya-input");
  const send = $<HTMLButtonElement>("malya-send"), status = $("malya-status"), proposalBox = $("malya-proposal");
  const suggestionsBox = $("malya-suggestions"), consent = $<HTMLInputElement>("malya-consent");
  const KEY = "malya.memory.v1", CONSENT_KEY = "malya.consent.v1", BUILDER_KEY = "malya.builder.v1";
  const turns: StoredTurn[] = [];
  const from = new URLSearchParams(location.search).get("from") ?? undefined;

  const store = {
    get(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } },
    set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* stockage indisponible : la page fonctionne sans */ } },
    del(k: string) { try { localStorage.removeItem(k); } catch { /* idem */ } },
  };

  // ── Onglets (clavier : flèches) ──
  const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>("[role=tab]"));
  function selectTab(tab: HTMLButtonElement) {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      t.classList.toggle("border-(--color-gold)", on);
      t.classList.toggle("text-(--color-gold)", on);
      t.classList.toggle("border-transparent", !on);
      const panel = document.getElementById(t.getAttribute("aria-controls") ?? "");
      if (panel) { panel.hidden = !on; panel.classList.toggle("hidden", !on); }
    }
    tab.focus();
  }
  tabs.forEach((t, i) => {
    t.addEventListener("click", () => selectTab(t));
    t.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight") selectTab(tabs[(i + 1) % tabs.length]);
      if (e.key === "ArrowLeft") selectTab(tabs[(i - 1 + tabs.length) % tabs.length]);
    });
  });

  // ── Rendu ──
  function bubble(who: "you" | "malya", text: string, extra?: HTMLElement): HTMLElement {
    const wrap = document.createElement("div");
    const label = document.createElement("p");
    label.className = "label-tracked " + (who === "malya" ? "text-(--color-gold)" : "text-(--color-paper)/60");
    label.textContent = who === "malya" ? copy.malya : copy.you;
    wrap.append(label);
    for (const para of text.split(/\n{2,}/)) {
      const p = document.createElement("p");
      p.className = "mt-2 whitespace-pre-line " + (who === "malya" ? "text-(--color-paper)" : "text-(--color-paper)/80");
      p.textContent = para;
      wrap.append(p);
    }
    if (extra) wrap.append(extra);
    log.append(wrap);
    log.scrollTop = log.scrollHeight;
    return wrap;
  }

  function sourcesBlock(r: Reply): HTMLElement | undefined {
    if (r.verification === "none" && r.citations.length === 0) return undefined;
    const box = document.createElement("div");
    box.className = "mt-3 border-l border-(--color-line) pl-4 text-sm text-(--color-paper)/70";
    const v = document.createElement("p");
    v.textContent = copy.verification[r.verification] ?? "";
    box.append(v);
    if (r.citations.length) {
      const details = document.createElement("details");
      const sum = document.createElement("summary");
      sum.className = "mt-1 inline-flex min-h-11 cursor-pointer items-center";
      sum.textContent = `${copy.sources} (${r.citations.length})`;
      details.append(sum);
      const ul = document.createElement("ul");
      ul.className = "mt-2 space-y-2";
      for (const c of r.citations) {
        const li = document.createElement("li");
        li.textContent = `${copy.reliability[c.reliability]} · ${c.title} — ${c.source} · ${c.verifiedAt}`;
        if (c.url && /^https:\/\//.test(c.url)) {
          const a = document.createElement("a");
          a.href = c.url; a.rel = "noopener noreferrer"; a.target = "_blank";
          a.className = "ml-2 underline underline-offset-4 hover:text-(--color-gold)";
          a.textContent = "↗";
          a.setAttribute("aria-label", c.source);
          li.append(a);
        }
        ul.append(li);
      }
      details.append(ul);
      box.append(details);
    }
    return box;
  }

  function setSuggestions(items: string[]) {
    if (!items.length) return;
    suggestionsBox.replaceChildren(...items.map((s) => {
      const b = document.createElement("button");
      b.type = "button"; b.dataset.suggestion = s; b.textContent = s;
      b.className = suggestionsBox.querySelector("button")?.className ?? "label-tracked min-h-11 border border-(--color-line) px-5 py-3 text-(--color-paper) hover:border-(--color-gold) hover:text-(--color-gold)";
      return b;
    }));
  }

  // ── Réseau ──
  async function call(body: Record<string, unknown>): Promise<Reply | null> {
    try {
      const res = await fetch("/api/malya/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      if (res.status === 503) { status.textContent = copy.suspended; return null; }
      if (res.status === 429) { status.textContent = copy.rateLimited; return null; }
      if (!res.ok) { status.textContent = copy.error; return null; }
      return (await res.json()) as Reply;
    } catch {
      status.textContent = copy.offline;
      return null;
    }
  }

  // ── Mémoire locale (consentement explicite) ──
  function persist() {
    if (!consent.checked) return;
    store.set(KEY, JSON.stringify(pruneMemory(turns, Date.now())));
  }
  function restore() {
    consent.checked = normalizeConsent(JSON.parse(store.get(CONSENT_KEY) ?? "null")).memory;
    if (!consent.checked) return;
    try {
      const saved = pruneMemory(JSON.parse(store.get(KEY) ?? "[]") as StoredTurn[], Date.now());
      for (const t of saved) { turns.push(t); bubble(t.role === "user" ? "you" : "malya", t.content); }
    } catch { store.del(KEY); }
  }
  consent.addEventListener("change", () => {
    store.set(CONSENT_KEY, JSON.stringify({ memory: consent.checked }));
    if (consent.checked) persist(); else { store.del(KEY); store.del(BUILDER_KEY); }
  });
  $("malya-clear").addEventListener("click", () => {
    store.del(KEY); store.del(BUILDER_KEY); turns.length = 0; log.replaceChildren(); proposalBox.classList.add("hidden");
    status.textContent = copy.cleared;
  });

  // ── Envoi d'un message ──
  async function ask(message: string) {
    const text = message.trim();
    if (!text) return;
    if (/^(ouvrir le project builder|open the project builder)$/i.test(text)) { selectTab(tabs[1]); return; }
    bubble("you", text);
    turns.push({ role: "user", content: text, at: Date.now() });
    input.value = ""; send.disabled = true; status.textContent = copy.sending; proposalBox.classList.add("hidden");
    const history = turns.slice(-13, -1).map(({ role, content }) => ({ role, content }));
    const r = await call({ message: text, history, lang, from, consent: { memory: consent.checked } });
    send.disabled = false;
    if (!r) { turns.pop(); return; }
    status.textContent = "";
    bubble("malya", r.reply, sourcesBlock(r));
    if (r.blocked) {
      // Un échange refusé ne doit ni empoisonner la suite de la conversation, ni être mémorisé.
      turns.pop();
    } else {
      turns.push({ role: "assistant", content: r.reply, at: Date.now() });
      persist();
    }
    setSuggestions(r.suggestions ?? []);
    if (r.proposal) showProposal(r.proposal, text);
    input.focus();
  }

  function showProposal(p: Proposal, draft: string) {
    proposalBox.replaceChildren();
    const title = document.createElement("p");
    title.id = "malya-proposal-title"; title.className = "label-tracked text-(--color-gold)"; title.textContent = copy.proposalTitle;
    const summary = document.createElement("p");
    summary.className = "mt-3 text-(--color-paper)"; summary.textContent = p.summary;
    const preview = document.createElement("p");
    preview.className = "mt-3 whitespace-pre-line border-l border-(--color-line) pl-4 text-sm text-(--color-paper)/70"; preview.textContent = draft;
    const actions = document.createElement("div");
    actions.className = "mt-4 flex flex-wrap gap-3";
    const ok = document.createElement("button"); ok.type = "button"; ok.textContent = copy.proposalConfirm;
    ok.className = "label-tracked min-h-11 border border-(--color-gold) px-5 py-3 text-(--color-gold) hover:bg-(--color-gold) hover:text-(--color-ink)";
    const no = document.createElement("button"); no.type = "button"; no.textContent = copy.proposalCancel;
    no.className = "label-tracked min-h-11 border border-(--color-line) px-5 py-3 text-(--color-paper) hover:border-(--color-gold)";
    ok.addEventListener("click", async () => {
      ok.disabled = true;
      const r = await call({ message: "", lang, confirm: { digest: p.digest, draft } });
      if (r?.handoff && r.handoff.mailto.startsWith("mailto:")) {
        const a = document.createElement("a");
        a.href = r.handoff.mailto; a.textContent = copy.openMail;
        a.className = "label-tracked inline-flex min-h-11 items-center border border-(--color-gold) px-5 py-3 text-(--color-gold) hover:bg-(--color-gold) hover:text-(--color-ink)";
        actions.replaceChildren(a); a.focus();
        status.textContent = r.reply;
      } else { ok.disabled = false; status.textContent = r?.reply ?? copy.error; }
    });
    no.addEventListener("click", () => { proposalBox.classList.add("hidden"); status.textContent = copy.proposalCancelled; input.focus(); });
    actions.append(ok, no);
    proposalBox.append(title, summary, preview, actions);
    proposalBox.classList.remove("hidden");
  }

  form.addEventListener("submit", (e) => { e.preventDefault(); void ask(input.value); });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void ask(input.value); } });
  suggestionsBox.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-suggestion]");
    if (b?.dataset.suggestion) void ask(b.dataset.suggestion);
  });

  // ── Project Builder ──
  const bForm = $<HTMLFormElement>("builder-form"), bOut = $<HTMLTextAreaElement>("builder-output"), bResult = $("builder-result");
  const bStatus = $("builder-status"), bError = $("b-error");
  const fieldsOf = () => {
    const d = new FormData(bForm);
    const g = (k: string) => String(d.get(k) ?? "");
    const kind = (PROJECT_KINDS as readonly string[]).includes(g("kind")) ? (g("kind") as ProjectKind) : "other";
    return { kind, goal: g("goal"), audience: g("audience"), timeline: g("timeline"), budget: g("budget"), location: g("location"), notes: g("notes") };
  };
  bForm.addEventListener("input", () => { if (consent.checked) store.set(BUILDER_KEY, JSON.stringify(fieldsOf())); });
  if (consent.checked) {
    try {
      const saved = JSON.parse(store.get(BUILDER_KEY) ?? "null") as Record<string, string> | null;
      if (saved) for (const [k, v] of Object.entries(saved)) { const el = bForm.elements.namedItem(k) as HTMLInputElement | null; if (el && typeof v === "string") el.value = v; }
    } catch { store.del(BUILDER_KEY); }
  }
  bForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const built = buildBrief(fieldsOf(), lang);
    if (!built.ok) { bError.textContent = copy.errorGoal; $("b-goal").focus(); return; }
    bError.textContent = ""; bOut.value = built.text; bResult.classList.remove("hidden"); bOut.focus();
  });
  $("builder-copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(bOut.value); bStatus.textContent = copy.copied; } catch { bOut.select(); }
  });
  $("builder-send").addEventListener("click", async () => {
    const r = await call({ message: "", lang, proposeDraft: bOut.value });
    if (r?.proposal) { selectTab(tabs[0]); bubble("malya", r.reply); showProposal(r.proposal, bOut.value); proposalBox.scrollIntoView({ block: "nearest" }); }
    else bStatus.textContent = r?.reply ?? copy.error;
  });

  // Suggestions contextuelles : la page d'origine ajuste les propositions initiales.
  const hints = from ? (JSON.parse(root.dataset.hints ?? "{}") as Record<string, string[]>)[from] : undefined;
  if (hints) setSuggestions(hints);
  restore();
}
