let initialized = false;

/**
 * Filtrage de l'Agenda, côté client, sur ce qui est déjà dans la page.
 *
 * Aucun appel réseau : la liste est complète au chargement, et les critères
 * — période, discipline, ville, pays — ne font que masquer des lignes. Un
 * mois dont plus rien ne subsiste disparaît avec son titre, sinon la page
 * garderait des en-têtes suspendus au-dessus du vide.
 *
 * Sans JavaScript, tout reste visible : le filtre est un confort, jamais la
 * condition d'accès au contenu.
 */
export function initAgendaFilter() {
  if (initialized) return;
  initialized = true;

  const form = document.getElementById("agenda-filter") as HTMLFormElement | null;
  const list = document.getElementById("agenda-list");
  const emptyMessage = document.getElementById("agenda-empty");
  if (!form || !list) return;

  const events = Array.from(list.querySelectorAll<HTMLElement>("[data-event]"));
  const months = Array.from(list.querySelectorAll<HTMLElement>("[data-month]"));

  function valueOf(name: string): string {
    const field = form!.elements.namedItem(name);
    return field instanceof HTMLSelectElement ? field.value : "all";
  }

  function matches(event: HTMLElement): boolean {
    const period = valueOf("period");
    if (period !== "all" && event.dataset[period === "30" ? "within30" : "within90"] !== "true") return false;

    for (const [name, key] of [
      ["discipline", "discipline"],
      ["city", "city"],
      ["country", "country"],
      ["region", "region"],
    ] as const) {
      const selected = valueOf(name);
      if (selected !== "all" && event.dataset[key] !== selected) return false;
    }
    return true;
  }

  function apply() {
    let visible = 0;
    events.forEach((event) => {
      const shown = matches(event);
      event.hidden = !shown;
      if (shown) visible++;
    });

    months.forEach((month) => {
      const stillThere = Array.from(month.querySelectorAll<HTMLElement>("[data-event]")).some((e) => !e.hidden);
      month.hidden = !stillThere;
    });

    if (emptyMessage) emptyMessage.hidden = visible > 0;
  }

  form.addEventListener("change", apply);
  // `reset` est émis AVANT que les champs ne reprennent leur valeur initiale.
  form.addEventListener("reset", () => window.setTimeout(apply, 0));
}
