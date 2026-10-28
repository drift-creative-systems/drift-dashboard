/**
 * Dashboard controller: holds state, lays out sections, swaps individual
 * cards as updates arrive and handles the top bar.
 */
(function () {
	'use strict';

	const { h, clockTime } = window.BD;
	const { SECTIONS, META, CALENDARS, render, upNext } = window.BD.cards;

	let state = null;
	const cards = new Map(); // account id → latest snapshot
	const nodes = new Map(); // account id → card element
	let upNextNode = null;

	const dashboard = document.getElementById('dashboard');
	const settings = document.getElementById('settings');
	const toggle = document.getElementById('toggle-settings');

	function providerName(id) {
		const p = state.providers.find((x) => x.id === id);
		return p ? p.name : id;
	}

	function visible() {
		const hidden = (state.layout && state.layout.hidden) || [];
		return state.accounts.filter((a) => !hidden.includes(a.id));
	}

	function card(account) {
		const snapshot = cards.get(account.id) || { id: account.id, provider: account.provider, label: account.label, status: 'loading' };
		// Icon settings come from the account, so edits show without a refetch.
		return { ...snapshot, appearance: { icon: account.config.icon, color: account.config.icon_color } };
	}

	function calendarAccounts() {
		return visible().filter((a) => CALENDARS.includes(a.provider) && ('outlook' !== a.provider || a.config.show_calendar !== false));
	}

	/** Events listed under the headline, by the Up next card's height setting. */
	const UPNEXT_ROWS = { compact: 3, normal: 5, tall: 12 };

	function renderUpNext() {
		const accounts = calendarAccounts();
		const { h: height } = window.BD.layout.sizeOf('now', 'upnext');
		return accounts.length ? upNext(accounts.map(card), accounts, { rows: UPNEXT_ROWS[height] || 5 }) : null;
	}

	/**
	 * Replace one element, keeping keyboard focus on the equivalent control.
	 */
	function swap(oldNode, newNode) {
		if (!oldNode || !newNode || !oldNode.isConnected) {
			return;
		}
		const focusables = (n) => [...n.querySelectorAll('button, a, [tabindex]')];
		const active = document.activeElement;
		const index = oldNode.contains(active) ? focusables(oldNode).indexOf(active) : -1;
		oldNode.replaceWith(newNode);
		if (index >= 0) {
			const target = focusables(newNode)[index];
			if (target) {
				target.focus({ preventScroll: true });
			}
		}
	}

	/* --------------------------------------------------------------- Layout */

	function renderDashboard() {
		nodes.clear();
		upNextNode = null;

		if (!state.accounts.length) {
			dashboard.replaceChildren(h('div', { class: 'empty' },
				h('span', { class: 'topbar__mark', 'aria-hidden': 'true' }),
				h('h2', null, 'Nothing to show yet'),
				h('p', { class: 'muted' }, 'Add your email, calendars, Slack, ClickUp, Strava, Spotify, Xbox and support sites in Settings. The README has step-by-step setup for each one.'),
				h('button', { type: 'button', class: 'btn btn--primary', on: { click: () => showSettings(true) } }, 'Open Settings')
			));
			return;
		}

		const sections = [];
		// "Right now" stays first; the others follow your saved order.
		for (const section of window.BD.layout.orderSections(SECTIONS)) {
			const accounts = visible().filter((a) => (META[a.provider] || {}).section === section.id);
			const items = [];
			const entries = []; // For rearrangeable sections: { id, node, title }.

			if ('now' === section.id) {
				upNextNode = renderUpNext();
				if (upNextNode) {
					entries.push({ id: 'upnext', node: upNextNode, title: 'Up next' });
				}
			}
			for (const account of accounts) {
				const node = render(card(account), providerName(account.provider));
				if (node) {
					nodes.set(account.id, node);
					items.push(node);
					entries.push({ id: account.id, node, title: account.label || providerName(account.provider) });
				}
			}
			if (!items.length && !entries.length) {
				continue;
			}

			const headingId = `section-${section.id}`;
			// "Right now" is a board of columns you can drag cards between.
			const rearrangeable = 'now' === section.id;
			const el = h('section', { class: 'section', 'aria-labelledby': headingId, data: { section: section.id } },
				h('div', { class: 'section__head' },
					h('h2', { class: 'section__title', id: headingId }, section.title),
					countFor(section.id, accounts),
					rearrangeable ? window.BD.layout.columnPicker('now') : null
				),
				rearrangeable ? window.BD.layout.board('now', entries) : h('div', { class: section.gridClass }, items)
			);
			// Every other section can be moved up and down.
			if (!rearrangeable) {
				el.firstChild.append(window.BD.layout.sectionTools(el, section.title));
			}
			sections.push(el);
		}
		if (!sections.length) {
			dashboard.replaceChildren(h('div', { class: 'empty' },
				h('h2', null, 'Every card is hidden'),
				h('p', { class: 'muted' }, 'Show them again from the account list in Settings.'),
				h('button', { type: 'button', class: 'btn btn--primary', on: { click: () => showSettings(true) } }, 'Open Settings')
			));
			return;
		}
		dashboard.replaceChildren(...sections);
		window.BD.layout.refreshSections(dashboard);
	}

	/**
	 * Headline count next to section titles (total unread, open tickets).
	 */
	function countFor(sectionId, accounts) {
		const sum = (fn, provider) => accounts
			.filter((a) => !provider || a.provider === provider)
			.reduce((n, a) => n + (fn((cards.get(a.id) || {}).data || {}) || 0), 0);
		const badge = (text) => (text
			? h('span', { class: 'section__count', data: { count: sectionId } }, text)
			: h('span', { data: { count: sectionId } }));

		if ('email' === sectionId) {
			const n = sum((d) => d.unread);
			return badge(n ? `${n} unread` : '');
		}
		if ('tickets' === sectionId) {
			const open = sum((d) => d.total, 'tickets');
			const down = sum((d) => d.down, 'uptime');
			return badge([open ? `${open} open tickets` : '', down ? `${down} site${1 === down ? '' : 's'} down` : ''].filter(Boolean).join(' · '));
		}
		return null;
	}

	function updateCounts() {
		for (const id of ['email', 'tickets']) {
			const el = dashboard.querySelector(`[data-count="${id}"]`);
			if (el) {
				const accounts = visible().filter((a) => (META[a.provider] || {}).section === id);
				el.replaceWith(countFor(id, accounts));
			}
		}
	}

	/* -------------------------------------------------------------- Updates */

	function updateCard(snapshot) {
		cards.set(snapshot.id, snapshot);
		// Keep the settings list's status text current too.
		state.cards = state.cards.filter((c) => c.id !== snapshot.id).concat(snapshot);
		if (!settings.hidden && !document.getElementById('account-list').contains(document.activeElement)) {
			window.BD.settings.refreshList();
		}
		const account = state.accounts.find((a) => a.id === snapshot.id);
		if (!account) {
			return;
		}

		// Calendar data feeds the Up next card.
		if (upNextNode && CALENDARS.includes(account.provider)) {
			const fresh = renderUpNext();
			swap(upNextNode, fresh);
			upNextNode = fresh;
		}

		const old = nodes.get(snapshot.id);
		if (old) {
			const fresh = render(card(account), providerName(account.provider));
			swap(old, fresh);
			nodes.set(snapshot.id, fresh);
		}
		updateCounts();
	}

	/** Re-render every card in place so "5 min ago" labels stay true. */
	function tick() {
		for (const account of state.accounts) {
			const old = nodes.get(account.id);
			if (old) {
				const fresh = render(card(account), providerName(account.provider));
				swap(old, fresh);
				nodes.set(account.id, fresh);
			}
		}
		if (upNextNode) {
			const fresh = renderUpNext();
			swap(upNextNode, fresh);
			upNextNode = fresh;
		}
	}

	function clawdActivity() {
		if (window.BD.clawd) {
			Object.entries(state.clawd || {}).forEach(([id, value]) => window.BD.clawd.activity(id, value));
		}
	}

	/* ------------------------------------------------------------ Accent */

	const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

	// WCAG relative luminance and contrast ratio.
	function luminance(hex) {
		const [r, g, b] = rgb(hex).map((v) => {
			const c = v / 255;
			return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
		});
		return 0.2126 * r + 0.7152 * g + 0.0722 * b;
	}

	function contrast(a, b) {
		const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
		return (hi + 0.05) / (lo + 0.05);
	}

	function mix(hex, toward, amount) {
		const a = rgb(hex);
		const b = rgb(toward);
		return `#${a.map((v, i) => Math.round(v + (b[i] - v) * amount).toString(16).padStart(2, '0')).join('')}`;
	}

	/**
	 * The accent nudged toward white (dark theme) or black (light theme)
	 * until it's readable as text (4.5:1) on every surface it sits on.
	 */
	function readable(hex, toward, surfaces) {
		for (let step = 0; step <= 20; step++) {
			const c = mix(hex, toward, step / 20);
			if (surfaces.every((s) => contrast(c, s) >= 4.5)) {
				return c;
			}
		}
		return toward;
	}

	/**
	 * Settings → General's accent colour, as CSS variables that app.css swaps
	 * in for the monochrome ones. Blank leaves Drift monochrome.
	 */
	function applyAccent(color) {
		const root = document.documentElement;
		root.classList.toggle('has-user-accent', Boolean(color));
		if (!color) {
			return;
		}
		root.style.setProperty('--user-accent', color);
		root.style.setProperty('--user-accent-contrast', contrast(color, '#000000') >= contrast(color, '#ffffff') ? '#000' : '#fff');
		// The surfaces from app.css's dark and light tokens.
		root.style.setProperty('--user-accent-text-dark', readable(color, '#ffffff', ['#0b0c0d', '#151618', '#1d1f22']));
		root.style.setProperty('--user-accent-text-light', readable(color, '#000000', ['#f2f3f5', '#ffffff', '#f6f7f8']));
	}

	function setState(next) {
		state = next;
		applyAccent(next.settings && next.settings.accentColor);
		for (const snapshot of next.cards) {
			cards.set(snapshot.id, snapshot);
		}
		clawdActivity();
		renderDashboard();
		window.BD.settings.refresh();
	}

	/* -------------------------------------------------------------- Top bar */

	function clock() {
		const now = new Date();
		document.getElementById('clock').textContent =
			`${now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })} · ${clockTime(now)}`;
	}

	function showSettings(show) {
		settings.hidden = !show;
		dashboard.hidden = show;
		toggle.setAttribute('aria-expanded', String(show));
		toggle.querySelector('.js-settings-label').textContent = show ? 'Back to dashboard' : 'Settings';
		if (show) {
			window.BD.settings.refresh();
			document.getElementById('settings-title').focus({ preventScroll: true });
		} else {
			dashboard.focus({ preventScroll: true });
		}
		window.scrollTo(0, 0);
	}

	/* ----------------------------------------------------------------- Init */

	async function init() {
		state = await window.dashboard.getState();
		applyAccent(state.settings && state.settings.accentColor);
		for (const snapshot of state.cards) {
			cards.set(snapshot.id, snapshot);
		}
		document.getElementById('version').textContent = `v${state.version}`;
		document.getElementById('settings-title').setAttribute('tabindex', '-1');

		window.BD.settings.init({ getState: () => state, setState });
		window.BD.hideCard = async (id, hide) => {
			try {
				setState(await window.dashboard.hideAccount(id, hide));
				if (hide && !dashboard.hidden) {
					dashboard.focus({ preventScroll: true });
				}
			} catch (err) {
				console.error('Couldn’t hide the card:', err);
			}
		};
		window.BD.layout.init({
			getLayout: () => state.layout,
			setLayout: (section, data) => {
				state.layout = { ...(state.layout || {}), [section]: data };
				window.dashboard.saveLayout(section, data).catch((err) => console.error('Couldn’t save the layout:', err));
			},
			// Up next lists more or fewer events depending on its height.
			onResize: (id) => {
				if ('upnext' === id && upNextNode) {
					const fresh = renderUpNext();
					swap(upNextNode, fresh);
					upNextNode = fresh;
				}
			},
			onColumns: renderDashboard,
			setSectionOrder: (order) => {
				state.layout = { ...(state.layout || {}), sectionOrder: order };
				window.dashboard.saveSectionOrder(order).catch((err) => console.error('Couldn’t save the section order:', err));
			},
		});
		clawdActivity();
		renderDashboard();

		window.dashboard.onCard(updateCard);
		// Changed from the menu bar menu (e.g. what it shows).
		window.dashboard.onSettings((next) => setState(next));
		window.dashboard.onClawd(({ id, activity }) => {
			state.clawd = { ...(state.clawd || {}), [id]: activity };
			if (window.BD.clawd) {
				window.BD.clawd.activity(id, activity);
			}
		});
		window.BD.update.init(state.update);

		toggle.addEventListener('click', () => showSettings(settings.hidden));
		document.getElementById('refresh-all').addEventListener('click', () => window.dashboard.refresh());
		document.addEventListener('keydown', (e) => {
			if ('F5' === e.key) {
				e.preventDefault();
				window.dashboard.refresh();
			}
			if ('Escape' === e.key && !settings.hidden) {
				showSettings(false);
			}
		});

		clock();
		setInterval(clock, 15000);
		setInterval(tick, 60000);
	}

	init().catch((err) => {
		dashboard.replaceChildren(h('p', { class: 'card__error' }, `Couldn’t start: ${window.BD.errorMessage(err)}`));
	});
}());
