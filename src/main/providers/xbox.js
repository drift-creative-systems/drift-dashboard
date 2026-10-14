/**
 * Xbox: last game played, via OpenXBL (xbl.io). Microsoft has no official
 * consumer API, so this relies on that third-party service and its free key.
 */
const { request } = require('../http');

const API = 'https://xbl.io/api/v2';
const SERVICE = 'OpenXBL';

/** Box art over https only (some come back as http://, which the window blocks). */
function https(url) {
	return url ? String(url).replace(/^http:\/\//i, 'https://') : null;
}

module.exports = {
	id: 'xbox',
	name: 'Xbox',
	section: 'now',
	interval: 10 * 60 * 1000, // Free OpenXBL keys allow ~150 requests an hour.
	oauth: false,
	help: 'Sign in at xbl.io with your Xbox account and copy your personal API key.',
	fields: [
		{ key: 'api_key', label: 'OpenXBL API key', type: 'password', secret: true, required: true },
	],

	async fetch(account, ctx) {
		const { api_key: key } = ctx.secrets();
		if (!key) {
			throw new Error('Add the OpenXBL API key in Settings.');
		}
		// Same endpoint as the Drift Xbox tracker: player/titleHistory came back
		// empty for some accounts, while achievements lists every game played.
		const { data } = await request(`${API}/achievements`, {
			headers: { 'X-Authorization': key, 'Accept-Language': 'en-GB' },
			service: SERVICE,
		});

		const list = (data && (data.titles || (data.content && data.content.titles))) || [];
		const playedAt = (t) => {
			const time = new Date((t.titleHistory && t.titleHistory.lastTimePlayed) || '').getTime();
			return Number.isNaN(time) ? 0 : time;
		};
		const games = list
			.filter((t) => !t.type || 'Game' === t.type)
			.filter((t) => playedAt(t) > 0)
			.sort((a, b) => playedAt(b) - playedAt(a));

		const last = games[0];
		if (!last) {
			return { game: null };
		}
		const ach = last.achievement || {};
		return {
			game: {
				name: last.name,
				image: https(last.displayImage),
				playedAt: new Date(playedAt(last)).toISOString(),
				gamerscore: ach.currentGamerscore || 0,
				totalGamerscore: ach.totalGamerscore || 0,
				progress: ach.progressPercentage || 0,
			},
			recent: games.slice(1, 4).map((g) => ({ name: g.name, playedAt: new Date(playedAt(g)).toISOString() })),
		};
	},
};
