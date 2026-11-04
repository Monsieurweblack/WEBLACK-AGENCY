/**
 * Bascule grille / liste (ViewToggle.astro). La présentation vit sur
 * <html data-collection-view="list"> — posée avant le premier rendu par le
 * script en ligne du composant — et la mise en page dans global.css. Rien
 * n'est rechargé ni réordonné : les filtres (journal-filter.ts) continuent
 * de masquer ou montrer les mêmes éléments.
 *
 * Transition : une View Transition de document si le navigateur la connaît
 * et que le mouvement est permis, sinon le changement est immédiat.
 */
const STORAGE_KEY = "weblack-collection-view";

let initialized = false;

export function initViewToggle() {
  if (initialized) return;
  initialized = true;

  const groups = document.querySelectorAll<HTMLElement>("[data-view-toggle]");
  if (!groups.length) return;
  const root = document.documentElement;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const apply = (view: "grid" | "list") => {
    if (view === "list") root.dataset.collectionView = "list";
    else delete root.dataset.collectionView;
    groups.forEach((group) =>
      group.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((button) => {
        button.setAttribute("aria-pressed", String(button.dataset.view === view));
      }),
    );
    try {
      localStorage.setItem(STORAGE_KEY, view);
    } catch {
      // Stockage indisponible (navigation privée) : le choix vaut pour la page.
    }
  };

  groups.forEach((group) =>
    group.addEventListener("click", (event) => {
      const button = (event.target as Element).closest<HTMLButtonElement>("[data-view]");
      if (!button || button.getAttribute("aria-pressed") === "true") return;
      const view = button.dataset.view === "list" ? "list" : "grid";
      if (!reduceMotion && "startViewTransition" in document) document.startViewTransition(() => apply(view));
      else apply(view);
    }),
  );
}
