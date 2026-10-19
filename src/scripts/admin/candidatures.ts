/**
 * Administration des candidatures Talent — outil interne, piloté
 * entièrement côté client. Chaque appel à /api/admin/* porte le cookie de
 * session (même origine, posé par login.ts) ; un 401 à tout moment renvoie
 * au formulaire de connexion, y compris au premier chargement (sert aussi
 * de vérification de session sans endpoint dédié).
 */
import { ui } from "../../i18n/ui";
import { formatApplicationField } from "../../lib/talent-application-display";

const STATUSES = [
  { value: "RECEIVED", label: "Reçue" },
  { value: "REVIEWING", label: "À examiner" },
  { value: "TO_CONTACT", label: "À contacter" },
  { value: "SHORTLISTED", label: "Présélectionnée" },
  { value: "REJECTED", label: "Non retenue" },
  { value: "ARCHIVED", label: "Archivée" },
];

interface ApplicationListItem {
  id: string;
  created_at: string;
  status: string;
  first_name: string;
  last_name: string;
  city: string;
  country: string;
  experience_level: string;
  talent_category: string | null;
  is_minor: number;
}

interface ApplicationDetail {
  [key: string]: unknown;
}

interface PhotoRef {
  role: string;
  url: string;
  contentType: string;
}

let initialized = false;

