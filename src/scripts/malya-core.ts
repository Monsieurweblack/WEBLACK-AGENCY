/**
 * Noyau de conversation MALYA — partagé par la page /malya/ et par le lanceur
 * présent sur toutes les pages. Règles :
 *  - tout texte venu du serveur est inséré via textContent (jamais innerHTML) ;
 *  - la mémoire locale n'existe qu'avec consentement, expire, est séparée par
 *    conversation et s'efface en un clic ; rien n'est envoyé au serveur pour
 *    être conservé ;
 *  - aucune action n'est exécutée sans clic de confirmation ;
 *  - aucun appel réseau au chargement : le premier appel suit une action de l'utilisateur.
 */
import {
  appendTurn, deleteConversation, emptyStore, normalizeConsent, pruneStore, startConversation,
  type ConversationStore, type StoredTurn,
} from "../../functions/lib/malya/consent";

export type Reliability = "verified" | "historical" | "estimate" | "hypothesis";
export interface Citation { id: string; title: string; source: string; url?: string; verifiedAt: string; reliability: Reliability; ref?: string; outdated?: boolean }
export interface Proposal { digest: string; summary: string; recipient: string; category: string }
export interface Reply {
  reply: string; citations: Citation[]; verification: "verified" | "mixed" | "unverified" | "none";
  suggestions: string[]; proposal?: Proposal; handoff?: { mailto: string }; blocked?: string;
  mode?: "ai" | "documentary"; modeReason?: string;
}

export interface Els {
  log: HTMLElement; form: HTMLFormElement; input: HTMLTextAreaElement; send: HTMLButtonElement;
  status: HTMLElement; proposalBox: HTMLElement; suggestionsBox: HTMLElement; consent: HTMLInputElement;
  clear: HTMLElement; newConv: HTMLElement; modeBadge: HTMLElement; convSelect: HTMLSelectElement;
}

export interface Copy {
  sending: string; suspended: string; rateLimited: string; error: string; offline: string; cleared: string;
  proposalCancelled: string; reliability: Record<Reliability, string>; verification: Record<string, string>;
  sources: string; you: string; malya: string; proposalTitle: string; proposalConfirm: string; proposalCancel: string;
  openMail: string; modeAi: string; modeDoc: string; outdated: string; conversationLabel: string; newConversationDone: string;
}

const KEY = "malya.conv.v2", CONSENT_KEY = "malya.consent.v1";

export const storage = {
  get(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* stockage indisponible : la page fonctionne sans */ } },
  del(k: string) { try { localStorage.removeItem(k); } catch { /* idem */ } },
};

const uid = () => (crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : String(Date.now()));

