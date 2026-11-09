/**
 * Espace membre WEBLACK TALENT — comportement de la page /espace/.
 * Le jeton du lien arrive dans le fragment (#t=…) : il est retiré de l'URL
 * immédiatement (historique, captures, partage), puis présenté une seule
 * fois au serveur. Toute donnée affichée passe par textContent.
 */
interface Copy {
  status: Record<string, string>;
  level: Record<string, string>;
  levelHelp: Record<string, string>;
  fieldErrors: Record<string, string>;
  receivedOn: string;
  reference: string;
  sent: string;
  sending: string;
  send: string;
  invalidEmail: string;
  rateLimited: string;
  unavailable: string;
  linkInvalid: string;
  saved: string;
  saveError: string;
  erasureConfirm: string;
  erasureDone: string;
  error: string;
}

interface Application {
  reference: string;
  createdAt: string;
  status: string;
  phone: string;
  city: string;
  instagram: string | null;
  portfolioLinks: string[];
  availability: string | null;
  contactPref: string | null;
}

let initialized = false;

export function initMemberSpace() {
  if (initialized) return;
  initialized = true;
  const root = document.querySelector<HTMLElement>("[data-member-root]");
  if (!root) return;
  const lang = root.dataset.lang === "en" ? "en" : "fr";
  const c = JSON.parse(root.dataset.copy ?? "{}") as Copy;
  const q = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const status = q<HTMLElement>("[data-member-status]");
  const login = q<HTMLFormElement>("[data-member-login]");
  const space = q<HTMLElement>("[data-member-space]");
  const profile = q<HTMLFormElement>("[data-member-profile]");
  const json = { "Content-Type": "application/json" };

  const showLogin = () => {
    login.hidden = false;
    space.hidden = true;
  };

  async function loadMe() {
    const r = await fetch("/api/member/me", { credentials: "same-origin" });
    if (!r.ok) return showLogin();
    const data = (await r.json()) as { level: string; applications: Application[] };
    login.hidden = true;
    space.hidden = false;
    q<HTMLElement>("[data-member-level]").textContent = c.level[data.level] ?? data.level;
    q<HTMLElement>("[data-member-level-help]").textContent = c.levelHelp[data.level] ?? "";
    q<HTMLElement>("[data-member-apps]").replaceChildren(
      ...data.applications.map((a) => {
        const li = document.createElement("li");
        li.className = "flex flex-wrap items-baseline justify-between gap-3 py-4";
        const left = document.createElement("span");
        left.className = "text-(--color-paper)";
        left.textContent = `${c.reference} ${a.reference} · ${c.receivedOn} ${new Date(a.createdAt).toLocaleDateString(lang === "en" ? "en-GB" : "fr-FR")}`;
        const right = document.createElement("span");
        right.className = "label-tracked text-(--color-gold)";
        right.textContent = c.status[a.status] ?? a.status;
        li.append(left, right);
        return li;
      }),
    );
    const latest = data.applications[0];
    if (latest) {
      (profile.elements.namedItem("phone") as HTMLInputElement).value = latest.phone;
      (profile.elements.namedItem("city") as HTMLInputElement).value = latest.city;
      (profile.elements.namedItem("instagram") as HTMLInputElement).value = latest.instagram ?? "";
      (profile.elements.namedItem("portfolio") as HTMLTextAreaElement).value = latest.portfolioLinks.join("\n");
      (profile.elements.namedItem("availability") as HTMLInputElement).value = latest.availability ?? "";
      const pref = profile.querySelector<HTMLInputElement>(`input[name="contactPref"][value="${latest.contactPref ?? "email"}"]`);
      if (pref) pref.checked = true;
    }
  }

  login.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = login.elements.namedItem("email") as HTMLInputElement;
    const email = input.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      status.textContent = c.invalidEmail;
      input.focus();
      return;
    }
    const button = login.querySelector<HTMLButtonElement>("button[type=submit]")!;
    button.disabled = true;
    button.textContent = c.sending;
    try {
      const r = await fetch("/api/member/request-link", { method: "POST", headers: json, body: JSON.stringify({ email, lang }) });
      const data = (await r.json()) as { ok?: boolean; reason?: string; devLink?: string };
      if (r.ok) {
        status.textContent = c.sent;
        // Développement local uniquement : le serveur ne renvoie ce lien que sur localhost.
        if (data.devLink) {
          const dev = q<HTMLElement>("[data-member-devlink]");
          dev.hidden = false;
          dev.textContent = data.devLink;
        }
      } else status.textContent = r.status === 429 ? c.rateLimited : r.status === 503 ? c.unavailable : c.error;
    } catch {
      status.textContent = c.error;
    } finally {
      button.disabled = false;
      button.textContent = c.send;
    }
  });

  profile.addEventListener("submit", async (event) => {
    event.preventDefault();
    const out = q<HTMLElement>("[data-member-save-status]");
    const value = (n: string) => (profile.elements.namedItem(n) as HTMLInputElement).value;
    const body = {
      phone: value("phone"),
      city: value("city"),
      instagram: value("instagram"),
      portfolioLinks: value("portfolio").split("\n").map((l) => l.trim()).filter(Boolean),
      availability: value("availability"),
      contactPref: profile.querySelector<HTMLInputElement>('input[name="contactPref"]:checked')?.value,
    };
    const r = await fetch("/api/member/me", { method: "PATCH", headers: json, body: JSON.stringify(body) });
    if (r.status === 401) return showLogin();
    const data = (await r.json()) as { ok?: boolean; errors?: { field: string }[] };
    out.textContent = r.ok ? c.saved : data.errors ? `${c.saveError} ${data.errors.map((e) => c.fieldErrors[e.field] ?? e.field).join(", ")}.` : c.error;
  });

  q<HTMLButtonElement>("[data-member-logout]").addEventListener("click", async () => {
    await fetch("/api/member/logout", { method: "POST", headers: json });
    showLogin();
    status.textContent = "";
  });

  q<HTMLButtonElement>("[data-member-erasure]").addEventListener("click", async () => {
    if (!window.confirm(c.erasureConfirm)) return;
    const r = await fetch("/api/member/erasure-request", { method: "POST", headers: json });
    if (r.status === 401) return showLogin();
    status.textContent = r.ok ? c.erasureDone : c.error;
    status.scrollIntoView({ block: "center" });
  });

  // Connexion par le lien reçu : jeton lu dans le fragment puis retiré de l'URL.
  // Aussi au changement de fragment : un lien ouvert dans un onglet déjà sur
  // /espace/ ne recharge pas la page (seul le #t=… change).
  function consumeHashToken(): boolean {
    const token = new URLSearchParams(window.location.hash.slice(1)).get("t");
    if (!token) return false;
    history.replaceState(null, "", window.location.pathname + window.location.search);
    status.textContent = "…";
    void fetch("/api/member/verify", { method: "POST", headers: json, body: JSON.stringify({ token }) })
      .then(async (r) => {
        status.textContent = r.ok ? "" : c.linkInvalid;
        await loadMe();
      })
      .catch(() => {
        status.textContent = c.error;
        showLogin();
      });
    return true;
  }
  window.addEventListener("hashchange", () => void consumeHashToken());
  if (!consumeHashToken()) void loadMe();
}
