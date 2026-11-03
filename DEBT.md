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
- **Retour arrière : test réel en attente.** `scripts/rollback-production.mjs`
  testé en `--dry-run` (cibles résolues, commit inconnu refusé). Le test réel
  sans effet visible (bascule vers le déploiement déjà actif) touche la
  production : il attend le feu vert, juste avant la promotion P0.
- **LCP NTA au-dessus du budget — BLOQUANT pour la mise en production.**
  Lighthouse mobile, bridage devtools (562 ms RTT simulé, 1,47 Mb/s), run 1
  écarté, médiane des runs 2–4, aperçu Cloudflare.
  `/talent/` est SOLDÉ : 2088/2092/2089 ms → 2,09 s (`ba33434`).
  `/selected-work/nuit-du-textile-africain-nta/` : 2685/2647/2591 ms →
  2,65 s (`ba33434`) ; 2580/2913/3005 ms → 2,91 s (`4da2795`, code de la
  route identique, écart de réseau entre séries). Production : 7,61 s.
  Ce qui reste : premier octet du HTML à ~750 ms (un aller-retour simulé),
  puis l'image (117 Ko, carré portrait AVIF q90 4:4:4) partage la bande
  passante avec les deux fontes préchargées (91 Ko) jusqu'à ~2,6 s.
  Écartés sur mesures : effort AVIF 9 (pas de gain à q90), fontes non
  préchargées (talent 2,22 s mais CLS jusqu'à 0,36 : la bascule de police
  décale le bloc de titre ancré en bas du bandeau), fontes en priorité basse
  (sans effet sous ce bridage). Pistes restantes, chacune avec un coût à
  arbitrer : polices de repli à métriques ajustées (size-adjust) pour
  retirer le préchargement des fontes sans décalage — validation multi-
  appareils nécessaire ; une couverture NTA moins texturée (choix
  éditorial) ; un encodage différent du seul bandeau (touche D-6).
- **Nommage des branches.** `immersive/pr-N-slug` est impossible à côté
  d'une branche `immersive` (Git ne peut pas avoir `refs/heads/immersive` à
  la fois fichier et dossier) : repli `immersive-pr-N-slug`.
