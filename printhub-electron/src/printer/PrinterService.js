const { BrowserWindow } = require("electron");
const path = require("path");
const { pathToFileURL } = require("url");

// Extra time (ms) after PDF loads before sending to printer.
// Gives the renderer time to fully render the page content.
const RENDER_DELAY_MS = 600;

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

  /** List all printers available on this computer. */
  async listPrinters() {
    const win = await this._ensurePrintWindow();
    const printers = await win.webContents.getPrintersAsync();
    return printers.map((p) => ({
      name: p.name,
      displayName: p.displayName || p.name,
      isDefault: p.isDefault,
      status: this._isOnline(p.status) ? "online" : "offline",
    }));
  }

  _isOnline(status) {
    // Chromium printer status 0 = idle/ready; undefined = unknown but assume ok
    return status === 0 || status === undefined;
  }

  /**
   * Verify a printer exists and is online.
   * Throws a descriptive error if the printer is missing or offline.
   * @param {string} [printerName] — overrides saved default
   */
  async verifyPrinter(printerName) {
    const name = printerName || this.store.get("defaultPrinter");
    if (!name) {
      throw new Error("No printer selected. Choose a default printer in Settings.");
    }

    const printers = await this.listPrinters();
    const printer = printers.find((p) => p.name === name);
    if (!printer) {
      throw new Error(`Printer "${name}" was not found on this computer.`);
    }
    if (printer.status !== "online") {
      throw new Error(`Printer "${name}" is offline or unavailable.`);
    }

    return { name, printer };
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