export function initAdminCandidatures() {
  if (initialized) return;
  initialized = true;

  const loginForm = document.getElementById("login-form") as HTMLFormElement | null;
  const loginStatus = document.getElementById("login-status");
  const dashboard = document.getElementById("dashboard");
  const statusFilters = document.getElementById("status-filters");
  const listView = document.getElementById("list-view");
  const applicationsList = document.getElementById("applications-list");
  const listEmpty = document.getElementById("list-empty");
  const detailView = document.getElementById("detail-view");
  const detailContent = document.getElementById("detail-content");
  const backToList = document.getElementById("back-to-list");
  const logoutButton = document.getElementById("logout-button");
  if (
    !loginForm ||
    !loginStatus ||
    !dashboard ||
    !statusFilters ||
    !listView ||
    !applicationsList ||
    !listEmpty ||
    !detailView ||
    !detailContent ||
    !backToList ||
    !logoutButton
  ) {
    return;
  }

  let activeStatus = "";

  function showDashboard() {
    loginForm!.hidden = true;
    dashboard!.hidden = false;
    renderFilters();
    void loadList();
  }

  function showLogin() {
    loginForm!.hidden = false;
    dashboard!.hidden = true;
  }

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    loginStatus.textContent = "";
    const password = (loginForm.elements.namedItem("password") as HTMLInputElement).value;
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = (await response.json()) as { ok: boolean };
      if (data.ok) {
        showDashboard();
      } else {
        loginStatus.textContent = "Mot de passe incorrect.";
      }
    } catch {
      loginStatus.textContent = "Erreur réseau — réessayez.";
    }
  });

  logoutButton.addEventListener("click", async () => {
    await fetch("/api/admin/logout", { method: "POST" });
    showLogin();
  });

  backToList.addEventListener("click", () => {
    detailView!.hidden = true;
    listView!.hidden = false;
  });

  function renderFilters() {
    statusFilters!.innerHTML = "";
    const allButton = document.createElement("button");
    allButton.textContent = "Tous";
    allButton.className = filterClass(activeStatus === "");
    allButton.addEventListener("click", () => {
      activeStatus = "";
      renderFilters();
      void loadList();
    });
    statusFilters!.append(allButton);

    for (const status of STATUSES) {
      const button = document.createElement("button");
      button.textContent = status.label;
      button.className = filterClass(activeStatus === status.value);
      button.addEventListener("click", () => {
        activeStatus = status.value;
        renderFilters();
        void loadList();
      });
      statusFilters!.append(button);
    }
  }

  function filterClass(active: boolean): string {
    return `label-tracked border-b px-1 py-2 ${active ? "border-(--color-gold) text-(--color-gold)" : "border-transparent text-(--color-paper)/50 hover:text-(--color-paper)"}`;
  }

  function statusLabel(value: string): string {
    return STATUSES.find((s) => s.value === value)?.label ?? value;
  }

  async function loadList() {
    applicationsList!.innerHTML = "";
    const url = activeStatus ? `/api/admin/applications?status=${activeStatus}` : "/api/admin/applications";
    const response = await fetch(url);
    if (response.status === 401) {
      showLogin();
      return;
    }
    const data = (await response.json()) as { ok: boolean; applications?: ApplicationListItem[] };
    const applications = data.applications ?? [];
    listEmpty!.hidden = applications.length > 0;

    for (const app of applications) {
      const item = document.createElement("li");
      item.className = "cursor-pointer py-4 transition-colors hover:bg-(--color-ink-soft)";
      item.innerHTML = `
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p class="text-(--color-paper)">${escapeHtml(app.first_name)} ${escapeHtml(app.last_name)} ${app.is_minor ? "<span class=\"text-xs text-(--color-gold)\">(mineur·e)</span>" : ""}</p>
            <p class="text-sm text-(--color-paper)/50">${escapeHtml(app.city)}, ${escapeHtml(formatApplicationField("country", app.country, translate))} — ${escapeHtml(formatApplicationField(app.talent_category ? "talent_category" : "experience_level", app.talent_category ?? app.experience_level, translate))}</p>
          </div>
          <div class="text-right">
            <p class="label-tracked text-(--color-gold)">${statusLabel(app.status)}</p>
            <p class="text-xs text-(--color-paper)/40">${new Date(app.created_at).toLocaleDateString("fr-FR")}</p>
          </div>
        </div>
      `;
      item.addEventListener("click", () => void openDetail(app.id));
      applicationsList!.append(item);
    }
  }

  async function openDetail(id: string) {
    const response = await fetch(`/api/admin/applications/${id}`);
    if (response.status === 401) {
      showLogin();
      return;
    }
    const data = (await response.json()) as { ok: boolean; application?: ApplicationDetail; photos?: PhotoRef[] };
    if (!data.ok || !data.application) return;

    listView!.hidden = true;
    detailView!.hidden = false;
    renderDetail(id, data.application, data.photos ?? []);
  }

  // Les colonnes des premiers dossiers (missions, compétences, formations,
  // disponibilité) restent listées : elles ne s'affichent que si elles
  // portent une valeur, donc jamais pour les dossiers récents.
  const FIELD_GROUPS: { title: string; fields: [string, string][] }[] = [
    {
      title: "Profil",
      fields: [
        ["first_name", "Prénom"],
        ["last_name", "Nom"],
        ["birth_date", "Date de naissance"],
        ["city", "Ville"],
        ["country", "Pays"],
        ["email", "E-mail"],
        ["phone", "Téléphone"],
        ["submission_lang", "Langue du formulaire"],
        ["legal_guardian_name", "Représentant légal"],
        ["legal_guardian_email", "E-mail représentant légal"],
        ["legal_guardian_phone", "Téléphone représentant légal"],
      ],
    },
    {
      title: "Profil professionnel",
      fields: [
        ["talent_category", "Catégorie"],
        ["talent_category_other", "Précision catégorie"],
        ["experience_level", "Niveau déclaré"],
        ["experience_duration", "Durée d'expérience"],
        ["portfolio_links", "Liens portfolio"],
        ["instagram", "Instagram"],
        ["current_agency", "Agence actuelle"],
        ["exclusivity", "Exclusivité"],
        ["past_missions", "Missions réalisées"],
        ["skills", "Compétences"],
        ["training", "Formations"],
      ],
    },
    {
      title: "Mensurations",
      fields: [
        ["height_cm", "Taille (cm)"],
        ["chest_cm", "Poitrine (cm)"],
        ["waist_cm", "Tour de taille (cm)"],
        ["hips_cm", "Hanches (cm)"],
        ["inseam_cm", "Entrejambe (cm)"],
        ["shoe_size", "Pointure"],
        ["shoe_system", "Système de pointure"],
        ["clothing_size", "Taille vêtements"],
        ["eye_color", "Yeux"],
        ["hair_color", "Cheveux"],
      ],
    },
    {
      title: "Disponibilités",
      fields: [
        ["languages", "Langues"],
        ["languages_other", "Autre langue"],
        ["mobility", "Mobilité"],
        ["desired_projects", "Projets recherchés"],
        ["motivation", "Présentation"],
        ["availability", "Disponibilité"],
      ],
    },
  ];

  const translate = (key: string) => (ui.fr as Record<string, string>)[key];

  function renderDetail(id: string, application: ApplicationDetail, photos: PhotoRef[]) {
    const sections = FIELD_GROUPS.map((group) => {
      const rows = group.fields
        .map(([key, label]) => [label, formatApplicationField(key, application[key], translate)] as const)
        .filter(([, text]) => text !== "")
        .map(([label, text]) => `<div><dt class="label-tracked text-(--color-paper)/40">${label}</dt><dd class="mt-1 break-words text-(--color-paper)">${escapeHtml(text)}</dd></div>`)
        .join("");
      return rows ? `<div class="mt-8"><h3 class="label-tracked text-(--color-gold)">${group.title}</h3><dl class="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">${rows}</dl></div>` : "";
    }).join("");

    let projects = "";
    try {
      const parsed = application.projects_json ? (JSON.parse(String(application.projects_json)) as { name: string; role: string; year: string }[]) : [];
      if (parsed.length > 0) {
        projects = `<div class="mt-8"><h3 class="label-tracked text-(--color-gold)">Projets</h3><ul class="mt-3 space-y-2">${parsed.map((p) => `<li class="text-(--color-paper)">${escapeHtml(p.name)} — ${escapeHtml(p.role)} (${escapeHtml(p.year)})</li>`).join("")}</ul></div>`;
      }
    } catch {
      // projects_json mal formé : on l'ignore plutôt que de casser l'affichage du reste du dossier.
    }

    const photosHtml =
      photos.length > 0
        ? `<div class="mt-8"><h3 class="label-tracked text-(--color-gold)">Photos</h3><div class="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3">${photos
            .map((p) => `<figure><img src="${p.url}" alt="${escapeHtml(p.role)}" class="aspect-[3/4] w-full border border-(--color-line) object-cover" loading="lazy" /><figcaption class="mt-1 text-xs text-(--color-paper)/50">${escapeHtml(p.role)}</figcaption></figure>`)
            .join("")}</div></div>`
        : "";

    detailContent!.innerHTML = `
      ${sections}
      ${projects}
      ${photosHtml}
      <div class="mt-8 border-t border-(--color-line) pt-6">
        <label class="label-tracked text-(--color-paper)/70">Statut</label>
        <select id="detail-status" class="form-input mt-2 max-w-xs">
          ${STATUSES.map((s) => `<option value="${s.value}" ${s.value === application.status ? "selected" : ""}>${s.label}</option>`).join("")}
        </select>
        <label class="label-tracked mt-4 block text-(--color-paper)/70">Notes internes</label>
        <textarea id="detail-notes" rows="4" class="form-input resize-none">${escapeHtml(String(application.notes ?? ""))}</textarea>
        <div class="mt-4 flex flex-wrap items-center gap-4">
          <button id="save-detail" class="bg-(--color-gold) px-6 py-3 text-sm font-semibold uppercase tracking-[0.08em] text-(--color-on-gold) hover:bg-(--color-gold-bright)">Enregistrer</button>
          <span id="save-status" class="text-sm text-(--color-paper)/60"></span>
          <button id="delete-detail" class="ml-auto text-sm text-red-400 hover:text-red-300">Supprimer définitivement</button>
        </div>
      </div>
    `;

    document.getElementById("save-detail")?.addEventListener("click", async () => {
      const status = (document.getElementById("detail-status") as HTMLSelectElement).value;
      const notes = (document.getElementById("detail-notes") as HTMLTextAreaElement).value;
      const saveStatus = document.getElementById("save-status")!;
      saveStatus.textContent = "Enregistrement…";
      const response = await fetch(`/api/admin/applications/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, notes }),
      });
      const data = (await response.json()) as { ok: boolean };
      saveStatus.textContent = data.ok ? "Enregistré." : "Échec de l'enregistrement.";
    });

    const deleteButton = document.getElementById("delete-detail") as HTMLButtonElement;
    let confirming = false;
    deleteButton.addEventListener("click", async () => {
      if (!confirming) {
        confirming = true;
        deleteButton.textContent = "Confirmer la suppression définitive";
        return;
      }
      const response = await fetch(`/api/admin/applications/${id}`, { method: "DELETE" });
      const data = (await response.json()) as { ok: boolean };
      if (data.ok) {
        detailView!.hidden = true;
        listView!.hidden = false;
        void loadList();
      } else {
        deleteButton.textContent = "Échec — réessayer";
        confirming = false;
      }
    });
  }

  function escapeHtml(value: string): string {
    const div = document.createElement("div");
    div.textContent = value;
    return div.innerHTML;
  }

  // Au chargement : une tentative de liste sert de vérification de session.
  fetch("/api/admin/applications")
    .then((response) => (response.status === 401 ? showLogin() : showDashboard()))
    .catch(() => showLogin());
}
