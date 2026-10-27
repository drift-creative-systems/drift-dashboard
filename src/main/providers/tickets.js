/**
 * Support Desk tickets (bonsai-support-tickets plugin) from one WordPress
 * site, via its read-only /bst/v1/dashboard/summary endpoint. Authenticated
 * with a WordPress Application Password over HTTPS.
 */
const { request } = require('../http');

const SERVICE = 'Support site';

function siteUrl(raw) {
	let url;
	try {
		url = new URL(String(raw || '').trim());
	} catch {
		throw new Error('Add a valid site address in Settings, e.g. https://support.example.co.uk');
	}
	// Basic auth over plain HTTP would leak the password; only allow it locally.
	if ('https:' !== url.protocol && !['localhost', '127.0.0.1'].includes(url.hostname)) {
		throw new Error('The support site must use https://');
	}
	return url.origin + url.pathname.replace(/\/+$/, '');
}

module.exports = {
	id: 'tickets',
	name: 'Support tickets',
	section: 'tickets',
	interval: 2 * 60 * 1000,
	oauth: false,
	help: 'WordPress → Users → Profile → Application Passwords → add "Drift Dashboard".',
	fields: [
		{ key: 'site', label: 'Site address', type: 'text', placeholder: 'https://support.example.co.uk', required: true },
		{ key: 'username', label: 'WordPress username', type: 'text', required: true },
		{ key: 'app_password', label: 'Application password', type: 'password', secret: true, required: true },
	],

	async fetch(account, ctx) {
		const { app_password: password } = ctx.secrets();
		if (!account.config.username || !password) {
			throw new Error('Add the username and application password in Settings.');
		}
		const site = siteUrl(account.config.site);
		const auth = Buffer.from(`${account.config.username}:${password.replace(/\s+/g, '')}`).toString('base64');

		let response;
		try {
			response = await request(`${site}/wp-json/bst/v1/dashboard/summary`, {
				headers: { Authorization: `Basic ${auth}` },
				service: SERVICE,
			});
		} catch (err) {
			if (404 === err.status) {
				throw new Error('Endpoint not found. Update the Support Desk plugin on this site to the version with the dashboard API.');
			}
			throw err;
		}

		const data = response.data || {};
		return {
			site: data.site || new URL(site).hostname,
			total: data.active_total || 0,
			counts: data.counts || {},
			mine: data.mine || 0,
			unassigned: data.unassigned || 0,
			slaMissed: data.sla_missed,
			latest: Array.isArray(data.latest) ? data.latest : [],
			url: data.list_url || `${site}/wp-admin/`,
		};
	},
};
