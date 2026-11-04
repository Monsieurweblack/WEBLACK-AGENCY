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
  GSAP + ScrollTrigger et leurs initialisations. Soldé en partie : les
  apparitions [data-reveal] n'utilisent plus GSAP (IntersectionObserver +
  Web Animations) ; GSAP ne se charge plus qu'à la demande (menu, modale
  fondateur, filtre journal).
- **LCP NTA au-dessus du budget — BLOQUANT pour la mise en production.**
  Diagnostic final (2026-11-04, Lighthouse mobile devtools, traces Chrome
  conservées) sur `b56ad35` : élément LCP = <img> du bandeau, carré
  portrait AVIF 117 Ko, préchargé depuis le <head>, priorité High.
  Phases (runs 2–4) : TTFB 94–148 ms ; délai de chargement 653–727 ms =
  l'aller-retour du document lui-même (l'image part au premier octet du
  HTML, la découverte est déjà immédiate) ; durée de chargement
  1 500–1 741 ms pour 117 Ko, au lieu d'~1,2 s seule, parce que les deux
  fontes (91 Ko, demandées au premier rendu ~1,1–1,4 s) partagent le lien ;
  délai de rendu 77–441 ms, quand une passe de mise en page complète
  (150–315 ms à CPU ×4, déclenchée par la bascule d'une fonte) tombe à
  l'arrivée de l'image. Une passe coûte ~200 ms même corps masqué : coût
  porté par les déclarations @font-face des polices variables, pas par le
  contenu (bissection en transit, page vide témoin : 59 ms).
  Plancher sous ce bridage : aller-retour du document (~0,75 s) + celui de
  l'image (~0,56 s) + 117 Ko seuls (~0,65 s) + rendu ≈ 2,05 s ; il reste
  ~0,45 s pour la fin du HTML et les 91 Ko de fontes. Tant que les fontes
  partagent cette fenêtre, la médiane reste au-dessus de 2,5 s.
  Mesuré et non retenu : Fraunces figée à wght=400 (35 Ko au lieu de 67,
  opsz conservé ; avances ±1/16 px, 0,02 % par ligne) → 2,63 s contre 2,81 s
  dans la même série, toujours au-dessus. Arrêt des modifications
  spéculatives conformément à la consigne.
- **Rebuilds Sanity de main en échec depuis le 2026-10-31.** Le déploiement
  0655d659 (deploy hook, 20:09 UTC) a échoué au contrôle d'intégrité : la
  version anglaise de l'article NTA n'existe plus qu'en brouillon, et main
  porte encore l'alias. La production reste figée sur le contenu du
  31 octobre 14:47 tant que PR 0 (qui retire l'alias) n'est pas promue.
- **URL /en/journal/partenariat-nuit-du-textile-africain/.** Redirection
  temporaire 302 vers l'article français (public/_redirects, validée le
  2026-11-04). À retirer dès qu'une version anglaise validée est publiée.
- **robots.txt de production.** Cloudflare (« Manage robots.txt ») préfixe
  le fichier du dépôt d'un bloc géré : signaux de contenu (ai-train=no) et
  ~30 robots bloqués, dont deux moteurs de recherche (Baiduspider,
  PetalBot). Les règles du dépôt (/admin/, /api/) restent appliquées
  (groupes User-agent: * fusionnés, RFC 9309). Réglage Cloudflare inchangé.
- **Retour arrière : test réel impossible sans changer de version.**
  Cloudflare refuse un retour arrière vers le déploiement déjà actif
  (8000039, 2026-11-04) ; le point d'API et les droits sont vérifiés. Le
  premier retour arrière réel possible est celui de P0 vers 1123af48.
- **Nommage des branches.** `immersive/pr-N-slug` est impossible à côté
  d'une branche `immersive` (Git ne peut pas avoir `refs/heads/immersive` à
  la fois fichier et dossier) : repli `immersive-pr-N-slug`.
