/**
 * Noyau de conversation MALYA — partagé par la page /malya/ et par le lanceur présent sur toutes les pages.
 *  - tout texte venu du serveur est inséré via textContent (rendu riche sûr, jamais de HTML interprété) ;
 *  - la mémoire locale n'existe qu'avec consentement, expire, est séparée par conversation et s'efface en un clic ;
 *  - aucune action n'est exécutée sans clic de confirmation ;
 *  - aucun appel réseau au chargement : le premier appel suit une action de l'utilisateur.
 */
import {
  appendTurn, deleteConversation, emptyStore, normalizeConsent, pruneStore, startConversation,
  type ConversationStore, type StoredTurn,
} from "../../functions/lib/malya/consent";
import { renderRich } from "../lib/malya-rich";
import { SILHOUETTE_FULL } from "../lib/malya-silhouette";

export type Reliability = "verified" | "historical" | "estimate" | "hypothesis";
export interface Citation { id: string; title: string; source: string; url?: string; verifiedAt: string; reliability: Reliability; ref?: string; outdated?: boolean }
export interface Proposal { digest: string; summary: string; recipient: string; category: string }
export interface Reply {
  reply: string; citations: Citation[]; verification: "verified" | "mixed" | "unverified" | "none";
  suggestions: string[]; proposal?: Proposal; handoff?: { mailto: string }; blocked?: string;
  mode?: "ai" | "documentary"; modeReason?: string; modeCode?: string;
}

export interface Els {
  log: HTMLElement; form: HTMLFormElement; input: HTMLTextAreaElement; send: HTMLButtonElement;
  /** Ligne d'aide sous la saisie (aria-live) : consignes d'envoi et confirmations brèves. */
  status: HTMLElement; proposalBox: HTMLElement; suggestionsBox: HTMLElement; consent: HTMLInputElement;
  clear: HTMLElement; newConv: HTMLElement;
  /** Ligne d'état de l'en-tête (disponibilité + mode) : contient un point et un texte. */
  modeBadge: HTMLElement; convSelect: HTMLSelectElement;
  /** Zone d'avis (erreur, quota, mode documentaire, arrêt d'urgence). */
  notice: HTMLElement;
}

export interface Copy {
  sending: string; suspended: string; rateLimited: string; error: string; offline: string; cleared: string;
  proposalCancelled: string; reliability: Record<Reliability, string>; verification: Record<string, string>;
  sources: string; you: string; malya: string; proposalTitle: string; proposalConfirm: string; proposalCancel: string;
  openMail: string; modeAi: string; modeDoc: string; outdated: string; conversationLabel: string; newConversationDone: string;
  welcomeTitle: string; welcomeText: string; typing: string; hintSend: string; statusAi: string; statusDoc: string; statusStop: string; statusOff: string;
  noticeQuota: string; noticeEmergency: string; noticeDoc: string;
}

const KEY = "malya.conv.v2", CONSENT_KEY = "malya.consent.v1";

export const storage = {
  get(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* stockage indisponible : la page fonctionne sans */ } },
  del(k: string) { try { localStorage.removeItem(k); } catch { /* idem */ } },
};

const uid = () => (crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : String(Date.now()));
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

export class ChatController {
  private store: ConversationStore;
  private busy = false;
  private typingEl: HTMLElement | null = null;
  constructor(private els: Els, private copy: Copy, private lang: "fr" | "en", private from?: string) {
    this.store = emptyStore(uid(), Date.now());
    this.restore();
    this.showHint();
    els.form.addEventListener("submit", (e) => { e.preventDefault(); void this.ask(els.input.value); });
    els.input.addEventListener("input", () => this.autosize());
    els.input.addEventListener("keydown", (e) => {
      // Entrée envoie sur ordinateur ; sur écran tactile elle passe à la ligne (le bouton envoie).
      const fine = typeof matchMedia === "function" && matchMedia("(pointer: fine)").matches;
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing && (fine || e.ctrlKey || e.metaKey)) { e.preventDefault(); void this.ask(els.input.value); }
    });
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

  /** Mode d'exécution connu : lu à la demande, jamais au chargement des pages du site. */
  async refreshMode(): Promise<void> {
    try {
      const r = await fetch("/api/malya/status", { credentials: "same-origin" });
      if (r.status === 503) { this.setStatus("off"); return; }
      const j = (await r.json()) as { mode?: string; reason?: string };
      if (j.mode === "ai") { this.setStatus("ai"); return; }
      this.setStatus(j.reason === "emergency_stop" ? "stop" : "doc");
      this.noticeFor(j.reason);
    } catch { /* l'état sera connu à la première réponse */ }
  }

  private setStatus(kind: "ai" | "doc" | "stop" | "off") {
    const text = kind === "ai" ? this.copy.statusAi : kind === "doc" ? this.copy.statusDoc : kind === "stop" ? this.copy.statusStop : this.copy.statusOff;
    this.els.modeBadge.dataset.mode = kind === "ai" ? "ai" : "doc";
    let span = this.els.modeBadge.querySelector<HTMLElement>("[data-status-text]");
    if (!span) { span = el("span"); span.dataset.statusText = ""; this.els.modeBadge.append(span); }
    span.textContent = text;
  }

