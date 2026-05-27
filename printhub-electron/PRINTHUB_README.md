# Printhub — Complete Setup Guide

Everything you need to run the full Printhub system: user site, shopkeeper dashboard, admin panel, and desktop auto-print app.

---

## What you have

| File | What it is |
|---|---|
| `printhub-user.zip` | User site + Shopkeeper dashboard + Admin panel + Database schema |
| `printhub-electron.zip` | Desktop auto-print app for shop owners |
| `printhub-admin-final.html` | Admin dashboard (also inside user zip) |

**Inside `printhub-user.zip`:**
```
printhub-user/
├── index.html          ← Customer website (upload PDF, pay, get token)
├── shopkeeper.html     ← Shop owner web dashboard
├── admin.html          ← Admin panel (same as printhub-admin-final.html)
└── supabase-schema.sql ← Run this once in Supabase to create all tables
```

---

## Step 1 — Set up Supabase (free, 5 minutes)

1. Go to **https://supabase.com** → Sign up → New project
2. Choose a name (e.g. `printhub`), set a strong DB password, pick a region close to you
3. Wait ~2 minutes for the project to be ready

### Get your keys
Go to **Settings → API** and copy:
- **Project URL** — looks like `https://abcxyzabc.supabase.co`
- **anon public key** — long string starting with `eyJ...`

Keep these — you'll paste them into all 3 HTML files.

### Run the database schema
1. In your Supabase project go to **SQL Editor**
2. Click **New query**
3. Open `supabase-schema.sql` from the zip, copy everything, paste it in, click **Run**
4. You should see "Success. No rows returned"

### Create the storage bucket
1. Go to **Storage** in the left sidebar
2. Click **New bucket**
3. Name: `print-files`
4. Toggle **Public bucket: OFF** (keep it private)
5. Click **Create bucket**
6. Click on the bucket → **Policies** → **New policy** → **For full customization**
7. Add this policy for uploads:
   - Policy name: `allow_anon_upload`
   - Allowed operation: `INSERT`
   - Policy definition: `true`
8. Add another policy for reads:
   - Policy name: `allow_read`
   - Allowed operation: `SELECT`
   - Policy definition: `true`

---

## Step 2 — Add your Supabase keys to all files

Open each HTML file in a text editor (Notepad, VS Code, etc.) and find these 2 lines near the bottom in the `<script>` section:

```js
const SUPABASE_URL     = 'https://YOUR_PROJECT.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY';
```

Replace with your actual values from Step 1. Do this in:
- `index.html`
- `shopkeeper.html`
- `admin.html`

For `index.html` also fill in your Razorpay key (see Step 4):
```js
const RAZORPAY_KEY = 'rzp_test_YOUR_KEY';
```

---

## Step 3 — Set up Razorpay (for online payments)

1. Go to **https://razorpay.com** → Sign up (free)
2. Complete KYC (required for live payments; test mode works without it)
3. Go to **Settings → API Keys → Generate test key**
4. Copy the **Key ID** (starts with `rzp_test_`)
5. Paste it as `RAZORPAY_KEY` in `index.html`

> For test mode: use card number `4111 1111 1111 1111`, any future expiry, any CVV

---

## Step 4 — Create your admin account

### Create user in Supabase
1. Go to **Authentication → Users → Add user**
2. Email: anything you want (e.g. `admin@printhub.com`)
3. Password: something strong
4. Click **Create user**

### Promote to admin
Go to **SQL Editor** and run:
```sql
UPDATE public.profiles 
SET role = 'admin' 
WHERE email = 'admin@printhub.com';
```
Replace with your actual email.

---

## Step 5 — Deploy the websites (free)

### Option A — Vercel (recommended, free)
1. Go to **https://vercel.com** → Sign up with GitHub
2. Click **Add New → Project**
3. Drag and drop the `printhub-user` folder (extracted from the zip)
4. Click **Deploy**
5. Done — you get a URL like `https://printhub-user.vercel.app`

You'll get 3 URLs:
- `your-site.vercel.app/index.html` → Customer site
- `your-site.vercel.app/shopkeeper.html` → Shop owner dashboard
- `your-site.vercel.app/admin.html` → Admin panel

### Option B — Just open locally
Double-click any `.html` file to open in browser. Works for testing.

> **Note:** Supabase storage uploads require HTTPS in production. For local testing, use VS Code Live Server extension or `npx serve .`

---

## Step 6 — Register a shop

1. Open `admin.html`, login with your admin account
2. Go to **Shops → Register shop**
3. Fill in:
   - Owner email (the shop owner must have signed up first — or create them in Supabase Auth)
   - Shop name
   - Address
   - Shop code (e.g. `PH-2041` — customers use this for offline mode)
4. Click **Create shop** — this also automatically sets the owner's role to `owner`

---

