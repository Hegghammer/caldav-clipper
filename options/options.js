import { discoverCollections } from "../lib/dav.js";

const $ = (id) => document.getElementById(id);

let cachedCollections = [];
let cachedPrincipal = null;
let cachedHome = null;

async function load() {
  const s = await chrome.storage.local.get(null);
  $("serverUrl").value = s.serverUrl || "";
  $("username").value = s.username || "";
  $("password").value = s.password || "";
  $("defaultTags").value = (s.defaultTags || []).join(", ");
  $("prependUrl").checked = s.prependUrl !== false;
  $("dateStamp").checked = s.dateStamp !== false;
  cachedCollections = s.collections || [];
  cachedPrincipal = s.principalUrl || null;
  cachedHome = s.calendarHomeSet || null;
  renderCollections(cachedCollections, s.collectionUrl);
}

function renderCollections(list, selectedUrl) {
  const box = $("collections");
  box.replaceChildren();
  if (!list.length) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = "No collections yet — save your server details to discover them.";
    box.appendChild(p);
    return;
  }
  for (const c of list) {
    const label = document.createElement("label");
    label.className = "radio-row" + (c.supportsVJournal ? "" : " dim");
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "collection";
    input.value = c.url;
    if (c.url === selectedUrl) input.checked = true;
    const span = document.createElement("span");
    span.className = "radio-name";
    span.textContent = c.name;
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = c.supportsVJournal ? "journal" : "no journal";
    if (!c.supportsVJournal) badge.classList.add("warn");
    label.append(input, span, badge);
    box.appendChild(label);
  }
  // Sensible default: previously selected, else first journal-capable, else first.
  if (!selectedUrl || !list.some((c) => c.url === selectedUrl)) {
    const preferred = list.find((c) => c.supportsVJournal) || list[0];
    if (preferred) {
      const el = box.querySelector(`input[value="${CSS.escape(preferred.url)}"]`);
      if (el) el.checked = true;
    }
  }
}

function splitTags(value) {
  return String(value || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function normalizeServerUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function setStatus(text, kind) {
  const el = $("status");
  el.textContent = text;
  el.className = "status" + (kind ? " " + kind : "");
}

async function connect() {
  const serverUrl = normalizeServerUrl($("serverUrl").value);
  const username = $("username").value.trim();
  const password = $("password").value;

  if (!/^https?:\/\/./.test(serverUrl)) {
    throw new Error("Server URL must be a http(s) URL.");
  }

  // Ask for host access to exactly this origin (user gesture: button click).
  const origin = new URL(serverUrl).origin + "/*";
  const granted = await chrome.permissions.request({ origins: [origin] });
  if (!granted) {
    throw new Error("Permission to reach this server was denied — the extension cannot save without it.");
  }

  const collections = await discoverCollections({ serverUrl, username, password });
  return collections;
}

async function persist(extra = {}) {
  const sel = document.querySelector('input[name="collection"]:checked');
  await chrome.storage.local.set({
    serverUrl: normalizeServerUrl($("serverUrl").value),
    username: $("username").value.trim(),
    password: $("password").value,
    collections: cachedCollections,
    collectionUrl: sel ? sel.value : null,
    defaultTags: splitTags($("defaultTags").value),
    prependUrl: $("prependUrl").checked,
    dateStamp: $("dateStamp").checked,
    ...extra,
  });
}

$("save").addEventListener("click", async () => {
  try {
    setStatus("Saving…");
    const stored = await chrome.storage.local.get(["serverUrl", "username", "password"]);
    const connChanged =
      normalizeServerUrl($("serverUrl").value) !== stored.serverUrl ||
      $("username").value.trim() !== stored.username ||
      $("password").value !== stored.password;

    if (connChanged || !cachedCollections.length) {
      cachedCollections = await connect();
      renderCollections(cachedCollections, null);
    }

    const journalCapable = cachedCollections.filter((c) => c.supportsVJournal);
    if (!journalCapable.length) {
      setStatus("Saved — but note: none of these collections advertise VJOURNAL support.", "warn");
    }

    await persist();
    if (!$("status").textContent.startsWith("Saved")) setStatus("Saved", "ok");
  } catch (err) {
    setStatus(String((err && err.message) || err), "error");
  }
});

$("reload").addEventListener("click", async () => {
  try {
    setStatus("Connecting…");
    cachedCollections = await connect();
    renderCollections(cachedCollections, await currentSelection());
    setStatus(`Found ${cachedCollections.length} collection(s). Save to keep them.`, "ok");
  } catch (err) {
    setStatus(String((err && err.message) || err), "error");
  }
});

async function currentSelection() {
  const s = await chrome.storage.local.get("collectionUrl");
  return s.collectionUrl;
}

load();
