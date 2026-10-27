/**
 * Every card type the dashboard knows about, in Settings order.
 */
const imap = require('./imap');
const guides = require('../guides');

const providers = [
	imap.gmail,
	require('./outlook'),
	imap.proton,
	require('./gcal'),
	require('./ics'),
	require('./slack'),
	require('./clickup'),
	require('./tickets'),
	require('./uptime'),
	require('./github'),
	require('./freeagent'),
	require('./spotify'),
	require('./plex'),
	require('./claude'),
	require('./strava'),
	require('./xbox'),
	require('./driftrecord'),
	require('./weather'),
];

const byId = Object.fromEntries(providers.map((p) => [p.id, p]));

/**
 * Appearance options every card gets, under Settings → Edit → Appearance.
 * Blank means the default: the service's logo and colour.
 */
const SHARED_FIELDS = [
	{ key: 'link_app', label: 'Open this card’s links with', type: 'app', advanced: true },
];

/**
 * README headings with each card type's setup steps (see guides.js), for
 * providers that don't name their own with `guide`.
 */
const GUIDES = {
	outlook: 'Outlook',
	ics: 'Google calendars',
	slack: 'Slack',
	clickup: 'ClickUp',
	tickets: 'Support tickets',
	uptime: 'Bonsai Uptime Monitor',
	github: 'GitHub',
	freeagent: 'FreeAgent',
	spotify: 'Spotify',
	plex: 'Plex',
	claude: 'Claude plan usage',
	strava: 'Strava',
	xbox: 'Xbox',
	driftrecord: 'Drift: Record',
	weather: 'Weather',
};

const APPEARANCE_FIELDS = [
	{ key: 'icon', label: 'Icon: an emoji or up to 2 letters', type: 'text', placeholder: 'e.g. 🏠 or GD', maxGraphemes: 2, appearance: true },
	{ key: 'icon_color', label: 'Icon colour', type: 'color', appearance: true },
];

/**
 * A provider's own fields plus the shared link and appearance ones.
 */
function fieldsFor(provider) {
	return [...provider.fields, ...SHARED_FIELDS, ...APPEARANCE_FIELDS];
}

/**
 * What the settings screen needs to build its forms (no functions).
 */
function describe() {
	return providers.map((p) => ({
		id: p.id,
		name: p.name,
		section: p.section,
		oauth: p.oauth,
		help: p.help,
		guide: guides.get(p.guide || GUIDES[p.id]),
		fields: fieldsFor(p),
	}));
}

module.exports = { providers, get: (id) => byId[id] || null, describe, fieldsFor };
