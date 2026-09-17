const CLE = "weblack-newsletter-popup";

/**
 * Un quart de la page lu : le visiteur est entré dans le sujet, et il est
 * encore là. Attendre la moitié, c'est demander à ceux qui restent le
 * moins — or ceux-là sont déjà convaincus.
 */
const PART_LUE = 0.25;

/**
 * En dessous de cette course, un pourcentage ne veut plus rien dire : sur
 * une page qui ne défile que de trois cents pixels, 25 % est franchi au
 * premier geste du pouce, avant que quoi que ce soit ait été lu. Ces pages
 * basculent sur le temps de présence.
 */
const COURSE_UTILE = 700;

/** Ce qu'on attend sur une page trop courte pour défiler : le temps d'une lecture, pas d'un survol. */
const PRESENCE_MINIMALE = 18_000;

/** Cadence de la veille. Assez lente pour être invisible, assez rapide pour ne pas manquer le moment. */
const CADENCE = 1_000;

let initialise = false;

/**
 * Fenêtre d'inscription à la lettre.
 *
 * Tout ce fichier tient à une idée : une fenêtre qui s'impose est une dette
 * envers le visiteur, et elle ne se rembourse que si elle arrive au bon
 * moment et ne revient jamais.
 *
 * D'où quatre verrous d'armement, dans cet ordre. Le service doit
 * fonctionner — on le demande à l'endpoint avant toute chose, car
 * interrompre quelqu'un pour lui annoncer une panne est pire que se taire.
 * Le choix de consentement doit être fait, pour ne pas empiler deux
 * demandes sur un premier écran. Le visiteur doit avoir lu. Et il ne doit
 * ni l'avoir fermée, ni s'être inscrit auparavant.
 *
 * « Avoir lu » ne se mesure pas de la même façon partout, d'où deux
 * signaux plutôt qu'un seuil unique — voir `signalDeLecture()`.
 *
 * S'ajoutent deux retenues de courtoisie, qui ne désarment rien mais
 * ajournent : on ne coupe pas quelqu'un qui écrit, et on ne réclame pas en
 * fenêtre un formulaire déjà présent à l'écran.
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
  let presenceMs = 0;
  let veille: number | null = null;
  let mesureDemandee = false;

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
    desarmer();
    dernierFocus = document.activeElement as HTMLElement | null;
    popup!.setAttribute("data-open", "");
    // Le fond ne défile pas derrière la fenêtre : on ne lit pas deux choses.
    document.documentElement.style.overflow = "hidden";
    popup!.querySelector<HTMLInputElement>('input[type="email"]')?.focus();
    memoriser("vu");
  }

  /**
   * Le signal de lecture, mesuré différemment selon ce que la page permet.
   *
   * Une page longue se mesure au défilement : un quart parcouru dit que le
   * visiteur lit. Une page courte — une fiche talent sur un grand écran,
   * une page de contact, un mobile en paysage — n'offre pas cette course ;
   * s'en tenir au pourcentage y produirait l'un des deux échecs
   * symétriques : ouverture au premier geste, ou jamais d'ouverture.
   *
   * La hauteur est relue à chaque passage plutôt que mise en cache : les
   * images qui arrivent, la barre d'URL mobile qui se rétracte et les
   * sections révélées au défilement la changent en cours de route.
   */
  function signalDeLecture(): boolean {
    const course = document.documentElement.scrollHeight - window.innerHeight;
    if (course >= COURSE_UTILE) return window.scrollY / course >= PART_LUE;
    return presenceMs >= PRESENCE_MINIMALE;
  }

  /**
   * Deux moments où proposer serait mal élevé, et où l'on se contente
   * d'attendre le suivant.
   *
   * Recouvrir un champ en cours de saisie fait perdre le fil et, sur
   * mobile, referme le clavier : une candidature Talent à demi écrite vaut
   * plus qu'une inscription à une lettre.
   *
   * Et si le formulaire du pied de page est déjà sous les yeux, une
   * fenêtre qui réclame la même chose par-dessus ne se lit pas comme une
   * invitation mais comme un défaut.
   */
  function momentMalvenu(): boolean {
    const actif = document.activeElement;
    if (actif instanceof HTMLInputElement || actif instanceof HTMLTextAreaElement || actif instanceof HTMLSelectElement) {
      return true;
    }
    return formulaireDejaVisible();
  }

  function formulaireDejaVisible(): boolean {
    for (const forme of document.querySelectorAll<HTMLElement>("[data-newsletter-form]")) {
      if (popup!.contains(forme)) continue;
      const r = forme.getBoundingClientRect();
      if (r.bottom > 0 && r.top < window.innerHeight) return true;
    }
    return false;
  }

  function verifier() {
    if (!arme || ouvert || momentMalvenu()) return;
    if (signalDeLecture()) ouvrir();
  }

  // Le défilement arrive par rafales ; lire la hauteur du document à
  // chacune ferait recalculer la mise en page en pleine course. Une seule
  // mesure par image suffit.
  function surDefilement() {
    if (mesureDemandee) return;
    mesureDemandee = true;
    requestAnimationFrame(() => {
      mesureDemandee = false;
      verifier();
    });
  }

  function battement() {
    if (document.visibilityState === "visible") presenceMs += CADENCE;
    verifier();
  }

  function desarmer() {
    arme = false;
    window.removeEventListener("scroll", surDefilement);
    document.removeEventListener("focusout", verifier);
    if (veille !== null) window.clearInterval(veille);
    veille = null;
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

  // Dernier verrou, et le plus important : le service répond-il ?
  fetch("/api/newsletter", { method: "GET" })
    .then((r) => (r.ok ? r.json() : { configured: false }))
    .then((data: { configured?: boolean }) => {
      if (!data.configured) return;
      arme = true;
      window.addEventListener("scroll", surDefilement, { passive: true });
      // Un champ quitté, c'est peut-être le moment ajourné qui redevient bon.
      document.addEventListener("focusout", verifier);
      veille = window.setInterval(battement, CADENCE);
      verifier();
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
