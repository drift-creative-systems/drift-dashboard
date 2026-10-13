/**
 * Strava: this week's running time, walking time and gym sessions.
 * Week = Monday 00:00 local time to now.
 * Sign-in: standard OAuth with client secret (Strava doesn't support PKCE).
 */
const oauth = require('../oauth');
const { request } = require('../http');

const AUTH_URL = 'https://www.strava.com/oauth/authorize';
const TOKEN_URL = 'https://www.strava.com/oauth/token';
const API = 'https://www.strava.com/api/v3';
const SERVICE = 'Strava';

// Strava sport_type values grouped into the three buckets on the card.
const GROUPS = {
	run: ['Run', 'TrailRun', 'VirtualRun'],
	walk: ['Walk', 'Hike'],
	gym: ['WeightTraining', 'Workout', 'Crossfit', 'HighIntensityIntervalTraining'],
};

function startOfWeek() {
	const d = new Date();
	const day = (d.getDay() + 6) % 7; // Monday = 0
	d.setHours(0, 0, 0, 0);
	d.setDate(d.getDate() - day);
	return d;
}

async function accessToken(account, ctx) {
	const secrets = ctx.secrets();
	if (!secrets.refresh_token) {
		throw new Error('Not connected yet. Open Settings and click Connect.');
	}
	if (!oauth.expired(secrets)) {
		return secrets.access_token;
	}
	const data = await oauth.token(TOKEN_URL, {
		grant_type: 'refresh_token',
		refresh_token: secrets.refresh_token,
		client_id: account.config.client_id,
		client_secret: secrets.client_secret,
	}, SERVICE);
	ctx.saveSecrets(stravaTokens(data));
	return data.access_token;
}

/**
 * Strava sends expires_at (epoch seconds) rather than expires_in.
 */
function stravaTokens(data) {
	const out = oauth.tokenSecrets(data);
	if (data.expires_at) {
		out.expires_at = Number(data.expires_at) * 1000;
	}
	return out;
}

module.exports = {
	id: 'strava',
	name: 'Strava',
	section: 'now',
	interval: 15 * 60 * 1000,
	oauth: true,
	help: 'Needs a free Strava API app. Authorization Callback Domain: 127.0.0.1',
	fields: [
		{ key: 'client_id', label: 'Client ID', type: 'text', required: true, notUrl: true },
		{ key: 'client_secret', label: 'Client Secret', type: 'password', secret: true, required: true, notUrl: true },
	],

	async connect(account, ctx) {
		const secrets = ctx.secrets();
		if (!account.config.client_id || !secrets.client_secret) {
			throw new Error('Add the Client ID and Client Secret first, then Save.');
		}
		const { code } = await oauth.authorize(AUTH_URL, {
			client_id: account.config.client_id,
			response_type: 'code',
			approval_prompt: 'auto',
			scope: 'read,activity:read_all',
		});
		const data = await oauth.token(TOKEN_URL, {
			grant_type: 'authorization_code',
			code,
			client_id: account.config.client_id,
			client_secret: secrets.client_secret,
		}, SERVICE);
		ctx.saveSecrets(stravaTokens(data));
	},

	async fetch(account, ctx) {
		const token = await accessToken(account, ctx);
		const since = startOfWeek();
		const { data } = await request(
			`${API}/athlete/activities?after=${Math.floor(since.getTime() / 1000)}&per_page=100`,
			{ headers: { Authorization: `Bearer ${token}` }, service: SERVICE }
		);

		const totals = {
			run: { seconds: 0, metres: 0, count: 0 },
			walk: { seconds: 0, metres: 0, count: 0 },
			gym: { seconds: 0, metres: 0, count: 0 },
		};
		for (const activity of Array.isArray(data) ? data : []) {
			const type = activity.sport_type || activity.type;
			for (const [group, types] of Object.entries(GROUPS)) {
				if (types.includes(type)) {
					totals[group].seconds += activity.moving_time || 0;
					totals[group].metres += activity.distance || 0;
					totals[group].count += 1;
				}
			}
		}
		return { weekStart: since.toISOString(), totals };
	},
};
