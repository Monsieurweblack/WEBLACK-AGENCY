/**
 * Relationship Engine v1 — vue « contacts » dédupliquée.
 *
 * Aucune table de contacts : la personne est reconnue par son adresse e-mail
 * normalisée, à la volée, dans les sources qui font foi (candidatures Talent,
 * demandes commerciales). Il n'existe donc jamais deux versions d'une même
 * personne à réconcilier. L'identifiant de contact est une empreinte stable
 * de l'adresse (SHA-256 tronqué) : utilisable dans le journal d'audit sans y
 * écrire l'adresse elle-même.
 *
 * Les abonnés de la lettre d'information vivent chez Resend (audience), pas
 * en D1 : ils ne figurent pas ici tant qu'aucune synchronisation n'est
 * décidée (voir docs/RELATIONSHIP_ENGINE.md).
 */

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function contactKey(email: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalizeEmail(email)));
  return Array.from(new Uint8Array(digest))
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export type Segment = "talent_applicant" | "talent_pool" | "represented" | "prospect" | "client";

interface AppRow {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  country: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface InquiryRow {
  id: string;
  email: string;
  full_name: string;
  organisation: string | null;
  country: string;
  status: string;
  division: string;
  reference: string;
  created_at: string;
  updated_at: string;
}

export interface ContactSummary {
  key: string;
  email: string;
  name: string;
  organisation: string | null;
  countries: string[];
  segments: Segment[];
  applications: { id: string; status: string; createdAt: string }[];
  inquiries: { id: string; reference: string; status: string; division: string; createdAt: string }[];
  firstSeen: string;
  lastActivity: string;
}

/** Segments déduits des faits enregistrés — jamais déclarés à la main. */
function segmentsOf(apps: AppRow[], inquiries: InquiryRow[]): Segment[] {
  const out = new Set<Segment>();
  if (apps.length) out.add("talent_applicant");
  if (apps.some((a) => a.status === "TALENT_POOL")) out.add("talent_pool");
  if (apps.some((a) => a.status === "REPRESENTED")) out.add("represented");
  if (inquiries.length) out.add(inquiries.some((i) => i.status === "WON") ? "client" : "prospect");
  return [...out];
}

export async function listContacts(db: D1Database, q = ""): Promise<ContactSummary[]> {
  const [{ results: apps }, { results: inquiries }] = await Promise.all([
    db.prepare(`SELECT id, email, first_name, last_name, country, status, created_at, updated_at FROM applications`).all<AppRow>(),
    db.prepare(`SELECT id, email, full_name, organisation, country, status, division, reference, created_at, updated_at FROM business_inquiries`).all<InquiryRow>(),
  ]);
  const byEmail = new Map<string, { apps: AppRow[]; inquiries: InquiryRow[] }>();
  for (const a of apps ?? []) {
    const k = normalizeEmail(a.email);
    if (!byEmail.has(k)) byEmail.set(k, { apps: [], inquiries: [] });
    byEmail.get(k)!.apps.push(a);
  }
  for (const i of inquiries ?? []) {
    const k = normalizeEmail(i.email);
    if (!byEmail.has(k)) byEmail.set(k, { apps: [], inquiries: [] });
    byEmail.get(k)!.inquiries.push(i);
  }

  const needle = q.trim().toLowerCase();
  const contacts: ContactSummary[] = [];
  for (const [email, group] of byEmail) {
    const names = [...group.apps.map((a) => `${a.first_name} ${a.last_name}`), ...group.inquiries.map((i) => i.full_name)];
    const organisation = group.inquiries.find((i) => i.organisation)?.organisation ?? null;
    if (needle && ![email, ...names, organisation ?? ""].some((v) => v.toLowerCase().includes(needle))) continue;
    const dates = [...group.apps, ...group.inquiries];
    contacts.push({
      key: await contactKey(email),
      email,
      name: names[0] ?? email,
      organisation,
      countries: [...new Set([...group.apps.map((a) => a.country), ...group.inquiries.map((i) => i.country)])],
      segments: segmentsOf(group.apps, group.inquiries),
      applications: group.apps.map((a) => ({ id: a.id, status: a.status, createdAt: a.created_at })),
      inquiries: group.inquiries.map((i) => ({ id: i.id, reference: i.reference, status: i.status, division: i.division, createdAt: i.created_at })),
      firstSeen: dates.map((d) => d.created_at).sort()[0]!,
      lastActivity: dates.map((d) => d.updated_at).sort().at(-1)!,
    });
  }
  return contacts.sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
}

/**
 * Export RGPD (droit d'accès / portabilité) : tout ce que WEBLACK détient sur
 * une adresse, dans les tables D1. Les photographies sont listées (rôle,
 * type, date) mais pas incluses : elles se transmettent à part, sur
 * demande vérifiée. Les secrets et identifiants techniques internes (Drive)
 * ne sont pas exportés.
 */
export async function exportContact(db: D1Database, email: string) {
  const e = normalizeEmail(email);
  const { results: applications } = await db.prepare(`SELECT * FROM applications WHERE lower(email) = ?`).bind(e).all<Record<string, unknown>>();
  const appIds = (applications ?? []).map((a) => String(a.id));
  const each = async (sql: string, ids: string[]) => {
    const rows: Record<string, unknown>[] = [];
    for (const id of ids) rows.push(...((await db.prepare(sql).bind(id).all<Record<string, unknown>>()).results ?? []));
    return rows;
  };
  const { results: inquiries } = await db.prepare(`SELECT * FROM business_inquiries WHERE lower(email) = ?`).bind(e).all<Record<string, unknown>>();
  const inquiryIds = (inquiries ?? []).map((i) => String(i.id));
  return {
    exportedAt: new Date().toISOString(),
    subject: e,
    applications: applications ?? [],
    applicationPhotos: await each(`SELECT application_id, role, content_type, created_at FROM application_photos WHERE application_id = ?`, appIds),
    applicationHistory: await each(`SELECT application_id, created_at, kind, from_status, to_status, note FROM application_events WHERE application_id = ?`, appIds),
    applicationEmails: await each(`SELECT application_id, kind, status, created_at, sent_at FROM email_outbox WHERE application_id = ?`, appIds),
    businessInquiries: inquiries ?? [],
    businessInquiryHistory: await each(`SELECT inquiry_id, created_at, kind, from_status, to_status, note FROM business_inquiry_events WHERE inquiry_id = ?`, inquiryIds),
    notIncluded: [
      "Photographies (fichiers) : transmises séparément sur demande vérifiée.",
      "Abonnement à la lettre d'information : géré chez Resend, hors de cette base.",
      "Mesure d'audience GA4 : aucune donnée personnelle n'y est transmise par le site.",
    ],
  };
}
