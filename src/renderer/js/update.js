/**
 * Update bar ("Version x is ready. Restart to update") and the
 * "Check for updates" button in Settings. The main process does the work
 * (src/main/updater.js); this only shows its status.
 */
(function () {
	'use strict';

	const bar = document.getElementById('update-bar');
	const barText = bar.querySelector('.js-update-text');
	const button = document.getElementById('check-updates');
	const statusText = document.querySelector('.js-update-status');

	let latest = { state: 'idle' };
	let dismissed = null; // Version the user said "Later" to.

	/** Plain-English status for Settings. */
	function describe(status) {
		switch (status.state) {
			case 'dev':
				return 'Updates only run in the installed app.';
			case 'checking':
				return 'Checking…';
			case 'current':
				return 'You’re up to date.';
			case 'downloading':
				return `Downloading version ${status.version}… ${status.percent || 0}%`;
			case 'ready':
				return `Version ${status.version} is ready. Restart to update.`;
			case 'error':
				return status.message || 'Couldn’t check for updates.';
			default:
				return '';
		}
	}

	function show(status) {
		latest = status;
		statusText.textContent = describe(status);
		button.disabled = ['dev', 'checking', 'downloading'].includes(status.state);

		const offer = 'ready' === status.state && status.version !== dismissed;
		if (offer) {
			barText.textContent = `Bonsai Dashboard ${status.version} is ready.`;
		}
		bar.hidden = !offer;
	}

	function init(initial) {
		show(initial || { state: 'idle' });
		window.dashboard.onUpdate(show);

		button.addEventListener('click', async () => {
			show(await window.dashboard.checkForUpdates());
		});
		bar.querySelector('.js-update-install').addEventListener('click', () => {
			window.dashboard.installUpdate();
		});
		bar.querySelector('.js-update-later').addEventListener('click', () => {
			dismissed = latest.version;
			bar.hidden = true;
			statusText.textContent = 'The update will install next time you quit.';
		});
	}

	window.BD.update = { init };
}());
