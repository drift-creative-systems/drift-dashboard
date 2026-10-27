/**
 * Google Calendar through Google's Calendar API, so events keep the colour
 * you gave them in Google Calendar (the secret iCal address doesn't include
 * colours). Read-only scope. Events go into Up next, like iCal calendars.
 *
 * Sign-in: Authorization Code + PKCE with a "Desktop app" OAuth client from
 * Google Cloud. Google still wants that client's secret on the token call;
 * for desktop apps it isn't treated as confidential, but it's stored
 * encrypted anyway.
 */
const oauth = require('../oauth');
const { request, HttpError } = require('../http');
const meetings = require('../meetings');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/calendar/v3';
const SCOPES = 'https://www.googleapis.com/auth/calendar.readonly';
const SERVICE = 'Google Calendar';
const DAYS_AHEAD = 14;
const MAX_EVENTS = 12;
const MAX_CALENDARS = 10;

/**
 * Event colours as Google Calendar shows them (colorId → hex). The API's
 * /colors list still returns the older, paler shades, so it isn't used.
 */
const EVENT_COLOURS = {
	1: '#7986cb', // Lavender
	2: '#33b679', // Sage
	3: '#8e24aa', // Grape
	4: '#e67c73', // Flamingo
	5: '#f6bf26', // Banana
	6: '#f4511e', // Tangerine
	7: '#039be5', // Peacock
	8: '#616161', // Graphite
	9: '#3f51b5', // Blueberry
	10: '#0b8043', // Basil
	11: '#d50000', // Tomato
};

/**
 * Calendar colours: the API returns the old palette for the standard
 * choices, so map those to what Google Calendar shows today. Custom
 * colours come through as they are.
 */
const CALENDAR_COLOURS = {
	'#ac725e': '#795548', '#d06b64': '#e67c73', '#f83a22': '#d50000', '#fa573c': '#f4511e',
	'#ff7537': '#ef6c00', '#ffad46': '#f09300', '#42d692': '#009688', '#16a765': '#0b8043',
	'#7bd148': '#7cb342', '#b3dc6c': '#c0ca33', '#fbe983': '#e4c441', '#fad165': '#f6bf26',
	'#92e1c0': '#33b679', '#9fe1e7': '#039be5', '#9fc6e7': '#4285f4', '#4986e7': '#3f51b5',
	'#9a9cff': '#7986cb', '#b99aff': '#b39ddb', '#c2c2c2': '#616161', '#cabdbf': '#a79b8e',
	'#cca6ac': '#ad1457', '#f691b2': '#d81b60', '#cd74e6': '#8e24aa', '#a47ae2': '#9e69af',
};

function calendarColour(hex) {
	const key = String(hex || '').toLowerCase();
	if (!/^#[0-9a-f]{6}$/.test(key)) {
		return null;
	}
	return CALENDAR_COLOURS[key] || key;
}

/**
 * Google's start/end: { dateTime } for timed events, { date: 'YYYY-MM-DD' }
 * for all-day ones (local midnight, like the iCal calendars).
 */
function when(value) {
	if (!value) {
		return null;
	}
	if (value.dateTime) {
		return new Date(value.dateTime).toISOString();
	}
	const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(value.date || '');
	return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toISOString() : null;
}

