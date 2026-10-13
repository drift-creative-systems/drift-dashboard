/**
 * Updates: checks the public releases repo (see `build.publish` in
 * package.json) on start and every 6 hours, downloads new versions in the
 * background, then asks to restart. If ignored, the update installs when
 * the app quits.
 *
 * Only the installed app updates; `npm start` and demo mode report
 * "dev" and never check. Failures are logged and shown in Settings, never
 * thrown, so the dashboard keeps working offline.
 */
const { app } = require('electron');

const CHECK_EVERY = 6 * 60 * 60 * 1000;

let autoUpdater = null;
let notify = () => {};
let status = { state: 'idle' };

function setStatus(next) {
	status = next;
	notify(status);
}

function current() {
	return status;
}

/**
 * Check now. Safe to call repeatedly; errors become a status, not a throw.
 */
async function check() {
	if (!autoUpdater) {
		return status;
	}
	if (['checking', 'downloading', 'ready'].includes(status.state)) {
		return status;
	}
	try {
		await autoUpdater.checkForUpdates();
	} catch (err) {
		console.error('[updater] Check failed:', err.message);
		setStatus({ state: 'error', message: 'Couldn’t check for updates. Are you online?' });
	}
	return status;
}

/** Restart into the downloaded version. */
function install() {
	if (autoUpdater && 'ready' === status.state) {
		autoUpdater.quitAndInstall();
	}
}

/**
 * @param {{ send: (status: object) => void, demo: boolean, beforeInstall: () => void }} options
 */
function init({ send, demo, beforeInstall }) {
	notify = send;
	if (!app.isPackaged || demo) {
		status = { state: 'dev' };
		return;
	}

	({ autoUpdater } = require('electron-updater'));
	autoUpdater.autoDownload = true;
	autoUpdater.autoInstallOnAppQuit = true;
	autoUpdater.logger = null; // Its own logging is very chatty; we log what matters.

	autoUpdater.on('checking-for-update', () => setStatus({ state: 'checking' }));
	autoUpdater.on('update-not-available', () => setStatus({ state: 'current', checkedAt: Date.now() }));
	autoUpdater.on('update-available', (info) => setStatus({ state: 'downloading', version: info.version, percent: 0 }));
	autoUpdater.on('download-progress', (p) => setStatus({ ...status, state: 'downloading', percent: Math.round(p.percent || 0) }));
	autoUpdater.on('update-downloaded', (info) => setStatus({ state: 'ready', version: info.version }));
	autoUpdater.on('error', (err) => {
		console.error('[updater]', err && err.message);
		setStatus({ state: 'error', message: 'The update didn’t download. It will try again later.' });
	});
	// quitAndInstall closes windows; let main stop the close-to-tray behaviour first.
	autoUpdater.on('before-quit-for-update', beforeInstall);

	setTimeout(check, 10 * 1000);
	setInterval(check, CHECK_EVERY);
}

module.exports = { init, check, install, current };