export class ChatController {
  private store: ConversationStore;
  private busy = false;
  constructor(private els: Els, private copy: Copy, private lang: "fr" | "en", private from?: string) {
    this.store = emptyStore(uid(), Date.now());
    this.restore();
    els.form.addEventListener("submit", (e) => { e.preventDefault(); void this.ask(els.input.value); });
    els.input.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void this.ask(els.input.value); } });
    els.suggestionsBox.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-suggestion]");
      if (b?.dataset.suggestion) void this.ask(b.dataset.suggestion);
    });
    els.consent.addEventListener("change", () => {
      storage.set(CONSENT_KEY, JSON.stringify({ memory: els.consent.checked }));
      if (els.consent.checked) this.persist(); else { storage.del(KEY); storage.del("malya.builder.v1"); }
      this.renderSelect();
    });
    els.clear.addEventListener("click", () => this.clearAll());
    els.newConv.addEventListener("click", () => this.newConversation());
    els.convSelect.addEventListener("change", () => this.switchTo(els.convSelect.value));
  }

  get consentGiven(): boolean { return this.els.consent.checked; }
  /** Mode d'exécution connu : lu à la demande, jamais au chargement de la page. */
  async refreshMode(): Promise<void> {
    try {
      const r = await fetch("/api/malya/status", { credentials: "same-origin" });
      if (r.status === 503) { this.els.modeBadge.textContent = this.copy.suspended; return; }
      const j = (await r.json()) as { mode?: string; message?: Record<string, string> };
      this.setMode(j.mode === "ai" ? "ai" : "documentary", j.message?.[this.lang]);
    } catch { /* l'état sera connu à la première réponse */ }
  }

  private setMode(mode: "ai" | "documentary", reason?: string) {
    this.els.modeBadge.textContent = mode === "ai" ? this.copy.modeAi : this.copy.modeDoc + (reason ? " — " + reason : "");
    this.els.modeBadge.dataset.mode = mode;
  }

  private active() { return this.store.items.find((c) => c.id === this.store.active)!; }

  private restore() {
    this.els.consent.checked = normalizeConsent(parse(storage.get(CONSENT_KEY))).memory;
    if (this.els.consent.checked) {
      const saved = parse(storage.get(KEY)) as ConversationStore | null;
      if (saved && Array.isArray(saved.items) && saved.items.length) this.store = pruneStore(saved, Date.now());
      if (!this.store.items.some((c) => c.id === this.store.active)) this.store = emptyStore(uid(), Date.now());
    }
    this.renderConversation();
    this.renderSelect();
  }

  private persist() {
    if (!this.els.consent.checked) return;
    storage.set(KEY, JSON.stringify(pruneStore(this.store, Date.now())));
  }

  private renderSelect() {
    const sel = this.els.convSelect;
    sel.replaceChildren(...this.store.items.map((c, i) => {
      const o = document.createElement("option");
      o.value = c.id;
      const first = c.turns.find((t) => t.role === "user")?.content ?? "";
      o.textContent = `${this.copy.conversationLabel} ${i + 1}${first ? " — " + first.slice(0, 28) : ""}`;
      return o;
    }));
    sel.value = this.store.active;
    sel.hidden = this.store.items.length < 2;
  }

  private renderConversation() {
    this.els.log.replaceChildren();
    for (const t of this.active().turns) this.bubble(t.role === "user" ? "you" : "malya", t.content);
  }

  private switchTo(id: string) {
    if (!this.store.items.some((c) => c.id === id)) return;
    this.store = { ...this.store, active: id };
    this.els.proposalBox.classList.add("hidden");
    this.renderConversation();
    this.persist();
  }

  newConversation() {
    this.store = startConversation(this.store, uid(), Date.now());
    this.els.proposalBox.classList.add("hidden");
    this.renderConversation();
    this.renderSelect();
    this.persist();
    this.els.status.textContent = this.copy.newConversationDone;
    this.els.input.focus();
  }

  private clearAll() {
    storage.del(KEY); storage.del("malya.builder.v1");
    this.store = emptyStore(uid(), Date.now());
    this.els.log.replaceChildren();
    this.els.proposalBox.classList.add("hidden");
    this.renderSelect();
    this.els.status.textContent = this.copy.cleared;
  }

  /** Suppression de la conversation active seule (la mémoire des autres reste intacte). */
  deleteActive() {
    this.store = deleteConversation(this.store, this.store.active, uid(), Date.now());
    this.renderConversation(); this.renderSelect(); this.persist();
  }

  bubble(who: "you" | "malya", text: string, extra?: HTMLElement): HTMLElement {
    const wrap = document.createElement("div");
    const label = document.createElement("p");
    label.className = "label-tracked " + (who === "malya" ? "text-(--color-gold)" : "text-(--color-paper)/60");
    label.textContent = who === "malya" ? this.copy.malya : this.copy.you;
    wrap.append(label);
    for (const para of text.split(/\n{2,}/)) {
      const p = document.createElement("p");
      p.className = "mt-2 whitespace-pre-line " + (who === "malya" ? "text-(--color-paper)" : "text-(--color-paper)/80");
      p.textContent = para;
      wrap.append(p);
    }
    if (extra) wrap.append(extra);
    this.els.log.append(wrap);
    this.els.log.scrollTop = this.els.log.scrollHeight;
    return wrap;
  }

  private sourcesBlock(r: Reply): HTMLElement | undefined {
    if (r.citations.length === 0 && r.verification === "none") return undefined;
    const box = document.createElement("div");
    box.className = "mt-3 border-l border-(--color-line) pl-4 text-sm text-(--color-paper)/70";
    const v = document.createElement("p");
    v.textContent = this.copy.verification[r.verification] ?? "";
    box.append(v);
    if (r.citations.length) {
      const details = document.createElement("details");
      const sum = document.createElement("summary");
      sum.className = "mt-1 inline-flex min-h-11 cursor-pointer items-center";
      sum.textContent = `${this.copy.sources} (${r.citations.length})`;
      details.append(sum);
      const ul = document.createElement("ul");
      ul.className = "mt-2 space-y-2";
      for (const c of r.citations) {
        const li = document.createElement("li");
        li.textContent = `${c.ref ? `[${c.ref}] ` : ""}${this.copy.reliability[c.reliability]}${c.outdated ? " · " + this.copy.outdated : ""} · ${c.title} — ${c.source} · ${c.verifiedAt}`;
        if (c.url && /^https:\/\//.test(c.url)) {
          const a = document.createElement("a");
          a.href = c.url; a.rel = "noopener noreferrer"; a.target = "_blank";
          a.className = "ml-2 underline underline-offset-4 hover:text-(--color-gold)";
          a.textContent = "↗"; a.setAttribute("aria-label", c.source);
          li.append(a);
        }
        ul.append(li);
      }
      details.append(ul);
      box.append(details);
    }
    return box;
  }

  setSuggestions(items: string[]) {
    if (!items.length) return;
    const cls = this.els.suggestionsBox.querySelector("button")?.className ?? "label-tracked min-h-11 border border-(--color-line) px-5 py-3 text-(--color-paper) hover:border-(--color-gold) hover:text-(--color-gold)";
    this.els.suggestionsBox.replaceChildren(...items.map((s) => {
      const b = document.createElement("button");
      b.type = "button"; b.dataset.suggestion = s; b.textContent = s; b.className = cls;
      return b;
    }));
  }

  async call(body: Record<string, unknown>): Promise<Reply | null> {
    try {
      const res = await fetch("/api/malya/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      if (res.status === 503) { this.els.status.textContent = this.copy.suspended; return null; }
      if (res.status === 429) { this.els.status.textContent = this.copy.rateLimited; return null; }
      if (!res.ok) { this.els.status.textContent = this.copy.error; return null; }
      return (await res.json()) as Reply;
    } catch {
      this.els.status.textContent = this.copy.offline;
      return null;
    }
  }

  /** Sert à l'ouverture du Project Builder depuis une suggestion (géré par la page). */
  onOpenBuilder: (() => void) | undefined;

  async ask(message: string) {
    const text = message.trim();
    if (!text || this.busy) return;
    if (/^(ouvrir le project builder|open the project builder)$/i.test(text)) { this.onOpenBuilder?.(); return; }
    this.busy = true;
    this.bubble("you", text);
    const conv = this.active();
    const history = conv.turns.slice(-13).map(({ role, content }) => ({ role, content }));
    this.store = appendTurn(this.store, { role: "user", content: text, at: Date.now() });
    this.els.input.value = ""; this.els.send.disabled = true; this.els.status.textContent = this.copy.sending; this.els.proposalBox.classList.add("hidden");
    const r = await this.call({ message: text, history, lang: this.lang, from: this.from, consent: { memory: this.consentGiven } });
    this.els.send.disabled = false; this.busy = false;
    if (!r) { this.dropLastUser(); return; }
    this.els.status.textContent = "";
    this.bubble("malya", r.reply, this.sourcesBlock(r));
    if (r.mode) this.setMode(r.mode, r.modeReason);
    if (r.blocked) this.dropLastUser();
    else { this.store = appendTurn(this.store, { role: "assistant", content: r.reply, at: Date.now() }); this.persist(); this.renderSelect(); }
    this.setSuggestions(r.suggestions ?? []);
    if (r.proposal) this.showProposal(r.proposal, text);
    this.els.input.focus();
  }

  private dropLastUser() {
    this.store = { ...this.store, items: this.store.items.map((c) => (c.id === this.store.active ? { ...c, turns: c.turns.slice(0, -1) } : c)) };
  }

  showProposal(p: Proposal, draft: string) {
    const box = this.els.proposalBox;
    box.replaceChildren();
    const title = document.createElement("p");
    title.id = box.id + "-title"; title.className = "label-tracked text-(--color-gold)"; title.textContent = `${this.copy.proposalTitle} · ${p.category}`;
    box.setAttribute("aria-labelledby", title.id);
    const summary = document.createElement("p");
    summary.className = "mt-3 text-(--color-paper)"; summary.textContent = p.summary;
    const preview = document.createElement("p");
    preview.className = "mt-3 whitespace-pre-line border-l border-(--color-line) pl-4 text-sm text-(--color-paper)/70"; preview.textContent = draft;
    const actions = document.createElement("div");
    actions.className = "mt-4 flex flex-wrap gap-3";
    const ok = document.createElement("button"); ok.type = "button"; ok.textContent = this.copy.proposalConfirm;
    ok.className = "label-tracked min-h-11 border border-(--color-gold) px-5 py-3 text-(--color-gold) hover:bg-(--color-gold) hover:text-(--color-ink)";
    const no = document.createElement("button"); no.type = "button"; no.textContent = this.copy.proposalCancel;
    no.className = "label-tracked min-h-11 border border-(--color-line) px-5 py-3 text-(--color-paper) hover:border-(--color-gold)";
    ok.addEventListener("click", async () => {
      ok.disabled = true;
      const r = await this.call({ message: "", lang: this.lang, confirm: { digest: p.digest, draft, category: p.category } });
      if (r?.handoff && r.handoff.mailto.startsWith("mailto:")) {
        const a = document.createElement("a");
        a.href = r.handoff.mailto; a.textContent = this.copy.openMail;
        a.className = "label-tracked inline-flex min-h-11 items-center border border-(--color-gold) px-5 py-3 text-(--color-gold) hover:bg-(--color-gold) hover:text-(--color-ink)";
        actions.replaceChildren(a); a.focus();
        this.els.status.textContent = r.reply;
      } else { ok.disabled = false; this.els.status.textContent = r?.reply ?? this.copy.error; }
    });
    no.addEventListener("click", () => { box.classList.add("hidden"); this.els.status.textContent = this.copy.proposalCancelled; this.els.input.focus(); });
    actions.append(ok, no);
    box.append(title, summary, preview, actions);
    box.classList.remove("hidden");
  }
}

function parse(raw: string | null): unknown {
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

export type { StoredTurn };
