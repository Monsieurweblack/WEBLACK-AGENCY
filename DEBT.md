# Dette technique — refonte « LE MÉTIER »

Chaque entrée : où, constat mesuré, pourquoi elle n'est pas soldée, quand la reprendre.

## PR 0 — assainissement

- **Contraste AA, thème clair.** Le thème sombre (défaut) passe AA après PR 0
  (`text-(--color-paper)/50` : 5,02:1). Dans le thème clair (bascule
  ThemeToggle), `/50` donne 3,46:1 et `/55` 4,05:1 sur `#f5f3ee` ; il faut
  ≥ `/60` (4,78:1). Un seul niveau Tailwind ne peut pas satisfaire les deux
  thèmes sans éclaircir fortement la hiérarchie du thème sombre : demande un
  token de texte secondaire par thème. À reprendre en PR 1 (socle, tokens).
- **Contraste, candidature talents.** `TalentApplicationForm.astro` (9
  occurrences `/40`) et `TalentApplicationPdfLinks.astro` (1, « · PDF
  REMPLISSABLE », 3,55:1) laissés tels quels : D-5 n'autorise dans ces
  fichiers que les trois ajouts de surface. Lighthouse accessibilité
  /talent/candidature : 96 (contre 99 ailleurs). À trancher en PR 6.
- **Lighthouse accessibilité, deux constats préexistants** sur toutes les
  pages, identiques sur main : `image-redundant-alt` (logo du header, alt
  « WEBLACK » à côté du texte « WEBLACK ») et `label-content-name-mismatch`
  (bouton de langue). Hors périmètre PR 0.
- **Images Sanity hors RemoteImage.** La galerie de la modale fondateur
  (`FounderBioModal.astro`, chargement différé, dans une modale) et les logos
  partenaires (`PartnersPreview.astro`) gardent une URL unique `?w=1600` sans
  srcset ni dimensions. Les balises de partage (`og:image`, `twitter:image`,
  JSON-LD) aussi, volontairement (une seule URL attendue).
- **Coût de compilation.** Build à froid 220 s (contre ~25 s avant) : ~130
  variantes AVIF q90 / WebP q95 encodées par sharp. Le cache
  `node_modules/.astro` le ramène à ~30 s en local ; Cloudflare ne le
  conserve pas. Marge large sous la limite de 20 min, à surveiller si le
  nombre de photos croît.
- **TBT mesuré (devtools, CPU ×4) ≈ 1,27 s sur l'accueil, identique à main** :
  GSAP + ScrollTrigger et leurs initialisations. Hors périmètre PR 0 ; le
  socle PR 1 (orchestrateur unique) doit le réduire.
- **Retour arrière : test réel en attente.** `scripts/rollback-production.mjs`
  testé en `--dry-run` (cibles résolues, commit inconnu refusé). Le test réel
  sans effet visible (bascule vers le déploiement déjà actif) touche la
  production : il attend le feu vert, juste avant la promotion P0.
- **LCP au-dessus du budget sur deux routes** (Lighthouse mobile, bridage
  devtools, médiane runs 2–4, aperçu Cloudflare) :
  `/selected-work/nuit-du-textile-africain-nta/` 5,34 s (production 7,61 s) et
  `/talent/` 2,59 s (production 3,65 s). PR 0 améliore, n'atteint pas
  2,5 s. Cause NTA : variante 800 px AVIF q90 de la photo textile = 167 Ko
  (texture dense), téléchargée en concurrence avec ~400 Ko de galerie
  (images différées, mais dans le seuil de chargement anticipé de Chrome en
  réseau lent). Baisser la qualité gagnerait ~50 Ko (q80 : 117 Ko) au prix
  de plus d'aplatissement (31 → 37 %) sur une photo à 11 % de dégradés
  sombres : écarté (D-6). Préchargement en <head> écarté : l'image est déjà
  découverte par le préchargeur, le délai de 0,9 s est le HTML + un aller-
  retour. Pistes : ordonner le chargement de la galerie après le LCP
  (PR 1, orchestrateur), ou un recadrage dédié du visuel de couverture.
- **Nommage des branches.** `immersive/pr-N-slug` est impossible à côté
  d'une branche `immersive` (Git ne peut pas avoir `refs/heads/immersive` à
  la fois fichier et dossier) : repli `immersive-pr-N-slug`.
