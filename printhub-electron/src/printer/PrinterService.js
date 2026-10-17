const { BrowserWindow } = require("electron");
const path = require("path");
const { pathToFileURL } = require("url");
const { exec } = require("child_process");

// Extra time (ms) after PDF loads before sending to printer.
// Gives the renderer time to fully render the page content.
const RENDER_DELAY_MS = 600;

/** Query Windows WMI / CimInstance for installed printers with port and connection metadata */
function getWindowsPrintersWmi() {
  if (process.platform !== "win32") return Promise.resolve([]);
  return new Promise((resolve) => {
    const cmd = `powershell -NoProfile -Command "Get-CimInstance Win32_Printer | Select-Object Name, PortName, DriverName, Network, Default, WorkOffline, PrinterStatus, ExtendedPrinterStatus | ConvertTo-Json -Compress"`;
    exec(cmd, { timeout: 3500, windowsHide: true }, (err, stdout) => {
      if (err || !stdout || !stdout.trim()) {
        resolve([]);
        return;
      }
      try {
        const parsed = JSON.parse(stdout.trim());
        const list = Array.isArray(parsed) ? parsed : [parsed];
        resolve(list.filter(Boolean));
      } catch {
        resolve([]);
      }
    });
  });
}

/** Classify printer connection type based on port, name, driver, and network flag */
function classifyPrinter(name = "", port = "", driver = "", isNetwork = false) {
  const n = (name || "").toLowerCase();
  const p = (port || "").toLowerCase();
  const d = (driver || "").toLowerCase();

  // Bluetooth
  if (
    p.includes("bth") ||
    p.includes("bluetooth") ||
    p.includes("bthenum") ||
    n.includes("bluetooth") ||
    n.includes(" bt ") ||
    n.endsWith(" bt") ||
    d.includes("bluetooth")
  ) {
    return {
      type: "bluetooth",
      typeLabel: "Bluetooth",
      icon: "🔵",
    };
  }

  // Network / Wi-Fi
  if (
    isNetwork === true ||
    p.startsWith("ip_") ||
    p.startsWith("wsd") ||
    p.startsWith("tcp") ||
    p.startsWith("http") ||
    p.startsWith("\\\\") ||
    /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(p) ||
    p.includes("wifi") ||
    p.includes("wireless") ||
    p.includes("lan") ||
    p.includes("network") ||
    n.includes("wi-fi") ||
    n.includes("wifi") ||
    n.includes("wireless") ||
    n.includes("network") ||
    d.includes("wireless") ||
    d.includes("network") ||
    d.includes("wifi")
  ) {
    return {
      type: "wifi",
      typeLabel: "Wi-Fi / Network",
      icon: "📶",
    };
  }

  // Virtual / PDF / OneNote
  if (
    p.includes("nul:") ||
    p.includes("portprompt:") ||
    p.includes("file:") ||
    n.includes("pdf") ||
    n.includes("xps") ||
    n.includes("onenote") ||
    n.includes("fax") ||
    d.includes("pdf") ||
    d.includes("xps") ||
    d.includes("onenote")
  ) {
    return {
      type: "virtual",
      typeLabel: "Virtual / PDF",
      icon: "📄",
    };
  }

  // USB
  if (
    p.startsWith("usb") ||
    p.startsWith("dot4") ||
    p.includes("usb") ||
    n.includes("usb")
  ) {
    return {
      type: "usb",
      typeLabel: "USB Cable",
      icon: "🔌",
    };
  }

  return {
    type: "other",
    typeLabel: "Local Printer",
    icon: "🖨",
  };
}

class PrinterService {
  constructor(store) {
    this.store = store;
    this._printWindow = null;
  }

  _getPrinterSettings() {
    return (
      this.store.get("printerSettings") || {
        paperSize: "A4",
        copies: 1,
        colorMode: "bw",
        sides: "single",
        orientation: "portrait",
      }
    );
  }

  /** Return the hidden BrowserWindow used for printing, creating it if needed. */
  async _ensurePrintWindow() {
    if (this._printWindow && !this._printWindow.isDestroyed()) {
      return this._printWindow;
    }

    this._printWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    return this._printWindow;
  }

  /**
   * List all printers available on this computer, identifying connection type
   * (Wi-Fi, Bluetooth, USB, Virtual) and port info.
   */
  async listPrinters() {
    const win = await this._ensurePrintWindow();
    let chromiumPrinters = [];
    try {
      chromiumPrinters = await win.webContents.getPrintersAsync();
    } catch (e) {
      console.warn("webContents.getPrintersAsync error:", e);
    }

    const wmiPrinters = await getWindowsPrintersWmi();
    const wmiMap = new Map();
    wmiPrinters.forEach((wp) => {
      if (wp.Name) {
        wmiMap.set(wp.Name.toLowerCase().trim(), wp);
      }
    });

    const result = [];
    const seenNames = new Set();

    for (const cp of chromiumPrinters) {
      const nameKey = (cp.name || "").toLowerCase().trim();
      seenNames.add(nameKey);

      const wmi = wmiMap.get(nameKey);
      const port = wmi?.PortName || cp.options?.["port-name"] || "";
      const driver = wmi?.DriverName || "";
      const isNetwork = Boolean(wmi?.Network);
      const classification = classifyPrinter(cp.name, port, driver, isNetwork);

      // Status check: Wi-Fi and Bluetooth printers in standby/sleep report status 128/1024.
      // Do not mark them offline if they are ready in Windows Spooler.
      const isWorkOffline = wmi ? Boolean(wmi.WorkOffline) : false;
      const status = isWorkOffline
        ? "offline"
        : this._isOnline(cp.status)
        ? "online"
        : "ready";

      result.push({
        name: cp.name,
        displayName: cp.displayName || cp.name,
        isDefault: Boolean(cp.isDefault || wmi?.Default),
        status,
        port,
        driver,
        type: classification.type,
        typeLabel: classification.typeLabel,
        icon: classification.icon,
      });
    }

    // Add any printers found in WMI that Chromium missed
    for (const wp of wmiPrinters) {
      if (!wp.Name) continue;
      const nameKey = wp.Name.toLowerCase().trim();
      if (!seenNames.has(nameKey)) {
        seenNames.add(nameKey);
        const classification = classifyPrinter(
          wp.Name,
          wp.PortName || "",
          wp.DriverName || "",
          Boolean(wp.Network)
        );
        result.push({
          name: wp.Name,
          displayName: wp.Name,
          isDefault: Boolean(wp.Default),
          status: wp.WorkOffline ? "offline" : "online",
          port: wp.PortName || "",
          driver: wp.DriverName || "",
          type: classification.type,
          typeLabel: classification.typeLabel,
          icon: classification.icon,
        });
      }
    }

    return result;
  }

