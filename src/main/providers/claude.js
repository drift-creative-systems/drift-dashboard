/**
 * Claude plan usage: how much of your Pro/Max session and weekly limits you've
 * used, the same figures as Claude Code's /usage. Reads the sign-in Claude Code
 * keeps on this computer and asks Claude's usage service. That endpoint is the
 * one Claude Code uses; it isn't documented, so it may change. The token stays
 * in the main process and is never refreshed here (that would rotate it and
 * could sign Claude Code out).
 *
 * Where Claude Code keeps its sign-in:
 *  - Windows and Linux: ~/.claude/.credentials.json (or CLAUDE_CONFIG_DIR).
 *  - macOS: the login Keychain, as a password item named
 *    "Claude Code-credentials" holding the same JSON. With CLAUDE_CONFIG_DIR
 *    set, the name gets "-" + the first 8 hex characters of the SHA-256 of
 *    that folder's path. Read with Apple's `security` tool, which Claude Code
 *    uses itself, so macOS normally doesn't ask. The file is the fallback.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { request } = require('../http');

const MAC = 'darwin' === process.platform;
const KEYCHAIN_SERVICE = 'Claude Code-credentials';
const SECURITY = '/usr/bin/security';
const KEYCHAINS = path.join(os.homedir(), 'Library', 'Keychains');

const SERVICE = 'Claude';
const API = 'https://api.anthropic.com/api/oauth/usage';
const EXPIRED = 'Your Claude sign-in has expired. Open Claude Code (or run `claude`) and it will renew it; this card updates as soon as it does.';

/** Names for the limit kinds Claude reports; anything new is tidied from its key. */
const LIMIT_NAMES = {
	session: 'Current session',
	weekly_all: 'Weekly · all models',
	weekly_opus: 'Weekly · Opus',
	weekly_sonnet: 'Weekly · Sonnet',
};

/**
 * Folders that may hold Claude Code's settings: the setting, then
 * CLAUDE_CONFIG_DIR (can be a comma-separated list), then the default.
 */
function roots(custom) {
	const text = String(custom || '').trim();
	if (text) {
		return [text.replace(/^~(?=$|[\\/])/, os.homedir())];
	}
	const env = String(process.env.CLAUDE_CONFIG_DIR || '').split(',').map((s) => s.trim()).filter(Boolean);
	return env.length ? env : [path.join(os.homedir(), '.claude')];
}

/** The folder Claude Code uses: the first that exists. */
function root(custom) {
	const list = roots(custom);
	return list.find((dir) => fs.existsSync(dir)) || list[0];
}

/** Run Apple's `security` tool; resolves to stdout, or null if the item isn't there. */
function security(args) {
	return new Promise((resolve, reject) => {
		execFile(SECURITY, args, { timeout: 10000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
			if (!err) {
				resolve(String(stdout));
			} else if (44 === err.code) {
				resolve(null); // errSecItemNotFound
			} else {
				const text = String(stderr || err.message);
				const e = new Error(/user interaction is not allowed|interaction not allowed|-25308/i.test(text)
					? 'Your Mac’s keychain is locked. Unlock your Mac and the card will retry.'
					: /denied|-128|cancel/i.test(text)
						? 'Access to Claude Code’s sign-in in the keychain was refused. Click ↻ and choose Always Allow when macOS asks.'
						: `Couldn’t read Claude Code’s sign-in from the keychain (${text.trim().split('\n')[0]}).`);
				e.keychain = true;
				reject(e);
			}
		});
	});
}

/** Keychain item names to try first: the CLAUDE_CONFIG_DIR one (if any), then the default. */
function keychainServices(custom) {
	const names = [];
	const text = String(custom || '').trim();
	const dirs = text
		? [text.replace(/^~(?=$|[\\/])/, os.homedir())]
		: String(process.env.CLAUDE_CONFIG_DIR || '').split(',').map((d) => d.trim()).filter(Boolean);
	for (const dir of dirs) {
		names.push(`${KEYCHAIN_SERVICE}-${crypto.createHash('sha256').update(dir).digest('hex').slice(0, 8)}`);
	}
	names.push(KEYCHAIN_SERVICE);
	return [...new Set(names)];
}

