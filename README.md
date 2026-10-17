# PrintHub — Complete Project Directory & Setup

A complete cloud-connected printing platform:
1. **Customer Web Portal** — Upload PDF, customize print options, pay online or in shop, receive token.
2. **Shopkeeper Web Dashboard** — Live real-time incoming orders, shop settings, analytics.
3. **Admin Web Dashboard** — Platform overview, shop management, and order auditing.
4. **Desktop Operator App** — Windows desktop app for physical print execution and local printer dispatch.

---

## ⚡ Quick 1-Click Launchers (Root Directory)

| File | What it does |
|---|---|
| [**`RUN_INSTALLER.bat`**](file:///c:/Users/zapma/CODES/PrintHub/RUN_INSTALLER.bat) | **Launches the Desktop App Installer (`.exe`) directly.** |
| [**`START_LOCAL_DEV.bat`**](file:///c:/Users/zapma/CODES/PrintHub/START_LOCAL_DEV.bat) | **Starts the local web server on port 3000 and opens portals in browser.** |
| [**`BUILD_INSTALLER.bat`**](file:///c:/Users/zapma/CODES/PrintHub/BUILD_INSTALLER.bat) | **Rebuilds the Windows Desktop Installer and copies it to `installer/`.** |

---

## 📦 Desktop App Windows Setup File (.exe)

* **Location:** [`installer/Printhub Setup 1.0.6.exe`](file:///c:/Users/zapma/CODES/PrintHub/installer/Printhub%20Setup%201.0.6.exe)
* **Full path:** `c:\Users\zapma\CODES\PrintHub\installer\Printhub Setup 1.0.6.exe`
* **Version:** **1.0.6 (Admin & Google Sign-In Enabled)**
* **File size:** ~76.5 MB
* **How to run:** Double-click the file above or double-click [`RUN_INSTALLER.bat`](file:///c:/Users/zapma/CODES/PrintHub/RUN_INSTALLER.bat).

---

## 🌐 2 Vercel Deployments (User & Admin)

You can create two independent Vercel projects from this single GitHub repository:

### 1️⃣ User / Customer Portal Link
* **Vercel Project Name:** `printhub-user` (or any custom name)
* **Root Directory in Vercel Settings:** `printhub-user`
* **Build Command:** `npm run build`
* **Output Directory:** `.`
* **Result:** `https://your-user-app.vercel.app` (Customer PDF upload & print token ordering)

### 2️⃣ Admin Dashboard Link
* **Vercel Project Name:** `printhub-admin` (or any custom name)
* **Root Directory in Vercel Settings:** `printhub-admin`
* **Build Command:** `npm run build`
* **Output Directory:** `.`
* **Result:** `https://your-admin-app.vercel.app` (Direct Admin Oversight & Analytics)

---

## 💻 1 Desktop Application (For Shopkeeper)
* **Installer:** [`installer/Printhub Setup 1.0.6.exe`](file:///c:/Users/zapma/CODES/PrintHub/installer/Printhub%20Setup%201.0.6.exe)
* **Launcher:** Double-click [`RUN_INSTALLER.bat`](file:///c:/Users/zapma/CODES/PrintHub/RUN_INSTALLER.bat)
* **Features:** Google Sign-In, real-time incoming orders, manual printer dispatch, and offline print control.

---

## 🗂️ Project Structure

```text
PrintHub/
├── RUN_INSTALLER.bat           ← Double-click to launch Desktop installer
├── START_LOCAL_DEV.bat         ← Double-click to start local test server (Port 3000)
├── BUILD_INSTALLER.bat         ← Double-click to rebuild the Desktop app installer
├── installer/
│   └── Printhub Setup 1.0.6.exe← The Windows installer executable (76.5 MB)
├── admin.html                  ← Standalone admin portal
├── PRINTHUB_README.md          ← Original full platform setup guide
└── printhub-electron/          ← Desktop application & Web portal source
    ├── dist/                   ← Electron build artifacts
    ├── src/                    ← Electron main process & services
    └── printhub-user/          ← Web application source (Customer, Shop, Admin)
        ├── index.html          ← Customer ordering portal
        ├── shopkeeper.html     ← Shopkeeper dashboard (Google Sign-In enabled)
        ├── admin.html          ← Platform admin panel
        ├── env.js              ← Active Supabase configuration
        └── dev-server.js       ← Lightweight local static server
```

---

## ⚙️ Configuration & Database

* **Database & Auth:** Active on Supabase project `https://bqvcrsktjzivdvzodgab.supabase.co`.
* **Config Files:**
  * Web portals: [`printhub-electron/printhub-user/env.js`](file:///c:/Users/zapma/CODES/PrintHub/printhub-electron/printhub-user/env.js)
  * Desktop app: [`printhub-electron/.env`](file:///c:/Users/zapma/CODES/PrintHub/printhub-electron/.env)
