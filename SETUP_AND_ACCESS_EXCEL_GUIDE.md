# Balsa Construction Ops — Setup & Connecting Access/Excel

This app now runs on a **real SQLite database file** (`data/balsa.db`) instead
of the placeholder JSON file it used before. That's the actual milestone this
guide is about: SQLite is a format Microsoft Access and Excel can both open
directly, so this is the step that finally lets all three tools — the web
app, Access, and Excel — read and write the same live data.

## 1. First-time setup on the host computer

1. Install **Node.js** (version 22.5 or newer) from https://nodejs.org — pick
   the Windows installer, default options are fine. This is completely free;
   you should never see a payment screen anywhere in that process.
2. Copy this whole `balsa-webapp` folder onto the computer that will act as
   "the server" — the one that stays on during business hours.
3. Open a Command Prompt in that folder and run:
   ```
   npm install
   ```
   (You only need to do this once, or again after I send you an updated
   version of the app.)

## 2. Running it day-to-day — no Command Prompt needed

Two files are included for this:

- **`Start Balsa Ops.bat`** — double-click this to start the app. It starts
  the server quietly in the background (or notices it's already running,
  if you double-click it again) and opens the app in its own clean window
  — no address bar, no browser tabs, just the app, same as any other
  program on your computer.
- **`Stop Balsa Ops.bat`** — double-click this if you ever want to fully
  shut it down (for example, before installing an update).

**To make this feel like a real installed app** (an icon on your desktop,
pinnable to your taskbar or Start Menu):

1. Right-click **`Start Balsa Ops.bat`** → **Show more options** → **Send to**
   → **Desktop (create shortcut)**.
2. Right-click that new shortcut on your Desktop → **Properties**.
3. Click **Change Icon...** → **Browse...** → select **`balsa.ico`** (in
   this same folder) → **OK** → **OK**.
4. Rename the shortcut to whatever you'd like (e.g. "Balsa Ops").
5. Optional: right-click it → **Pin to Start** or **Pin to taskbar**.

From then on, that icon is the app — double-click it, the window opens,
close the window when you're done (the server keeps quietly running in the
background so it's instant next time; use "Stop Balsa Ops" if you want it
fully off).

**One honest note:** I put these scripts together carefully and the logic
is standard, well-established Windows/PowerShell behavior, but I wasn't
able to test them on an actual Windows machine from here. If anything
doesn't fire correctly the first time — the window doesn't open, or it
opens to a blank page — tell me exactly what happened and I'll fix it fast.
A quick manual fallback that always works regardless: just open Command
Prompt, run `node server.js`, and go to `http://localhost:3000` in your
browser like before.

**For anyone else on the office network** — the app-style shortcut above
only opens the app on the host computer itself. Everyone else just opens
`http://<that computer's local IP>:3000` in their own browser — e.g.
`http://192.168.1.50:3000` — as long as the host computer has it running
(either window open, or started once via the shortcut and left running in
the background).

## 2b. A real compiled desktop app instead (optional, more setup)

If you want an actual `.exe` — a genuine Windows application, not a script
— there's a real desktop app project included in the **`BalsaOpsDesktop`**
folder. It's built with C# and Microsoft's own WebView2 (the same engine
Edge uses) displaying the exact same app you already have — same screens,
same everything — inside a real application window with its own icon.

This is entirely optional. The `.bat` launcher above already gives you a
clean app-style window with no setup beyond what you've already done — this
is only worth doing if you specifically want a real compiled `.exe` you can
install, rather than a script.

**What you'll need (all free, no card):**

1. **Visual Studio Community** — download from
   https://visualstudio.microsoft.com/vs/community/. During install, check
   the **".NET desktop development"** workload — that's the only piece
   you need.
2. Open **`BalsaOpsDesktop\BalsaOpsDesktop.csproj`** in Visual Studio
   (double-click it, or File → Open → Project/Solution).
3. Press **F5** (or the green ▶ Play button) to build and run it — a real
   app window should open, start the server itself, and load the app.
4. To get a distributable `.exe` you can copy to a shortcut or install
   elsewhere: right-click the project in Solution Explorer → **Publish** →
   **Folder** → choose **win-x64** → **Publish**. The finished `.exe` will
   be in the `bin\Release\...\publish` folder it creates — that's the file
   to make a shortcut to (using the same `balsa.ico` for the icon).

**Two honest things worth knowing:**
- I wrote this code carefully using standard, well-documented WebView2
  patterns, but same as the `.bat` launcher, I haven't been able to
  actually compile and click through it on a Windows machine myself. If
  Visual Studio shows a build error, send me the exact message and I'll
  fix it directly.
