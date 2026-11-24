/**
 * Fenêtre MALYA (chargée à la demande, jamais au chargement de la page).
 * Une <dialog> native : piège du focus, fermeture par Échap, arrière-plan inerte
 * et restitution du focus au lanceur sans code supplémentaire.
 */
import { malyaCopy, clientCopy } from "../lib/malya-copy";
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

function build(lang: Lang, trigger: HTMLElement): HTMLDialogElement {
  const c = malyaCopy(lang);
  const from = FROM_PATH.find(([re]) => re.test(location.pathname))?.[1];
  const d = el("dialog", "m-0 flex h-dvh max-h-none w-full max-w-none flex-col overflow-hidden border border-(--color-line) bg-(--color-ink) p-0 text-(--color-paper) backdrop:bg-black/60 sm:mb-4 sm:ml-auto sm:mr-4 sm:mt-auto sm:h-[min(42rem,calc(100dvh-2rem))] sm:w-[26rem]", { "aria-labelledby": "mw-title" });

  const head = el("div", "flex items-center justify-between gap-3 border-b border-(--color-line) px-5 py-3");
  const title = el("h2", "font-display text-xl", { id: "mw-title" }, "MALYA");
  const tools = el("div", "flex items-center gap-1");
  const full = el("a", "inline-flex min-h-11 items-center px-3 text-sm underline underline-offset-4 hover:text-(--color-gold)", { href: (lang === "en" ? "/en/malya/" : "/malya/") + (from ? `?from=${from}` : "") }, c.openFull);
  const close = el("button", "inline-flex min-h-11 min-w-11 items-center justify-center text-xl hover:text-(--color-gold)", { type: "button", "aria-label": c.launcherClose }, "×");
  tools.append(full, close);
  head.append(title, tools);

  const body = el("div", "flex min-h-0 flex-1 flex-col px-5 pt-3");
  const bar = el("div", "mb-3 flex flex-wrap items-center gap-2");
  const mode = el("p", "w-full text-xs text-(--color-paper)/70", { role: "status", id: "mw-mode" });
  const sel = el("select", "min-h-11 max-w-full border border-(--color-line) bg-(--color-ink) px-2 text-sm text-(--color-paper)", { "aria-label": c.conversations });
  sel.hidden = true;
  const newBtn = el("button", "min-h-11 text-sm underline underline-offset-4 text-(--color-paper)/70 hover:text-(--color-gold)", { type: "button" }, c.newConversation);
  bar.append(mode, sel, newBtn);

  const log = el("div", "min-h-0 flex-1 space-y-5 overflow-y-auto pr-1 text-sm", { role: "log", "aria-live": "polite", "aria-label": c.logLabel, tabindex: "0" });
  const proposal = el("div", "mt-3 hidden border border-(--color-gold) p-4 text-sm", { id: "mw-proposal", role: "group" });
  const sugg = el("div", "mt-3 flex flex-wrap gap-2");
  for (const s of c.suggestions.filter((x) => !/project builder/i.test(x))) sugg.append(el("button", "label-tracked min-h-11 border border-(--color-line) px-3 py-2 text-left text-xs hover:border-(--color-gold) hover:text-(--color-gold)", { type: "button", "data-suggestion": s }, s));

  const form = el("form", "mt-3", { novalidate: "" });
  const label = el("label", "sr-only", { for: "mw-input" }, c.inputLabel);
  const input = el("textarea", "w-full border border-(--color-line) bg-transparent px-3 py-2 text-(--color-paper) placeholder:text-(--color-paper)/50 focus:border-(--color-gold)", { id: "mw-input", rows: "2", maxlength: "2000", placeholder: c.placeholder, required: "" });
  const row = el("div", "mt-2 flex items-center gap-3");
  const send = el("button", "label-tracked min-h-11 border border-(--color-gold) px-5 py-2 text-(--color-gold) hover:bg-(--color-gold) hover:text-(--color-ink) disabled:opacity-50", { type: "submit" }, c.send);
  const status = el("p", "text-xs text-(--color-paper)/70", { role: "status" });
  row.append(send, status);
  form.append(label, input, row);

  const foot = el("div", "mt-2 space-y-2 border-t border-(--color-line) py-3 text-xs text-(--color-paper)/70");
  foot.append(el("p", "", {}, c.aiNotice));
  const consentRow = el("div", "flex items-start gap-2");
  const consent = el("input", "mt-0.5 h-6 w-6 shrink-0 accent-(--color-gold)", { type: "checkbox", id: "mw-consent", "aria-describedby": "mw-consent-help" });
  const consentText = el("div");
  consentText.append(el("label", "text-(--color-paper)", { for: "mw-consent" }, c.consentLabel), el("p", "mt-1", { id: "mw-consent-help" }, c.consentHelp));
  consentRow.append(consent, consentText);
  const clear = el("button", "inline-flex min-h-11 items-center underline underline-offset-4 hover:text-(--color-gold)", { type: "button" }, c.clear);
  foot.append(consentRow, clear);

  body.append(bar, log, proposal, sugg, form, foot);
  d.append(head, body);
  document.body.append(d);

  controller = new ChatController({
    log, form, input, send, status, proposalBox: proposal, suggestionsBox: sugg, consent, clear, newConv: newBtn, modeBadge: mode, convSelect: sel,
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
