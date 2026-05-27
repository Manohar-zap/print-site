# Printhub Desktop App — Setup & Run Guide

Auto-print Electron app for shop owners. Runs in the system tray, listens for new orders from Supabase, downloads files and prints them automatically.

---

## Prerequisites

Install these before anything:

1. **Node.js** (v18 or later) — https://nodejs.org
2. **Git** — https://git-scm.com
3. **SumatraPDF** (Windows only, for silent PDF printing)
   - Download from: https://www.sumatrapdfreader.org/free-pdf-reader
   - Install to: `C:\Program Files\SumatraPDF\`

---

## Step 1 — Open the folder

```powershell
cd "C:\Users\zapma\OneDrive\Documents\CODES\printhub-electron"
```

---

## Step 2 — Add your Supabase config

Open `src/main.js` and replace line 7–8:

```js
const SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY';
```

Use the same values as your user website.

---

## Step 3 — Install dependencies

```powershell
npm install
```

This installs Electron, Supabase client, print utilities, etc.
Takes 1–3 minutes first time.

---

## Step 4 — Run in development mode

```powershell
npm run dev
```

The desktop app window opens.
Login with your **shop owner** Supabase account.

Once logged in:
- App minimizes to system tray
- Listens for new orders in real-time
- Auto-prints when a new paid order arrives

---

## Step 5 — Set your default printer

1. Click the tray icon → Open dashboard
2. Go to **Settings**
3. Under "Default Printer" — select your physical printer from the list
4. Click "Save"

---

## Step 6 — Build a Windows installer (.exe)

```powershell
npm run build:win
```

Output: `dist/Printhub Setup 1.0.0.exe`

Double-click to install. It puts Printhub in your Start Menu and runs on Windows startup automatically.

---

## How auto-print works

```
New order placed on website
        ↓
Supabase realtime pushes event to desktop app
        ↓
App checks: is order paid? (or offline payment mode)
        ↓
Downloads file to temp folder (OS temp dir)
        ↓
Sends to default printer via OS print system
        ↓
Updates order status → "printing" → "completed"
        ↓
Deletes temp file
        ↓
Sends desktop notification
```

---

## Printer notes

### Windows
The app uses **SumatraPDF** for silent PDF printing (no dialog boxes).
If SumatraPDF is not installed, it falls back to PowerShell print command.

Install SumatraPDF: https://www.sumatrapdfreader.org

### macOS / Linux
The app uses `lpr` (CUPS printing system) — available by default.

---

## Queue states

| State | Meaning |
|---|---|
| `waiting` | Job received, waiting for auto-print |
| `downloading` | Downloading file from Supabase storage |
| `printing` | File sent to printer |
| `done` | Printed successfully, temp file deleted |
| `failed` | Print failed — retry available |
| `skipped` | Manually skipped by owner |

---

## Retry system

- Auto-retries up to 3 times (configurable in Settings)
- Back-off: 5s → 10s → 15s between retries
- After max retries: shows red alert, requires manual action
- Retry button available in queue UI

---

## Temp file policy

- Files downloaded to OS temp folder (never Desktop/Documents)
- Auto-deleted after successful print
- Auto-deleted on app startup if older than 1 hour
- Original cloud file deleted 48h after upload (Supabase lifecycle rule)

---

## Troubleshooting

**"No printer found"**
→ Make sure your printer is connected and shows in Windows Settings → Printers
→ Click "Refresh printer list" in Settings tab

**"SumatraPDF not found"**
→ Install from https://www.sumatrapdfreader.org and restart app

**"Realtime: Offline"**
→ Check internet connection
→ Check Supabase project is active (free tier pauses after inactivity)

**App not auto-starting**
→ After installing the .exe, go to Task Manager → Startup → Enable Printhub

---

## Folder structure

```
printhub-electron/
├── src/
│   ├── main.js              ← Electron main process
│   ├── preload.js           ← Secure IPC bridge
│   ├── renderer/
│   │   └── index.html       ← Dashboard UI
│   ├── printer/
│   │   └── PrinterService.js  ← OS print commands
│   └── queue/
│       └── PrintQueue.js    ← Download + print + retry engine
├── assets/
│   ├── icon.ico             ← Add your icon here
│   └── tray.png             ← 16×16 tray icon (add your own)
├── package.json
└── README.md
```

---

## Adding a tray icon

Put a 16×16 PNG as `assets/tray.png`
Put a 256×256 ICO as `assets/icon.ico`

You can generate icons free at: https://convertio.co/png-ico/
