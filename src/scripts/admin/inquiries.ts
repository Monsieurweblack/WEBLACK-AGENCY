/**
 * Pipeline commercial — administration des demandes du brief. Tout le texte
 * venu des visiteurs est inséré via textContent, jamais en HTML.
 */
import { INQUIRY_STATUSES } from "../../../functions/lib/inquiryOptions.ts";
import { INQUIRY_COPY } from "../../lib/inquiry-copy";

const STATUS_LABELS: Record<string, string> = {
  NEW: "Nouveau",
  TO_QUALIFY: "À qualifier",
  QUALIFIED: "Qualifié",
  CONTACTED: "Contacté",
  REPLIED: "A répondu",
  MEETING: "Rendez-vous",
  PROPOSAL_SENT: "Proposition envoyée",
  NEGOTIATION: "Négociation",
  WON: "Gagné",
  LOST: "Perdu",
  FOLLOW_UP: "À relancer plus tard",
};
const NOTIFY_LABELS: Record<string, string> = {
  pending: "notification en attente",
  sent: "équipe notifiée par e-mail",
  failed: "notification en échec",
  not_configured: "e-mail non configuré sur cet environnement",
};
const copy = INQUIRY_COPY.fr;
const divisionLabel = (d: string) => copy.divisions[d as keyof typeof copy.divisions] ?? d;
const regionNames = new Intl.DisplayNames(["fr"], { type: "region" });
const countryName = (code: string) => {
  try {
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
};
const date = (iso: string) => new Date(iso).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });

