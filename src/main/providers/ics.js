/**
 * Calendar from a secret iCal (ICS) address: Google Calendar, Outlook
 * published calendars, Proton Calendar share links. No sign-in needed;
 * the URL itself is the secret, so it's stored encrypted.
 */
const ical = require('node-ical');
const { request } = require('../http');

const DAYS_AHEAD = 14;
const MAX_EVENTS = 5;

function text(value) {
	if (value && typeof value === 'object' && 'val' in value) {
		return String(value.val);
	}
	return value ? String(value) : '';
}

module.exports = {
	id: 'ics',
	name: 'Calendar (iCal link)',
	section: 'calendar',
	interval: 10 * 60 * 1000,
	oauth: false,
	help: 'Google: Calendar settings → your calendar → "Secret address in iCal format".',
	fields: [
		{ key: 'url', label: 'Secret iCal address', type: 'password', secret: true, required: true },
		{ key: 'open_url', label: 'Link to open (optional)', type: 'text', placeholder: 'https://calendar.google.com/', advanced: true },
	],

	async fetch(account, ctx) {
		const { url } = ctx.secrets();
		if (!url) {
			throw new Error('Add the secret iCal address in Settings.');
		}
		// Google shows these as webcal:// sometimes.
		const httpsUrl = url.replace(/^webcal:\/\//i, 'https://');
		if (!/^https:\/\//i.test(httpsUrl)) {
			throw new Error('The iCal address must start with https://');
		}

		const { data } = await request(httpsUrl, {
			headers: { Accept: 'text/calendar' },
			service: 'Calendar',
			timeout: 30000,
		});
		if (typeof data !== 'string' || !data.includes('BEGIN:VCALENDAR')) {
			throw new Error('That link didn’t return a calendar. Check it’s the secret iCal address.');
		}

		const parsed = ical.sync.parseICS(data);
		const from = new Date();
		const to = new Date(from.getTime() + DAYS_AHEAD * 86400000);
		const openUrl = account.config.open_url || 'https://calendar.google.com/';
		const events = [];

		for (const item of Object.values(parsed)) {
			if (!item || 'VEVENT' !== item.type || 'CANCELLED' === item.status) {
				continue;
			}
			// Overrides of recurring events are applied by their base event.
			if (item.recurrenceid) {
				continue;
			}
			let instances;
			try {
				instances = ical.expandRecurringEvent(item, { from, to, expandOngoing: true });
			} catch (err) {
				console.error('[ics] Skipped an event that could not be expanded:', err.message);
				continue;
			}
			for (const inst of instances) {
				const end = inst.end || inst.start;
				if (end < from) {
					continue;
				}
				events.push({
					title: text(inst.summary) || '(no title)',
					start: inst.start.toISOString(),
					end: end.toISOString(),
					allDay: Boolean(inst.isFullDay),
					location: text(inst.event && inst.event.location),
					url: openUrl,
				});
			}
		}

		events.sort((a, b) => a.start.localeCompare(b.start));
		return { events: events.slice(0, MAX_EVENTS) };
	},
};
