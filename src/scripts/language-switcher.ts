let initialized = false;

export function initLanguageSwitcher() {
  if (initialized) return;
  initialized = true;

  const switchers = Array.from(document.querySelectorAll<HTMLElement>("[data-language-switcher]"));
  if (switchers.length === 0) return;

  function getParts(switcher: HTMLElement) {
    const trigger = switcher.querySelector<HTMLButtonElement>("[data-language-trigger]");
    const menu = switcher.querySelector<HTMLUListElement>("[data-language-menu]");
    return trigger && menu ? { trigger, menu } : null;
  }

  function isOpen(trigger: HTMLButtonElement) {
    return trigger.getAttribute("aria-expanded") === "true";
  }

  function open(trigger: HTMLButtonElement, menu: HTMLUListElement) {
    closeAll();
    trigger.setAttribute("aria-expanded", "true");
    menu.dataset.state = "open";
    menu.removeAttribute("inert");
  }

  function close(trigger: HTMLButtonElement, menu: HTMLUListElement, focusTrigger = false) {
    trigger.setAttribute("aria-expanded", "false");
    menu.dataset.state = "closed";
    menu.setAttribute("inert", "");
    if (focusTrigger) trigger.focus();
  }

  function closeAll(focusTriggerOf?: HTMLElement) {
    for (const switcher of switchers) {
      const parts = getParts(switcher);
      if (!parts) continue;
      if (isOpen(parts.trigger)) close(parts.trigger, parts.menu, switcher === focusTriggerOf);
    }
  }

  function menuItems(menu: HTMLUListElement) {
    return Array.from(menu.querySelectorAll<HTMLAnchorElement>('a[role="menuitemradio"]'));
  }

  for (const switcher of switchers) {
    const parts = getParts(switcher);
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
        // Tabbing out of the menu closes it rather than leaving an open,
        // unreachable dropdown behind focus.
        close(trigger, menu);
      }
    });
  }

  document.addEventListener("click", (event) => {
    const target = event.target as Node;
    for (const switcher of switchers) {
      if (switcher.contains(target)) continue;
      const parts = getParts(switcher);
      if (parts && isOpen(parts.trigger)) close(parts.trigger, parts.menu);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    for (const switcher of switchers) {
      const parts = getParts(switcher);
      if (parts && isOpen(parts.trigger)) close(parts.trigger, parts.menu, true);
    }
  });
}
