/**
 * Galerie produit immersive — clic/zoom, précédent/suivant, compteur,
 * fermeture, clavier, swipe mobile. Aucune librairie : le comportement est
 * simple (une image à la fois, une liste de sources déjà dans le DOM) et
 * l'architecture existante (voir newsletter-popup.ts pour le même principe
 * de dialogue accessible) suffit à le réaliser nativement.
 */
let initialized = false;

export function initProductGallery() {
  if (initialized) return;
  initialized = true;

  const root = document.querySelector<HTMLElement>("[data-product-gallery]");
  const dialogEl = document.querySelector<HTMLElement>("[data-product-gallery-dialog]");
  if (!root || !dialogEl) return;
  // Un nom distinct et une réassignation const-typée : les fonctions
  // imbriquées ci-dessous (déclarées `function`, pas des flèches) ne
  // conservent pas le rétrécissement de type de la garde ci-dessus sur la
  // variable d'origine — TypeScript a besoin de ce nouveau binding non-null.
  const dialog: HTMLElement = dialogEl;

  const thumbs = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-product-gallery-thumb]"));
  const sourcesTemplate = root.querySelector<HTMLTemplateElement>("[data-product-gallery-sources]");
  const sources = sourcesTemplate
    ? Array.from(sourcesTemplate.content.querySelectorAll<HTMLElement>("[data-src]")).map((el) => ({
        src: el.dataset.src ?? "",
        alt: el.dataset.alt ?? "",
      }))
    : [];
  if (!sources.length) return;

  const imageEl = dialog.querySelector<HTMLImageElement>("[data-product-gallery-image]");
  const counterEl = dialog.querySelector<HTMLElement>("[data-product-gallery-counter]");
  const closeBtn = dialog.querySelector<HTMLButtonElement>("[data-product-gallery-close]");
  const prevBtn = dialog.querySelector<HTMLButtonElement>("[data-product-gallery-prev]");
  const nextBtn = dialog.querySelector<HTMLButtonElement>("[data-product-gallery-next]");

  let currentIndex = 0;
  let lastFocused: HTMLElement | null = null;
  let touchStartX: number | null = null;

  function render() {
    const item = sources[currentIndex];
    if (!item || !imageEl) return;
    imageEl.src = item.src;
    imageEl.alt = item.alt;
    if (counterEl) counterEl.textContent = `${currentIndex + 1} / ${sources.length}`;
  }

  function open(index: number) {
    currentIndex = ((index % sources.length) + sources.length) % sources.length;
    lastFocused = document.activeElement as HTMLElement | null;
    render();
    dialog.classList.remove("hidden");
    dialog.classList.add("flex");
    document.body.style.overflow = "hidden";
    closeBtn?.focus();
    document.addEventListener("keydown", onKeydown);
  }

  function close() {
    dialog.classList.add("hidden");
    dialog.classList.remove("flex");
    document.body.style.overflow = "";
    document.removeEventListener("keydown", onKeydown);
    lastFocused?.focus();
  }

  function next() {
    open(currentIndex + 1);
  }
  function prev() {
    open(currentIndex - 1);
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      close();
      return;
    }
    if (event.key === "ArrowRight") next();
    if (event.key === "ArrowLeft") prev();
    if (event.key === "Tab") {
      const focusables = dialog.querySelectorAll<HTMLElement>('button:not([hidden])');
      if (!focusables.length) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  thumbs.forEach((thumb) => {
    thumb.addEventListener("click", () => open(Number(thumb.dataset.index ?? 0)));
  });
  closeBtn?.addEventListener("click", close);
  prevBtn?.addEventListener("click", prev);
  nextBtn?.addEventListener("click", next);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) close();
  });

  dialog.addEventListener(
    "touchstart",
    (event) => {
      touchStartX = event.touches[0]?.clientX ?? null;
    },
    { passive: true },
  );
  dialog.addEventListener(
    "touchend",
    (event) => {
      if (touchStartX === null) return;
      const endX = event.changedTouches[0]?.clientX ?? touchStartX;
      const delta = endX - touchStartX;
      if (Math.abs(delta) > 40) (delta < 0 ? next : prev)();
      touchStartX = null;
    },
    { passive: true },
  );
}
