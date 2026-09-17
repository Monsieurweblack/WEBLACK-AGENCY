# TODO_CHIRURGICAL — audit weblack.fr

Audit mené sur le dépôt réel et sur le build de production, le 17 septembre 2026.
Tout ce qui suit est mesuré, pas supposé : chaque constat renvoie à un fichier ou
à une sortie de commande reproductible.

**Stack réelle** — Astro (SSG, aucun adaptateur SSR) · Tailwind v4 CSS-first
(`@theme` dans `src/styles/global.css`) · Fraunces + Manrope auto-hébergées
(`@fontsource-variable`) · GSAP/ScrollTrigger en vanilla · Sanity lu au build ·
Cloudflare Pages.

---

## 0. Trois prémisses de la commande que l'audit infirme

À vérifier avant d'engager du travail sur ces bases.

| Prémisse | Mesure | Verdict |
|---|---|---|
| « hiérarchie sémantique plate », « sauts de balises » | Accueil 25 titres, Journal 13, Agenda 14, Talent 3 — **un seul `h1` par page, zéro saut** sur les quatre | **Infirmée.** Rien à corriger |
| « le minimalisme actuel est inerte » | `src/scripts/gsap/scroll-choreography.ts` : reveals au scroll, compteurs animés, GSAP chargé en `requestIdleCallback`, `prefers-reduced-motion` respecté | **Infirmée.** La choréographie existe et est déjà différée |
| Tunnel de contact à scinder en deux flux | `src/components/forms/ContactForm.astro` : entrée déjà segmentée à 6 profils, dont Brand et Talent | **Déjà fait.** Le travail restant est d'accessibilité, pas de structure |

Une quatrième, issue de mon propre pré-diagnostic, s'est révélée fausse et
mérite d'être consignée : j'ai d'abord soupçonné les sous-ensembles de police
cyrillique / grec / vietnamien d'être du poids mort. Vérification faite, les
**9 `@font-face` portent tous un `unicode-range`** : ces fichiers sont déclarés
et jamais téléchargés sur une page FR/EN. Aucun correctif n'était nécessaire.

---

## P0 — À traiter en premier

### P0.1 · Le contrôle d'intégrité est rouge et ne bloque rien
`npm run integrity` sort **2 erreurs et 7 avertissements**, et rien ne l'exécute
avant un déploiement.

- **Erreur réelle en production** : le `coverImage` du partenaire *ZE DEFILE by
  WAXFASHION* pointe vers `https://www.facebook.com/Waxfashionparis/` — une page
  HTML, pas une image. Elle est cassée en ligne.
- 2 hotlinks `i.pinimg.com` sur l'étude de cas *Nuit du Textile Africain*.

**Correctif** — corriger les URL dans Sanity, puis brancher le contrôle :
```jsonc
// package.json — "scripts"
"prebuild": "npm run integrity"
```
⚠️ Ne pas brancher `prebuild` **avant** d'avoir corrigé les 2 erreurs : le build
Cloudflare échouerait et bloquerait tout déploiement.

### P0.2 · 20 images tierces hotlinkées, dont des portraits de talents
Relevé sur le build : `images.unsplash.com` ×17, `i.pinimg.com` ×2,
`www.facebook.com` ×1.

Le point sensible n'est pas la performance : **les portraits des talents
Zanele Dlamini, Efua Boateng et Kwame Mensah sont des photos de banque
d'images Unsplash.** Pour une agence de management de talents, présenter des
personnes par des photos d'inconnus est un problème de représentation avant
d'être un problème technique — et il touche à la discipline de non-fabrication
du projet.

**Décision requise (humaine, pas technique)** : ces fiches correspondent-elles à
des talents réels ? Si oui, remplacer par leurs vrais portraits. Sinon, les
dépublier.

---

## P1 — Performance mesurée

### P1.1 · `public/_headers` — ✅ FAIT
Le fichier n'existait pas : aucune politique de cache, aucun en-tête de sécurité.
Créé avec cache immuable sur `/_astro/*`, cache court + `stale-while-revalidate`
sur `/photos/*`, HTML revalidé, `X-Content-Type-Options`, `X-Frame-Options`,
`Referrer-Policy`, `Permissions-Policy`, HSTS, et une **CSP en `Report-Only`**.

➡️ **Reste à faire** : une fois P0.2 réglé, retirer les hôtes devenus inutiles de
la CSP et renommer l'en-tête en `Content-Security-Policy`.

### P1.2 · `preconnect` vers cdn.sanity.io — ✅ FAIT
L'image LCP de la quasi-totalité des pages vient de `cdn.sanity.io`, et la
poignée de main DNS + TLS ne démarrait qu'à la rencontre de la balise `<img>`.
`preconnect` + `dns-prefetch` ajoutés en tête de `BaseLayout.astro`.

