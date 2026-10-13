/**
 * Small fetch wrapper: timeouts, JSON parsing and readable errors, so every
 * provider fails the same way and the card can show something useful.
 */

const DEFAULT_TIMEOUT = 15000;

class HttpError extends Error {
	constructor(message, status, body) {
		super(message);
		this.name = 'HttpError';
		this.status = status;
		this.body = body;
	}
}

/**
 * Friendly message for common HTTP failures.
 */
function describe(status, service) {
	if (401 === status) {
		return `${service} rejected the login. Reconnect or check the key in Settings.`;
	}
	if (403 === status) {
		return `${service} refused access. Check the account has permission.`;
	}
	if (404 === status) {
		return `${service} endpoint not found. Check the URL in Settings.`;
	}
	if (429 === status) {
		return `${service} rate limit hit. It will retry shortly.`;
	}
	if (status >= 500) {
		return `${service} is having problems (HTTP ${status}).`;
	}
	return `${service} returned HTTP ${status}.`;
}

/**
 * Request a URL and return { status, data, headers }.
 *
 * @param {string} url
 * @param {object} opts  method, headers, body (object → JSON, URLSearchParams → form),
 *                       timeout, service (name for errors), allow (extra OK statuses)
 */
async function request(url, opts = {}) {
	const { method = 'GET', headers = {}, body, timeout = DEFAULT_TIMEOUT, service = 'Service', allow = [] } = opts;
	const init = { method, headers: { Accept: 'application/json', ...headers } };

	if (body instanceof URLSearchParams) {
		init.body = body.toString();
		init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
	} else if (body !== undefined) {
		init.body = JSON.stringify(body);
		init.headers['Content-Type'] = 'application/json';
	}

	let response;
	try {
		response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeout) });
	} catch (err) {
		if ('TimeoutError' === err.name) {
			throw new HttpError(`${service} took too long to answer.`, 0);
		}
		throw new HttpError(`Couldn't reach ${service}. Check your connection.`, 0);
	}

	const text = await response.text();
	let data = null;
	if (text) {
		try {
			data = JSON.parse(text);
		} catch {
			data = text;
		}
	}

	if (!response.ok && !allow.includes(response.status)) {
		throw new HttpError(describe(response.status, service), response.status, data);
	}
	return { status: response.status, data, headers: response.headers };
}

module.exports = { request, HttpError };
