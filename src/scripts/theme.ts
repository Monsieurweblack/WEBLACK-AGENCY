const STORAGE_KEY = "weblack-theme";
type Theme = "light" | "dark";

let initialized = false;

function getStored(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

function getSystemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function getCurrentTheme(): Theme {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "light" || attr === "dark") return attr;
  return getSystemTheme();
}

function updateMetaThemeColor(theme: Theme) {
  const content = theme === "light" ? "#f5f3ee" : "#0a0a0a";
  document
    .querySelectorAll('meta[name="theme-color"]')
    .forEach((meta) => meta.setAttribute("content", content));
}

function updateToggles(theme: Theme) {
  document.querySelectorAll<HTMLButtonElement>("[data-theme-toggle]").forEach((button) => {
    const isDark = theme === "dark";
    button.setAttribute("aria-pressed", String(isDark));
    const label = isDark ? button.dataset.labelToLight : button.dataset.labelToDark;
    if (label) button.setAttribute("aria-label", label);
    const sun = button.querySelector<SVGElement>("[data-icon-sun]");
    const moon = button.querySelector<SVGElement>("[data-icon-moon]");
    sun?.toggleAttribute("hidden", !isDark);
    moon?.toggleAttribute("hidden", isDark);
  });
}

function applyTheme(theme: Theme, { persist }: { persist: boolean }) {
  const root = document.documentElement;

  root.setAttribute("data-theme", theme);
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* localStorage unavailable (private mode, etc.) — theme still applies for this load */
    }
  }
  updateMetaThemeColor(theme);
  updateToggles(theme);
}

export function initTheme() {
  if (initialized) return;
  initialized = true;

  updateMetaThemeColor(getCurrentTheme());
  updateToggles(getCurrentTheme());

  document.querySelectorAll<HTMLButtonElement>("[data-theme-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      const next: Theme = getCurrentTheme() === "dark" ? "light" : "dark";
      applyTheme(next, { persist: true });
    });
  });

  // Follow the OS theme live only while the user hasn't made an explicit choice.
  window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", (event) => {
    if (getStored()) return;
    applyTheme(event.matches ? "light" : "dark", { persist: false });
  });
}
