# Printhub — Features & Setup Guide

Complete reference for what's built, what's pending, and how to run everything.

---

## ✅ Features Built & Working

### Customer Site (index.html)
- Upload PDF only — file type validated on selection
- Drag and drop file upload
- Automatic PDF page count using PDF.js — no server needed
- Print settings — B&W or Colour, A4/A3/Letter, Single/Double-sided, Copies 1–99
- Special instructions text field
- Priority printing toggle (+₹7, jumps near top of queue)
- Live shop list from Supabase — shows Open / Busy / Paused status
- Accurate cost shown before payment — pages × copies × price
- Online payment via Razorpay (UPI, card, wallet)
- Offline payment option — pay cash at shop
- Anonymous ordering — no login or account required
- Token generation — A00 to Z99 format, resets daily per shop
- Order stored in Supabase with full metadata
- Live order tracking by token — no login needed
- Token search on landing page and dedicated track screen
- Real-time status updates via Supabase Realtime (queued → printing → completed)
- Status timeline with live steps — Paid, Queued, Printing, Ready to collect
- Hero landing page with pricing and how-it-works section
- Fully responsive — works on mobile and desktop

### Shopkeeper Dashboard (shopkeeper.html)
- Login with owner account — admin creates owner accounts
- Auto-login on revisit via Supabase session
- Live print queue with real-time updates
- Priority jobs visually highlighted in queue
- Manual print trigger per job
- Mark job as printing / completed / failed
- Retry failed jobs — up to 3 attempts
- Auto-print toggle on/off
- Shop status control — Open / Busy / Paused / Offline
- Today's stats — queue count, completed, revenue, failed jobs
- Order history — today / this week / this month tabs
- Analytics — daily print count and revenue bar charts
- Revenue split display — ₹2 shop, ₹1 Printhub
- Printer management — add printer, toggle auto-print per printer
- Shop info edit — name and address editable inline
- Shop code display for offline mode
- New order real-time notifications
- First-run shop registration modal for new owners

### Admin Dashboard (admin.html)
- Admin-only login with role check
- Auto-login on revisit
- Platform stats — total revenue, commission, shop payouts, priority revenue
- Total users, active shops, today's orders, failed jobs count
- Recent orders table on dashboard
- Analytics charts — daily orders, revenue, priority jobs, new signups (7/30/90 days)
- Top shops by revenue table
- All orders — filter by status, search by token/file/shop
- Order detail modal — full breakdown with revenue split
- All shops — view details, block/unblock
- Register new shop — auto-assigns owner role
- All users — role management (customer/owner/admin)
- Failed jobs monitor — requeue failed orders in one click
- Shop detail modal and user detail modal

### Electron Desktop App (printhub-electron)
- Runs silently in system tray on Windows/Mac/Linux
- Auto-login and auto-connect on PC startup
- Supabase Realtime listener for new orders
- Auto-downloads PDF to OS temp folder — never Desktop or Documents
- Sends to physical printer — Windows via SumatraPDF + PowerShell fallback, Mac/Linux via lpr/CUPS
- Priority queue — priority jobs move ahead of normal jobs
- Auto-print toggle without closing app
- Manual print trigger from UI
- Auto-retry on failure — up to 3 times with 5s/10s/15s backoff
- Temp file deleted automatically after successful print
- Temp folder cleaned on startup — removes files older than 1 hour
- Desktop notification for each job event
- Queue UI with state, token, file name, settings, retry count
- History tab for completed and failed jobs
- Settings — printer selector, auto-print, notifications, max retries
- Shop status control from app
- Realtime connection indicator in titlebar
- Secure architecture — contextIsolation true, nodeIntegration false
- Tray icon crash-safe — falls back to empty icon if assets folder missing

### Database (supabase-schema.sql)
- Tables — profiles, shops, orders, printers, print_jobs, analytics, token_counters
- Row Level Security on all tables
- Anonymous order inserts allowed — no login needed for customers
- Shop owners can only access their own shop's orders
- get_next_token() function — A00 to Z99, resets daily per shop (SECURITY DEFINER)
- handle_new_user() trigger — auto-creates profile on signup
- update_updated_at() trigger — keeps orders.updated_at accurate
- Revenue split stored per order — amount_total, amount_shop, amount_platform
- Priority fee stored separately — 100% goes to platform

---

## ❌ Not Yet Built — Pending

### Phase 2 — Security & Payment (important before going live)

- Razorpay server-side order creation via Supabase Edge Function
  Currently amount is set client-side — a user could alter it in browser devtools
  Fix: create Razorpay order on server, pass order_id to frontend

- PDF page count server-side verification
  PDF.js counts pages client-side but nothing stops a tampered request
  Fix: Edge Function recounts pages after upload and updates order

- Razorpay webhook verification
  Currently relies on client payment callback — no server-side signature check
  Fix: Edge Function verifies webhook signature before marking order paid

- Refund flow
  If print fails after payment, no way to refund currently
  Need: Razorpay refund API call + order status = refunded

### Phase 2 — Print Features

- Print overlay / watermark
  Per original spec: add token + paid/unpaid stamp (■ A24 or □ B07) to top-left corner
  Must not modify original file — generate a temporary printable copy

- Offline nearby transfer mode
  Shopkeeper enables local Electron server
  Customer connects on same WiFi/hotspot and transfers file directly
  No internet needed — print job goes straight to queue
  Shop code (e.g. PH-2041) used for pairing

- Printer capability detection
  Detect colour support, duplex, paper sizes from OS printer driver
  Prevent sending colour job to B&W-only printer

- Paper jam / toner low detection
  Read printer error state and pause queue automatically
  Resume when error is cleared

