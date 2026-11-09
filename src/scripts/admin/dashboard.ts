/**
 * Tableau de bord de direction (/admin/). Tout texte venu des données est
 * inséré par textContent, jamais en HTML.
 */
import { INQUIRY_COPY } from "../../lib/inquiry-copy";

const LEAD_STATUS: Record<string, string> = {
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
const TALENT_STATUS: Record<string, string> = {
  RECEIVED: "Nouvelle candidature",
  REVIEWING: "En cours d'examen",
  INFO_REQUESTED: "Informations demandées",
  TO_CONTACT: "À contacter",
  SHORTLISTED: "Présélectionnée",
  INTERVIEW: "Entretien",
  SELECTED: "Sélectionnée",
  TALENT_POOL: "Vivier de talents",
  REPRESENTED: "Représentée (contrat signé)",
  REJECTED: "Non retenue",
  ARCHIVED: "Archivée",
};
const CATEGORY: Record<string, string> = {
  runway: "Défilé",
  commercial: "Commercial",
  photo: "Photo",
  editorial: "Éditorial",
  creative: "Profil créatif",
  other: "Autre",
};
const SEGMENT: Record<string, string> = {
  talent_applicant: "Candidat·e Talent",
  talent_pool: "Vivier",
  represented: "Représenté·e",
  prospect: "Prospect",
  client: "Client",
};
const divisions = INQUIRY_COPY.fr.divisions as Record<string, string>;

type Count = { key: string | null; n: number };

interface Metrics {
  generatedAt: string;
  talent: { total: number; last30Days: number; byStatus: Count[]; byCategory: Count[]; awaitingReviewOver7Days: number; retentionReviewDue: number };
  business: {
    total: number;
    last30Days: number;
    byStatus: Count[];
    byDivision: Count[];
    byChannel: Count[];
    winRate: number | null;
    closed: { won: number; lost: number };
    estimatedOpenPipelineEur: number;
    estimatedWonEur: number;
    followUpsDue: { id: string; reference: string; full_name: string; organisation: string | null; status: string; next_action: string | null; next_action_at: string }[];
    unnotified: number;
  };
  operations: { applicationEmailsPendingOrFailed: number };
  notConnected: string[];
}

interface Contact {
  key: string;
  email: string;
  name: string;
  organisation: string | null;
  countries: string[];
  segments: string[];
  applications: { id: string; status: string }[];
  inquiries: { id: string; reference: string; status: string }[];
  lastActivity: string;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const eur = (n: number) => `${n.toLocaleString("fr-FR")} €`;

function kpi(label: string, value: string, hint?: string) {
  const box = el("div", "bg-(--color-ink) p-5");
  box.append(el("p", "label-tracked text-(--color-paper)/50", label), el("p", "font-display mt-2 text-3xl tabular-nums text-(--color-paper)", value));
  if (hint) box.append(el("p", "mt-1 text-xs text-(--color-paper)/45", hint));
  return box;
}

function counts(target: HTMLElement, rows: Count[], labels: Record<string, string>) {
  target.replaceChildren(
    ...(rows.length
      ? [...rows]
          .sort((a, b) => b.n - a.n)
          .map((r) => {
            const li = el("li", "flex justify-between gap-4");
            li.append(el("span", "text-(--color-paper)/80", labels[r.key ?? ""] ?? r.key ?? "—"), el("span", "tabular-nums text-(--color-paper)", String(r.n)));
            return li;
          })
      : [el("li", "text-(--color-paper)/45", "Aucune donnée")]),
  );
}

let initialized = false;

export function initAdminDashboard() {
  if (initialized) return;
  initialized = true;
  const loginForm = document.getElementById("login-form") as HTMLFormElement;
  const loginStatus = document.getElementById("login-status")!;
  const dashboard = document.getElementById("dashboard")!;
  const $ = (id: string) => document.getElementById(id)!;

  const showLogin = () => {
    loginForm.hidden = false;
    dashboard.hidden = true;
  };

  async function loadMetrics() {
    const response = await fetch("/api/admin/metrics");
    if (response.status === 401) return showLogin();
    if (!response.ok) {
      $("generated-at").textContent = "Indicateurs indisponibles sur cet environnement.";
      return;
    }
    loginForm.hidden = true;
    dashboard.hidden = false;
    const m = (await response.json()) as Metrics;
    $("generated-at").textContent = `Données réelles de la base, calculées le ${new Date(m.generatedAt).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" })}.`;

    const alerts: string[] = [];
    if (m.business.followUpsDue.length) alerts.push(`${m.business.followUpsDue.length} relance(s) commerciale(s) à échéance.`);
    if (m.business.unnotified) alerts.push(`${m.business.unnotified} demande(s) commerciale(s) dont l'équipe n'a pas reçu l'e-mail de notification.`);
    if (m.talent.awaitingReviewOver7Days) alerts.push(`${m.talent.awaitingReviewOver7Days} candidature(s) en attente d'examen depuis plus de 7 jours.`);
    if (m.talent.retentionReviewDue)
      alerts.push(
        `${m.talent.retentionReviewDue} candidature(s) non retenue(s) ou archivée(s) depuis plus de 3 mois : à supprimer selon la politique de confidentialité (suppression manuelle, après vérification).`,
      );
    if (m.operations.applicationEmailsPendingOrFailed) alerts.push(`${m.operations.applicationEmailsPendingOrFailed} e-mail(s) de candidature en attente ou en échec.`);
    $("alerts").replaceChildren(...(alerts.length ? alerts.map((a) => el("li", "border-l border-(--color-gold) pl-4 text-(--color-paper)/85", a)) : [el("li", "text-(--color-paper)/50", "Rien d'urgent.")]));

    const b = m.business;
    $("business-kpis").replaceChildren(
      kpi("Demandes reçues", String(b.total), `${b.last30Days} sur 30 jours`),
      kpi("Gagnées / perdues", `${b.closed.won} / ${b.closed.lost}`, b.winRate === null ? "Aucune demande conclue" : `Taux de transformation ${Math.round(b.winRate * 100)} %`),
      kpi("Pipeline ouvert", eur(b.estimatedOpenPipelineEur ?? 0), "Somme des valeurs estimées par l'équipe"),
      kpi("Gagné (estimé)", eur(b.estimatedWonEur ?? 0), "Valeurs estimées, pas un chiffre d'affaires facturé"),
    );
    counts($("business-status"), b.byStatus, LEAD_STATUS);
    counts($("business-division"), b.byDivision, divisions);
    counts($("business-channel"), b.byChannel, {});
    $("followups").replaceChildren(
      ...(b.followUpsDue.length
        ? b.followUpsDue.map((f) => {
            const li = el("li", "flex flex-wrap justify-between gap-4 py-3");
            const a = el("a", "text-(--color-gold) hover:underline", `${f.reference} — ${[f.full_name, f.organisation].filter(Boolean).join(" · ")}`);
            a.href = "/admin/demandes/";
            li.append(a, el("span", "text-(--color-paper)/70", `${f.next_action ?? "Action à préciser"} · ${f.next_action_at} · ${LEAD_STATUS[f.status] ?? f.status}`));
            return li;
          })
        : [el("li", "py-3 text-(--color-paper)/50", "Aucune relance à échéance.")]),
    );

    const t = m.talent;
    $("talent-kpis").replaceChildren(
      kpi("Candidatures", String(t.total), `${t.last30Days} sur 30 jours`),
      kpi("En attente > 7 j", String(t.awaitingReviewOver7Days)),
      kpi("Vivier", String(t.byStatus.find((r) => r.key === "TALENT_POOL")?.n ?? 0)),
      kpi("Représentés", String(t.byStatus.find((r) => r.key === "REPRESENTED")?.n ?? 0), "Contrat signé"),
    );
    counts($("talent-status"), t.byStatus, TALENT_STATUS);
    counts($("talent-category"), t.byCategory, CATEGORY);
    $("not-connected").replaceChildren(...m.notConnected.map((n) => el("li", "", n)));
  }

  async function loadContacts() {
    const q = ($("contacts-q") as HTMLInputElement).value.trim();
    const response = await fetch(`/api/admin/contacts${q ? `?q=${encodeURIComponent(q)}` : ""}`);
    if (response.status === 401) return showLogin();
    if (!response.ok) return;
    const { contacts } = (await response.json()) as { contacts: Contact[] };
    $("contacts-meta").textContent = `${contacts.length} contact(s)${q ? " correspondant(s)" : ""}.`;
    $("contacts-list").replaceChildren(
      ...contacts.slice(0, 200).map((c) => {
        const li = el("li", "flex flex-wrap items-start justify-between gap-4 py-4");
        const left = el("div", "min-w-0");
        left.append(
          el("p", "text-(--color-paper)", [c.name, c.organisation].filter(Boolean).join(" · ")),
          el("p", "break-all text-sm text-(--color-paper)/55", `${c.email} · ${c.countries.join(", ")}`),
          el(
            "p",
            "mt-1 text-xs text-(--color-paper)/45",
            [
              c.segments.map((s) => SEGMENT[s] ?? s).join(" · "),
              c.applications.length ? `${c.applications.length} candidature(s)` : "",
              c.inquiries.length ? `demande(s) ${c.inquiries.map((i) => i.reference).join(", ")}` : "",
            ]
              .filter(Boolean)
              .join(" — "),
          ),
        );
        const exportBtn = el("button", "label-tracked min-h-10 text-(--color-gold) hover:text-(--color-gold-bright)", "Exporter (RGPD)");
        exportBtn.type = "button";
        exportBtn.addEventListener("click", async () => {
          const r = await fetch("/api/admin/contacts/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: c.email }) });
          if (r.status === 401) return showLogin();
          if (!r.ok) {
            exportBtn.textContent = "Échec de l'export";
            return;
          }
          const { export: data } = (await r.json()) as { export: unknown };
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
          const a = el("a");
          a.href = URL.createObjectURL(blob);
          a.download = `weblack-export-${c.key}.json`;
          a.click();
          URL.revokeObjectURL(a.href);
          exportBtn.textContent = "Exporté";
        });
        li.append(left, exportBtn);
        return li;
      }),
    );
  }

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    loginStatus.textContent = "";
    const password = (loginForm.elements.namedItem("password") as HTMLInputElement).value;
    try {
      const r = await fetch("/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      const data = (await r.json()) as { ok: boolean; reason?: string };
      if (data.ok) {
        await loadMetrics();
        await loadContacts();
      } else loginStatus.textContent = data.reason === "rate_limited" ? "Trop de tentatives. Réessayez plus tard." : data.reason === "unconfigured" ? "Administration non configurée sur cet environnement." : "Mot de passe incorrect.";
    } catch {
      loginStatus.textContent = "Connexion impossible.";
    }
  });
  $("logout-button").addEventListener("click", async () => {
    await fetch("/api/admin/logout", { method: "POST" });
    showLogin();
  });
  $("refresh").addEventListener("click", () => void loadMetrics());
  $("contacts-search").addEventListener("submit", (event) => {
    event.preventDefault();
    void loadContacts();
  });

  // Session déjà ouverte : directement au tableau de bord.
  void loadMetrics().then(() => {
    if (!dashboard.hidden) void loadContacts();
  });
}
