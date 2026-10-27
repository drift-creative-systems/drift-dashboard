/**
 * The menu bar (macOS) / tray (Windows) readout and menu.
 *
 * Settings → General → "Menu bar shows" picks one line of text to sit next
 * to the icon: the next meeting, what's playing on Spotify, or Claude plan
 * usage (or nothing). macOS shows it beside the icon; Windows trays can't
 * show text, so there it's the hover tooltip.
 *
 * Clicking the icon opens a menu with all three, whatever's chosen: the
 * next meeting with Join meeting / Open in calendar, the track playing,
 * Claude's limits, then a quick switch for what the menu bar shows.
 *
 * The chosen source keeps checking while the dashboard is closed (see
 * `wanted`), so the menu bar stays current. Everything here reads the
 * scheduler's card snapshots; nothing new is fetched.
 */
const { Menu } = require('electron');

const MODES = ['none', 'meeting', 'spotify', 'claude'];
const MODE_LABELS = { none: 'Icon only', meeting: 'Next meeting', spotify: 'Spotify', claude: 'Claude usage' };
const CALENDARS = ['ics', 'gcal', 'outlook'];
const MAC = 'darwin' === process.platform;

/** Only show meetings starting within this long in the menu bar text. */
const MEETING_HORIZON = 12 * 3600000;
const TICK = 30000; // Countdown refresh.

function mode(settings) {
	return MODES.includes(settings.menuBar) ? settings.menuBar : 'none';
}

/** Which card types must keep checking in the background for this mode. */
function wanted(provider, settings) {
	const m = mode(settings);
	return ('meeting' === m && CALENDARS.includes(provider))
		|| ('spotify' === m && 'spotify' === provider)
		|| ('claude' === m && 'claude' === provider);
}

function trunc(text, max) {
	const chars = [...String(text || '')];
	return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : chars.join('');
}

function clock(date) {
	return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/** "now", "in 25m", "in 1h 10m", "14:00". */
function relative(ev, now = Date.now()) {
	const start = new Date(ev.start).getTime();
	if (start <= now) {
		return 'now';
	}
	const mins = Math.round((start - now) / 60000);
	if (mins < 60) {
		return `in ${mins}m`;
	}
	if (mins < 120) {
		return `in 1h ${mins - 60}m`;
	}
	return clock(new Date(start));
}

/** "Today 14:00–15:00", "Tomorrow 09:30–10:00". */
function span(ev) {
	const start = new Date(ev.start);
	const end = new Date(ev.end || ev.start);
	const today = new Date();
	const tomorrow = new Date(today.getTime() + 86400000);
	const day = start.toDateString() === today.toDateString()
		? 'Today'
		: (start.toDateString() === tomorrow.toDateString() ? 'Tomorrow' : start.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }));
	return ev.allDay ? `${day} · all day` : `${day} ${clock(start)}–${clock(end)}`;
}

/**
 * @param {object} deps
 *   tray        Electron Tray
 *   cards       () => card snapshots (scheduler.all())
 *   accounts    () => accounts (store.accounts())
 *   isHidden    (id) => whether a card is hidden
 *   settings    () => app settings
 *   setMode     (mode) => save the "Menu bar shows" setting
 *   openLink    (url, accountId) => open a link with the card's chosen app
 *   showWindow, refresh, quit
 */
