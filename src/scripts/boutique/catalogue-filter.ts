/**
 * Recherche + filtres + tri du catalogue Boutique — entièrement côté
 * client, sur les données déjà rendues par Astro (aucune requête réseau,
 * aucune re-fetch Sanity à chaque frappe). Même principe que
 * live-archive-filter.ts : le filtre ne fait que montrer/masquer et
 * réordonner ce qui existe déjà dans le DOM.
 *
 * L'état (recherche, filtres, tri) est répliqué dans l'URL via
 * history.replaceState — partage, retour navigateur, sans jamais générer
 * de page indexable par filtre (la page elle-même reste /boutique/,
 * canonicalisée par Seo.astro indépendamment des query params).
 */
let initialized = false;

export function initBoutiqueFilter() {
  if (initialized) return;
  initialized = true;

  const form = document.getElementById("boutique-filter") as HTMLFormElement | null;
  const grid = document.getElementById("boutique-grid");
  const noResults = document.getElementById("boutique-no-results");
  if (!form || !grid) return;

  const items = Array.from(grid.querySelectorAll<HTMLElement>("[data-boutique-item]"));
  const searchInput = form.querySelector<HTMLInputElement>("[data-boutique-search]");

  function valueOf(name: string): string {
    const field = form!.elements.namedItem(name);
    return field instanceof HTMLSelectElement ? field.value : "all";
  }

  function matches(item: HTMLElement, query: string): boolean {
    for (const [name, key] of [
      ["category", "category"],
      ["collection", "collection"],
      ["availability", "availability"],
    ] as const) {
      const selected = valueOf(name);
      if (selected !== "all" && item.dataset[key] !== selected) return false;
    }
    if (query) {
      const haystack = `${item.dataset.name ?? ""} ${item.dataset.code ?? ""}`;
      if (!haystack.includes(query)) return false;
    }
    return true;
  }

  function sortKey(sort: string) {
    return (item: HTMLElement): number => {
      if (sort === "latest") return -new Date(item.dataset.created ?? 0).getTime();
      if (sort === "price-asc" || sort === "price-desc") {
        const raw = item.dataset.price;
        if (!raw) return Number.POSITIVE_INFINITY; // sans prix numérique -> toujours en fin de liste
        const price = Number(raw);
        return sort === "price-asc" ? price : -price;
      }
      // recommended : les produits mis en avant d'abord, puis l'ordre éditorial.
      const featured = item.dataset.featured === "true" ? 0 : 1;
      return featured * 100000 + Number(item.dataset.order ?? 0);
    };
  }

  function updateUrl(query: string) {
    const url = new URL(window.location.href);
    const setOrDelete = (key: string, value: string, defaultValue: string) => {
      if (!value || value === defaultValue) url.searchParams.delete(key);
      else url.searchParams.set(key, value);
    };
    setOrDelete("q", query, "");
    setOrDelete("category", valueOf("category"), "all");
    setOrDelete("collection", valueOf("collection"), "all");
    setOrDelete("availability", valueOf("availability"), "all");
    setOrDelete("sort", valueOf("sort"), "recommended");
    window.history.replaceState({}, "", url);
  }

  function apply() {
    const query = (searchInput?.value ?? "").trim().toLowerCase();
    const sort = valueOf("sort");
    const key = sortKey(sort);

    let visible = 0;
    items.forEach((item) => {
      const shown = matches(item, query);
      item.hidden = !shown;
      if (shown) visible++;
      item.style.order = String(key(item));
    });

    if (noResults) noResults.hidden = visible > 0;
    updateUrl(query);
  }

  let debounceId: number | undefined;
  searchInput?.addEventListener("input", () => {
    window.clearTimeout(debounceId);
    debounceId = window.setTimeout(apply, 200);
  });
  form.addEventListener("change", apply);
  form.addEventListener("reset", () => {
    window.setTimeout(() => {
      const url = new URL(window.location.href);
      url.search = "";
      window.history.replaceState({}, "", url);
      apply();
    }, 0);
  });

  apply();
}
