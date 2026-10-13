/**
 * Dashboard controller: holds state, lays out sections, swaps individual
 * cards as updates arrive and handles the top bar.
 */
(function () {
	'use strict';

	const { h, clockTime } = window.BD;
	const { SECTIONS, META, render, upNext } = window.BD.cards;

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

	function card(account) {
		const snapshot = cards.get(account.id) || { id: account.id, provider: account.provider, label: account.label, status: 'loading' };
		// Icon settings come from the account, so edits show without a refetch.
		return { ...snapshot, appearance: { icon: account.config.icon, color: account.config.icon_color } };
	}

	function calendarAccounts() {
		return state.accounts.filter((a) => 'ics' === a.provider || ('outlook' === a.provider && a.config.show_calendar !== false));
	}

	/** Events listed under the headline, by the Up next card's height setting. */
	const UPNEXT_ROWS = { compact: 3, normal: 5, tall: 12 };

	function renderUpNext() {
		const accounts = calendarAccounts();
		const { h: height } = window.BD.layout.sizeOf('now', 'upnext', 2);
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
		for (const section of SECTIONS) {
			const accounts = state.accounts.filter((a) => (META[a.provider] || {}).section === section.id);
			let items = [];
			const entries = []; // For rearrangeable sections: { id, node, title, defaultW }.

			if ('now' === section.id) {
				upNextNode = renderUpNext();
				if (upNextNode) {
					entries.push({ id: 'upnext', node: upNextNode, title: 'Up next', defaultW: 2 });
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
			// "Right now" cards can be dragged and resized.
			if ('now' === section.id) {
				items = window.BD.layout.slots('now', entries);
			}
			if (!items.length) {
				continue;
			}

			const headingId = `section-${section.id}`;
			sections.push(h('section', { class: 'section', 'aria-labelledby': headingId },
				h('div', { class: 'section__head' },
					h('h2', { class: 'section__title', id: headingId }, section.title),
					countFor(section.id, accounts)
				),
				h('div', { class: section.gridClass }, items)
			));
		}
		dashboard.replaceChildren(...sections);
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
				const accounts = state.accounts.filter((a) => (META[a.provider] || {}).section === id);
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
		if (upNextNode && ('ics' === account.provider || 'outlook' === account.provider)) {
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

	function setState(next) {
		state = next;
		for (const snapshot of next.cards) {
			cards.set(snapshot.id, snapshot);
		}
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
		for (const snapshot of state.cards) {
			cards.set(snapshot.id, snapshot);
		}
		document.getElementById('version').textContent = `v${state.version}`;
		document.getElementById('settings-title').setAttribute('tabindex', '-1');

		window.BD.settings.init({ getState: () => state, setState });
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
		});
		renderDashboard();

		window.dashboard.onCard(updateCard);
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
