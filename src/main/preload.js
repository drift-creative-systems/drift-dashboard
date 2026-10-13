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
	connect: (id) => ipcRenderer.invoke('account:connect', id),
	refresh: (id) => ipcRenderer.invoke('cards:refresh', id),
	saveSettings: (values) => ipcRenderer.invoke('settings:save', values),
	openLink: (url) => ipcRenderer.invoke('link:open', url),
	onCard: (callback) => {
		ipcRenderer.on('card:update', (_event, card) => callback(card));
	},
});
