// Minimal CalDAV client: HTTP Basic auth, PROPFIND-based discovery of
// journal collections, and PUT of iCalendar entries.
//
// XML responses are parsed with tolerant regexes rather than DOMParser:
// namespace prefixes vary by server, and DOMParser is unavailable in
// service workers. These regexes only run against machine-generated
// XML from CalDAV servers.

const encoder = new TextEncoder();

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export { HttpError };

export function authHeader(username, password) {
  const raw = `${username}:${password}`;
  let bin = "";
  for (const b of encoder.encode(raw)) bin += String.fromCharCode(b);
  return "Basic " + btoa(bin);
}

export function normalizeBaseUrl(url) {
  return String(url).trim().replace(/\/+$/, "");
}

// PROPFIND request helper. depth: "0" or "1".
export async function davRequest(url, { auth = null, body, depth = "0" } = {}) {
  const headers = {};
  if (auth) headers["Authorization"] = auth;
  headers["Depth"] = depth;
  headers["Content-Type"] = "application/xml; charset=utf-8";
  return fetch(url, { method: "PROPFIND", headers, body });
}

const PRINCIPAL_BODY = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`;

const HOME_BODY = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><c:calendar-home-set/></d:prop>
</d:propfind>`;

const COLLECTIONS_BODY = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:resourcetype/>
    <d:displayname/>
    <c:supported-calendar-component-set/>
  </d:prop>
