/**
 * Bonsai Uptime Monitor: sites down, SSL/domain expiring, recent incidents.
 * Reads the monitor's read-only api.php with the key from its Settings page.
 */
const { request } = require('../http');

const SERVICE = 'Uptime monitor';

function apiUrl(raw) {
	let url;
	try {
		url = new URL(String(raw || '').trim());
	} catch {
		throw new Error('Add the monitor address in Settings, e.g. https://status.example.co.uk/api.php');
	}
	if ('https:' !== url.protocol && !['localhost', '127.0.0.1'].includes(url.hostname)) {
		throw new Error('The monitor address must use https://');
	}
	// Accept the monitor's home page address as well as the api.php one.
	if (!url.pathname.endsWith('/api.php')) {
		url.pathname = `${url.pathname.replace(/\/+$/, '')}/api.php`;
	}
	url.search = '';
	return url;
}

module.exports = {
	id: 'uptime',
	name: 'Uptime monitor',
	section: 'tickets',
	interval: 2 * 60 * 1000,
	oauth: false,
	help: 'Monitor → Manage sites → Settings → Dashboard API → Create key.',
	fields: [
		{ key: 'url', label: 'Monitor address', type: 'text', placeholder: 'https://status.bonsaidigitalcollective.co.uk/', required: true },
		{ key: 'api_key', label: 'Dashboard API key', type: 'password', secret: true, required: true },
	],

	async fetch(account, ctx) {
		const { api_key: key } = ctx.secrets();
		if (!key) {
			throw new Error('Add the Dashboard API key in Settings.');
		}
		const url = apiUrl(account.config.url);

		let response;
		try {
			response = await request(url.toString(), {
				// Some hosts strip Authorization before PHP sees it, so send both.
				headers: { Authorization: `Bearer ${key}`, 'X-Api-Key': key },
				service: SERVICE,
			});
		} catch (err) {
			if (404 === err.status) {
				throw new Error('Dashboard API not found. Deploy the monitor update and create a key under Settings → Dashboard API.');
			}
			if (401 === err.status) {
				throw new Error('The monitor rejected the key. Create a new one under Settings → Dashboard API and paste it here.');
			}
			throw err;
		}

		const d = response.data || {};
		return {
			total: d.total || 0,
			up: d.up || 0,
			down: d.down || 0,
			unknown: d.unknown || 0,
			sitesDown: Array.isArray(d.sites_down) ? d.sites_down : [],
			expiring: Array.isArray(d.expiring) ? d.expiring : [],
			recent: Array.isArray(d.recent_incidents) ? d.recent_incidents : [],
			lastCheckAt: d.last_check_at || null,
			url: new URL('./', url).toString(),
		};
	},
};
