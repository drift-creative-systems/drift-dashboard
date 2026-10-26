/**
 * The only bridge between the window and the main process. Exposes a small,
 * fixed API; the window can't reach Node, the file system or the network.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dashboard', {
	getState: () => ipcRenderer.invoke('state:get'),
	saveAccount: (payload) => ipcRenderer.invoke('account:save', payload),
	deleteAccount: (id) => ipcRenderer.invoke('account:delete', id),
	moveAccount: (id, direction) => ipcRenderer.invoke('account:move', id, direction),
	hideAccount: (id, hide) => ipcRenderer.invoke('account:hide', id, hide),
	setClawdHooks: (id, on) => ipcRenderer.invoke('clawd:hooks', id, on),
	connect: (id) => ipcRenderer.invoke('account:connect', id),
	refresh: (id) => ipcRenderer.invoke('cards:refresh', id),
	saveSettings: (values) => ipcRenderer.invoke('settings:save', values),
	saveLayout: (section, data) => ipcRenderer.invoke('layout:save', section, data),
	saveSectionOrder: (order) => ipcRenderer.invoke('layout:sections', order),
	openLink: (url) => ipcRenderer.invoke('link:open', url),
	checkForUpdates: () => ipcRenderer.invoke('update:check'),
	installUpdate: () => ipcRenderer.invoke('update:install'),
	onUpdate: (callback) => {
		ipcRenderer.on('update:status', (_event, status) => callback(status));
	},
	onClawd: (callback) => {
		ipcRenderer.on('clawd:activity', (_event, update) => callback(update));
	},
	onCard: (callback) => {
		ipcRenderer.on('card:update', (_event, card) => callback(card));
	},
});
