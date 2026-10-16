/**
 * Polls every account on its provider's interval and pushes results to the
 * window. One failing account never affects the others: errors are kept on
 * that card (with the last good data) and retried with backoff.
 */
const store = require('./store');
const providers = require('./providers');

const MAX_BACKOFF = 15 * 60 * 1000;
const WATCH_SETTLE = 2000; // Files are often written in several steps.

class Scheduler {
	/**
	 * @param {Function} send     Receives each card snapshot.
	 * @param {Function} fetcher  Optional replacement for provider.fetch (demo mode).
	 */
	constructor(send, fetcher = null) {
		this.send = send;
		this.fetcher = fetcher;
		this.cards = new Map(); // account id → { status, data, error, updatedAt }
		this.timers = new Map();
		this.running = new Set();
		this.failures = new Map();
		this.caches = new Map();
		this.watchers = new Map(); // account id → stop function
		this.settle = new Map();
		this.due = new Set(); // Failing cards whose files changed while paused.
		this.paused = false;
	}

	/**
	 * Providers with a watch() hook (local files) retry a failing card as soon
	 * as the file changes, rather than waiting for the next check.
	 */
	watch() {
		this.watchers.forEach((stop) => stop());
		this.watchers.clear();
		if (this.fetcher) {
			return;
		}
		store.accounts().forEach((account) => {
			const provider = providers.get(account.provider);
			if (!provider || !provider.watch) {
				return;
			}
			this.watchers.set(account.id, provider.watch(account, () => {
				clearTimeout(this.settle.get(account.id));
				this.settle.set(account.id, setTimeout(() => this.changed(account.id), WATCH_SETTLE));
			}));
		});
	}

	changed(id) {
		this.settle.delete(id);
		const card = this.cards.get(id);
		if (!card || 'error' !== card.status) {
			return;
		}
		if (this.paused) {
			this.due.add(id);
			return;
		}
		this.refresh(id);
	}

	/**
	 * Context handed to a provider's fetch()/connect() for one account.
	 */
	context(account) {
		if (!this.caches.has(account.id)) {
			this.caches.set(account.id, new Map());
		}
		const cache = this.caches.get(account.id);
		return {
			secrets: () => store.getSecrets(account.id),
			saveSecrets: (values) => store.setSecrets(account.id, values),
			// Memoise slow-changing lookups (user IDs, names) for `ttl` ms.
			cached: async (key, ttl, fn) => {
				const hit = cache.get(key);
				if (hit && Date.now() - hit.at < ttl) {
					return hit.value;
				}
				const value = await fn();
				cache.set(key, { value, at: Date.now() });
				return value;
			},
		};
	}

	snapshot(account) {
		const card = this.cards.get(account.id) || { status: 'loading' };
		return {
			id: account.id,
			provider: account.provider,
			label: account.label,
			...card,
		};
	}

	all() {
		return store.accounts().filter((a) => providers.get(a.provider)).map((a) => this.snapshot(a));
	}

	schedule(id, delay) {
		clearTimeout(this.timers.get(id));
		this.timers.set(id, setTimeout(() => this.run(id), delay));
	}

	async run(id) {
		const account = store.account(id);
		const provider = account && providers.get(account.provider);
		if (!provider) {
			return;
		}
		if (this.paused) {
			// Picked up again by resume().
			this.timers.delete(id);
			return;
		}
		if (this.running.has(id)) {
			return;
		}
		this.running.add(id);

		const previous = this.cards.get(id) || {};
		this.cards.set(id, { ...previous, status: previous.data ? previous.status : 'loading', refreshing: true });
		this.send(this.snapshot(account));

		let delay = provider.interval;
		try {
			const data = this.fetcher
				? await this.fetcher(account)
				: await provider.fetch(account, this.context(account));
			this.cards.set(id, { status: 'ok', data, error: null, updatedAt: new Date().toISOString() });
			this.failures.delete(id);
		} catch (err) {
			const failures = (this.failures.get(id) || 0) + 1;
			this.failures.set(id, failures);
			delay = Math.min(provider.interval * 2 ** failures, MAX_BACKOFF);
			console.error(`[${account.provider}] ${account.label || id}:`, err.message);
			// Keep the last good data so the card still shows something.
			this.cards.set(id, {
				status: 'error',
				data: previous.data || null,
				error: err.message || 'Something went wrong.',
				updatedAt: previous.updatedAt || null,
				failedAt: new Date().toISOString(),
			});
		} finally {
			this.running.delete(id);
		}

		this.send(this.snapshot(account));
		this.schedule(id, delay);
	}

	/**
	 * (Re)start polling for every account. Staggered so 15 accounts don't
	 * all connect in the same second. Without `force`, cards that are still
	 * fresh wait until they're due rather than refetching straight away.
	 */
	start(force = true) {
		this.timers.forEach((t) => clearTimeout(t));
		this.timers.clear();
		const ids = new Set(store.accounts().map((a) => a.id));
		for (const id of this.cards.keys()) {
			if (!ids.has(id)) {
				this.cards.delete(id);
				this.caches.delete(id);
				this.failures.delete(id);
			}
		}
		store.accounts().forEach((a, i) => {
			const provider = providers.get(a.provider);
			const card = this.cards.get(a.id);
			const last = card && (card.failedAt || card.updatedAt);
			const due = !force && !this.due.has(a.id) && provider && last ? new Date(last).getTime() + provider.interval - Date.now() : 0;
			if (this.due.delete(a.id)) {
				this.failures.delete(a.id);
			}
			this.schedule(a.id, Math.max(i * 250, due));
		});
		if (force) {
			// Accounts may have changed; resuming keeps the existing watchers.
			this.watch();
		}
	}

	refresh(id) {
		if (id) {
			this.failures.delete(id);
			this.schedule(id, 0);
		} else {
			this.failures.clear();
			this.start();
		}
	}

	/**
	 * Forget cached lookups for an account (after reconnecting/editing).
	 */
	reset(id) {
		this.caches.delete(id);
		this.cards.delete(id);
		this.failures.delete(id);
	}

	pause() {
		this.paused = true;
	}

	resume() {
		if (!this.paused) {
			return;
		}
		this.paused = false;
		this.start(false);
	}
}

module.exports = Scheduler;
