/**
 * Clawd's Claude Code moods. A few hooks in Claude Code's settings.json write
 * one word (working / waiting / done / idle) to a small file in the same
 * folder whenever Claude starts work, needs you, or finishes; the dashboard
 * watches that file. The hooks run in Claude Code's shell (Git Bash on
 * Windows), and `echo word> "file"` works in cmd too.
 *
 * Only our own hooks are ever added or removed (they're recognised by the
 * state file's name), and settings.json is backed up before each change.
 */
const fs = require('fs');
const path = require('path');

const STATE_FILE = 'bonsai-dashboard-clawd';
const BACKUP_SUFFIX = '.bonsai-backup';
const STATES = ['working', 'waiting', 'done', 'idle'];

// Claude Code event → [state, matcher]. Notification only for permission
// prompts, so a finished reply doesn't turn into "waiting" a minute later.
const EVENTS = {
	UserPromptSubmit: ['working'],
	PreToolUse: ['working'],
	PostToolUse: ['working'],
	Notification: ['waiting', 'permission_prompt'],
	Stop: ['done'],
	SessionEnd: ['idle'],
};

function files(root) {
	return {
		settings: path.join(root, 'settings.json'),
		state: path.join(root, STATE_FILE),
	};
}

function ours(hook) {
	return Boolean(hook && 'string' === typeof hook.command && hook.command.includes(STATE_FILE));
}

function readSettings(file) {
	let text;
	try {
		text = fs.readFileSync(file, 'utf8');
	} catch (err) {
		if ('ENOENT' === err.code) {
			return { data: {}, text: null };
		}
		throw err;
	}
	try {
		const data = JSON.parse(text.replace(/^﻿/, '') || '{}');
		if (!data || 'object' !== typeof data || Array.isArray(data)) {
			throw new Error('not an object');
		}
		return { data, text };
	} catch {
		throw new Error(`Claude Code's settings file isn't valid JSON, so it was left alone: ${file}`);
	}
}

/** Back up, then write via a temp file and rename, like store.js. */
function writeSettings(file, data, previous) {
	if (null !== previous) {
		fs.writeFileSync(`${file}${BACKUP_SUFFIX}`, previous, 'utf8');
	}
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const tmp = `${file}.tmp`;
	fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
	fs.renameSync(tmp, file);
}

/** settings.hooks with our entries taken out (empty events dropped). */
function without(hooks) {
	const out = {};
	for (const [event, groups] of Object.entries(hooks || {})) {
		if (!Array.isArray(groups)) {
			out[event] = groups;
			continue;
		}
		const kept = groups
			.map((g) => (g && Array.isArray(g.hooks) ? { ...g, hooks: g.hooks.filter((h) => !ours(h)) } : g))
			.filter((g) => !(g && Array.isArray(g.hooks) && !g.hooks.length));
		if (kept.length) {
			out[event] = kept;
		}
	}
	return out;
}

/** Whether our hooks are in this folder's settings.json. */
function installed(root) {
	try {
		const { data } = readSettings(files(root).settings);
		return Object.values(data.hooks || {}).some((groups) => Array.isArray(groups)
			&& groups.some((g) => g && Array.isArray(g.hooks) && g.hooks.some(ours)));
	} catch {
		return false;
	}
}

function install(root) {
	const f = files(root);
	const { data, text } = readSettings(f.settings);
	const target = f.state.replace(/\\/g, '/');
	const hooks = without(data.hooks);
	for (const [event, [state, matcher]] of Object.entries(EVENTS)) {
		const group = { hooks: [{ type: 'command', command: `echo ${state}> "${target}"` }] };
		if (matcher) {
			group.matcher = matcher;
		}
		hooks[event] = [...(hooks[event] || []), group];
	}
	writeSettings(f.settings, { ...data, hooks }, text);
}

function remove(root) {
	const f = files(root);
	const { data, text } = readSettings(f.settings);
	if (null === text) {
		return;
	}
	const hooks = without(data.hooks);
	const next = { ...data, hooks };
	if (!Object.keys(hooks).length) {
		delete next.hooks;
	}
	writeSettings(f.settings, next, text);
	fs.rmSync(f.state, { force: true });
}

/** The last state Claude Code wrote, as { state, at } (ms), or null. */
function read(root) {
	try {
		const file = files(root).state;
		// PowerShell's echo writes UTF-16, so keep only the letters.
		const word = fs.readFileSync(file).toString('latin1').replace(/[^a-z]/g, '');
		return STATES.includes(word) ? { state: word, at: fs.statSync(file).mtimeMs } : null;
	} catch {
		return null;
	}
}

/** Calls `changed` when the state file is written. Returns a stop function. */
function watch(root, changed) {
	try {
		const watcher = fs.watch(root, (_event, file) => {
			if (!file || STATE_FILE === String(file)) {
				changed();
			}
		});
		watcher.on('error', (err) => console.error('[clawd] Stopped watching Claude Code:', err.message));
		return () => watcher.close();
	} catch (err) {
		console.error('[clawd] Couldn\'t watch Claude Code:', err.message);
		return () => {};
	}
}

module.exports = { installed, install, remove, read, watch };
