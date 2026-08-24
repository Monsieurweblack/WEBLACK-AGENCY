interface SearchEntry {
  title: string;
  description: string;
  url: string;
  type: "page" | "journal" | "work" | "talent";
}

let initialized = false;

export function initSearch() {
  if (initialized) return;
  initialized = true;

  const triggers = document.querySelectorAll<HTMLButtonElement>("[data-search-trigger]");
  const panelEl = document.getElementById("search-panel");
  const closeButtonEl = document.getElementById("search-close");
  const inputEl = document.getElementById("search-input") as HTMLInputElement | null;
  const hintEl = document.getElementById("search-hint");
  const resultsListEl = document.getElementById("search-results");
  const templateEl = document.getElementById("search-result-template") as HTMLTemplateElement | null;
  if (triggers.length === 0 || !panelEl || !closeButtonEl || !inputEl || !hintEl || !resultsListEl || !templateEl) {
    return;
  }

  // TypeScript doesn't narrow `| null` across closures defined below (they
  // could in principle be invoked before this point), even though the guard
  // above already proved every one of these is present. Bundling the
  // verified elements here gives the rest of this function real non-null
  // types without re-checking each one inside every nested handler.
  const dom = {
    panel: panelEl,
    closeButton: closeButtonEl,
    input: inputEl,
    hint: hintEl,
    resultsList: resultsListEl,
    template: templateEl,
  };

  const indexUrl = dom.panel.dataset.indexUrl || "";
  const noResultsText = dom.panel.dataset.noResults || "";
  const typeLabels: Record<SearchEntry["type"], string> = {
    page: dom.panel.dataset.typePage || "",
    journal: dom.panel.dataset.typeJournal || "",
    work: dom.panel.dataset.typeWork || "",
    talent: dom.panel.dataset.typeTalent || "",
  };

  let entries: SearchEntry[] | null = null;
  let loading: Promise<SearchEntry[]> | null = null;

  function loadIndex(): Promise<SearchEntry[]> {
    if (entries) return Promise.resolve(entries);
    if (loading) return loading;
    loading = fetch(indexUrl)
      .then((res) => (res.ok ? res.json() : []))
      .then((data: SearchEntry[]) => {
        entries = data;
        return data;
      })
      .catch(() => []);
    return loading;
  }

  function renderResults(matches: SearchEntry[]) {
    dom.resultsList.innerHTML = "";
    if (matches.length === 0) {
      dom.hint.textContent = noResultsText;
      dom.hint.classList.remove("hidden");
      return;
    }
    dom.hint.classList.add("hidden");
    const fragment = document.createDocumentFragment();
    matches.slice(0, 20).forEach((entry) => {
      const node = dom.template.content.cloneNode(true) as DocumentFragment;
      const link = node.querySelector("a");
      const title = node.querySelector<HTMLElement>("[data-result-title]");
      const description = node.querySelector<HTMLElement>("[data-result-description]");
      const type = node.querySelector<HTMLElement>("[data-result-type]");
      if (link) link.href = entry.url;
      if (title) title.textContent = entry.title;
      if (description) description.textContent = entry.description;
      if (type) type.textContent = typeLabels[entry.type] || "";
      fragment.appendChild(node);
    });
    dom.resultsList.appendChild(fragment);
  }

  function runSearch(query: string) {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) {
      dom.resultsList.innerHTML = "";
      dom.hint.classList.remove("hidden");
      return;
    }
    loadIndex().then((data) => {
      const matches = data.filter(
        (entry) => entry.title.toLowerCase().includes(trimmed) || entry.description.toLowerCase().includes(trimmed),
      );
      renderResults(matches);
    });
  }

  function openSearch() {
    dom.panel.classList.remove("pointer-events-none");
    dom.panel.classList.add("opacity-100");
    dom.panel.removeAttribute("inert");
    dom.panel.setAttribute("aria-hidden", "false");
    triggers.forEach((trigger) => trigger.setAttribute("aria-expanded", "true"));
    document.body.style.overflow = "hidden";
    loadIndex();
    window.setTimeout(() => dom.input.focus(), 50);
  }

  function closeSearch() {
    dom.panel.classList.add("pointer-events-none");
    dom.panel.classList.remove("opacity-100");
    dom.panel.setAttribute("inert", "");
    dom.panel.setAttribute("aria-hidden", "true");
    triggers.forEach((trigger) => trigger.setAttribute("aria-expanded", "false"));
    document.body.style.overflow = "";
    dom.input.value = "";
    dom.resultsList.innerHTML = "";
    dom.hint.classList.remove("hidden");
  }

  triggers.forEach((trigger) => trigger.addEventListener("click", openSearch));
  dom.closeButton.addEventListener("click", closeSearch);
  dom.panel.addEventListener("click", (event) => {
    if (event.target === dom.panel) closeSearch();
  });
  dom.input.addEventListener("input", () => runSearch(dom.input.value));
  document.addEventListener("keydown", (event) => {
    const isOpen = dom.panel.getAttribute("aria-hidden") === "false";
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      isOpen ? closeSearch() : openSearch();
      return;
    }
    if (event.key === "Escape" && isOpen) closeSearch();
  });
}
