const CLE = "weblack-newsletter-popup";
/** Le visiteur doit avoir lu la moitié d'une page avant qu'on lui demande quoi que ce soit. */
const SEUIL_LECTURE = 0.5;

let initialise = false;

/**
 * Fenêtre d'inscription à la lettre.
 *
 * Tout ce fichier tient à une idée : une fenêtre qui s'impose est une dette
 * envers le visiteur, et elle ne se rembourse que si elle arrive au bon
 * moment et ne revient jamais.
 *
 * D'où quatre verrous, dans cet ordre. Le service doit fonctionner — on le
 * demande à l'endpoint avant toute chose, car interrompre quelqu'un pour
 * lui annoncer une panne est pire que se taire. Le choix de consentement
 * doit être fait, pour ne pas empiler deux demandes sur un premier écran.
 * Le visiteur doit avoir lu la moitié d'une page. Et il ne doit ni l'avoir
 * fermée, ni s'être inscrit auparavant.
 *
 * Le refus est définitif : une fenêtre fermée ne revient pas. C'est la
 * seule façon qu'elle reste acceptable.
 */
export function initNewsletterPopup() {
  if (initialise) return;
  initialise = true;

  const popup = document.querySelector<HTMLElement>("[data-newsletter-popup]");
  if (!popup) return;

  if (dejaRepondu()) return;

  // Sans consentement exprimé, le bandeau occupe encore l'écran.
  if (!consentementDonne()) return;

  let arme = false;
  let ouvert = false;
  let dernierFocus: HTMLElement | null = null;

  function memoriser(valeur: string) {
    try {
      localStorage.setItem(CLE, valeur);
    } catch {
      /* stockage indisponible : la fenêtre se contentera de ne pas revenir dans cette session */
    }
  }

  function fermer() {
    if (!ouvert) return;
    ouvert = false;
    popup!.removeAttribute("data-open");
    document.documentElement.style.overflow = "";
    dernierFocus?.focus();
  }

  function ouvrir() {
    if (ouvert || dejaRepondu()) return;
    ouvert = true;
    dernierFocus = document.activeElement as HTMLElement | null;
    popup!.setAttribute("data-open", "");
    // Le fond ne défile pas derrière la fenêtre : on ne lit pas deux choses.
    document.documentElement.style.overflow = "hidden";
    popup!.querySelector<HTMLInputElement>('input[type="email"]')?.focus();
    memoriser("vu");
  }

  // Échap ferme, Tab reste dans la fenêtre : un dialogue modal dont le
  // clavier s'échappe n'est pas modal.
  popup.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      fermer();
      return;
    }
    if (event.key !== "Tab") return;
    const focusables = popup.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (!focusables.length) return;
    const premier = focusables[0]!;
    const dernier = focusables[focusables.length - 1]!;
    if (event.shiftKey && document.activeElement === premier) {
      event.preventDefault();
      dernier.focus();
    } else if (!event.shiftKey && document.activeElement === dernier) {
      event.preventDefault();
      premier.focus();
    }
  });

  popup.querySelector("[data-newsletter-popup-close]")?.addEventListener("click", () => {
    memoriser("ferme");
    fermer();
  });
  popup.querySelector("[data-newsletter-popup-veil]")?.addEventListener("click", () => {
    memoriser("ferme");
    fermer();
  });

  // Une inscription réussie vaut refus définitif : on ne redemande pas à
  // quelqu'un qui vient de dire oui.
  popup.querySelector("[data-newsletter-form]")?.addEventListener("submit", () => {
    window.setTimeout(() => {
      const forme = popup.querySelector<HTMLElement>("[data-newsletter-form]");
      if (forme?.dataset.state === "success") {
        memoriser("inscrit");
        window.setTimeout(fermer, 2200);
      }
    }, 1200);
  });

  function surDefilement() {
    if (!arme || ouvert) return;
    const hauteur = document.documentElement.scrollHeight - window.innerHeight;
    if (hauteur <= 0) return;
    if (window.scrollY / hauteur >= SEUIL_LECTURE) {
      window.removeEventListener("scroll", surDefilement);
      ouvrir();
    }
  }

  // Dernier verrou, et le plus important : le service répond-il ?
  fetch("/api/newsletter", { method: "GET" })
    .then((r) => (r.ok ? r.json() : { configured: false }))
    .then((data: { configured?: boolean }) => {
      if (!data.configured) return;
      arme = true;
      window.addEventListener("scroll", surDefilement, { passive: true });
      surDefilement();
    })
    .catch(() => {
      /* endpoint injoignable : la fenêtre ne s'arme pas, et c'est très bien */
    });
}

function dejaRepondu(): boolean {
  try {
    return Boolean(localStorage.getItem(CLE));
  } catch {
    return false;
  }
}

/**
 * Le bandeau de consentement écrit son choix sous cette clé (voir
 * src/scripts/consent.ts). Tant qu'il est à l'écran, la lettre attend son
 * tour : deux demandes empilées sur un même écran n'en obtiennent aucune.
 *
 * On relit donc exactement la forme que `readConsent()` exige pour se
 * taire — statut et booléen — et non la simple présence de la clé. Une
 * valeur tronquée ou d'un ancien schéma laisse le bandeau affiché ; la
 * tester comme une réponse valide aurait produit précisément
 * l'empilement que ce verrou existe pour empêcher.
 */
function consentementDonne(): boolean {
  try {
    const brut = localStorage.getItem("weblack-consent");
    if (!brut) return false;
    const valeur = JSON.parse(brut);
    return Boolean(valeur) && typeof valeur.analytics === "boolean" && typeof valeur.status === "string";
  } catch {
    return false;
  }
}
