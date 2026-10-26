/**
 * Bonsai Dashboard: Electron main process.
 *
 * Owns the window, tray icon, settings storage and all network access.
 * The window (renderer) never sees passwords or tokens; it only gets the
 * card data and the names of which secrets are saved.
 */
const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, shell, nativeImage, powerMonitor } = require('electron');
const path = require('path');
const store = require('./store');
const providers = require('./providers');
const Scheduler = require('./scheduler');
const updater = require('./updater');
const alerts = require('./alerts');

const ASSETS = path.join(__dirname, '..', '..', 'assets');
const ALLOWED_PROTOCOLS = ['https:', 'slack:'];
const DEMO = process.argv.includes('--demo');

// Demo mode keeps its settings in a temp folder, away from your real ones.
if (DEMO) {
	app.setPath('userData', path.join(app.getPath('temp'), 'bonsai-dashboard-demo'));
}

let win = null;
let tray = null;
let quitting = false;
let scheduler = null;
let watcher = null;
const shown = new Set(); // Live notifications; dropped ones lose their click handler.

/* ---------------------------------------------------------------- Helpers */

function send(channel, payload) {
	if (win && !win.isDestroyed()) {
		win.webContents.send(channel, payload);
	}
}

function openExternal(url) {
	try {
		const parsed = new URL(url);
		if (ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
			shell.openExternal(parsed.toString());
			return true;
		}
	} catch {
		// Not a URL; ignore.
	}
	console.error('[main] Blocked opening a link:', url);
	return false;
}

/**
 * Show a desktop alert, unless you're looking at the dashboard and only want
 * them while it's in the background. Clicking it opens the dashboard.
 */
function notify({ title, body }) {
	if (!Notification.isSupported()) {
		return;
	}
	const inFront = win && win.isVisible() && !win.isMinimized() && win.isFocused();
	if (inFront && alerts.options(store.settings()).onlyWhenAway) {
		return;
	}
	const note = new Notification({ title, body: body || '', icon: path.join(ASSETS, 'icon.png') });
	shown.add(note);
	note.on('click', () => {
		shown.delete(note);
		showWindow();
	});
	note.on('close', () => shown.delete(note));
	note.show();
}

/**
 * Account list for the renderer: config fields plus which secrets are saved.
 */
function accountsForRenderer() {
	return store.accounts().map((a) => ({
		id: a.id,
		provider: a.provider,
		label: a.label,
		config: a.config,
		savedSecrets: store.secretKeys(a.id),
		connected: store.secretKeys(a.id).includes('refresh_token'),
	}));
}

function state() {
	return {
		version: app.getVersion(),
		providers: providers.describe(),
		accounts: accountsForRenderer(),
		settings: store.settings(),
		layout: store.layout(),
		update: updater.current(),
		cards: scheduler.all(),
	};
}

function applyLoginItem() {
	if (!app.isPackaged) {
		return; // Don't register the dev copy of Electron to start with Windows.
	}
	app.setLoginItemSettings({
		openAtLogin: Boolean(store.settings().startWithWindows),
		args: ['--hidden'],
	});
}

/* ------------------------------------------------------------------ Window */

function saveBounds() {
	if (!win || win.isDestroyed() || win.isMinimized()) {
		return;
	}
	store.saveWindowState({ bounds: win.getNormalBounds(), maximised: win.isMaximized() });
}

