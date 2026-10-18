/**
 * Drift: Record: the next gig or festival you're going to, the few after it,
 * and this year's count and spend. Reads the Drift: Record plugin's REST API.
 *
 * The API only hands out tokens for an email and password, so both are saved
 * (encrypted) like an IMAP password. The token it returns lasts 180 days from
 * its last use; it's kept and reused, and the card only signs in again when
 * the token is rejected (e.g. after a password reset) or the account changes.
 * The login route allows 10 tries per 15 minutes, so never sign in per check.
 */
const { request } = require('../http');

const SERVICE = 'Drift: Record';
const DEFAULT_API = 'https://record.driftcreativesystems.co.uk/wp-json/drift-record/v1/';
const NAMESPACE = '/wp-json/drift-record/v1/';
const DEVICE = 'Bonsai Dashboard';
const SHOW = 4; // Events listed under the headline one.

// Statuses that mean you're (still) going. Older rows may have none.
const GOING = ['planned', 'booked', ''];

/**
 * API base from Settings: the API address, the site address, or blank for
 * the Drift: Record site. Always ends in /wp-json/drift-record/v1/.
 */
function apiBase(raw) {
	let url;
	try {
		url = new URL(String(raw || '').trim() || DEFAULT_API);
	} catch {
		throw new Error('Add a valid address in Settings, e.g. https://record.driftcreativesystems.co.uk');
	}
	if ('https:' !== url.protocol && !['localhost', '127.0.0.1'].includes(url.hostname)) {
		throw new Error('The Drift: Record address must use https://');
	}
	const at = url.pathname.indexOf('/wp-json/');
	const site = (at >= 0 ? url.pathname.slice(0, at) : url.pathname).replace(/\/+$/, '');
	return { api: `${url.origin}${site}${NAMESPACE}`, app: `${url.origin}${site}/` };
}

/** The server's own message (WP_Error), when it sent one. */
function serverMessage(err) {
	return err && err.body && 'object' === typeof err.body && err.body.message ? String(err.body.message) : '';
}

async function signIn(api, email, password) {
	try {
		const { data } = await request(`${api}auth/login`, {
			method: 'POST',
			body: { email, password, device: DEVICE },
			service: SERVICE,
		});
		if (!data || !data.token) {
			throw new Error('Drift: Record didn\'t send back a sign-in. Try again shortly.');
		}
		return data;
	} catch (err) {
		if (401 === err.status) {
			throw new Error('That email and password don\'t match a Drift: Record account. Check them in Settings.');
		}
		if (404 === err.status) {
			throw new Error('Drift: Record API not found. Check the address in Settings.');
		}
		if (429 === err.status) {
			throw new Error(serverMessage(err) || 'Too many sign-in attempts. It will retry shortly.');
		}
		throw err;
	}
}

function authHeaders(token) {
	// Some hosts strip Authorization; the plugin also reads its own header.
	return { Authorization: `Bearer ${token}`, 'X-Drift-Record-Token': token };
}

/** Local date as YYYY-MM-DD, to compare with the app's date fields. */
function localDay(d = new Date()) {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const text = (v) => String(v || '').trim();
const num = (v) => parseFloat(v) || 0;

/** Only the fields the card shows. Festivals run start_date → end_date. */
function shape(item) {
	const d = (item && item.data) || {};
	const festival = 'festival' === d.event_type;
	const train = text(d.train_class);
	return {
		id: item.id,
		name: text(d.event_name) || 'Untitled event',
		date: text(festival ? d.start_date || d.date : d.date),
		endDate: festival ? text(d.end_date) : '',
		doors: text(d.door_time),
		city: text(d.city),
		venue: text(d.venue),
		type: text(d.event_type),
		status: text(d.status),
		train: train && 'none' !== train ? { first: 'first' === train, depart: text(d.train_depart_time), back: text(d.train_return_time) } : null,
		hotel: text(d.hotel_location),
		cost: num(d.total_cost) || num(d.ticket_cost) + num(d.travel_cost) + num(d.hotel_cost),
	};
}

module.exports = {
	id: 'driftrecord',
	name: 'Drift: Record',
	section: 'now',
	interval: 15 * 60 * 1000,
	oauth: false,
	help: 'Use the email and password you sign in to the Drift: Record app with. Leave the address blank for record.driftcreativesystems.co.uk.',
	fields: [
		{ key: 'email', label: 'Email address', type: 'text', required: true },
		{ key: 'password', label: 'Password', type: 'password', secret: true, required: true },
		{ key: 'site', label: 'Drift: Record address', type: 'text', placeholder: 'https://record.driftcreativesystems.co.uk', advanced: true },
	],

	async fetch(account, ctx) {
		const email = text(account.config.email).toLowerCase();
		const { password, token: saved, token_for: savedFor } = ctx.secrets();
		if (!email || !password) {
			throw new Error('Add your Drift: Record email and password in Settings.');
		}
		const { api, app } = apiBase(account.config.site);
		const owner = `${api}|${email}`;

		// A token saved for a different site or email belongs to someone else.
		let token = saved && savedFor === owner ? saved : null;
		let fresh = false;
		if (!token) {
			token = (await signIn(api, email, password)).token;
			fresh = true;
			ctx.saveSecrets({ token, token_for: owner });
		}

		let response;
		try {
			response = await request(`${api}items/events`, { headers: authHeaders(token), service: SERVICE });
		} catch (err) {
			if (401 !== err.status || fresh) {
				throw err;
			}
			// Token revoked or expired: sign in once more and retry.
			ctx.saveSecrets({ token: null, token_for: null });
			token = (await signIn(api, email, password)).token;
			ctx.saveSecrets({ token, token_for: owner });
			response = await request(`${api}items/events`, { headers: authHeaders(token), service: SERVICE });
		}

		const events = (Array.isArray(response.data) ? response.data : []).map(shape);
		const today = localDay();
		const year = String(new Date().getFullYear());

		// Still to come (or a festival that's on now), soonest first.
		const upcoming = events
			.filter((e) => e.date && GOING.includes(e.status) && (e.endDate || e.date) >= today)
			.sort((a, b) => a.date.localeCompare(b.date) || a.doors.localeCompare(b.doors));

		// Same figures as the app's dashboard: every event dated this year.
		const thisYear = events.filter((e) => e.date.startsWith(year));

		return {
			email,
			url: app,
			next: upcoming[0] || null,
			later: upcoming.slice(1, 1 + SHOW),
			upcomingCount: upcoming.length,
			year: { year, count: thisYear.length, spend: thisYear.reduce((sum, e) => sum + e.cost, 0) },
		};
	},
};
