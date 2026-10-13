/**
 * Outlook / Microsoft 365 via Microsoft Graph: latest inbox messages,
 * unread count and the next calendar events. Read-only scopes.
 * Sign-in: Authorization Code + PKCE as a public desktop client.
 */
const oauth = require('../oauth');
const { request } = require('../http');

const TENANT = 'common'; // Personal and work/school accounts.
const AUTH_URL = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`;
const TOKEN_URL = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`;
const GRAPH = 'https://graph.microsoft.com/v1.0';
const SCOPES = 'offline_access User.Read Mail.Read Calendars.Read';
const SERVICE = 'Microsoft';
const CALENDAR_DAYS = 14;

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
		scope: SCOPES,
	}, SERVICE);
	ctx.saveSecrets(oauth.tokenSecrets(data));
	return data.access_token;
}

/**
 * Graph returns calendar times without a zone when Prefer: UTC is set.
 */
function utc(dateTime) {
	return dateTime ? new Date(/Z$|[+-]\d\d:\d\d$/.test(dateTime) ? dateTime : `${dateTime}Z`).toISOString() : null;
}

module.exports = {
	id: 'outlook',
	name: 'Outlook',
	section: 'email',
	interval: 2 * 60 * 1000,
	oauth: true,
	help: 'Needs an Azure app registration (free). Redirect URI: http://localhost:8890/callback',
	fields: [
		{ key: 'client_id', label: 'Application (client) ID', type: 'text', required: true, notUrl: true },
		{ key: 'show_calendar', label: 'Show this calendar in Up next', type: 'checkbox', default: true },
		{ key: 'unread_only', label: 'Only show unread emails', type: 'checkbox', default: true },
	],

	async connect(account, ctx) {
		if (!account.config.client_id) {
			throw new Error('Add the Application (client) ID first, then Save.');
		}
		const { verifier, challenge } = oauth.pkce();
		const { code, redirectUri } = await oauth.authorize(AUTH_URL, {
			client_id: account.config.client_id,
			response_type: 'code',
			response_mode: 'query',
			scope: SCOPES,
			prompt: 'select_account',
			code_challenge_method: 'S256',
			code_challenge: challenge,
		}, 'localhost');
		const data = await oauth.token(TOKEN_URL, {
			grant_type: 'authorization_code',
			code,
			redirect_uri: redirectUri,
			client_id: account.config.client_id,
			code_verifier: verifier,
			scope: SCOPES,
		}, SERVICE);
		ctx.saveSecrets(oauth.tokenSecrets(data));
	},

	async fetch(account, ctx) {
		const token = await accessToken(account, ctx);
		const headers = { Authorization: `Bearer ${token}`, Prefer: 'outlook.timezone="UTC"' };
		const get = (path) => request(`${GRAPH}${path}`, { headers, service: SERVICE }).then((r) => r.data);

		const now = new Date();
		const until = new Date(now.getTime() + CALENDAR_DAYS * 86400000);
		const wantCalendar = account.config.show_calendar !== false;
		const unreadOnly = account.config.unread_only !== false;
		// Graph only allows $orderby with $filter when the sorted field is
		// filtered on first, hence the always-true date condition.
		const filter = unreadOnly ? '&$filter=receivedDateTime ge 1900-01-01T00:00:00Z and isRead eq false' : '';

		const [me, inbox, messages, events] = await Promise.all([
			ctx.cached('me', 3600000, () => get('/me?$select=mail,userPrincipalName')),
			get('/me/mailFolders/inbox?$select=unreadItemCount'),
			get(`/me/mailFolders/inbox/messages?$top=3${filter}&$orderby=receivedDateTime desc&$select=subject,from,receivedDateTime,isRead,webLink`),
			wantCalendar
				? get(`/me/calendarView?startDateTime=${now.toISOString()}&endDateTime=${until.toISOString()}&$orderby=start/dateTime&$top=5&$select=subject,start,end,location,isAllDay,webLink,isCancelled`)
				: Promise.resolve({ value: [] }),
		]);

		const email = me.mail || me.userPrincipalName || '';
		const personal = /@(outlook|hotmail|live|msn)\./i.test(email);

		return {
			email,
			unread: inbox.unreadItemCount || 0,
			unreadOnly,
			url: personal ? 'https://outlook.live.com/mail/' : 'https://outlook.office.com/mail/',
			messages: (messages.value || []).map((m) => ({
				from: (m.from && m.from.emailAddress && (m.from.emailAddress.name || m.from.emailAddress.address)) || 'Unknown sender',
				subject: m.subject || '(no subject)',
				date: m.receivedDateTime,
				unread: !m.isRead,
				url: m.webLink,
			})),
			events: (events.value || [])
				.filter((e) => !e.isCancelled)
				.map((e) => ({
					title: e.subject || '(no title)',
					start: utc(e.start && e.start.dateTime),
					end: utc(e.end && e.end.dateTime),
					allDay: Boolean(e.isAllDay),
					location: (e.location && e.location.displayName) || '',
					url: e.webLink,
				})),
		};
	},
};