- Manual approval mode
  Toggle exists in shopkeeper UI but logic is not wired
  When enabled: owner must confirm each job before it prints

- Multi-printer routing
  Assign jobs to fastest/least busy printer automatically
  Small jobs → Printer 1, large jobs → Printer 2

### Phase 2 — Customer Experience

- SMS / WhatsApp receipt after order
  Customer has no account so they can lose their token
  Send token + shop name via SMS or WhatsApp after payment

- One-click reprint
  Customer enters old token → same settings reloaded → pay again → print

- Queue wait time estimate
  Show "Est. wait: 4 mins" based on pages ahead and average printer speed

- Duplicate upload detection
  Hash-based check to prevent printing same PDF twice accidentally

### Phase 2 — Admin & Shopkeeper

- Daily/monthly revenue CSV export for shopkeeper
- Platform revenue export for admin
- Shop approval system — new shops require admin approval
- Abuse prevention — upload rate limiting per IP
- Invoice/receipt PDF generation per order

### Phase 3 — Future

- Mobile app — React Native or PWA
- Dynamic priority pricing — higher fee when queue is long
- AI print optimization — auto-detect orientation, remove blank pages
- Campus network — multiple shops under one college
- Student subscription plans — monthly print credits
- Multi-language support — Tamil, Hindi, Malayalam
- Crash recovery — recover queue state after Electron crash
- Offline sync — sync analytics and payments when internet reconnects

---

## Files — What to Edit

| File | What to change |
|---|---|
| index.html | SUPABASE_URL, SUPABASE_ANON_KEY, RAZORPAY_KEY |
| shopkeeper.html | SUPABASE_URL, SUPABASE_ANON_KEY |
| admin.html | SUPABASE_URL, SUPABASE_ANON_KEY |
| supabase-schema.sql | Run once in Supabase SQL Editor, do not edit |
| electron/src/main.js | SUPABASE_URL, SUPABASE_ANON_KEY |

---

## Setup — Step by Step

### 1. Supabase (5 min)
1. Go to https://supabase.com → New project
2. Settings → API → copy Project URL and anon public key
3. SQL Editor → paste entire supabase-schema.sql → Run
4. Storage → New bucket → name: print-files → Private
5. Inside bucket → Policies → add INSERT policy (true) and SELECT policy (true)

### 2. Add keys to HTML files
Open each file in a text editor and replace near the bottom inside the script tag:

  const SUPABASE_URL      = 'https://YOUR_PROJECT.supabase.co';
  const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY';
  const RAZORPAY_KEY      = 'rzp_test_YOUR_KEY';   (index.html only)

### 3. Razorpay
1. Go to https://razorpay.com → Sign up
2. Settings → API Keys → Generate test key
3. Copy Key ID starting with rzp_test_ → paste into index.html

### 4. Create admin account
In Supabase: Authentication → Users → Add user (email + password)
Then in SQL Editor run:
  UPDATE public.profiles SET role = 'admin' WHERE email = 'your@email.com';

### 5. Deploy websites — Vercel (free)
1. Go to https://vercel.com → New project
2. Drag the printhub-user folder → Deploy
3. Your URLs:
   your-site.vercel.app/index.html        customer site
   your-site.vercel.app/shopkeeper.html   shop dashboard
   your-site.vercel.app/admin.html        admin panel

Local testing:
  npx serve printhub-user
  Opens at http://localhost:3000

### 6. Register a shop
Open admin.html → login → Shops → Register shop
Enter: owner email (must exist in Supabase Auth), shop name, address, shop code
Owner role is assigned automatically.

### 7. Electron desktop app

Requirements: Node.js v18+ from https://nodejs.org
Windows only: SumatraPDF from https://www.sumatrapdfreader.org

  cd printhub-electron
  (open src/main.js → add SUPABASE_URL and SUPABASE_ANON_KEY)
  npm install
  npm run dev

First launch:
1. Login with shop owner account
2. Settings → Default Printer → select physical printer
3. Toggle Auto-print ON
4. Minimize to tray — runs automatically from now on

Build installer:
  npm run build:win    Windows .exe → dist/
  npm run build:mac    macOS .dmg
  npm run build:linux  Linux AppImage

---

## Pricing

| Type | Price | Shop gets | Printhub gets |
|---|---|---|---|
| B&W per page | Rs.3 | Rs.2 | Rs.1 |
| Colour per page | Rs.5 | Rs.3.33 | Rs.1.67 |
| Priority fee (flat) | Rs.7 | Rs.0 | Rs.7 |

Page count is detected automatically from PDF — users cannot fake it.

---

## Full Flow

Customer uploads PDF
  PDF.js counts pages automatically
  Customer picks settings + shop + pays via Razorpay
  File uploaded to Supabase Storage (private bucket)
  Token generated A24 etc. via get_next_token()
  Order created in Supabase DB
  Supabase Realtime fires to:
    Shopkeeper web dashboard (shows in live queue)
    Electron desktop app (auto-downloads + prints)
  Electron: download → temp folder → printer → delete temp
  Order status: queued → printing → completed
  Customer tracks live with token on website

---

## Common Issues

| Problem | Fix |
|---|---|
| Upload fails | Check bucket name is print-files and INSERT policy is set to true |
| No shops showing | Register a shop via admin, ensure status is not offline |
| Token always A00 | Re-run supabase-schema.sql — get_next_token function may be missing |
| Electron no printers | Ensure printer is visible in Windows Settings → Printers |
| Realtime shows Offline | Check internet and that Supabase project is not paused |
| Admin login denied | Run the SQL UPDATE to set role = admin for your account |
| Payment opens but order fails | Check RAZORPAY_KEY and Supabase keys are correct in index.html |