interface ListItem {
  id: string;
  reference: string;
  created_at: string;
  status: string;
  division: string;
  service: string;
  full_name: string;
  organisation: string | null;
  country: string;
  channel: string;
  entry_point: string | null;
  notify_status: string;
  next_action: string | null;
  next_action_at: string | null;
  estimated_value: number | null;
  sector: string | null;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

let initialized = false;

export function initAdminInquiries() {
  if (initialized) return;
  initialized = true;

  const loginForm = document.getElementById("login-form") as HTMLFormElement;
  const loginStatus = document.getElementById("login-status")!;
  const dashboard = document.getElementById("dashboard")!;
  const filters = document.getElementById("status-filters")!;
  const listMeta = document.getElementById("list-meta")!;
  const listView = document.getElementById("list-view")!;
  const tbody = document.getElementById("inquiries-list")!;
  const listEmpty = document.getElementById("list-empty")!;
  const detailView = document.getElementById("detail-view")!;
  const detailContent = document.getElementById("detail-content")!;

  let activeStatus = "";
  let counts: Record<string, number> = {};

  const showLogin = () => {
    loginForm.hidden = false;
    dashboard.hidden = true;
  };
  const showDashboard = () => {
    loginForm.hidden = true;
    dashboard.hidden = false;
    void loadList();
  };

  function renderFilters() {
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    filters.replaceChildren(
      ...[{ value: "", label: `Toutes (${total})` }, ...INQUIRY_STATUSES.map((s) => ({ value: s, label: `${STATUS_LABELS[s]} (${counts[s] ?? 0})` }))].map(({ value, label }) => {
        const b = el("button", "label-tracked min-h-10 border px-3 py-2", label);
        b.type = "button";
        b.className += value === activeStatus ? " border-(--color-gold) text-(--color-gold)" : " border-(--color-line) text-(--color-paper)/60 hover:text-(--color-paper)";
        b.setAttribute("aria-pressed", String(value === activeStatus));
        b.addEventListener("click", () => {
          activeStatus = value;
          void loadList();
        });
        return b;
      }),
    );
  }

  async function loadList() {
    const response = await fetch(`/api/admin/inquiries${activeStatus ? `?status=${activeStatus}` : ""}`);
    if (response.status === 401) return showLogin();
    if (!response.ok) {
      listMeta.textContent = "Liste indisponible (base non configurée sur cet environnement ?).";
      return;
    }
    const data = (await response.json()) as { inquiries: ListItem[]; counts: { status: string; count: number }[]; purged: number; unnotified: number };
    counts = Object.fromEntries(data.counts.map((c) => [c.status, c.count]));
    renderFilters();
    listMeta.textContent = [
      data.unnotified ? `${data.unnotified} demande(s) sans notification e-mail envoyée — ouvrez-les pour relancer ; elles sont bien enregistrées ci-dessous.` : "",
      data.purged ? `${data.purged} demande(s) supprimée(s) au terme de la durée de conservation (3 ans).` : "",
    ]
      .filter(Boolean)
      .join(" ");
    tbody.replaceChildren(
      ...data.inquiries.map((row) => {
        const tr = el("tr", "cursor-pointer hover:bg-(--color-ink-soft)");
        const ref = el("td", "py-3 pr-4 font-semibold text-(--color-gold)");
        const open = el("button", "underline-offset-4 hover:underline", row.reference);
        open.type = "button";
        ref.append(open);
        tr.append(
          ref,
          el("td", "py-3 pr-4 text-(--color-paper)/70", date(row.created_at)),
          el("td", "py-3 pr-4", divisionLabel(row.division)),
          el("td", "py-3 pr-4", [row.full_name, row.organisation].filter(Boolean).join(" · ")),
          el("td", "py-3 pr-4 text-(--color-paper)/60", [row.channel, row.entry_point].filter(Boolean).join(" · ")),
          el(
            "td",
            `py-3 pr-4 ${row.next_action_at && row.next_action_at <= new Date().toISOString().slice(0, 10) && !["WON", "LOST"].includes(row.status) ? "text-(--color-gold)" : ""}`,
            [STATUS_LABELS[row.status] ?? row.status, row.next_action_at ? `· action ${row.next_action_at}` : ""].filter(Boolean).join(" "),
          ),
          el("td", `py-3 pr-4 ${row.notify_status === "sent" ? "text-(--color-paper)/40" : "text-red-300"}`, row.notify_status === "sent" ? "notifiée" : (NOTIFY_LABELS[row.notify_status] ?? row.notify_status)),
        );
        tr.addEventListener("click", () => void openDetail(row.id));
        return tr;
      }),
    );
    listEmpty.hidden = data.inquiries.length > 0;
    detailView.hidden = true;
    listView.hidden = false;
  }

  async function openDetail(id: string) {
    const response = await fetch(`/api/admin/inquiries/${id}`);
    if (response.status === 401) return showLogin();
    if (!response.ok) return;
    const { inquiry: q, events } = (await response.json()) as {
      inquiry: Record<string, string | number | null>;
      events: { created_at: string; kind: string; from_status: string | null; to_status: string | null; note: string | null }[];
    };
    const s = (key: string) => (q[key] === null || q[key] === undefined ? "" : String(q[key]));

    const head = el("div", "flex flex-wrap items-baseline justify-between gap-4 border-b border-(--color-line) pb-6");
    const title = el("h2", "font-display text-3xl", `${s("reference")} — ${s("full_name")}`);
    const reply = el("a", "label-tracked text-(--color-gold) hover:text-(--color-gold-bright)", "Répondre par e-mail");
    reply.href = `mailto:${s("email")}?subject=${encodeURIComponent(`WEBLACK — ${s("reference")}`)}`;
    head.append(title, reply);

    const facts: [string, string][] = [
      ["Reçue", date(s("created_at"))],
      ["Division", divisionLabel(s("division"))],
      ["Prestation", s("service")],
      ["E-mail", s("email")],
      ["Organisation", s("organisation") || "—"],
      ["Pays", countryName(s("country"))],
      ["Échéance", copy.timelines[s("timeline") as keyof typeof copy.timelines] ?? "—"],
      ["Budget indicatif", copy.budgets[s("budget") as keyof typeof copy.budgets] ?? "—"],
      ["Langue", s("lang")],
      ["Origine", [s("channel"), s("entry_point") && `entrée ${s("entry_point")}`, s("utm_medium"), s("utm_campaign") && `campagne ${s("utm_campaign")}`].filter(Boolean).join(" · ")],
      ["Notification", `${NOTIFY_LABELS[s("notify_status")] ?? s("notify_status")}${s("notify_error") ? ` (${s("notify_error")})` : ""}`],
      ["Secteur", s("sector") || "—"],
      ["Valeur estimée", s("estimated_value") ? `${Number(s("estimated_value")).toLocaleString("fr-FR")} € (estimation interne)` : "—"],
      ["Prochaine action", s("next_action") ? `${s("next_action")}${s("next_action_at") ? ` — le ${s("next_action_at")}` : ""}` : "—"],
    ];
    const dl = el("dl", "mt-6 grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-[12rem_1fr]");
    for (const [k, v] of facts) dl.append(el("dt", "label-tracked text-(--color-paper)/50", k), el("dd", "text-(--color-paper)", v));

    const desc = el("div", "mt-8 max-w-3xl border-l border-(--color-gold) pl-5");
    desc.append(el("p", "label-tracked text-(--color-paper)/50", "Projet"), el("p", "mt-3 whitespace-pre-wrap text-(--color-paper)/90", s("description")));

    // Statut + note
    const form = el("form", "mt-10 grid grid-cols-1 gap-6 border-t border-(--color-line) pt-8 md:grid-cols-[16rem_1fr_auto] md:items-end");
    const statusWrap = el("div");
    const statusLabel = el("label", "label-tracked text-(--color-paper)/70", "Statut commercial");
    statusLabel.htmlFor = "inquiry-status";
    const select = el("select", "form-input");
    select.id = "inquiry-status";
    for (const st of INQUIRY_STATUSES) select.add(new Option(STATUS_LABELS[st]!, st, false, st === s("status")));
    statusWrap.append(statusLabel, select);
    const field = (id: string, label: string, input: HTMLInputElement) => {
      const wrap = el("div");
      const lab = el("label", "label-tracked text-(--color-paper)/70", label);
      lab.htmlFor = id;
      input.id = id;
      input.className = "form-input";
      wrap.append(lab, input);
      return wrap;
    };
    const nextAction = el("input");
    nextAction.type = "text";
    nextAction.maxLength = 280;
    nextAction.value = s("next_action");
    const nextActionAt = el("input");
    nextActionAt.type = "date";
    nextActionAt.value = s("next_action_at");
    const estimated = el("input");
    estimated.type = "number";
    estimated.min = "0";
    estimated.step = "1";
    estimated.inputMode = "numeric";
    estimated.value = s("estimated_value");
    const sector = el("input");
    sector.type = "text";
    sector.maxLength = 80;
    sector.value = s("sector");
    const pipelineGrid = el("div", "grid grid-cols-1 gap-6 sm:grid-cols-2 md:col-span-3 lg:grid-cols-4");
    pipelineGrid.append(
      field("inquiry-next-action", "Prochaine action", nextAction),
      field("inquiry-next-action-at", "Date de l'action", nextActionAt),
      field("inquiry-estimated", "Valeur estimée (€)", estimated),
      field("inquiry-sector", "Secteur", sector),
    );
    const noteWrap = el("div");
    const noteLabel = el("label", "label-tracked text-(--color-paper)/70", "Note interne (facultative)");
    noteLabel.htmlFor = "inquiry-note";
    const note = el("textarea", "form-input");
    note.id = "inquiry-note";
    note.rows = 2;
    note.maxLength = 2000;
    noteWrap.append(noteLabel, note);
    const save = el("button", "inline-flex min-h-12 items-center justify-center bg-(--color-gold) px-6 py-3 text-sm font-semibold uppercase tracking-[0.08em] text-(--color-on-gold) hover:bg-(--color-gold-bright)", "Enregistrer");
    save.type = "submit";
    const feedback = el("p", "text-sm text-(--color-paper)/70 md:col-span-3");
    feedback.setAttribute("role", "status");
    form.append(pipelineGrid, statusWrap, noteWrap, save, feedback);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const body: Record<string, unknown> = {};
      if (select.value !== s("status")) body.status = select.value;
      if (note.value.trim()) body.note = note.value.trim();
      // Champs de pilotage : envoyés seulement s'ils ont changé ; vide = effacer.
      const changed = (input: HTMLInputElement, key: string, current: string) => {
        if (input.value.trim() !== current) (body as Record<string, unknown>)[key] = input.value.trim() === "" ? null : input.value.trim();
      };
      changed(nextAction, "nextAction", s("next_action"));
      changed(nextActionAt, "nextActionAt", s("next_action_at"));
      changed(sector, "sector", s("sector"));
      if (estimated.value.trim() !== s("estimated_value")) {
        (body as Record<string, unknown>).estimatedValue = estimated.value.trim() === "" ? null : Math.round(Number(estimated.value));
      }
      if (!Object.keys(body).length) {
        feedback.textContent = "Aucun changement à enregistrer.";
        return;
      }
      const r = await fetch(`/api/admin/inquiries/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (r.status === 401) return showLogin();
      feedback.textContent = r.ok ? "Enregistré." : "Échec de l'enregistrement.";
      if (r.ok) void openDetail(id);
    });

    // Journal
    const log = el("div", "mt-10");
    log.append(el("h3", "label-tracked text-(--color-paper)/50", "Journal"));
    const ul = el("ul", "mt-4 space-y-3 text-sm");
    if (!events.length) ul.append(el("li", "text-(--color-paper)/50", "Aucun événement pour l'instant."));
    for (const ev of events) {
      const text =
        ev.kind === "status"
          ? `Statut : ${STATUS_LABELS[ev.from_status ?? ""] ?? ev.from_status} → ${STATUS_LABELS[ev.to_status ?? ""] ?? ev.to_status}`
          : `Note : ${ev.note ?? ""}`;
      const li = el("li", "flex gap-4");
      li.append(el("span", "shrink-0 text-(--color-paper)/50", date(ev.created_at)), el("span", "whitespace-pre-wrap text-(--color-paper)/85", text));
      ul.append(li);
    }
    log.append(ul);

    // Actions
    const actions = el("div", "mt-12 flex flex-wrap gap-6 border-t border-(--color-line) pt-6");
    if (s("notify_status") !== "sent") {
      const retry = el("button", "label-tracked min-h-10 text-(--color-gold)", "Relancer la notification e-mail");
      retry.type = "button";
      retry.addEventListener("click", async () => {
        const r = await fetch(`/api/admin/inquiries/${id}`, { method: "POST" });
        if (r.status === 401) return showLogin();
        void openDetail(id);
      });
      actions.append(retry);
    }
    const del = el("button", "label-tracked min-h-10 text-red-300 hover:text-red-200", "Supprimer définitivement");
    del.type = "button";
    del.addEventListener("click", async () => {
      if (!confirm(`Supprimer définitivement la demande ${s("reference")} ? Cette action est irréversible.`)) return;
      const r = await fetch(`/api/admin/inquiries/${id}`, { method: "DELETE" });
      if (r.status === 401) return showLogin();
      if (r.ok) void loadList();
    });
    actions.append(del);

    detailContent.replaceChildren(head, dl, desc, form, log, actions);
    listView.hidden = true;
    detailView.hidden = false;
    window.scrollTo({ top: 0 });
  }

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    loginStatus.textContent = "";
    const password = (loginForm.elements.namedItem("password") as HTMLInputElement).value;
    try {
      const response = await fetch("/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      const data = (await response.json()) as { ok: boolean; reason?: string };
      if (data.ok) showDashboard();
      else loginStatus.textContent = data.reason === "rate_limited" ? "Trop de tentatives. Réessayez plus tard." : data.reason === "unconfigured" ? "Administration non configurée sur cet environnement." : "Mot de passe incorrect.";
    } catch {
      loginStatus.textContent = "Connexion impossible.";
    }
  });

  document.getElementById("logout-button")!.addEventListener("click", async () => {
    await fetch("/api/admin/logout", { method: "POST" });
    showLogin();
  });
  document.getElementById("back-to-list")!.addEventListener("click", () => void loadList());

  // Session déjà ouverte (même cookie que /admin/candidatures) : directement au tableau de bord.
  void fetch("/api/admin/inquiries").then((r) => {
    if (r.ok) showDashboard();
  });
}