## Step 7 — Set up desktop app (shop owner's PC)

The Electron app runs on the **shop owner's Windows/Mac PC** and does the actual printing.

### Prerequisites
- **Node.js v18+** — download from https://nodejs.org
- **SumatraPDF** (Windows only, for silent PDF printing) — download from https://www.sumatrapdfreader.org

### Install and run
```powershell
# 1. Extract printhub-electron.zip
# 2. Open PowerShell in that folder

cd printhub-electron

# 3. Add your Supabase keys — open src/main.js and replace:
#    const SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co';
#    const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY';

# 4. Install dependencies
npm install

# 5. Run in development mode
npm run dev
```

### First-time setup in the app
1. Login with the **shop owner's** Supabase account
2. Go to **Settings → Default Printer** → select the physical printer
3. Toggle **Auto-print ON**
4. Minimize to tray — it runs silently from now on

### Build a Windows installer
```powershell
npm run build:win
# Output: dist/Printhub Setup 1.0.0.exe
```
Double-click to install. Printhub will start automatically with Windows.

---

## How the full flow works

```
Customer opens index.html
        ↓
Uploads PDF → PDF.js counts pages automatically
        ↓
Chooses settings (B&W/colour, copies, paper)
        ↓
Picks a shop
        ↓
Pays via Razorpay (or chooses cash at shop)
        ↓
Token generated (e.g. A24) — Supabase get_next_token()
        ↓
Order stored in Supabase orders table
        ↓
Supabase Realtime fires event to:
  → Shopkeeper web dashboard (shows in queue)
  → Electron desktop app (auto-downloads + prints)
        ↓
Electron downloads PDF to temp folder
        ↓
Sends to physical printer (SumatraPDF on Windows)
        ↓
Order status updated: queued → printing → completed
        ↓
Customer tracks status on index.html with their token
        ↓
Temp file deleted automatically after print
```

---

## What each site is for

### `index.html` — Customer site
- Upload PDF (no login needed)
- Choose print settings
- Pick a nearby shop
- Pay online (Razorpay) or offline (cash at counter)
- Get a token like `A24`
- Track order status live using the token

### `shopkeeper.html` — Shop owner dashboard
- Login with shop owner account
- See live print queue
- Mark jobs as printing / done
- Toggle auto-print on/off
- Set shop status (Open / Busy / Paused / Offline)
- View today's stats and revenue
- Edit shop name and address

### `admin.html` — Admin panel
- Login with admin account only
- Platform-wide revenue and commission stats
- Analytics charts (7/30/90 days)
- All orders across all shops
- All shops — block/unblock
- All users — change roles
- Failed jobs monitor — requeue
- Register new shops

### Electron desktop app — Shop auto-printer
- Runs silently in system tray
- Listens for new paid orders via Supabase Realtime
- Auto-downloads PDF to temp folder
- Sends to physical printer (Windows/Mac/Linux)
- Retries up to 3 times on failure
- Deletes temp file after printing

---

## Pricing logic (built-in)

| Type | Price |
|---|---|
| B&W per page | ₹3 |
| Colour per page | ₹5 |
| Priority fee | ₹7 (flat, 100% to Printhub) |
| Shop owner gets | ₹2/page (B&W) |
| Printhub gets | ₹1/page + priority fee |

Page count is detected automatically from the PDF using PDF.js — no manual entry, no fake pricing.

---

## Common issues

**"Upload failed" on user site**
→ Check storage bucket exists and policies are set (Step 1)
→ Make sure bucket name is exactly `print-files`

**"No shops available"**
→ Register at least one shop via admin panel (Step 6)
→ Make sure the shop status is not `offline`

**Token shows as A00 always**
→ Run the `supabase-schema.sql` again — the `get_next_token` function may not have been created
→ Check SQL Editor for errors

**Electron: "No printer found"**
→ Make sure printer is connected and shows in Windows Settings → Printers & scanners
→ Click "Refresh printer list" in the app Settings tab

**Electron: auto-print not firing**
→ Check the Auto-print toggle is ON in the app
→ Check shop status is set to "Open"
→ Check the realtime indicator in the titlebar shows "Live" (green dot)

**Admin login fails with "Access denied"**
→ Make sure you ran the SQL to set `role = 'admin'` for your account (Step 4)

---

## File reference

| File | Edit this | What to change |
|---|---|---|
| `index.html` | Yes | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `RAZORPAY_KEY` |
| `shopkeeper.html` | Yes | `SUPABASE_URL`, `SUPABASE_ANON_KEY` |
| `admin.html` | Yes | `SUPABASE_URL`, `SUPABASE_ANON_KEY` |
| `supabase-schema.sql` | No | Run once in Supabase SQL Editor |
| `electron/src/main.js` | Yes | `SUPABASE_URL`, `SUPABASE_ANON_KEY` |
