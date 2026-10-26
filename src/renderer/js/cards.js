/**
 * Card renderers: one per provider, plus the combined "Up next" calendar.
 * Each takes the card snapshot from the main process and returns an element.
 */
(function () {
	'use strict';

	const { h, ago, shortTime, eventWhen, duration, km, plural } = window.BD;

	/** Icon letter, brand colour and dashboard section per provider. */
	const META = {
		gmail: { icon: 'G', brand: '#d93025', section: 'email' },
		outlook: { icon: 'O', brand: '#0a64c2', section: 'email' },
		proton: { icon: 'P', brand: '#6d4aff', section: 'email' },
		ics: { icon: 'C', brand: '#1a73e8', section: 'calendar' },
		slack: { icon: 'S', brand: '#4a154b', section: 'slack' },
		clickup: { icon: 'C', brand: '#7b68ee', section: 'clickup' },
		tickets: { icon: 'T', brand: '#ee4367', section: 'tickets' },
		spotify: { icon: '♫', brand: '#1a9e4b', section: 'now' },
		plex: { icon: '▶', brand: '#e5a00d', section: 'now' },
		claude: { icon: 'C', brand: '#d97757', section: 'now' },
		strava: { icon: 'S', brand: '#e34402', section: 'now' },
		xbox: { icon: 'X', brand: '#107c10', section: 'now' },
		weather: { icon: '☀', brand: '#d98a00', section: 'now' },
		uptime: { icon: 'U', brand: '#2b9348', section: 'tickets' },
		github: { icon: 'GH', brand: '#6e5494', section: 'github' },
		freeagent: { icon: 'F', brand: '#0f8b8d', section: 'money' },
		driftrecord: { icon: 'D', brand: '#8b5cf6', section: 'now' },
	};

	/** Colours for telling calendars apart in Up next. */
	const CAL_COLOURS = ['#ee4367', '#4f9dff', '#f2b134', '#3fb97a', '#b07cff', '#ff8a4c', '#2ec4c6', '#e84fd1'];

	const SECTIONS = [
		{ id: 'now', title: 'Right now', gridClass: 'board' },
		{ id: 'email', title: 'Email', gridClass: 'grid' },
		{ id: 'slack', title: 'Slack', gridClass: 'grid' },
		{ id: 'clickup', title: 'ClickUp', gridClass: 'grid' },
		{ id: 'money', title: 'Money', gridClass: 'grid' },
		{ id: 'tickets', title: 'Support & uptime', gridClass: 'grid' },
		{ id: 'github', title: 'GitHub', gridClass: 'grid' },
	];

	function open(url) {
		if (url) {
			window.dashboard.openLink(url);
		}
	}

	/* ------------------------------------------------------------ Building blocks */

	const SVG_NS = 'http://www.w3.org/2000/svg';
	const BONSAI = ['tickets', 'uptime']; // Our own services get the Bonsai mark.

	/** Whether white is unreadable on a colour (e.g. Spotify green), so use black. */
	function isLight(hex) {
		const n = parseInt(String(hex).replace('#', ''), 16);
		const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
		return lum > 0.6;
	}

	/**
	 * A card's icon: custom emoji/letters → service logo → Bonsai mark → letter.
	 * `appearance` is { icon, color } from the card's settings (both optional).
	 */
	function icon(provider, appearance = {}) {
		const meta = META[provider] || {};
		const logo = (window.BD.logos || {})[provider];
		const custom = String(appearance.icon || '').trim();
		const colour = appearance.color || (custom ? meta.brand : (logo ? logo.hex : meta.brand)) || '';
		const attrs = { class: ['card__icon', isLight(colour) && 'is-light'], style: { '--brand': colour }, 'aria-hidden': 'true' };

		if (custom) {
			// Emoji read better a little larger than letters.
			const emoji = /\p{Extended_Pictographic}/u.test(custom);
			return h('span', { ...attrs, class: [...attrs.class, emoji && 'is-emoji'] }, custom);
		}
		if (logo) {
			// Built node by node (no innerHTML), from bundled CC0 paths.
			const svg = document.createElementNS(SVG_NS, 'svg');
			svg.setAttribute('viewBox', logo.viewBox || '0 0 24 24');
			svg.setAttribute('class', 'card__logo');
			const path = document.createElementNS(SVG_NS, 'path');
			path.setAttribute('d', logo.path);
			svg.append(path);
			return h('span', attrs, svg);
		}
		if (BONSAI.includes(provider) && !appearance.color) {
			return h('span', { class: 'card__icon card__icon--bonsai', 'aria-hidden': 'true' });
		}
		return h('span', attrs, meta.icon || '•');
	}

	function shell(card, providerName, { sub, badge, wide } = {}, ...body) {
		const title = card.label || providerName;
		// A custom icon colour also colours the card's border.
		const accent = (card.appearance && card.appearance.color) || '';
		const updated = card.status === 'error' && card.failedAt
			? `failed ${ago(card.failedAt)}`
			: (card.updatedAt ? ago(card.updatedAt) : '');

		return h('article', {
			class: ['card', `card--${card.provider}`, `is-${card.status}`, card.refreshing && 'is-refreshing', wide && 'card--wide', accent && 'has-accent'],
			'aria-labelledby': `card-${card.id}`,
			style: accent ? { '--card-accent': accent } : null,
		},
			h('header', { class: 'card__head' },
				icon(card.provider, card.appearance),
				h('div', { class: 'card__titles' },
					h('h3', { class: 'card__title', id: `card-${card.id}` }, title),
					sub ? h('p', { class: 'card__sub' }, sub) : null
				),
				badge !== undefined && badge !== null ? badge : null,
				h('div', { class: 'card__meta' },
					h('span', null, updated),
					h('button', {
						type: 'button',
						class: 'icon-btn card__refresh',
						'aria-label': `Refresh ${title}`,
						title: 'Refresh',
						on: { click: () => window.dashboard.refresh(card.id) },
					}, '↻'),
					h('button', {
						type: 'button',
						class: 'icon-btn card__hide',
						'aria-label': `Hide ${title}`,
						title: 'Hide this card (show it again in Settings)',
						on: { click: () => window.BD.hideCard(card.id, true) },
					}, '✕')
				)
			),
			card.status === 'error' ? h('p', { class: 'card__error', role: 'alert' }, card.error) : null,
			card.status === 'loading' && !card.data ? h('div', { class: 'skeleton', 'aria-label': 'Loading' }) : null,
			...(card.data ? body : [])
		);
	}

	function unreadBadge(n) {
		return h('span', { class: ['badge', !n && 'badge--quiet'], title: `${n} unread`, 'aria-label': `${n} unread` }, n > 99 ? '99+' : String(n));
	}

	function row({ main, time, sub, text, unread, url, timeClass, before }) {
		return h('li', null,
			h('button', { type: 'button', class: ['row', unread && 'is-unread'], on: { click: () => open(url) } },
				h('span', { class: 'row__top' },
					before || null,
					h('span', { class: 'row__main' }, main),
					time ? h('span', { class: ['row__time', timeClass] }, time) : null
				),
				sub ? h('span', { class: 'row__sub' }, sub) : null,
				text ? h('span', { class: 'row__text' }, text) : null
			)
		);
	}

	function rows(items, empty) {
		return items.length ? h('ul', { class: 'rows' }, items) : h('p', { class: 'card__empty' }, empty);
	}

	/* ------------------------------------------------------------------ Renderers */

	function email(card, name) {
		const d = card.data || {};
		const shown = d.messages || [];
		const more = d.unreadOnly ? (d.unread || 0) - shown.length : 0;
		return shell(card, name, { sub: d.email, badge: card.data ? unreadBadge(d.unread || 0) : null },
			rows(shown.map((m) => row({
				main: m.subject,
				sub: m.from,
				time: shortTime(m.date),
				unread: m.unread,
				url: m.url,
			})), d.unreadOnly ? 'All caught up: no unread email.' : 'Inbox is empty.'),
			more > 0 ? h('p', { class: 'muted small' }, `+${more} more unread`) : null,
			h('button', { type: 'button', class: 'btn btn--small btn--ghost', on: { click: () => open(d.url) } }, 'Open inbox')
		);
	}

	function spotify(card, name) {
		const d = card.data || {};
		const t = d.track;
		if (!t) {
			return shell(card, name, {}, h('p', { class: 'card__empty' }, 'Nothing played recently.'));
		}
		const pct = t.duration ? Math.min(100, Math.round((d.progress / t.duration) * 100)) : 0;
		return shell(card, name, {},
			h('button', { type: 'button', class: 'media', on: { click: () => open(t.url) }, 'aria-label': `${t.title} by ${t.artist}, open in Spotify` },
				t.image ? h('img', { class: 'media__art', src: t.image, alt: '', width: 72, height: 72 }) : h('span', { class: 'media__art' }),
				h('span', { class: 'media__body' },
					h('span', { class: 'media__state' }, d.playing ? 'Now playing' : (d.playedAt ? `Last played · ${ago(d.playedAt)}` : 'Paused')),
					h('span', { class: 'media__title' }, t.title),
					h('span', { class: 'media__sub' }, [t.artist, t.album].filter(Boolean).join(' · '))
				)
			),
			d.playing ? h('div', { class: 'progress', role: 'presentation' }, h('div', { class: 'progress__bar', style: { '--value': `${pct}%` } })) : null
		);
	}

	/* ----------------------------------------------------------------- Plex */

	const PLEX_STATE = { playing: 'Playing', paused: 'Paused', buffering: 'Buffering' };

	function mbps(kbps) {
		return `${(kbps / 1000).toFixed(kbps >= 10000 ? 0 : 1)} Mbps`;
	}

	function plexStream(s, url) {
		const pct = s.duration ? Math.min(100, Math.round((s.offset / s.duration) * 100)) : 0;
		const left = s.duration ? Math.max(0, (s.duration - s.offset) / 1000) : 0;
		const pills = [
			h('span', { class: ['pill', s.transcoding ? 'pill--warning' : 'pill--success'] }, s.transcoding ? 'Transcode' : 'Direct'),
			s.resolution ? h('span', { class: 'pill' }, /^\d+$/.test(s.resolution) ? `${s.resolution}p` : s.resolution) : null,
			s.remote ? h('span', { class: 'pill' }, 'Remote') : null,
		];
		return h('li', null,
			h('button', { type: 'button', class: 'stream', on: { click: () => open(url) }, 'aria-label': `${s.user} is watching ${s.title}${s.sub ? `, ${s.sub}` : ''} on ${s.device}. Open Plex` },
				s.image
					? h('img', { class: ['stream__art', 'track' === s.kind && 'is-square'], src: s.image, alt: '', width: 48, height: 'track' === s.kind ? 48 : 72 })
					: h('span', { class: ['stream__art', 'track' === s.kind && 'is-square'] }),
				h('span', { class: 'media__body' },
					h('span', { class: ['media__state', 'playing' !== s.state && 'is-paused'] }, `${PLEX_STATE[s.state] || s.state} · ${s.user}`),
					h('span', { class: 'media__title' }, s.title),
					s.sub ? h('span', { class: 'media__sub' }, s.sub) : null,
					h('span', { class: 'row__sub' }, [s.device, left ? `${duration(left)} left` : null].filter(Boolean).join(' · ')),
					h('span', { class: 'stream__pills' }, pills),
					s.duration ? h('span', { class: 'progress', role: 'presentation' }, h('span', { class: 'progress__bar', style: { '--value': `${pct}%` } })) : null
				)
			)
		);
	}

	function plex(card, name) {
		const d = card.data || {};
		const streams = d.streams || [];
		const sub = streams.length
			? [plural(streams.length, 'stream'), d.transcodes ? `${d.transcodes} transcoding` : null, d.bandwidth ? mbps(d.bandwidth) : null].filter(Boolean).join(' · ')
			: 'Nobody watching';
		const badge = card.data
			? h('span', { class: ['badge', !streams.length && 'badge--quiet'], 'aria-label': plural(streams.length, 'active stream') }, String(streams.length))
			: null;
		return shell(card, name, { sub, badge },
			streams.length
				? h('ul', { class: 'streams' }, streams.map((s) => plexStream(s, d.url)))
				: h('p', { class: 'card__empty' }, 'Nothing playing on your server.'),
			h('button', { type: 'button', class: 'btn btn--small btn--ghost', on: { click: () => open(d.url) } }, 'Open Plex')
		);
	}

	/* ----------------------------------------------------- Claude plan usage */

	/** "Resets 21:29 (in 4h 58m)" today, "Resets Sat 22:59" later on. */
	function resets(iso) {
		if (!iso) {
			return '';
		}
		const at = new Date(iso);
		const time = at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
		const left = (at - Date.now()) / 1000;
		if (at.toDateString() === new Date().toDateString()) {
			return left > 0 ? `Resets ${time} (in ${duration(left)})` : `Resets ${time}`;
		}
		return `Resets ${at.toLocaleDateString('en-GB', { weekday: 'short' })} ${time}`;
	}

	function limitLevel(l) {
		if ('critical' === l.severity || 'error' === l.severity || l.percent >= 90) {
			return 'is-error';
		}
		return 'normal' !== l.severity || l.percent >= 75 ? 'is-warning' : null;
	}

	function claude(card, name) {
		const d = card.data || {};
		const plan = d.plan ? `${d.plan[0].toUpperCase()}${d.plan.slice(1)} plan` : '';
		const money = (n, cur) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: cur || 'GBP' }).format(n || 0);
		const x = d.extra;
		// Clawd's mood follows the current session (5-hour) limit.
		const session = (d.limits || []).find((l) => /session/i.test(l.name)) || (d.limits || [])[0];
		const mascot = window.BD.clawd ? window.BD.clawd.mount(card.id, {
			asleep: 'error' === card.status || !session,
			percent: session ? session.percent : null,
			resetsAt: session ? session.resetsAt : null,
			critical: session ? 'is-error' === limitLevel(session) : false,
		}) : null;

		return shell(card, name, { sub: plan },
			mascot,
			(d.limits || []).length
				? h('ul', { class: 'limits' }, d.limits.map((l) => h('li', { class: 'limit' },
					h('span', { class: 'limit__top' },
						h('span', { class: 'limit__name' }, l.name),
						h('span', { class: ['limit__pct', limitLevel(l)] }, `${l.percent}%`)
					),
					h('div', { class: 'progress', role: 'progressbar', 'aria-label': `${l.name} used`, 'aria-valuenow': l.percent, 'aria-valuemin': 0, 'aria-valuemax': 100 },
						h('div', { class: ['progress__bar', limitLevel(l)], style: { '--value': `${Math.min(100, l.percent)}%` } })),
					h('span', { class: 'row__sub' }, resets(l.resetsAt))
				)))
				: h('p', { class: 'card__empty' }, 'No plan limits reported.'),
			x ? h('p', { class: 'muted small' }, `Extra usage: ${money(x.used, x.currency)} used${null !== x.limit ? ` of ${money(x.limit, x.currency)}` : ''}`) : null,
			(d.apps || []).length ? h('h4', { class: 'list-title' }, 'This week by app') : null,
			(d.apps || []).length ? h('ul', { class: 'usage-list' }, d.apps.map((a) => h('li', null,
				h('span', { class: 'usage-list__name' }, a.name),
				h('span', { class: 'usage-list__value' }, `${a.percent}%`)
			))) : null,
			h('button', { type: 'button', class: 'btn btn--small btn--ghost', on: { click: () => open(d.url) } }, 'Open usage on claude.ai')
		);
	}

	function strava(card, name) {
		const t = (card.data && card.data.totals) || {};
		const stat = (label, value, sub) => h('div', { class: 'stat' },
			h('span', { class: 'stat__label' }, label),
			h('span', { class: 'stat__value' }, value),
			h('span', { class: 'stat__sub' }, sub)
		);
		const run = t.run || {};
		const walk = t.walk || {};
		const gym = t.gym || {};
		return shell(card, name, { sub: 'This week (from Monday)' },
			h('div', { class: 'stats' },
				stat(run.count ? `Run · ${run.count}` : 'Run', duration(run.seconds), run.count ? km(run.metres) : 'None yet'),
				stat(walk.count ? `Walk · ${walk.count}` : 'Walk', duration(walk.seconds), walk.count ? km(walk.metres) : 'None yet'),
				stat('Gym', String(gym.count || 0), 1 === gym.count ? 'session' : 'sessions')
			),
			h('button', { type: 'button', class: 'btn btn--small btn--ghost', on: { click: () => open('https://www.strava.com/dashboard') } }, 'Open Strava')
		);
	}

	function xbox(card, name) {
		const d = card.data || {};
		const g = d.game;
		if (!g) {
			return shell(card, name, {}, h('p', { class: 'card__empty' }, 'No games played yet.'));
		}
		const recent = (d.recent || []).map((r) => `${r.name} (${ago(r.playedAt)})`).join(', ');
		return shell(card, name, {},
			h('div', { class: 'media' },
				g.image ? h('img', { class: 'media__art', src: g.image, alt: '', width: 72, height: 72 }) : h('span', { class: 'media__art' }),
				h('span', { class: 'media__body' },
					h('span', { class: 'media__state' }, `Last played · ${ago(g.playedAt)}`),
					h('span', { class: 'media__title' }, g.name),
					g.totalGamerscore ? h('span', { class: 'media__sub' }, `${g.gamerscore} / ${g.totalGamerscore} G · ${g.progress}%`) : null
				)
			),
			g.totalGamerscore ? h('div', { class: 'progress', role: 'presentation' }, h('div', { class: 'progress__bar', style: { '--value': `${g.progress}%` } })) : null,
			recent ? h('p', { class: 'muted small' }, `Before that: ${recent}`) : null
		);
	}

	function slack(card, name) {
		const d = card.data || {};
		return shell(card, name, { sub: d.team ? `${d.team} · @${d.user}` : '' },
			rows((d.items || []).map((m) => row({
				main: m.mine ? `You → ${m.where}` : m.from,
				sub: m.mine ? null : m.where,
				text: m.text,
				time: shortTime(m.date),
				url: m.url,
			})), 'No recent direct messages.'),
			h('button', { type: 'button', class: 'btn btn--small btn--ghost', on: { click: () => open(d.url) } }, 'Open Slack')
		);
	}

	function clickupTask(t, mode) {
		const overdue = 'due' === mode && t.due && new Date(t.due) < new Date();
		return row({
			main: t.name,
			sub: [t.list, t.team].filter(Boolean).join(' · '),
			time: 'due' === mode ? (overdue ? `Overdue · ${shortTime(t.due)}` : shortTime(t.due)) : ago(t.updated),
			timeClass: overdue ? 'is-overdue' : null,
			url: t.url,
			before: t.status ? h('span', { class: 'pill', style: t.statusColor ? { '--pill': t.statusColor } : null }, t.status) : null,
		});
	}

	function clickup(card, name) {
		const d = card.data || {};
		const overdue = d.overdueCount ? h('span', { class: 'pill pill--error' }, `${d.overdueCount} overdue`) : null;
		return shell(card, name, { sub: (d.workspaces || []).join(', '), wide: true },
			h('div', { class: 'cols' },
				h('div', { class: 'stack' },
					h('h4', { class: 'list-title' }, `Due this week (${d.dueCount || 0})`, overdue),
					rows((d.due || []).map((t) => clickupTask(t, 'due')), 'Nothing due this week.')
				),
				h('div', { class: 'stack' },
					h('h4', { class: 'list-title' }, 'Recent activity on your tasks'),
					rows((d.activity || []).map((t) => clickupTask(t, 'activity')), 'Nothing changed in the last 3 days.')
				)
			),
			h('button', { type: 'button', class: 'btn btn--small btn--ghost', on: { click: () => open(d.url) } }, 'Open ClickUp')
		);
	}

	const TICKET_STATUS = { new: 'error', open: 'warning', awaiting_client: '', on_hold: '' };
	const TICKET_PRIORITY = { urgent: 'error', high: 'warning' };

	function tickets(card, name) {
		const d = card.data || {};
		const c = d.counts || {};
		const chip = (label, n, alert) => h('span', { class: ['chip', alert && n && 'is-alert'] }, label, h('strong', null, String(n || 0)));
		return shell(card, name, { sub: d.site, badge: card.data ? h('span', { class: ['badge', !d.total && 'badge--quiet'], 'aria-label': `${d.total} open tickets` }, String(d.total || 0)) : null },
			h('div', { class: 'chips' },
				chip('New', c.new, true),
				chip('Open', c.open),
				chip('Awaiting client', c.awaiting_client),
				chip('On hold', c.on_hold),
				chip('Mine', d.mine),
				chip('Unassigned', d.unassigned, true),
				d.slaMissed !== null && d.slaMissed !== undefined ? chip('SLA missed', d.slaMissed, true) : null
			),
			rows((d.latest || []).map((t) => row({
				main: t.title,
				sub: [t.ref, t.priority_label, t.assignee ? `→ ${t.assignee}` : 'Unassigned'].filter(Boolean).join(' · '),
				time: ago(t.last_activity),
				url: t.url,
				before: h('span', { class: ['pill', TICKET_STATUS[t.status] && `pill--${TICKET_STATUS[t.status]}`] }, t.status_label),
			})), 'No open tickets.'),
			h('button', { type: 'button', class: 'btn btn--small btn--ghost', on: { click: () => open(d.url) } }, 'Open all tickets')
		);
	}

	/**
	 * Calendar accounts (iCal links) don't get their own card; their events
	 * are merged with Outlook calendars into one Up next card.
	 */
	function upNext(cards, accounts, { rows: maxRows = 5 } = {}) {
		const calCards = cards.filter((c) => 'ics' === c.provider || ('outlook' === c.provider && c.data && c.data.events));
		const colour = new Map(accounts.filter((a) => 'ics' === a.provider || 'outlook' === a.provider)
			.map((a, i) => [a.id, a.config.icon_color || CAL_COLOURS[i % CAL_COLOURS.length]]));

		const events = [];
		for (const card of calCards) {
			for (const ev of (card.data && card.data.events) || []) {
				events.push({ ...ev, source: card.label || ('ics' === card.provider ? 'Calendar' : 'Outlook'), colour: colour.get(card.id) });
			}
		}
		const now = Date.now();
		events.sort((a, b) => a.start.localeCompare(b.start));
		const upcoming = events.filter((e) => new Date(e.end || e.start).getTime() > now);
		// Prefer a timed event as the headline over an all-day one.
		const next = upcoming.find((e) => !e.allDay) || upcoming[0];
		const rest = upcoming.filter((e) => e !== next).slice(0, maxRows);
		const errors = calCards.filter((c) => 'error' === c.status);
		const loading = calCards.some((c) => 'loading' === c.status);

		const dot = (e) => h('span', { class: 'cal-dot', style: e.colour ? { '--dot': e.colour } : null, 'aria-hidden': 'true' });

		return h('article', { class: ['card', 'card--calendar', errors.length && 'is-error'], 'aria-labelledby': 'card-upnext' },
			h('header', { class: 'card__head' },
				icon('ics'),
				h('div', { class: 'card__titles' },
					h('h3', { class: 'card__title', id: 'card-upnext' }, 'Up next'),
					h('p', { class: 'card__sub' }, plural(calCards.length, 'calendar'))
				),
				h('div', { class: 'card__meta' },
					h('button', {
						type: 'button',
						class: 'icon-btn',
						'aria-label': 'Refresh calendars',
						on: { click: () => calCards.forEach((c) => window.dashboard.refresh(c.id)) },
					}, '↻')
				)
			),
			...errors.map((c) => h('p', { class: 'card__error', role: 'alert' }, `${c.label || 'Calendar'}: ${c.error}`)),
			next
				? h('button', { type: 'button', class: 'next', on: { click: () => open(next.url) } },
					h('span', { class: 'next__when' }, eventWhen(next)),
					h('span', { class: 'next__title' }, next.title),
					h('span', { class: 'row__sub' }, dot(next), [next.source, next.location].filter(Boolean).join(' · '))
				)
				: (loading ? h('div', { class: 'skeleton' }) : h('p', { class: 'card__empty' }, 'Nothing in the next two weeks.')),
			rest.length ? rows(rest.map((e) => row({
				main: e.title,
				sub: [e.source, e.location].filter(Boolean).join(' · '),
				time: eventWhen(e),
				url: e.url,
				before: dot(e),
			})), '') : null
		);
	}

	/* -------------------------------------------------------------- Weather */

	/** WMO weather codes (Open-Meteo) → [description, day icon, night icon]. */
	const WEATHER = {
		0: ['Clear', '☀️', '🌙'], 1: ['Mostly clear', '🌤️', '🌙'], 2: ['Partly cloudy', '⛅', '☁️'], 3: ['Cloudy', '☁️', '☁️'],
		45: ['Fog', '🌫️', '🌫️'], 48: ['Freezing fog', '🌫️', '🌫️'],
		51: ['Light drizzle', '🌦️', '🌧️'], 53: ['Drizzle', '🌦️', '🌧️'], 55: ['Heavy drizzle', '🌧️', '🌧️'],
		56: ['Freezing drizzle', '🌧️', '🌧️'], 57: ['Freezing drizzle', '🌧️', '🌧️'],
		61: ['Light rain', '🌦️', '🌧️'], 63: ['Rain', '🌧️', '🌧️'], 65: ['Heavy rain', '🌧️', '🌧️'],
		66: ['Freezing rain', '🌧️', '🌧️'], 67: ['Freezing rain', '🌧️', '🌧️'],
		71: ['Light snow', '🌨️', '🌨️'], 73: ['Snow', '🌨️', '🌨️'], 75: ['Heavy snow', '❄️', '❄️'], 77: ['Snow grains', '🌨️', '🌨️'],
		80: ['Light showers', '🌦️', '🌧️'], 81: ['Showers', '🌧️', '🌧️'], 82: ['Heavy showers', '⛈️', '⛈️'],
		85: ['Snow showers', '🌨️', '🌨️'], 86: ['Heavy snow showers', '❄️', '❄️'],
		95: ['Thunderstorm', '⛈️', '⛈️'], 96: ['Thunderstorm with hail', '⛈️', '⛈️'], 99: ['Thunderstorm with hail', '⛈️', '⛈️'],
	};

	function sky(code, isDay = true) {
		const w = WEATHER[code] || ['—', '🌡️', '🌡️'];
		return { label: w[0], icon: isDay ? w[1] : w[2] };
	}

	const deg = (n) => `${Math.round(n)}°`;
	const hhmm = (local) => String(local || '').slice(11, 16);

	function weather(card, name) {
		const d = card.data || {};
		const c = d.current || {};
		const t = d.today || {};
		const tm = d.tomorrow || {};
		const now = sky(c.code, c.day);
		return shell(card, name, { sub: d.place },
			h('button', { type: 'button', class: 'wx', on: { click: () => open(d.url) }, 'aria-label': `${d.place}: ${deg(c.temp)}, ${now.label}. Open Met Office forecast` },
				h('span', { class: 'wx__icon', 'aria-hidden': 'true' }, now.icon),
				h('span', { class: 'wx__temp' }, deg(c.temp)),
				h('span', { class: 'wx__body' },
					h('span', { class: 'wx__label' }, now.label),
					h('span', { class: 'row__sub' }, `Feels ${deg(c.feels)} · Wind ${Math.round(c.wind)} mph`),
					h('span', { class: 'row__sub' }, `Today ${deg(t.min)}–${deg(t.max)} · Rain ${t.rain}%`)
				)
			),
			h('ol', { class: 'hours', 'aria-label': 'Next hours' },
				(d.hours || []).map((hr) => {
					const s = sky(hr.code, hr.day);
					return h('li', { class: 'hour', title: s.label },
						h('span', { class: 'hour__time' }, hhmm(hr.time)),
						h('span', { class: 'hour__icon', 'aria-hidden': 'true' }, s.icon),
						h('span', { class: 'hour__temp' }, deg(hr.temp)),
						h('span', { class: ['hour__rain', hr.rain >= 50 && 'is-wet'] }, `${hr.rain}%`)
					);
				})
			),
			h('p', { class: 'muted small' },
				`Sunrise ${hhmm(t.sunrise)} · Sunset ${hhmm(t.sunset)} · Tomorrow ${sky(tm.code).icon} ${deg(tm.min)}–${deg(tm.max)}, rain ${tm.rain}%`)
		);
	}

	/* --------------------------------------------------------------- Uptime */

	function uptime(card, name) {
		const d = card.data || {};
		const stat = (label, value, alert) => h('div', { class: ['stat', alert && value && 'is-alert'] },
			h('span', { class: 'stat__label' }, label),
			h('span', { class: 'stat__value' }, String(value || 0))
		);
		const badge = card.data
			? h('span', { class: ['badge', !d.down && 'badge--ok'], 'aria-label': d.down ? `${d.down} sites down` : 'All sites up' }, d.down ? `${d.down} down` : 'All up')
			: null;
		const expiryLabel = (e) => (e.days < 0 ? 'Expired' : (0 === e.days ? 'Today' : `${e.days} d`));

		return shell(card, name, { sub: d.lastCheckAt ? `Last check ${ago(d.lastCheckAt)}` : '', badge },
			h('div', { class: 'stats' }, stat('Up', d.up), stat('Down', d.down, true), stat('Monitored', d.total)),
			d.sitesDown && d.sitesDown.length ? h('div', { class: 'stack' },
				h('h4', { class: 'list-title' }, 'Down now'),
				rows(d.sitesDown.map((s) => row({
					main: s.name,
					sub: [s.agency, s.cause].filter(Boolean).join(' · '),
					time: s.down_since ? `since ${shortTime(s.down_since)}` : '',
					timeClass: 'is-overdue',
					url: s.url,
					before: h('span', { class: 'pill pill--error' }, 'Down'),
				})), '')
			) : null,
			d.expiring && d.expiring.length ? h('div', { class: 'stack' },
				h('h4', { class: 'list-title' }, 'Expiring within 30 days'),
				rows(d.expiring.slice(0, 5).map((e) => row({
					main: e.name,
					time: expiryLabel(e),
					timeClass: e.days <= 7 ? 'is-overdue' : null,
					url: d.url,
					before: h('span', { class: ['pill', e.days <= 7 ? 'pill--error' : 'pill--warning'] }, 'ssl' === e.type ? 'SSL' : 'Domain'),
				})), '')
			) : null,
			d.recent && d.recent.length ? h('div', { class: 'stack' },
				h('h4', { class: 'list-title' }, 'Recovered in the last 24 hours'),
				rows(d.recent.map((r) => row({
					main: r.name,
					sub: r.cause,
					time: ago(r.resolved_at),
					url: d.url,
					before: h('span', { class: 'pill pill--success' }, r.duration_seconds ? duration(r.duration_seconds) : 'Up'),
				})), '')
			) : null,
			h('button', { type: 'button', class: 'btn btn--small btn--ghost', on: { click: () => open(d.url) } }, 'Open monitor')
		);
	}

	/* --------------------------------------------------------------- GitHub */

	function github(card, name) {
		const d = card.data || {};
		const failed = d.failed || [];
		return shell(card, name, {
			sub: d.login ? `@${d.login} · ${plural(d.repos || 0, 'repo')}` : '',
			badge: failed.length ? h('span', { class: 'badge', 'aria-label': `${failed.length} failed runs` }, `${failed.length} failed`) : null,
		},
			failed.length ? h('div', { class: 'stack' },
				h('h4', { class: 'list-title' }, 'Failed runs (7 days)'),
				rows(failed.slice(0, 3).map((f) => row({
					main: f.workflow,
					sub: `${f.repo} · ${f.branch}`,
					time: ago(f.date),
					timeClass: 'is-overdue',
					url: f.url,
					before: h('span', { class: 'pill pill--error' }, 'Failed'),
				})), '')
			) : null,
			h('div', { class: 'stack' },
				failed.length ? h('h4', { class: 'list-title' }, 'Latest activity') : null,
				rows((d.activity || []).map((a) => row({
					main: a.text,
					sub: [a.repo, a.actor && a.actor !== d.login ? `by ${a.actor}` : null].filter(Boolean).join(' · '),
					text: a.detail,
					time: ago(a.date),
					url: a.url,
				})), 'No recent activity.')
			),
			h('button', { type: 'button', class: 'btn btn--small btn--ghost', on: { click: () => open(d.url) } }, 'Open GitHub')
		);
	}

	/* ------------------------------------------------------------ FreeAgent */

	function money(amount, currency) {
		try {
			return new Intl.NumberFormat('en-GB', { style: 'currency', currency: currency || 'GBP', maximumFractionDigits: Math.abs(amount) >= 1000 ? 0 : 2 }).format(amount || 0);
		} catch {
			return `${currency || ''} ${Number(amount || 0).toFixed(2)}`;
		}
	}

	function dueLabel(dateStr) {
		const due = new Date(`${dateStr}T00:00:00`);
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const days = Math.round((due - today) / 86400000);
		if (days < 0) {
			return { text: `${-days} d overdue`, late: true };
		}
		if (0 === days) {
			return { text: 'Due today', late: true };
		}
		return { text: 1 === days ? 'Tomorrow' : due.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), late: false };
	}

	function moneyRows(list, empty) {
		return rows(list.map((x) => {
			const due = dueLabel(x.due);
			return row({
				main: x.contact || x.ref || 'Unknown',
				sub: [x.ref, money(x.amount, x.currency)].filter(Boolean).join(' · '),
				time: due.text,
				timeClass: due.late ? 'is-overdue' : null,
				url: x.url,
			});
		}), empty);
	}

	function freeagent(card, name) {
		const d = card.data || {};
		const cur = d.currency;
		const stat = (label, value, sub, alert) => h('div', { class: ['stat', alert && 'is-alert'] },
			h('span', { class: 'stat__label' }, label),
			h('span', { class: 'stat__value' }, value),
			sub ? h('span', { class: 'stat__sub' }, sub) : null
		);
		return shell(card, name, { sub: d.company, wide: true },
			h('div', { class: 'stats stats--auto' },
				(d.banks || []).map((b) => stat(b.name, money(b.balance, b.currency), null, b.balance < 0)),
				stat('Overdue', money(d.overdueTotal, cur), plural(d.overdueCount || 0, 'invoice'), d.overdueCount > 0)
			),
			h('div', { class: 'cols' },
				h('div', { class: 'stack' },
					h('h4', { class: 'list-title' }, `Overdue invoices · ${money(d.overdueTotal, cur)}`),
					moneyRows(d.overdue || [], 'Nothing overdue.'),
					h('h4', { class: 'list-title' }, `Due in the next 2 weeks · ${money(d.dueSoonTotal, cur)}`),
					moneyRows(d.dueSoon || [], 'Nothing due soon.')
				),
				h('div', { class: 'stack' },
					h('h4', { class: 'list-title' }, `Bills due this week · ${money(d.billsTotal, cur)}`),
					moneyRows(d.bills || [], 'No bills due this week.'),
					h('h4', { class: 'list-title' }, 'Upcoming tax deadlines'),
					rows((d.tax || []).map((t) => {
						const due = dueLabel(t.due);
						return row({
							main: t.title,
							sub: [t.personal ? 'Personal' : null, t.amount !== null ? money(t.amount, cur) : null].filter(Boolean).join(' · '),
							time: due.text,
							timeClass: due.late ? 'is-overdue' : null,
							url: d.taxUrl,
						});
					}), 'No upcoming deadlines.')
				)
			),
			h('button', { type: 'button', class: 'btn btn--small btn--ghost', on: { click: () => open(d.url) } }, 'Open FreeAgent')
		);
	}

	/* -------------------------------------------------------- Drift: Record */

	const DAY_MS = 86400000;
	const gigDate = (day) => new Date(`${day}T00:00:00`);
	const gigShort = (day) => gigDate(day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
	const gigLong = (day) => gigDate(day).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

	/** Whole days from today to a YYYY-MM-DD date (0 = today). */
	function daysUntil(day) {
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		return Math.round((gigDate(day) - today) / DAY_MS);
	}

	/** "Tonight", "Tomorrow", "Sat 25 Oct · in 7 days", "On now · until Sun 27 Oct". */
	function gigWhen(e) {
		const days = daysUntil(e.date);
		if (days < 0) {
			return `On now · until ${gigLong(e.endDate)}`;
		}
		if (0 === days) {
			return e.endDate ? 'Starts today' : 'Tonight';
		}
		if (1 === days) {
			return 'Tomorrow';
		}
		return `${gigLong(e.date)} · in ${plural(days, 'day')}`;
	}

	/** "25 Oct" or, for a festival, "24–26 Oct". */
	function gigDates(e) {
		if (!e.endDate || e.endDate === e.date) {
			return gigShort(e.date);
		}
		const [from, to] = [gigDate(e.date), gigDate(e.endDate)];
		return from.getMonth() === to.getMonth() ? `${from.getDate()}–${gigShort(e.endDate)}` : `${gigShort(e.date)} – ${gigShort(e.endDate)}`;
	}

	function gigPill(e) {
		const booked = 'booked' === e.status;
		return h('span', { class: ['pill', booked && 'pill--success'] }, booked ? 'Booked' : 'Planned');
	}

	function driftrecord(card, name) {
		const d = card.data || {};
		const n = d.next;
		const y = d.year || {};
		const train = n && n.train;
		const details = n ? [
			n.endDate ? gigDates(n) : null,
			n.doors ? `Doors ${n.doors}` : null,
			train ? `Train ${train.depart || '?'} → ${train.back || '?'}${train.first ? ' · First' : ''}` : null,
			n.hotel ? `Hotel: ${n.hotel}` : null,
			n.cost ? money(n.cost) : null,
		].filter(Boolean).join(' · ') : '';
		const badge = card.data
			? h('span', { class: ['badge', !d.upcomingCount && 'badge--quiet'], 'aria-label': plural(d.upcomingCount || 0, 'upcoming event') }, String(d.upcomingCount || 0))
			: null;

		return shell(card, name, { sub: d.email, badge },
			n
				? h('button', { type: 'button', class: 'next', on: { click: () => open(d.url) }, 'aria-label': `Next: ${n.name}, ${gigWhen(n)}. Open Drift: Record` },
					h('span', { class: 'next__when' }, gigWhen(n)),
					h('span', { class: 'next__title' }, n.name),
					h('span', { class: 'row__sub' }, gigPill(n), ' ', [n.venue, n.city].filter(Boolean).join(' · ')),
					details ? h('span', { class: 'row__sub next__details' }, details) : null
				)
				: h('p', { class: 'card__empty' }, 'Nothing coming up. Add your next gig in Drift: Record.'),
			(d.later || []).length ? rows(d.later.map((e) => row({
				main: e.name,
				sub: [e.venue, e.city].filter(Boolean).join(' · '),
				time: gigDates(e),
				url: d.url,
				before: gigPill(e),
			})), '') : null,
			y.year ? h('p', { class: 'muted small' }, `${y.year} so far: ${plural(y.count || 0, 'event')} · ${money(y.spend)}`) : null,
			h('button', { type: 'button', class: 'btn btn--small btn--ghost', on: { click: () => open(d.url) } }, 'Open Drift: Record')
		);
	}

	const RENDERERS = { gmail: email, outlook: email, proton: email, spotify, plex, claude, strava, xbox, slack, clickup, tickets, weather, uptime, github, freeagent, driftrecord };

	function render(card, providerName) {
		const fn = RENDERERS[card.provider];
		return fn ? fn(card, providerName) : null;
	}

	window.BD.cards = { META, SECTIONS, render, upNext, icon };
}());
