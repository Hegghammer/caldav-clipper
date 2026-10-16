import { buildIcs, newUid } from "../lib/ical.js";
import { authHeader, putJournal } from "../lib/dav.js";

const $ = (id) => document.getElementById(id);

let pageUrl = "";

async function init() {
  const s = await chrome.storage.local.get(null);
  const openSettings = () => chrome.runtime.openOptionsPage();
  $("settings-btn").addEventListener("click", openSettings);

  if (!s.collectionUrl) {
    $("unconfigured").hidden = false;
    $("open-settings").addEventListener("click", openSettings);
    return;
  }

  $("clip").hidden = false;

  let tab = null;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch {
    /* ignore */
  }

  let selection = "";
  if (tab && tab.id != null) {
    try {
      const [r] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => window.getSelection().toString(),
      });
      selection = (r && r.result) || "";
    } catch {
      /* privileged page — no selection available */
    }
  }

  pageUrl = (tab && tab.url) || "";
  $("title").value = (tab && tab.title) || pageUrl || "Untitled";
  $("pageurl").textContent = pageUrl;
  if (selection) $("note").value = selection.trim();
  $("tags").value = (s.defaultTags || []).join(", ");

  const sel = $("collection");
  const list = (s.collections || []).filter((c) => c.url);
  if (list.length) {
    for (const c of list) {
      const opt = document.createElement("option");
      opt.value = c.url;
      opt.textContent = c.name;
      sel.appendChild(opt);
    }
  } else {
    const opt = document.createElement("option");
    opt.value = s.collectionUrl;
    opt.textContent = "Default collection";
    sel.appendChild(opt);
  }
  if (![...sel.options].some((o) => o.value === s.collectionUrl)) {
    const opt = document.createElement("option");
    opt.value = s.collectionUrl;
    opt.textContent = "Default collection";
    sel.appendChild(opt);
  }
  sel.value = s.collectionUrl;

  $("note").addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") $("clip").requestSubmit();
  });

  $("clip").addEventListener("submit", onSave);
}

async function onSave(e) {
  e.preventDefault();
  const s = await chrome.storage.local.get(null);
  const collectionUrl = $("collection").value || s.collectionUrl;
  if (!collectionUrl) {
    setStatus("No collection — configure the extension first.", "error");
    return;
  }

  const uid = newUid();
  const bodyParts = [];
  if (s.prependUrl !== false && pageUrl) bodyParts.push(pageUrl);
  const note = $("note").value.trim();
  if (note) bodyParts.push(note);

  const ics = buildIcs({
    uid,
    title: $("title").value.trim() || "Untitled",
    url: pageUrl,
    description: bodyParts.join("\n\n"),
    tags: splitTags($("tags").value),
    includeDate: s.dateStamp !== false,
  });

  $("save").disabled = true;
  setStatus("Saving…");
  try {
    await putJournal({
      collectionUrl,
      auth: authHeader(s.username || "", s.password || ""),
      ics,
      uid,
    });
    // Remember the last-used collection as the new default.
    await chrome.storage.local.set({ collectionUrl });
    setStatus("Saved", "ok");
    setTimeout(() => window.close(), 650);
  } catch (err) {
    setStatus(String((err && err.message) || err), "error");
    $("save").disabled = false;
  }
}

function splitTags(value) {
  return String(value || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function setStatus(text, kind) {
  const el = $("status");
  el.textContent = text;
  el.className = "status" + (kind ? " " + kind : "");
}

init();
