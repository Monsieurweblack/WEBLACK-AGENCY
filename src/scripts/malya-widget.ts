/**
 * Fenêtre MALYA (chargée à la demande, jamais au chargement de la page). Une <dialog> native : piège du focus,
 * fermeture par Échap, arrière-plan inerte et restitution du focus au lanceur sans code supplémentaire.
 * Thème clair (ivoire / crème / champagne) défini dans src/styles/malya.css, importé ici : il n'est donc
 * téléchargé qu'avec la fenêtre.
 */
// ?inline : le CSS est une simple chaîne injectée à l'ouverture — Astro ne l'ajoute donc pas au HTML de chaque page.
import malyaCss from "../styles/malya.css?inline";
import { malyaCopy, clientCopy } from "../lib/malya-copy";
import { SILHOUETTE_FULL } from "../lib/malya-silhouette";
import { ChatController, type Copy } from "./malya-core";

type Lang = "fr" | "en";
let dialog: HTMLDialogElement | null = null;
let controller: ChatController | null = null;

const FROM_PATH: [RegExp, string][] = [[/\/talent(\/|$)/, "talent"], [/\/creative(\/|$)/, "creative"], [/\/consulting(\/|$)/, "consulting"], [/\/opportunities(\/|$)/, "opportunities"], [/\/contact(\/|$)/, "contact"]];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", attrs: Record<string, string> = {}, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}

const SEND_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';

function build(lang: Lang, trigger: HTMLElement): HTMLDialogElement {
  if (!document.getElementById("malya-style")) {
    const st = document.createElement("style");
    st.id = "malya-style";
    st.textContent = malyaCss;
    document.head.append(st);
  }
  const c = malyaCopy(lang);
  const from = FROM_PATH.find(([re]) => re.test(location.pathname))?.[1];
  const d = el("dialog", "mly mly-dialog", { "aria-labelledby": "mw-title" });

  // En-tête : silhouette, prénom, statut de disponibilité et de mode
  const head = el("div", "mly-head");
  const avatar = el("div", "mly-avatar");
  avatar.innerHTML = SILHOUETTE_FULL; // constante du dépôt : jamais du texte d'utilisateur ni du modèle
  const who = el("div", "mly-who");
  const mode = el("p", "mly-status", { id: "mw-mode", role: "status" });
  mode.append(el("span", "mly-dot", { "aria-hidden": "true" }));
  who.append(el("h2", "mly-name", { id: "mw-title" }, "MALYA"), mode);
  const tools = el("div", "mly-tools");
  const full = el("a", "mly-iconbtn", { href: (lang === "en" ? "/en/malya/" : "/malya/") + (from ? `?from=${from}` : ""), "aria-label": c.openFull, title: c.openFull }, "⤢");
  const close = el("button", "mly-iconbtn", { type: "button", "aria-label": c.launcherClose }, "×");
  tools.append(full, close);
  head.append(avatar, who, tools);

  const body = el("div", "mly-body");
  const bar = el("div", "mly-bar");
  const sel = el("select", "mly-select", { "aria-label": c.conversations });
  sel.hidden = true;
  const newBtn = el("button", "mly-link", { type: "button" }, c.newConversation);
  bar.append(sel, newBtn);

  const log = el("div", "mly-log", { role: "log", "aria-live": "polite", "aria-label": c.logLabel, tabindex: "0" });
  const notice = el("p", "mly-notice", { role: "status" });
  notice.hidden = true;
  const proposal = el("div", "mly-proposal", { id: "mw-proposal", role: "group" });
  proposal.hidden = true;
  const sugg = el("div", "mly-chips");
  for (const s of c.suggestions.filter((x) => !/project builder/i.test(x))) sugg.append(el("button", "mly-chip", { type: "button", "data-suggestion": s }, s));

  const form = el("form", "mly-composer", { novalidate: "" });
  const label = el("label", "", { for: "mw-input", style: "position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)" }, c.inputLabel);
  const field = el("div", "mly-field");
  const input = el("textarea", "", { id: "mw-input", rows: "1", maxlength: "2000", placeholder: c.placeholder, required: "" });
  const send = el("button", "mly-send", { type: "submit", "aria-label": c.send });
  send.innerHTML = SEND_ICON;
  field.append(input, send);
  const hint = el("p", "mly-hint", { id: "mw-hint", role: "status" });
  form.append(label, field, hint);

  const foot = el("details", "mly-foot mly-foot--fold");
  foot.append(el("summary", "", {}, c.privacyTitle));
  foot.append(el("p", "", {}, c.aiNotice));
  const consentRow = el("div", "mly-consent");
  const consent = el("input", "", { type: "checkbox", id: "mw-consent", "aria-describedby": "mw-consent-help" });
  const consentText = el("div");
  consentText.append(el("label", "", { for: "mw-consent" }, c.consentLabel), el("p", "", { id: "mw-consent-help" }, c.consentHelp));
  consentRow.append(consent, consentText);
  const clear = el("button", "mly-link", { type: "button" }, c.clear);
  foot.append(consentRow, clear);

  body.append(bar, log, notice, proposal, sugg, form, foot);
  d.append(head, body);
  document.body.append(d);

  controller = new ChatController({
    log, form, input, send, status: hint, proposalBox: proposal, suggestionsBox: sugg, consent, clear, newConv: newBtn, modeBadge: mode, convSelect: sel, notice,
  }, clientCopy(c) as unknown as Copy, lang, from);
  controller.onOpenBuilder = () => { location.href = full.href; };

  close.addEventListener("click", () => d.close());
  d.addEventListener("click", (e) => { if (e.target === d) d.close(); }); // clic sur l'arrière-plan
  d.addEventListener("close", () => trigger.focus());
  return d;
}

export async function openMalya(lang: Lang, trigger: HTMLElement): Promise<void> {
  if (!dialog) dialog = build(lang, trigger);
  if (!dialog.open) dialog.showModal();
  dialog.querySelector<HTMLTextAreaElement>("#mw-input")?.focus();
  await controller?.refreshMode(); // premier appel réseau : après le clic de l'utilisateur
}
