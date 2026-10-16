# CalDAV Clipper

A Chromium browser extension that saves the current web page with optional annotations as a journal note to any CalDAV server.

Each clip is stored as a `VJOURNAL` entry with a title, URL, optional note/selection, and tags. Read and organise the notes in any CalDAV client, for example [Spectacled](https://github.com/TechbeeAT/spectacled) on desktop or [jtx Board](https://jtx.techbee.at) on Android.

## Install (unpacked)

1. Clone this repository.
2. Open `vivaldi://extensions` (or `chrome://extensions`)
3. Enable **Developer mode**
4. Click **Load unpacked** and select this folder

Enter your server's URL, a username, and a password. Click "Reload list", choose which calendar to store notes to, then save.

## Privacy and security

- No telemetry, no analytics, no external requests.
- Credentials live in the browser's local extension storage; they are sent only to the server you configure.
- Host access is requested only for your configured server's origin.
- Best practice is to create a dedicated user on your CalDAV server, e.g. "clipper", and to share only your notes calendar with this user. This way the clipper cannot reach your other calendars.

