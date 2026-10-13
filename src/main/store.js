/**
 * Settings and secrets on disk.
 *
 * config.json  – accounts (non-secret fields), app settings, window size.
 * secrets.json – one encrypted blob per account (passwords, API keys,
 *                OAuth tokens). Encrypted with Electron safeStorage, which
 *                on Windows is DPAPI: only your Windows user can decrypt it.
 *
 * Both live in %APPDATA%\Bonsai Dashboard, never in the project folder.
 */
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_CONFIG = {
	settings: {
		startWithWindows: false,
		closeToTray: true,
	},
	window: null,
	accounts: [],
};

let configCache = null;
let secretsCache = null;

function dir() {
	return app.getPath('userData');
}

function file(name) {
	return path.join(dir(), name);
}

/**
 * Read a JSON file, falling back to a default if missing or corrupt.
 */
function readJson(name, fallback) {
	try {
		return JSON.parse(fs.readFileSync(file(name), 'utf8'));
	} catch (err) {
		if ('ENOENT' !== err.code) {
			console.error(`[store] Could not read ${name}, starting fresh:`, err.message);
		}
		return structuredClone(fallback);
	}
}

/**
 * Write via a temp file and rename, so a crash mid-write can't corrupt it.
 */
function writeJson(name, data) {
	fs.mkdirSync(dir(), { recursive: true });
	const target = file(name);
	const tmp = `${target}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
	fs.renameSync(tmp, target);
}

function config() {
	if (!configCache) {
		const loaded = readJson('config.json', DEFAULT_CONFIG);
		configCache = {
			...structuredClone(DEFAULT_CONFIG),
			...loaded,
			settings: { ...DEFAULT_CONFIG.settings, ...(loaded.settings || {}) },
		};
	}
	return configCache;
}

function saveConfig() {
	writeJson('config.json', config());
}

function secrets() {
	if (!secretsCache) {
		secretsCache = readJson('secrets.json', {});
	}
	return secretsCache;
}

function assertEncryption() {
	if (!safeStorage.isEncryptionAvailable()) {
		throw new Error('Secure storage is not available on this machine, so passwords cannot be saved.');
	}
}

/* ---------------------------------------------------------------- Accounts */

function accounts() {
	return config().accounts;
}

function account(id) {
	return accounts().find((a) => a.id === id) || null;
}

/**
 * Create or update an account. `values` holds every field; the provider's
 * field list decides which go to config and which are encrypted. A blank
 * secret field means "keep what's saved".
 */
function saveAccount({ id, provider, label, values }, fields) {
	// Catch common paste mix-ups before anything is saved, e.g. the redirect
	// URI pasted into a client ID field (fields marked `notUrl`).
	for (const field of fields) {
		const raw = values ? String(values[field.key] ?? '').trim() : '';
		if (field.notUrl && /^[a-z]+:\/\//i.test(raw)) {
			throw new Error(`${field.label} should be the ID or key itself, not a web address. The redirect address only goes in the service's own app settings.`);
		}
		// Count what you see (an emoji can be several characters underneath).
		if (field.maxGraphemes && [...new Intl.Segmenter().segment(raw)].length > field.maxGraphemes) {
			throw new Error(`${field.label}: use at most ${field.maxGraphemes} characters.`);
		}
		if ('color' === field.type && raw && !/^#[0-9a-f]{6}$/i.test(raw)) {
			throw new Error(`${field.label} must be a colour like #ee4367.`);
		}
	}

	let acc = id ? account(id) : null;
	if (!acc) {
		acc = { id: crypto.randomUUID(), provider, label: '', config: {} };
		accounts().push(acc);
	}
	acc.label = String(label || '').trim();

	const secretValues = {};
	for (const field of fields) {
		const raw = values ? values[field.key] : undefined;
		if (field.secret) {
			if (raw !== undefined && String(raw).trim() !== '') {
				secretValues[field.key] = String(raw).trim();
			}
		} else if (field.type === 'checkbox') {
			acc.config[field.key] = Boolean(raw);
		} else if (raw !== undefined) {
			acc.config[field.key] = String(raw).trim();
		}
	}

	saveConfig();
	if (Object.keys(secretValues).length) {
		setSecrets(acc.id, secretValues);
	}
	return acc;
}

function deleteAccount(id) {
	const cfg = config();
	cfg.accounts = cfg.accounts.filter((a) => a.id !== id);
	saveConfig();
	const all = secrets();
	delete all[id];
	writeJson('secrets.json', all);
}

