/**
 * "Add to calendar" — un fichier .ics minimal, construit uniquement à
 * partir de ce que le document porte réellement. Pas de date de fin
 * inventée : un événement sans scheduledEnd reçoit une durée par défaut
 * documentée ci-dessous, jamais une heure de fin devinée depuis autre
 * chose que les données elles-mêmes.
 */

export interface CalendarEventInput {
  title: string;
  description?: string;
  location?: string;
  url: string;
  scheduledStart: string; // ISO 8601
  scheduledEnd?: string; // ISO 8601
}

/** Sans date de fin connue, la mission interdit d'en inventer une précise — une heure ronde et annoncée comme telle reste la seule option honnête pour un calendrier, qui exige toujours une fin. */
const DEFAULT_DURATION_MS = 60 * 60_000; // 1 heure

function toIcsDate(iso: string): string {
  const d = new Date(iso);
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function escapeIcsText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

/** Plie une ligne au-delà de 75 octets, comme l'exige RFC 5545 — sans quoi certains clients (Outlook notamment) tronquent silencieusement le contenu. */
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let rest = line;
  while (rest.length > 75) {
    parts.push(rest.slice(0, 75));
    rest = " " + rest.slice(75);
  }
  parts.push(rest);
  return parts.join("\r\n");
}

export function buildIcsEvent(event: CalendarEventInput, uid: string): string {
  const start = new Date(event.scheduledStart);
  const end = event.scheduledEnd ? new Date(event.scheduledEnd) : new Date(start.getTime() + DEFAULT_DURATION_MS);

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//WEBLACK//LIVE//FR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${toIcsDate(new Date().toISOString())}`,
    `DTSTART:${toIcsDate(start.toISOString())}`,
    `DTEND:${toIcsDate(end.toISOString())}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
    ...(event.description ? [`DESCRIPTION:${escapeIcsText(event.description)}`] : []),
    ...(event.location ? [`LOCATION:${escapeIcsText(event.location)}`] : []),
    `URL:${event.url}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return lines.map(foldLine).join("\r\n") + "\r\n";
}
