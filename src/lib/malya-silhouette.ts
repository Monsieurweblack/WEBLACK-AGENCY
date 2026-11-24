/**
 * Silhouette MALYA — illustration vectorielle ORIGINALE (aucune photographie, aucune banque d'images,
 * aucun logo ni dessin de maison de couture). Croquis de mode : mannequin féminin élancé, posture
 * naturelle et assurée, robe-fourreau à traîne, main sur la hanche. Une seule identité, deux déclinaisons :
 *  - SILHOUETTE_FULL : écran d'accueil, en-têtes, Project Builder, attente ;
 *  - SILHOUETTE_ICON : lanceur (quelques centaines d'octets, intégré à chaque page).
 * Couleurs via variables CSS (--m-gold, --m-ivory) : elle suit le thème clair de MALYA.
 */
const BODY = "M49 50c6-2.5 17-3.5 23-1.500 2 6.500.500 19.500-3.500 31.500-2 6-1.500 11 1.500 18 4 10 4.500 18 6 28 4 34 16 79 30 110-22 9-62 9-91 2 18-35 27-78 30-112 1.500-10 2-18 6-28 2.500-7 2.500-12 .500-18-4-12-5-24-2.500-30z";
export const SILHOUETTE_FULL = `<svg class="malya-figure" viewBox="0 0 120 250" role="img" aria-label="MALYA" xmlns="http://www.w3.org/2000/svg" focusable="false">
<path d="M57 31l-.4 17c2 1.200 4.800 1.200 6.800 0L63 31z" fill="var(--m-gold)" opacity=".85"/>
<ellipse cx="60" cy="21.500" rx="7.600" ry="10" fill="var(--m-gold)"/>
<circle cx="66.500" cy="12.500" r="5" fill="var(--m-gold)"/>
<path d="${BODY}" fill="var(--m-gold)"/>
<path d="M72.500 51c10.500 7 17.500 25 11.500 41-2 5.500-5 10-8 14" fill="none" stroke="var(--m-gold)" stroke-width="3" stroke-linecap="round"/>
<path d="M49 52c-6 16-8.500 38-7.500 60" fill="none" stroke="var(--m-gold)" stroke-width="2.700" stroke-linecap="round"/>
<path d="M52 51c6 8 12 8 18 0M52 88c6 3 12 3 17 0" fill="none" stroke="var(--m-ivory)" stroke-width="1" stroke-linecap="round" opacity=".8"/>
<path d="M63 112c1 38 8 84 20 122M54 120c-1 40-8 82-22 112" fill="none" stroke="var(--m-ivory)" stroke-width=".8" stroke-linecap="round" opacity=".4"/>
</svg>`;

export const SILHOUETTE_ICON = `<svg viewBox="0 0 120 250" aria-hidden="true" focusable="false" fill="currentColor"><ellipse cx="60" cy="21.500" rx="7.600" ry="10"/><circle cx="66.500" cy="12.500" r="5"/><path d="${BODY}"/><path d="M72.500 51c10.500 7 17.500 25 11.500 41M49 52c-6 16-8.500 38-7.500 60" fill="none" stroke="currentColor" stroke-width="3.400" stroke-linecap="round"/></svg>`;
