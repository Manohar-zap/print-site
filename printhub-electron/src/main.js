'use strict';
/**
 * main.js — Electron main process
 *
 * Manual print operator console for PrintHub.
 * No automatic printing. The shopkeeper controls every job.
 *
 * Security model:
 * - contextIsolation: true, nodeIntegration: false
 * - Only the anon Supabase key is used (never a service-role key)
 * - Sessions are stored as JWT tokens via electron-store, never as plaintext passwords
 * - IPC inputs are validated before processing
 */

const {
  app,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
  Notification,
  shell,
  dialog,
} = require('electron');
const path   = require('path');
const Store  = require('electron-store');
const { createClient } = require('@supabase/supabase-js');
const ws     = require('ws');

const config       = require('./config');
const PrintQueue   = require('./queue/PrintQueue');
const PrinterService = require('./printer/PrinterService');

// ── Global error capture ────────────────────────────────────────────────────

process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
  // Don't quit — stay alive so the tray is still accessible
});

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

// ── Dev mode flag ────────────────────────────────────────────────────────────
const isDev = process.argv.includes('--dev');

// ── Persistent store (never stores passwords — only session tokens) ──────────
const store = new Store({
  name: 'printhub-config',
  encryptionKey: 'ph-2025-xk', // obfuscation layer; real security = OS user account
});

// ── App state ────────────────────────────────────────────────────────────────
let mainWindow     = null;
let tray           = null;
let sb             = null;
let realtimeChannel = null;
let printQueue     = null;
let printerService = null;
let currentShop    = null;

// ── Single instance lock ─────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}
app.on('second-instance', () => {
  if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
});

// ── Config validation ────────────────────────────────────────────────────────
const configErrors = config.validate();

// ── Window ───────────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width:  1100,
    height: 720,
    minWidth:  900,
    minHeight: 600,
    backgroundColor: '#0a0a0a',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      nodeIntegration:  false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
      // Prevent navigation to arbitrary URLs
      allowRunningInsecureContent: false,
    },
    show: false,
    icon: path.join(__dirname, '../assets/icon.ico'),
  });

  // Prevent renderer navigating away from the app
  mainWindow.webContents.on('will-navigate', (e, url) => {
    const appUrl = mainWindow.webContents.getURL();
    if (url !== appUrl) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  // Block new-window / window.open calls
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));

  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.on('close', (e) => {
    if (!app.isQuiting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
}

// ── Tray ─────────────────────────────────────────────────────────────────────
function createTray() {
  const iconPath = path.join(__dirname, '../assets/tray.png');
  let img;
  try {
    img = nativeImage.createFromPath(iconPath);
    if (img.isEmpty()) throw new Error('empty');
    img = img.resize({ width: 16, height: 16 });
  } catch {
    img = nativeImage.createEmpty();
  }
  tray = new Tray(img);

  const rebuildMenu = () => {
    const shopName = currentShop?.name || 'Not connected';
    const pending  = printQueue?.pendingCount() || 0;
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: `Printhub — ${shopName}`, enabled: false },
      { label: `${pending} pending order${pending !== 1 ? 's' : ''}`, enabled: false },
      { type: 'separator' },
      { label: 'Open dashboard', click: () => { mainWindow.show(); mainWindow.focus(); } },
      { label: 'Open settings',  click: () => { mainWindow.show(); mainWindow.webContents.send('nav', 'settings'); } },
      { type: 'separator' },
      { label: 'Quit Printhub', click: () => { app.isQuiting = true; app.quit(); } },
    ]));
  };

  rebuildMenu();
  tray.setToolTip('Printhub Print Dashboard');
  tray.on('double-click', () => { mainWindow.show(); mainWindow.focus(); });
  setInterval(rebuildMenu, 30_000);
}

// ── Realtime ──────────────────────────────────────────────────────────────────
function shouldTrackOrder(order) {
  return order.payment_status === 'paid' || order.payment_mode === 'offline';
}

function subscribeToShop(shopId) {
  if (realtimeChannel) sb.removeChannel(realtimeChannel);

  realtimeChannel = sb.channel(`desktop-shop-${shopId}`)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'orders',
      filter: `shop_id=eq.${shopId}`,
    }, (payload) => {
      const order = payload.new;
      console.log('[realtime] New order:', order.token, order.file_name);
      mainWindow?.webContents.send('new-order', order);
      if (store.get('settings')?.notifications !== false) {
        showNotification(`New order ${order.token}`, `${order.file_name} — click Print when ready`);
      }
      if (shouldTrackOrder(order)) printQueue.add(order);
    })
    .on('postgres_changes', {
      event: 'UPDATE', schema: 'public', table: 'orders',
      filter: `shop_id=eq.${shopId}`,
    }, (payload) => {
      printQueue.syncOrder(payload.new);
      mainWindow?.webContents.send('order-updated', payload.new);
      // Unpaid order that just got paid → add to queue
      if (payload.new.payment_status === 'paid' && payload.old.payment_status === 'unpaid') {
        printQueue.add(payload.new);
      }
    })
    .subscribe((status) => {
      console.log('[realtime] status:', status);
      mainWindow?.webContents.send('realtime-status', status);
    });
}