</d:propfind>`;

function decodeXmlEntities(s) {
  // Named entities are assembled from parts to keep this source free of
  // raw entity strings that tooling may rewrite.
  const amp = String.fromCharCode(38);
  const map = { lt: "<", gt: ">", quot: '"', apos: "'", amp };
  return s.replace(new RegExp(amp + "(lt|gt|quot|apos|amp|#\\d+);", "g"), (m, e) =>
    e.startsWith("#") ? String.fromCharCode(+e.slice(1)) : map[e]
  );
}

// href inside a named property, e.g. current-user-principal / calendar-home-set
function parsePropHref(xml, propName) {
  const opener = `<(?:[\\w.-]+:)?${propName}(?=[\\s/>])[^>]*>`;
  const re = new RegExp(
    opener + "[\\s\\S]*?<(?:[\\w.-]+:)?href(?=[\\s/>])[^>]*>([^<]*)</(?:[\\w.-]+:)?href\\s*>",
    "i"
  );
  const m = re.exec(xml);
  return m ? m[1].trim() : null;
}

export function parsePrincipalUrl(xml) {
  return parsePropHref(xml, "current-user-principal");
}

export function parseCalendarHomeSet(xml) {
  return parsePropHref(xml, "calendar-home-set");
}

// Extract calendar collections from a multistatus response.
export function parseCollections(xml) {
  const out = [];
  const blocks =
    xml.match(/<(?:[\w.-]+:)?response(?=[\s/>])[^>]*>[\s\S]*?<\/(?:[\w.-]+:)?response\s*>/gi) || [];
  for (const block of blocks) {
    // resourcetype must contain a calendar element: <c:calendar/> or <c:calendar>...
    // The lookahead after "calendar" avoids matching calendar-home-set etc.
    if (!/<(?:[\w.-]+:)?calendar(?=[\s/>])/.test(block)) continue;
    const hrefM = /<(?:[\w.-]+:)?href(?=[\s/>])[^>]*>([^<]*)<\/(?:[\w.-]+:)?href\s*>/i.exec(block);
    if (!hrefM) continue;
    const nameM = /<(?:[\w.-]+:)?displayname(?=[\s/>])[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?displayname\s*>/i.exec(block);
    let name = nameM ? decodeXmlEntities(nameM[1]).trim() : "";
    if (!name) {
      try {
        name = decodeURIComponent(hrefM[1].trim().replace(/\/+$/, "").split("/").pop() || "");
      } catch {
        name = "Unnamed collection";
      }
    }
    const supportsVJournal = /<(?:[\w.-]+:)?comp(?=[\s/>])[^>]*name\s*=\s*["']?VJOURNAL/i.test(block);
    out.push({ url: hrefM[1].trim(), name: name || "Unnamed collection", supportsVJournal });
  }
  return out;
}

function resolve(href, base) {
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

function mapUrls(collections, base) {
  const seen = new Set();
  const out = [];
  for (const c of collections) {
    const url = resolve(c.url, base);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ ...c, url });
  }
  return out;
}

// Discover journal/calendar collections starting from a server URL.
// Strategy: current-user-principal -> calendar-home-set -> list collections.
// Falls back to scanning the given URL directly, then treating the URL
// itself as a collection. Throws HttpError on authentication failure.
export async function discoverCollections({ serverUrl, username, password }) {
  const auth = username ? authHeader(username, password) : null;
  const base = normalizeBaseUrl(serverUrl);
  const errors = [];

  let principalUrl = null;
  for (const candidate of [base, `${base}/.well-known/caldav`]) {
    try {
      const res = await davRequest(candidate, { auth, body: PRINCIPAL_BODY, depth: "0" });
      if (res.status === 401 || res.status === 403) {
        throw new HttpError(res.status, "Authentication failed — check your username and password.");
      }
      if (!res.ok) {
        errors.push(`${candidate}: HTTP ${res.status}`);
        continue;
      }
      const href = parsePrincipalUrl(await res.text());
      if (!href) {
        errors.push(`${candidate}: no current-user-principal in response`);
        continue;
      }
      principalUrl = resolve(href, candidate);
      if (principalUrl) break;
    } catch (e) {
      if (e instanceof HttpError) throw e;
      errors.push(`${candidate}: ${e.message}`);
    }
  }

  let home = null;
  if (principalUrl) {
    try {
      const res = await davRequest(principalUrl, { auth, body: HOME_BODY, depth: "0" });
      if (res.ok) {
        const href = parseCalendarHomeSet(await res.text());
        home = href ? resolve(href, principalUrl) : null;
      }
    } catch (e) {
      errors.push(`principal: ${e.message}`);
    }
  }

  // Preferred: list the contents of the calendar home (Depth 1, includes the
  // home itself whose response block lacks a calendar resourcetype).
  if (home) {
    try {
      const res = await davRequest(home, { auth, body: COLLECTIONS_BODY, depth: "1" });
      if (res.ok) {
        const cols = mapUrls(parseCollections(await res.text()), home);
        if (cols.length) return cols;
      }
    } catch (e) {
      errors.push(`${home}: ${e.message}`);
    }
  }

  // Fallback 1: scan the given URL's children for calendar collections.
  try {
    const res = await davRequest(base, { auth, body: COLLECTIONS_BODY, depth: "1" });
    if (res.ok) {
      const cols = mapUrls(parseCollections(await res.text()), base);
      if (cols.length) return cols;
    } else {
      errors.push(`${base}: HTTP ${res.status}`);
    }
  } catch (e) {
    errors.push(`${base}: ${e.message}`);
  }

  // Fallback 2: the given URL is itself a calendar collection (Depth 0
  // self-report; parseCollections finds its response block + resourcetype).
  try {
    const res = await davRequest(base, { auth, body: COLLECTIONS_BODY, depth: "0" });
    if (res.ok) {
      const cols = mapUrls(parseCollections(await res.text()), base);
      // Keep only the self-response (it resolves back to the base URL).
      const self = cols.filter((c) => normalizeBaseUrl(c.url) === base);
      if (self.length) return self;
    }
  } catch (e) {
    errors.push(`${base} (self): ${e.message}`);
  }

  throw new Error(
    "No calendar or journal collections found. " +
      (errors.length ? `Details: ${errors.join("; ")}. ` : "") +
      "Tip: paste the full URL of your journal collection (ending in a collection path) as the Server URL."
  );
}

// PUT an iCalendar entry into a collection. Returns the URL written to.
export async function putJournal({ collectionUrl, auth, ics, uid }) {
  const target = normalizeBaseUrl(collectionUrl) + "/" + encodeURIComponent(uid) + ".ics";
  const res = await fetch(target, {
    method: "PUT",
    headers: {
      Authorization: auth,
      "Content-Type": "text/calendar; charset=utf-8",
      "If-None-Match": "*",
    },
    body: ics,
  });
  if (res.ok || res.status === 201 || res.status === 204) return target;
  if (res.status === 401 || res.status === 403) {
    throw new Error(`Authentication failed or no write access (HTTP ${res.status}).`);
  }
  if (res.status === 404) {
    throw new Error("Collection not found — check the collection and server URL in settings.");
  }
  if (res.status === 405) {
    throw new Error("The server refused to write here — is this really a calendar/journal collection?");
  }
  if (res.status === 412) {
    throw new Error("A note with the same ID already exists — please try again.");
  }
  const detail = await res.text().catch(() => "");
  const snippet = detail.slice(0, 200).replace(/\s+/g, " ").trim();
  throw new Error(`Server error HTTP ${res.status}${snippet ? ": " + snippet : ""}.`);
}
