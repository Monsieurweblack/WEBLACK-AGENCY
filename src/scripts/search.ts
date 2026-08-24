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
  const panel = document.getElementById("search-panel");
  const closeButton = document.getElementById("search-close");
  const input = document.getElementById("search-input") as HTMLInputElement | null;
  const hint = document.getElementById("search-hint");
  const resultsList = document.getElementById("search-results");
  const template = document.getElementById("search-result-template") as HTMLTemplateElement | null;
  if (triggers.length === 0 || !panel || !closeButton || !input || !hint || !resultsList || !template) return;

  const indexUrl = panel.dataset.indexUrl || "";
  const noResultsText = panel.dataset.noResults || "";
  const typeLabels: Record<SearchEntry["type"], string> = {
    page: panel.dataset.typePage || "",
    journal: panel.dataset.typeJournal || "",
    work: panel.dataset.typeWork || "",
    talent: panel.dataset.typeTalent || "",
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
    resultsList.innerHTML = "";
    if (matches.length === 0) {
      hint.textContent = noResultsText;
      hint.classList.remove("hidden");
      return;
    }
    hint.classList.add("hidden");
    const fragment = document.createDocumentFragment();
    matches.slice(0, 20).forEach((entry) => {
      const node = template.content.cloneNode(true) as DocumentFragment;
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
    resultsList.appendChild(fragment);
  }

  function runSearch(query: string) {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) {
      resultsList.innerHTML = "";
      hint.classList.remove("hidden");
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
    panel.classList.remove("pointer-events-none");
    panel.classList.add("opacity-100");
    panel.removeAttribute("inert");
    panel.setAttribute("aria-hidden", "false");
    triggers.forEach((trigger) => trigger.setAttribute("aria-expanded", "true"));
    document.body.style.overflow = "hidden";
    loadIndex();
    window.setTimeout(() => input.focus(), 50);
  }

  function closeSearch() {
    panel.classList.add("pointer-events-none");
    panel.classList.remove("opacity-100");
    panel.setAttribute("inert", "");
    panel.setAttribute("aria-hidden", "true");
    triggers.forEach((trigger) => trigger.setAttribute("aria-expanded", "false"));
    document.body.style.overflow = "";
    input.value = "";
    resultsList.innerHTML = "";
    hint.classList.remove("hidden");
  }

  triggers.forEach((trigger) => trigger.addEventListener("click", openSearch));
  closeButton.addEventListener("click", closeSearch);
  panel.addEventListener("click", (event) => {
    if (event.target === panel) closeSearch();
  });
  input.addEventListener("input", () => runSearch(input.value));
  document.addEventListener("keydown", (event) => {
    const isOpen = panel.getAttribute("aria-hidden") === "false";
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      isOpen ? closeSearch() : openSearch();
      return;
    }
    if (event.key === "Escape" && isOpen) closeSearch();
  });
}
