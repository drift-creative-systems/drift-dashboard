/**
 * Setup guides shown in Settings, taken straight from README.md so there's
 * only one copy to keep up to date. Each provider names its README heading
 * (`guide: 'Gmail inboxes'`); the text under that "### " heading, up to the
 * next heading of the same or higher level, is its guide.
 *
 * The window renders it as plain text with a little formatting (see
 * renderer/js/guide.js), never as HTML.
 */
const fs = require('fs');
const path = require('path');

const README = path.join(__dirname, '..', '..', 'README.md');

let sections = null;

function load() {
	if (sections) {
		return sections;
	}
	sections = new Map();
	let text = '';
	try {
		text = fs.readFileSync(README, 'utf8');
	} catch (err) {
		console.error('[guides] README.md not found, so Settings has no setup guides:', err.message);
		return sections;
	}

	let title = null;
	let body = [];
	let fenced = false;
	const flush = () => {
		if (title) {
			sections.set(title.toLowerCase(), body.join('\n').trim());
		}
	};
	for (const line of text.split(/\r?\n/)) {
		// A "#" inside a code block isn't a heading.
		if (/^\s*```/.test(line)) {
			fenced = !fenced;
		}
		const heading = !fenced && /^(#{1,3}) (.+)$/.exec(line);
		if (heading) {
			flush();
			title = 3 === heading[1].length ? heading[2].trim() : null;
			body = [];
		} else if (title) {
			body.push(line);
		}
	}
	flush();
	return sections;
}

/**
 * The guide under the README heading that starts with `heading`
 * (case-insensitive), or '' if there isn't one.
 */
function get(heading) {
	if (!heading) {
		return '';
	}
	const want = String(heading).toLowerCase();
	for (const [title, body] of load()) {
		if (title === want || title.startsWith(`${want} `) || title.startsWith(`${want}(`)) {
			return body;
		}
	}
	return '';
}

module.exports = { get };
