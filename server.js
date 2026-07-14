const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('./db');
const backup = require('./backup');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);
// Uploaded files are attacker-controllable content served from the app's own
// origin. Two guards keep a malicious upload from running as a script in that
// origin: (1) nosniff stops the browser from re-interpreting, say, a .txt as
// HTML; (2) HTML/SVG/XML — the types that can carry inline script — are forced
// to download instead of render. PDFs and images still open inline as the UI
// expects.
const INLINE_UNSAFE_EXT = new Set(['.html', '.htm', '.xhtml', '.svg', '.xml']);
app.use('/uploads', express.static(UPLOADS_DIR, {
  setHeaders(res, filePath) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (INLINE_UNSAFE_EXT.has(path.extname(filePath).toLowerCase())) {
      res.setHeader('Content-Disposition', 'attachment');
    }
  }
}));

// File attachments (drag-and-drop proposals/invoices/change orders): the
// browser sends the raw file bytes with the original filename in a header;
// we save it under a random name on disk and hand back a URL to link to.
app.post('/api/upload', express.raw({ type: '*/*', limit: '20mb' }), (req, res) => {
  const originalName = decodeURIComponent(req.headers['x-filename'] || 'file');
  const ext = path.extname(originalName) || '';
  const storedName = `${crypto.randomUUID()}${ext}`;
  fs.writeFile(path.join(UPLOADS_DIR, storedName), req.body, (err) => {
    if (err) return res.status(500).json({ error: 'Could not save file' });
    res.status(201).json({ name: originalName, url: `/uploads/${storedName}` });
  });
});


// Each collection: [route name, id field]. Divisions/Trades are the
// MasterFormat reference data, editable from the Settings tab.
const COLLECTIONS = {
  projects:      'ProjectID',
  divisions:     'DivisionID',
  trades:        'TradeID',
  vendors:       'VendorID',
  subcontracts:  'SubcontractID',
  bids:          'BidID',
  changeOrders:  'ChangeOrderID',
  invoices:      'InvoiceID',
  contactLog:    'EmailID',
  costCodes:     'CostCodeID',
  subCostCodes:  'SubCostCodeID',
  areas:         'AreaID',
  rfis:          'RFIID',
  disciplines:   'DisciplineID',
  planReviews:   'PlanReviewID',
  planSheets:    'PlanSheetID',
  rfiResponses:  'RFIResponseID',
  changeEvents:  'ChangeEventID',
  pcos:          'PCOID',
  pccos:         'PCCOID',
  budgetLines:   'BudgetLineID',
  purchaseOrders:'POID',
  submittals:    'SubmittalID',
  submittalReviews: 'SubmittalReviewID',
  dailyReports:  'DailyReportID'
};
const READONLY = new Set([]);

// The same "locked once approved" rules the browser UI enforces — mirrored
// here so the lock is a real rule, not just a UI courtesy. A direct API
// call (bypassing the app entirely) can no longer edit or delete a record
// once it's Approved/Executed/Paid, except for the one specific "reopen"
// action (setting Status back to the reopen value) that the UI itself uses.
const LOCK_RULES = {
  changeOrders: { lockedWhen: r => r.Status === 'Approved', reopenStatus: 'Submitted' },
  pcos:         { lockedWhen: r => r.Status === 'Approved', reopenStatus: 'Submitted' },
  pccos:        { lockedWhen: r => r.Status === 'Executed', reopenStatus: 'Pending Signature' },
  invoices:     { lockedWhen: r => r.Status === 'Paid', reopenStatus: 'Approved' }
};

function checkLock(name, idField, id, patch) {
  const rule = LOCK_RULES[name];
  if (!rule) return null; // no lock rule for this collection — always allowed
  const existing = db.find(name, idField, id);
  if (!existing || !rule.lockedWhen(existing)) return null; // not locked — allowed
  const keys = Object.keys(patch || {});
  const isReopen = keys.length === 1 && patch.Status === rule.reopenStatus;
  if (isReopen) return null; // the one specific action that's always allowed
  return `This record is locked (status: ${existing.Status}). Reopen it before making changes.`;
}