### P1.3 · Préchargement des deux polices réellement utilisées — ✅ FAIT
`fraunces-latin-full` et `manrope-latin-wght` étaient découvertes après l'analyse
du CSS ; avec `font-display: swap`, la bascule de police se voyait. Préchargées
via import `?url`, pour que l'empreinte suive les rebuilds.

### P1.4 · Photographies non optimisées
`public/photos/` est servi tel quel, par choix documenté. Les poids relevés :

| Fichier | Poids |
|---|---|
| `founder-deo-gratias-kpodo.png` | **1 567 Ko** |
| `pole-creative-direction-hero.jpg` | 724 Ko |
| `nta-textiles-cover.jpg` | 719 Ko |
| `pole-studio-hero.jpg` | 435 Ko |

Le PNG de 1,5 Mo est le plus rentable : un portrait photographique en PNG n'a
pas lieu d'être. Conversion en AVIF/WebP à qualité 82 → gain attendu > 90 %.
`pole-creative-direction-hero.jpg` et `pole-studio-hero.jpg` sont des images de
hero : elles pèsent sur le LCP de `/creative` et `/consulting`.

### P1.5 · Dimensions intrinsèques des photos du fondateur — ✅ FAIT
3 `<img>` sans `width`/`height` dans `FounderBioModal.astro`. La classe
`aspect-*` réservait déjà la boîte une fois le CSS appliqué, mais pas avant.
Dimensions réelles ajoutées (1100×1100, 900×1350, 1400×933) + `decoding="async"`.

---

## P2 — Sémantique et indexation IA

### P2.1 · Graphe de connaissances — ✅ FAIT
`Seo.astro` émettait deux objets plats et sans lien : `Organization` et
`WebSite`. Remplacés par un `@graph` avec `@id` résolus :

`ProfessionalService` → `founder` → `Person` (Deo-Gratias Kpodo) → `worksFor` ↩
`WebSite` → `publisher` ↩ · `WebPage` → `isPartOf` ↩

Avec `foundingDate: 2010`, `areaServed` (France / Afrique de l'Ouest /
International), `knowsAbout`, et un `OfferCatalog` des trois divisions réelles.

**Volontairement absents** : adresse, téléphone, effectif, distinctions — rien de
tout cela n'est vérifié. `TalentAgency` n'existe pas dans schema.org et n'a pas
été utilisé.

### P2.2 · Reste à faire
- `BreadcrumbList` sur les pages profondes (`/journal/<slug>`, `/agenda/<slug>`).
- `Article` sur les pages d'article du Journal — aujourd'hui aucune donnée
  structurée d'article n'est émise, alors que les 9 articles publiés s'y prêtent.
- L'Agenda émet déjà `Event`, correctement gardé : vérifié dans
  `AgendaDetail.astro`.

---

## P3 — Accessibilité du formulaire

Relevé sur `/contact` : 14 champs, 10 `<label>`, 5 `required`, 7 `autocomplete`,
**0 `aria-describedby`**, **0 `inputmode`**.

- `inputmode="email"` / `inputmode="tel"` sur les champs concernés : clavier
  adapté sur mobile, friction en moins sans changer une ligne de logique.
- `aria-describedby` reliant chaque champ à son message d'aide ou d'erreur —
  sans quoi un lecteur d'écran annonce le champ sans dire ce qui cloche.
- 4 champs sans `<label>` associé : à vérifier un par un.

---

## P4 — Pistes non traitées, et pourquoi

| Demande | Décision |
|---|---|
| Grille portfolio asymétrique 3D | Non fait. Réécriture de `SelectedWorkPreview` + `/selected-work` : chantier de conception à part entière, qui mérite une validation visuelle avant code |
| « Text-reveal » sur le hero | Non fait. `scroll-choreography.ts` en fait déjà l'essentiel ; ajouter une seconde couche d'animation sur le même élément produirait un conflit, pas un gain |
| Lazy loading sur mesure + `requestIdleCallback` | Non fait. Déjà en place : 10 images en `loading="lazy"`, LCP en `eager` + `fetchpriority="high"`, GSAP différé à l'idle |
| Brotli, HTTP/2 | Sans objet : appliqués par Cloudflare en périphérie |

---

## Vérification

```bash
npm run integrity          # doit finir à 0 erreur — actuellement 2
npx astro check            # 0 erreur sur 198 fichiers
npm run build              # 63 pages
node --experimental-strip-types --test "editorial-engine/tests/*.test.ts"
```
