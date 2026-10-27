/**
 * Finds a video-meeting link (Google Meet, Zoom, Teams, Webex, Whereby…)
 * in an event's fields: location, description, conference data. Returns
 * the first https link that looks like a meeting, or null.
 */
const PATTERNS = [
	/https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}\b[^\s<>"')\]]*/i,
	/https:\/\/(?:[\w-]+\.)*zoom\.us\/(?:j|my|w|s)\/[^\s<>"')\]]+/i,
	/https:\/\/teams\.microsoft\.com\/l\/meetup-join\/[^\s<>"')\]]+/i,
	/https:\/\/teams\.live\.com\/meet\/[^\s<>"')\]]+/i,
	/https:\/\/(?:[\w-]+\.)*webex\.com\/(?:meet|join|[\w-]+\/j\.php)[^\s<>"')\]]*/i,
	/https:\/\/whereby\.com\/[^\s<>"')\]]+/i,
	/https:\/\/(?:[\w-]+\.)*gotomeeting\.com\/join\/[^\s<>"')\]]+/i,
	/https:\/\/app\.slack\.com\/huddle\/[^\s<>"')\]]+/i,
];

/**
 * @param {...*} fields  Strings (or anything; non-strings are ignored).
 */
function find(...fields) {
	for (const pattern of PATTERNS) {
		for (const field of fields) {
			if ('string' !== typeof field || !field) {
				continue;
			}
			// Descriptions are often HTML; links can be inside href="…" or escaped.
			const text = field.replace(/&amp;/g, '&');
			const m = pattern.exec(text);
			if (m) {
				return m[0].replace(/[.,;]+$/, '');
			}
		}
	}
	return null;
}

module.exports = { find };
