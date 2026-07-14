# Balsa Construction Ops — Code Quality & Architecture Evaluation

_Date: 2026-07-14 · Scope: the whole repo (Node/Express/SQLite web app, the
standalone `Balsa_Construction_App (21).html` presenter, the C# WebView2
desktop shell, and the supporting scripts)._

This is a genuinely capable app: the domain model (Change Events → PCOs →
PCCOs → CCOs, retainage, budget rollups, compliance flags, RFIs/submittals,
daily reports) is well thought through, server-side locking is enforced as a
real rule rather than a UI courtesy, and the SQLite-with-typed-columns choice
makes the Access/Excel-over-ODBC story real. What follows is a prioritized
list of quality and architecture findings. **The clearly-safe ones are already
fixed on this branch** (see the top section); the rest are recommendations that
need a judgment call or a larger change and were left alone.

---

## Fixed in this pass (verified)

### 1. Duplicate records from double-bound click handlers — _correctness, high severity_
**Files:** `public/app.js`, `Balsa_Construction_App (21).html`

`bindAddEditButtons()` runs **twice** on every render — once from
`bindEvents()` and again at the tail of `bindContentFilterEvents()`. The
`data-add` / `data-edit` handlers were protected by `bindOnce()`, but four
others were attached with plain `addEventListener`, so each fired twice:

- **Award a bid → two subcontracts created** (reproduced in a real browser: one
  click produced 2 subcontract rows).
- **Approve PCO → PCO approved and two PCCOs created.**
- **Contact vendor → email composer opened twice.**
- **Toggle a compliance flag → two redundant `PUT`s + double reload.**

The `el.disabled = true` guard does **not** help: both listeners run in the same
click dispatch before the disable takes effect.

**Fix:** wrapped all four handlers in the existing `bindOnce()` helper.
Re-verified: one Award click now creates exactly one subcontract, in both the
web app and the standalone HTML (which had the identical bug — see finding A1).

### 2. Stored-XSS vector via uploaded files — _security_
**File:** `server.js`

`/uploads` was served with a bare `express.static`, so an uploaded `.html` or
`.svg` (the API accepts `*/*`; the `accept=` attribute is only a UI hint) would
be served as active content **from the app's own origin** and could run script
against the app. Fixed by adding `X-Content-Type-Options: nosniff` to all
uploads and forcing `Content-Disposition: attachment` for the script-carrying
types (`.html/.htm/.xhtml/.svg/.xml`). PDFs and images still open inline as the
UI expects — verified with header checks on both an uploaded `.html` (now
downloads) and a `.pdf` (still inline).

### 3. Closed projects render a green "Active"-style pill labeled `No` — _UI correctness_
**Files:** `public/app.js`, `Balsa_Construction_App (21).html`

On the Projects grid a closed project (`ProjectStatus === 'No'`) showed a green
pill containing the literal text "No". Fixed to a gray pill reading "Closed".

---

## Recommendations (not changed — need a decision or a larger change)

### Architecture

**A1. Two hand-synchronized codebases is the dominant long-term risk.**
`public/app.js` (~3,000 lines) and `Balsa_Construction_App (21).html` (~4,270
lines) are maintained "feature-for-feature" by hand with no shared code. The
concrete cost showed up immediately in this review: the double-bind bug
(finding 1) and the project-pill bug (finding 3) existed **identically** in both
files — every bug and every feature has to be found and fixed twice. Options,
roughly in order of payoff: (a) extract the shared view/logic layer into one JS
module that both the server-backed and standalone builds import, with a tiny
swappable data layer (`fetch` vs `localStorage`); (b) generate one artifact from
the other in a build step; or (c) drop one deliverable. At minimum, adopt a
written diff/parity checklist so the two can't silently drift.

**A2. No automated tests and no CI anywhere.** A 7,000+-line codebase doing
money math — retainage, budget vs. committed vs. invoiced rollups, the
change-order chain — has zero tests. The highest-value, lowest-effort start is
unit tests around the pure functions (`subcontractCurrentAmount`,
`computeBudgetRows`, `computeAlerts`, `vendorEligibility`) plus a smoke test that
boots the server and exercises the generic CRUD + the lock rules. A `SessionStart`
hook / `npm test` script would let these run in web sessions too.

