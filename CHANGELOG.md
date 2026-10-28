# Changelog

All notable changes to this project are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [2.1.0] - 2026-10-28

### Added
- **Accent colour** in Settings → General: pick any colour, or one of six swatches (including Bonsai pink), for buttons, badges, progress bars and highlights. **Use default** goes back to Drift monochrome, which is still the default. Text on accent buttons switches between black and white to suit the colour, and accent-coloured text is lightened or darkened as needed to stay readable (4.5:1) on both the dark and light themes.

## [2.0.0] - 2026-10-27

### Changed
- Rebranded as **Drift Dashboard**, from Drift Creative Systems (was Bonsai Dashboard). The window title, tray/menu bar tooltip, installer, update bar and the device names shown to Plex, Drift: Record and WordPress all use the new name. The dashboard's header and the README are headed **Drift: Dashboard**, and the README has the Drift banner.
- The source repo is now public, at [drift-creative-systems/drift-dashboard](https://github.com/drift-creative-systems/drift-dashboard). Releases still come from `bonsai-dashboard-releases`, so installed copies keep updating.
- `npm run mac` also removes the old `Bonsai Dashboard.app` from Applications, and won't install while either copy is running.
- New icons: the Drift D monogram in the master brand's monochrome. The app and installer icon is the brand pack's dark rounded square with a white D; the Windows tray uses the same mark, and the macOS menu bar a black D template. `npm run icons` draws them from the brand pack's vector paths.
- The pink and light blue Bonsai colour scheme is now Drift monochrome: white buttons, badges, progress bars and highlights on the dark theme, black on the light theme, and a neutral grey background in light mode. The header's pink square is now the Drift D. Status colours, the focus ring and service logos are unchanged, and the Support/Uptime cards keep the Bonsai mark.
- The browser page shown after an OAuth sign-in, and the default card icon colour, use the Drift colours too.

### Added
- On first start, Drift Dashboard copies your accounts, layout and settings from the old `Bonsai Dashboard` settings folder (skipping caches), leaving the old folder as a backup. Saved passwords come across on Windows; on a Mac they're tied to the old keychain entry and need entering again.

## [1.10.0] - 2026-10-27

### Added
- Gmail cards have a **Show** option: unread emails (as before), **Important and unread** (only unread emails Gmail marked Important, using Gmail's own `is:important` search; the count matches), or the latest emails whether read or not. Existing cards keep their current setting.
- **Google Calendar (sign-in, with colours)** card type. It reads Google Calendar through its API (read-only), so Up next shows each event in the colour you gave it, and the calendar's colour for the rest. Optionally includes the other calendars ticked in Google Calendar. Needs a one-off Google Cloud OAuth client (Desktop app); the same client works for every Google account. Google's iCal links can't do this because they don't include colours.
- iCal events that carry their own colour (the `COLOR` property, e.g. Fastmail, Apple) now show it in Up next.
- **Open links with**: pick which app opens the dashboard's links in Settings → General (the browsers on this computer are listed, or choose any app), and override it per card under Edit → Advanced. Slack links still open in Slack. Apps are started directly with the link as their only argument, with no shell.
- **How to set this up** in the add/edit account form: the README's setup steps for that card type, with working links and a Copy button for code such as the Slack manifest. Read from README.md at runtime, so there's one copy to maintain (README.md is now packaged with the app).
- Claude plan usage works on macOS. Claude Code keeps its sign-in in the login Keychain there, not in `~/.claude/.credentials.json`, so the card now reads the `Claude Code-credentials` item with Apple's `security` tool. That includes the suffixed name Claude Code uses with `CLAUDE_CONFIG_DIR`, and falls back to the newest of any other `Claude Code-credentials-…` items, then to the file. It retries as soon as the keychain changes, so a renewed sign-in shows up straight away. Clear messages for a locked keychain or refused access.
- **Menu bar readout** (macOS): Settings → General → **Menu bar shows** puts the next meeting (`Client call · in 25m`), the Spotify track playing, or Claude usage (`Claude 64% · wk 81%`) beside the menu bar icon. Clicking the icon opens a menu with all three: the next meeting with **Join meeting** and **Open in calendar** (and the next few under Later), the track, Claude's limits, and a quick switch for what the menu bar shows. The chosen source keeps checking while the dashboard is closed. On Windows the line is the tray tooltip and right-click opens the menu.
- Meeting links: Google Calendar (sign-in) reads the event's Meet or conference link, Outlook its Teams join link, and iCal events have Meet/Zoom/Teams/Webex links found in their details. Up next shows a **Join** button for the next event when it has one.
- **Mac app**: `npm run mac` builds Bonsai Dashboard as a Mac app for this Mac's chip, signs it ad hoc (Apple silicon won't run it otherwise) and installs it in Applications, replacing the old copy. It uses the same accounts as `npm start` (`~/Library/Application Support/Bonsai Dashboard`). It isn't Developer ID–signed or notarised, so it's for your own Mac, and it doesn't update itself: Settings → Updates says to rebuild instead.

### Changed
- macOS: clicking the Dock icon reopens the window after it's been closed to the menu bar. "Start with Windows" reads **Open at login** and starts in the menu bar, and the Accounts note mentions the Mac's keychain instead of Windows.
- On macOS, clicking the menu bar icon opens its menu (with Open dashboard) instead of the window.
- README: Part 1 has Mac install steps (`npm run mac`), and the Claude plan usage and Clawd steps cover macOS as well as Windows (where the sign-in lives, the keychain prompt, reduced motion, settings paths).
- New menu bar icon on macOS: a crisp black-and-clear template image (18pt, with @2x), which macOS tints for light and dark menu bars. Windows gets 16px and 32px tray icons instead of one 32px icon scaled down, and the app icon is now 512px. All are still drawn by `npm run icons`.
- In Up next, an event's own colour now comes before the card's icon colour.

### Fixed
- Up next could show "In 1 h 60 min" instead of "In 2 h 0 min".

## [1.9.1] - 2026-10-26

### Fixed
- The ↑ ↓ buttons in Settings now move an account within its own group, e.g. reordering ClickUp workspaces. Before, they swapped it with the account next to it in the full list, which could belong to another provider, so nothing appeared to change.

## [1.9.0] - 2026-10-26

### Added
- Desktop alerts (Windows notifications) when a site goes down or comes back up, when an urgent or high-priority support ticket appears, and when a Claude plan limit passes 90% or runs out. The Uptime, Support tickets and Claude cards keep checking while the dashboard is in the tray, so these arrive with the window closed. Each type can be switched off under Settings → General → Desktop alerts, and by default they only show when the dashboard isn't in front. Starting the app doesn't replay old tickets, and sites already down get one summary.
- Hide a card: hover it and click ✕. Hidden cards aren't checked and don't alert. Show them again from Settings, where every account now has a Hide/Show button.
- Clawd can now show what Claude Code is doing. **Connect Clawd** in Settings adds hooks to Claude Code's `settings.json` (backed up first), and then he types while Claude works, puts his arms up while it waits for your approval, and waves when it finishes. **Disconnect Clawd** removes only those hooks.

### Changed
- Starting with Windows (`--hidden`) now lets the alerting cards check in the background. Other cards still wait until the window opens.

## [1.8.0] - 2026-10-18

### Added
- Drift: Record card in "Right now": the next gig or festival you're going to (*Planned* or *Booked*), with a countdown, venue, city, doors, train times, hotel and total cost. Below it are the next 4 events with Booked/Planned pills, and this year's event count and spend, matching the app's dashboard. A festival you're at shows "On now · until …". Clicking opens the Drift: Record app.
- Signs in to the Drift: Record plugin API (`/wp-json/drift-record/v1/`) with your app email and password, then reuses the 180-day token. It signs in again only if the token is rejected or you change the email or site, which keeps it well inside the plugin's login rate limit. The password and token are stored encrypted. The address defaults to record.driftcreativesystems.co.uk.
- The Drift "D" mark as the card's logo. Logos in `scripts/make-logos.js` can now carry their own viewBox, for our own marks that aren't in Simple Icons.
- Demo card for `npm run demo`.

## [1.7.0] - 2026-10-18

### Added
- Clawd, the pixel crab from Claude Code's welcome screen, now lives in a strip across the Claude card. He wanders about, follows the mouse, and dozes after 10 minutes without it. He sweats from 90% of the session limit and lies belly-up at 100%, and he burrows into the sand while the card has an error. He celebrates with confetti when the session resets. Click him for a random Claude Code animation (jump, spin, wink, turn, coin hop and more). With reduced motion switched on in Windows, he stays still unless you click him.
- Art and animations are ported from [clawd-usage-winwidget](https://github.com/Enhed/clawd-usage-winwidget) by Venger Sergey (MIT) and drawn on a canvas, with no new dependencies or network access.

## [1.6.1] - 2026-10-16

### Fixed
- The Claude card no longer waits up to 5 minutes (longer after repeated failures) to notice a renewed sign-in. It watches Claude Code's settings folder and retries within a couple of seconds of `.credentials.json` changing, but only while the card is showing an error. If the window is hidden, it catches up when you open it.

## [1.6.0] - 2026-10-14

### Changed
- The Claude card now shows your Claude plan's real limits instead of estimates from local logs: % of the current session (5-hour) and weekly limits used, reset times, extra usage credits used, and this week's split by app (Claude Code, chats, Cowork). Same figures as Claude Code's `/usage`. Renamed "Claude plan usage".
- It reads Claude Code's sign-in from `~/.claude/.credentials.json` (or `CLAUDE_CONFIG_DIR`, or the folder in Settings) and calls the usage endpoint Claude Code uses, every 5 minutes. The token stays in the main process and is never refreshed by the dashboard; an expired sign-in shows a prompt to open Claude Code.
- Bars turn amber from 75% and red from 90%, or when Claude flags the limit.

### Removed
- The estimated API cost, token counts, 5-hour block worked out from local logs, and today/week/month, model and project totals. The cost meant nothing on a Pro plan and the block times didn't match Claude's.

## [1.5.0] - 2026-10-14

### Added
- Claude Code usage card in "Right now": estimated cost and tokens for the current 5-hour block (with reset time, time left and a progress bar), today, this week (from Monday) and this month, plus today's split by model and the three busiest projects. Reads the session logs under `~/.claude/projects` (including subagent logs, `CLAUDE_CONFIG_DIR`, or a folder set in Settings); no sign-in.
- Each reply is counted once (Claude Code repeats the usage on every content block), files untouched for 32 days are skipped, and each log is only read from where the last check stopped, so a refresh takes milliseconds after the first read.
- Cost is estimated at API list prices per model, with 5-minute and 1-hour cache writes and cache reads priced separately. **Plan limits on claude.ai** opens the claude.ai usage page.
- Claude logo from Simple Icons, and a demo card for `npm run demo`.

## [1.4.1] - 2026-10-14

### Fixed
- Xbox card showed no games for some accounts. It now reads OpenXBL's `achievements` endpoint (the one the Drift Xbox tracker uses) instead of `player/titleHistory`, accepts the list as `titles` or `content.titles`, sorts by parsed date, and upgrades `http://` box art to `https://` so the window doesn't block it.

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