function createWindow(showOnReady) {
	const saved = store.windowState();
	win = new BrowserWindow({
		width: 1440,
		height: 920,
		minWidth: 760,
		minHeight: 560,
		...(saved && saved.bounds ? saved.bounds : {}),
		show: false,
		title: 'Bonsai Dashboard',
		backgroundColor: '#0e0f12',
		autoHideMenuBar: true,
		icon: path.join(ASSETS, 'icon.png'),
		webPreferences: {
			preload: path.join(__dirname, 'preload.js'),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
			spellcheck: false,
		},
	});
	win.setMenuBarVisibility(false);

	win.once('ready-to-show', () => {
		if (saved && saved.maximised) {
			win.maximize();
		}
		if (showOnReady) {
			win.show();
		}
	});

	// Never navigate the app window away; open links in the browser instead.
	win.webContents.setWindowOpenHandler(({ url }) => {
		openExternal(url);
		return { action: 'deny' };
	});
	win.webContents.on('will-navigate', (event) => event.preventDefault());

	// In development, echo window warnings/errors to the terminal.
	if (!app.isPackaged) {
		win.webContents.on('console-message', (details) => {
			if (['warning', 'error'].includes(details.level)) {
				console.log(`[renderer:${details.level}] ${details.message} (${details.sourceId}:${details.lineNumber})`);
			}
		});
	}

	// Dev tools only in development.
	win.webContents.on('before-input-event', (event, input) => {
		if (!app.isPackaged && input.control && input.shift && 'I' === input.key.toUpperCase()) {
			win.webContents.toggleDevTools();
		}
	});

	let boundsTimer = null;
	const queueBounds = () => {
		clearTimeout(boundsTimer);
		boundsTimer = setTimeout(saveBounds, 500);
	};
	win.on('resize', queueBounds);
	win.on('move', queueBounds);

	// Nothing is visible while hidden or minimised, so stop polling.
	win.on('hide', () => scheduler.pause());
	win.on('minimize', () => scheduler.pause());
	win.on('show', () => scheduler.resume());
	win.on('restore', () => scheduler.resume());

	win.on('close', (event) => {
		saveBounds();
		if (!quitting && store.settings().closeToTray) {
			event.preventDefault();
			win.hide();
		}
	});
	win.on('closed', () => {
		win = null;
	});

	win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

function showWindow() {
	if (!win) {
		createWindow(true);
		return;
	}
	if (win.isMinimized()) {
		win.restore();
	}
	win.show();
	win.focus();
}

function createTray() {
	const image = nativeImage.createFromPath(path.join(ASSETS, 'tray.png'));
	tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
	tray.setToolTip('Bonsai Dashboard');
	tray.setContextMenu(Menu.buildFromTemplate([
		{ label: 'Open dashboard', click: showWindow },
		{ label: 'Refresh everything', click: () => scheduler.refresh() },
		{ type: 'separator' },
		{
			label: 'Quit',
			click: () => {
				quitting = true;
				app.quit();
			},
		},
	]));
	tray.on('click', showWindow);
}

/* --------------------------------------------------------------------- IPC */

function registerIpc() {
	ipcMain.handle('state:get', () => state());

	ipcMain.handle('account:save', (_e, payload) => {
		const provider = providers.get(payload && payload.provider);
		if (!provider) {
			throw new Error('Unknown card type.');
		}
		const account = store.saveAccount(payload, providers.fieldsFor(provider));
		scheduler.reset(account.id);
		watcher.forget(account.id);
		scheduler.start();
		return state();
	});

	ipcMain.handle('account:delete', (_e, id) => {
		store.deleteAccount(id);
		scheduler.reset(id);
		watcher.forget(id);
		scheduler.start();
		return state();
	});

	ipcMain.handle('account:hide', (_e, id, hide) => {
		store.setHidden(id, Boolean(hide));
		// Shown again: start afresh, so it doesn't alert about everything it missed.
		scheduler.reset(id);
		watcher.forget(id);
		scheduler.start(false);
		return state();
	});

	ipcMain.handle('account:move', (_e, id, direction) => {
		store.moveAccount(id, direction);
		return state();
	});

	ipcMain.handle('account:connect', async (_e, id) => {
		const account = store.account(id);
		const provider = account && providers.get(account.provider);
		if (!provider || !provider.connect) {
			throw new Error('This card doesn’t use sign-in.');
		}
		await provider.connect(account, scheduler.context(account));
		scheduler.reset(id);
		scheduler.refresh(id);
		showWindow();
		return state();
	});

	ipcMain.handle('cards:refresh', (_e, id) => {
		scheduler.refresh(id || null);
		return true;
	});

	ipcMain.handle('settings:save', (_e, values) => {
		store.saveSettings(values || {});
		applyLoginItem();
		return state();
	});

	ipcMain.handle('layout:save', (_e, section, data) => store.saveLayout(section, data));
	ipcMain.handle('layout:sections', (_e, order) => store.saveSectionOrder(order));

	ipcMain.handle('link:open', (_e, url) => openExternal(url));

	ipcMain.handle('update:check', () => updater.check());
	ipcMain.handle('update:install', () => updater.install());
}

/**
 * Development only: `--screenshot=file.png [--show-settings]` saves the
 * window to a PNG after it settles, then quits. Used to check layouts.
 */
function devScreenshot() {
	const arg = process.argv.find((a) => a.startsWith('--screenshot='));
	if (app.isPackaged || !arg) {
		return;
	}
	const file = path.resolve(arg.slice('--screenshot='.length));
	setTimeout(async () => {
		try {
			if (process.argv.includes('--show-settings')) {
				await win.webContents.executeJavaScript("document.getElementById('toggle-settings').click()");
				await new Promise((r) => setTimeout(r, 500));
			}
			// `--exec=file.js` runs a script in the window first (UI tests); its result is printed.
			const exec = process.argv.find((a) => a.startsWith('--exec='));
			if (exec) {
				const code = require('fs').readFileSync(path.resolve(exec.slice('--exec='.length)), 'utf8');
				const result = await win.webContents.executeJavaScript(code);
				console.log('[dev] exec result:', JSON.stringify(result));
				await new Promise((r) => setTimeout(r, 400));
			}
			const scroll = process.argv.find((a) => a.startsWith('--scroll='));
			if (scroll) {
				await win.webContents.executeJavaScript(`window.scrollTo(0, ${Number(scroll.slice(9)) || 0})`);
				await new Promise((r) => setTimeout(r, 300));
			}
			const image = await win.webContents.capturePage();
			require('fs').writeFileSync(file, image.toPNG());
			console.log(`[dev] Screenshot saved: ${file}`);
		} catch (err) {
			console.error('[dev] Screenshot failed:', err.message);
		}
		quitting = true;
		app.quit();
	}, 7000);
}

/* --------------------------------------------------------------- Lifecycle */

if (!app.requestSingleInstanceLock()) {
	app.quit();
} else {
	app.on('second-instance', showWindow);

	app.whenReady().then(() => {
		app.setAppUserModelId('uk.co.bonsaidigitalcollective.dashboard');
		let fetcher = null;
		if (DEMO) {
			const demo = require('./demo');
			store.seedDemo(demo.accounts);
			fetcher = async (account) => demo.data(account);
		}
		watcher = alerts.create({ notify, settings: store.settings });
		scheduler = new Scheduler(
			(card) => {
				send('card:update', card);
				watcher.check(card);
			},
			fetcher,
			// Cards that can alert keep checking while the window is in the tray.
			(account) => alerts.wanted(account.provider, store.settings()),
		);
		registerIpc();
		createTray();
		// Started with Windows: sit in the tray; only alerting cards poll until opened.
		const visible = !process.argv.includes('--hidden');
		if (!visible) {
			scheduler.pause();
		}
		createWindow(visible);
		applyLoginItem();
		scheduler.start();
		devScreenshot();
		updater.init({
			send: (status) => send('update:status', status),
			demo: DEMO,
			beforeInstall: () => {
				quitting = true;
			},
		});

		// After sleep, data is stale: refresh if the window is in use.
		powerMonitor.on('resume', () => {
			if (win && win.isVisible() && !win.isMinimized()) {
				scheduler.refresh();
			}
		});
	});

	app.on('before-quit', () => {
		quitting = true;
	});

	// Closing the window keeps the app in the tray, so don't quit here.
	app.on('window-all-closed', () => {
		if (!store.settings().closeToTray) {
			app.quit();
		}
	});
}

process.on('unhandledRejection', (err) => {
	console.error('[main] Unhandled rejection:', err);
});