**A3. Frontend re-renders the whole DOM and rebinds every listener on each
interaction.** `render()` rebuilds `#app` from strings and re-attaches all
handlers; global mutable `state`/`DATA`; XSS-safety rests on remembering `esc()`
at every interpolation. It works at the current data scale, but this exact
rebind-everything pattern is what produced finding 1. Moving to event delegation
(one listener per container, dispatched by `data-*` attribute) would remove that
whole class of bug and cut the churn; a small render library would also preserve
form/scroll/focus state across renders.

### Server / data

**S1. No authentication or authorization.** Every endpoint is open — anyone who
can reach the port can read/write all business data, trigger backups, and upload
files. `cors()` is fully open on top of that. The README frames this as a
trusted LAN/small-team tool, which is reasonable, but there isn't even a shared
password. Add a single shared-secret / basic-auth gate before this is ever
reachable beyond localhost.

**S2. ID generation is racy and not concurrency-safe.** `db.nextId()` does
`SELECT max(id)+1` in JS, and the award/approve flows build human numbers from
`collection.length + 1`. The README explicitly supports "a small team hitting
the same file," where two concurrent inserts can compute the same primary key (→
`PRIMARY KEY` collision / 500) and contract/PCCO numbers can repeat after a
delete. Prefer `INTEGER PRIMARY KEY AUTOINCREMENT` (or `INSERT … RETURNING` in a
transaction), and derive display numbers from a monotonic source rather than
array length.

**S3. Duplicated workflow logic / dead server endpoints.** `POST
/api/bids/:id/award` and `POST /api/vendors/:id/contact` exist server-side, but
the web frontend reimplements both client-side (`awardBid`,
`openEmailComposer`), so the server versions are dead in this app **and have
already drifted** (neither award path sets the vendor's `Awarded` flag). Pick one
home for each workflow. Given that record-locking is deliberately enforced
server-side, award and PCO→PCCO creation arguably belong there too, so the two
frontends can't diverge on business rules.

**S4. Money / rollup edge cases.**
- Budget "invoiced" uses `parseFloat(i.AmountApproved) || parseFloat(i.AmountRequested)`,
  so a legitimately approved amount of **0** falls through to the requested
  amount. Use an explicit empty-string check instead of `||`.
- `awardBid` never sets the winning vendor's `Awarded = '1'`, so an awarded
  vendor still shows "Bid Submitted" and is missing from the Vendors → "Awarded"
  filter.
- The Overview "Active Projects" stat and the sidebar "N active projects" count
  **all** projects, including closed ones (`ProjectStatus === 'No'`).

**S5. Upload validation is client-side only.** The server accepts any content
type up to 20 MB; the `accept=` attribute is advisory. Consider a server-side
type allow-list and size checks. (The XSS *serving* vector is now
mitigated by finding 2, but validation is still worth adding.)

### Minor / cosmetic

- **M1.** `db.js`'s `find/insert/update/remove` take an `idField` argument that
  is ignored (they use `def.pk`). Drop it or use it — right now it invites the
  reader to think the two can differ.
- **M2.** `normalizeData` in `app.js` is dead code (already documented as such);
  safe to remove.
- **M3.** `computeAlerts` compares UTC-parsed ISO dates against a local
  `new Date()` "today", so day counts can be off by one near midnight / across
  time zones. Normalize both to date-only.
- **M4.** `package-lock.json` is git-ignored. For an app that pins
  `node >= 22.5` and rides an experimental (`node:sqlite`) API, committing the
  lockfile usually buys more reproducibility than it costs.

---

## What I did not find

- **No SQL injection.** All values are bound parameters; table and column names
  come from the fixed `TABLES`/`COLLECTIONS` maps, never from request input.
- **Server-side locking is real.** The Approved/Executed/Paid lock (and the
  single-field "reopen" exception) is enforced in `server.js`, not just the UI —
  a direct API call can't edit a locked record.
- **The backup story is sound.** WAL checkpoint before the file copy means each
  snapshot is consistent, with sensible 30-day retention.