// ── Notifications ─────────────────────────────────────────────────────────────
function showNotification(title, body) {
  if (Notification.isSupported()) {
    new Notification({ title, body, silent: false }).show();
  }
}

/** Show a native error dialog. Safe to call before window is visible. */
function showPrintError(title, detail) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    dialog.showMessageBox(mainWindow, {
      type: 'error', title, message: title, detail, buttons: ['OK'],
    });
  } else {
    // Fall back to a non-modal dialog when called before window is ready
    dialog.showErrorBox(title, detail);
  }
}

// ── Session helpers ───────────────────────────────────────────────────────────

/**
 * Store Supabase session tokens (access + refresh) securely.
 * Never stores the user's password.
 */
function saveSession(session) {
  if (!session) { store.delete('session'); return; }
  store.set('session', {
    access_token:  session.access_token,
    refresh_token: session.refresh_token,
    expires_at:    session.expires_at,
    user:          { id: session.user?.id, email: session.user?.email },
  });
}

function clearSession() {
  store.delete('session');
}

/**
 * After a successful login/session restore, wire up the shop, queue, and
 * realtime subscription — then notify the renderer.
 */
async function onAuthenticated(user) {
  const { data: shop, error: shopErr } = await sb
    .from('shops')
    .select('*')
    .eq('owner_id', user.id)
    .single();

  if (shopErr || !shop) {
    console.warn('[auth] No shop for user:', user.email, shopErr?.message);
    return null;
  }

  currentShop = shop;
  subscribeToShop(shop.id);
  printQueue.setShop(shop, sb);
  mainWindow?.webContents.send('shop-loaded', shop);
  return shop;
}

// ── IPC: Auth ─────────────────────────────────────────────────────────────────

