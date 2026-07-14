// Real SQLite-backed datastore using Node's built-in node:sqlite module
// (available in Node 22+, no native compilation, no extra install step —
// it ships inside Node itself). This produces an actual balsa.db file on
// disk that Microsoft Access and Excel can connect to directly over ODBC,
// with real named columns per table (not a JSON blob), so it's genuinely
// useful to build Access forms/reports or Excel Power Query reports against.
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'balsa.db');
const SEED_PATH = path.join(__dirname, 'data', 'seed.json');

// Every collection the app uses, its primary key column, and its other
// columns. NUMERIC columns get SQLite's REAL affinity so Access/Excel sort
// and sum them correctly; everything else is TEXT (dates are stored as
// plain ISO text strings, same as the rest of the app already does).
const TABLES = {
  projects: { pk: 'ProjectID', cols: ['ProjectName', 'ProjectAddress', 'BidDueDate', 'ProjectStatus'] },
  divisions: { pk: 'DivisionID', cols: ['DivisionName'] },
  trades: { pk: 'TradeID', cols: ['DivisionID', 'TradeName'] },
  vendors: { pk: 'VendorID', cols: ['ProjectID', 'TradeID', 'DivisionID', 'TradeName', 'Contractor', 'Contact', 'Phone', 'Email', 'BidResponse', 'ProposalStatus', 'ProposalPrice:num', 'Active', 'Awarded'] },
  bids: { pk: 'BidID', cols: ['ProjectID', 'TradeID', 'VendorID', 'ProposalPrice:num', 'AttachmentName', 'AttachmentURL'] },
  subcontracts: { pk: 'SubcontractID', cols: ['ProjectID', 'TradeID', 'VendorID', 'CostCodeID', 'TradeName', 'Contractor', 'ContractNumber', 'OriginalContractAmount:num', 'RetainagePercent:num', 'ContractStatus', 'ContractDate', 'AwardDate', 'ExecutedBy', 'InsuranceReceived', 'InsuranceExpiration', 'ExecutedContractReceived', 'W9Received', 'DIRVerified', 'BondRequired', 'BondReceived', 'Notes'] },
  changeOrders: { pk: 'ChangeOrderID', cols: ['ProjectID', 'SubcontractID', 'ChangeEventID', 'AreaID', 'RFIID', 'CostCodeID', 'SubCostCodeID', 'ChangeOrderNumber', 'Title', 'ChangeType', 'Amount:num', 'Status', 'RequestedDate', 'SubmittedDate', 'ApprovedDate', 'Description', 'Notes', 'AttachmentName', 'AttachmentURL'] },
  costCodes: { pk: 'CostCodeID', cols: ['Code', 'Description'] },
  budgetLines: { pk: 'BudgetLineID', cols: ['ProjectID', 'CostCodeID', 'BudgetAmount:num', 'Notes'] },
  purchaseOrders: { pk: 'POID', cols: ['ProjectID', 'CostCodeID', 'PONumber', 'Vendor', 'Description', 'Amount:num', 'Status', 'PODate', 'AttachmentName', 'AttachmentURL'] },
  subCostCodes: { pk: 'SubCostCodeID', cols: ['CostCodeID', 'Code', 'Description'] },
  areas: { pk: 'AreaID', cols: ['ProjectID', 'Code', 'Description'] },
  rfis: { pk: 'RFIID', cols: ['ProjectID', 'Code', 'Description', 'Status', 'AttachmentName', 'AttachmentURL'] },
  rfiResponses: { pk: 'RFIResponseID', cols: ['RFIID', 'Question', 'Response1', 'Response2', 'AttachmentName', 'AttachmentURL'] },
  submittals: { pk: 'SubmittalID', cols: ['ProjectID', 'Code', 'SpecSection', 'Title', 'Status', 'AttachmentName', 'AttachmentURL'] },
  submittalReviews: { pk: 'SubmittalReviewID', cols: ['SubmittalID', 'ReviewDate', 'Reviewer', 'Outcome', 'Comments', 'AttachmentName', 'AttachmentURL'] },
  changeEvents: { pk: 'ChangeEventID', cols: ['ProjectID', 'EventNumber', 'Title', 'Description', 'Status', 'DateIdentified', 'AttachmentName', 'AttachmentURL'] },
  pcos: { pk: 'PCOID', cols: ['ProjectID', 'ChangeEventID', 'PCONumber', 'Title', 'Description', 'ProposedAmount:num', 'Status', 'DateSubmitted', 'AttachmentName', 'AttachmentURL'] },
  pccos: { pk: 'PCCOID', cols: ['ProjectID', 'PCOID', 'PCCONumber', 'Amount:num', 'Status', 'ExecutedDate', 'AttachmentName', 'AttachmentURL'] },
  disciplines: { pk: 'DisciplineID', cols: ['Code', 'Name'] },
  planReviews: { pk: 'PlanReviewID', cols: ['ProjectID', 'DisciplineID', 'Phase', 'ReviewDate', 'Status', 'Notes', 'AttachmentName', 'AttachmentURL'] },
  planSheets: { pk: 'PlanSheetID', cols: ['PlanReviewID', 'SheetNumber', 'Title', 'Revision', 'SheetDate', 'AttachmentName', 'AttachmentURL'] },
  invoices: { pk: 'InvoiceID', cols: ['SubcontractID', 'InvoiceNumber', 'BillingPeriod', 'InvoiceDate', 'AmountRequested:num', 'RetentionHeld:num', 'AmountApproved:num', 'AmountPaid:num', 'CheckNumber', 'PaidDate', 'Status', 'Notes', 'AttachmentName', 'AttachmentURL'] },
  contactLog: { pk: 'EmailID', cols: ['ProjectID', 'VendorID', 'Contractor', 'Contact', 'Email', 'BidResponse', 'ProposalStatus', 'DateTimeLastContacted', 'SelectedToEmail'] },
  dailyReports: { pk: 'DailyReportID', cols: ['ProjectID', 'ReportDate', 'Weather', 'CrewCount:num', 'WorkPerformed', 'DelaysOrIssues', 'AttachmentName', 'AttachmentURL'] }
};

