/**
 * Claude plan usage: how much of your Pro/Max session and weekly limits you've
 * used, the same figures as Claude Code's /usage. Reads the sign-in Claude Code
 * keeps on this PC (~/.claude/.credentials.json) and asks Claude's usage
 * service. That endpoint is the one Claude Code uses; it isn't documented, so
 * it may change. The token stays in the main process and is never refreshed
 * here (that would rotate it and could sign Claude Code out).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { request } = require('../http');

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

/**
 * Claude Code's sign-in: { accessToken, expiresAt, subscriptionType }.
 */
function signIn(custom) {
	const files = roots(custom).map((dir) => path.join(dir, '.credentials.json'));
	const file = files.find((f) => fs.existsSync(f));
	if (!file) {
		throw new Error(`Couldn't find Claude Code's sign-in at ${files.join(' or ')}. Sign in to Claude Code on this PC first.`);
	}
	let oauth;
	try {
		oauth = JSON.parse(fs.readFileSync(file, 'utf8')).claudeAiOauth;
	} catch (err) {
		console.error('[claude] Couldn\'t read the credentials file:', err.message);
		throw new Error('Couldn\'t read Claude Code\'s sign-in file.');
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
	id: 'claude',
	name: 'Claude plan usage',
	section: 'now',
	interval: 5 * 60 * 1000, // Undocumented endpoint, so check gently.
	oauth: false,
	help: 'Uses the Claude sign-in from Claude Code on this PC, so sign in to Claude Code first. Leave the folder blank unless you moved Claude Code\'s settings folder.',
	fields: [
		{ key: 'folder', label: 'Claude settings folder', type: 'text', placeholder: '~/.claude' },
	],

	/**
	 * Calls `changed` when Claude Code saves a new sign-in, so an expired card
	 * recovers straight away instead of on its next check. Returns a stop function.
	 */
	watch(account, changed) {
		const watchers = roots(account.config.folder).filter((dir) => fs.existsSync(dir)).flatMap((dir) => {
			try {
				const watcher = fs.watch(dir, (event, file) => {
					// Some platforms don't report the name; treat that as a possible change.
					if (!file || '.credentials.json' === String(file)) {
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
		const oauth = signIn(account.config.folder);

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
