/**
 * Génère les dossiers de candidature PDF remplissables (FR et EN) servis
 * depuis public/downloads/ — voie alternative au formulaire en ligne.
 *
 *   node --experimental-strip-types scripts/talent-pdf/generate.mjs
 *
 * Source unique : les libellés de champs et d'options sont relus dans
 * src/i18n/ui.ts (mêmes textes que le formulaire en ligne), les listes
 * d'options dans functions/lib/talentOptions.ts. Seuls les textes propres
 * au PDF (mode d'envoi, signature) sont écrits ici.
 *
 * Polices standard PDF (Helvetica, Times) : présentes dans tout lecteur,
 * rien à embarquer, et compatibles avec les accents français (WinAnsi).
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { PDFDocument, PDFHexString, PDFName, StandardFonts, rgb } from "pdf-lib";
import {
  EXPERIENCE_DURATIONS,
  EXPERIENCE_LEVELS,
  MOBILITY_OPTIONS,
  PROJECT_TYPES,
  TALENT_CATEGORIES,
} from "../../functions/lib/talentOptions.ts";
import { CONTACT_EMAIL } from "../../src/lib/contact.ts";

const ROOT = new URL("../../", import.meta.url);
const OUT_DIR = new URL("public/downloads/", ROOT);
export const OUTPUTS = {
  fr: "weblack-talents-candidature-fr.pdf",
  en: "weblack-talents-application-en.pdf",
};

// --- Libellés : relus dans ui.ts, bloc par langue -----------------------------------

function loadUi() {
  const lines = readFileSync(new URL("src/i18n/ui.ts", ROOT), "utf8").split(/\r?\n/);
  const frStart = lines.findIndex((l) => /^ {2}fr: \{/.test(l));
  const enStart = lines.findIndex((l) => /^ {2}en: \{/.test(l));
  const block = (from, to) => {
    const map = {};
    for (const line of lines.slice(from, to)) {
      const m = line.match(/^\s*"(talentApplication\.[^"]+)":\s*("(?:[^"\\]|\\.)*"),?\s*$/);
      if (m) map[m[1]] = JSON.parse(m[2]);
    }
    return map;
  };
  return { fr: block(frStart, enStart), en: block(enStart, lines.length) };
}
const UI = loadUi();

const COPY = {
  fr: {
    title: "Dossier de candidature",
    subtitle: "WEBLACK TALENTS — version PDF",
    howTitle: "Comment utiliser ce dossier",
    how: [
      "Remplissez ce PDF dans un lecteur compatible (Adobe Acrobat Reader, Aperçu, ou votre navigateur), puis enregistrez-le. Vous pouvez aussi l'imprimer et le remplir à la main, en majuscules.",
      `Envoyez le PDF rempli et vos photos à ${CONTACT_EMAIL}, avec pour objet : « Candidature PDF — Prénom NOM ».`,
      "La voie recommandée reste le formulaire en ligne (www.weblack.fr/talent/candidature/) : il enregistre votre dossier immédiatement et vous adresse une confirmation automatique avec une référence. Un dossier envoyé par e-mail ne déclenche pas de confirmation automatique.",
      "N'envoyez pas la même candidature par les deux voies.",
      "Candidatures réservées aux personnes âgées de 18 ans ou plus.",
    ],
    required: "Les champs marqués * sont obligatoires.",
    photosTitle: "Photos à joindre à votre e-mail",
    photos: [
      "Trois photos obligatoires : un portrait, un profil, une photo en pied habillée.",
      "Jusqu'à trois photos complémentaires, facultatives.",
      "Formats JPEG, PNG ou WebP. Aucune photo dénudée.",
      "La taille d'un e-mail est souvent limitée (25 Mo chez Gmail, par exemple) : si nécessaire, réduisez la taille des photos ou envoyez-les en deux messages portant le même objet.",
    ],
    portfolioHint: "Une adresse par ligne, 5 maximum, commençant par https://",
    languagesHint: "Indiquez les langues que vous parlez, séparées par des virgules.",
    shoeSystemHint: "EU, UK ou US",
    eyeHint: "Marron foncé, marron, noisette, vert, bleu, gris, autre",
    hairHint: "Noir, brun foncé, châtain, blond, roux, gris ou blanc, rasé, autre",
    modelOnly: "Poitrine, tour de taille, hanches, entrejambe, pointure et taille de vêtements : utiles uniquement pour les catégories mannequin (runway, commercial, photo, éditorial).",
    birthHint: "JJ/MM/AAAA",
    phoneHint: "Avec l'indicatif international, ex. +221 77 123 45 67",
    adult: "J'atteste avoir 18 ans ou plus à la date d'envoi de ce dossier.",
    privacyWhere: "Notice de confidentialité WEBLACK TALENTS : consultable sur www.weblack.fr/talent/candidature/ (étape 5 du formulaire).",
    signatureTitle: "Signature",
    signName: "Nom et prénom",
    signDate: "Date",
    signPlace: "Lieu",
    signHand: "Signature (si imprimé)",
    footer: "WEBLACK TALENTS · www.weblack.fr · Dossier PDF — voie alternative au formulaire en ligne",
    page: (n, total) => `Page ${n} / ${total}`,
    docTitle: "Dossier de candidature WEBLACK TALENTS (PDF remplissable)",
    yes: "Oui",
  },
  en: {
    title: "Application form",
    subtitle: "WEBLACK TALENTS — PDF version",
    howTitle: "How to use this form",
    how: [
      "Fill in this PDF in a compatible reader (Adobe Acrobat Reader, Preview, or your web browser), then save it. You can also print it and complete it by hand, in capital letters.",
      `Email the completed PDF and your photos to ${CONTACT_EMAIL}, with the subject line: "PDF application — First name LAST NAME".`,
      "The recommended route remains the online form (www.weblack.fr/en/talent/candidature/): it registers your application immediately and sends you an automatic confirmation with a reference. An application sent by email does not trigger an automatic confirmation.",
      "Please do not send the same application both ways.",
      "Applications are open to people aged 18 or over only.",
    ],
    required: "Fields marked * are required.",
    photosTitle: "Photos to attach to your email",
    photos: [
      "Three required photos: a portrait, a profile, and a full-length photo, dressed.",
      "Up to three additional photos, optional.",
      "JPEG, PNG or WebP. No nude photos.",
      "Email size is often limited (25 MB on Gmail, for example): if needed, reduce the photo size or send them in two messages with the same subject line.",
    ],
    portfolioHint: "One address per line, 5 maximum, starting with https://",
    languagesHint: "List the languages you speak, separated by commas.",
    shoeSystemHint: "EU, UK or US",
    eyeHint: "Dark brown, brown, hazel, green, blue, grey, other",
    hairHint: "Black, dark brown, brown, blonde, red, grey or white, shaved, other",
    modelOnly: "Chest, waist, hips, inseam, shoe size and clothing size: useful only for model categories (runway, commercial, photo, editorial).",
    birthHint: "DD/MM/YYYY",
    phoneHint: "Including the international code, e.g. +44 7700 900123",
    adult: "I confirm that I am 18 or over on the date I send this form.",
    privacyWhere: "WEBLACK TALENTS privacy notice: available at www.weblack.fr/en/talent/candidature/ (step 5 of the form).",
    signatureTitle: "Signature",
    signName: "Full name",
    signDate: "Date",
    signPlace: "Place",
    signHand: "Signature (if printed)",
    footer: "WEBLACK TALENTS · www.weblack.fr · PDF form — alternative to the online form",
    page: (n, total) => `Page ${n} of ${total}`,
    docTitle: "WEBLACK TALENTS application form (fillable PDF)",
    yes: "Yes",
  },
};

// --- Mise en page -------------------------------------------------------------------

const A4 = [595.28, 841.89];
const MARGIN = 48;
const INK = rgb(0.04, 0.04, 0.04);
const GOLD = rgb(0.722, 0.584, 0.373);
const GOLD_DIM = rgb(0.478, 0.396, 0.267);
const MUTED = rgb(0.36, 0.36, 0.34);
const FIELD_BG = rgb(0.973, 0.965, 0.945);
const FIELD_BORDER = rgb(0.72, 0.70, 0.66);

export async function buildPdf(lang) {
  const ui = UI[lang];
  const c = COPY[lang];
  const label = (key) => {
    const value = ui[`talentApplication.${key}`];
    if (!value) throw new Error(`libellé manquant (${lang}) : ${key}`);
    return value;
  };

  const doc = await PDFDocument.create();
  doc.setTitle(c.docTitle, { showInWindowTitleBar: true });
  doc.setAuthor("WEBLACK");
  doc.setSubject(c.subtitle);
  doc.setLanguage(lang === "fr" ? "fr-FR" : "en-GB");
  doc.setCreator("WEBLACK");
  doc.setProducer("WEBLACK");
  const fixedDate = new Date("2026-10-19T00:00:00Z");
  doc.setCreationDate(fixedDate);
  doc.setModificationDate(fixedDate);

  const sans = await doc.embedFont(StandardFonts.Helvetica);
  const sansBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const serif = await doc.embedFont(StandardFonts.TimesRoman);
  const icon = await doc.embedPng(readFileSync(new URL("src/assets/logo/weblack-icon-gold-180.png", ROOT)));
  const form = doc.getForm();
  const contentWidth = A4[0] - MARGIN * 2;

  let page;
  let y;
  const pages = [];

  function newPage() {
    page = doc.addPage(A4);
    pages.push(page);
    y = A4[1] - MARGIN;
  }

  function ensure(height) {
    if (y - height < MARGIN + 28) newPage();
  }

  function wrap(text, font, size, width) {
    const words = text.split(/\s+/);
    const lines = [];
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) > width && line) {
        lines.push(line);
        line = word;
      } else line = candidate;
    }
    if (line) lines.push(line);
    return lines;
  }

  function paragraph(text, { font = sans, size = 9.5, color = INK, indent = 0, gap = 4, lineHeight = 1.4 } = {}) {
    const lines = wrap(text, font, size, contentWidth - indent);
    ensure(lines.length * size * lineHeight + gap);
    for (const line of lines) {
      y -= size * lineHeight;
      page.drawText(line, { x: MARGIN + indent, y, size, font, color });
    }
    y -= gap;
  }

  function bullets(items, opts = {}) {
    for (const item of items) {
      const size = opts.size ?? 9.5;
      const lines = wrap(item, sans, size, contentWidth - 14);
      ensure(lines.length * size * 1.4 + 3);
      lines.forEach((line, i) => {
        y -= size * 1.4;
        if (i === 0) page.drawText("·", { x: MARGIN + 3, y, size: size + 2, font: sansBold, color: GOLD });
        page.drawText(line, { x: MARGIN + 14, y, size, font: sans, color: INK });
      });
      y -= 3;
    }
  }

  function section(title) {
    // Jamais un titre seul en bas de page : il emmène au moins une rangée de champs.
    ensure(120);
    y -= 14;
    page.drawText(title.toUpperCase(), { x: MARGIN, y: y - 11, size: 10.5, font: sansBold, color: GOLD_DIM, characterSpacing: 1.2 });
    y -= 18;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + contentWidth, y }, thickness: 0.8, color: GOLD });
    y -= 10;
  }

  /** Infobulle lue par les lecteurs d'écran et affichée au survol du champ. */
  function tooltip(field, text) {
    field.acroField.dict.set(PDFName.of("TU"), PDFHexString.fromText(text));
  }

  function styleText(field, size = 10) {
    field.setFontSize(size);
  }

  /** Rangée de champs texte : [{ name, label, required, hint, width (fraction), multiline, height }] */
  function textRow(fields) {
    const gapX = 12;
    const totalGaps = gapX * (fields.length - 1);
    const height = Math.max(...fields.map((f) => f.height ?? 22));
    const hasHint = fields.some((f) => f.hint);
    ensure(14 + height + (hasHint ? 12 : 0) + 10);
    let x = MARGIN;
    const labelY = y - 10;
    const fieldTop = y - 14;
    for (const f of fields) {
      const w = (contentWidth - totalGaps) * (f.width ?? 1 / fields.length);
      const text = `${f.label}${f.required ? " *" : ""}`;
      page.drawText(text, { x, y: labelY, size: 8.5, font: sansBold, color: INK });
      const field = form.createTextField(f.name);
      if (f.multiline) field.enableMultiline();
      if (f.maxLength) field.setMaxLength(f.maxLength);
      field.addToPage(page, { x, y: fieldTop - (f.height ?? 22), width: w, height: f.height ?? 22, font: sans, backgroundColor: FIELD_BG, borderColor: FIELD_BORDER, borderWidth: 0.6, textColor: INK });
      styleText(field, f.multiline ? 9.5 : 10);
      if (f.required) field.enableRequired();
      tooltip(field, `${text}${f.hint ? ` — ${f.hint}` : ""}`);
      if (f.hint) page.drawText(f.hint, { x, y: fieldTop - (f.height ?? 22) - 10, size: 7.5, font: sans, color: MUTED });
      x += w + gapX;
    }
    y = fieldTop - height - (hasHint ? 12 : 0) - 10;
  }

  /** Choix unique (boutons radio) ou multiple (cases), disposés en colonnes. */
  function choices({ name, title, required, options, multiple = false, columns = 2, hint }) {
    const rowH = 18;
    const rows = Math.ceil(options.length / columns);
    ensure(16 + rows * rowH + (hint ? 12 : 0) + 8);
    page.drawText(`${title}${required ? " *" : ""}${multiple ? (lang === "fr" ? " (plusieurs choix possibles)" : " (select all that apply)") : ""}`, {
      x: MARGIN,
      y: y - 10,
      size: 8.5,
      font: sansBold,
      color: INK,
    });
    y -= 18;
    const colW = contentWidth / columns;
    const group = multiple ? null : form.createRadioGroup(name);
    options.forEach((opt, i) => {
      const col = i % columns;
      const row = Math.floor(i / columns);
      const x = MARGIN + col * colW;
      const top = y - row * rowH;
      const box = { x, y: top - 12, width: 11, height: 11, borderColor: FIELD_BORDER, borderWidth: 0.8, backgroundColor: FIELD_BG };
      if (multiple) {
        const cb = form.createCheckBox(`${name}.${opt.value}`);
        cb.addToPage(page, box);
        tooltip(cb, `${title} — ${opt.label}`);
      } else {
        group.addOptionToPage(opt.value, page, box);
      }
      page.drawText(opt.label, { x: x + 17, y: top - 10, size: 9, font: sans, color: INK });
    });
    if (group) {
      if (required) group.enableRequired();
      tooltip(group, `${title}${required ? " *" : ""}`);
    }
    y -= rows * rowH + 2;
    if (hint) {
      page.drawText(hint, { x: MARGIN, y: y - 8, size: 7.5, font: sans, color: MUTED });
      y -= 12;
    }
    y -= 6;
  }

  function declaration(name, text, required = true) {
    const lines = wrap(`${text}${required ? " *" : ""}`, sans, 9.5, contentWidth - 20);
    ensure(lines.length * 13.5 + 8);
    const cb = form.createCheckBox(name);
    cb.addToPage(page, { x: MARGIN, y: y - 12, width: 11, height: 11, borderColor: FIELD_BORDER, borderWidth: 0.8, backgroundColor: FIELD_BG });
    if (required) cb.enableRequired();
    tooltip(cb, text);
    lines.forEach((line, i) => page.drawText(line, { x: MARGIN + 20, y: y - 10 - i * 13.5, size: 9.5, font: sans, color: INK }));
    y -= lines.length * 13.5 + 8;
  }

  // --- Contenu --------------------------------------------------------------------

  newPage();
  // En-tête : symbole + mot-symbole WEBLACK seul (jamais la raison sociale).
  page.drawRectangle({ x: 0, y: A4[1] - 118, width: A4[0], height: 118, color: INK });
  page.drawImage(icon, { x: MARGIN, y: A4[1] - 96, width: 64, height: 64 });
  page.drawText("WEBLACK", { x: MARGIN + 80, y: A4[1] - 62, size: 24, font: serif, color: rgb(0.973, 0.965, 0.945), characterSpacing: 6 });
  page.drawText("TALENTS", { x: MARGIN + 82, y: A4[1] - 82, size: 9, font: sansBold, color: GOLD, characterSpacing: 3 });
  y = A4[1] - 118 - 30;
  page.drawText(c.title, { x: MARGIN, y, size: 22, font: serif, color: INK });
  y -= 18;
  page.drawText(c.subtitle, { x: MARGIN, y, size: 10, font: sans, color: MUTED });
  y -= 8;

  section(c.howTitle);
  bullets(c.how);
  paragraph(c.required, { size: 8.5, color: MUTED });

  section(c.photosTitle);
  bullets(c.photos);

  section(`1. ${label("step.1.title")}`);
  textRow([
    { name: "profile.firstName", label: label("field.firstName"), required: true, maxLength: 80 },
    { name: "profile.lastName", label: label("field.lastName"), required: true, maxLength: 80 },
  ]);
  textRow([
    { name: "profile.birthDate", label: label("field.birthDate"), required: true, hint: c.birthHint, width: 0.34, maxLength: 10 },
    { name: "profile.city", label: label("field.city"), required: true, width: 0.33, maxLength: 100 },
    { name: "profile.country", label: label("field.country"), required: true, width: 0.33, maxLength: 80 },
  ]);
  textRow([
    { name: "profile.email", label: label("field.email"), required: true, width: 0.5, maxLength: 254 },
    { name: "profile.phone", label: label("field.phone"), required: true, hint: c.phoneHint, width: 0.5, maxLength: 40 },
  ]);

  section(`2. ${label("step.2.title")}`);
  choices({
    name: "professional.category",
    title: label("field.category"),
    required: true,
    columns: 3,
    options: TALENT_CATEGORIES.map((v) => ({ value: v, label: label(`option.category.${v}`) })),
  });
  textRow([{ name: "professional.categoryOther", label: label("field.categoryOther"), maxLength: 120 }]);
  choices({
    name: "professional.experienceLevel",
    title: label("field.experienceLevel"),
    required: true,
    columns: 4,
    options: EXPERIENCE_LEVELS.map((v) => ({ value: v, label: label(`option.level.${v}`) })),
  });
  choices({
    name: "professional.experienceDuration",
    title: label("field.experienceDuration"),
    required: true,
    columns: 3,
    options: EXPERIENCE_DURATIONS.map((v) => ({ value: v, label: label(`option.duration.${v}`) })),
    hint: label("help.experience"),
  });
  textRow([{ name: "professional.portfolioLinks", label: label("field.portfolioLinks"), multiline: true, height: 58, hint: c.portfolioHint, maxLength: 1600 }]);
  textRow([
    { name: "professional.instagram", label: label("field.instagram"), width: 0.34, maxLength: 120 },
    { name: "professional.currentAgency", label: label("field.currentAgency"), width: 0.33, maxLength: 120 },
    { name: "professional.exclusivity", label: label("field.exclusivity"), width: 0.33, maxLength: 300 },
  ]);

  section(`3. ${label("step.3.title")}`);
  paragraph(label("field.measurementsNote"), { size: 8.5, color: MUTED, gap: 2 });
  paragraph(c.modelOnly, { size: 8.5, color: MUTED, gap: 6 });
  textRow([
    { name: "measurements.heightCm", label: label("field.heightCm"), maxLength: 6 },
    { name: "measurements.chestCm", label: label("field.chestCm"), maxLength: 6 },
    { name: "measurements.waistCm", label: label("field.waistCm"), maxLength: 6 },
    { name: "measurements.hipsCm", label: label("field.hipsCm"), maxLength: 6 },
  ]);
  textRow([
    { name: "measurements.inseamCm", label: label("field.inseamCm"), maxLength: 6 },
    { name: "measurements.shoeSize", label: label("field.shoeSize"), maxLength: 6 },
    { name: "measurements.shoeSystem", label: label("field.shoeSystem"), hint: c.shoeSystemHint, maxLength: 4 },
    { name: "measurements.clothingSize", label: label("field.clothingSize"), maxLength: 20 },
  ]);
  textRow([
    { name: "measurements.eyeColor", label: label("field.eyeColor"), hint: c.eyeHint, maxLength: 40 },
    { name: "measurements.hairColor", label: label("field.hairColor"), hint: c.hairHint, maxLength: 40 },
  ]);

  section(`4. ${label("step.5.title")}`);
  textRow([{ name: "availability.languages", label: label("field.languages"), required: true, hint: c.languagesHint, maxLength: 300 }]);
  choices({
    name: "availability.mobility",
    title: label("field.mobility"),
    required: true,
    columns: 1,
    options: MOBILITY_OPTIONS.map((v) => ({ value: v, label: `${label(`option.mobility.${v}`)} — ${label(`option.mobilityHint.${v}`)}` })),
  });
  choices({
    name: "availability.desiredProjects",
    title: label("field.desiredProjects"),
    multiple: true,
    columns: 2,
    options: PROJECT_TYPES.map((v) => ({ value: v, label: label(`option.project.${v}`) })),
  });
  textRow([{ name: "availability.motivation", label: label("field.motivation"), multiline: true, height: 96, hint: lang === "fr" ? "1 500 caractères maximum" : "1,500 characters maximum", maxLength: 1500 }]);

  section(label("privacyNotice.title"));
  paragraph(c.privacyWhere, { size: 9 });
  paragraph(label("privacyScope"), { size: 9, color: MUTED, gap: 8 });
  declaration("confirmation.adult", c.adult);
  declaration("confirmation.accuracy", label("field.accuracyConfirmed"));
  declaration("confirmation.privacyNotice", label("field.privacyNoticeAccepted"));

  // Le bloc signature (titre, identité, ligne manuscrite) ne se coupe jamais.
  ensure(160);
  section(c.signatureTitle);
  textRow([
    { name: "signature.name", label: c.signName, required: true, width: 0.5, maxLength: 160 },
    { name: "signature.place", label: c.signPlace, width: 0.25, maxLength: 80 },
    { name: "signature.date", label: c.signDate, required: true, width: 0.25, hint: c.birthHint, maxLength: 10 },
  ]);
  ensure(56);
  page.drawText(c.signHand, { x: MARGIN, y: y - 10, size: 8.5, font: sansBold, color: INK });
  page.drawLine({ start: { x: MARGIN, y: y - 46 }, end: { x: MARGIN + contentWidth * 0.5, y: y - 46 }, thickness: 0.6, color: FIELD_BORDER });
  y -= 56;

  // Pied de page numéroté sur chaque page.
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: MARGIN, y: MARGIN }, end: { x: A4[0] - MARGIN, y: MARGIN }, thickness: 0.4, color: FIELD_BORDER });
    p.drawText(c.footer, { x: MARGIN, y: MARGIN - 14, size: 7.5, font: sans, color: MUTED });
    const pageText = c.page(i + 1, pages.length);
    p.drawText(pageText, { x: A4[0] - MARGIN - sans.widthOfTextAtSize(pageText, 7.5), y: MARGIN - 14, size: 7.5, font: sans, color: MUTED });
  });

  form.updateFieldAppearances(sans);
  // Le lecteur affiche le titre du document plutôt que le nom de fichier.
  doc.catalog.set(PDFName.of("ViewerPreferences"), doc.context.obj({ DisplayDocTitle: true }));
  return doc.save({ useObjectStreams: false });
}

// Exécuté directement (pas importé par le test) : écrit les deux fichiers.
if (/generate\.mjs$/.test(process.argv[1] ?? "")) {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const lang of ["fr", "en"]) {
    const bytes = await buildPdf(lang);
    writeFileSync(new URL(OUTPUTS[lang], OUT_DIR), bytes);
    console.log(`${OUTPUTS[lang]} : ${(bytes.length / 1024).toFixed(0)} Ko`);
  }
}
