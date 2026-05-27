const { exec } = require('child_process');
const path = require('path');
const fs = require('fs-extra');

class PrinterService {
  constructor(store) {
    this.store = store;
  }

  // ── LIST PRINTERS ───────────────────────────────────────────────────────────
  async listPrinters() {
    return new Promise((resolve) => {
      if (process.platform === 'win32') {
        exec(
          'powershell -command "Get-Printer | Select-Object Name,DriverName,PrinterStatus | ConvertTo-Json"',
          (err, stdout) => {
            if (err) return resolve([]);
            try {
              const raw = JSON.parse(stdout);
              const list = Array.isArray(raw) ? raw : [raw];
              resolve(list.map(p => ({
                name: p.Name,
                driver: p.DriverName,
                status: p.PrinterStatus === 0 ? 'online' : 'offline',
              })));
            } catch { resolve([]); }
          }
        );
      } else if (process.platform === 'darwin') {
        exec('lpstat -p', (err, stdout) => {
          if (err) return resolve([]);
          const printers = [];
          stdout.split('\n').forEach(line => {
            const m = line.match(/^printer (\S+)/);
            if (m) printers.push({ name: m[1], status: line.includes('idle') ? 'online' : 'offline' });
          });
          resolve(printers);
        });
      } else {
        // Linux
        exec('lpstat -a 2>/dev/null', (err, stdout) => {
          if (err) return resolve([]);
          const printers = [];
          stdout.split('\n').forEach(line => {
            const m = line.match(/^(\S+)\s/);
            if (m) printers.push({ name: m[1], status: 'online' });
          });
          resolve(printers);
        });
      }
    });
  }

  // ── CHECK PRINTER ONLINE ────────────────────────────────────────────────────
  async isPrinterOnline(printerName) {
    const printers = await this.listPrinters();
    const p = printers.find(p => p.name === printerName);
    return p?.status === 'online';
  }

  // ── PRINT FILE ──────────────────────────────────────────────────────────────
  async printFile(filePath, options = {}) {
    const {
      printerName,
      copies = 1,
      sides = 'single',   // 'single' | 'double'
      paperSize = 'A4',
      colorMode = 'bw',   // 'bw' | 'colour'
    } = options;

    const printer = printerName || this.store.get('defaultPrinter');
    if (!printer) throw new Error('No printer selected. Set a default printer in Settings.');

    const online = await this.isPrinterOnline(printer);
    if (!online) throw new Error(`Printer "${printer}" is offline or not found`);

    const ext = path.extname(filePath).toLowerCase();

    if (process.platform === 'win32') {
      return this._printWindows(filePath, printer, { copies, sides, paperSize, colorMode, ext });
    } else if (process.platform === 'darwin') {
      return this._printMac(filePath, printer, { copies, sides, paperSize, colorMode });
    } else {
      return this._printLinux(filePath, printer, { copies, sides, paperSize, colorMode });
    }
  }

  // ── WINDOWS PRINT ───────────────────────────────────────────────────────────
  _printWindows(filePath, printer, opts) {
    return new Promise((resolve, reject) => {
      const { copies, sides, paperSize, colorMode, ext } = opts;

      // For PDFs: use SumatraPDF (silent print) or Adobe Reader
      // For images: use mspaint / powershell
      let cmd;

      if (ext === '.pdf') {
        // Try SumatraPDF first (best for silent PDF printing on Windows)
        const sumatraPath = '"C:\\Program Files\\SumatraPDF\\SumatraPDF.exe"';
        const duplex = sides === 'double' ? '-duplex' : '';
        cmd = `${sumatraPath} -print-to "${printer}" -print-settings "${copies}x,${paperSize}${duplex}" "${filePath}"`;

        exec(cmd, (err) => {
          if (err) {
            // Fallback: PowerShell print
            this._printWindowsPowerShell(filePath, printer, copies).then(resolve).catch(reject);
          } else {
            resolve({ ok: true, method: 'sumatra' });
          }
        });
      } else {
        // Images: use PowerShell
        this._printWindowsPowerShell(filePath, printer, copies).then(resolve).catch(reject);
      }
    });
  }

  _printWindowsPowerShell(filePath, printer, copies) {
    return new Promise((resolve, reject) => {
      const ps = `
        $file = '${filePath.replace(/'/g, "''")}';
        $printer = '${printer.replace(/'/g, "''")}';
        $copies = ${copies};
        try {
          $psi = New-Object System.Drawing.Printing.PrintDocument
          $psi.PrinterSettings.PrinterName = $printer
          $psi.PrinterSettings.Copies = $copies
          Start-Process -FilePath $file -Verb Print -Wait -WindowStyle Hidden
          exit 0
        } catch { exit 1 }
      `;
      exec(`powershell -command "${ps.replace(/\n/g,' ')}"`, (err) => {
        if (err) reject(new Error('PowerShell print failed: ' + err.message));
        else resolve({ ok: true, method: 'powershell' });
      });
    });
  }

  // ── macOS PRINT ─────────────────────────────────────────────────────────────
  _printMac(filePath, printer, opts) {
    return new Promise((resolve, reject) => {
      const { copies, sides, paperSize, colorMode } = opts;
      const sidesFlag = sides === 'double' ? '-o sides=two-sided-long-edge' : '-o sides=one-sided';
      const colorFlag = colorMode === 'bw' ? '-o ColorModel=Gray' : '';
      const cmd = `lpr -P "${printer}" -#${copies} -o media=${paperSize} ${sidesFlag} ${colorFlag} "${filePath}"`;
      exec(cmd, (err) => {
        if (err) reject(new Error('lpr failed: ' + err.message));
        else resolve({ ok: true, method: 'lpr' });
      });
    });
  }

  // ── LINUX PRINT ─────────────────────────────────────────────────────────────
  _printLinux(filePath, printer, opts) {
    return new Promise((resolve, reject) => {
      const { copies, sides, paperSize, colorMode } = opts;
      const sidesFlag = sides === 'double' ? '-o sides=two-sided-long-edge' : '-o sides=one-sided';
      const colorFlag = colorMode === 'bw' ? '-o ColorModel=Gray' : '';
      const cmd = `lpr -P "${printer}" -#${copies} -o media=${paperSize} ${sidesFlag} ${colorFlag} "${filePath}"`;
      exec(cmd, (err) => {
        if (err) reject(new Error('lpr failed: ' + err.message));
        else resolve({ ok: true, method: 'lpr' });
      });
    });
  }
}

module.exports = PrinterService;
