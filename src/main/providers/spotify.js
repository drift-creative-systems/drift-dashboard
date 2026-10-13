/**
 * Spotify: what's playing now, or the last track played.
 * Sign-in: Authorization Code + PKCE (no client secret needed).
 */
const oauth = require('../oauth');
const { request } = require('../http');

const AUTH_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API = 'https://api.spotify.com/v1';
const SCOPES = 'user-read-currently-playing user-read-playback-state user-read-recently-played';
const SERVICE = 'Spotify';

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
	}, SERVICE);
	ctx.saveSecrets(oauth.tokenSecrets(data));
	return data.access_token;
}

function track(item) {
	if (!item) {
		return null;
	}
	const images = (item.album && item.album.images) || (item.show && item.show.images) || [];
	return {
		title: item.name,
		artist: (item.artists || []).map((a) => a.name).join(', ') || (item.show && item.show.name) || '',
		album: (item.album && item.album.name) || '',
		image: images.length ? images[images.length > 1 ? 1 : 0].url : null,
		url: item.external_urls && item.external_urls.spotify,
		duration: item.duration_ms || 0,
	};
}

module.exports = {
	id: 'spotify',
	name: 'Spotify',
	section: 'now',
	interval: 15 * 1000,
	oauth: true,
	help: 'Needs a free Spotify developer app. Redirect URI: http://127.0.0.1:8890/callback',
	fields: [
		{ key: 'client_id', label: 'Client ID', type: 'text', required: true, notUrl: true },
	],

	async connect(account, ctx) {
		if (!account.config.client_id) {
			throw new Error('Add the Client ID first, then Save.');
		}
		const { verifier, challenge } = oauth.pkce();
		const { code, redirectUri } = await oauth.authorize(AUTH_URL, {
			client_id: account.config.client_id,
			response_type: 'code',
			scope: SCOPES,
			code_challenge_method: 'S256',
			code_challenge: challenge,
		});
		const data = await oauth.token(TOKEN_URL, {
			grant_type: 'authorization_code',
			code,
			redirect_uri: redirectUri,
			client_id: account.config.client_id,
			code_verifier: verifier,
		}, SERVICE);
		ctx.saveSecrets(oauth.tokenSecrets(data));
	},

	async fetch(account, ctx) {
		const token = await accessToken(account, ctx);
		const headers = { Authorization: `Bearer ${token}` };

		const now = await request(`${API}/me/player/currently-playing?additional_types=episode`, { headers, service: SERVICE, allow: [204] });
		if (200 === now.status && now.data && now.data.item) {
			return {
				playing: Boolean(now.data.is_playing),
				progress: now.data.progress_ms || 0,
				track: track(now.data.item),
			};
		}

		// Nothing playing: show the last track instead.
		const recent = await request(`${API}/me/player/recently-played?limit=1`, { headers, service: SERVICE });
		const last = recent.data && recent.data.items && recent.data.items[0];
		return {
			playing: false,
			progress: 0,
			track: last ? track(last.track) : null,
			playedAt: last ? last.played_at : null,
		};
	},
};
