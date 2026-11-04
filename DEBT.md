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
  Lighthouse mobile, bridage devtools (562 ms RTT simulé, 1,47 Mb/s), run 1
  écarté, médiane des runs 2–4, aperçus Cloudflare mesurés en alternance.
  `/talent/` est SOLDÉ (2,13 s, `6fa7a65` ; 1983–2324 ms en alternance).
  `/selected-work/nuit-du-textile-africain-nta/` après l'option A
  (polices de repli calibrées, fontes non préchargées sur les pages à image
  LCP) : 2602/2557/2603 ms → 2,60 s (`d4cd9ed`), contre 2754/2774/2815 ms
  pour `463b8ab` dans la même série. CLS 0,004 inchangé.
  Ce qui reste : l'image (117 Ko) puis les fontes demandées au premier
  rendu (~1 s) se partagent encore la bande passante jusqu'à ~2,4 s.
  Essayé et non retenu sans décision du propriétaire : fontes demandées
  seulement après l'image LCP (classe .defer-fonts libérée avec
  .defer-media) — NTA 2,03 s en local, CLS 0,004, mais la vraie typographie
  arrive ~2 s plus tard en 4G lente et un bref flash de police de repli
  devient systématique sur réseau rapide (correctif conservé hors dépôt).
  Repli calibré de Manrope (Arial) essayé puis retiré : il décalait l'encart
  de la page candidature (CLS 0,016 contre 0,001) et coûtait ~150 ms de TBT.
- **Rebuilds Sanity de main en échec depuis le 2026-10-31.** Le déploiement
  0655d659 (deploy hook, 20:09 UTC) a échoué au contrôle d'intégrité : la
  version anglaise de l'article NTA n'existe plus qu'en brouillon, et main
  porte encore l'alias. La production reste figée sur le contenu du
  31 octobre 14:47 tant que PR 0 (qui retire l'alias) n'est pas promue.
- **URL /en/journal/partenariat-nuit-du-textile-africain/.** Servie en
  production (construite le 31 octobre), absente du candidat : son document
  anglais n'est plus publié (brouillon drafts.92f10d44…). Sans publication,
  elle deviendrait 404 à la promotion. Redirection temporaire proposée,
  non appliquée, en attente de validation.
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