// Strip the ":num" suffix used above to mark a column REAL instead of TEXT.
function colName(c){ return c.split(':')[0]; }
function colType(c){ return c.endsWith(':num') ? 'REAL' : 'TEXT'; }

const isNewDb = !fs.existsSync(DB_PATH);
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;'); // safe for a small team hitting the same file

// Create every table if it doesn't already exist.
for (const [table, def] of Object.entries(TABLES)) {
  const colDefs = def.cols.map(c => `"${colName(c)}" ${colType(c)}`).join(', ');
  db.exec(`CREATE TABLE IF NOT EXISTS "${table}" ("${def.pk}" TEXT PRIMARY KEY, ${colDefs});`);
}

// One-off migration: earlier versions had a "Current Amount" field on
// Subcontracts that was manually typed in and could drift from reality.
// It was replaced with a live calculation (Original + approved Change
// Orders) shown instead — this drops the old, no-longer-used column from
// any database created before that change, so it doesn't sit around
// permanently blank and confusing in Access/Excel.
try {
  const subCols = db.prepare(`PRAGMA table_info("subcontracts")`).all();
  if (subCols.some(c => c.name === 'CurrentContractAmount')) {
    db.exec(`ALTER TABLE "subcontracts" DROP COLUMN "CurrentContractAmount";`);
  }
} catch (err) {
  console.error('Migration warning (CurrentContractAmount column):', err.message);
}

// First run: load the original seed data in so the app isn't empty.
if (isNewDb) {
  const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
  for (const [table, def] of Object.entries(TABLES)) {
    const rows = seed[table] || [];
    if (rows.length === 0) continue;
    const allCols = [def.pk, ...def.cols.map(colName)];
    const placeholders = allCols.map(() => '?').join(', ');
    const stmt = db.prepare(`INSERT INTO "${table}" (${allCols.map(c => `"${c}"`).join(', ')}) VALUES (${placeholders})`);
    for (const row of rows) {
      stmt.run(...allCols.map(c => (row[c] ?? '').toString()));
    }
  }
}

function nextId(collection) {
  const def = TABLES[collection];
  const rows = db.prepare(`SELECT "${def.pk}" as id FROM "${collection}"`).all();
  const max = rows.reduce((m, r) => {
    const n = parseInt(r.id, 10);
    return isNaN(n) ? m : Math.max(m, n);
  }, 0);
  return String(max + 1);
}

function rowToRecord(row) {
  // node:sqlite returns objects with a null prototype; spread into a plain one.
  return { ...row };
}

function all(collection) {
  const def = TABLES[collection];
  if (!def) return [];
  return db.prepare(`SELECT * FROM "${collection}"`).all().map(rowToRecord);
}

function find(collection, idField, id) {
  const def = TABLES[collection];
  if (!def) return undefined;
  const row = db.prepare(`SELECT * FROM "${collection}" WHERE "${def.pk}" = ?`).get(String(id));
  return row ? rowToRecord(row) : undefined;
}

function insert(collection, idField, record) {
  const def = TABLES[collection];
  if (!def) throw new Error(`Unknown collection: ${collection}`);
  const id = record[def.pk] || nextId(collection);
  const allCols = [def.pk, ...def.cols.map(colName)];
  const values = allCols.map(c => c === def.pk ? id : (record[c] ?? '').toString());
  const placeholders = allCols.map(() => '?').join(', ');
  db.prepare(`INSERT INTO "${collection}" (${allCols.map(c => `"${c}"`).join(', ')}) VALUES (${placeholders})`).run(...values);
  return find(collection, idField, id);
}

function update(collection, idField, id, patch) {
  const def = TABLES[collection];
  if (!def) throw new Error(`Unknown collection: ${collection}`);
  const existing = find(collection, idField, id);
  if (!existing) return null;
  const cols = def.cols.map(colName).filter(c => c in patch);
  if (cols.length === 0) return existing;
  const setClause = cols.map(c => `"${c}" = ?`).join(', ');
  const values = cols.map(c => (patch[c] ?? '').toString());
  db.prepare(`UPDATE "${collection}" SET ${setClause} WHERE "${def.pk}" = ?`).run(...values, String(id));
  return find(collection, idField, id);
}

function remove(collection, idField, id) {
  const def = TABLES[collection];
  if (!def) return false;
  const result = db.prepare(`DELETE FROM "${collection}" WHERE "${def.pk}" = ?`).run(String(id));
  return result.changes > 0;
}

// Backups: SQLite in WAL mode can have recent writes sitting in the
// -wal file rather than in balsa.db itself. A checkpoint flushes those
// writes into the main file first, so a plain file copy afterward is a
// complete, consistent snapshot — not a half-written one.
function backupTo(destPath) {
  db.exec('PRAGMA wal_checkpoint(FULL);');
  fs.copyFileSync(DB_PATH, destPath);
}

module.exports = { all, find, insert, update, remove, nextId, TABLES, DB_PATH, backupTo };
