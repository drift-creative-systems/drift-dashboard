/**
 * GitHub: latest activity on your most recently pushed repos (pushes, pull
 * requests, releases, issues) plus failed Actions runs in the last 7 days.
 * One card per account, each with its own token. Read-only requests only.
 */
const { request } = require('../http');

const API = 'https://api.github.com';
const SERVICE = 'GitHub';
const REPOS = 6;          // Most recently pushed repos checked each refresh.
const SHOW = 3;           // Activity rows on the card.
const FAILED_DAYS = 7;

/**
 * One line of text for an event, or null to skip it.
 */
function describe(event) {
	const p = event.payload || {};
	const cap = (s) => (s ? `${s.charAt(0).toUpperCase()}${s.slice(1)}` : 'Updated');
	const branch = (ref) => String(ref || '').replace(/^refs\/(heads|tags)\//, '');
	switch (event.type) {
		case 'PushEvent': {
			const commits = Array.isArray(p.commits) ? p.commits : [];
			const count = p.size || p.distinct_size || commits.length;
			const last = commits.length ? commits[commits.length - 1].message.split('\n')[0] : '';
			return {
				text: count ? `Pushed ${count} commit${1 === count ? '' : 's'} to ${branch(p.ref)}` : `Pushed to ${branch(p.ref)}`,
				detail: last,
				sha: last ? null : p.head, // Message looked up later if the feed left it out.
			};
		}
		case 'PullRequestEvent': {
			const pr = p.pull_request || {};
			const action = 'closed' === p.action && pr.merged ? 'Merged' : cap(p.action);
			return { text: `${action} PR #${pr.number || p.number}`, detail: pr.title, url: pr.html_url, pr: pr.number || p.number };
		}
		case 'ReleaseEvent':
			return { text: `Released ${(p.release && (p.release.tag_name || p.release.name)) || ''}`.trim(), detail: p.release && p.release.name, url: p.release && p.release.html_url };
		case 'IssuesEvent':
			return { text: `${cap(p.action)} issue #${p.issue && p.issue.number}`, detail: p.issue && p.issue.title, url: p.issue && p.issue.html_url };
		case 'IssueCommentEvent':
			return { text: `Commented on #${p.issue && p.issue.number}`, detail: p.issue && p.issue.title, url: p.comment && p.comment.html_url };
		case 'PullRequestReviewEvent':
			return { text: `Reviewed PR #${p.pull_request && p.pull_request.number}`, detail: p.pull_request && p.pull_request.title, url: p.review && p.review.html_url, pr: p.pull_request && p.pull_request.number };
		case 'CreateEvent':
			return 'repository' === p.ref_type ? { text: 'Created repository' } : { text: `Created ${p.ref_type} ${p.ref}` };
		case 'DeleteEvent':
			return { text: `Deleted ${p.ref_type} ${p.ref}` };
		default:
			return null;
	}
}

module.exports = {
	id: 'github',
	name: 'GitHub',
	section: 'github',
	interval: 5 * 60 * 1000,
	oauth: false,
	help: 'GitHub → Settings → Developer settings → Personal access tokens. See README for which kind and permissions.',
	fields: [
		{ key: 'token', label: 'Personal access token', type: 'password', secret: true, required: true },
		{ key: 'owners', label: 'Only these owners/orgs (optional, comma separated)', type: 'text', placeholder: 'Bonsai-Systems, gakdesign', advanced: true },
	],

	async fetch(account, ctx) {
		const { token } = ctx.secrets();
		if (!token) {
			throw new Error('Add the access token in Settings.');
		}
		const headers = {
			Authorization: `Bearer ${token}`,
			Accept: 'application/vnd.github+json',
			'X-GitHub-Api-Version': '2022-11-28',
		};
		const get = (path) => request(`${API}${path}`, { headers, service: SERVICE }).then((r) => r.data);

		const user = await ctx.cached('user', 3600000, () => get('/user'));
		const owners = String(account.config.owners || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

		const repos = (await get('/user/repos?sort=pushed&direction=desc&per_page=30&affiliation=owner,collaborator,organization_member'))
			.filter((r) => !r.archived)
			.filter((r) => !owners.length || owners.includes(r.owner.login.toLowerCase()))
			.slice(0, REPOS);

		const since = Date.now() - FAILED_DAYS * 86400000;
		const perRepo = await Promise.all(repos.map(async (repo) => {
			const [events, runs] = await Promise.all([
				get(`/repos/${repo.full_name}/events?per_page=15`).catch(() => []),
				// Needs Actions read access; a token without it just shows no runs.
				get(`/repos/${repo.full_name}/actions/runs?per_page=10`).catch(() => ({ workflow_runs: [] })),
			]);
			return { repo, events, runs: (runs && runs.workflow_runs) || [] };
		}));

		const activity = [];
		const failed = [];
		for (const { repo, events, runs } of perRepo) {
			for (const event of Array.isArray(events) ? events : []) {
				const line = describe(event);
				if (line) {
					activity.push({
						...line,
						repo: repo.full_name,
						actor: event.actor && event.actor.login,
						date: event.created_at,
						url: line.url || repo.html_url,
					});
				}
			}
			// Only the latest run of each workflow+branch counts: a later success clears it.
			const seen = new Set();
			for (const run of runs) {
				const key = `${run.workflow_id}:${run.head_branch}`;
				if (seen.has(key)) {
					continue;
				}
				seen.add(key);
				if ('failure' === run.conclusion && new Date(run.updated_at).getTime() > since) {
					failed.push({
						repo: repo.full_name,
						workflow: run.name,
						branch: run.head_branch,
						date: run.updated_at,
						url: run.html_url,
					});
				}
			}
		}

		activity.sort((a, b) => b.date.localeCompare(a.date));
		failed.sort((a, b) => b.date.localeCompare(a.date));

		// The events feed often leaves out PR titles and commit messages, so
		// look them up for the rows shown only (cached: they rarely change).
		const shown = activity.slice(0, SHOW);
		await Promise.all(shown.map(async (row) => {
			try {
				if (row.pr && !row.detail) {
					const pr = await ctx.cached(`pr:${row.repo}#${row.pr}`, 3600000, () => get(`/repos/${row.repo}/pulls/${row.pr}`));
					row.detail = pr.title;
					if (pr.merged_at && row.text.startsWith('Closed')) {
						row.text = row.text.replace('Closed', 'Merged');
					}
				} else if (row.sha && !row.detail) {
					const commit = await ctx.cached(`commit:${row.sha}`, 7 * 86400000, () => get(`/repos/${row.repo}/commits/${row.sha}`));
					row.detail = String((commit.commit && commit.commit.message) || '').split('\n')[0];
					row.url = commit.html_url || row.url;
				}
			} catch {
				// Leave the row without detail rather than failing the card.
			}
			if (row.pr && (!row.url || row.url === `https://github.com/${row.repo}`)) {
				row.url = `https://github.com/${row.repo}/pull/${row.pr}`;
			}
			delete row.pr;
			delete row.sha;
		}));

		return {
			login: user.login,
			repos: repos.length,
			failed,
			activity: shown,
			url: 'https://github.com/',
		};
	},
};
