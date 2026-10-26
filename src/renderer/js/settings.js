/**
 * Settings screen: general options, the account list and the add/edit form.
 * Forms are built from each provider's field list, so a new card type only
 * needs fields declared in its provider file.
 */
(function () {
	'use strict';

	const { h, errorMessage } = window.BD;

	let app = null; // { getState, setState }

	const els = {};

	function status(el, message, isError) {
		el.textContent = message || '';
		el.classList.toggle('is-error', Boolean(isError));
	}

	function provider(id) {
		return app.getState().providers.find((p) => p.id === id);
	}

	/* ------------------------------------------------------------------ General */

	function fillGeneral() {
		const s = app.getState().settings;
		els.general.startWithWindows.checked = Boolean(s.startWithWindows);
		els.general.closeToTray.checked = Boolean(s.closeToTray);
		const alerts = s.alerts || {};
		els.general.alertUptime.checked = false !== alerts.uptime;
		els.general.alertTickets.checked = false !== alerts.tickets;
		els.general.alertClaude.checked = false !== alerts.claude;
		els.general.alertOnlyWhenAway.checked = false !== alerts.onlyWhenAway;
	}

	async function saveGeneral(event) {
		event.preventDefault();
		const out = els.general.querySelector('.form-status');
		try {
			app.setState(await window.dashboard.saveSettings({
				startWithWindows: els.general.startWithWindows.checked,
				closeToTray: els.general.closeToTray.checked,
				alerts: {
					uptime: els.general.alertUptime.checked,
					tickets: els.general.alertTickets.checked,
					claude: els.general.alertClaude.checked,
					onlyWhenAway: els.general.alertOnlyWhenAway.checked,
				},
			}));
			status(out, 'Saved.');
		} catch (err) {
			status(out, errorMessage(err), true);
		}
	}

	/* ------------------------------------------------------------- Account list */

	function accountState(account, p) {
		const card = app.getState().cards.find((c) => c.id === account.id);
		if (p.oauth && !account.connected) {
			return { text: 'Not connected', cls: 'is-warn' };
		}
		if (!card || 'loading' === card.status) {
			return { text: 'Checking…', cls: '' };
		}
		if ('error' === card.status) {
			return { text: card.error, cls: 'is-warn' };
		}
		return { text: 'Working', cls: 'is-ok' };
	}

	async function act(fn, out) {
		try {
			app.setState(await fn());
		} catch (err) {
			status(out || els.formStatus, errorMessage(err), true);
		}
	}

	function renderList() {
		const { accounts, providers } = app.getState();
		const groups = providers
			.map((p) => ({ p, list: accounts.filter((a) => a.provider === p.id) }))
			.filter((g) => g.list.length);

		els.list.replaceChildren(groups.length ? '' : h('p', { class: 'muted' }, 'No accounts yet. Add one below.'));

		for (const { p, list } of groups) {
			els.list.append(h('div', { class: 'acct-group' },
				h('h4', { class: 'acct-group__title' }, p.name),
				list.map((a) => {
					const st = accountState(a, p);
					const name = a.label || p.name;
					const rowStatus = h('span', { class: 'form-status', role: 'status' });
					return h('div', { class: 'acct' },
						window.BD.cards.icon(a.provider, { icon: a.config.icon, color: a.config.icon_color }),
						h('span', { class: 'acct__name' }, name),
						h('span', { class: ['acct__state', st.cls] }, st.text),
						h('div', { class: 'acct__actions' },
							p.oauth ? h('button', {
								type: 'button',
								class: ['btn', 'btn--small', !a.connected && 'btn--primary'],
								on: {
									click: async () => {
										status(rowStatus, 'Finish signing in in your browser…');
										await act(() => window.dashboard.connect(a.id), rowStatus);
									},
								},
							}, a.connected ? 'Reconnect' : 'Connect') : null,
							h('button', { type: 'button', class: 'btn btn--small', on: { click: () => edit(a) } }, 'Edit'),
							h('button', { type: 'button', class: 'btn btn--small', 'aria-label': `Move ${name} up`, on: { click: () => act(() => window.dashboard.moveAccount(a.id, 'up')) } }, '↑'),
							h('button', { type: 'button', class: 'btn btn--small', 'aria-label': `Move ${name} down`, on: { click: () => act(() => window.dashboard.moveAccount(a.id, 'down')) } }, '↓'),
							h('button', {
								type: 'button',
								class: 'btn btn--small btn--danger',
								on: {
									click: () => {
										if (window.confirm(`Remove "${name}"? Its saved passwords and tokens are deleted too.`)) {
											act(() => window.dashboard.deleteAccount(a.id));
										}
									},
								},
							}, 'Remove'),
							rowStatus
						)
					);
				})
			));
		}
	}

	/* --------------------------------------------------------------------- Form */

	function input(field, account) {
		const saved = account && account.savedSecrets.includes(field.key);
		const value = account && !field.secret ? account.config[field.key] : undefined;
		const id = `f-${field.key}`;

		if ('checkbox' === field.type) {
			const checked = value === undefined ? field.default !== false : Boolean(value);
			return h('label', { class: 'check' }, h('input', { type: 'checkbox', name: field.key, id, checked }), field.label);
		}

		// A colour picker always has a value, so track whether it's really
		// been chosen (data-set); unset means "use the service's colour".
		if ('color' === field.type) {
			const picker = h('input', { type: 'color', name: field.key, id, value: value || '#ee4367', data: { set: value ? '1' : '' } });
			const state = h('span', { class: 'field__hint' }, value ? '' : 'Using the default colour');
			picker.addEventListener('input', () => {
				picker.dataset.set = '1';
				state.textContent = '';
			});
			return h('div', { class: 'field' },
				h('label', { class: 'field__label', for: id }, field.label, ' (optional)'),
				h('div', { class: 'color-row' },
					picker,
					h('button', {
						type: 'button',
						class: 'btn btn--small',
						on: {
							click: () => {
								picker.dataset.set = '';
								state.textContent = 'Using the default colour';
							},
						},
					}, 'Use default'),
					state
				)
			);
		}

		return h('label', { class: 'field', for: id },
			h('span', { class: 'field__label' }, field.label, field.required ? '' : ' (optional)'),
			h('input', {
				type: field.secret ? 'password' : 'text',
				name: field.key,
				id,
				value: value || '',
				placeholder: saved ? 'Saved. Leave blank to keep it.' : (field.placeholder || ''),
				autocomplete: 'off',
				spellcheck: 'false',
				data: { required: field.required && !saved ? '1' : '' },
			})
		);
	}

	function renderFields(account) {
		const p = provider(els.form.provider.value);
		els.help.textContent = p ? p.help : '';
		const fields = p ? p.fields : [];
		els.fields.replaceChildren(...fields.filter((f) => !f.advanced && !f.appearance).map((f) => input(f, account)));
		const advanced = fields.filter((f) => f.advanced);
		els.advanced.replaceChildren(...advanced.map((f) => input(f, account)));
		els.advancedWrap.hidden = !advanced.length;
		els.appearance.replaceChildren(...fields.filter((f) => f.appearance).map((f) => input(f, account)));
		// Open the Icon section when this card already has a custom icon.
		els.appearanceWrap.open = Boolean(account && (account.config.icon || account.config.icon_color));
	}

	function resetForm() {
		els.form.reset();
		els.form.id.value = '';
		els.form.provider.disabled = false;
		els.formTitle.textContent = 'Add an account';
		els.cancel.hidden = true;
		renderFields(null);
	}

	function edit(account) {
		els.form.id.value = account.id;
		els.form.provider.value = account.provider;
		els.form.provider.disabled = true;
		els.form.label.value = account.label || '';
		els.formTitle.textContent = `Edit ${account.label || provider(account.provider).name}`;
		els.cancel.hidden = false;
		renderFields(account);
		status(els.formStatus, '');
		els.form.scrollIntoView({ behavior: 'smooth', block: 'start' });
		els.form.label.focus();
	}

	async function save(event) {
		event.preventDefault();
		const p = provider(els.form.provider.value);
		const values = {};
		let missing = null;

		for (const field of p.fields) {
			const el = els.form.elements[field.key];
			if (!el) {
				continue;
			}
			if ('checkbox' === field.type) {
				values[field.key] = el.checked;
			} else if ('color' === field.type) {
				values[field.key] = el.dataset.set ? el.value : '';
			} else {
				values[field.key] = el.value;
			}
			if (el.dataset.required && !String(el.value).trim() && !missing) {
				missing = { field, el };
			}
		}
		if (missing) {
			status(els.formStatus, `${missing.field.label} is required.`, true);
			missing.el.focus();
			return;
		}

		const id = els.form.id.value || null;
		try {
			const next = await window.dashboard.saveAccount({ id, provider: p.id, label: els.form.label.value, values });
			app.setState(next);
			const saved = id ? next.accounts.find((a) => a.id === id) : next.accounts[next.accounts.length - 1];
			resetForm();

			// New sign-in accounts go straight to the browser login.
			if (p.oauth && saved && !saved.connected) {
				status(els.formStatus, 'Saved. Finish signing in in your browser…');
				try {
					app.setState(await window.dashboard.connect(saved.id));
					status(els.formStatus, 'Connected.');
				} catch (err) {
					status(els.formStatus, `Saved, but sign-in didn’t finish: ${errorMessage(err)} Use Connect to try again.`, true);
				}
			} else {
				status(els.formStatus, 'Saved.');
			}
		} catch (err) {
			status(els.formStatus, errorMessage(err), true);
		}
	}

	/* --------------------------------------------------------------------- Init */

	function init(appApi) {
		app = appApi;
		els.general = document.getElementById('general-form');
		els.list = document.getElementById('account-list');
		els.form = document.getElementById('account-form');
		els.formTitle = document.querySelector('.js-form-title');
		els.help = els.form.querySelector('.js-provider-help');
		els.fields = els.form.querySelector('.js-fields');
		els.advanced = els.form.querySelector('.js-advanced');
		els.advancedWrap = els.form.querySelector('.js-advanced-wrap');
		els.appearance = els.form.querySelector('.js-appearance');
		els.appearanceWrap = els.form.querySelector('.js-appearance-wrap');
		els.cancel = els.form.querySelector('.js-cancel-edit');
		els.formStatus = els.form.querySelector('.form-status');

		els.form.provider.replaceChildren(...app.getState().providers.map((p) => h('option', { value: p.id }, p.name)));
		els.form.provider.addEventListener('change', () => renderFields(null));
		els.form.addEventListener('submit', save);
		els.cancel.addEventListener('click', resetForm);
		els.general.addEventListener('submit', saveGeneral);

		resetForm();
		fillGeneral();
		renderList();
	}

	function refresh() {
		fillGeneral();
		renderList();
	}

	window.BD.settings = { init, refresh, refreshList: renderList };
}());
