/**
 * Contrôleur du sélecteur de profil du header (WorkWithPicker.astro).
 *
 * Délibérément écrit sur le même contrat que src/scripts/language-switcher.ts
 * (ouverture/fermeture, Échap, clic à l'extérieur, navigation aux flèches)
 * plutôt que de le réutiliser tel quel : ses attributs `data-language-*`
 * sont spécifiques à ce composant, et le généraliser aurait touché un
 * contrôleur déjà en production pour un chantier qui ne le concerne pas.
 * Si un troisième menu du même genre apparaît, ce sera le bon moment
 * d'en extraire une base commune — pas avant.
 */
let initialized = false;

export function initWorkWithPicker() {
  if (initialized) return;
  initialized = true;

  const pickers = Array.from(document.querySelectorAll<HTMLElement>("[data-workwith-picker]"));
  if (pickers.length === 0) return;

  function getParts(picker: HTMLElement) {
    const trigger = picker.querySelector<HTMLButtonElement>("[data-workwith-trigger]");
    const menu = picker.querySelector<HTMLDivElement>("[data-workwith-menu]");
    return trigger && menu ? { trigger, menu } : null;
  }

  function isOpen(trigger: HTMLButtonElement) {
    return trigger.getAttribute("aria-expanded") === "true";
  }

  function open(trigger: HTMLButtonElement, menu: HTMLDivElement) {
    closeAll();
    trigger.setAttribute("aria-expanded", "true");
    menu.dataset.state = "open";
    menu.removeAttribute("inert");
  }

  function close(trigger: HTMLButtonElement, menu: HTMLDivElement, focusTrigger = false) {
    trigger.setAttribute("aria-expanded", "false");
    menu.dataset.state = "closed";
    menu.setAttribute("inert", "");
    if (focusTrigger) trigger.focus();
  }

  function closeAll(focusTriggerOf?: HTMLElement) {
    for (const picker of pickers) {
      const parts = getParts(picker);
      if (!parts) continue;
      if (isOpen(parts.trigger)) close(parts.trigger, parts.menu, picker === focusTriggerOf);
    }
  }

  function menuItems(menu: HTMLDivElement) {
    return Array.from(menu.querySelectorAll<HTMLAnchorElement>('a[role="menuitem"]'));
  }

  for (const picker of pickers) {
    const parts = getParts(picker);
    if (!parts) continue;
    const { trigger, menu } = parts;

    trigger.addEventListener("click", () => {
      if (isOpen(trigger)) close(trigger, menu);
      else open(trigger, menu);
    });

    trigger.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        open(trigger, menu);
        const items = menuItems(menu);
        (event.key === "ArrowDown" ? items[0] : items[items.length - 1])?.focus();
      }
    });

    menu.addEventListener("keydown", (event) => {
      const items = menuItems(menu);
      const currentIndex = items.indexOf(document.activeElement as HTMLAnchorElement);

      if (event.key === "ArrowDown") {
        event.preventDefault();
        items[(currentIndex + 1) % items.length]?.focus();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        items[(currentIndex - 1 + items.length) % items.length]?.focus();
      } else if (event.key === "Home") {
        event.preventDefault();
        items[0]?.focus();
      } else if (event.key === "End") {
        event.preventDefault();
        items[items.length - 1]?.focus();
      } else if (event.key === "Tab") {
        close(trigger, menu);
      }
    });
  }

  document.addEventListener("click", (event) => {
    const target = event.target as Node;
    for (const picker of pickers) {
      if (picker.contains(target)) continue;
      const parts = getParts(picker);
      if (parts && isOpen(parts.trigger)) close(parts.trigger, parts.menu);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    for (const picker of pickers) {
      const parts = getParts(picker);
      if (parts && isOpen(parts.trigger)) close(parts.trigger, parts.menu, true);
    }
  });
}