- WebView2 itself (the display engine) comes pre-installed on most
  up-to-date Windows 10/11 machines already. If the app shows a
  WebView2-related error on first run, Microsoft's free installer for it
  is at https://developer.microsoft.com/microsoft-edge/webview2/ — one
  more free, no-card install, same as everything else here.

## 3. Connecting Microsoft Access to `balsa.db`

Access doesn't talk to SQLite natively — it needs a small free driver
first.

1. **Install the SQLite ODBC driver** (free): download the 64-bit installer
   from http://www.ch-werner.de/sqliteodbc/ (the "sqliteodbc" project — this
   is the standard, widely used SQLite ODBC driver). Run the installer with
   default options.
2. **Create a DSN (Data Source Name)** that points at your database file:
   - Open **ODBC Data Sources (64-bit)** from the Windows Start menu.
   - Go to the **System DSN** tab → **Add...**
   - Choose **SQLite3 ODBC Driver** → **Finish**.
   - Give it a Data Source Name you'll recognize, e.g. `BalsaOps`.
   - Under **Database Name**, browse to and select this app's
     `data/balsa.db` file.
   - Click **OK**.
3. **Link the tables into Access** — do this against a **backup copy** of
   your Access file first, not your live one:
   - In Access: **External Data** → **New Data Source** → **From Other
     Sources** → **ODBC Database**.
   - Choose **Link to the data source by creating a linked table**.
   - Select the **Machine Data Source** tab → pick `BalsaOps` → **OK**.
   - Select the tables you want linked (you can select all of them, or just
     the ones you need — `projects`, `subcontracts`, `invoices`,
     `changeOrders`, `costCodes`, etc.) → **OK**.
   - Access will add each one as a linked table. Open one to confirm you
     see real rows and columns — not a single blob column — matching what's
     in the web app.
4. Once you've verified everything looks right on the backup copy, repeat
   the same linking steps against your real, live Access file during a
   planned quiet moment (end of day works well).

**A few things worth knowing:**
- Every table's primary key (e.g. `ProjectID`, `SubcontractID`) is stored as
  text, matching how the web app already generates IDs. Access will treat
  linked-table primary keys as plain text, which is fine — you generally
  won't be typing these by hand.
- Checkbox-style fields (like "Insurance received") are stored as `'0'` or
  `'1'` text, not native Access Yes/No — you'll see them as text in Access
  unless you build a calculated field or query to convert them.
- Editing a linked table's data in Access **writes directly back** to
  `balsa.db` — anyone using the web app will see that change the moment
  they refresh. This works both directions.

## 4. Connecting Excel to `balsa.db`

Excel can use the same ODBC connection you just set up for Access — no
second driver needed.

1. **Data** tab → **Get Data** → **From Other Sources** → **From ODBC**.
2. Choose the `BalsaOps` data source you created above → **OK**.
3. Pick the table(s) you want (e.g. `subcontracts`, `invoices`, `budgetLines`)
   in the Navigator window, or select multiple and choose **Transform Data**
   to combine/filter them in Power Query first.
4. **Load** — Excel builds a live table you can pivot, chart, or format
   into a report.
5. To refresh with the latest data any time: **Data** → **Refresh All**.

**To make it refresh itself automatically, without you clicking anything:**
1. **Data** tab → **Queries & Connections** (shows a panel listing your connection).
2. Right-click the connection → **Properties**.
3. Check **"Refresh every _ minutes"** and set a number (e.g., 10).
4. Optionally also check **"Refresh data when opening the file"**.
5. **OK**.

Now that report quietly keeps itself current on its own — genuinely "live" in the way a plain ODBC connection can be.

This is one-way (Excel reads from the database) unless you specifically set
up write-back through Power Query, which is more involved — for now, use
Excel for reporting and Access/the web app for actually entering data.

## 5. What changed under the hood (for your own understanding)

- Every collection in the app (Projects, Subcontracts, Change Orders,
  Invoices, Cost Codes, RFIs, Submittals, Plans, Budget Lines, Purchase
  Orders, and everything else) now has its own real SQLite table with
  named columns — not one big JSON blob.
- The web app's own behavior hasn't changed at all — same screens, same
  workflows. The only difference is what's sitting underneath it on disk.
- Your data automatically carried forward: the first time this updated
  version runs, it reads your existing seed data into the new database
  file, so nothing is lost.
