/**
 * OAuth 2 sign-in for desktop apps (RFC 8252): open the provider's login
 * page in your normal browser, catch the redirect on a local loopback port,
 * swap the code for tokens. PKCE is used wherever the provider supports it.
 *
 * Redirect URIs to register with each provider (see README):
 *   http://127.0.0.1:8890/callback   (Spotify, Strava)
 *   http://localhost:8890/callback   (Microsoft)
 */
const http = require('http');
const crypto = require('crypto');
const { shell } = require('electron');
const { request } = require('./http');

const PORT = 8890;
const TIMEOUT_MS = 5 * 60 * 1000;

function redirectUri(host = '127.0.0.1') {
	return `http://${host}:${PORT}/callback`;
}

function base64url(buffer) {
	return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pkce() {
	const verifier = base64url(crypto.randomBytes(48));
	const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
	return { verifier, challenge };
}

const PAGE = (title, message) => `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:Segoe UI,system-ui,sans-serif;background:#f2f3f5;color:#000;display:grid;place-items:center;height:100vh;margin:0}
main{background:#fff;padding:2rem 2.5rem;border-radius:12px;border-top:6px solid #000;max-width:28rem}h1{margin:0 0 .5rem;font-size:1.4rem}</style>
</head><body><main><h1>${title}</h1><p>${message}</p></main></body></html>`;

let active = null;

/**
 * Open the browser and wait for the redirect.
 *
 * @param {string} authUrl  Authorisation endpoint.
 * @param {object} params   Query params (client_id, scope…). state/redirect_uri are added.
 * @param {string} host     Loopback host the provider expects.
 * @returns {Promise<{code: string, redirectUri: string}>}
 */
function authorize(authUrl, params, host = '127.0.0.1') {
	if (active) {
		active.cancel('Another sign-in was started.');
	}

	const state = base64url(crypto.randomBytes(16));
	const uri = redirectUri(host);
	const url = new URL(authUrl);
	for (const [key, value] of Object.entries({ ...params, redirect_uri: uri, state })) {
		url.searchParams.set(key, value);
	}

	return new Promise((resolve, reject) => {
		const servers = [];
		let timer = null;
		let done = false;

		const finish = (err, code) => {
			if (done) {
				return;
			}
			done = true;
			clearTimeout(timer);
			servers.forEach((s) => s.close());
			active = null;
			if (err) {
				reject(err);
			} else {
				resolve({ code, redirectUri: uri });
			}
		};

		const handler = (req, res) => {
			const incoming = new URL(req.url, uri);
			if ('/callback' !== incoming.pathname) {
				res.writeHead(404).end();
				return;
			}
			const error = incoming.searchParams.get('error');
			const code = incoming.searchParams.get('code');
			res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });

			if (incoming.searchParams.get('state') !== state) {
				res.end(PAGE('Sign-in failed', 'The response didn’t match this sign-in. Please try again from the dashboard.'));
				finish(new Error('Sign-in state mismatch. Please try again.'));
			} else if (error || !code) {
				res.end(PAGE('Sign-in cancelled', 'No changes were made. You can close this tab.'));
				finish(new Error(error ? `Sign-in was refused (${error}).` : 'No authorisation code was returned.'));
			} else {
				res.end(PAGE('Connected', 'You can close this tab and go back to Drift Dashboard.'));
				finish(null, code);
			}
		};

		// "localhost" can resolve to IPv4 or IPv6 depending on the browser, so
		// listen on both loopback addresses. Never on a public interface.
		const hosts = 'localhost' === host ? ['127.0.0.1', '::1'] : [host];
		let listening = 0;
		let failed = 0;
		for (const h of hosts) {
			const server = http.createServer(handler);
			// One address failing (e.g. no IPv6) is fine; all failing is not.
			server.on('error', (err) => {
				failed += 1;
				if (failed === hosts.length) {
					finish(new Error('EADDRINUSE' === err.code
						? `Port ${PORT} is already in use. Close whatever is using it and try again.`
						: `Couldn't start the sign-in listener: ${err.message}`));
				}
			});
			server.listen(PORT, h, () => {
				listening += 1;
				if (1 === listening) {
					shell.openExternal(url.toString());
				}
			});
			servers.push(server);
		}

		timer = setTimeout(() => finish(new Error('Sign-in timed out after 5 minutes.')), TIMEOUT_MS);
		active = { cancel: (reason) => finish(new Error(reason)) };
	});
}

/**
 * POST to a token endpoint (form encoded) and return the JSON.
 * `headers` is for providers that want client credentials as HTTP Basic.
 */
async function token(tokenUrl, params, service, headers = {}) {
	const { data } = await request(tokenUrl, {
		method: 'POST',
		body: new URLSearchParams(params),
		headers,
		service,
	});
	if (!data || !data.access_token) {
		throw new Error(`${service} didn’t return an access token.`);
	}
	return data;
}

/**
 * Store a token response as secrets, with an absolute expiry time.
 * Keeps the old refresh token if the provider didn't send a new one.
 */
function tokenSecrets(data) {
	const out = {
		access_token: data.access_token,
		expires_at: Date.now() + (Number(data.expires_in) || 3600) * 1000,
	};
	if (data.refresh_token) {
		out.refresh_token = data.refresh_token;
	}
	return out;
}

/**
 * Whether a stored access token needs refreshing (1 minute of slack).
 */
function expired(secrets) {
	return !secrets.access_token || !secrets.expires_at || Date.now() > secrets.expires_at - 60000;
}

module.exports = { authorize, token, tokenSecrets, expired, pkce, redirectUri };
