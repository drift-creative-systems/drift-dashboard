/**
 * FreeAgent: bank balances, overdue and soon-due invoices, bills due this
 * week and upcoming tax deadlines.
 * Sign-in: OAuth 2 with the app's client ID + secret (sent as HTTP Basic).
 * FreeAgent has no read-only scope; this card only ever makes GET requests.
 */
const oauth = require('../oauth');
const { request } = require('../http');

const AUTH_URL = 'https://api.freeagent.com/v2/approve_app';
const TOKEN_URL = 'https://api.freeagent.com/v2/token_endpoint';
const API = 'https://api.freeagent.com/v2';
const SERVICE = 'FreeAgent';
const DUE_SOON_DAYS = 14;
const TAX_SHOW = 4;
const SHOW = 5;

function basic(account, secrets) {
	return { Authorization: `Basic ${Buffer.from(`${account.config.client_id}:${secrets.client_secret}`).toString('base64')}` };
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
	}, SERVICE, basic(account, secrets));
	ctx.saveSecrets(oauth.tokenSecrets(data));
	return data.access_token;
}

function today() {
	const d = new Date();
	d.setHours(0, 0, 0, 0);
	return d;
}

function endOfWeek() {
	const d = today();
	d.setDate(d.getDate() + (6 - ((d.getDay() + 6) % 7)));
	d.setHours(23, 59, 59, 999);
	return d;
}

/** "2026-10-20" → Date at local midnight. */
function day(value) {
	return value ? new Date(`${value}T00:00:00`) : null;
}

/** Last path segment of a FreeAgent API URL (its ID). */
function idFrom(url) {
	return String(url || '').split('/').pop();
}

module.exports = {
	id: 'freeagent',
	name: 'FreeAgent',
	section: 'money',
	interval: 15 * 60 * 1000,
	oauth: true,
	help: 'Needs a free app at dev.freeagent.com. Redirect URI: http://localhost:8890/callback',
	fields: [
		{ key: 'client_id', label: 'OAuth identifier', type: 'text', required: true, notUrl: true },
		{ key: 'client_secret', label: 'OAuth secret', type: 'password', secret: true, required: true, notUrl: true },
	],

	async connect(account, ctx) {
		const secrets = ctx.secrets();
		if (!account.config.client_id || !secrets.client_secret) {
			throw new Error('Add the OAuth identifier and secret first, then Save.');
		}
		const { code, redirectUri } = await oauth.authorize(AUTH_URL, {
			client_id: account.config.client_id,
			response_type: 'code',
		}, 'localhost');
		const data = await oauth.token(TOKEN_URL, {
			grant_type: 'authorization_code',
			code,
			redirect_uri: redirectUri,
		}, SERVICE, basic(account, secrets));
		ctx.saveSecrets(oauth.tokenSecrets(data));
	},

	async fetch(account, ctx) {
		const token = await accessToken(account, ctx);
		const headers = { Authorization: `Bearer ${token}` };
		const get = (path) => request(path.startsWith('http') ? path : `${API}${path}`, { headers, service: SERVICE }).then((r) => r.data || {});

		const [{ company }, { bank_accounts: banks = [] }, { invoices: overdue = [] }, { invoices: open = [] }, { bills = [] }, timeline] = await Promise.all([
			ctx.cached('company', 6 * 3600000, () => get('/company')),
			get('/bank_accounts'),
			get('/invoices?view=overdue&per_page=50'),
			get('/invoices?view=open&per_page=100'),
			// "open" excludes overdue bills; those should show too.
			get('/bills?view=open_or_overdue&per_page=100'),
			ctx.cached('tax', 6 * 3600000, () => get('/company/tax_timeline').catch(() => ({ timeline_items: [] }))),
		]);

		const web = company && company.subdomain ? `https://${company.subdomain}.freeagent.com` : 'https://login.freeagent.com';
		const currency = (company && company.currency) || 'GBP';

		// Contact names, cached: invoices and bills only carry the contact's API URL.
		const contactName = async (inv) => {
			if (inv.contact_name) {
				return inv.contact_name;
			}
			if (!inv.contact) {
				return '';
			}
			try {
				const { contact: c } = await ctx.cached(`contact:${inv.contact}`, 24 * 3600000, () => get(inv.contact));
				return c.organisation_name || [c.first_name, c.last_name].filter(Boolean).join(' ');
			} catch {
				return '';
			}
		};

		const invoiceRow = async (inv) => ({
			ref: inv.reference,
			contact: await contactName(inv),
			amount: Number(inv.due_value ?? inv.total_value ?? 0),
			currency: inv.currency || currency,
			due: inv.due_on,
			url: `${web}/invoices/${idFrom(inv.url)}`,
		});

		const now = today();
		const soonLimit = new Date(now.getTime() + DUE_SOON_DAYS * 86400000);
		const dueSoon = open.filter((inv) => {
			const due = day(inv.due_on);
			return due && due >= now && due <= soonLimit;
		});
		const weekEnd = endOfWeek();
		const billsDue = bills.filter((b) => {
			const due = day(b.due_on);
			return due && due <= weekEnd;
		});

		const overdueRows = await Promise.all(overdue.slice(0, SHOW).map(invoiceRow));
		const dueSoonRows = await Promise.all(dueSoon.sort((a, b) => a.due_on.localeCompare(b.due_on)).slice(0, SHOW).map(invoiceRow));
		const billRows = await Promise.all(billsDue.sort((a, b) => a.due_on.localeCompare(b.due_on)).slice(0, SHOW).map(async (b) => ({
			ref: b.reference,
			contact: await contactName(b),
			amount: Number(b.due_value ?? b.total_value ?? 0),
			currency: b.currency || currency,
			due: b.due_on,
			url: `${web}/bills/${idFrom(b.url)}`,
		})));

		const tax = ((timeline && timeline.timeline_items) || [])
			.filter((t) => day(t.dated_on) >= now)
			.sort((a, b) => a.dated_on.localeCompare(b.dated_on))
			.slice(0, TAX_SHOW)
			.map((t) => ({
				title: t.description,
				nature: t.nature,
				due: t.dated_on,
				amount: t.amount_due !== undefined && t.amount_due !== null ? Number(t.amount_due) : null,
				personal: Boolean(t.is_personal),
			}));

		const sum = (list) => list.reduce((n, x) => n + Number(x.due_value ?? x.total_value ?? 0), 0);

		return {
			company: (company && company.name) || '',
			currency,
			banks: banks
				.filter((b) => 'hidden' !== b.status)
				.map((b) => ({ name: b.name, balance: Number(b.current_balance || 0), currency: b.currency || currency })),
			overdueTotal: sum(overdue),
			overdueCount: overdue.length,
			overdue: overdueRows,
			dueSoonTotal: sum(dueSoon),
			dueSoon: dueSoonRows,
			billsTotal: sum(billsDue),
			bills: billRows,
			tax,
			url: web,
			taxUrl: `${web}/taxes`,
		};
	},
};
