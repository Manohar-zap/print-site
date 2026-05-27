const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const fetch = require('node-fetch');
const { app } = require('electron');

const QUEUE_STATES = {
  WAITING: 'waiting',
  DOWNLOADING: 'downloading',
  PRINTING: 'printing',
  DONE: 'done',
  FAILED: 'failed',
  SKIPPED: 'skipped',
};

class PrintQueue {
  constructor(sb, printerService, store, callbacks = {}) {
    this.sb = sb;
    this.printerService = printerService;
    this.store = store;
    this.callbacks = callbacks;
    this.shop = null;
    this.jobs = [];           // in-memory queue
    this.processing = false;
    this.autoPrint = store.get('autoPrint') ?? true;
    this.tempDir = path.join(os.tmpdir(), 'printhub');
    fs.ensureDirSync(this.tempDir);
    this._cleanTempDir(); // clean stale files on boot
  }

  // ── SETUP ───────────────────────────────────────────────────────────────────
  setShop(shop, sb) {
    this.shop = shop;
    this.sb = sb;
    this.autoPrint = shop.auto_print;
    this._loadPendingJobs(); // load any queued jobs from DB on reconnect
  }

  setAutoPrint(val) {
    this.autoPrint = val;
    this.store.set('autoPrint', val);
    if (val) this._processNext(); // start processing if just enabled
  }

  // ── QUEUE MANAGEMENT ────────────────────────────────────────────────────────
  add(order) {
    // Prevent duplicates
    if (this.jobs.find(j => j.orderId === order.id)) return;

    const job = {
      orderId: order.id,
      token: order.token,
      file_name: order.file_name,
      file_url: order.file_url,
      copies: order.copies || 1,
      colorMode: order.color_mode || 'bw',
      paperSize: order.paper_size || 'A4',
      sides: order.sides || 'single',
      isPriority: order.is_priority || false,
      state: QUEUE_STATES.WAITING,
      retries: 0,
      maxRetries: this.store.get('settings')?.maxRetries || 3,
      addedAt: Date.now(),
      tempFile: null,
    };

    // Priority jobs go to front (after any currently printing job)
    if (job.isPriority) {
      const printingIdx = this.jobs.findIndex(j => j.state === QUEUE_STATES.PRINTING);
      this.jobs.splice(printingIdx + 1, 0, job);
    } else {
      this.jobs.push(job);
    }

    this.callbacks.onQueueChange?.();

    if (this.autoPrint && !this.processing) {
      this._processNext();
    }
  }

  getAll() { return this.jobs; }
  length() { return this.jobs.filter(j => j.state === QUEUE_STATES.WAITING || j.state === QUEUE_STATES.DOWNLOADING).length; }
  clear() { this.jobs = []; }

  // ── MANUAL TRIGGERS ─────────────────────────────────────────────────────────
  async printNow(orderId) {
    const job = this.jobs.find(j => j.orderId === orderId);
    if (!job) return { ok: false, error: 'Job not found' };
    if (job.state === QUEUE_STATES.PRINTING) return { ok: false, error: 'Already printing' };
    job.state = QUEUE_STATES.WAITING;
    await this._executeJob(job);
    return { ok: true };
  }

  skip(orderId) {
    const job = this.jobs.find(j => j.orderId === orderId);
    if (job) {
      job.state = QUEUE_STATES.SKIPPED;
      this._cleanup(job);
    }
    this.callbacks.onQueueChange?.();
    return { ok: true };
  }

  async retry(orderId) {
    const job = this.jobs.find(j => j.orderId === orderId);
    if (!job) return { ok: false, error: 'Job not found' };
    if (job.retries >= job.maxRetries) return { ok: false, error: 'Max retries reached' };
    job.state = QUEUE_STATES.WAITING;
    job.retries++;
    this.callbacks.onQueueChange?.();
    if (!this.processing) await this._processNext();
    return { ok: true };
  }

  // ── LOAD PENDING JOBS FROM DB ────────────────────────────────────────────────
  async _loadPendingJobs() {
    if (!this.shop) return;
    const { data } = await this.sb.from('orders')
      .select('*')
      .eq('shop_id', this.shop.id)
      .in('status', ['queued', 'paid'])
      .order('is_priority', { ascending: false })
      .order('created_at', { ascending: true });

    if (data?.length) {
      data.forEach(o => this.add(o));
      console.log(`[queue] Loaded ${data.length} pending jobs from DB`);
    }
  }

