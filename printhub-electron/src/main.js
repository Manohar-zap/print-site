const {
  app,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
  Notification,
  shell,
} = require("electron");
const path = require("path");
const Store = require("electron-store");
const { createClient } = require("@supabase/supabase-js");
const ws = require("ws");
const PrintQueue = require("./queue/PrintQueue");
const PrinterService = require("./printer/PrinterService");

// ── CONFIG ────────────────────────────────────────────────────────────────────
// Supabase credentials are read from environment variables to avoid committing secrets.
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

const isDev = process.argv.includes("--dev");
const store = new Store();

// ── GLOBALS ───────────────────────────────────────────────────────────────────
let mainWindow = null;
let tray = null;
let sb = null;
let realtimeChannel = null;
let printQueue = null;
let printerService = null;
let currentShop = null;

// Single instance lock
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}
app.on("second-instance", () => {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
});

// ── CREATE WINDOW ─────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 680,
    minWidth: 800,
    minHeight: 560,
    backgroundColor: "#0a0a0a",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
    show: false, // show only after ready
  });

  mainWindow.loadFile(path.join(__dirname, "renderer/index.html"));

  mainWindow.once("ready-to-show", () => {
    // Only show if not yet configured (first run) or user opened manually
    const creds = store.get("creds");
    if (!creds) mainWindow.show();
  });

  mainWindow.on("close", (e) => {
    if (!app.isQuiting) {
      e.preventDefault();
      mainWindow.hide(); // minimize to tray instead of closing
    }
  });

  if (isDev) mainWindow.webContents.openDevTools({ mode: "detach" });
}

// ── TRAY ──────────────────────────────────────────────────────────────────────
function createTray() {
  const iconPath = path.join(__dirname, "../assets/tray.png");
  let img;
  try {
    img = nativeImage.createFromPath(iconPath);
    if (img.isEmpty()) throw new Error("empty");
    img = img.resize({ width: 16, height: 16 });
  } catch {
    img = nativeImage.createEmpty(); // fallback so app doesn't crash
  }
  tray = new Tray(img);

  const rebuild = () => {
    const shopName = currentShop?.name || "Not connected";
    const qLen = printQueue?.length() || 0;
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: `Printhub — ${shopName}`, enabled: false },
        { label: `Queue: ${qLen} job${qLen !== 1 ? "s" : ""}`, enabled: false },
        { type: "separator" },
        {
          label: "Open dashboard",
          click: () => {
            mainWindow.show();
            mainWindow.focus();
          },
        },
        {
          label: "Open settings",
          click: () => {
            mainWindow.show();
            mainWindow.webContents.send("nav", "settings");
          },
        },
        { type: "separator" },
        {
          label: "Quit Printhub",
          click: () => {
            app.isQuiting = true;
            app.quit();
          },
        },
      ]),
    );
  };

  rebuild();
  tray.setToolTip("Printhub Print Service");
  tray.on("double-click", () => {
    mainWindow.show();
    mainWindow.focus();
  });
  // Rebuild tray menu every 30s so queue count stays fresh
  setInterval(rebuild, 30000);
}

