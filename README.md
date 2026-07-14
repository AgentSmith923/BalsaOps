# Balsa Construction — Project Operations

A full construction project operations web app: bidding, subcontracts,
purchase orders, the complete change order chain (Change Events → PCOs →
PCCOs → CCOs), invoices with retainage auto-calculation, budget vs. actual
reporting, RFIs, submittals, drawing/plan tracking, daily field reports,
and a dashboard that actively flags things that need attention (expiring
insurance, stale change orders, budget overruns, and more).

Originally built from an Access database export; the data model has grown
well beyond that now.

## Running it locally

You need [Node.js](https://nodejs.org) version 22.5 or newer (it uses
Node's built-in SQLite support — no separate database to install).

```
cd balsa-webapp
npm install
node server.js
```

Then open **http://localhost:3000** in a browser.

On first run, it creates `data/balsa.db` (a real SQLite database file) and
loads whatever's in `data/seed.json` into it. In this repo, `seed.json` is
intentionally empty (see **Data & privacy** below) — you'll be starting
from a blank slate unless you're handed a real seed file separately.

**Windows shortcuts** are included for running it without touching a
terminal:
- `Start Balsa Ops.bat` — starts the server and opens the app in a clean,
  address-bar-free window
- `Stop Balsa Ops.bat` — cleanly shuts it down

## Data & privacy — read before pushing anything

This repo's `.gitignore` is set up to keep real business data out of
version control:
- `data/balsa.db` (and its `-shm`/`-wal` files) — the actual live database
- `data/backups/` — automatic daily backups of that database
- `uploads/` — any files/photos attached to records in the app

**`data/seed.json` in this repo has been intentionally emptied out** (every
collection is `[]`) before this was shared — the original had real vendor
contacts, contract amounts, and project details in it. If you're working
with a real copy of this data, keep that file itself out of any commits too
(don't restore it and then `git add` it).

## What's in here

- **`server.js`** — the backend. A REST API covering every collection in
  the app (see below).
- **`db.js`** — the datastore. Real SQLite (via Node's built-in
  `node:sqlite`, no external dependency to install), with a proper typed
  column per field — not a JSON blob — so the database is also directly
  usable from Microsoft Access or Excel over ODBC.
- **`backup.js`** — runs an automatic daily backup of the database on
  startup and every 24 hours after, with 30-day retention.
- **`public/`** — the entire frontend: one `app.js` driving every screen,
  no build step, no framework — plain JS/HTML/CSS.
- **`BalsaOpsDesktop/`** — an optional C# + WebView2 desktop shell that
  wraps this same app in a real Windows application window (starts the
  server itself, no browser tab needed). Requires Visual Studio Community
  (free) to build. See `SETUP_AND_ACCESS_EXCEL_GUIDE.md` for the full
  walkthrough.
- **`SETUP_AND_ACCESS_EXCEL_GUIDE.md`** — end-to-end setup, running it
  day-to-day, connecting Microsoft Access and Excel to the live database
  over ODBC, and the desktop app build steps.

## Feature areas

- **Overview** — portfolio summary plus a live "Needs Attention" panel
  (expiring insurance, invoices pending too long, stale PCOs, approaching
  bid dates, budget overruns, missing Cost Codes)
- **Budget** — budget vs. committed vs. invoiced by Cost Code, per
  project, with CSV export
- **Projects / Vendors / Bidding Board** — preconstruction workflow, with
  lowest-bid auto-flagging and one-click award-to-subcontract
- **Subcontracts / Purchase Orders** — awarded contracts, compliance flags
  (insurance/W9/bond/DIR), retainage %
- **Change Orders** — the full chain: Change Events → PCOs (owner-facing,
  priced) → PCCOs (executed prime contract changes, auto-created on PCO
  approval) → CCOs (subcontract-level changes); Approved/Executed/Paid
  records lock against further edits, enforced server-side (not just in
  the UI)
- **Invoices** — retainage auto-calculated from the subcontract's
  retainage %, locks once marked Paid
- **Plans** — Disciplines → Plan Revisions → Plan Sheets
- **RFIs** — RFIs with multi-round responses (Q, R1, R2)
- **Submittals** — submittals with review rounds and outcomes (Approved /
  Approved as Noted / Revise and Resubmit / Rejected)
- **Daily Reports** — a day-by-day field log per project (weather, crew
  count, work performed, delays/issues, photo attachments)
- **Settings** — Divisions & Trades, Cost Codes (with Sub Cost Codes),
  Disciplines, Areas, Email Prompts, and (web app only) Backups status

Every record type that makes sense supports drag-and-drop file
attachments (proposals, change orders, RFIs, submittals, daily reports,
etc.).

## Architecture notes worth knowing

- **Two parallel deliverables exist**: this Node/Express/SQLite web app,
  and a separate `Balsa_Construction_App.html` standalone file (not in
  this repo) that runs entirely in-browser with no server, for anyone who
  wants a zero-install version. They're kept in sync feature-for-feature,
  but are two different codebases — changes to one don't automatically
  apply to the other.
- **Cost Code is a required field** on Subcontracts, Change Orders, and
  Purchase Orders — it's what makes the Budget rollup accurate. Skipping
  it used to silently drop that cost from Budget with no warning; that's
  no longer possible for new records (older records that predate this
  rule are flagged automatically on Overview instead).
- **`node:sqlite` is still labeled experimental** by Node itself. It's
  been reliable in practice, but worth knowing this isn't a fully
  stabilized API yet.
