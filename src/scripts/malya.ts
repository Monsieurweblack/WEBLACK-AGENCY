/**
 * Page /malya/ : conversation (noyau partagé) + onglet Project Builder.
 * Le mode d'exécution est lu à l'arrivée sur cette page dédiée (action
 * explicite de l'utilisateur), pas depuis les autres pages du site.
 */
import { buildBrief, PROJECT_KINDS, type ProjectKind } from "../../functions/lib/malya/projectBrief";
import { ChatController, storage, type Copy } from "./malya-core";

const root = document.querySelector<HTMLElement>("[data-malya]");
if (root) init(root);

const KIND_CATEGORY: Record<ProjectKind, string> = { talent: "talent", campaign: "creative", event: "event", "brand-strategy": "consulting", other: "general" };

function init(root: HTMLElement) {
  const lang = root.dataset.lang === "en" ? "en" : "fr";
  const copy = JSON.parse(root.dataset.copy ?? "{}") as Copy & { errorGoal: string; copied: string };
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const from = new URLSearchParams(location.search).get("from") ?? undefined;

  const chat = new ChatController({
    log: $("malya-log"), form: $<HTMLFormElement>("malya-form"), input: $<HTMLTextAreaElement>("malya-input"), send: $<HTMLButtonElement>("malya-send"),
    status: $("malya-status"), proposalBox: $("malya-proposal"), suggestionsBox: $("malya-suggestions"), consent: $<HTMLInputElement>("malya-consent"),
    clear: $("malya-clear"), newConv: $("malya-new"), modeBadge: $("malya-mode"), convSelect: $<HTMLSelectElement>("malya-conv"),
  }, copy, lang, from);
  void chat.refreshMode();

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
  chat.onOpenBuilder = () => selectTab(tabs[1]);

  // ── Project Builder ──
  const bForm = $<HTMLFormElement>("builder-form"), bOut = $<HTMLTextAreaElement>("builder-output"), bResult = $("builder-result");
  const bStatus = $("builder-status"), bError = $("b-error");
  const BUILDER_KEY = "malya.builder.v1";
  const fieldsOf = () => {
    const d = new FormData(bForm);
    const g = (k: string) => String(d.get(k) ?? "");
    const kind = (PROJECT_KINDS as readonly string[]).includes(g("kind")) ? (g("kind") as ProjectKind) : "other";
    return { kind, goal: g("goal"), audience: g("audience"), timeline: g("timeline"), budget: g("budget"), location: g("location"), notes: g("notes") };
  };
  bForm.addEventListener("input", () => { if (chat.consentGiven) storage.set(BUILDER_KEY, JSON.stringify(fieldsOf())); });
  if (chat.consentGiven) {
    try {
      const saved = JSON.parse(storage.get(BUILDER_KEY) ?? "null") as Record<string, string> | null;
      if (saved) for (const [k, v] of Object.entries(saved)) { const el = bForm.elements.namedItem(k) as HTMLInputElement | null; if (el && typeof v === "string") el.value = v; }
    } catch { storage.del(BUILDER_KEY); }
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
    const r = await chat.call({ message: "", lang, proposeDraft: bOut.value, proposeCategory: KIND_CATEGORY[fieldsOf().kind] });
    if (r?.proposal) { selectTab(tabs[0]); chat.bubble("malya", r.reply); chat.showProposal(r.proposal, bOut.value); $("malya-proposal").scrollIntoView({ block: "nearest" }); }
    else bStatus.textContent = r?.reply ?? copy.error;
  });

  // Suggestions contextuelles : la page d'origine ajuste les propositions initiales.
  const hints = from ? (JSON.parse(root.dataset.hints ?? "{}") as Record<string, string[]>)[from] : undefined;
  if (hints) chat.setSuggestions(hints);
}
