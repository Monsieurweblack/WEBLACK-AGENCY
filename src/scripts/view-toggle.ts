/**
 * Bascule grille / liste (ViewToggle.astro). La présentation vit sur la
 * collection elle-même : [data-view-collection="list"], mise en page dans
 * global.css. Rien n'est rechargé ni réordonné : les filtres
 * (journal-filter.ts) continuent de masquer ou montrer les mêmes éléments.
 *
 * Premier rendu : le script en ligne du composant pose
 * <html data-collection-view="list"> avant que la collection soit analysée
 * (la page ne saute jamais d'une présentation à l'autre). À l'initialisation,
 * cet état est reporté sur la collection et retiré de <html> : ensuite, une
 * bascule ne touche que la collection — mesuré, l'attribut sur <html> et la
 * View Transition du document entier faisaient recalculer et capturer toute
 * la page (INP médian 192 ms, CPU ×4).
 *
 * Transition : un fondu montant de la seule collection (opacité et
 * transformation, composées hors du fil principal), sauf si le mouvement est
 * réduit.
 */
const STORAGE_KEY = "weblack-collection-view";

type View = "grid" | "list";

let initialized = false;

export function initViewToggle() {
  if (initialized) return;
  initialized = true;

  const groups = document.querySelectorAll<HTMLElement>("[data-view-toggle]");
  if (!groups.length) return;
  const root = document.documentElement;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const collectionsOf = (group: HTMLElement) => {
    const ids = new Set(
      [...group.querySelectorAll<HTMLButtonElement>("[data-view]")].map((b) => b.getAttribute("aria-controls")),
    );
    return [...ids]
      .map((id) => (id ? document.getElementById(id) : null))
      .filter((el): el is HTMLElement => !!el && el.hasAttribute("data-view-collection"));
  };
  const allCollections = () => [...groups].flatMap(collectionsOf);

  const setCollection = (collection: HTMLElement, view: View) => {
    collection.setAttribute("data-view-collection", view === "list" ? "list" : "");
  };

  // Report de l'état du premier rendu sur la collection (même tâche : aucun
  // rendu intermédiaire, donc aucun saut).
  if (root.dataset.collectionView === "list") {
    allCollections().forEach((c) => setCollection(c, "list"));
    delete root.dataset.collectionView;
  }

  const apply = (view: View, collections: HTMLElement[]) => {
    collections.forEach((c) => setCollection(c, view));
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
      const view: View = button.dataset.view === "list" ? "list" : "grid";
      const collections = collectionsOf(group);
      apply(view, collections);
      if (reduceMotion) return;
      collections.forEach((c) =>
        c.animate(
          [
            { opacity: 0, transform: "translate3d(0, 12px, 0)" },
            { opacity: 1, transform: "none" },
          ],
          { duration: 420, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
        ),
      );
    }),
  );
}
