/**
 * Every card type the dashboard knows about, in Settings order.
 */
const imap = require('./imap');

const providers = [
	imap.gmail,
	require('./outlook'),
	imap.proton,
	require('./ics'),
	require('./slack'),
	require('./clickup'),
	require('./tickets'),
	require('./uptime'),
	require('./github'),
	require('./freeagent'),
	require('./spotify'),
	require('./strava'),
	require('./xbox'),
	require('./weather'),
];

const byId = Object.fromEntries(providers.map((p) => [p.id, p]));

/**
 * Appearance options every card gets, under Settings → Edit → Appearance.
 * Blank means the default: the service's logo and colour.
 */
const APPEARANCE_FIELDS = [
	{ key: 'icon', label: 'Icon: an emoji or up to 2 letters', type: 'text', placeholder: 'e.g. 🏠 or GD', maxGraphemes: 2, appearance: true },
	{ key: 'icon_color', label: 'Icon colour', type: 'color', appearance: true },
];

/**
 * A provider's own fields plus the shared appearance ones.
 */
function fieldsFor(provider) {
	return [...provider.fields, ...APPEARANCE_FIELDS];
}

/**
 * What the settings screen needs to build its forms (no functions).
 */
function describe() {
	return providers.map((p) => ({ id: p.id, name: p.name, section: p.section, oauth: p.oauth, help: p.help, fields: fieldsFor(p) }));
}

module.exports = { providers, get: (id) => byId[id] || null, describe, fieldsFor };