/** The video call to join: Google's own conference link, else one in the location or notes. */
function meetingLink(ev) {
	const video = ((ev.conferenceData && ev.conferenceData.entryPoints) || [])
		.find((p) => 'video' === p.entryPointType && /^https:\/\//i.test(p.uri || ''));
	if (video) {
		return video.uri;
	}
	if (/^https:\/\//i.test(ev.hangoutLink || '')) {
		return ev.hangoutLink;
	}
	return meetings.find(ev.location, ev.description);
}

async function accessToken(account, ctx) {
	const secrets = ctx.secrets();
	if (!secrets.refresh_token) {
		throw new Error('Not connected yet. Open Settings and click Connect.');
	}
	if (!oauth.expired(secrets)) {
		return secrets.access_token;
	}
	try {
		const data = await oauth.token(TOKEN_URL, {
			grant_type: 'refresh_token',
			refresh_token: secrets.refresh_token,
			client_id: account.config.client_id,
			client_secret: secrets.client_secret || '',
		}, SERVICE);
		ctx.saveSecrets(oauth.tokenSecrets(data));
		return data.access_token;
	} catch (err) {
		if (err instanceof HttpError && err.body && 'invalid_grant' === err.body.error) {
			throw new Error('Google sign-in has expired. Click Reconnect in Settings. If this keeps happening every week, set the Google Cloud app to "In production" (see the setup guide).');
		}
		throw err;
	}
}

module.exports = {
	id: 'gcal',
	name: 'Google Calendar (sign-in, with colours)',
	section: 'calendar',
	interval: 5 * 60 * 1000,
	oauth: true,
	guide: 'Google Calendar with event colours',
	help: 'Shows events in the colours you gave them. Needs a free Google Cloud OAuth client (Desktop app). Redirect: http://127.0.0.1:8890/callback is allowed automatically.',
	fields: [
		{ key: 'client_id', label: 'OAuth client ID', type: 'text', required: true, notUrl: true, placeholder: '…apps.googleusercontent.com' },
		{ key: 'client_secret', label: 'OAuth client secret', type: 'password', secret: true, required: true },
		{ key: 'all_calendars', label: 'Also include the other calendars ticked in Google Calendar', type: 'checkbox', default: false },
	],

	async connect(account, ctx) {
		const { client_secret: secret } = ctx.secrets();
		if (!account.config.client_id || !secret) {
			throw new Error('Add the OAuth client ID and secret first, then Save.');
		}
		const { verifier, challenge } = oauth.pkce();
		const { code, redirectUri } = await oauth.authorize(AUTH_URL, {
			client_id: account.config.client_id,
			response_type: 'code',
			scope: SCOPES,
			access_type: 'offline',
			// "consent" makes Google send a refresh token every time, not just the first.
			prompt: 'select_account consent',
			code_challenge_method: 'S256',
			code_challenge: challenge,
		});
		const data = await oauth.token(TOKEN_URL, {
			grant_type: 'authorization_code',
			code,
			redirect_uri: redirectUri,
			client_id: account.config.client_id,
			client_secret: secret,
			code_verifier: verifier,
		}, SERVICE);
		ctx.saveSecrets(oauth.tokenSecrets(data));
	},

	async fetch(account, ctx) {
		const token = await accessToken(account, ctx);
		const headers = { Authorization: `Bearer ${token}` };
		const get = (path) => request(`${API}${path}`, { headers, service: SERVICE }).then((r) => r.data);

		// Which calendars, and their colours. Cached: they rarely change.
		const list = await ctx.cached('calendars', 30 * 60000, () => get(
			'/users/me/calendarList?minAccessRole=reader&fields=items(id,summary,summaryOverride,backgroundColor,selected,primary,hidden)'
		));
		const items = (list && list.items) || [];
		const primary = items.find((c) => c.primary) || { id: 'primary', summary: '' };
		const email = primary.id && primary.id.includes('@') ? primary.id : '';
		const calendars = account.config.all_calendars
			? [primary, ...items.filter((c) => !c.primary && c.selected && !c.hidden)].slice(0, MAX_CALENDARS)
			: [primary];

		const now = new Date();
		const until = new Date(now.getTime() + DAYS_AHEAD * 86400000);
		const query = new URLSearchParams({
			timeMin: now.toISOString(),
			timeMax: until.toISOString(),
			singleEvents: 'true',
			orderBy: 'startTime',
			maxResults: String(MAX_EVENTS),
			fields: 'items(summary,description,start,end,location,htmlLink,hangoutLink,conferenceData(entryPoints(entryPointType,uri)),colorId,status,eventType,attendees(self,responseStatus))',
		});

		const results = await Promise.all(calendars.map((cal) => get(`/calendars/${encodeURIComponent(cal.id)}/events?${query}`)
			.then((data) => ({ cal, events: (data && data.items) || [] }))));

		const events = [];
		for (const { cal, events: calEvents } of results) {
			const calColour = calendarColour(cal.backgroundColor);
			const calName = cal.primary ? '' : (cal.summaryOverride || cal.summary || '');
			for (const ev of calEvents) {
				const me = (ev.attendees || []).find((a) => a.self);
				// Skip cancelled and declined events, and Google's "working from" markers.
				if ('cancelled' === ev.status || (me && 'declined' === me.responseStatus) || 'workingLocation' === ev.eventType) {
					continue;
				}
				const start = when(ev.start);
				if (!start) {
					continue;
				}
				// Opening the event as the right Google account matters with several signed in.
				let url = ev.htmlLink || 'https://calendar.google.com/';
				if (email && ev.htmlLink) {
					url += `${url.includes('?') ? '&' : '?'}authuser=${encodeURIComponent(email)}`;
				}
				events.push({
					title: ev.summary || '(no title)',
					start,
					end: when(ev.end) || start,
					allDay: Boolean(ev.start && ev.start.date),
					location: ev.location || '',
					url,
					meetingUrl: meetingLink(ev),
					colour: EVENT_COLOURS[ev.colorId] || null,
					calendarColour: calColour,
					calendar: calName,
				});
			}
		}

		events.sort((a, b) => a.start.localeCompare(b.start));
		return { email, events: events.slice(0, MAX_EVENTS) };
	},
};
