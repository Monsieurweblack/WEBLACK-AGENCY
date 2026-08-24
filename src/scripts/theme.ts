const STORAGE_KEY = "weblack-theme";
type Theme = "light" | "dark";

let initialized = false;

// Dark is the unconditional default: any state other than an explicit
// "light" attribute (set by the blocking anti-FOUC script or a prior user
// choice) resolves to dark, regardless of OS prefers-color-scheme.
function getCurrentTheme(): Theme {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
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
}
