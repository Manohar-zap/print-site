const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const os = require("os");
const fetch = globalThis.fetch || require("node-fetch");

// Internal job states used throughout the app
const STATES = {
  PENDING: "pending",
  PRINTING: "printing",
  PRINTED: "printed",
  FAILED: "failed",
  CANCELLED: "cancelled",
};

// Map internal state → DB status string
const STATE_TO_DB = {
  [STATES.PENDING]: "queued",
  [STATES.PRINTING]: "printing",
  [STATES.PRINTED]: "completed",
  [STATES.FAILED]: "failed",
  [STATES.CANCELLED]: "cancelled",
};

// DB statuses that count as "active" (shown in queue)
const ACTIVE_STATUSES = ["pending", "paid", "queued", "printing", "failed", "downloading"];
// DB statuses that count as "history" (completed/done)
const HISTORY_STATUSES = ["completed", "cancelled"];

/** Convert a DB status string to an internal STATES value. */
function dbStatusToState(status) {
  switch (status) {
    case "completed": return STATES.PRINTED;
    case "printing":
    case "downloading": return STATES.PRINTING;
    case "failed": return STATES.FAILED;
    case "cancelled": return STATES.CANCELLED;
    default: return STATES.PENDING; // pending, paid, queued
  }
}

class PrintQueue {
  constructor(sb, printerService, store, callbacks = {}) {
    this.sb = sb;
    this.printerService = printerService;
    this.store = store;
    this.callbacks = callbacks;
    this.shop = null;
    this.jobs = [];
    this.tempDir = path.join(os.tmpdir(), "printhub");
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
    this._cleanTempDir();
  }

  setShop(shop, sb) {
    this.shop = shop;
    this.sb = sb;
    this._loadOrders();
  }

  /** Add a new order to the queue if it isn't already tracked. */
  add(order) {
    if (this.jobs.find((j) => j.orderId === order.id)) return;
    this.jobs.unshift(this._orderToJob(order));
    this.callbacks.onQueueChange?.();
  }

  /** Convert a raw Supabase order row into a job object. */
  _orderToJob(order) {
    return {
      orderId: order.id,
      token: order.token,
      file_name: order.file_name,
      file_url: order.file_url,
      customerName: order.customer_name || order.profiles?.name || null,
      copies: order.copies || 1,
      colorMode: order.color_mode || "bw",
      paperSize: order.paper_size || "A4",
      sides: order.sides || "single",
      orientation: order.orientation || "portrait",
      isPriority: order.is_priority || false,
      state: dbStatusToState(order.status),
      error: null,
      uploadedAt: order.created_at || new Date().toISOString(),
      tempFile: null,
    };
  }

  getAll() {
    return this.jobs;
  }

  getPending() {
    return this.jobs.filter(
      (j) => j.state === STATES.PENDING || j.state === STATES.PRINTING
    );
  }

  getHistory() {
    return this.jobs.filter((j) =>
      [STATES.PRINTED, STATES.FAILED, STATES.CANCELLED].includes(j.state)
    );
  }

  pendingCount() {
    return this.jobs.filter((j) => j.state === STATES.PENDING).length;
  }

  clear() {
    this.jobs.forEach((job) => this._cleanup(job));
    this.jobs = [];
  }

