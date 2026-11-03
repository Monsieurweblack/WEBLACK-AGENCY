/**
 * Profil d'appareil pour les couches de mouvement coûteuses (WebGL).
 * Volontairement minuscule et chargé statiquement : un appareil exclu ne
 * télécharge jamais le module qu'il n'exécuterait pas.
 *
 * « full » : tout le système. « lite » : CSS seulement (transitions, fil,
 * dévoilements), sans WebGL. « static » : préférence de mouvement réduit,
 * rien ne bouge.
 */
export type MotionProfile = "full" | "lite" | "static";

export function motionProfile(): MotionProfile {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return "static";
  const nav = navigator as Navigator & { connection?: { saveData?: boolean }; deviceMemory?: number };
  if (nav.connection?.saveData) return "lite";
  if ((nav.hardwareConcurrency ?? 8) < 4) return "lite";
  if ((nav.deviceMemory ?? 8) < 4) return "lite";
  return "full";
}
