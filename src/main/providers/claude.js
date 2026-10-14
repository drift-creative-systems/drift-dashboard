/**
 * Claude Code usage on this PC: tokens and estimated API cost for the current
 * 5-hour block, today, this week and this month. Reads the session logs Claude
 * Code writes under ~/.claude/projects (no account or key needed). Each file is
 * read once and then only from where it left off, so polling stays cheap.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const BLOCK = 5 * HOUR; // Claude's usage limits reset on a rolling 5-hour window.
const MAX_AGE = 32 * DAY; // Files untouched for longer can't affect this month.

/**
 * API list prices in US$ per million tokens. Cache writes are 1.25× input for
 * the 5-minute cache and 2× for the 1-hour cache; cache reads are listed where
 * they differ from the usual 0.1× input. Most specific pattern first.
 */
const PRICES = [
	{ match: /fable-5-1|mythos-5-1/, input: 10, output: 50, read: 0.25 },
	{ match: /fable|mythos/, input: 10, output: 50 },
	{ match: /opus-5-5/, input: 4, output: 20, read: 0.2 },
	{ match: /opus-(5|4-[5-9])/, input: 5, output: 25 },
	{ match: /opus/, input: 15, output: 75 },
	{ match: /sonnet-5/, input: 2, output: 10, read: 0.2 },
	{ match: /sonnet/, input: 3, output: 15 },
	{ match: /haiku-5-5/, input: 0.1, output: 0.5, read: 0.01 },
	{ match: /haiku-4/, input: 1, output: 5 },
	{ match: /haiku-3-5|3-5-haiku/, input: 0.8, output: 4 },
	{ match: /haiku/, input: 0.25, output: 1.25 },
];

// Parsed files, kept between polls: path → { mtime, offset, entries }.
const files = new Map();

/**
 * Folders that may hold Claude Code's projects/ directory: the setting, then
 * CLAUDE_CONFIG_DIR (can be a comma-separated list), then the defaults.
 */
function roots(custom) {
	const text = String(custom || '').trim();
	if (text) {
		const dir = text.replace(/^~(?=$|[\\/])/, os.homedir());
		return [path.basename(dir) === 'projects' ? path.dirname(dir) : dir];
	}
	const env = String(process.env.CLAUDE_CONFIG_DIR || '').split(',').map((s) => s.trim()).filter(Boolean);
	return env.length ? env : [path.join(os.homedir(), '.claude'), path.join(os.homedir(), '.config', 'claude')];
}

/**
 * Every .jsonl log under a folder (sessions, plus subagents/ inside them).
 */
async function walk(dir, out = []) {
	let list;
	try {
		list = await fs.promises.readdir(dir, { withFileTypes: true });
	} catch {
		return out;
	}
	for (const entry of list) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			await walk(full, out);
		} else if (entry.name.endsWith('.jsonl')) {
			out.push(full);
		}
	}
	return out;
}

/**
 * One log line → a usage entry, or null if it isn't an assistant reply.
 */
function parseLine(line) {
	// Cheap check first: most lines are prompts and tool results.
	if (!line.includes('"usage"') || !line.includes('"assistant"')) {
		return null;
	}
	let row;
	try {
		row = JSON.parse(line);
	} catch {
		return null; // A half-written line; it's read again once complete.
	}
	const msg = row && row.message;
	const u = msg && msg.usage;
	const time = row && Date.parse(row.timestamp);
	if (!u || 'assistant' !== row.type || Number.isNaN(time) || !msg.model || '<synthetic>' === msg.model) {
		return null;
	}
	const created = Number(u.cache_creation_input_tokens) || 0;
	const hour = Number(u.cache_creation && u.cache_creation.ephemeral_1h_input_tokens) || 0;
	return {
		// Claude Code writes one line per content block with the same usage,
		// so count each reply once.
		key: `${msg.id || ''}:${row.requestId || ''}`,
		time,
		model: msg.model,
		project: String(row.cwd || '').split(/[\\/]/).filter(Boolean).pop() || 'Unknown',
		input: Number(u.input_tokens) || 0,
		output: Number(u.output_tokens) || 0,
		write5m: Math.max(0, created - hour),
		write1h: hour,
		read: Number(u.cache_read_input_tokens) || 0,
	};
}

/**
 * Read the part of a file added since last time (it's append-only), stopping
 * at the last complete line.
 */
async function update(file, stat) {
	let cached = files.get(file);
	if (cached && cached.mtime === stat.mtimeMs && cached.size === stat.size) {
		return cached.entries;
	}
	if (!cached || stat.size < cached.offset) {
		cached = { offset: 0, entries: [] };
	}
	const length = stat.size - cached.offset;
	if (length > 0) {
		const handle = await fs.promises.open(file, 'r');
		try {
			const buffer = Buffer.alloc(length);
			const { bytesRead } = await handle.read(buffer, 0, length, cached.offset);
			const end = buffer.subarray(0, bytesRead).lastIndexOf(0x0a);
			if (end >= 0) {
				buffer.subarray(0, end).toString('utf8').split('\n').forEach((line) => {
					const entry = parseLine(line);
					if (entry) {
						cached.entries.push(entry);
					}
				});
				cached.offset += end + 1;
			}
		} finally {
			await handle.close();
		}
	}
	files.set(file, { ...cached, mtime: stat.mtimeMs, size: stat.size });
	return cached.entries;
}