  private noticeFor(code?: string) {
    if (code === "emergency_stop") this.setNotice("emergency", this.copy.noticeEmergency);
    else if (code === "quota_exhausted" || code === "budget_exhausted" || code === "budget_suspended") this.setNotice("quota", this.copy.noticeQuota);
    else if (code) this.setNotice("documentary", this.copy.noticeDoc);
    else this.setNotice(null);
  }

  private setNotice(kind: "error" | "quota" | "documentary" | "emergency" | null, text = "") {
    const n = this.els.notice;
    if (!kind) { n.hidden = true; n.textContent = ""; return; }
    n.hidden = false; n.dataset.kind = kind; n.textContent = text;
  }

  private showHint() {
    const fine = typeof matchMedia === "function" && matchMedia("(pointer: fine)").matches;
    this.els.status.textContent = fine ? this.copy.hintSend : "";
  }

  private autosize() {
    const t = this.els.input;
    t.style.height = "auto";
    t.style.height = Math.min(t.scrollHeight, 144) + "px";
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

  /** Accueil éditorial : silhouette, salutation et invitation ; il disparaît dès le premier échange. */
  private welcome(): HTMLElement {
    const w = el("div", "mly-welcome");
    w.dataset.welcome = "";
    const fig = el("div", "mly-figwrap");
    fig.innerHTML = SILHOUETTE_FULL; // constante interne au dépôt, jamais du texte venant d'un utilisateur ou du modèle
    const txt = el("div");
    txt.append(el("h3", "", this.copy.welcomeTitle), el("p", "", this.copy.welcomeText));
    w.append(fig, txt);
    return w;
  }

  private renderConversation() {
    this.els.log.replaceChildren();
    const turns = this.active().turns;
    if (turns.length === 0) { this.els.log.append(this.welcome()); this.els.suggestionsBox.hidden = false; return; }
    for (const t of turns) this.bubble(t.role === "user" ? "you" : "malya", t.content);
  }

  private switchTo(id: string) {
    if (!this.store.items.some((c) => c.id === id)) return;
    this.store = { ...this.store, active: id };
    this.els.proposalBox.hidden = true;
    this.renderConversation();
    this.persist();
  }

  newConversation() {
    this.store = startConversation(this.store, uid(), Date.now());
    this.els.proposalBox.hidden = true;
    this.renderConversation();
    this.renderSelect();
    this.persist();
    this.els.status.textContent = this.copy.newConversationDone;
    this.els.input.focus();
  }

  private clearAll() {
    storage.del(KEY); storage.del("malya.builder.v1");
    this.store = emptyStore(uid(), Date.now());
    this.els.proposalBox.hidden = true;
    this.renderConversation();
    this.renderSelect();
    this.els.status.textContent = this.copy.cleared;
  }

  /** Suppression de la conversation active seule (la mémoire des autres reste intacte). */
  deleteActive() {
    this.store = deleteConversation(this.store, this.store.active, uid(), Date.now());
    this.renderConversation(); this.renderSelect(); this.persist();
  }

  bubble(who: "you" | "malya", text: string, extra?: HTMLElement): HTMLElement {
    this.els.log.querySelector("[data-welcome]")?.remove();
    const wrap = el("div", `mly-msg ${who === "malya" ? "mly-msg--bot" : "mly-msg--me"}`);
    wrap.append(el("p", "mly-msg__label", who === "malya" ? this.copy.malya : this.copy.you));
    const card = el("div", "mly-msg__card");
    if (who === "malya") renderRich(card, text); else card.append(el("p", "", text));
    wrap.append(card);
    if (extra) wrap.append(extra);
    this.els.log.append(wrap);
    // Une longue réponse s'ouvre à son début ; un message de l'utilisateur ou l'attente restent calés en bas.
    this.els.log.scrollTop = who === "malya" ? Math.max(0, wrap.offsetTop - this.els.log.offsetTop - 8) : this.els.log.scrollHeight;
    return wrap;
  }

  private showTyping() {
    this.els.log.querySelector("[data-welcome]")?.remove();
    const wrap = el("div", "mly-msg mly-msg--bot");
    wrap.setAttribute("role", "status");
    const t = el("div", "mly-typing");
    t.append(el("i"), el("i"), el("i"), el("span", "", this.copy.typing));
    wrap.append(t);
    this.els.log.append(wrap);
    this.els.log.scrollTop = this.els.log.scrollHeight;
    this.typingEl = wrap;
  }

  private hideTyping() { this.typingEl?.remove(); this.typingEl = null; }

  private sourcesBlock(r: Reply): HTMLElement | undefined {
    if (r.citations.length === 0 && r.verification === "none") return undefined;
    const box = el("div", "mly-sources");
    box.append(el("p", "", this.copy.verification[r.verification] ?? ""));
    if (r.citations.length) {
      const details = el("details");
      details.append(el("summary", "", `${this.copy.sources} (${r.citations.length})`));
      const ul = el("ul");
      for (const c of r.citations) {
        const li = el("li");
        li.append(el("span", "mly-pill", `${c.ref ? `[${c.ref}] ` : ""}${this.copy.reliability[c.reliability]}${c.outdated ? " · " + this.copy.outdated : ""}`));
        li.append(document.createTextNode(`${c.title} — ${c.source} · ${c.verifiedAt}`));
        if (c.url && /^https:\/\//.test(c.url)) {
          const a = el("a", "", " ↗");
          a.href = c.url; a.rel = "noopener noreferrer"; a.target = "_blank"; a.setAttribute("aria-label", c.source);
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
    this.els.suggestionsBox.replaceChildren(...items.map((s) => {
      const b = el("button", "mly-chip", s);
      b.type = "button"; b.dataset.suggestion = s;
      return b;
    }));
  }

  async call(body: Record<string, unknown>): Promise<Reply | null> {
    try {
      const res = await fetch("/api/malya/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      if (res.status === 503) { this.setNotice("error", this.copy.suspended); this.setStatus("off"); return null; }
      if (res.status === 429) { this.setNotice("quota", this.copy.rateLimited); return null; }
      if (!res.ok) { this.setNotice("error", this.copy.error); return null; }
      return (await res.json()) as Reply;
    } catch {
      this.setNotice("error", this.copy.offline);
      return null;
    }
  }

  /** Ouverture du Project Builder depuis une suggestion (gérée par la page ou par le lanceur). */
  onOpenBuilder: (() => void) | undefined;

  async ask(message: string) {
    const text = message.trim();
    if (!text || this.busy) return;
    if (/^(ouvrir le project builder|open the project builder)$/i.test(text)) { this.onOpenBuilder?.(); return; }
    this.busy = true;
    this.setNotice(null);
    this.bubble("you", text);
    const conv = this.active();
    const history = conv.turns.slice(-13).map(({ role, content }) => ({ role, content }));
    this.store = appendTurn(this.store, { role: "user", content: text, at: Date.now() });
    this.els.input.value = ""; this.autosize();
    this.els.send.disabled = true; this.els.proposalBox.hidden = true; this.els.suggestionsBox.hidden = true;
    this.showTyping();
    const r = await this.call({ message: text, history, lang: this.lang, from: this.from, consent: { memory: this.consentGiven } });
    this.hideTyping();
    this.els.send.disabled = false; this.busy = false;
    if (!r) { this.dropLastUser(); this.els.suggestionsBox.hidden = false; return; }
    this.bubble("malya", r.reply, this.sourcesBlock(r));
    if (r.mode === "ai") { this.setStatus("ai"); this.setNotice(null); }
    else if (r.mode === "documentary") { this.setStatus(r.modeCode === "emergency_stop" ? "stop" : "doc"); this.noticeFor(r.modeCode); }
    if (r.blocked) this.dropLastUser();
    else { this.store = appendTurn(this.store, { role: "assistant", content: r.reply, at: Date.now() }); this.persist(); this.renderSelect(); }
    this.setSuggestions(r.suggestions ?? []);
    this.els.suggestionsBox.hidden = false;
    if (r.proposal) this.showProposal(r.proposal, text);
    this.els.input.focus();
  }

  private dropLastUser() {
    this.store = { ...this.store, items: this.store.items.map((c) => (c.id === this.store.active ? { ...c, turns: c.turns.slice(0, -1) } : c)) };
  }

  showProposal(p: Proposal, draft: string) {
    const box = this.els.proposalBox;
    box.replaceChildren();
    const title = el("p", "mly-proposal__title", `${this.copy.proposalTitle} · ${p.category}`);
    title.id = box.id + "-title";
    box.setAttribute("aria-labelledby", title.id);
    const draftEl = el("p", "mly-draft", draft);
    const actions = el("div", "mly-actions");
    const ok = el("button", "mly-btn", this.copy.proposalConfirm); ok.type = "button";
    const no = el("button", "mly-btn mly-btn--ghost", this.copy.proposalCancel); no.type = "button";
    ok.addEventListener("click", async () => {
      ok.disabled = true;
      const r = await this.call({ message: "", lang: this.lang, confirm: { digest: p.digest, draft, category: p.category } });
      if (r?.handoff && r.handoff.mailto.startsWith("mailto:")) {
        const a = el("a", "mly-btn", this.copy.openMail);
        a.href = r.handoff.mailto; a.style.textDecoration = "none";
        actions.replaceChildren(a); a.focus();
        this.els.status.textContent = r.reply;
      } else { ok.disabled = false; this.els.status.textContent = r?.reply ?? this.copy.error; }
    });
    no.addEventListener("click", () => { box.hidden = true; this.els.status.textContent = this.copy.proposalCancelled; this.els.input.focus(); });
    actions.append(ok, no);
    box.append(title, el("p", "", p.summary), draftEl, actions);
    box.hidden = false;
  }
}

function parse(raw: string | null): unknown {
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

export type { StoredTurn };
