/**
 * Lanceur MALYA : quelques octets sur chaque page. Le moteur conversationnel
 * (fenêtre, noyau, textes) n'est téléchargé qu'au premier survol, focus ou clic ;
 * aucun appel d'API n'est fait avant que l'utilisateur écrive ou ouvre la fenêtre.
 */
const button = document.getElementById("malya-launcher") as HTMLButtonElement | null;
if (button) {
  const lang = button.dataset.lang === "en" ? "en" : "fr";
  let chunk: Promise<typeof import("./malya-widget")> | undefined;
  const load = () => (chunk ??= import("./malya-widget"));
  button.addEventListener("pointerenter", () => void load(), { once: true });
  button.addEventListener("focus", () => void load(), { once: true });
  button.addEventListener("click", async () => {
    button.setAttribute("aria-busy", "true");
    try { await (await load()).openMalya(lang, button); } finally { button.removeAttribute("aria-busy"); }
  });
}