/** Every "Claude Code-credentials…" item in the keychain (names only, no secrets). */
async function keychainAllServices() {
	const dump = await security(['dump-keychain']).catch(() => null);
	const found = new Set();
	for (const m of String(dump || '').matchAll(/"svce"<blob>="(Claude Code-credentials(?:-[0-9a-f]{8})?)"/g)) {
		found.add(m[1]);
	}
	return [...found];
}

function parseOauth(text) {
	try {
		const data = JSON.parse(String(text || '').trim());
		return (data && data.claudeAiOauth) || null;
	} catch {
		return null;
	}
}

/**
 * macOS: the sign-in from the keychain. Tries the expected item names, and
 * if none holds a current sign-in, any other Claude Code item (some installs
 * collect several), keeping the one that expires last. Null if there are none.
 */
async function keychainSignIn(custom) {
	const user = process.env.USER || os.userInfo().username;
	const read = async (service) => {
		const withUser = await security(['find-generic-password', '-s', service, '-a', user, '-w']);
		return parseOauth(null !== withUser ? withUser : await security(['find-generic-password', '-s', service, '-w']));
	};
	const best = (list) => list.filter((o) => o && o.accessToken)
		.sort((a, b) => (Number(b.expiresAt) || 0) - (Number(a.expiresAt) || 0))[0] || null;
	const current = (o) => o && (!o.expiresAt || Date.now() < o.expiresAt);

	const tried = keychainServices(custom);
	const found = [];
	for (const service of tried) {
		const oauth = await read(service);
		if (current(oauth)) {
			return oauth;
		}
		found.push(oauth);
	}
	const others = (await keychainAllServices()).filter((s) => !tried.includes(s)).slice(0, 10);
	for (const service of others) {
		found.push(await read(service));
	}
	return best(found) || (found.some(Boolean) ? found.find(Boolean) : null);
}

/** Windows/Linux (and the macOS fallback): ~/.claude/.credentials.json. */
function fileSignIn(custom) {
	const files = roots(custom).map((dir) => path.join(dir, '.credentials.json'));
	const file = files.find((f) => fs.existsSync(f));
	if (!file) {
		return { missing: files };
	}
	try {
		return { oauth: JSON.parse(fs.readFileSync(file, 'utf8')).claudeAiOauth || {} };
	} catch (err) {
		console.error('[claude] Couldn\'t read the credentials file:', err.message);
		throw new Error('Couldn\'t read Claude Code\'s sign-in file.');
	}
}

/**
 * Claude Code's sign-in: { accessToken, expiresAt, subscriptionType }.
 */
async function signIn(custom) {
	let oauth = MAC ? await keychainSignIn(custom) : null;
	if (!oauth) {
		const file = fileSignIn(custom);
		if (file.missing) {
			throw new Error(MAC
				? 'Couldn’t find Claude Code’s sign-in in your keychain. Run `claude` in Terminal and sign in with /login, then click ↻.'
				: `Couldn't find Claude Code's sign-in at ${file.missing.join(' or ')}. Sign in to Claude Code on this computer first.`);
		}
		oauth = file.oauth;
	}
	if (!oauth || !oauth.accessToken) {
		throw new Error('Claude Code is signed in with an API key, not a Claude plan, so there are no plan limits to show.');
	}
	if (oauth.expiresAt && Date.now() >= oauth.expiresAt) {
		throw new Error(EXPIRED);
	}
	return oauth;
}

function limitName(kind, scope) {
	const name = LIMIT_NAMES[kind] || String(kind || 'Limit').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
	return scope ? `${name} · ${scope}` : name;
}

/**
 * Limits as [{ name, percent, resetsAt, severity }]. Uses the `limits` list,
 * falling back to the older five_hour / seven_day fields.
 */
