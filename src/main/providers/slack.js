/**
 * Slack: latest direct messages (DMs and group DMs) for one workspace,
 * plus any channels you list. Uses a user token (xoxp-) from a small
 * private Slack app installed in that workspace. Read-only scopes.
 */
const { request } = require('../http');

const API = 'https://slack.com/api';
const SERVICE = 'Slack';
const DM_CANDIDATES = 12; // Conversations checked per refresh (Slack rate limits).
const SHOW = 4;

/**
 * Slack answers HTTP 200 with ok:false on errors.
 */
async function call(method, token, params = {}) {
	const url = new URL(`${API}/${method}`);
	for (const [k, v] of Object.entries(params)) {
		url.searchParams.set(k, v);
	}
	const { data } = await request(url.toString(), { headers: { Authorization: `Bearer ${token}` }, service: SERVICE });
	if (!data || !data.ok) {
		const error = (data && data.error) || 'unknown_error';
		if (['invalid_auth', 'not_authed', 'token_revoked', 'account_inactive'].includes(error)) {
			throw new Error('Slack rejected the token. Reinstall the app and paste the new User OAuth Token.');
		}
		if ('missing_scope' === error) {
			throw new Error(`Slack token is missing a scope (${data.needed || 'see README'}). Update the app manifest and reinstall.`);
		}
		if ('ratelimited' === error) {
			throw new Error('Slack rate limit hit. It will retry shortly.');
		}
		throw new Error(`Slack error: ${error}`);
	}
	return data;
}

/**
 * Resolve a user ID to a display name, cached for an hour.
 */
async function userName(id, token, ctx) {
	if (!id) {
		return 'Someone';
	}
	try {
		const data = await ctx.cached(`user:${id}`, 3600000, () => call('users.info', token, { user: id }));
		const p = data.user.profile || {};
		return p.display_name || p.real_name || data.user.name || id;
	} catch {
		return id;
	}
}

/**
 * Plain-text version of Slack's mrkdwn: <@U123>, <#C1|name>, <url|label>.
 */
async function plain(text, token, ctx) {
	let out = String(text || '');
	const mentions = [...new Set([...out.matchAll(/<@([A-Z0-9]+)(?:\|[^>]+)?>/g)].map((m) => m[1]))];
	for (const id of mentions) {
		const name = await userName(id, token, ctx);
		out = out.replace(new RegExp(`<@${id}(?:\\|[^>]+)?>`, 'g'), `@${name}`);
	}
	return out
		.replace(/<#[A-Z0-9]+\|([^>]+)>/g, '#$1')
		.replace(/<(https?:[^|>]+)\|([^>]+)>/g, '$2')
		.replace(/<(https?:[^>]+)>/g, '$1')
		.replace(/<!(here|channel|everyone)>/g, '@$1')
		.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
		.trim();
}

module.exports = {
	id: 'slack',
	name: 'Slack',
	section: 'slack',
	interval: 2 * 60 * 1000,
	oauth: false,
	help: 'Create a Slack app from the manifest in the README, install it, then paste the User OAuth Token (xoxp-…).',
	fields: [
		{ key: 'token', label: 'User OAuth Token (xoxp-…)', type: 'password', secret: true, required: true },
		{ key: 'channels', label: 'Also watch channel IDs (comma separated, optional)', type: 'text', placeholder: 'C0123ABCD, C0456EFGH', advanced: true },
	],

	async fetch(account, ctx) {
		const { token } = ctx.secrets();
		if (!token) {
			throw new Error('Add the User OAuth Token in Settings.');
		}
		const auth = await ctx.cached('auth', 3600000, () => call('auth.test', token));

		// DMs and group DMs, most recently updated first where Slack tells us.
		const convs = await call('users.conversations', token, { types: 'im,mpim', exclude_archived: 'true', limit: '200' });
		const dms = (convs.channels || [])
			.filter((c) => !c.is_user_deleted)
			.sort((a, b) => (b.updated || 0) - (a.updated || 0))
			.slice(0, DM_CANDIDATES);

		const watched = String(account.config.channels || '')
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean)
			.map((id) => ({ id, watched: true }));

		const latest = [];
		for (const conv of [...dms, ...watched]) {
			let history;
			try {
				history = await call('conversations.history', token, { channel: conv.id, limit: '1' });
			} catch (err) {
				if (conv.watched) {
					console.error(`[slack] Couldn't read channel ${conv.id}:`, err.message);
				}
				continue;
			}
			const msg = history.messages && history.messages[0];
			if (!msg || msg.subtype === 'channel_join') {
				continue;
			}
			latest.push({ conv, msg });
		}

		latest.sort((a, b) => Number(b.msg.ts) - Number(a.msg.ts));

		const items = [];
		for (const { conv, msg } of latest.slice(0, SHOW)) {
			const from = msg.user ? await userName(msg.user, token, ctx) : (msg.username || (msg.bot_profile && msg.bot_profile.name) || 'App');
			let where = 'Direct message';
			if (conv.is_mpim) {
				where = 'Group DM';
			} else if (conv.watched) {
				const info = await ctx.cached(`chan:${conv.id}`, 3600000, () => call('conversations.info', token, { channel: conv.id }));
				where = `#${info.channel.name}`;
			}
			items.push({
				from,
				where,
				mine: msg.user === auth.user_id,
				text: (await plain(msg.text, token, ctx)) || '(attachment)',
				date: new Date(Number(msg.ts) * 1000).toISOString(),
				url: `slack://channel?team=${auth.team_id}&id=${conv.id}`,
			});
		}

		return {
			team: auth.team,
			user: auth.user,
			url: `slack://open?team=${auth.team_id}`,
			items,
		};
	},
};
