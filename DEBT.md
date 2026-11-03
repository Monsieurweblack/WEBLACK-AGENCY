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
- **LCP au-dessus du budget sur deux routes — BLOQUANT pour la mise en
  production.** Lighthouse mobile, bridage devtools (562 ms RTT simulé,
  1,47 Mb/s), médiane runs 2–4. Mesures après `0914350` (préchargement de
  l'image LCP depuis le <head>, galerie NTA retenue jusqu'à l'arrivée du
  bandeau) : aperçu Cloudflare `/talent/` 2,64 s (PR 0 : 2,59 s ;
  production 3,65 s), NTA 3,00 s (PR 0 : 5,34 s ; production 7,61 s).
  Le préchargement fonctionne (l'image part au premier octet du HTML, à
  765 ms) : la limite est désormais la bande passante, HTML puis image +
  fontes. Trois variantes mesurées sur le même banc (Lighthouse local) :
  A, état actuel, talent 2,79 s / NTA 2,90 s ; B, fontes non préchargées,
  talent 2,22 s mais CLS jusqu'à 0,36 (la bascule de police décale le bloc
  de titre ancré en bas du bandeau) — écartée ; C, fontes préchargées en
  priorité basse, talent 2,82 s / NTA 2,90 s — sans effet, écartée.
  Passer sous 2,5 s exige d'envoyer moins d'octets d'image (NTA : 166 Ko
  pour la variante 800 px AVIF q90 d'une photo textile dense), donc un
  recadrage portrait mobile ou un réglage d'encodage du bandeau : touche la
  règle D-6, décision du propriétaire.
- **Nommage des branches.** `immersive/pr-N-slug` est impossible à côté
  d'une branche `immersive` (Git ne peut pas avoir `refs/heads/immersive` à
  la fois fichier et dossier) : repli `immersive-pr-N-slug`.