ipcMain.handle('auth:login', async (_, { email, password }) => {
  if (typeof email !== 'string' || typeof password !== 'string') {
    return { ok: false, error: 'Invalid credentials format' };
  }
  try {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, error: error.message };

    saveSession(data.session);
    const shop = await onAuthenticated(data.user);
    if (!shop) {
      clearSession();
      await sb.auth.signOut();
      return { ok: false, error: 'No shop found for this account. Ask your admin to register your shop.' };
    }
    return { ok: true, shop, user: { id: data.user.id, email: data.user.email } };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('auth:logout', async () => {
  clearSession();
  await sb.auth.signOut().catch(() => {});
  currentShop = null;
  if (realtimeChannel) sb.removeChannel(realtimeChannel);
  printQueue.clear();
  return { ok: true };
});

/** Returns stored session metadata (no password, no plaintext secret). */
ipcMain.handle('auth:saved-session', () => {
  const s = store.get('session');
  if (!s) return null;
  return { user: s.user, expires_at: s.expires_at };
});

// ── IPC: Queue ────────────────────────────────────────────────────────────────

ipcMain.handle('queue:get',         () => printQueue.getAll());
ipcMain.handle('queue:get-pending', () => printQueue.getPending());
ipcMain.handle('queue:get-history', () => printQueue.getHistory());

// ── IPC: Orders ───────────────────────────────────────────────────────────────

ipcMain.handle('order:print', async (_, { orderId, printOptions }) => {
  if (typeof orderId !== 'string') return { ok: false, error: 'Invalid orderId' };
  const result = await printQueue.printOrder(orderId, printOptions || {});
  if (!result.ok) showPrintError('Print failed', result.error);
  return result;
});

ipcMain.handle('order:preview', async (_, orderId) => {
  if (typeof orderId !== 'string') return { ok: false, error: 'Invalid orderId' };
  const res = await printQueue.preview(orderId);
  if (!res.ok) showPrintError('Preview failed', res.error);
  return res;
});

ipcMain.handle('order:cancel', async (_, orderId) => {
  if (typeof orderId !== 'string') return { ok: false, error: 'Invalid orderId' };
  return printQueue.cancel(orderId);
});

ipcMain.handle('order:reprint', async (_, { orderId, printOptions }) => {
  if (typeof orderId !== 'string') return { ok: false, error: 'Invalid orderId' };
  const result = await printQueue.reprint(orderId, printOptions || {});
  if (!result.ok) showPrintError('Reprint failed', result.error);
  return result;
});

ipcMain.handle('order:delete', async (_, orderId) => {
  if (typeof orderId !== 'string') return { ok: false, error: 'Invalid orderId' };
  return printQueue.deleteOrder(orderId);
});

// ── IPC: Printers ─────────────────────────────────────────────────────────────

ipcMain.handle('printers:list', async () => printerService.listPrinters());
ipcMain.handle('printers:get-default', () => store.get('defaultPrinter') || null);
ipcMain.handle('printers:set-default', (_, name) => {
  if (typeof name !== 'string') return { ok: false, error: 'Invalid printer name' };
  store.set('defaultPrinter', name);
  return { ok: true };
});
ipcMain.handle('printers:get-settings', () => (
  store.get('printerSettings') || {
    paperSize: 'A4', copies: 1, colorMode: 'bw', sides: 'single', orientation: 'portrait',
  }
));
ipcMain.handle('printers:save-settings', (_, settings) => {
  if (typeof settings !== 'object' || settings === null) {
    return { ok: false, error: 'Invalid settings' };
  }
  store.set('printerSettings', settings);
  return { ok: true };
});

// ── IPC: App settings ─────────────────────────────────────────────────────────

ipcMain.handle('settings:get', () => store.get('settings') || { notifications: true });
ipcMain.handle('settings:save', (_, s) => {
  if (typeof s !== 'object' || s === null) return { ok: false, error: 'Invalid settings' };
  store.set('settings', s);
  return { ok: true };
});
ipcMain.handle('logs:open', () => shell.openPath(app.getPath('userData')));

// ── IPC: Shop ─────────────────────────────────────────────────────────────────

ipcMain.handle('shop:get', () => currentShop);
ipcMain.handle('shop:set-status', async (_, status) => {
  const VALID_STATUSES = ['open', 'busy', 'paused', 'offline'];
  if (!VALID_STATUSES.includes(status)) return { ok: false, error: 'Invalid status' };
  if (!currentShop) return { ok: false, error: 'Not logged in' };
  const { error } = await sb.from('shops').update({ status }).eq('id', currentShop.id);
  if (error) return { ok: false, error: error.message };
  currentShop.status = status;
  return { ok: true };
});

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  // Validate config before doing anything else
  if (configErrors.length > 0) {
    const msg = [
      'PrintHub cannot start because the Supabase configuration is missing or invalid.',
      '',
      'Issues found:',
      ...configErrors.map(e => `  • ${e}`),
      '',
      'To fix this:',
      '1. Copy .env.example to .env in the app folder',
      '2. Fill in your SUPABASE_URL and SUPABASE_ANON_KEY',
      '3. Restart the application',
    ].join('\n');
    dialog.showErrorBox('Configuration Error', msg);
    app.quit();
    return;
  }

  // Initialise Supabase
  sb = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
    realtime: { transport: ws },
    auth: { autoRefreshToken: true, persistSession: false /* we manage this ourselves */ },
  });

  // Listen for session changes to keep our token store in sync
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'TOKEN_REFRESHED' && session) saveSession(session);
    if (event === 'SIGNED_OUT') clearSession();
  });

  printerService = new PrinterService(store);
  printQueue = new PrintQueue(sb, printerService, store, {
    onJobStart:    (job)      => mainWindow?.webContents.send('job-start', job),
    onJobDone:     (job)      => {
      mainWindow?.webContents.send('job-done', job);
      if (store.get('settings')?.notifications !== false) {
        showNotification(`Printed ${job.token}`, job.file_name);
      }
    },
    onJobFailed:   (job, err) => {
      mainWindow?.webContents.send('job-failed', { job, error: err });
      showPrintError(`Print failed — ${job.token}`, err);
    },
    onQueueChange: ()         => mainWindow?.webContents.send('queue-changed', printQueue.getAll()),
  });

  createWindow();
  createTray();

  // Attempt silent session restore using stored tokens (no password needed)
  const savedSession = store.get('session');
  if (savedSession?.refresh_token) {
    try {
      const { data, error } = await sb.auth.setSession({
        access_token:  savedSession.access_token,
        refresh_token: savedSession.refresh_token,
      });
      if (!error && data?.session && data?.user) {
        saveSession(data.session); // update with refreshed tokens
        await onAuthenticated(data.user);
        console.log('[auth] Session restored for:', data.user.email);
      } else {
        console.warn('[auth] Session restore failed:', error?.message);
        clearSession();
      }
    } catch (e) {
      console.warn('[auth] Session restore error:', e.message);
      clearSession();
    }
  }
});

// Keep app alive when all windows close (tray app)
app.on('window-all-closed', () => {});

app.on('before-quit', () => {
  app.isQuiting = true;
  if (realtimeChannel) sb?.removeChannel(realtimeChannel);
  printerService?.destroy();
});