function price(model) {
	return PRICES.find((p) => p.match.test(model)) || null;
}

/**
 * Estimated cost of one reply in US$, or null for a model we have no price for.
 */
function cost(e) {
	const p = price(e.model);
	if (!p) {
		return null;
	}
	const read = undefined === p.read ? p.input * 0.1 : p.read;
	return (e.input * p.input + e.output * p.output + e.write5m * p.input * 1.25 + e.write1h * p.input * 2 + e.read * read) / 1e6;
}

/** "claude-opus-5-5" → "Opus 5.5"; "claude-sonnet-4-20250514" → "Sonnet 4". */
function modelName(id) {
	const m = String(id).match(/claude-([a-z]+)-(\d{1,2})(?:-(\d{1,2}))?(?!\d)/);
	if (!m) {
		return id;
	}
	return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ''}`;
}

function blank() {
	return { cost: 0, tokens: 0, replies: 0 };
}

function add(total, e) {
	total.cost += e.cost || 0;
	total.tokens += e.input + e.output + e.write5m + e.write1h + e.read;
	total.replies += 1;
	return total;
}

/**
 * Group totals by a field, biggest first.
 */
function top(list, field, limit) {
	const groups = new Map();
	list.forEach((e) => {
		const name = 'model' === field ? modelName(e.model) : e[field];
		groups.set(name, add(groups.get(name) || blank(), e));
	});
	return [...groups.entries()]
		.map(([name, t]) => ({ name, ...t }))
		.sort((a, b) => b.cost - a.cost || b.tokens - a.tokens)
		.slice(0, limit);
}

/**
 * The 5-hour block still running, worked out the same way as ccusage: a block
 * starts on the hour of the first reply and ends 5 hours later, or after a
 * 5-hour gap.
 */
function currentBlock(sorted, now) {
	let start = null;
	let last = 0;
	let replies = [];
	for (const e of sorted) {
		if (null === start || e.time >= start + BLOCK || e.time - last >= BLOCK) {
			start = Math.floor(e.time / HOUR) * HOUR;
			replies = [];
		}
		replies.push(e);
		last = e.time;
	}
	if (null === start || now >= start + BLOCK || now - last >= BLOCK) {
		return null;
	}
	return { start: new Date(start).toISOString(), end: new Date(start + BLOCK).toISOString(), ...replies.reduce(add, blank()) };
}

module.exports = {
	id: 'claude',
	name: 'Claude Code usage',
	section: 'now',
	interval: 60 * 1000,
	oauth: false,
	help: 'Reads the logs Claude Code keeps on this PC. Nothing to sign in to; leave the folder blank unless you moved Claude Code\'s settings folder.',
	fields: [
		{ key: 'folder', label: 'Claude settings folder', type: 'text', placeholder: '~/.claude' },
	],

	async fetch(account) {
		const dirs = roots(account.config.folder).map((dir) => path.join(dir, 'projects')).filter((dir) => fs.existsSync(dir));
		if (!dirs.length) {
			throw new Error(`Couldn't find Claude Code's logs in ${roots(account.config.folder).join(' or ')}. Is Claude Code installed on this PC?`);
		}

		const now = Date.now();
		const seen = new Set();
		const all = [];
		const found = (await Promise.all(dirs.map((dir) => walk(dir)))).flat();
		for (const file of found) {
			let stat;
			try {
				stat = await fs.promises.stat(file);
			} catch {
				continue; // Deleted between listing and reading.
			}
			if (now - stat.mtimeMs > MAX_AGE) {
				files.delete(file);
				continue;
			}
			try {
				for (const e of await update(file, stat)) {
					if (now - e.time <= MAX_AGE && !seen.has(e.key)) {
						seen.add(e.key);
						all.push(e);
					}
				}
			} catch (err) {
				console.error(`[claude] Couldn't read ${file}:`, err.message);
			}
			// Let the window stay responsive during the first full read.
			await new Promise((resolve) => setImmediate(resolve));
		}
		// Forget files that have gone away.
		const live = new Set(found);
		[...files.keys()].filter((f) => !live.has(f)).forEach((f) => files.delete(f));

		all.forEach((e) => {
			e.cost = cost(e);
		});
		all.sort((a, b) => a.time - b.time);

		const today = new Date(now);
		today.setHours(0, 0, 0, 0);
		const week = new Date(today);
		week.setDate(week.getDate() - ((week.getDay() + 6) % 7)); // Monday.
		const month = new Date(today.getFullYear(), today.getMonth(), 1);
		const since = (from) => all.filter((e) => e.time >= from.getTime());
		const todays = since(today);

		return {
			block: currentBlock(all, now),
			lastUsed: all.length ? new Date(all[all.length - 1].time).toISOString() : null,
			today: todays.reduce(add, blank()),
			week: since(week).reduce(add, blank()),
			month: since(month).reduce(add, blank()),
			models: top(todays, 'model', 4),
			projects: top(todays, 'project', 3),
			unpriced: all.some((e) => null === e.cost),
			url: 'https://claude.ai/settings/usage',
		};
	},
};
