'use strict';
/**
 * preload.js — Secure IPC bridge
 *
 * Exposes a minimal, allow-listed `window.ph` API to the renderer.
 * contextIsolation is ON — renderer has no access to Node.js or Electron internals.
 *
 * Security notes:
 * - Only explicitly listed channels can be used
 * - No password or raw session token is ever sent to the renderer
 * - Event listeners are cleaned up via ph.off()
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ph', {
  // ── Auth ──────────────────────────────────────────────────────────────────
  login:              (creds)   => ipcRenderer.invoke('auth:login', creds),
  logout:             ()        => ipcRenderer.invoke('auth:logout'),
  getSavedSession:    ()        => ipcRenderer.invoke('auth:saved-session'),

  // ── Queue ─────────────────────────────────────────────────────────────────
  getQueue:           ()        => ipcRenderer.invoke('queue:get'),
  getPending:         ()        => ipcRenderer.invoke('queue:get-pending'),
  getHistory:         ()        => ipcRenderer.invoke('queue:get-history'),

  // ── Orders ────────────────────────────────────────────────────────────────
  printOrder:   (orderId, opts) => ipcRenderer.invoke('order:print',   { orderId, printOptions: opts }),
  previewOrder:       (orderId) => ipcRenderer.invoke('order:preview', orderId),
  cancelOrder:        (orderId) => ipcRenderer.invoke('order:cancel',  orderId),
  reprintOrder: (orderId, opts) => ipcRenderer.invoke('order:reprint', { orderId, printOptions: opts }),
  deleteOrder:        (orderId) => ipcRenderer.invoke('order:delete',  orderId),

  // ── Printers ──────────────────────────────────────────────────────────────
  listPrinters:       ()        => ipcRenderer.invoke('printers:list'),
  getDefaultPrinter:  ()        => ipcRenderer.invoke('printers:get-default'),
  setDefaultPrinter:  (name)    => ipcRenderer.invoke('printers:set-default', name),
  getPrinterSettings: ()        => ipcRenderer.invoke('printers:get-settings'),
  savePrinterSettings:(settings)=> ipcRenderer.invoke('printers:save-settings', settings),

  // ── App settings ──────────────────────────────────────────────────────────
  getSettings:  ()              => ipcRenderer.invoke('settings:get'),
  saveSettings: (s)             => ipcRenderer.invoke('settings:save', s),
  openLogs:     ()              => ipcRenderer.invoke('logs:open'),

  // ── Shop ──────────────────────────────────────────────────────────────────
  getShop:        ()            => ipcRenderer.invoke('shop:get'),
  setShopStatus:  (status)      => ipcRenderer.invoke('shop:set-status', status),

  // ── Push events from main process ─────────────────────────────────────────
  on: (channel, cb) => {
    const ALLOWED = [
      'new-order',
      'order-updated',
      'job-start',
      'job-done',
      'job-failed',
      'queue-changed',
      'realtime-status',
      'shop-loaded',
      'nav',
    ];
    if (ALLOWED.includes(channel)) {
      ipcRenderer.on(channel, (_, data) => cb(data));
    }
  },
  off: (channel) => ipcRenderer.removeAllListeners(channel),
});
