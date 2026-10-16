import { buildIcs, newUid } from "./lib/ical.js";
import { authHeader, putJournal } from "./lib/dav.js";

const MENU_ID = "caldav-clipper-save";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "Save page to CalDAV notes",
      contexts: ["page", "selection"],
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab || !tab.url) return;
  const s = await chrome.storage.local.get(null);
  if (!s.collectionUrl) {
    chrome.runtime.openOptionsPage();
    return;
  }
  const uid = newUid();
  const bodyParts = [];
  if (s.prependUrl !== false) bodyParts.push(tab.url);
  if (info.selectionText) bodyParts.push(info.selectionText.trim());
  const ics = buildIcs({
    uid,
    title: tab.title || tab.url,
    url: tab.url,
    description: bodyParts.join("\n\n"),
    tags: splitTags(s.defaultTags),
    includeDate: s.dateStamp !== false,
  });
  try {
    await putJournal({
      collectionUrl: s.collectionUrl,
      auth: authHeader(s.username || "", s.password || ""),
      ics,
      uid,
    });
    notify("Saved to CalDAV", tab.title || tab.url);
  } catch (err) {
    notify("CalDAV Clipper — save failed", String((err && err.message) || err));
  }
});

function splitTags(list) {
  return (Array.isArray(list) ? list : String(list || "").split(","))
    .map((t) => String(t).trim())
    .filter(Boolean);
}

function notify(title, message) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon128.png"),
    title,
    message,
  });
}
