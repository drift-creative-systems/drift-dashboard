/**
 * Choosing which app opens the dashboard's links.
 *
 * Settings → General has a default ("Your default browser" unless you pick
 * one), and each card can override it under Advanced. Only https:// links
 * go to the chosen app; slack:// links always open in Slack.
 *
 * An app is stored as its path: /Applications/Google Chrome.app on macOS,
 * C:\…\chrome.exe on Windows. Links are passed as a single argument with
 * execFile (no shell), so nothing in a URL can run as a command.
 */
const { dialog, shell } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const MAC = 'darwin' === process.platform;
const WIN = 'win32' === process.platform;

/** Browsers looked for on macOS, by .app name. */
const MAC_APPS = [
	'Safari', 'Google Chrome', 'Firefox', 'Microsoft Edge', 'Arc', 'Brave Browser', 'Vivaldi',
	'Opera', 'Orion', 'Zen', 'Dia', 'Chromium', 'Google Chrome Canary', 'Firefox Developer Edition',
];

/** Browsers looked for on Windows: [name, path under a base folder]. */
const WIN_APPS = [
	['Google Chrome', 'Google\\Chrome\\Application\\chrome.exe'],
	['Microsoft Edge', 'Microsoft\\Edge\\Application\\msedge.exe'],
	['Firefox', 'Mozilla Firefox\\firefox.exe'],
	['Brave', 'BraveSoftware\\Brave-Browser\\Application\\brave.exe'],
	['Vivaldi', 'Vivaldi\\Application\\vivaldi.exe'],
	['Opera', 'Programs\\Opera\\opera.exe'],
];

function exists(p) {
	try {
		return fs.existsSync(p);
	} catch {
		return false;
	}
}

/** A friendly name for an app path: "Google Chrome", "firefox". */
function name(appPath) {
	const base = path.basename(String(appPath || ''));
	return base.replace(/\.(app|exe)$/i, '');
}

/** Whether a path looks like an app this platform can launch. */
function valid(appPath) {
	if (!appPath || !path.isAbsolute(appPath)) {
		return false;
	}
	if (MAC && !/\.app$/i.test(appPath)) {
		return false;
	}
	if (WIN && !/\.exe$/i.test(appPath)) {
		return false;
	}
	return exists(appPath);
}

let cached = null;

/**
 * Browsers installed on this computer: [{ path, name }].
 */
function list() {
	if (cached) {
		return cached;
	}
	const found = [];
	if (MAC) {
		const dirs = ['/Applications', path.join(os.homedir(), 'Applications')];
		for (const appName of MAC_APPS) {
			const hit = dirs.map((d) => path.join(d, `${appName}.app`)).find(exists);
			if (hit) {
				found.push({ path: hit, name: appName });
			}
		}
	} else if (WIN) {
		const bases = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA].filter(Boolean);
		for (const [appName, rel] of WIN_APPS) {
			const hit = bases.map((b) => path.join(b, rel)).find(exists);
			if (hit) {
				found.push({ path: hit, name: appName });
			}
		}
	}
	cached = found;
	return found;
}

/**
 * Ask for an app with the system file picker. Resolves to { path, name },
 * or null if cancelled.
 */
async function choose(win) {
	const result = await dialog.showOpenDialog(win, {
		title: 'Choose an app to open links with',
		defaultPath: MAC ? '/Applications' : (process.env.ProgramFiles || undefined),
		properties: ['openFile'],
		filters: MAC ? [{ name: 'Applications', extensions: ['app'] }] : (WIN ? [{ name: 'Programs', extensions: ['exe'] }] : []),
	});
	const picked = !result.canceled && result.filePaths[0];
	if (!picked) {
		return null;
	}
	if (!valid(picked)) {
		throw new Error(MAC ? 'Choose an app from Applications (a .app).' : 'Choose a program (.exe).');
	}
	return { path: picked, name: name(picked) };
}

/**
 * Open an https link in `appPath`, or the default browser if it's blank
 * or the app has gone (e.g. uninstalled).
 */
function open(url, appPath) {
	if (!appPath || !valid(appPath)) {
		if (appPath) {
			console.error('[links] App not found, using the default browser:', appPath);
		}
		return shell.openExternal(url);
	}
	return new Promise((resolve) => {
		const done = (err) => {
			if (err) {
				console.error('[links] Couldn’t open with', name(appPath), err.message);
				shell.openExternal(url).then(resolve, resolve);
			} else {
				resolve();
			}
		};
		if (MAC) {
			// `open -a` brings the app forward, starting it if needed.
			execFile('/usr/bin/open', ['-a', appPath, url], done);
		} else {
			const child = execFile(appPath, [url], { windowsHide: false }, () => {});
			child.on('error', done);
			child.on('spawn', () => {
				child.unref();
				done();
			});
		}
	});
}

module.exports = { list, choose, open, valid, name };