// ── SUPABASE REALTIME ─────────────────────────────────────────────────────────
function subscribeToShop(shopId) {
  if (realtimeChannel) sb.removeChannel(realtimeChannel);

  realtimeChannel = sb
    .channel(`desktop-shop-${shopId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "orders",
        filter: `shop_id=eq.${shopId}`,
      },
      (payload) => {
        const order = payload.new;
        console.log("[realtime] New order:", order.token, order.file_name);

        // Notify UI
        mainWindow?.webContents.send("new-order", order);

        // System notification
        showNotification(`New order ${order.token}`, order.file_name);

        // Add to print queue
        if (
          order.payment_status === "paid" ||
          order.payment_mode === "offline"
        ) {
          printQueue.add(order);
        }
      },
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "orders",
        filter: `shop_id=eq.${shopId}`,
      },
      (payload) => {
        mainWindow?.webContents.send("order-updated", payload.new);
        // If an order just got paid, add to queue
        if (
          payload.new.payment_status === "paid" &&
          payload.old.payment_status === "unpaid"
        ) {
          printQueue.add(payload.new);
        }
      },
    )
    .subscribe((status) => {
      console.log("[realtime] status:", status);
      mainWindow?.webContents.send("realtime-status", status);
    });
}

// ── NOTIFICATIONS ─────────────────────────────────────────────────────────────
function showNotification(title, body) {
  if (Notification.isSupported()) {
    new Notification({ title, body, silent: false }).show();
  }
}

// ── IPC HANDLERS ──────────────────────────────────────────────────────────────

// LOGIN
ipcMain.handle("auth:login", async (_, { email, password }) => {
  try {
    const { data, error } = await sb.auth.signInWithPassword({
      email,
      password,
    });
    if (error) return { ok: false, error: error.message };

    // Fetch shop for this owner
    const { data: shop, error: shopErr } = await sb
      .from("shops")
      .select("*")
      .eq("owner_id", data.user.id)
      .single();
    if (shopErr || !shop)
      return { ok: false, error: "No shop found for this account" };

    currentShop = shop;
    store.set("creds", { email, password, shopId: shop.id });
    subscribeToShop(shop.id);
    printQueue.setShop(shop, sb);
    mainWindow?.webContents.send("shop-loaded", shop);
    return { ok: true, shop, user: data.user };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// LOGOUT
ipcMain.handle("auth:logout", async () => {
  await sb.auth.signOut();
  store.delete("creds");
  currentShop = null;
  if (realtimeChannel) sb.removeChannel(realtimeChannel);
  printQueue.clear();
  return { ok: true };
});

// GET SAVED CREDS (auto-login)
ipcMain.handle("auth:saved", () => store.get("creds") || null);

// GET QUEUE
ipcMain.handle("queue:get", () => printQueue.getAll());

// PRINT NOW (manual trigger)
ipcMain.handle("queue:print-now", async (_, orderId) => {
  return printQueue.printNow(orderId);
});

// SKIP / CANCEL JOB
ipcMain.handle("queue:skip", async (_, orderId) => {
  return printQueue.skip(orderId);
});

// RETRY JOB
ipcMain.handle("queue:retry", async (_, orderId) => {
  return printQueue.retry(orderId);
});

// LIST PRINTERS
ipcMain.handle("printers:list", async () => {
  return printerService.listPrinters();
});

// GET/SET DEFAULT PRINTER
ipcMain.handle(
  "printers:get-default",
  () => store.get("defaultPrinter") || null,
);
ipcMain.handle("printers:set-default", (_, name) => {
  store.set("defaultPrinter", name);
  return { ok: true };
});

// SETTINGS
ipcMain.handle(
  "settings:get",
  () =>
    store.get("settings") || {
      autoPrint: true,
      notifications: true,
      deleteTempAfterPrint: true,
      maxRetries: 3,
    },
);
ipcMain.handle("settings:save", (_, s) => {
  store.set("settings", s);
  return { ok: true };
});

// OPEN LOG FOLDER
ipcMain.handle("logs:open", () => shell.openPath(app.getPath("userData")));

// GET SHOP STATUS
ipcMain.handle("shop:get", () => currentShop);

// UPDATE SHOP STATUS
ipcMain.handle("shop:set-status", async (_, status) => {
  if (!currentShop) return { ok: false };
  await sb.from("shops").update({ status }).eq("id", currentShop.id);
  currentShop.status = status;
  return { ok: true };
});

// TOGGLE AUTO-PRINT
ipcMain.handle("shop:set-autoprint", async (_, val) => {
  if (!currentShop) return;
  await sb.from("shops").update({ auto_print: val }).eq("id", currentShop.id);
  currentShop.auto_print = val;
  store.set("autoPrint", val);
  printQueue.setAutoPrint(val);
  return { ok: true };
});

// ── APP LIFECYCLE ─────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  // Init Supabase — pass ws explicitly for Node.js 20 compatibility
  sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    realtime: { transport: ws },
  });

  // Init services
  printerService = new PrinterService(store);
  printQueue = new PrintQueue(sb, printerService, store, {
    onJobStart: (job) => {
      mainWindow?.webContents.send("job-start", job);
      showNotification(`Printing ${job.token}`, job.file_name);
    },
    onJobDone: (job) => {
      mainWindow?.webContents.send("job-done", job);
      showNotification(`Done: ${job.token}`, "Printed successfully ✓");
    },
    onJobFailed: (job, err) => {
      mainWindow?.webContents.send("job-failed", { job, error: err });
      showNotification(`Failed: ${job.token}`, err);
    },
    onQueueChange: () => {
      mainWindow?.webContents.send("queue-changed", printQueue.getAll());
    },
  });

  createWindow();
  createTray();

  // Auto-login if credentials saved
  const saved = store.get("creds");
  if (saved) {
    const { data, error } = await sb.auth.signInWithPassword({
      email: saved.email,
      password: saved.password,
    });
    if (!error && data.user) {
      const { data: shop } = await sb
        .from("shops")
        .select("*")
        .eq("owner_id", data.user.id)
        .single();
      if (shop) {
        currentShop = shop;
        subscribeToShop(shop.id);
        printQueue.setShop(shop, sb);
        mainWindow?.webContents.send("shop-loaded", shop);
        // Don't show window — run in tray silently
      }
    }
  }
});

app.on("window-all-closed", () => {
  // Keep running in tray on all platforms
});

app.on("before-quit", () => {
  app.isQuiting = true;
  if (realtimeChannel) sb?.removeChannel(realtimeChannel);
  printQueue?.clear();
});