function create(deps) {
	let timer = null;
	let lastTitle = null;
	let lastMenuKey = null;

	const visibleCards = () => deps.cards().filter((c) => !deps.isHidden(c.id));

	/** Upcoming timed events from every calendar card, soonest first. */
	function events() {
		const accounts = new Map(deps.accounts().map((a) => [a.id, a]));
		const now = Date.now();
		const out = [];
		for (const card of visibleCards()) {
			const account = accounts.get(card.id);
			if (!account || !CALENDARS.includes(card.provider)) {
				continue;
			}
			if ('outlook' === card.provider && false === account.config.show_calendar) {
				continue;
			}
			for (const ev of (card.data && card.data.events) || []) {
				if (new Date(ev.end || ev.start).getTime() > now) {
					out.push({ ...ev, cardId: card.id });
				}
			}
		}
		return out.sort((a, b) => a.start.localeCompare(b.start));
	}

	/** The meeting to feature: one in progress, else the next timed one. */
	function nextMeeting(list = events()) {
		return list.find((e) => !e.allDay) || null;
	}

	function spotify() {
		const card = visibleCards().find((c) => 'spotify' === c.provider && c.data);
		return card ? { ...card.data, cardId: card.id } : null;
	}

	function claude() {
		const card = visibleCards().find((c) => 'claude' === c.provider && (c.data || c.error));
		if (!card) {
			return null;
		}
		const limits = (card.data && card.data.limits) || [];
		return {
			cardId: card.id,
			error: 'error' === card.status ? card.error : null,
			session: limits.find((l) => /session/i.test(l.name)) || limits[0] || null,
			weekly: limits.find((l) => /weekly · all/i.test(l.name)) || limits.find((l) => /weekly/i.test(l.name)) || null,
			limits,
			url: card.data && card.data.url,
		};
	}

	/* ------------------------------------------------------------- Menu bar text */

	function title() {
		const m = mode(deps.settings());
		if ('meeting' === m) {
			const ev = nextMeeting();
			if (!ev || new Date(ev.start).getTime() - Date.now() > MEETING_HORIZON) {
				return '';
			}
			return `${trunc(ev.title, 24)} · ${relative(ev)}`;
		}
		if ('spotify' === m) {
			const s = spotify();
			if (!s || !s.playing || !s.track) {
				return '';
			}
			return `♫ ${trunc(s.track.title, 22)} – ${trunc(s.track.artist, 16)}`;
		}
		if ('claude' === m) {
			const c = claude();
			if (!c || (!c.session && c.error)) {
				return c && c.error ? 'Claude !' : '';
			}
			const parts = [c.session ? `${c.session.percent}%` : null, c.weekly ? `wk ${c.weekly.percent}%` : null].filter(Boolean);
			return parts.length ? `Claude ${parts.join(' · ')}` : '';
		}
		return '';
	}

	/* --------------------------------------------------------------------- Menu */

	function menuTemplate() {
		const items = [];
		const settings = deps.settings();

		// Next meeting.
		const list = events();
		const next = nextMeeting(list);
		if (next) {
			items.push({ label: trunc(next.title, 48), enabled: false });
			items.push({ label: `${'now' === relative(next) ? 'Now' : relative(next).replace(/^in/, 'In')} · ${span(next)}`, enabled: false });
			if (next.meetingUrl) {
				items.push({ id: `join ${next.meetingUrl}`, label: 'Join meeting', click: () => deps.openLink(next.meetingUrl, next.cardId) });
			}
			if (next.url) {
				items.push({ id: `open ${next.url}`, label: 'Open in calendar', click: () => deps.openLink(next.url, next.cardId) });
			}
			const later = list.filter((e) => e !== next).slice(0, 4);
			if (later.length) {
				items.push({
					label: 'Later',
					submenu: later.map((e) => ({
						id: `later ${e.meetingUrl || e.url}`,
						label: `${trunc(e.title, 40)} · ${span(e)}`,
						click: () => deps.openLink(e.meetingUrl || e.url, e.cardId),
					})),
				});
			}
		} else if (list.length || visibleCards().some((c) => CALENDARS.includes(c.provider))) {
			items.push({ label: 'No meetings coming up', enabled: false });
		}

		// Spotify.
		const s = spotify();
		if (s && s.track) {
			if (items.length) {
				items.push({ type: 'separator' });
			}
			items.push({
				id: `track ${s.track.url}`,
				label: `${s.playing ? '♫' : 'Last played:'} ${trunc(s.track.title, 36)} – ${trunc(s.track.artist, 24)}`,
				click: () => deps.openLink(s.track.url, s.cardId),
				enabled: Boolean(s.track.url),
			});
		}

		// Claude.
		const c = claude();
		if (c) {
			if (items.length) {
				items.push({ type: 'separator' });
			}
			if (c.error && !c.limits.length) {
				items.push({ label: `Claude: ${trunc(c.error, 60)}`, enabled: false });
			}
			for (const l of c.limits.slice(0, 3)) {
				const reset = l.resetsAt ? ` · resets ${new Date(l.resetsAt).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : '';
				items.push({ label: `Claude ${l.name.toLowerCase()}: ${l.percent}%${reset}`, enabled: false });
			}
			if (c.url) {
				items.push({ label: 'Open usage on claude.ai', click: () => deps.openLink(c.url, c.cardId) });
			}
		}

		if (items.length) {
			items.push({ type: 'separator' });
		}
		items.push({
			label: MAC ? 'Show in menu bar' : 'Show in tray tooltip',
			submenu: MODES.map((m) => ({
				label: MODE_LABELS[m],
				type: 'radio',
				checked: mode(settings) === m,
				click: () => deps.setMode(m),
			})),
		});
		items.push({ type: 'separator' });
		items.push({ label: 'Open dashboard', click: deps.showWindow });
		items.push({ label: 'Refresh everything', click: deps.refresh });
		items.push({ type: 'separator' });
		items.push({ label: 'Quit', click: deps.quit });
		return items;
	}

	/**
	 * Redraw the text and menu. The menu is only rebuilt when its content
	 * changes, so Spotify's 15-second checks don't keep replacing it.
	 */
	function update() {
		const text = title();
		if (text !== lastTitle) {
			lastTitle = text;
			if (MAC) {
				deps.tray.setTitle(text ? ` ${text}` : '', { fontType: 'monospacedDigit' });
			}
			deps.tray.setToolTip(text ? `Drift Dashboard · ${text}` : 'Drift Dashboard');
		}
		const template = menuTemplate();
		const key = JSON.stringify(template, (k, v) => ('click' === k ? undefined : v));
		if (key !== lastMenuKey) {
			lastMenuKey = key;
			deps.tray.setContextMenu(Menu.buildFromTemplate(template));
		}
	}

	function start() {
		update();
		clearInterval(timer);
		timer = setInterval(update, TICK);
	}

	function stop() {
		clearInterval(timer);
	}

	return { update, start, stop };
}

module.exports = { create, wanted, mode, MODES };