for (const [name, idField] of Object.entries(COLLECTIONS)) {
  const route = `/api/${name}`;

  app.get(route, (req, res) => {
    res.json(db.all(name));
  });

  app.get(`${route}/:id`, (req, res) => {
    const row = db.find(name, idField, req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  });

  if (!READONLY.has(name)) {
    app.post(route, (req, res) => {
      const created = db.insert(name, idField, req.body || {});
      res.status(201).json(created);
    });

    app.put(`${route}/:id`, (req, res) => {
      const lockError = checkLock(name, idField, req.params.id, req.body);
      if (lockError) return res.status(423).json({ error: lockError });
      const updated = db.update(name, idField, req.params.id, req.body || {});
      if (!updated) return res.status(404).json({ error: 'Not found' });
      res.json(updated);
    });

    app.delete(`${route}/:id`, (req, res) => {
      const lockError = checkLock(name, idField, req.params.id, {});
      if (lockError) return res.status(423).json({ error: lockError });
      const ok = db.remove(name, idField, req.params.id);
      if (!ok) return res.status(404).json({ error: 'Not found' });
      res.status(204).end();
    });
  }
}

// --- Workflow helpers beyond plain CRUD ---

// Log a contact touch on a vendor and hand back a pre-filled mailto so the
// user's own email client sends the actual message (no Outlook/SMTP
// automation is available from a browser app).
app.post('/api/vendors/:id/contact', (req, res) => {
  const vendor = db.find('vendors', 'VendorID', req.params.id);
  if (!vendor) return res.status(404).json({ error: 'Vendor not found' });

  const now = new Date();
  const stamp = now.toISOString().replace('T', ' ').slice(0, 19);

  const existing = db.all('contactLog').find(c => String(c.VendorID) === String(vendor.VendorID));
  if (existing) {
    db.update('contactLog', 'EmailID', existing.EmailID, {
      DateTimeLastContacted: stamp,
      SelectedToEmail: '1'
    });
  } else {
    db.insert('contactLog', 'EmailID', {
      ProjectID: vendor.ProjectID,
      VendorID: vendor.VendorID,
      Contractor: vendor.Contractor,
      Contact: vendor.Contact,
      Email: vendor.Email,
      BidResponse: vendor.BidResponse,
      ProposalStatus: vendor.ProposalStatus,
      DateTimeLastContacted: stamp,
      SelectedToEmail: '1'
    });
  }

  const subject = encodeURIComponent(`Bid Invitation — ${vendor.TradeName}`);
  const body = encodeURIComponent(
    `Hi ${vendor.Contact || ''},\n\nWe'd like to invite ${vendor.Contractor} to bid on the ${vendor.TradeName} scope.\nPlease let us know if you're able to submit a proposal.\n\nThanks,\nBalsa Construction`
  );
  res.json({
    mailto: `mailto:${vendor.Email}?subject=${subject}&body=${body}`,
    loggedAt: stamp
  });
});

// Award a bid: creates a subcontract pre-filled from the winning proposal.
app.post('/api/bids/:id/award', (req, res) => {
  const bid = db.find('bids', 'BidID', req.params.id);
  if (!bid) return res.status(404).json({ error: 'Bid not found' });
  const vendor = db.find('vendors', 'VendorID', bid.VendorID);
  const trade = db.find('trades', 'TradeID', bid.TradeID);

  const contractNumber = 'S' + String(db.all('subcontracts').length + 1).padStart(3, '0');
  const subcontract = db.insert('subcontracts', 'SubcontractID', {
    ProjectID: bid.ProjectID,
    VendorID: bid.VendorID,
    TradeID: bid.TradeID,
    TradeName: trade ? trade.TradeName : (vendor ? vendor.TradeName : ''),
    Contractor: vendor ? vendor.Contractor : '',
    OriginalContractAmount: bid.ProposalPrice,
    ContractNumber: contractNumber,
    ContractStatus: 'Draft',
    ContractDate: '',
    AwardDate: new Date().toISOString().slice(0, 10),
    ExecutedBy: '',
    InsuranceReceived: '0',
    InsuranceExpiration: '',
    ExecutedContractReceived: '0',
    W9Received: '0',
    DIRVerified: '0',
    BondRequired: '0',
    BondReceived: '0',
    Notes: ''
  });
  res.status(201).json(subcontract);
});

// Backups: list what's on disk, or trigger one right now on demand.
app.get('/api/backups', (req, res) => {
  res.json(backup.listBackups());
});

app.post('/api/backups/run', (req, res) => {
  try {
    const result = backup.runBackup();
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
backup.startSchedule();
app.listen(PORT, () => {
  console.log(`Balsa Construction Ops running at http://localhost:${PORT}`);
});
