/**
 * ClickUp: tasks due this week (including overdue) and recent activity on
 * your tasks. ClickUp's Inbox has no public API, so "Recent activity" is
 * the closest stand-in: tasks assigned to you, most recently updated first.
 * Uses a personal API token (pk_…), which covers every workspace you're in.
 */
const { request } = require('../http');

const API = 'https://api.clickup.com/api/v2';
const SERVICE = 'ClickUp';
const SHOW = 6;
const ACTIVITY_DAYS = 3;

function endOfWeek() {
	const d = new Date();
	const day = (d.getDay() + 6) % 7; // Monday = 0
	d.setHours(23, 59, 59, 999);
	d.setDate(d.getDate() + (6 - day));
	return d;
}

function task(t, team) {
	return {
		id: t.id,
		name: t.name,
		status: (t.status && t.status.status) || '',
		statusColor: (t.status && t.status.color) || '',
		list: (t.list && t.list.name) || '',
		team,
		due: t.due_date ? new Date(Number(t.due_date)).toISOString() : null,
		updated: t.date_updated ? new Date(Number(t.date_updated)).toISOString() : null,
		url: t.url,
	};
}

module.exports = {
	id: 'clickup',
	name: 'ClickUp',
	section: 'clickup',
	interval: 3 * 60 * 1000,
	oauth: false,
	help: 'ClickUp → avatar → Settings → Apps → API Token (starts pk_).',
	fields: [
		{ key: 'token', label: 'Personal API token (pk_…)', type: 'password', secret: true, required: true },
		{ key: 'team_ids', label: 'Only these workspace IDs (optional, comma separated)', type: 'text', advanced: true },
	],

	async fetch(account, ctx) {
		const { token } = ctx.secrets();
		if (!token) {
			throw new Error('Add the API token in Settings.');
		}
		const headers = { Authorization: token };
		const get = (path) => request(`${API}${path}`, { headers, service: SERVICE }).then((r) => r.data);

		const [{ user }, { teams }] = await Promise.all([
			ctx.cached('user', 3600000, () => get('/user')),
			ctx.cached('teams', 3600000, () => get('/team')),
		]);

		const only = String(account.config.team_ids || '').split(',').map((s) => s.trim()).filter(Boolean);
		const chosen = (teams || []).filter((t) => !only.length || only.includes(String(t.id)));

		const due = [];
		const activity = [];
		const since = Date.now() - ACTIVITY_DAYS * 86400000;

		for (const team of chosen) {
			const base = `/team/${team.id}/task?assignees[]=${user.id}&include_closed=false&subtasks=true`;
			const [dueRes, recentRes] = await Promise.all([
				get(`${base}&due_date_lt=${endOfWeek().getTime()}&order_by=due_date`),
				get(`${base}&date_updated_gt=${since}&order_by=updated`),
			]);
			due.push(...(dueRes.tasks || []).map((t) => task(t, team.name)));
			activity.push(...(recentRes.tasks || []).map((t) => task(t, team.name)));
		}

		due.sort((a, b) => (a.due || '').localeCompare(b.due || ''));
		activity.sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));

		return {
			user: user.username || user.email,
			workspaces: chosen.map((t) => t.name),
			dueCount: due.length,
			overdueCount: due.filter((t) => t.due && new Date(t.due) < new Date()).length,
			due: due.slice(0, SHOW),
			activity: activity.slice(0, SHOW),
			url: 'https://app.clickup.com/',
		};
	},
};
