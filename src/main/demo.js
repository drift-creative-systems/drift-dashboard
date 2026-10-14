/**
 * Demo mode (`npm run demo`): sample accounts and data so the layout can be
 * previewed before anything is connected. Uses a throwaway settings folder,
 * so your real accounts are never touched.
 */
const MIN = 60000;
const HOUR = 60 * MIN;
const now = () => Date.now();
const iso = (offset) => new Date(now() + offset).toISOString();

const accounts = [
	{ id: 'demo-ics-1', provider: 'ics', label: 'Gak Design', config: {} },
	{ id: 'demo-ics-2', provider: 'ics', label: 'Personal', config: { icon: '🏠', icon_color: '#3fb97a' } },
	{ id: 'demo-spotify', provider: 'spotify', label: '', config: {} },
	{ id: 'demo-plex', provider: 'plex', label: '', config: {} },
	{ id: 'demo-claude', provider: 'claude', label: '', config: {} },
	{ id: 'demo-strava', provider: 'strava', label: '', config: {} },
	{ id: 'demo-xbox', provider: 'xbox', label: '', config: {} },
	{ id: 'demo-gmail-1', provider: 'gmail', label: 'Gak Design', config: {} },
	{ id: 'demo-gmail-2', provider: 'gmail', label: 'Bonsai', config: { icon: 'B', icon_color: '#4f9dff' } },
	{ id: 'demo-outlook', provider: 'outlook', label: 'Outlook', config: { show_calendar: true } },
	{ id: 'demo-proton', provider: 'proton', label: 'Proton', config: {} },
	{ id: 'demo-slack-1', provider: 'slack', label: 'Bonsai', config: {} },
	{ id: 'demo-slack-2', provider: 'slack', label: 'Realityhouse', config: {} },
	{ id: 'demo-clickup', provider: 'clickup', label: 'Bonsai ClickUp', config: {} },
	{ id: 'demo-tickets-1', provider: 'tickets', label: 'Bonsai support', config: {} },
	{ id: 'demo-tickets-2', provider: 'tickets', label: 'Drift support', config: {} },
	{ id: 'demo-weather', provider: 'weather', label: '', config: {} },
	{ id: 'demo-uptime', provider: 'uptime', label: 'Bonsai uptime', config: {} },
	{ id: 'demo-github-1', provider: 'github', label: 'Bonsai-Systems', config: {} },
	{ id: 'demo-github-2', provider: 'github', label: 'Gak Design', config: {} },
	{ id: 'demo-freeagent', provider: 'freeagent', label: '', config: {} },
];

