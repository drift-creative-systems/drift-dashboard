/**
 * Plex Media Server: who is streaming right now and what they're watching.
 * Reads /status/sessions on your own server with your X-Plex-Token.
 */
const { request } = require('../http');

const SERVICE = 'Plex';
const POSTER_TTL = 6 * 60 * 60 * 1000;
const POSTER_MAX_BYTES = 200 * 1024;

// Plex needs these to identify the app; the ID only has to be stable.
const CLIENT_HEADERS = {
	'X-Plex-Product': 'Drift Dashboard',
	'X-Plex-Client-Identifier': 'bonsai-desktop-dashboard',
};

/**
 * Whether a hostname is on the local network, where plain http is allowed
 * (Plex servers on a LAN have no certificate for their IP address).
 */
function isPrivateHost(host) {
	if ('localhost' === host || host.endsWith('.local')) {
		return true;
	}
	const ip = host.split('.').map(Number);
	if (4 !== ip.length || ip.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
		return false;
	}
	return 10 === ip[0]
		|| 127 === ip[0]
		|| (192 === ip[0] && 168 === ip[1])
		|| (172 === ip[0] && ip[1] >= 16 && ip[1] <= 31);
}

function serverUrl(raw) {
	let text = String(raw || '').trim();
	// "192.168.1.20:32400" with no scheme is the usual way people write it.
	if (text && !/^[a-z]+:\/\//i.test(text)) {
		text = `http://${text}`;
	}
	let url;
	try {
		url = new URL(text);
	} catch {
		throw new Error('Add the server address in Settings, e.g. http://192.168.1.20:32400');
	}
	if ('https:' !== url.protocol && !('http:' === url.protocol && isPrivateHost(url.hostname))) {
		throw new Error('Use https:// for a Plex server outside your home network.');
	}
	if (!url.port && 'http:' === url.protocol) {
		url.port = '32400';
	}
	url.pathname = '/';
	url.search = '';
	url.hash = '';
	return url;
}

/**
 * The token itself, or pulled out of a pasted View XML address.
 */
function tokenFrom(raw) {
	const text = String(raw || '').trim();
	const match = text.match(/X-Plex-Token=([^&#\s]+)/i);
	return match ? decodeURIComponent(match[1]) : text;
}

const pad = (n) => String(n || 0).padStart(2, '0');

/**
 * Title and subtitle for one session, by media type.
 */
function describe(m) {
	if ('episode' === m.type) {
		const ep = m.parentIndex !== undefined && m.index !== undefined ? `S${pad(m.parentIndex)}E${pad(m.index)}` : '';
		return { kind: 'episode', title: m.grandparentTitle || m.title, sub: [ep, m.title].filter(Boolean).join(' · ') };
	}
	if ('track' === m.type) {
		return { kind: 'track', title: m.title, sub: [m.grandparentTitle, m.parentTitle].filter(Boolean).join(' · ') };
	}
	return { kind: m.type || 'movie', title: m.title, sub: m.year ? String(m.year) : '' };
}

/**
 * Poster as a data: URI, so the token never reaches the window.
 * Cached per image for 6 hours; returns null if anything goes wrong.
 */
async function poster(base, token, thumb, ctx) {
	if (!thumb) {
		return null;
	}
	try {
		return await ctx.cached(`poster:${thumb}`, POSTER_TTL, async () => {
			const url = new URL('photo/:/transcode', base);
			url.search = new URLSearchParams({ width: '120', height: '180', minSize: '1', upscale: '1', url: thumb }).toString();
			const response = await fetch(url, {
				headers: { ...CLIENT_HEADERS, 'X-Plex-Token': token },
				signal: AbortSignal.timeout(10000),
			});
			const type = response.headers.get('content-type') || '';
			if (!response.ok || !type.startsWith('image/')) {
				return null;
			}
			const bytes = Buffer.from(await response.arrayBuffer());
			if (bytes.length > POSTER_MAX_BYTES) {
				return null;
			}
			return `data:${type.split(';')[0]};base64,${bytes.toString('base64')}`;
		});
	} catch {
		return null;
	}
}

module.exports = {
	id: 'plex',
	name: 'Plex',
	section: 'now',
	interval: 30 * 1000,
	oauth: false,
	help: 'Plex Web → any film → ⋯ → Get Info → View XML, then copy the X-Plex-Token value from the address bar.',
	fields: [
		{ key: 'url', label: 'Server address', type: 'text', placeholder: 'http://192.168.1.20:32400', required: true },
		{ key: 'token', label: 'Plex token (or the whole View XML address)', type: 'password', secret: true, required: true },
	],

	async fetch(account, ctx) {
		const token = tokenFrom(ctx.secrets().token);
		if (!token) {
			throw new Error('Add your Plex token in Settings.');
		}
		const base = serverUrl(account.config.url);
		const headers = { ...CLIENT_HEADERS, 'X-Plex-Token': token };

		let response;
		try {
			response = await request(new URL('status/sessions', base).toString(), { headers, service: SERVICE });
		} catch (err) {
			if (401 === err.status) {
				throw new Error('Plex rejected the token. Copy a fresh one from View XML and paste it in Settings.');
			}
			if (0 === err.status && !/too long/.test(err.message)) {
				throw new Error(`Couldn't reach the Plex server at ${base.host}. Check the address and that this PC is on the same network.`);
			}
			throw err;
		}

		const container = (response.data && response.data.MediaContainer) || {};
		const sessions = Array.isArray(container.Metadata) ? container.Metadata : [];

		const streams = await Promise.all(sessions.map(async (m) => {
			const player = m.Player || {};
			const session = m.Session || {};
			const transcode = m.TranscodeSession || null;
			const media = (Array.isArray(m.Media) && m.Media[0]) || {};
			// Episodes look better with the show's poster than the episode still.
			const thumb = 'episode' === m.type ? (m.grandparentThumb || m.thumb) : (m.thumb || m.parentThumb);
			return {
				...describe(m),
				user: (m.User && m.User.title) || 'Someone',
				device: player.title || player.product || player.platform || '',
				state: player.state || 'playing',
				remote: 'wan' === session.location || false === player.local,
				transcoding: Boolean(transcode && ('transcode' === transcode.videoDecision || 'transcode' === transcode.audioDecision)),
				resolution: media.videoResolution || '',
				bandwidth: Number(session.bandwidth) || 0,
				duration: Number(m.duration) || 0,
				offset: Number(m.viewOffset) || 0,
				image: await poster(base, token, thumb, ctx),
			};
		}));

		return {
			count: streams.length,
			transcodes: streams.filter((s) => s.transcoding).length,
			bandwidth: streams.reduce((n, s) => n + s.bandwidth, 0),
			streams,
			// The app only opens https links, so use Plex Web rather than the LAN address.
			url: 'https://app.plex.tv/desktop/',
		};
	},
};
