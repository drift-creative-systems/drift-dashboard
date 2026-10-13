/**
 * Xbox: last game played, via OpenXBL (xbl.io). Microsoft has no official
 * consumer API, so this relies on that third-party service and its free key.
 */
const { request } = require('../http');

const API = 'https://xbl.io/api/v2';
const SERVICE = 'OpenXBL';

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
		const { data } = await request(`${API}/player/titleHistory`, {
			headers: { 'X-Authorization': key, 'Accept-Language': 'en-GB' },
			service: SERVICE,
		});

		const games = ((data && data.titles) || [])
			.filter((t) => !t.type || 'Game' === t.type)
			.filter((t) => t.titleHistory && t.titleHistory.lastTimePlayed)
			.sort((a, b) => b.titleHistory.lastTimePlayed.localeCompare(a.titleHistory.lastTimePlayed));

		const last = games[0];
		if (!last) {
			return { game: null };
		}
		const ach = last.achievement || {};
		return {
			game: {
				name: last.name,
				image: last.displayImage || null,
				playedAt: last.titleHistory.lastTimePlayed,
				gamerscore: ach.currentGamerscore || 0,
				totalGamerscore: ach.totalGamerscore || 0,
				progress: ach.progressPercentage || 0,
			},
			recent: games.slice(1, 4).map((g) => ({ name: g.name, playedAt: g.titleHistory.lastTimePlayed })),
		};
	},
};
