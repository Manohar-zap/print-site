const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ph', {
  // Auth
  login: (creds) => ipcRenderer.invoke('auth:login', creds),
  logout: () => ipcRenderer.invoke('auth:logout'),
  getSavedCreds: () => ipcRenderer.invoke('auth:saved'),

  // Queue
  getQueue: () => ipcRenderer.invoke('queue:get'),
  printNow: (orderId) => ipcRenderer.invoke('queue:print-now', orderId),
  skipJob: (orderId) => ipcRenderer.invoke('queue:skip', orderId),
  retryJob: (orderId) => ipcRenderer.invoke('queue:retry', orderId),

  // Printers
  listPrinters: () => ipcRenderer.invoke('printers:list'),
  getDefaultPrinter: () => ipcRenderer.invoke('printers:get-default'),
  setDefaultPrinter: (name) => ipcRenderer.invoke('printers:set-default', name),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (s) => ipcRenderer.invoke('settings:save', s),
  openLogs: () => ipcRenderer.invoke('logs:open'),

  // Shop
  getShop: () => ipcRenderer.invoke('shop:get'),
  setShopStatus: (status) => ipcRenderer.invoke('shop:set-status', status),
  setAutoPrint: (val) => ipcRenderer.invoke('shop:set-autoprint', val),

  // Events from main → renderer
  on: (channel, cb) => {
    const allowed = [
      'new-order','order-updated','job-start','job-done',
      'job-failed','queue-changed','realtime-status','shop-loaded','nav'
    ];
    if (allowed.includes(channel)) {
      ipcRenderer.on(channel, (_, data) => cb(data));
    }
  },
  off: (channel) => ipcRenderer.removeAllListeners(channel),
});
