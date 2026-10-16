// RFC 5545 (iCalendar) helpers for building VJOURNAL payloads.
// Pure functions only — safe in service workers, popups, and options pages.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const pad = (n) => String(n).padStart(2, "0");

export function icsDateTime(date = new Date()) {
  return (
    date.getUTCFullYear() +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    "T" +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    "Z"
  );
}

// Local calendar date — the day the journal entry "belongs to" per the user's clock.
export function icsLocalDate(date = new Date()) {
  return (
    date.getFullYear() +
    pad(date.getMonth() + 1) +
    pad(date.getDate())
  );
}

export function newUid() {
  const rand =
    globalThis.crypto && crypto.randomUUID
      ? crypto.randomUUID()
      : icsDateTime() + "-" + Math.random().toString(36).slice(2);
  return rand + "@caldav-clipper";
}

// RFC 5545 section 3.3.11 text value escaping.
export function escapeText(text) {
  return String(text ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

// RFC 5545 section 3.1 line folding at 75 octets, without splitting UTF-8
// sequences. Continuation lines begin with a single space.
export function fold(line) {
  const bytes = encoder.encode(line);
  if (bytes.length <= 75) return line;
  const chunks = [];
  let pos = 0;
  let first = true;
  while (pos < bytes.length) {
    let len = Math.min(first ? 75 : 74, bytes.length - pos);
    // Back off if we would cut into the middle of a multibyte sequence.
    while (len > 0 && pos + len < bytes.length && (bytes[pos + len] & 0xc0) === 0x80) {
      len--;
    }
    chunks.push((first ? "" : " ") + decoder.decode(bytes.subarray(pos, pos + len)));
    pos += len;
    first = false;
  }
  return chunks.join("\r\n");
}

export function buildIcs({
  uid,
  title,
  url,
  description,
  tags = [],
  includeDate = true,
}) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//caldav-clipper//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VJOURNAL",
    `UID:${uid ?? newUid()}`,
    `DTSTAMP:${icsDateTime()}`,
  ];
  if (includeDate) lines.push(`DTSTART;VALUE=DATE:${icsLocalDate()}`);
  lines.push(fold(`SUMMARY:${escapeText(title || "Untitled")}`));
  if (url) lines.push(fold(`URL:${url}`));
  const cats = tags.map((t) => escapeText(String(t).trim())).filter(Boolean);
  if (cats.length) lines.push(fold(`CATEGORIES:${cats.join(",")}`));
  if (description && description.trim()) {
    lines.push(fold(`DESCRIPTION:${escapeText(description)}`));
  }
  lines.push("END:VJOURNAL", "END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
