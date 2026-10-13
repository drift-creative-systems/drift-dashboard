# Changelog

All notable changes to this project are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.4.0] - 2026-10-13

### Added
- Plex card in "Right now": who is streaming from your Plex Media Server and what they're watching. One row per stream with poster, user, title (show + S01E03 + episode name, or film + year, or track + artist), device, playing/paused, time left and progress, plus Direct/Transcode, resolution and Remote pills. Heading shows stream count, transcodes and total bandwidth. Polls `/status/sessions` every 30 seconds.
- Plex setup: server address (plain `http://` allowed only for private LAN addresses, port 32400 added if missing) and the X-Plex-Token, which can be pasted on its own or as the whole View XML address. Posters are fetched in the main process and sent to the card as data URIs (cached 6 hours, 200 KB cap), so the token never reaches the window.
- Plex logo from Simple Icons, and a demo card for `npm run demo`.

## [1.3.0] - 2026-10-13

### Added
- Sections below "Right now" (Email, Slack, ClickUp, Money, Support & uptime, GitHub) can be reordered: drag the ⠿ handle on the heading, or use ▲ ▼ (keyboard-accessible, announced to screen readers). "Right now" stays at the top. Order is saved to `config.json` (`layout.sectionOrder`); sections with no accounts yet keep their place.

## [1.2.0] - 2026-10-13

### Changed
- "Right now" is now a board of columns (2–5, picked beside the heading, 4 by default), so cards stack under each other with no gaps, e.g. Strava directly under Spotify. Drag a card into any column, or use the arrow keys on its grip (↑ ↓ within a column, ← → between columns).
- Saved layout is now `{ count, columns, sizes }`. A 1.1.0 layout is converted automatically: its order is dealt out across the columns left to right.

### Removed
- The width button on "Right now" cards (each card is one column wide).

## [1.1.0] - 2026-10-13

### Added
- Automatic updates (electron-updater 6.8.9). The installed app checks on start and every 6 hours, downloads in the background and shows a "Restart to update" bar; "Later" installs on quit. Settings has a new Updates panel with **Check for updates**. Disabled in `npm start` and demo mode.
- Public releases repo `drift-creative-systems/bonsai-dashboard-releases` for installers and `latest.yml`, so the app can update without a token while the source stays private. `npm run release` publishes; `npm run dist` builds without uploading.
- "Right now" cards can be rearranged and resized. Hover a card for its tools (bottom right): drag the grip (⠿) to move it, or focus the grip and use the arrow keys; ⇔ cycles the width through 1, 2 and 3 columns; the height button cycles normal, tall (Up next shows up to 12 events) and compact (scrolls, Up next shows 3). Moves and resizes are announced to screen readers.
- Layout is saved to `config.json` (`layout.now`: order and sizes), validated in the main process. New accounts are added at the end.

### Changed
- Up next no longer has a fixed double width; it defaults to 2 columns and can be changed like any other card.

## [1.0.0] - 2026-10-13

### Added
- Real service logos on cards (Gmail, Proton, Google Calendar, ClickUp, GitHub, Spotify, Strava) from Simple Icons (CC0), bundled via `npm run logos` (`scripts/make-logos.js` → `src/renderer/js/logos.js`). The Bonsai mark for support tickets and uptime; letter tiles stay for Outlook, Slack, Xbox and FreeAgent, which Simple Icons doesn't include. Light brand colours get a dark logo for contrast. Icons also show beside each account in Settings.
- Per-card icon override under Settings → Edit → Icon: an emoji or up to 2 letters, and/or a colour (with "Use default"). The colour also sets the card's border (an error still shows red) and, for calendars, its dots in Up next. Shared appearance fields apply to every card type (`fieldsFor()` in `providers/index.js`) and are validated on save.
- Paste check: client ID and secret fields refuse web addresses (catches the redirect URI pasted into the wrong field).
- "Only show unread emails" option on Gmail, Proton and Outlook cards, on by default (including cards added before it existed). Shows the latest 3 unread, "+N more unread" when there are more, and "All caught up" when there are none. Untick it to show the latest 3 emails, read or not.
- Weather card (Open-Meteo, no key): now, today, next 8 hours, sunrise/sunset and tomorrow. Location by UK postcode (postcodes.io), UK place name, "lat, long" or any place name.
- Bonsai Uptime Monitor card: up/down counts, sites down now, SSL/domain expiring within 30 days, incidents recovered in the last 24 hours. Reads the monitor's new read-only `api.php` with a key.
- GitHub card, one per account: latest 3 activity items across the 6 most recently pushed repos (PR titles and commit messages looked up when the events feed leaves them out) and Actions runs that failed in the last 7 days without a later success.
- FreeAgent card: bank balances, overdue invoices, invoices due in the next 2 weeks, bills due this week (incl. overdue) and the next 4 tax deadlines. Browser sign-in (OAuth with Basic client auth).
- "Money" and "GitHub" sections; "Support tickets" is now "Support & uptime", with a heading that counts open tickets and sites down separately.
- Electron desktop dashboard with a normal window, tray icon, close-to-tray and an optional start with Windows (opens in the tray).
- Cards: Up next (merged Google/Outlook/Proton calendars), Spotify now playing, Strava week (run time, walk time, gym sessions), Xbox last game (OpenXBL), email per inbox (Gmail via IMAP app passwords, Outlook via Microsoft Graph, Proton via Bridge), Slack latest DMs per workspace, ClickUp due this week + recent activity, Support Desk tickets per site.
- Settings screen: add, edit, reorder and remove accounts. Forms are generated from each provider's fields. Browser sign-in (PKCE) for Outlook, Spotify and Strava.
- Encrypted secret storage (Electron safeStorage / Windows DPAPI). Passwords and tokens are never in config.json or the window.
- Scheduler with per-service intervals, exponential backoff on errors, last good data kept on failure, and pausing while the window is hidden.
- Demo mode (`npm run demo`) with sample data in a throwaway settings folder.
- Step-by-step setup guide for every service in the README.
- Generated Bonsai-colour app and tray icons (`npm run icons`), syntax check (`npm run check`) and Windows installer build (`npm run dist`).