  /** Open a PDF preview window for an order. */
  async preview(orderId) {
    const job = this.jobs.find((j) => j.orderId === orderId);
    if (!job) return { ok: false, error: "Order not found" };

    try {
      const tempFile =
        job.tempFile || (await this._downloadFile(job.file_url, job.file_name));
      job.tempFile = tempFile;
      await this.printerService.previewPdf(tempFile, `${job.token} — ${job.file_name}`);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /**
   * Manually print an order.
   * Flow: download → verify printer → print → update DB → cleanup temp file.
   */
  async printOrder(orderId, printOptions = {}) {
    const job = this.jobs.find((j) => j.orderId === orderId);
    if (!job) return { ok: false, error: "Order not found" };
    if (job.state === STATES.PRINTING) {
      return { ok: false, error: "This order is already printing." };
    }
    if (job.state === STATES.CANCELLED) {
      return { ok: false, error: "This order was cancelled." };
    }

    // Merge per-card overrides on top of saved defaults
    const options = this.printerService.resolvePrintOptions({
      copies: printOptions.copies ?? job.copies,
      colorMode: printOptions.colorMode ?? job.colorMode,
      paperSize: printOptions.paperSize ?? job.paperSize,
      sides: printOptions.sides ?? job.sides,
      orientation: printOptions.orientation ?? job.orientation,
      printerName: printOptions.printerName,
    });

    try {
      job.state = STATES.PRINTING;
      job.error = null;
      this.callbacks.onQueueChange?.();
      await this._updateOrderStatus(job.orderId, STATES.PRINTING);
      this.callbacks.onJobStart?.(job);

      const tempFile =
        job.tempFile || (await this._downloadFile(job.file_url, job.file_name));
      job.tempFile = tempFile;

      await this.printerService.printPdf(tempFile, options);

      // Update job fields to reflect what was actually printed
      job.state = STATES.PRINTED;
      job.copies = options.copies;
      job.colorMode = options.colorMode;
      job.paperSize = options.paperSize;
      job.sides = options.sides;
      job.orientation = options.orientation;

      await this._updateOrderStatus(job.orderId, STATES.PRINTED);
      await this._logPrint(job.orderId, options.printerName);
      this._cleanup(job);
      this.callbacks.onJobDone?.(job);
      return { ok: true };
    } catch (err) {
      job.state = STATES.FAILED;
      job.error = err.message;
      await this._updateOrderStatus(job.orderId, STATES.FAILED);
      await this._logError(job.orderId, err.message);
      this.callbacks.onJobFailed?.(job, err.message);
      return { ok: false, error: err.message };
    } finally {
      this.callbacks.onQueueChange?.();
    }
  }

  /** Cancel a pending order. Cannot cancel while actively printing. */
  async cancel(orderId) {
    const job = this.jobs.find((j) => j.orderId === orderId);
    if (!job) return { ok: false, error: "Order not found" };
    if (job.state === STATES.PRINTING) {
      return { ok: false, error: "Cannot cancel while printing." };
    }

    job.state = STATES.CANCELLED;
    this._cleanup(job);
    await this._updateOrderStatus(orderId, STATES.CANCELLED);
    this.callbacks.onQueueChange?.();
    return { ok: true };
  }

  /** Remove an order from the local dashboard (does not affect DB). */
  async deleteOrder(orderId) {
    const job = this.jobs.find((j) => j.orderId === orderId);
    if (!job) return { ok: false, error: "Order not found" };
    if (job.state === STATES.PRINTING) {
      return { ok: false, error: "Cannot delete while printing." };
    }

    this._cleanup(job);
    this.jobs = this.jobs.filter((j) => j.orderId !== orderId);
    this.callbacks.onQueueChange?.();
    return { ok: true };
  }

  /**
   * Sync an order updated via realtime subscription.
   * Only updates state if the job isn't currently printing locally.
   */
  syncOrder(order) {
    const job = this.jobs.find((j) => j.orderId === order.id);
    if (job) {
      // Don't overwrite local printing state with a remote update
      if (job.state !== STATES.PRINTING) {
        job.state = dbStatusToState(order.status);
      }
      job.copies = order.copies ?? job.copies;
      job.colorMode = order.color_mode ?? job.colorMode;
      job.paperSize = order.paper_size ?? job.paperSize;
      job.sides = order.sides ?? job.sides;
    } else {
      // Order not yet tracked — add it
      this.jobs.unshift(this._orderToJob(order));
    }
    this.callbacks.onQueueChange?.();
  }

  /** Reprint a completed or failed order with optional overrides. */
  async reprint(orderId, printOptions = {}) {
    const job = this.jobs.find((j) => j.orderId === orderId);
    if (!job) return { ok: false, error: "Order not found" };

    // Reset to pending so printOrder accepts it
    if (job.state === STATES.PRINTED) {
      job.state = STATES.PENDING;
    }
    return this.printOrder(orderId, printOptions);
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  /** Load existing orders from DB on login/shop switch. */
  async _loadOrders() {
    if (!this.shop) return;

    const { data: active } = await this.sb
      .from("orders")
      .select("*, profiles(name)")
      .eq("shop_id", this.shop.id)
      .in("status", ACTIVE_STATUSES)
      .order("is_priority", { ascending: false })
      .order("created_at", { ascending: true });

    const oneDayAgo = new Date(Date.now() - 86_400_000).toISOString();
    const { data: recentHistory } = await this.sb
      .from("orders")
      .select("*, profiles(name)")
      .eq("shop_id", this.shop.id)
      .in("status", HISTORY_STATUSES)
      .gte("updated_at", oneDayAgo)
      .order("updated_at", { ascending: false })
      .limit(50);

    this.jobs = [];
    [...(active || []), ...(recentHistory || [])].forEach((order) => {
      if (!this.jobs.find((j) => j.orderId === order.id)) {
        this.jobs.push(this._orderToJob(order));
      }
    });

    this.callbacks.onQueueChange?.();
    console.log(`[queue] Loaded ${this.jobs.length} orders`);
  }

  async _downloadFile(url, filename) {
    if (!url) throw new Error("PDF file is missing for this order.");

    const ext = path.extname(filename) || ".pdf";
    const tmpPath = path.join(this.tempDir, `printhub_${Date.now()}${ext}`);

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);

    const buffer = typeof res.buffer === 'function'
      ? await res.buffer()
      : Buffer.from(await res.arrayBuffer());
    await fsp.writeFile(tmpPath, buffer);
    return tmpPath;
  }

  async _updateOrderStatus(orderId, state) {
    const status = STATE_TO_DB[state] || state;
    await this.sb.from("orders").update({ status }).eq("id", orderId);
  }

  async _logPrint(orderId, printerName) {
    await this.sb.from("print_jobs").upsert({
      order_id: orderId,
      printer: printerName,
      job_status: "completed",
      printed_at: new Date().toISOString(),
      error_log: null,
    });
  }

  async _logError(orderId, errMsg) {
    await this.sb.from("print_jobs").upsert({
      order_id: orderId,
      job_status: "error",
      error_log: errMsg,
    });
  }

  /** Delete temp PDF for a job after printing or cancellation. */
  _cleanup(job) {
    if (job.tempFile) {
      fsp.rm(job.tempFile, { force: true }).catch(() => {});
      job.tempFile = null;
    }
  }

  /** Remove leftover temp files older than 1 hour on startup. */
  _cleanTempDir() {
    fs.readdir(this.tempDir, (err, files) => {
      if (err || !files) return;
      const oneHourAgo = Date.now() - 3_600_000;
      files.forEach((f) => {
        const fp = path.join(this.tempDir, f);
        fs.stat(fp, (e, stat) => {
          if (!e && stat.mtimeMs < oneHourAgo) fsp.rm(fp, { force: true }).catch(() => {});
        });
      });
    });
  }
}

PrintQueue.STATES = STATES;
module.exports = PrintQueue;