function limits(data) {
	if (Array.isArray(data.limits) && data.limits.length) {
		return data.limits.map((l) => ({
			name: limitName(l.kind, l.scope),
			percent: Math.round(Number(l.percent) || 0),
			resetsAt: l.resets_at || null,
			severity: l.severity || 'normal',
		}));
	}
	return [['five_hour', 'session'], ['seven_day', 'weekly_all'], ['seven_day_opus', 'weekly_opus'], ['seven_day_sonnet', 'weekly_sonnet']]
		.filter(([key]) => data[key])
		.map(([key, kind]) => ({
			name: limitName(kind),
			percent: Math.round(Number(data[key].utilization) || 0),
			resetsAt: data[key].resets_at || null,
			severity: 'normal',
		}));
}

/**
 * Pay-as-you-go credits used once a limit is hit, as { used, limit, currency }
 * in major units (e.g. pounds), or null if it isn't switched on.
 */
function extra(data) {
	const spend = data.spend;
	if (!spend || !spend.enabled || !spend.used) {
		return null;
	}
	const money = (m) => (m && undefined !== m.amount_minor ? m.amount_minor / 10 ** (m.exponent || 0) : null);
	return {
		used: money(spend.used) || 0,
		limit: money(spend.limit),
		percent: Number(spend.percent) || 0,
		currency: spend.used.currency || 'GBP',
	};
}

module.exports = {
	root,
	id: 'claude',
	name: 'Claude plan usage',
	section: 'now',
	interval: 5 * 60 * 1000, // Undocumented endpoint, so check gently.
	oauth: false,
	help: 'Uses the Claude sign-in from Claude Code on this computer (the Keychain on a Mac), so sign in to Claude Code first. Leave the folder blank unless you moved Claude Code\'s settings folder.',
	fields: [
		{ key: 'folder', label: 'Claude settings folder', type: 'text', placeholder: '~/.claude' },
	],

	/**
	 * Calls `changed` when Claude Code saves a new sign-in, so an expired card
	 * recovers straight away instead of on its next check. Returns a stop function.
	 */
	watch(account, changed) {
		// On a Mac, Claude Code saves a renewed sign-in to the login keychain file.
		const targets = roots(account.config.folder).map((dir) => [dir, '.credentials.json']);
		if (MAC) {
			targets.push([KEYCHAINS, 'login.keychain-db']);
		}
		const watchers = targets.filter(([dir]) => fs.existsSync(dir)).flatMap(([dir, name]) => {
			try {
				const watcher = fs.watch(dir, (event, file) => {
					// Some platforms don't report the name; treat that as a possible change.
					if (!file || name === String(file)) {
						changed();
					}
				});
				watcher.on('error', (err) => console.error('[claude] Stopped watching the sign-in:', err.message));
				return [watcher];
			} catch (err) {
				console.error('[claude] Couldn\'t watch the sign-in:', err.message);
				return [];
			}
		});
		return () => watchers.forEach((w) => w.close());
	},

	async fetch(account) {
		const oauth = await signIn(account.config.folder);

		let response;
		try {
			response = await request(API, {
				headers: { Authorization: `Bearer ${oauth.accessToken}`, 'anthropic-beta': 'oauth-2025-04-20' },
				service: SERVICE,
			});
		} catch (err) {
			if (401 === err.status) {
				throw new Error(EXPIRED);
			}
			if (404 === err.status) {
				throw new Error('Claude\'s usage service has moved. The dashboard needs an update.');
			}
			throw err;
		}

		const data = response.data;
		if (!data || 'object' !== typeof data) {
			throw new Error('Claude\'s usage service returned an unexpected response.');
		}
		const breakdown = (data.seven_day_breakdown && data.seven_day_breakdown.rows) || [];

		return {
			plan: oauth.subscriptionType || '',
			limits: limits(data),
			extra: extra(data),
			apps: breakdown
				.filter((r) => r.percent > 0)
				.sort((a, b) => b.percent - a.percent)
				.map((r) => ({ name: r.display_name || r.key, percent: Math.round(r.percent) })),
			url: 'https://claude.ai/settings/usage',
		};
	},
};