  _isOnline(status) {
    // Chromium printer status 0 = idle/ready; 128 = standby/powersave; undefined = assumed ok
    return status === 0 || status === undefined || status === 128;
  }

  /**
   * Verify a printer exists and can be spooled to.
   * Throws a descriptive error if the printer is missing entirely.
   * @param {string} [printerName] — overrides saved default
   */
  async verifyPrinter(printerName) {
    const name = printerName || this.store.get("defaultPrinter");
    if (!name) {
      throw new Error(
        "No printer selected. Please choose a printer before printing."
      );
    }

    const printers = await this.listPrinters();
    const printer = printers.find(
      (p) =>
        p.name.toLowerCase() === name.toLowerCase() ||
        p.displayName.toLowerCase() === name.toLowerCase()
    );
    if (!printer) {
      throw new Error(`Printer "${name}" was not found on this computer.`);
    }

    // Note: Do not throw if printer status is 'ready' or 'offline'.
    // Wi-Fi and Bluetooth printers wake up automatically when a job enters the Windows spooler.
    return { name: printer.name, printer };
  }

  /**
   * Merge per-job overrides with saved defaults.
   * Order options take priority over saved defaults.
   */
  resolvePrintOptions(orderOptions = {}) {
    const saved = this._getPrinterSettings();
    const defaultPrinter = this.store.get("defaultPrinter");

    return {
      printerName: orderOptions.printerName || defaultPrinter,
      copies: orderOptions.copies ?? saved.copies ?? 1,
      sides: orderOptions.sides || saved.sides || "single",
      paperSize: orderOptions.paperSize || saved.paperSize || "A4",
      colorMode: orderOptions.colorMode || saved.colorMode || "bw",
      orientation: orderOptions.orientation || saved.orientation || "portrait",
    };
  }

  _buildPrintSettings(options) {
    return {
      silent: true,
      printBackground: true,
      deviceName: options.printerName,
      copies: Math.max(1, Number(options.copies) || 1),
      landscape: options.orientation === "landscape",
      color: options.colorMode !== "bw",
      duplexMode: options.sides === "double" ? "longEdge" : "simplex",
      pageSize: options.paperSize || "A4",
    };
  }

  /**
   * Print a PDF file using Electron's native printing API.
   * Downloads PDF → loads in hidden window → sends to printer.
   * Never uses PowerShell, SumatraPDF, or any external process.
   *
   * @param {string} filePath - Absolute path to the local PDF file
   * @param {object} orderOptions - Print options (may be partial; merged with saved defaults)
   */
  async printPdf(filePath, orderOptions = {}) {
    const options = this.resolvePrintOptions(orderOptions);
    await this.verifyPrinter(options.printerName);

    const win = await this._ensurePrintWindow();
    const fileUrl = pathToFileURL(path.resolve(filePath)).href;

    await this._loadPdf(win, fileUrl);
    await this._waitForRender();

    const printSettings = this._buildPrintSettings(options);

    return new Promise((resolve, reject) => {
      win.webContents.print(printSettings, (success, failureReason) => {
        if (success) {
          resolve({ ok: true, options });
          return;
        }
        reject(
          new Error(
            failureReason || "Print failed or was cancelled by the system."
          )
        );
      });
    });
  }

  /**
   * Open a visible preview window for a PDF.
   * The window is shown to the shopkeeper for review before printing.
   */
  async previewPdf(filePath, title = "Document preview") {
    const previewWin = new BrowserWindow({
      width: 960,
      height: 720,
      title,
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    await previewWin.loadURL(pathToFileURL(path.resolve(filePath)).href);
    return { ok: true };
  }

  _loadPdf(win, fileUrl) {
    return new Promise((resolve, reject) => {
      const onLoad = () => {
        cleanup();
        resolve();
      };
      const onFail = (_, __, desc) => {
        cleanup();
        reject(new Error(desc || "Could not load the PDF for printing."));
      };
      const cleanup = () => {
        win.webContents.removeListener("did-finish-load", onLoad);
        win.webContents.removeListener("did-fail-load", onFail);
      };

      win.webContents.on("did-finish-load", onLoad);
      win.webContents.on("did-fail-load", onFail);
      win.loadURL(fileUrl);
    });
  }

  _waitForRender() {
    return new Promise((resolve) => setTimeout(resolve, RENDER_DELAY_MS));
  }

  destroy() {
    if (this._printWindow && !this._printWindow.isDestroyed()) {
      this._printWindow.destroy();
    }
    this._printWindow = null;
  }
}

module.exports = PrinterService;
