/**
 * Desktop alerts: compares each new card result with the last one and says
 * when something needs you: a site goes down or comes back, an urgent or
 * high-priority ticket turns up, or a Claude plan limit passes 90% / 100%.
 *
 * The first result for a card only sets the baseline (except sites already
 * down, which get one summary), so starting the app never floods you with
 * old tickets. Errors never alert; the card shows those.
 */

/** Card types that can alert, and the settings key that switches each on. */
const KINDS = { uptime: 'uptime', tickets: 'tickets', claude: 'claude' };

const URGENT = { urgent: 2, high: 1 };
const SEEN_LIMIT = 500; // Ticket ids remembered per card.

const DEFAULTS = { uptime: true, tickets: true, claude: true, onlyWhenAway: true };

/** Alert settings with defaults filled in. */
function options(settings) {
	return { ...DEFAULTS, ...((settings && settings.alerts) || {}) };
}

/** Whether this card type can alert and its alerts are switched on. */
function wanted(provider, settings) {
	return Boolean(KINDS[provider]) && Boolean(options(settings)[KINDS[provider]]);
}

function title(snapshot, fallback) {
	return snapshot.label || fallback;
}

function list(names, max = 3) {
	const shown = names.slice(0, max).join(', ');
	return names.length > max ? `${shown} and ${names.length - max} more` : shown;
}

/** "14:30", or "Thu 09:00" if it's not today. */
function when(isoDate) {
	const date = new Date(isoDate);
	if (Number.isNaN(date.getTime())) {
		return '';
	}
	const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
	return date.toDateString() === new Date().toDateString()
		? time
		: `${date.toLocaleDateString('en-GB', { weekday: 'short' })} ${time}`;
}

/* ------------------------------------------------------------------ Checks */

function uptime(memo, snapshot) {
	const down = new Map((snapshot.data.sitesDown || []).map((s) => [s.url || s.name, s]));
	const messages = [];

	if (!memo) {
		if (down.size) {
			const names = [...down.values()].map((s) => s.name);
			messages.push({
				title: 1 === names.length ? `Site down: ${names[0]}` : `${names.length} sites down`,
				body: 1 === names.length ? [down.values().next().value.cause, title(snapshot, 'Uptime monitor')].filter(Boolean).join(' · ') : list(names),
			});
		}
		return { memo: { down: new Map([...down].map(([k, s]) => [k, s.name])) }, messages };
	}

	const fresh = [...down].filter(([key]) => !memo.down.has(key)).map(([, s]) => s);
	const back = [...memo.down].filter(([key]) => !down.has(key)).map(([, name]) => name);

	if (1 === fresh.length) {
		messages.push({ title: `Site down: ${fresh[0].name}`, body: [fresh[0].cause, fresh[0].agency].filter(Boolean).join(' · ') || title(snapshot, 'Uptime monitor') });
	} else if (fresh.length) {
		messages.push({ title: `${fresh.length} sites down`, body: list(fresh.map((s) => s.name)) });
	}
	if (back.length) {
		messages.push({ title: 1 === back.length ? `Back up: ${back[0]}` : `${back.length} sites back up`, body: 1 === back.length ? title(snapshot, 'Uptime monitor') : list(back) });
	}
	return { memo: { down: new Map([...down].map(([k, s]) => [k, s.name])) }, messages };
}

function tickets(memo, snapshot) {
	const seen = new Map(memo ? memo.seen : []);
	const messages = [];
	const site = snapshot.data.site || title(snapshot, 'Support');

	for (const t of snapshot.data.latest || []) {
		const key = String(t.id || t.ref || t.title);
		const priority = String(t.priority || t.priority_label || '').toLowerCase();
		const rank = URGENT[priority] || 0;
		if (memo && rank && rank > (seen.get(key) || 0)) {
			messages.push({
				title: `${2 === rank ? 'Urgent' : 'High-priority'} ticket · ${site}`,
				body: [t.ref, t.title].filter(Boolean).join(' '),
			});
		}
		seen.delete(key); // Re-insert so the newest stay when trimming.
		seen.set(key, Math.max(rank, (memo && memo.seen.get(key)) || 0));
	}
	while (seen.size > SEEN_LIMIT) {
		seen.delete(seen.keys().next().value);
	}
	return { memo: { seen }, messages };
}

function claude(memo, snapshot) {
	const levels = new Map();
	const messages = [];

	for (const limit of snapshot.data.limits || []) {
		const level = limit.percent >= 100 ? 100 : (limit.percent >= 90 ? 90 : 0);
		const before = memo && memo.levels.get(limit.name);
		// Usage only falls when the window resets, which starts again from nothing.
		const was = before && limit.percent >= before.percent ? before.level : 0;
		if (memo && level > was) {
			const at = limit.resetsAt ? when(limit.resetsAt) : '';
			const resets = at ? `Resets ${at}` : '';
			messages.push(100 === level
				? { title: `Claude: ${limit.name} limit reached`, body: resets }
				: { title: `Claude: ${limit.name} at ${limit.percent}%`, body: resets });
		}
		levels.set(limit.name, { level: Math.max(level, was), percent: limit.percent });
	}
	return { memo: { levels }, messages };
}

const CHECKS = { uptime, tickets, claude };

/* ----------------------------------------------------------------- Watcher */

/**
 * @param {{ notify: (message: {title, body}) => void, settings: () => object }} options
 */
function create({ notify, settings }) {
	const memos = new Map(); // Account id → what was last seen.

	return {
		/** Look at a card snapshot from the scheduler. */
		check(snapshot) {
			const check = CHECKS[snapshot.provider];
			if (!check || 'ok' !== snapshot.status || snapshot.refreshing || !snapshot.data) {
				return;
			}
			const { memo, messages } = check(memos.get(snapshot.id), snapshot);
			memos.set(snapshot.id, memo);
			if (wanted(snapshot.provider, settings())) {
				messages.forEach(notify);
			}
		},

		/** Forget a card (deleted or reconnected). */
		forget(id) {
			memos.delete(id);
		},
	};
}

module.exports = { create, wanted, options, DEFAULTS };