function moveAccount(id, direction) {
	const list = accounts();
	const index = list.findIndex((a) => a.id === id);
	const target = index + (direction === 'up' ? -1 : 1);
	if (index < 0 || target < 0 || target >= list.length) {
		return;
	}
	[list[index], list[target]] = [list[target], list[index]];
	saveConfig();
}

/* ----------------------------------------------------------------- Secrets */

function getSecrets(id) {
	const blob = secrets()[id];
	if (!blob) {
		return {};
	}
	try {
		return JSON.parse(safeStorage.decryptString(Buffer.from(blob, 'base64')));
	} catch (err) {
		console.error('[store] Could not decrypt secrets for an account:', err.message);
		return {};
	}
}

/**
 * Merge values into an account's secrets. `null` removes a key.
 */
function setSecrets(id, values) {
	assertEncryption();
	const merged = { ...getSecrets(id), ...values };
	for (const key of Object.keys(merged)) {
		if (merged[key] === null) {
			delete merged[key];
		}
	}
	secrets()[id] = safeStorage.encryptString(JSON.stringify(merged)).toString('base64');
	writeJson('secrets.json', secrets());
}

/**
 * Which secret keys are saved (never the values), for the settings screen.
 */
function secretKeys(id) {
	return Object.keys(getSecrets(id));
}

/* ---------------------------------------------------------------- Settings */

function settings() {
	return config().settings;
}

function saveSettings(values) {
	const cfg = config();
	cfg.settings = {
		...cfg.settings,
		startWithWindows: Boolean(values.startWithWindows),
		closeToTray: Boolean(values.closeToTray),
	};
	saveConfig();
	return cfg.settings;
}

/* ------------------------------------------------------------------ Layout */

const SECTION_IDS = ['now'];          // Sections that can be rearranged.
const HEIGHTS = ['normal', 'tall', 'compact'];

function layout() {
	return config().layout || {};
}

/**
 * Save a section's columns and card sizes, keeping only well-formed values:
 * count = 2–5, columns = up to 5 lists of card IDs (account IDs or
 * "upnext", each used once), sizes = { id: { h } }.
 */
function saveLayout(section, data) {
	if (!SECTION_IDS.includes(section)) {
		throw new Error('This section can’t be rearranged.');
	}
	const isId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id);
	const count = Number(data && data.count);
	const seen = new Set();
	const columns = (Array.isArray(data && data.columns) ? data.columns : [])
		.slice(0, 5)
		.map((col) => (Array.isArray(col) ? col : []).filter((id) => {
			if (!isId(id) || seen.has(id)) {
				return false;
			}
			seen.add(id);
			return true;
		}));
	const sizes = {};
	for (const [id, size] of Object.entries((data && data.sizes) || {})) {
		if (isId(id) && size && HEIGHTS.includes(size.h)) {
			sizes[id] = { h: size.h };
		}
	}
	const cfg = config();
	cfg.layout = {
		...(cfg.layout || {}),
		[section]: { count: [2, 3, 4, 5].includes(count) ? count : 4, columns, sizes },
	};
	saveConfig();
	return cfg.layout;
}

/**
 * Save the order of the dashboard sections below "Right now" (section IDs
 * such as "email", each once).
 */
function saveSectionOrder(order) {
	const ids = Array.isArray(order) ? order.filter((id) => typeof id === 'string' && /^[a-z]{1,32}$/.test(id)) : [];
	const cfg = config();
	cfg.layout = { ...(cfg.layout || {}), sectionOrder: [...new Set(ids)].slice(0, 20) };
	saveConfig();
	return cfg.layout;
}

function windowState() {
	return config().window;
}

function saveWindowState(state) {
	config().window = state;
	saveConfig();
}

/**
 * Demo mode: replace the config with sample accounts (in a throwaway folder).
 */
function seedDemo(demoAccounts) {
	configCache = {
		...structuredClone(DEFAULT_CONFIG),
		settings: { startWithWindows: false, closeToTray: false },
		accounts: structuredClone(demoAccounts),
	};
	saveConfig();
}

module.exports = {
	seedDemo,
	accounts,
	account,
	saveAccount,
	deleteAccount,
	moveAccount,
	getSecrets,
	setSecrets,
	secretKeys,
	settings,
	saveSettings,
	layout,
	saveLayout,
	saveSectionOrder,
	windowState,
	saveWindowState,
	dataDir: dir,
};