const isoDay = (days) => {
	const d = new Date(now() + days * 24 * HOUR);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function hours() {
	const start = new Date();
	start.setMinutes(0, 0, 0);
	const codes = [2, 2, 3, 61, 63, 61, 3, 2];
	return codes.map((code, i) => {
		const t = new Date(start.getTime() + (i + 1) * HOUR);
		const local = `${isoDay(0)}T${String(t.getHours()).padStart(2, '0')}:00`;
		return { time: local, temp: 15 - i * 0.5, rain: [5, 10, 30, 70, 85, 60, 20, 10][i], code, day: t.getHours() < 19 };
	});
}

function mail(email, unread, rows) {
	// Mirrors the default "Only show unread emails" setting.
	return {
		email,
		unread,
		unreadOnly: true,
		url: 'https://mail.google.com/',
		messages: rows
			.filter((r) => r[3])
			.map(([from, subject, ago, isUnread]) => ({ from, subject, date: iso(-ago), unread: isUnread, url: 'https://mail.google.com/' })),
	};
}

function data(account) {
	switch (account.id) {
		case 'demo-ics-1':
			return { events: [
				{ title: 'Client call: homepage review', start: iso(25 * MIN), end: iso(85 * MIN), allDay: false, location: 'Google Meet', url: 'https://calendar.google.com/' },
				{ title: 'Sprint planning', start: iso(26 * HOUR), end: iso(27 * HOUR), allDay: false, location: '', url: 'https://calendar.google.com/' },
			] };
		case 'demo-ics-2':
			return { events: [
				{ title: 'Gym', start: iso(9 * HOUR), end: iso(10 * HOUR), allDay: false, location: 'PureGym', url: 'https://calendar.google.com/' },
			] };
		case 'demo-spotify':
			return { playing: true, progress: 95000, track: { title: 'Teardrop', artist: 'Massive Attack', album: 'Mezzanine', image: null, url: 'https://open.spotify.com/', duration: 330000 } };
		case 'demo-plex':
			return {
				count: 2, transcodes: 1, bandwidth: 14600, url: 'https://app.plex.tv/',
				streams: [
					{ kind: 'episode', title: 'Slow Horses', sub: 'S04E03 · Hello Goodbye', user: 'Ben', device: 'Living Room TV', state: 'playing', remote: false, transcoding: false, resolution: '1080', bandwidth: 10200, duration: 52 * MIN, offset: 31 * MIN, image: null },
					{ kind: 'movie', title: 'The Holdovers', sub: '2023', user: 'Lex', device: 'iPad', state: 'paused', remote: true, transcoding: true, resolution: '720', bandwidth: 4400, duration: 133 * MIN, offset: 22 * MIN, image: null },
				],
			};
		case 'demo-claude':
			return {
				plan: 'pro',
				limits: [
					{ name: 'Current session', percent: 64, resetsAt: iso(2 * HOUR + 40 * MIN), severity: 'normal' },
					{ name: 'Weekly · all models', percent: 81, resetsAt: iso(4 * 24 * HOUR), severity: 'warning' },
				],
				extra: { used: 22.61, limit: null, percent: 0, currency: 'GBP' },
				apps: [{ name: 'Claude Code', percent: 95 }, { name: 'Cowork', percent: 4 }, { name: 'Chats', percent: 1 }],
				url: 'https://claude.ai/settings/usage',
			};
		case 'demo-strava':
			return { weekStart: iso(-2 * 24 * HOUR), totals: {
				run: { seconds: 6420, metres: 18400, count: 3 },
				walk: { seconds: 9300, metres: 11200, count: 4 },
				gym: { seconds: 7200, metres: 0, count: 2 },
			} };
		case 'demo-xbox':
			return { game: { name: 'Forza Horizon 5', image: null, playedAt: iso(-14 * HOUR), gamerscore: 640, totalGamerscore: 1000, progress: 64 }, recent: [{ name: 'Halo Infinite', playedAt: iso(-3 * 24 * HOUR) }] };
		case 'demo-gmail-1':
			return mail('ben@gakdesign.co.uk', 4, [['Sarah at Realityhouse', 'Re: Launch date for the new site', 8 * MIN, true], ['Google Search Console', 'New coverage issue detected', 2 * HOUR, true], ['WP Engine', 'Your monthly usage report', 26 * HOUR, false]]);
		case 'demo-gmail-2':
			return mail('hello@bonsaidigitalcollective.co.uk', 0, [['Web Heads', 'Invoice paid, thank you', 3 * HOUR, false]]);
		case 'demo-outlook':
			return { ...mail('ben@outlook.com', 1, [['Microsoft account team', 'Security info was added', 40 * MIN, true]]), events: [
				{ title: 'Dentist', start: iso(3 * 24 * HOUR), end: iso(3 * 24 * HOUR + HOUR), allDay: false, location: 'Exeter', url: 'https://outlook.live.com/calendar/' },
			] };
		case 'demo-proton':
			return mail('ben@proton.me', 2, [['Domain registrar', 'Renewal reminder: 30 days left', 5 * HOUR, true]]);
		case 'demo-slack-1':
			return { team: 'Bonsai Digital Collective', user: 'ben', url: 'https://slack.com/', items: [
				{ from: 'Tom', where: 'Direct message', text: 'Pushed the hero fix to staging, can you have a look before the call?', date: iso(-6 * MIN), url: 'https://slack.com/' },
				{ from: 'Ben', where: 'Group DM', mine: true, text: 'Nice, will check after lunch', date: iso(-50 * MIN), url: 'https://slack.com/' },
			] };
		case 'demo-slack-2':
			return { team: 'Realityhouse', user: 'ben', url: 'https://slack.com/', items: [] };
		case 'demo-clickup':
			return {
				user: 'ben', workspaces: ['Bonsai', 'Gak Design'], dueCount: 4, overdueCount: 1, url: 'https://app.clickup.com/',
				due: [
					{ name: 'Fix checkout spacing on mobile', status: 'in progress', statusColor: '#4f9dff', list: 'Client fixes', team: 'Bonsai', due: iso(-20 * HOUR), url: 'https://app.clickup.com/' },
					{ name: 'Send monthly SEO report', status: 'to do', statusColor: '#9ba5b2', list: 'Retainers', team: 'Bonsai', due: iso(6 * HOUR), url: 'https://app.clickup.com/' },
					{ name: 'ACF JSON sync on staging', status: 'review', statusColor: '#e8a33d', list: 'Dev', team: 'Gak Design', due: iso(2 * 24 * HOUR), url: 'https://app.clickup.com/' },
				],
				activity: [
					{ name: 'Homepage hero animation', status: 'review', statusColor: '#e8a33d', list: 'Dev', team: 'Gak Design', updated: iso(-12 * MIN), url: 'https://app.clickup.com/' },
					{ name: 'Fix checkout spacing on mobile', status: 'in progress', statusColor: '#4f9dff', list: 'Client fixes', team: 'Bonsai', updated: iso(-3 * HOUR), url: 'https://app.clickup.com/' },
				],
			};
		case 'demo-tickets-1':
			return {
				site: 'Bonsai Support', total: 7, mine: 3, unassigned: 1, slaMissed: 1, url: 'https://example.com/wp-admin/',
				counts: { new: 1, open: 4, awaiting_client: 2, on_hold: 0 },
				latest: [
					{ ref: 'SUP-1042', title: 'Contact form not sending', status: 'new', status_label: 'New', priority_label: 'Urgent', assignee: '', last_activity: iso(-15 * MIN), url: 'https://example.com/' },
					{ ref: 'SUP-1039', title: 'Update opening hours', status: 'open', status_label: 'Open', priority_label: 'Normal', assignee: 'Ben', last_activity: iso(-2 * HOUR), url: 'https://example.com/' },
				],
			};
		case 'demo-tickets-2':
			return { site: 'Drift Support', total: 0, mine: 0, unassigned: 0, slaMissed: null, url: 'https://example.com/wp-admin/', counts: {}, latest: [] };
		case 'demo-weather':
			return {
				place: 'Ide', url: 'https://www.metoffice.gov.uk/',
				current: { temp: 15.2, feels: 13.8, code: 2, wind: 11, day: true },
				today: { code: 61, max: 17.1, min: 9.4, rain: 85, sunrise: `${isoDay(0)}T07:31`, sunset: `${isoDay(0)}T18:22` },
				tomorrow: { code: 3, max: 15.8, min: 8.2, rain: 30, sunrise: '', sunset: '' },
				hours: hours(),
			};
		case 'demo-uptime':
			return {
				total: 64, up: 62, down: 1, unknown: 1, lastCheckAt: iso(-2 * MIN), url: 'https://example.com/',
				sitesDown: [{ name: 'The Ley Arms', url: 'https://example.com/', agency: 'Realityhouse', down_since: iso(-35 * MIN), cause: 'HTTP 503' }],
				expiring: [
					{ name: 'Seedbed Studio', type: 'ssl', expires_at: iso(5 * 24 * HOUR), days: 5 },
					{ name: 'Webheads Client', type: 'domain', expires_at: iso(21 * 24 * HOUR), days: 21 },
				],
				recent: [{ name: 'SPS Marketing', started_at: iso(-5 * HOUR), resolved_at: iso(-4.8 * HOUR), duration_seconds: 720, cause: 'Timeout' }],
			};
		case 'demo-github-1':
			return {
				login: 'gakdesign', repos: 6, url: 'https://github.com/',
				failed: [{ repo: 'Bonsai-Systems/bonsai-support-tickets', workflow: 'Release', branch: 'main', date: iso(-3 * HOUR), url: 'https://github.com/' }],
				activity: [
					{ text: 'Pushed 3 commits to develop', detail: 'feat: add dashboard summary endpoint', repo: 'Bonsai-Systems/bonsai-support-tickets', actor: 'gakdesign', date: iso(-20 * MIN), url: 'https://github.com/' },
					{ text: 'Merged PR #42', detail: 'Hero module spacing on mobile', repo: 'Bonsai-Systems/rh-core', actor: 'tom-dev', date: iso(-2 * HOUR), url: 'https://github.com/' },
					{ text: 'Released v1.17.0', detail: 'Maintenance mode scheduling', repo: 'Bonsai-Systems/bonsai-maintenance', actor: 'gakdesign', date: iso(-26 * HOUR), url: 'https://github.com/' },
				],
			};
		case 'demo-github-2':
			return { login: 'gak-ben', repos: 3, url: 'https://github.com/', failed: [], activity: [
				{ text: 'Pushed 1 commit to main', detail: 'chore: sync ACF JSON', repo: 'gak-ben/client-theme', actor: 'gak-ben', date: iso(-5 * HOUR), url: 'https://github.com/' },
			] };
		case 'demo-freeagent':
			return {
				company: 'Gak Design Ltd', currency: 'GBP', url: 'https://example.freeagent.com', taxUrl: 'https://example.freeagent.com/taxes',
				banks: [{ name: 'Business current', balance: 12480.55, currency: 'GBP' }, { name: 'Savings', balance: 8200, currency: 'GBP' }],
				overdueTotal: 2340, overdueCount: 2,
				overdue: [
					{ ref: 'INV-0412', contact: 'Realityhouse', amount: 1800, currency: 'GBP', due: isoDay(-9), url: 'https://example.freeagent.com/' },
					{ ref: 'INV-0418', contact: 'Seedbed Studio', amount: 540, currency: 'GBP', due: isoDay(-2), url: 'https://example.freeagent.com/' },
				],
				dueSoonTotal: 3150,
				dueSoon: [{ ref: 'INV-0421', contact: 'SPS Marketing', amount: 3150, currency: 'GBP', due: isoDay(6), url: 'https://example.freeagent.com/' }],
				billsTotal: 96.4,
				bills: [{ ref: 'BILL-88', contact: 'SiteGround', amount: 96.4, currency: 'GBP', due: isoDay(2), url: 'https://example.freeagent.com/' }],
				tax: [
					{ title: 'VAT return (Jul–Sep) due', nature: 'VAT', due: isoDay(24), amount: 4210.12, personal: false },
					{ title: 'Corporation Tax payment due', nature: 'Corporation Tax', due: isoDay(80), amount: 6890, personal: false },
					{ title: 'Self Assessment payment due', nature: 'Self Assessment', due: isoDay(110), amount: null, personal: true },
				],
			};
		default:
			return null;
	}
}

module.exports = { accounts, data };