  // ── PROCESS LOOP ─────────────────────────────────────────────────────────────
  async _processNext() {
    if (this.processing) return;
    if (!this.autoPrint) return;

    const job = this.jobs.find(j => j.state === QUEUE_STATES.WAITING);
    if (!job) return;

    this.processing = true;
    await this._executeJob(job);
    this.processing = false;

    // Continue processing remaining jobs
    const hasMore = this.jobs.some(j => j.state === QUEUE_STATES.WAITING);
    if (hasMore) setTimeout(() => this._processNext(), 500);
  }

  // ── EXECUTE A SINGLE JOB ────────────────────────────────────────────────────
  async _executeJob(job) {
    try {
      // 1. Mark downloading
      job.state = QUEUE_STATES.DOWNLOADING;
      this.callbacks.onQueueChange?.();
      await this._updateOrderStatus(job.orderId, 'downloading');

      // 2. Download file to temp
      const tempFile = await this._downloadFile(job.file_url, job.file_name);
      job.tempFile = tempFile;

      // 3. Mark printing
      job.state = QUEUE_STATES.PRINTING;
      this.callbacks.onQueueChange?.();
      await this._updateOrderStatus(job.orderId, 'printing');
      this.callbacks.onJobStart?.(job);

      // 4. Print
      const printer = this.store.get('defaultPrinter');
      await this.printerService.printFile(tempFile, {
        printerName: printer,
        copies: job.copies,
        sides: job.sides,
        paperSize: job.paperSize,
        colorMode: job.colorMode,
      });

      // 5. Mark done
      job.state = QUEUE_STATES.DONE;
      this.callbacks.onQueueChange?.();
      await this._updateOrderStatus(job.orderId, 'completed');
      this.callbacks.onJobDone?.(job);

      // 6. Delete temp file
      this._cleanup(job);

    } catch (err) {
      console.error('[queue] Job failed:', job.token, err.message);
      job.state = QUEUE_STATES.FAILED;
      this.callbacks.onQueueChange?.();
      this.callbacks.onJobFailed?.(job, err.message);

      await this._updateOrderStatus(job.orderId, 'failed');
      await this._logError(job.orderId, err.message);

      // Auto-retry
      if (job.retries < job.maxRetries) {
        job.retries++;
        console.log(`[queue] Auto-retry ${job.retries}/${job.maxRetries} for ${job.token}`);
        setTimeout(() => {
          job.state = QUEUE_STATES.WAITING;
          this.callbacks.onQueueChange?.();
          if (!this.processing) this._processNext();
        }, 5000 * job.retries); // back-off: 5s, 10s, 15s
      }
    }
  }

  // ── DOWNLOAD FILE ───────────────────────────────────────────────────────────
  async _downloadFile(url, filename) {
    const ext = path.extname(filename) || '.pdf';
    const tmpName = `printhub_${Date.now()}${ext}`;
    const tmpPath = path.join(this.tempDir, tmpName);

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);

    const buffer = await res.buffer();
    await fs.writeFile(tmpPath, buffer);
    console.log('[queue] Downloaded to:', tmpPath);
    return tmpPath;
  }

  // ── SUPABASE STATUS UPDATE ──────────────────────────────────────────────────
  async _updateOrderStatus(orderId, status) {
    await this.sb.from('orders').update({ status }).eq('id', orderId);
  }

  async _logError(orderId, errMsg) {
    await this.sb.from('print_jobs').upsert({
      order_id: orderId,
      job_status: 'error',
      error_log: errMsg,
    });
  }

  // ── CLEANUP ─────────────────────────────────────────────────────────────────
  _cleanup(job) {
    if (job.tempFile) {
      fs.remove(job.tempFile).catch(() => {});
      job.tempFile = null;
    }
  }

  _cleanTempDir() {
    // Delete any leftover temp files older than 1 hour
    fs.readdir(this.tempDir, (err, files) => {
      if (err || !files) return;
      const oneHourAgo = Date.now() - 3600000;
      files.forEach(f => {
        const fp = path.join(this.tempDir, f);
        fs.stat(fp, (e, stat) => {
          if (!e && stat.mtimeMs < oneHourAgo) fs.remove(fp).catch(() => {});
        });
      });
    });
  }
}

module.exports = PrintQueue;
