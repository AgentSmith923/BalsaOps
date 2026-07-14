/* ============ Server-backed data layer ============ */
const LOGO_SRC = 'logo.png';
const API = '/api';
let DATA = { projects:[], divisions:[], trades:[], vendors:[], subcontracts:[], bids:[], changeOrders:[], invoices:[], contactLog:[], costCodes:[], subCostCodes:[], areas:[], rfis:[], disciplines:[], planReviews:[], planSheets:[], rfiResponses:[], changeEvents:[], pcos:[], pccos:[], budgetLines:[], purchaseOrders:[], submittals:[], submittalReviews:[], dailyReports:[] };

async function apiGet(name){ const r = await fetch(`${API}/${name}`); return r.json(); }
async function apiPost(name, body){ const r = await fetch(`${API}/${name}`, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)}); if(!r.ok){ const err = await r.json().catch(()=>({})); throw new Error(err.error || 'Save failed'); } return r.json(); }
async function apiPut(name, id, body){ const r = await fetch(`${API}/${name}/${id}`, {method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)}); if(!r.ok){ const err = await r.json().catch(()=>({})); throw new Error(err.error || 'Save failed'); } return r.json(); }
async function apiDelete(name, id){ const r = await fetch(`${API}/${name}/${id}`, {method:'DELETE'}); if(!r.ok){ const err = await r.json().catch(()=>({})); throw new Error(err.error || 'Delete failed'); } return true; }

// normalizeData is unused server-side (each API endpoint already defaults
// missing collections to [] on the server), kept only so this file stays a
// straightforward diff of the standalone version.
const ALL_COLLECTIONS = ['projects','divisions','trades','vendors','subcontracts','bids','changeOrders','invoices','contactLog','costCodes','subCostCodes','areas','rfis','disciplines','planReviews','planSheets','rfiResponses','changeEvents','pcos','pccos','budgetLines','purchaseOrders','submittals','submittalReviews','dailyReports'];
function normalizeData(data){
  const normalized = data && typeof data === 'object' ? data : {};
  ALL_COLLECTIONS.forEach(key => {
    if(!Array.isArray(normalized[key])) normalized[key] = [];
  });
  return normalized;
}

async function loadAll(){
  const [projects, divisions, trades, vendors, subcontracts, bids, changeOrders, invoices, contactLog, costCodes, subCostCodes, areas, rfis, disciplines, planReviews, planSheets, rfiResponses, changeEvents, pcos, pccos, budgetLines, purchaseOrders, submittals, submittalReviews, dailyReports] = await Promise.all([
    apiGet('projects'), apiGet('divisions'), apiGet('trades'), apiGet('vendors'),
    apiGet('subcontracts'), apiGet('bids'), apiGet('changeOrders'), apiGet('invoices'), apiGet('contactLog'),
    apiGet('costCodes'), apiGet('subCostCodes'), apiGet('areas'), apiGet('rfis'),
    apiGet('disciplines'), apiGet('planReviews'), apiGet('planSheets'), apiGet('rfiResponses'),
    apiGet('changeEvents'), apiGet('pcos'), apiGet('pccos'), apiGet('budgetLines'), apiGet('purchaseOrders'),
    apiGet('submittals'), apiGet('submittalReviews'), apiGet('dailyReports')
  ]);
  DATA = { projects, divisions, trades, vendors, subcontracts, bids, changeOrders, invoices, contactLog, costCodes, subCostCodes, areas, rfis, disciplines, planReviews, planSheets, rfiResponses, changeEvents, pcos, pccos, budgetLines, purchaseOrders, submittals, submittalReviews, dailyReports };
  rebuildLookups();
}

async function uploadFile(file){
  const res = await fetch(`${API}/upload`, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name) },
    body: file
  });
  if(!res.ok) throw new Error('Upload failed');
  return res.json();
}

/* ============ Lookups (rebuilt whenever data changes) ============ */
let divisionsById = {}, tradesById = {}, projectsById = {}, costCodesById = {};

function rebuildLookups(){
  divisionsById = {}; DATA.divisions.forEach(d => divisionsById[d.DivisionID] = d.DivisionName);
  tradesById = {}; DATA.trades.forEach(t => tradesById[t.TradeID] = t);
  projectsById = {}; DATA.projects.forEach(p => projectsById[p.ProjectID] = p);
  costCodesById = {}; DATA.costCodes.forEach(c => costCodesById[c.CostCodeID] = c);
}

function divOf(tradeId){ const t = tradesById[tradeId]; return t ? t.DivisionID : null; }
function tradeName(tradeId){ const t = tradesById[tradeId]; return t ? t.TradeName : '—'; }
function divCode(divId){ return divId ? String(divId).padStart(2,'0') : '—'; }
function money(v){
  if (v === '' || v === null || v === undefined) return '—';
  const n = parseFloat(v);
  if (isNaN(n)) return '—';
  return '$' + n.toLocaleString('en-US', {maximumFractionDigits:0});
}
function dateOnly(v){ if (!v) return '—'; return v.split(' ')[0]; }
function bool(v){ return v === '1' || v === 1 || v === true; }
// A subcontract's "current" value is always its original amount plus
// whatever's been approved against it since — computed fresh every time,
// the same way Budget already computes committed cost, so the two can
// never quietly show different numbers for the same contract.
function subcontractCurrentAmount(sub){
  const approvedCCOs = DATA.changeOrders
    .filter(c => c.SubcontractID === sub.SubcontractID && c.Status === 'Approved')
    .reduce((s,c) => s + (parseFloat(c.Amount) || 0), 0);
  return (parseFloat(sub.OriginalContractAmount) || 0) + approvedCCOs;
}

/* ============ Vendor email eligibility ============
   - 'ineligible': already declined, or already submitted a proposal — never emailed
   - 'responded': actively bidding but hasn't submitted a proposal yet — follow-up prompt
   - 'no_response': hasn't responded at all yet — initial invite prompt          */
function hasSubmittedBid(vendor){
  if(!vendor) return false;
  if(vendor.ProposalStatus === 'PROPOSAL RECEIVED') return true;
  if(vendor.ProposalPrice) return true;
  return DATA.bids.some(b => String(b.VendorID) === String(vendor.VendorID));
}
function vendorEligibility(vendor){
  if(!vendor) return 'ineligible';
  if(vendor.BidResponse === 'DECLINED' || hasSubmittedBid(vendor)) return 'ineligible';
  if(vendor.BidResponse === 'BIDDING') return 'responded';
  return 'no_response';
}
function defaultPromptFor(elig){
  if(elig === 'responded'){
    return {
      subject: 'Checking in on your proposal',
      body: `Hello,\n\nJust following up on the scope we discussed — checking in on the status of your proposal.\nPlease let us know when we can expect it.\n\nThanks,\nBalsa Construction`
    };
  }
  return {
    subject: 'Bid Invitation',
    body: `Hello,\n\nWe'd like to invite you to bid on the following scope.\nPlease let us know if you're able to submit a proposal and by when we can expect it.\n\nThanks,\nBalsa Construction`
  };
}
function promptForProject(projectId, elig){
  const project = projectsById[projectId];
  const fallback = defaultPromptFor(elig);
  if(!project) return fallback;
  if(elig === 'responded'){
    return {
      subject: project.PromptRespondedSubject || fallback.subject,
      body: project.PromptRespondedBody || fallback.body
    };
  }
  return {
    subject: project.PromptNoResponseSubject || fallback.subject,
    body: project.PromptNoResponseBody || fallback.body
  };
}
function esc(s){
  return (s ?? '').toString().replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* Chrome (and other modern browsers) block opening a new tab whose top-level
   navigation target is a data: URL — a phishing protection. Standalone-mode
   attachments are stored as data: URLs, so "view" must trigger a download
   instead of a target="_blank" navigation. Real server-hosted files (a normal
   /uploads/... URL) don't have this restriction, so those still open in a
   new tab as usual. */
function attachmentLinkAttrs(url, filename){
  if(url && url.startsWith('data:')){
    return `download="${esc(filename || 'attachment')}"`;
  }
  return `target="_blank" rel="noopener"`;
}

/* ============ Toast ============ */
function toast(msg){
  let el = document.getElementById('toast');
  if(!el){
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(()=> el.classList.remove('show'), 2600);
}

/* ============ Icons ============ */
const ICONS = {
  overview: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="5" rx="1.5"/><rect x="13" y="10" width="8" height="11" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/></svg>',
  projects: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/></svg>',
  bidding: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 21h16M6 21V10l6-6 6 6v11M9 21v-6h6v6"/></svg>',
  subcontracts: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5"/><path d="M9 14l2 2 4-4"/></svg>',
  vendors: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="9" cy="8" r="3"/><path d="M3 21v-1a6 6 0 0 1 6-6h0a6 6 0 0 1 6 6v1"/><path d="M16 4.2a3 3 0 0 1 0 5.8M21 21v-1a5.7 5.7 0 0 0-4-5.4"/></svg>',
  changeorders: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M7 3v11a3 3 0 0 0 3 3h7"/><path d="M14 14l3 3-3 3"/><circle cx="7" cy="20" r="2.2"/></svg>',
  invoices: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M6 2h9l3 3v17l-3-1.5-3 1.5-3-1.5-3 1.5V2z"/><path d="M9 8h6M9 12h6M9 16h3"/></svg>',
  search: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
  back: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>',
  chevronRight: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg>',
  pin: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 21s-7-6.1-7-11a7 7 0 0 1 14 0c0 4.9-7 11-7 11z"/><circle cx="12" cy="10" r="2.3"/></svg>',
  plus: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 5v14M5 12h14"/></svg>',
  mail: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
  trash: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0 1 12a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-12"/></svg>',
  lock: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  edit: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  award: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="5"/><path d="M8.5 12.5 7 21l5-3 5 3-1.5-8.5"/></svg>',
  upload: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 16V4M12 4l-4 4M12 4l4 4"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>',
  paperclip: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 12.5l-8.5 8.5a4 4 0 0 1-6-6l9-9a2.5 2.5 0 0 1 3.5 3.5l-8.5 8.5a1 1 0 0 1-1.5-1.5l7.5-7.5"/></svg>',
  settings: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  plans: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 21V5a2 2 0 0 1 2-2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M14 3v6h6"/><path d="M8 13h8M8 17h5"/></svg>',
  primechanges: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 17V7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 8v5M9.5 10.5 12 8l2.5 2.5"/></svg>',
  budget: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  rfis: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/><path d="M12 8v3.5M12 15h.01"/></svg>',
  submittals: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M9 12l2 2 4-4"/><path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/></svg>',
  dailyreports: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01"/></svg>'
};

/* ============ State ============ */
const state = {
  view: 'home',
  currentProjectId: null,
  projectTab: 'bidding',
  vendorSearch: '',
  vendorDivision: null,
  vendorStatus: null,
  vendorProject: null,
  selectedVendors: new Set(),
  biddingProject: null,
  settingsProject: null,
  settingsScope: 'project',
  settingsTab: 'trades',
  plansTab: 'reviews',
  plansProject: null,
  primeTab: 'events',
  primeProject: null,
  budgetProject: null,
  rfisTab: 'rfis',
  rfisProject: null,
  subcontractsTab: 'subs',
  submittalsTab: 'submittals',
  submittalsProject: null,
  dailyReportsProject: null,
  backupsList: null,
  _backupsFetching: false
};

function NAV(){
  return [
    {id:'overview', label:'Overview', icon:'overview'},
    {id:'budget', label:'Budget', icon:'budget'},
    {id:'projects', label:'Projects', icon:'projects', count: DATA.projects.length},
    {id:'vendors', label:'Vendors', icon:'vendors'},
    {id:'bidding', label:'Bidding Board', icon:'bidding'},
    {id:'subcontracts', label:'Subcontracts', icon:'subcontracts'},
    {id:'primechanges', label:'Change Orders', icon:'primechanges'},
    {id:'invoices', label:'Invoices', icon:'invoices'},
    {id:'plans', label:'Plans', icon:'plans'},
    {id:'rfis', label:'RFIs', icon:'rfis'},
    {id:'submittals', label:'Submittals', icon:'submittals'},
    {id:'dailyreports', label:'Daily Reports', icon:'dailyreports'},
    {id:'settings', label:'Settings', icon:'settings'}
  ];
}

/* ============ Form field option builders ============ */
function projectOptions(){ return DATA.projects.map(p=>({value:p.ProjectID, label:p.ProjectName})); }
function divisionOptions(){
  return DATA.divisions
    .slice()
    .sort((a,b)=>Number(a.DivisionID)-Number(b.DivisionID))
    .map(d=>({value:d.DivisionID, label:`${divCode(d.DivisionID)} — ${d.DivisionName}`}));
}
function tradeOptions(){
  return DATA.trades
    .slice()
    .sort((a,b)=>(a.DivisionID-b.DivisionID)||a.TradeName.localeCompare(b.TradeName))
    .map(t=>({value:t.TradeID, label:`${divCode(t.DivisionID)} — ${t.TradeName}`}));
}
function vendorOptions(){ return DATA.vendors.map(v=>({value:v.VendorID, label:`${v.Contractor} (${v.TradeName})`})); }
function subcontractOptions(){ return DATA.subcontracts.map(s=>({value:s.SubcontractID, label:`${s.ContractNumber} — ${s.Contractor} (${s.TradeName})`})); }

// Project-aware variants: once a project is chosen, narrow Trade/Vendor/Subcontract
// choices down to what's actually associated with that project. Falls back to the
// full list if the project has nothing on file yet, so the form is never a dead end.
function tradeOptionsForProject(projectId){
  let trades = DATA.trades;
  if(projectId){
    const usedIds = new Set(DATA.vendors.filter(v=>v.ProjectID===projectId).map(v=>v.TradeID));
    const filtered = trades.filter(t=>usedIds.has(t.TradeID));
    if(filtered.length) trades = filtered;
  }
  return trades.slice()
    .sort((a,b)=>(a.DivisionID-b.DivisionID)||a.TradeName.localeCompare(b.TradeName))
    .map(t=>({value:t.TradeID, label:`${divCode(t.DivisionID)} — ${t.TradeName}`}));
}
function vendorOptionsForProject(projectId, tradeId){
  let vendors = DATA.vendors;
  if(projectId){
    const byProject = vendors.filter(v=>v.ProjectID===projectId);
    if(byProject.length) vendors = byProject;
  }
  if(tradeId){
    const byTrade = vendors.filter(v=>v.TradeID===tradeId);
    if(byTrade.length) vendors = byTrade;
  }
  return vendors.map(v=>({value:v.VendorID, label:`${v.Contractor} (${v.TradeName})`}));
}
function subcontractOptionsForProject(projectId){
  let subs = DATA.subcontracts;
  if(projectId){
    const byProject = subs.filter(s=>s.ProjectID===projectId);
    if(byProject.length) subs = byProject;
  }
  return subs.map(s=>({value:s.SubcontractID, label:`${s.ContractNumber} — ${s.Contractor} (${s.TradeName})`}));
}

// Cost Codes / Sub Cost Codes / Areas / RFIs — each combo box shows the
// business-facing code alongside its description ("03-300 — Cast-in-Place
// Concrete"), not the internal database ID, matching how these are
// referenced on paper in the industry.
function costCodeOptions(){
  return DATA.costCodes.slice()
    .sort((a,b)=> (a.Code||'').localeCompare(b.Code||''))
    .map(c=>({value:c.CostCodeID, label:`${c.Code} — ${c.Description}`}));
}
function subCostCodeOptionsForCostCode(costCodeId){
  let list = DATA.subCostCodes;
  if(costCodeId){
    const filtered = list.filter(s=>s.CostCodeID===costCodeId);
    if(filtered.length) list = filtered;
  }
  return list.slice()
    .sort((a,b)=> (a.Code||'').localeCompare(b.Code||''))
    .map(s=>({value:s.SubCostCodeID, label:`${s.Code} — ${s.Description}`}));
}
function areaOptionsForProject(projectId){
  return DATA.areas.filter(a=>a.ProjectID===projectId)
    .sort((a,b)=> (a.Code||'').localeCompare(b.Code||''))
    .map(a=>({value:a.AreaID, label:`${a.Code} — ${a.Description}`}));
}
function rfiOptionsForProject(projectId){
  return DATA.rfis.filter(r=>r.ProjectID===projectId)
    .sort((a,b)=> (a.Code||'').localeCompare(b.Code||''))
    .map(r=>({value:r.RFIID, label:`${r.Code} — ${r.Description}`}));
}
function submittalOptionsForProject(projectId){
  return DATA.submittals.filter(s=>s.ProjectID===projectId)
    .sort((a,b)=> (a.Code||'').localeCompare(b.Code||''))
    .map(s=>({value:s.SubmittalID, label:`${s.Code} — ${s.Title}`}));
}

function disciplineOptions(){
  return DATA.disciplines.slice()
    .sort((a,b)=> (a.Code||'').localeCompare(b.Code||''))
    .map(d=>({value:d.DisciplineID, label:`${d.Code} — ${d.Name}`}));
}
function planReviewOptionsForProject(projectId){
  let list = DATA.planReviews;
  if(projectId){
    const filtered = list.filter(pr=>pr.ProjectID===projectId);
    if(filtered.length) list = filtered;
  }
  return list.map(pr=>{
    const disc = DATA.disciplines.find(d=>d.DisciplineID===pr.DisciplineID);
    return {value: pr.PlanReviewID, label: `${disc?disc.Code:'—'} — ${pr.Phase}`};
  });
}

// Prime Contract side: Change Event (umbrella issue) -> PCO (proposed, priced,
// owner-facing) -> PCCO (executed change to the owner's contract, auto-created
// when a PCO is approved). The existing "changeOrder" form/table plays the
// CCO role — a change against a specific subcontract — and can optionally
// link up to the same Change Event a PCO came from.
function changeEventOptionsForProject(projectId){
  return DATA.changeEvents.filter(ce=>ce.ProjectID===projectId)
    .sort((a,b)=>(a.EventNumber||'').localeCompare(b.EventNumber||''))
    .map(ce=>({value:ce.ChangeEventID, label:`${ce.EventNumber} — ${ce.Title}`}));
}
function pcoOptionsForProject(projectId){
  let list = DATA.pcos;
  if(projectId){
    const filtered = list.filter(p=>p.ProjectID===projectId);
    if(filtered.length) list = filtered;
  }
  return list.map(p=>({value:p.PCOID, label:`${p.PCONumber} — ${p.Title}`}));
}

/* ============ Entity form configs ============ */
const FORMS = {
  project: {
    title: 'Project', collection: 'projects', idField: 'ProjectID',
    fields: [
      {key:'ProjectName', label:'Project Name', type:'text', required:true},
      {key:'ProjectAddress', label:'Address', type:'text'},
      {key:'BidDueDate', label:'Bid Due Date', type:'date'},
      {key:'ProjectStatus', label:'Status', type:'select', options:[{value:'Yes',label:'Active'},{value:'No',label:'Closed'}]}
    ],
    afterSave: (saved, isEdit) => {
      if(!isEdit){
        state.view = 'vendors';
        state.vendorProject = saved.ProjectID;
        state.vendorStatus = null;
        setTimeout(() => toast(`${saved.ProjectName} created — add your vendors below`), 300);
      }
    }
  },
  division: {
    title: 'Division', collection: 'divisions', idField: 'DivisionID', noDelete: true,
    fields: [
      {key:'DivisionName', label:'Division Name', type:'text', required:true}
    ]
  },
  trade: {
    title: 'Trade', collection: 'trades', idField: 'TradeID',
    fields: [
      {key:'DivisionID', label:'Division', type:'select', options: () => divisionOptions(), required:true},
      {key:'TradeName', label:'Trade Name', type:'text', required:true}
    ]
  },
  vendor: {
    title: 'Vendor / Proposal', collection: 'vendors', idField: 'VendorID',
    fields: [
      {key:'ProjectID', label:'Project', type:'select', options: () => projectOptions(), required:true},
      {key:'TradeID', label:'Trade', type:'select', options: () => tradeOptions(), required:true},
      {key:'Contractor', label:'Contractor / Company', type:'text', required:true},
      {key:'Contact', label:'Contact Name', type:'text'},
      {key:'Phone', label:'Phone', type:'text'},
      {key:'Email', label:'Email', type:'text'},
      {key:'BidResponse', label:'Bid Response', type:'select', options:[{value:'NO RESPONSE',label:'No Response'},{value:'BIDDING',label:'Bidding'},{value:'DECLINED',label:'Declined'}]},
      {key:'ProposalStatus', label:'Proposal Status', type:'select', options:[{value:'NOT RECEIVED',label:'Not Received'},{value:'PROPOSAL RECEIVED',label:'Proposal Received'}]},
      {key:'ProposalPrice', label:'Proposal Price', type:'number'},
      {key:'Active', label:'Active bidder', type:'checkbox'},
      {key:'Awarded', label:'Awarded', type:'checkbox'}
    ],
    beforeSave: (data) => {
      const t = tradesById[data.TradeID];
      if(t){ data.TradeName = t.TradeName; data.DivisionID = t.DivisionID; }
      return data;
    }
  },
  bid: {
    title: 'Log Proposal', collection: 'bids', idField: 'BidID',
    fields: [
      {key:'ProjectID', label:'Project', type:'select', options: () => projectOptions(), required:true},
      {key:'TradeID', label:'Trade', type:'select', options: (v) => tradeOptionsForProject(v.ProjectID), required:true},
      {key:'VendorID', label:'Vendor', type:'select', options: (v) => vendorOptionsForProject(v.ProjectID, v.TradeID), required:true},
      {key:'ProposalPrice', label:'Proposal Price', type:'number', required:true},
      {key:'attachment', label:'Proposal Document', type:'file'}
    ]
  },
  subcontract: {
    title: 'Subcontract', collection: 'subcontracts', idField: 'SubcontractID',
    fields: [
      {key:'ProjectID', label:'Project', type:'select', options: () => projectOptions(), required:true},
      {key:'TradeID', label:'Trade', type:'select', options: (v) => tradeOptionsForProject(v.ProjectID), required:true},
      {key:'VendorID', label:'Vendor', type:'select', options: (v) => vendorOptionsForProject(v.ProjectID, v.TradeID)},
      {key:'CostCodeID', label:'Cost Code', type:'select', options: () => costCodeOptions(), required:true},
      {key:'Contractor', label:'Contractor', type:'text', required:true},
      {key:'ContractNumber', label:'Contract #', type:'text'},
      {key:'OriginalContractAmount', label:'Original Amount', type:'number'},
      {key:'_currentAmountDisplay', label:'Current Amount (original + approved change orders)', type:'computed', compute: (v) => {
        const sub = v.SubcontractID ? DATA.subcontracts.find(s=>s.SubcontractID===v.SubcontractID) : null;
        return sub ? money(subcontractCurrentAmount(sub)) : money(v.OriginalContractAmount || 0);
      }},
      {key:'RetainagePercent', label:'Retainage %', type:'number'},
      {key:'ContractStatus', label:'Status', type:'select', options:[{value:'Draft',label:'Draft'},{value:'Executed',label:'Executed'},{value:'Complete',label:'Complete'}]},
      {key:'ContractDate', label:'Contract Date', type:'date'},
      {key:'AwardDate', label:'Award Date', type:'date'},
      {key:'ExecutedBy', label:'Executed By', type:'text'},
      {key:'InsuranceReceived', label:'Insurance received', type:'checkbox'},
      {key:'InsuranceExpiration', label:'Insurance Expiration', type:'date'},
      {key:'ExecutedContractReceived', label:'Executed contract received', type:'checkbox'},
      {key:'W9Received', label:'W9 received', type:'checkbox'},
      {key:'DIRVerified', label:'DIR verified', type:'checkbox'},
      {key:'BondRequired', label:'Bond required', type:'checkbox'},
      {key:'BondReceived', label:'Bond received', type:'checkbox'},
      {key:'Notes', label:'Notes', type:'textarea'}
    ],
    beforeSave: (data) => {
      const t = tradesById[data.TradeID];
      if(t){ data.TradeName = t.TradeName; }
      return data;
    }
  },
  changeOrder: {
    title: 'Change Order (CCO)', collection: 'changeOrders', idField: 'ChangeOrderID',
    lockedWhen: r => r.Status === 'Approved',
    reopenStatus: 'Submitted',
    fields: [
      {key:'ProjectID', label:'Project', type:'select', options: () => projectOptions(), required:true},
      {key:'SubcontractID', label:'Subcontract', type:'select', options: (v) => subcontractOptionsForProject(v.ProjectID), required:true},
      {key:'ChangeEventID', label:'Change Event (optional)', type:'select', options: (v) => changeEventOptionsForProject(v.ProjectID)},
      {key:'AreaID', label:'Area', type:'select', options: (v) => areaOptionsForProject(v.ProjectID)},
      {key:'RFIID', label:'RFI', type:'select', options: (v) => rfiOptionsForProject(v.ProjectID)},
      {key:'CostCodeID', label:'Cost Code', type:'select', options: () => costCodeOptions(), required:true},
      {key:'SubCostCodeID', label:'Sub Cost Code', type:'select', options: (v) => subCostCodeOptionsForCostCode(v.CostCodeID)},
      {key:'ChangeOrderNumber', label:'Change Order #', type:'text'},
      {key:'Title', label:'Title', type:'text', required:true},
      {key:'ChangeType', label:'Type', type:'select', options:[{value:'Addition',label:'Addition'},{value:'Deduction',label:'Deduction'},{value:'No Cost',label:'No Cost'}]},
      {key:'Amount', label:'Amount', type:'number'},
      {key:'Status', label:'Status', type:'select', options:[{value:'Requested',label:'Requested'},{value:'Submitted',label:'Submitted'},{value:'Approved',label:'Approved'},{value:'Rejected',label:'Rejected'}]},
      {key:'RequestedDate', label:'Requested Date', type:'date'},
      {key:'SubmittedDate', label:'Submitted Date', type:'date'},
      {key:'ApprovedDate', label:'Approved Date', type:'date'},
      {key:'Description', label:'Description', type:'textarea'},
      {key:'Notes', label:'Notes', type:'textarea'},
      {key:'attachment', label:'Change Order Document', type:'file'}
    ]
  },
  costCode: {
    title: 'Cost Code', collection: 'costCodes', idField: 'CostCodeID',
    fields: [
      {key:'Code', label:'Cost Code Number', type:'text', required:true},
      {key:'Description', label:'Description', type:'text', required:true}
    ]
  },
  budgetLine: {
    title: 'Budget Line', collection: 'budgetLines', idField: 'BudgetLineID',
    fields: [
      {key:'ProjectID', label:'Project', type:'select', options: () => projectOptions(), required:true},
      {key:'CostCodeID', label:'Cost Code', type:'select', options: () => costCodeOptions(), required:true},
      {key:'BudgetAmount', label:'Budget Amount', type:'number', required:true},
      {key:'Notes', label:'Notes', type:'textarea'}
    ]
  },
  purchaseOrder: {
    title: 'Purchase Order', collection: 'purchaseOrders', idField: 'POID',
    fields: [
      {key:'ProjectID', label:'Project', type:'select', options: () => projectOptions(), required:true},
      {key:'CostCodeID', label:'Cost Code', type:'select', options: () => costCodeOptions(), required:true},
      {key:'PONumber', label:'PO #', type:'text', required:true},
      {key:'Vendor', label:'Vendor / Supplier', type:'text', required:true},
      {key:'Description', label:'Description', type:'textarea'},
      {key:'Amount', label:'Amount', type:'number'},
      {key:'Status', label:'Status', type:'select', options:[{value:'Draft',label:'Draft'},{value:'Issued',label:'Issued'},{value:'Closed',label:'Closed'}]},
      {key:'PODate', label:'PO Date', type:'date'},
      {key:'attachment', label:'Attachment', type:'file'}
    ]
  },
  subCostCode: {
    title: 'Sub Cost Code', collection: 'subCostCodes', idField: 'SubCostCodeID',
    fields: [
      {key:'CostCodeID', label:'Cost Code', type:'select', options: () => costCodeOptions(), required:true},
      {key:'Code', label:'Sub Cost Code Number', type:'text', required:true},
      {key:'Description', label:'Description', type:'text', required:true}
    ]
  },
  area: {
    title: 'Area', collection: 'areas', idField: 'AreaID',
    fields: [
      {key:'ProjectID', label:'Project', type:'select', options: () => projectOptions(), required:true},
      {key:'Code', label:'Area Code', type:'text', required:true},
      {key:'Description', label:'Description', type:'text', required:true}
    ]
  },
  rfi: {
    title: 'RFI', collection: 'rfis', idField: 'RFIID',
    fields: [
      {key:'ProjectID', label:'Project', type:'select', options: () => projectOptions(), required:true},
      {key:'Code', label:'RFI Number', type:'text', required:true},
      {key:'Description', label:'Subject', type:'text', required:true},
      {key:'Status', label:'Status', type:'select', options:[{value:'Open',label:'Open'},{value:'Answered',label:'Answered'},{value:'Closed',label:'Closed'}]},
      {key:'attachment', label:'Attachment', type:'file'}
    ]
  },
  rfiResponse: {
    title: 'RFI Response', collection: 'rfiResponses', idField: 'RFIResponseID',
    fields: [
      {key:'_ProjectFilter', label:'Project', type:'select', options: () => projectOptions(), transient:true},
      {key:'RFIID', label:'RFI', type:'select', options: (v) => rfiOptionsForProject(v._ProjectFilter), required:true},
      {key:'Question', label:'Question', type:'textarea', required:true},
      {key:'Response1', label:'Response 1', type:'textarea'},
      {key:'Response2', label:'Response 2 (follow-up)', type:'textarea'},
      {key:'attachment', label:'Attachment', type:'file'}
    ]
  },
  submittal: {
    title: 'Submittal', collection: 'submittals', idField: 'SubmittalID',
    fields: [
      {key:'ProjectID', label:'Project', type:'select', options: () => projectOptions(), required:true},
      {key:'Code', label:'Submittal #', type:'text', required:true},
      {key:'SpecSection', label:'Spec Section', type:'text'},
      {key:'Title', label:'Title / Description', type:'text', required:true},
      {key:'Status', label:'Status', type:'select', options:[{value:'Open',label:'Open'},{value:'Closed',label:'Closed'}]},
      {key:'attachment', label:'Attachment', type:'file'}
    ]
  },
  submittalReview: {
    title: 'Submittal Review', collection: 'submittalReviews', idField: 'SubmittalReviewID',
    fields: [
      {key:'_ProjectFilter', label:'Project', type:'select', options: () => projectOptions(), transient:true},
      {key:'SubmittalID', label:'Submittal', type:'select', options: (v) => submittalOptionsForProject(v._ProjectFilter), required:true},
      {key:'ReviewDate', label:'Review Date', type:'date'},
      {key:'Reviewer', label:'Reviewer', type:'text'},
      {key:'Outcome', label:'Outcome', type:'select', options:[
        {value:'Approved',label:'Approved'},
        {value:'Approved as Noted',label:'Approved as Noted'},
        {value:'Revise and Resubmit',label:'Revise and Resubmit'},
        {value:'Rejected',label:'Rejected'}
      ]},
      {key:'Comments', label:'Comments', type:'textarea'},
      {key:'attachment', label:'Attachment', type:'file'}
    ]
  },
  changeEvent: {
    title: 'Change Event', collection: 'changeEvents', idField: 'ChangeEventID',
    fields: [
      {key:'ProjectID', label:'Project', type:'select', options: () => projectOptions(), required:true},
      {key:'EventNumber', label:'Change Event #', type:'text', required:true},
      {key:'Title', label:'Title', type:'text', required:true},
      {key:'Description', label:'Description', type:'textarea'},
      {key:'Status', label:'Status', type:'select', options:[{value:'Open',label:'Open'},{value:'Priced',label:'Priced'},{value:'Closed',label:'Closed'}]},
      {key:'DateIdentified', label:'Date Identified', type:'date'},
      {key:'attachment', label:'Attachment', type:'file'}
    ]
  },
  pco: {
    title: 'Potential Change Order (PCO)', collection: 'pcos', idField: 'PCOID',
    lockedWhen: r => r.Status === 'Approved',
    reopenStatus: 'Submitted',
    fields: [
      {key:'ProjectID', label:'Project', type:'select', options: () => projectOptions(), required:true},
      {key:'ChangeEventID', label:'Change Event (optional)', type:'select', options: (v) => changeEventOptionsForProject(v.ProjectID)},
      {key:'PCONumber', label:'PCO #', type:'text', required:true},
      {key:'Title', label:'Title', type:'text', required:true},
      {key:'Description', label:'Description', type:'textarea'},
      {key:'ProposedAmount', label:'Proposed Amount (to owner, incl. markup)', type:'number'},
      {key:'Status', label:'Status', type:'select', options:[{value:'Draft',label:'Draft'},{value:'Submitted',label:'Submitted'},{value:'Approved',label:'Approved'},{value:'Rejected',label:'Rejected'}]},
      {key:'DateSubmitted', label:'Date Submitted', type:'date'},
      {key:'attachment', label:'Attachment', type:'file'}
    ]
  },
  pcco: {
    title: 'Prime Contract Change Order (PCCO)', collection: 'pccos', idField: 'PCCOID',
    lockedWhen: r => r.Status === 'Executed',
    reopenStatus: 'Pending Signature',
    fields: [
      {key:'ProjectID', label:'Project', type:'select', options: () => projectOptions(), required:true},
      {key:'PCOID', label:'Source PCO', type:'select', options: (v) => pcoOptionsForProject(v.ProjectID), required:true},
      {key:'PCCONumber', label:'PCCO #', type:'text', required:true},
      {key:'Amount', label:'Amount', type:'number'},
      {key:'Status', label:'Status', type:'select', options:[{value:'Pending Signature',label:'Pending Signature'},{value:'Executed',label:'Executed'}]},
      {key:'ExecutedDate', label:'Executed Date', type:'date'},
      {key:'attachment', label:'Attachment', type:'file'}
    ]
  },
  discipline: {
    title: 'Discipline', collection: 'disciplines', idField: 'DisciplineID',
    fields: [
      {key:'Code', label:'Discipline Code', type:'text', required:true},
      {key:'Name', label:'Name', type:'text', required:true}
    ]
  },
  planReview: {
    title: 'Plan Revision', collection: 'planReviews', idField: 'PlanReviewID',
    fields: [
      {key:'ProjectID', label:'Project', type:'select', options: () => projectOptions(), required:true},
      {key:'DisciplineID', label:'Discipline', type:'select', options: () => disciplineOptions(), required:true},
      {key:'Phase', label:'Review Phase', type:'select', required:true, options:[
        {value:'SD',label:'SD — Schematic Design'},
        {value:'DD',label:'DD — Design Development'},
        {value:'50% CD',label:'50% CD'},
        {value:'65% CD',label:'65% CD'},
        {value:'90% CD',label:'90% CD'},
        {value:'100% CD',label:'100% CD'}
      ]},
      {key:'ReviewDate', label:'Review Date', type:'date'},
      {key:'Status', label:'Status', type:'select', options:[{value:'In Review',label:'In Review'},{value:'Comments Returned',label:'Comments Returned'},{value:'Approved',label:'Approved'}]},
      {key:'Notes', label:'Notes', type:'textarea'},
      {key:'attachment', label:'Attachment', type:'file'}
    ]
  },
  planSheet: {
    title: 'Plan Sheet', collection: 'planSheets', idField: 'PlanSheetID',
    fields: [
      {key:'_ProjectFilter', label:'Project', type:'select', options: () => projectOptions(), transient:true},
      {key:'PlanReviewID', label:'Plan Review', type:'select', options: (v) => planReviewOptionsForProject(v._ProjectFilter), required:true},
      {key:'SheetNumber', label:'Sheet #', type:'text', required:true},
      {key:'Title', label:'Sheet Title', type:'text', required:true},
      {key:'Revision', label:'Revision', type:'text'},
      {key:'SheetDate', label:'Date', type:'date'},
      {key:'attachment', label:'Sheet File', type:'file'}
    ]
  },
  invoice: {
    title: 'Invoice', collection: 'invoices', idField: 'InvoiceID',
    lockedWhen: r => r.Status === 'Paid',
    reopenStatus: 'Approved',
    fields: [
      {key:'_ProjectFilter', label:'Project', type:'select', options: () => projectOptions(), transient:true},
      {key:'SubcontractID', label:'Subcontract', type:'select', options: (v) => subcontractOptionsForProject(v._ProjectFilter), required:true},
      {key:'InvoiceNumber', label:'Invoice #', type:'text'},
      {key:'BillingPeriod', label:'Billing Period', type:'text'},
      {key:'InvoiceDate', label:'Invoice Date', type:'date'},
      {key:'AmountRequested', label:'Amount Requested', type:'number'},
      {key:'RetentionHeld', label:'Retention Held (auto-calculated from contract %)', type:'number'},
      {key:'AmountApproved', label:'Amount Approved', type:'number'},
      {key:'AmountPaid', label:'Amount Paid', type:'number'},
      {key:'CheckNumber', label:'Check #', type:'text'},
      {key:'PaidDate', label:'Paid Date', type:'date'},
      {key:'Status', label:'Status', type:'select', options:[{value:'Submitted',label:'Submitted'},{value:'Approved',label:'Approved'},{value:'Paid',label:'Paid'}]},
      {key:'Notes', label:'Notes', type:'text'},
      {key:'attachment', label:'Invoice Document', type:'file'}
    ]
  },
  dailyReport: {
    title: 'Daily Report', collection: 'dailyReports', idField: 'DailyReportID',
    fields: [
      {key:'ProjectID', label:'Project', type:'select', options: () => projectOptions(), required:true},
      {key:'ReportDate', label:'Date', type:'date', required:true},
      {key:'Weather', label:'Weather', type:'text'},
      {key:'CrewCount', label:'Crew Count', type:'number'},
      {key:'WorkPerformed', label:'Work Performed', type:'textarea'},
      {key:'DelaysOrIssues', label:'Delays / Issues / Notable Events', type:'textarea'},
      {key:'attachment', label:'Photo / Attachment', type:'file'}
    ]
  }
};

/* ============ Modal rendering ============ */
function fieldHtml(f, initialValues){
  const val = initialValues ? (initialValues[f.key] ?? '') : '';
  if(f.type === 'computed'){
    const display = f.compute ? f.compute(initialValues || {}) : '';
    return `
      <div class="field">
        <label>${f.label}</label>
        <div style="padding:8px 10px;border:1px solid var(--hairline);border-radius:8px;background:var(--paper);color:var(--ink-soft);font-size:13px;">${display}</div>
      </div>`;
  }
  if(f.type === 'select'){
    const opts = typeof f.options === 'function' ? f.options(initialValues || {}) : f.options;
    return `
      <div class="field">
        <label>${f.label}${f.required?' *':''}</label>
        <select name="${f.key}" ${f.required?'required':''}>
          <option value="">—</option>
          ${opts.map(o=>`<option value="${esc(o.value)}" ${String(val)===String(o.value)?'selected':''}>${esc(o.label)}</option>`).join('')}
        </select>
      </div>`;
  }
  if(f.type === 'checkbox'){
    const checked = bool(val) ? 'checked' : '';
    return `
      <div class="field checkbox">
        <input type="checkbox" name="${f.key}" id="f_${f.key}" ${checked}/>
        <label for="f_${f.key}">${f.label}</label>
      </div>`;
  }
  if(f.type === 'textarea'){
    return `
      <div class="field">
        <label>${f.label}${f.required?' *':''}</label>
        <textarea name="${f.key}" ${f.required?'required':''}>${esc(val)}</textarea>
      </div>`;
  }
  if(f.type === 'file'){
    const existingName = initialValues && initialValues.AttachmentName;
    const existingUrl = initialValues && initialValues.AttachmentURL;
    return `
      <div class="field">
        <label>${f.label}</label>
        <div class="dropzone" data-file-field="${f.key}">
          <input type="file" class="dz-input" data-file-input="${f.key}" style="display:none;" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"/>
          <div class="dz-icon">${ICONS.upload}</div>
          <div class="dz-text">Drag a file here, or <span class="dz-browse">browse</span></div>
          <div class="dz-filename" data-file-name="${f.key}">
            ${existingName ? `${ICONS.paperclip} ${esc(existingName)}${existingUrl?` — <a href="${esc(existingUrl)}" ${attachmentLinkAttrs(existingUrl, existingName)} onclick="event.stopPropagation()">view</a>`:''}` : ''}
          </div>
        </div>
      </div>`;
  }
  return `
    <div class="field">
      <label>${f.label}${f.required?' *':''}</label>
      <input type="${f.type}" name="${f.key}" value="${esc(val)}" ${f.required?'required':''}/>
    </div>`;
}

/* Recompute dependent <select> option lists as the user fills in the form,
   e.g. picking a Project narrows Trade/Vendor/Subcontract choices to that project. */
function getFormValues(formEl, fields){
  const vals = {};
  fields.forEach(f=>{
    const el = formEl.querySelector(`[name="${f.key}"]`);
    if(!el) return;
    vals[f.key] = f.type === 'checkbox' ? (el.checked ? '1' : '0') : el.value;
  });
  return vals;
}
function refreshDependentSelects(formEl, form, changedKey){
  form.fields.forEach(f=>{
    if(f.type !== 'select' || typeof f.options !== 'function' || f.key === changedKey) return;
    const selectEl = formEl.querySelector(`[name="${f.key}"]`);
    if(!selectEl) return;
    const vals = getFormValues(formEl, form.fields);
    const currentVal = selectEl.value;
    const opts = f.options(vals);
    const stillValid = opts.some(o => String(o.value) === String(currentVal));
    selectEl.innerHTML = `<option value="">—</option>` + opts.map(o=>`<option value="${esc(o.value)}" ${stillValid && String(o.value)===String(currentVal)?'selected':''}>${esc(o.label)}</option>`).join('');
  });
}

function openModal(formKey, record, presets){
  const form = FORMS[formKey];
  const isEdit = !!record;
  const isLocked = isEdit && form.lockedWhen && form.lockedWhen(record);
  let initialValues = { ...(presets || {}), ...(record || {}) };

  // Invoice's Subcontract list is filtered by a transient Project field that
  // isn't stored on the record itself — derive it from the existing subcontract.
  if(formKey === 'invoice' && isEdit && record.SubcontractID){
    const sub = DATA.subcontracts.find(s => s.SubcontractID === record.SubcontractID);
    if(sub) initialValues._ProjectFilter = sub.ProjectID;
  }
  // Same pattern for Plan Sheet's Plan Review list.
  if(formKey === 'planSheet' && isEdit && record.PlanReviewID){
    const pr = DATA.planReviews.find(p => p.PlanReviewID === record.PlanReviewID);
    if(pr) initialValues._ProjectFilter = pr.ProjectID;
  }
  // Same pattern for RFI Response's RFI list.
  if(formKey === 'rfiResponse' && isEdit && record.RFIID){
    const rfi = DATA.rfis.find(r => r.RFIID === record.RFIID);
    if(rfi) initialValues._ProjectFilter = rfi.ProjectID;
  }
  // Same pattern for Submittal Review's Submittal list.
  if(formKey === 'submittalReview' && isEdit && record.SubmittalID){
    const sub = DATA.submittals.find(s => s.SubmittalID === record.SubmittalID);
    if(sub) initialValues._ProjectFilter = sub.ProjectID;
  }

  const pendingAttachments = {}; // fieldKey -> {name, url}

  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-overlay" id="modal-overlay">
      <div class="modal">
        <div class="modal-head">
          <h2>${isEdit ? 'Edit' : 'New'} ${form.title}${isLocked ? ` <span class="pill gray" style="margin-left:8px;">${ICONS.lock} Locked</span>` : ''}</h2>
          <button class="modal-close" id="modal-close" aria-label="Close">&times;</button>
        </div>
        ${isLocked ? `<div style="padding:10px 24px;background:var(--paper);border-bottom:1px solid var(--hairline);font-size:12.5px;color:var(--graphite);">This ${esc(form.title.toLowerCase())} is marked <strong>${esc(record.Status)}</strong> and locked from further edits. Use "Reopen to Edit" below if a correction is genuinely needed.</div>` : ''}
        <div class="modal-body">
          <form id="modal-form">
            ${form.fields.map(f=>fieldHtml(f, initialValues)).join('')}
          </form>
        </div>
        <div class="modal-foot">
          <div>
            ${isEdit && !form.noDelete && !isLocked ? `<button class="btn danger small" id="modal-delete">${ICONS.trash} Delete</button>` : ''}
          </div>
          <div style="display:flex;gap:8px;">
            <button class="btn secondary small" id="modal-cancel">Cancel</button>
            ${isLocked ? `<button class="btn small" id="modal-reopen">${ICONS.lock} Reopen to Edit</button>` : `<button class="btn small" id="modal-save">Save</button>`}
          </div>
        </div>
      </div>
    </div>`;

  const close = () => { root.innerHTML = ''; };
  document.getElementById('modal-close').onclick = close;
  document.getElementById('modal-cancel').onclick = close;
  document.getElementById('modal-overlay').addEventListener('click', (e)=>{ if(e.target.id==='modal-overlay') close(); });

  const formEl = document.getElementById('modal-form');

  if(isLocked){
    formEl.querySelectorAll('input, select, textarea, button').forEach(el => el.disabled = true);
    document.getElementById('modal-reopen').onclick = async () => {
      try{
        await apiPut(form.collection, record[form.idField], { Status: form.reopenStatus });
        await loadAll();
        close();
        toast(`${form.title} reopened for editing — status set to ${form.reopenStatus}`);
        render();
      }catch(err){ alert('Could not reopen: ' + err.message); }
    };
    return;
  }

  // Cascade: whenever a select the user controls changes, recompute any
  // dependent selects' option lists (e.g. Project -> Trade -> Vendor).
  formEl.addEventListener('change', (e)=>{
    if(e.target.tagName === 'SELECT'){
      refreshDependentSelects(formEl, form, e.target.name);
    }
  });

  // File drop zones
  form.fields.filter(f=>f.type==='file').forEach(f=>{
    const zone = formEl.querySelector(`[data-file-field="${f.key}"]`);
    const input = formEl.querySelector(`[data-file-input="${f.key}"]`);
    const nameEl = formEl.querySelector(`[data-file-name="${f.key}"]`);
    if(!zone) return;

    const handleFile = async (file) => {
      if(!file) return;
      nameEl.innerHTML = `Uploading ${esc(file.name)}…`;
      try{
        const result = await uploadFile(file);
        pendingAttachments[f.key] = result;
        nameEl.innerHTML = `${ICONS.paperclip} ${esc(result.name)}`;
      }catch(err){
        nameEl.innerHTML = '';
        alert('Could not attach file: ' + err.message);
      }
    };

    zone.addEventListener('click', () => input.click());
    input.addEventListener('change', () => handleFile(input.files[0]));
    zone.addEventListener('dragover', (e)=>{ e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', ()=> zone.classList.remove('dragover'));
    zone.addEventListener('drop', (e)=>{
      e.preventDefault();
      zone.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      handleFile(file);
    });
  });

  // Retainage auto-calculation: whenever the chosen Subcontract or the
  // requested amount changes, recompute Retention Held from that
  // subcontract's Retainage % — a smart default the person can still
  // override by hand afterward if a specific invoice needs something else.
  if(formKey === 'invoice'){
    const subSelect = formEl.querySelector('[name="SubcontractID"]');
    const amtReqInput = formEl.querySelector('[name="AmountRequested"]');
    const retInput = formEl.querySelector('[name="RetentionHeld"]');
    const recalcRetention = () => {
      if(!subSelect || !amtReqInput || !retInput) return;
      const sub = DATA.subcontracts.find(s => String(s.SubcontractID) === String(subSelect.value));
      const pct = sub ? parseFloat(sub.RetainagePercent) : NaN;
      const amt = parseFloat(amtReqInput.value);
      if(pct > 0 && amt > 0){
        retInput.value = (amt * pct / 100).toFixed(2);
      }
    };
    if(subSelect) subSelect.addEventListener('change', recalcRetention);
    if(amtReqInput) amtReqInput.addEventListener('input', recalcRetention);
  }

  if(isEdit && !form.noDelete){
    document.getElementById('modal-delete').onclick = async () => {
      if(!confirm(`Delete this ${form.title.toLowerCase()}? This can't be undone.`)) return;
      await apiDelete(form.collection, record[form.idField]);
      await loadAll();
      close();
      render();
      toast(`${form.title} deleted`);
    };
  }

  document.getElementById('modal-save').onclick = async () => {
    if(!formEl.reportValidity()) return;
    const fd = new FormData(formEl);
    let data = {};
    form.fields.forEach(f=>{
      if(f.transient || f.type === 'file' || f.type === 'computed') return;
      if(f.type === 'checkbox'){ data[f.key] = formEl.querySelector(`[name="${f.key}"]`).checked ? '1' : '0'; }
      else { data[f.key] = fd.get(f.key) || ''; }
    });
    form.fields.filter(f=>f.type==='file').forEach(f=>{
      const attach = pendingAttachments[f.key];
      if(attach){ data.AttachmentName = attach.name; data.AttachmentURL = attach.url; }
    });
    if(form.beforeSave) data = form.beforeSave(data);
    try{
      let saved;
      if(isEdit){
        saved = await apiPut(form.collection, record[form.idField], data);
        toast(`${form.title} updated`);
      } else {
        saved = await apiPost(form.collection, data);
        toast(`${form.title} added`);
      }
      await loadAll();
      close();
      if(form.afterSave) form.afterSave(saved, isEdit);
      render();
    }catch(err){
      alert('Could not save: ' + err.message);
    }
  };
}

/* ============ Shell ============ */
function render(){
  const app = document.getElementById('app');

  if(state.view === 'home'){
    app.innerHTML = `
      <div class="splash">
        <img src="${LOGO_SRC}" alt="Balsa Construction" class="splash-logo"/>
        <h1 class="splash-title">Balsa Construction Project Operations</h1>
        <button class="btn splash-enter" id="enter-app-btn">Enter Dashboard</button>
      </div>
    `;
    document.getElementById('enter-app-btn').addEventListener('click', ()=>{
      state.view = 'overview';
      render();
    });
    return;
  }

  app.innerHTML = `
    <div class="sidebar">
      <div class="brand">
        <img src="${LOGO_SRC}" alt="Balsa Construction" class="brand-logo"/>
        <div class="brand-sub">Project Operations</div>
      </div>
      <nav class="primary-nav">
        ${NAV().map(n => `
          <div class="nav-item ${state.view===n.id?'active':''}" data-nav="${n.id}" tabindex="0" role="button">
            ${ICONS[n.icon]}
            <span>${n.label}</span>
            ${n.count!==undefined ? `<span class="nav-count">${n.count}</span>` : ''}
          </div>
        `).join('')}
      </nav>
      <div class="sidebar-foot">
        MasterFormat 16-division tracking · ${DATA.projects.length} active projects
      </div>
    </div>
    <div class="main">
      <div class="topbar">
        <div>
          <div class="topbar-title">${topbarTitle()}</div>
          <div class="topbar-sub">${topbarSub()}</div>
        </div>
        <div style="display:flex;align-items:center;gap:12px;">
          ${state.view==='vendors' ? `
          <div class="search-box">
            ${ICONS.search}
            <input id="vendor-search-input" placeholder="Search vendors or trades" value="${esc(state.vendorSearch)}"/>
          </div>` : ''}
          ${topbarAction()}
        </div>
      </div>
      <div class="content" id="content">
        ${renderView()}
      </div>
    </div>
  `;
  bindEvents();
}

function topbarTitle(){
  const map = {overview:'Overview', projects:'Projects', bidding:'Bidding Board', subcontracts:'Subcontracts', vendors:'Vendor Directory', invoices:'Invoices', settings:'Settings', plans:'Plans', rfis:'RFIs', submittals:'Submittals', dailyreports:'Daily Reports', primechanges:'Change Orders', budget:'Budget', project: state.currentProjectId ? projectsById[state.currentProjectId].ProjectName : ''};
  return map[state.view] || '';
}
function topbarSub(){
  const map = {
    overview:'Portfolio status across all active jobs',
    projects:'Every job currently in preconstruction or construction',
    bidding:'Compare proposals by trade, lowest bid flagged automatically',
    subcontracts:'Awarded contracts and compliance document status',
    vendors:'Every contractor and supplier on file, by trade',
    invoices:'Draw requests and payment status by subcontract',
    settings:'Manage MasterFormat divisions and trades',
    plans:'Drawing sets by discipline, review phase, and sheet',
    rfis:'Requests for information and their responses',
    submittals:'Shop drawings and product data, tracked through review',
    dailyreports:'What happened on site, day by day',
    primechanges:'Owner-facing cost impacts — from first identified through executed contract change',
    budget:'Budget vs. committed vs. invoiced, by cost code',
    project: state.currentProjectId ? projectsById[state.currentProjectId].ProjectAddress : ''
  };
  return map[state.view] || '';
}
function topbarAction(){
  const presetProject = state.view==='project' ? {ProjectID: state.currentProjectId} : {};
  switch(state.view){
    case 'projects': return `<button class="btn" data-add="project">${ICONS.plus} New Project</button>`;
    case 'bidding': return `<button class="btn" data-add="bid">${ICONS.plus} Log Proposal</button>`;
    case 'subcontracts': return state.subcontractsTab==='pos'
      ? `<button class="btn" data-add="purchaseOrder">${ICONS.plus} New Purchase Order</button>`
      : `<button class="btn" data-add="subcontract">${ICONS.plus} New Subcontract</button>`;
    case 'vendors': return `<button class="btn secondary" id="pick-existing-vendor-btn">${ICONS.vendors} Add Existing Vendor</button><button class="btn" data-add="vendor">${ICONS.plus} New Vendor</button>`;
    case 'invoices': return `<button class="btn" data-add="invoice">${ICONS.plus} New Invoice</button>`;
    case 'settings': return `<button class="btn" data-add="trade">${ICONS.plus} Add Trade</button>`;
    case 'budget': return `<button class="btn" data-add="budgetLine" data-preset-project="${state.budgetProject||''}">${ICONS.plus} Set Budget</button>`;
    case 'plans': return state.plansTab==='sheets'
      ? `<button class="btn" data-add="planSheet" data-preset-project="${state.plansProject||''}">${ICONS.plus} New Plan Sheet</button>`
      : `<button class="btn" data-add="planReview" data-preset-project="${state.plansProject||''}">${ICONS.plus} New Plan Revision</button>`;
    case 'rfis': return state.rfisTab==='responses'
      ? `<button class="btn" data-add="rfiResponse" data-preset-project="${state.rfisProject||''}">${ICONS.plus} New Response</button>`
      : `<button class="btn" data-add="rfi" data-preset-project="${state.rfisProject||''}">${ICONS.plus} New RFI</button>`;
    case 'submittals': return state.submittalsTab==='reviews'
      ? `<button class="btn" data-add="submittalReview" data-preset-project="${state.submittalsProject||''}">${ICONS.plus} New Review</button>`
      : `<button class="btn" data-add="submittal" data-preset-project="${state.submittalsProject||''}">${ICONS.plus} New Submittal</button>`;
    case 'dailyreports': return `<button class="btn" data-add="dailyReport" data-preset-project="${state.dailyReportsProject||''}">${ICONS.plus} New Daily Report</button>`;
    case 'primechanges': {
      const labels = {events:['changeEvent','New Change Event'], pcos:['pco','New PCO'], pccos:['pcco','New PCCO'], ccos:['changeOrder','New CCO']};
      const [key, label] = labels[state.primeTab] || labels.events;
      return `<button class="btn" data-add="${key}" data-preset-project="${state.primeProject||''}">${ICONS.plus} ${label}</button>`;
    }
    case 'project': {
      const map = {bidding:'bid', subcontracts:'subcontract', changeorders:'changeOrder', invoices:'invoice'};
      const key = map[state.projectTab];
      const labels = {bid:'Log Proposal', subcontract:'New Subcontract', changeOrder:'New Change Order', invoice:'New Invoice'};
      return key ? `<button class="btn" data-add="${key}" data-preset-project="${state.currentProjectId}">${ICONS.plus} ${labels[key]}</button>` : '';
    }
    default: return '';
  }
}

function renderView(){
  switch(state.view){
    case 'overview': return renderOverview();
    case 'projects': return renderProjects();
    case 'project': return renderProjectWorkspace();
    case 'bidding': return renderBidding();
    case 'subcontracts': return renderSubcontracts();
    case 'vendors': return renderVendors();
    case 'invoices': return renderInvoices(null);
    case 'settings': return renderSettings();
    case 'plans': return renderPlans();
    case 'rfis': return renderRfisSection();
    case 'submittals': return renderSubmittalsSection();
    case 'dailyreports': return renderDailyReportsSection();
    case 'primechanges': return renderPrimeChanges();
    case 'budget': return renderBudget();
    default: return '';
  }
}

/* ============ Overview ============ */
function renderOverview(){
  const cards = DATA.projects.map(p=>{
    const vendors = DATA.vendors.filter(v=>v.ProjectID===p.ProjectID);
    const subs = DATA.subcontracts.filter(s=>s.ProjectID===p.ProjectID);
    const awarded = subs.reduce((s,c)=>s+subcontractCurrentAmount(c),0);
    const tradesOut = new Set(vendors.map(v=>v.TradeID)).size;
    return `
      <div class="project-card" data-project="${p.ProjectID}" tabindex="0" role="button">
        <div class="pname">${esc(p.ProjectName)}</div>
        <div class="paddr">${ICONS.pin} ${esc(p.ProjectAddress)}</div>
        <div class="prow"><span>Trades out to bid</span><span>${tradesOut}</span></div>
        <div class="prow"><span>Subcontracts awarded</span><span>${subs.length}</span></div>
        <div class="prow"><span>Awarded value</span><span>${money(awarded)}</span></div>
      </div>`;
  }).join('');

  return `
    ${renderAlertsPanel()}
    <div class="stat-grid" style="grid-template-columns:none;display:inline-grid;">
      <div class="stat-card" style="min-width:220px;"><div class="stat-label">Active Projects</div><div class="stat-value">${DATA.projects.length}</div><div class="stat-foot">Currently in preconstruction</div></div>
    </div>
    <div class="panel">
      <div class="panel-head">
        <div>
          <div class="panel-title">Project Portfolio</div>
          <div class="panel-title-sub">Click a job to open its bidding, subcontract, and financial detail</div>
        </div>
        <button class="btn secondary small" data-add="project">${ICONS.plus} New Project</button>
      </div>
      <div style="padding:16px 18px;"><div class="project-grid">${cards}</div></div>
    </div>
  `;
}

/* ============ Projects ============ */
function renderProjects(){
  const cards = DATA.projects.map(p=>{
    const vendors = DATA.vendors.filter(v=>v.ProjectID===p.ProjectID);
    const subs = DATA.subcontracts.filter(s=>s.ProjectID===p.ProjectID);
    const awarded = subs.reduce((s,c)=>s+subcontractCurrentAmount(c),0);
    const tradesOut = new Set(vendors.map(v=>v.TradeID)).size;
    return `
      <div class="project-card" data-project="${p.ProjectID}" tabindex="0" role="button">
        <div class="pname">${esc(p.ProjectName)}</div>
        <div class="paddr">${ICONS.pin} ${esc(p.ProjectAddress)}</div>
        <div class="prow"><span>Status</span><span><span class="pill green"><span class="pill-dot"></span>${esc(p.ProjectStatus)==='Yes' ? 'Active' : esc(p.ProjectStatus)}</span></span></div>
        <div class="prow"><span>Trades out to bid</span><span>${tradesOut}</span></div>
        <div class="prow"><span>Awarded value</span><span>${money(awarded)}</span></div>
      </div>`;
  }).join('');
  return `<div class="project-grid">${cards}</div>`;
}

/* ============ Project workspace ============ */
function renderProjectWorkspace(){
  const p = projectsById[state.currentProjectId];
  if(!p){ state.view='projects'; return renderProjects(); }
  const tabs = [
    {id:'bidding', label:'Bidding'},
    {id:'subcontracts', label:'Subcontracts'},
    {id:'changeorders', label:'Change Orders'},
    {id:'invoices', label:'Invoices'}
  ];
  let body = '';
  if(state.projectTab==='bidding') body = renderBiddingTable(p.ProjectID);
  else if(state.projectTab==='subcontracts') body = renderSubcontractsTable(p.ProjectID);
  else if(state.projectTab==='changeorders') body = renderChangeOrders(p.ProjectID);
  else body = renderInvoices(p.ProjectID);

  return `
    <div class="nav-item" style="display:inline-flex;color:var(--graphite);margin-bottom:16px;padding:0;" data-nav="projects" tabindex="0" role="button">
      ${ICONS.back} <span style="margin-left:6px;">Back to Projects</span>
    </div>
    <div class="panel">
      <div class="filter-row">
        ${tabs.map(t=>`<div class="chip-btn ${state.projectTab===t.id?'active':''}" data-ptab="${t.id}" tabindex="0" role="button">${t.label}</div>`).join('')}
      </div>
      ${body}
    </div>
  `;
}

/* ============ Bidding ============ */
function renderBiddingTable(projectId){
  const bids = DATA.bids.filter(b=>b.ProjectID===projectId);
  const byTrade = {};
  bids.forEach(b=>{ (byTrade[b.TradeID] = byTrade[b.TradeID]||[]).push(b); });
  const tradeIds = Object.keys(byTrade).sort((a,b)=> (divOf(a)-divOf(b)) || tradeName(a).localeCompare(tradeName(b)));
  if(tradeIds.length===0) return renderEmpty('bidding');

  return tradeIds.map(tid=>{
    const rows = byTrade[tid].slice().sort((a,b)=>(parseFloat(a.ProposalPrice)||Infinity)-(parseFloat(b.ProposalPrice)||Infinity));
    const min = Math.min(...rows.map(r=>parseFloat(r.ProposalPrice)||Infinity));
    const rowsHtml = rows.map(r=>{
      const v = DATA.vendors.find(v=>v.VendorID===r.VendorID);
      const isLow = parseFloat(r.ProposalPrice)===min && isFinite(min);
      return `<tr>
        <td>${v?esc(v.Contractor):'—'}</td>
        <td>${v?esc(v.Contact):'—'}</td>
        <td class="num ${isLow?'lowest':''}">${money(r.ProposalPrice)}</td>
        <td>${r.AttachmentURL ? `<a class="attachment-link" href="${esc(r.AttachmentURL)}" ${attachmentLinkAttrs(r.AttachmentURL, r.AttachmentName)}>${ICONS.paperclip} ${esc(r.AttachmentName||'File')}</a>` : ''}</td>
        <td>
          <div class="row-actions">
            <button class="btn secondary small" data-award="${r.BidID}">${ICONS.award} Award</button>
            <button class="btn secondary small" data-edit="bid" data-id="${r.BidID}">${ICONS.edit}</button>
          </div>
        </td>
      </tr>`;
    }).join('');
    return `
      <div style="border-bottom:1px solid var(--hairline);">
        <div style="display:flex;align-items:center;gap:8px;padding:12px 18px;background:var(--paper);">
          <span class="divchip">${divCode(divOf(tid))}</span>
          <strong style="font-family:var(--font-display);font-size:13px;">${esc(tradeName(tid))}</strong>
          <span style="font-size:11.5px;color:var(--graphite);margin-left:auto;">${rows.length} bid${rows.length!==1?'s':''}</span>
        </div>
        <table>
          <thead><tr><th>Vendor</th><th>Contact</th><th class="num">Proposal</th><th>Document</th><th></th></tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>`;
  }).join('');
}

function renderBidding(){
  if(!state.biddingProject && DATA.projects.length){
    state.biddingProject = DATA.projects[0].ProjectID;
  }
  const chips = DATA.projects.map(p=>({id:p.ProjectID,label:p.ProjectName}));
  return `
    <div class="panel">
      <div class="filter-row">
        ${chips.map(c=>`<div class="chip-btn ${state.biddingProject===c.id?'active':''}" data-bidproject="${c.id??''}" tabindex="0" role="button">${esc(c.label)}</div>`).join('')}
      </div>
      ${renderBiddingTable(state.biddingProject)}
    </div>
  `;
}

/* ============ Subcontracts ============ */
function renderSubcontractsTable(projectId){
  const rows = DATA.subcontracts.filter(s=> projectId ? s.ProjectID===projectId : true);
  if(rows.length===0) return renderEmpty('subcontracts');
  const flagDefs = [['InsuranceReceived','INS'],['W9Received','W9'],['BondReceived','BOND'],['DIRVerified','DIR']];
  const trs = rows.map(s=>{
    const statusClass = /executed|complete/i.test(s.ContractStatus) ? 'green' : /draft|pending/i.test(s.ContractStatus) ? 'amber' : 'gray';
    return `
      <tr>
        <td><span class="trade-cell"><span class="divchip">${divCode(divOf(s.TradeID))}</span>${esc(s.TradeName)}</span></td>
        <td>${esc(s.Contractor)}</td>
        <td style="font-family:var(--font-mono);font-size:12px;">${esc(s.ContractNumber)}</td>
        <td class="num">${money(subcontractCurrentAmount(s))}</td>
        <td><span class="pill ${statusClass}"><span class="pill-dot"></span>${esc(s.ContractStatus)}</span></td>
        <td>
          <div class="flagset">
            ${flagDefs.map(([field,label])=>`<span class="flag toggle ${bool(s[field])?'on':'off'}" data-toggle-flag="${field}" data-sub-id="${s.SubcontractID}">${label}</span>`).join('')}
          </div>
        </td>
        <td>
          <div class="row-actions">
            <button class="btn secondary small" data-edit="subcontract" data-id="${s.SubcontractID}">${ICONS.edit}</button>
          </div>
        </td>
      </tr>`;
  }).join('');
  return `
    <table>
      <thead><tr><th>Trade</th><th>Contractor</th><th>Contract #</th><th class="num">Value</th><th>Status</th><th>Compliance</th><th></th></tr></thead>
      <tbody>${trs}</tbody>
    </table>`;
}

function renderPurchaseOrdersTable(projectId){
  const rows = DATA.purchaseOrders.filter(po=> projectId ? po.ProjectID===projectId : true);
  if(rows.length===0){
    return `<div class="empty-state"><h3>No purchase orders logged yet</h3><p>Use a PO for direct material buyouts, equipment rental, or other purchases that don't go through a full subcontract.</p><div class="cta-btn-row"><button class="btn secondary small" data-add="purchaseOrder">${ICONS.plus} New Purchase Order</button></div></div>`;
  }
  const trs = rows.map(po=>{
    const costCode = DATA.costCodes.find(cc=>cc.CostCodeID===po.CostCodeID);
    const statusClass = po.Status==='Issued' ? 'green' : po.Status==='Closed' ? 'gray' : 'amber';
    return `<tr>
      <td style="font-family:var(--font-mono);font-size:12px;">${esc(po.PONumber)}</td>
      <td>${esc(po.Vendor)}</td>
      <td>${costCode ? `<span class="divchip">${esc(costCode.Code)}</span>` : '—'}</td>
      <td class="num">${money(po.Amount)}</td>
      <td><span class="pill ${statusClass}"><span class="pill-dot"></span>${esc(po.Status||'Draft')}</span></td>
      <td>${dateOnly(po.PODate)}</td>
      <td>${po.AttachmentURL ? `<a class="attachment-link" href="${esc(po.AttachmentURL)}" ${attachmentLinkAttrs(po.AttachmentURL, po.AttachmentName)}>${ICONS.paperclip} ${esc(po.AttachmentName||'File')}</a>` : ''}</td>
      <td><div class="row-actions"><button class="btn secondary small" data-edit="purchaseOrder" data-id="${po.POID}">${ICONS.edit}</button></div></td>
    </tr>`;
  }).join('');
  return `<table><thead><tr><th>PO #</th><th>Vendor</th><th>Cost Code</th><th class="num">Amount</th><th>Status</th><th>PO Date</th><th>Document</th><th></th></tr></thead><tbody>${trs}</tbody></table>`;
}

function renderSubcontracts(){
  const tabs = [
    {id:'subs', label:'Subcontracts'},
    {id:'pos', label:'Purchase Orders'}
  ];
  return `
    <div class="panel">
      <div class="filter-row">
        ${tabs.map(t=>`<div class="chip-btn ${state.subcontractsTab===t.id?'active':''}" data-subcontracts-tab="${t.id}" tabindex="0" role="button">${t.label}</div>`).join('')}
      </div>
      ${state.subcontractsTab==='pos' ? renderPurchaseOrdersTable(null) : renderSubcontractsTable(null)}
    </div>
  `;
}

/* ============ Vendors ============ */
function renderVendors(){
  const divisions = DATA.divisions;
  let rows = DATA.vendors;
  if(state.vendorProject) rows = rows.filter(v=>v.ProjectID===state.vendorProject);
  if(state.vendorDivision) rows = rows.filter(v=>v.DivisionID===state.vendorDivision);
  if(state.vendorStatus==='active') rows = rows.filter(v=>bool(v.Active));
  if(state.vendorStatus==='awarded') rows = rows.filter(v=>bool(v.Awarded));
  if(state.vendorSearch){
    const q = state.vendorSearch.toLowerCase();
    rows = rows.filter(v => (v.Contractor||'').toLowerCase().includes(q) || (v.TradeName||'').toLowerCase().includes(q));
  }
  const visible = rows.slice(0,200);
  const visibleIds = visible.map(v=>v.VendorID);
  const allVisibleSelected = visibleIds.length>0 && visibleIds.every(id=>state.selectedVendors.has(id));
  const selectedCount = state.selectedVendors.size;

  const trs = visible.map(v=>{
    const contact = DATA.contactLog.find(c=>c.VendorID===v.VendorID);
    const lastContacted = contact ? dateOnly(contact.DateTimeLastContacted) : null;
    const checked = state.selectedVendors.has(v.VendorID);
    const elig = vendorEligibility(v);
    const canEmail = !!v.Email && elig !== 'ineligible';
    let statusPill;
    if(bool(v.Awarded)) statusPill = '<span class="pill green"><span class="pill-dot"></span>Awarded</span>';
    else if(hasSubmittedBid(v)) statusPill = '<span class="pill gray"><span class="pill-dot"></span>Bid Submitted</span>';
    else if(v.BidResponse === 'DECLINED') statusPill = '<span class="pill red"><span class="pill-dot"></span>Declined</span>';
    else if(v.BidResponse === 'BIDDING') statusPill = '<span class="pill amber"><span class="pill-dot"></span>Responded</span>';
    else statusPill = '<span class="pill gray"><span class="pill-dot"></span>No Response</span>';
    return `
    <tr class="${checked?'row-selected':''}">
      <td style="width:32px;"><input type="checkbox" class="vendor-cb" data-vendor-cb="${v.VendorID}" ${checked?'checked':''} ${canEmail?'':'disabled'}/></td>
      <td><span class="trade-cell"><span class="divchip">${divCode(v.DivisionID)}</span>${esc(v.TradeName)}</span></td>
      <td>${esc(v.Contractor)}</td>
      <td>${esc(v.Contact)}</td>
      <td style="font-family:var(--font-mono);font-size:12px;">${esc(v.Phone)}</td>
      <td>${ v.ProposalPrice ? money(v.ProposalPrice) : '<span style="color:var(--graphite);">—</span>'}</td>
      <td>${statusPill}</td>
      <td style="font-size:11.5px;color:var(--graphite);">${lastContacted ? `Contacted ${lastContacted}` : '—'}</td>
      <td>
        <div class="row-actions">
          <button class="btn secondary small" data-contact="${v.VendorID}" ${canEmail?'':'disabled'} title="${canEmail?'':'Already declined or submitted a bid — not eligible to email'}">${ICONS.mail} Contact</button>
          <button class="btn secondary small" data-edit="vendor" data-id="${v.VendorID}">${ICONS.edit}</button>
        </div>
      </td>
    </tr>`;
  }).join('');

  return `
    <div class="panel">
      <div class="filter-row">
        <div class="chip-btn ${state.vendorStatus===null?'active':''}" data-vstatus="" tabindex="0" role="button">All (${DATA.vendors.length})</div>
        <div class="chip-btn ${state.vendorStatus==='active'?'active':''}" data-vstatus="active" tabindex="0" role="button">Active</div>
        <div class="chip-btn ${state.vendorStatus==='awarded'?'active':''}" data-vstatus="awarded" tabindex="0" role="button">Awarded</div>
        <select id="project-select" style="margin-left:auto;font-family:var(--font-body);font-size:12.5px;border:1px solid var(--hairline);border-radius:100px;padding:6px 12px;background:var(--panel);color:var(--ink-soft);">
          <option value="">All projects</option>
          ${DATA.projects.map(p=>`<option value="${p.ProjectID}" ${state.vendorProject===p.ProjectID?'selected':''}>${esc(p.ProjectName)}</option>`).join('')}
        </select>
        <select id="division-select" style="font-family:var(--font-body);font-size:12.5px;border:1px solid var(--hairline);border-radius:100px;padding:6px 12px;background:var(--panel);color:var(--ink-soft);">
          <option value="">All divisions</option>
          ${divisions.map(d=>`<option value="${d.DivisionID}" ${state.vendorDivision===d.DivisionID?'selected':''}>${divCode(d.DivisionID)} — ${esc(d.DivisionName)}</option>`).join('')}
        </select>
      </div>
      ${selectedCount>0 ? `
      <div style="display:flex;align-items:center;gap:12px;padding:10px 18px;background:var(--amber-bg);border-bottom:1px solid var(--hairline);">
        <strong style="font-size:12.5px;color:var(--ink);">${selectedCount} contractor${selectedCount!==1?'s':''} selected</strong>
        <button class="btn small" id="email-selected-btn">${ICONS.mail} Email Selected</button>
        <button class="btn secondary small" id="clear-selection-btn">Clear</button>
      </div>` : ''}
      <table>
        <thead><tr>
          <th style="width:32px;"><input type="checkbox" id="select-all-vendors" ${allVisibleSelected?'checked':''}/></th>
          <th>Trade</th><th>Contractor</th><th>Contact</th><th>Phone</th><th class="num">Proposal</th><th>Status</th><th>Outreach</th><th></th>
        </tr></thead>
        <tbody>${trs || `<tr><td colspan="9" style="text-align:center;color:var(--graphite);padding:24px;">No vendors match these filters.</td></tr>`}</tbody>
      </table>
      ${rows.length>200 ? `<div style="padding:10px 18px;font-size:11.5px;color:var(--graphite);">Showing first 200 of ${rows.length} matches — narrow with search or filters.</div>` : ''}
    </div>
  `;
}

/* ============ Plans (Disciplines -> Plan Reviews -> Plan Sheets) ============ */
function renderPlans(){
  if(!state.plansProject && DATA.projects.length){
    state.plansProject = DATA.projects[0].ProjectID;
  }
  const projectId = state.plansProject;
  const tabs = [
    {id:'reviews', label:'Plan Revisions'},
    {id:'sheets', label:'Plan Sheets'}
  ];
  return `
    <div class="panel">
      <div class="filter-row">
        <select id="plans-project-select" style="font-family:var(--font-body);font-size:12.5px;border:1px solid var(--hairline);border-radius:100px;padding:6px 12px;background:var(--panel);color:var(--ink-soft);">
          ${DATA.projects.map(p=>`<option value="${p.ProjectID}" ${projectId===p.ProjectID?'selected':''}>${esc(p.ProjectName)}</option>`).join('')}
        </select>
        ${tabs.map(t=>`<div class="chip-btn ${state.plansTab===t.id?'active':''}" data-plans-tab="${t.id}" tabindex="0" role="button">${t.label}</div>`).join('')}
      </div>
      ${state.plansTab==='sheets' ? renderPlanSheetsBody(projectId) : renderPlanReviewsBody(projectId)}
    </div>
  `;
}

/* ============ RFIs (RFIs -> RFI Responses) ============ */
function renderRfisSection(){
  if(!state.rfisProject && DATA.projects.length){
    state.rfisProject = DATA.projects[0].ProjectID;
  }
  const projectId = state.rfisProject;
  const projectName = projectId && projectsById[projectId] ? projectsById[projectId].ProjectName : '';
  const tabs = [
    {id:'rfis', label:'RFIs'},
    {id:'responses', label:'RFI Responses'}
  ];
  return `
    <div class="panel">
      <div class="filter-row">
        <select id="rfis-project-select" style="font-family:var(--font-body);font-size:12.5px;border:1px solid var(--hairline);border-radius:100px;padding:6px 12px;background:var(--panel);color:var(--ink-soft);">
          ${DATA.projects.map(p=>`<option value="${p.ProjectID}" ${projectId===p.ProjectID?'selected':''}>${esc(p.ProjectName)}</option>`).join('')}
        </select>
        ${tabs.map(t=>`<div class="chip-btn ${state.rfisTab===t.id?'active':''}" data-rfis-tab="${t.id}" tabindex="0" role="button">${t.label}</div>`).join('')}
      </div>
      ${state.rfisTab==='responses' ? renderRfiResponsesBody(projectId, projectName) : renderRfisBody(projectId, projectName)}
    </div>
  `;
}

/* ============ Submittals (Submittals -> Submittal Reviews) ============ */
function renderSubmittalsSection(){
  if(!state.submittalsProject && DATA.projects.length){
    state.submittalsProject = DATA.projects[0].ProjectID;
  }
  const projectId = state.submittalsProject;
  const projectName = projectId && projectsById[projectId] ? projectsById[projectId].ProjectName : '';
  const tabs = [
    {id:'submittals', label:'Submittals'},
    {id:'reviews', label:'Submittal Reviews'}
  ];
  return `
    <div class="panel">
      <div class="filter-row">
        <select id="submittals-project-select" style="font-family:var(--font-body);font-size:12.5px;border:1px solid var(--hairline);border-radius:100px;padding:6px 12px;background:var(--panel);color:var(--ink-soft);">
          ${DATA.projects.map(p=>`<option value="${p.ProjectID}" ${projectId===p.ProjectID?'selected':''}>${esc(p.ProjectName)}</option>`).join('')}
        </select>
        ${tabs.map(t=>`<div class="chip-btn ${state.submittalsTab===t.id?'active':''}" data-submittals-tab="${t.id}" tabindex="0" role="button">${t.label}</div>`).join('')}
      </div>
      ${state.submittalsTab==='reviews' ? renderSubmittalReviewsBody(projectId, projectName) : renderSubmittalsBody(projectId, projectName)}
    </div>
  `;
}

function renderSubmittalsBody(projectId, projectName){
  if(!projectId) return `<div class="empty-state"><h3>No projects yet</h3><p>Add a project first to log submittals for it.</p></div>`;
  const rows = DATA.submittals.filter(s=>s.ProjectID===projectId).sort((a,b)=>(a.Code||'').localeCompare(b.Code||''));
  const rowsHtml = rows.map(s=>{
    const reviewCount = DATA.submittalReviews.filter(r=>r.SubmittalID===s.SubmittalID).length;
    const latestReview = DATA.submittalReviews.filter(r=>r.SubmittalID===s.SubmittalID)
      .sort((a,b)=>(b.ReviewDate||'').localeCompare(a.ReviewDate||''))[0];
    const outcomeClass = latestReview?.Outcome==='Approved' ? 'green' : latestReview?.Outcome==='Rejected' ? 'red' : latestReview ? 'amber' : 'gray';
    return `
    <div class="settings-row">
      <span class="divchip">${esc(s.Code)}</span>
      <span class="settings-row-name">${esc(s.Title)}${s.SpecSection?` <span style="color:var(--graphite);font-weight:400;">— ${esc(s.SpecSection)}</span>`:''}</span>
      <span style="font-size:11.5px;color:var(--graphite);margin-right:8px;">${reviewCount} review${reviewCount!==1?'s':''}</span>
      ${latestReview ? `<span class="pill ${outcomeClass}" style="margin-right:8px;">${esc(latestReview.Outcome)}</span>` : ''}
      <span class="pill ${s.Status==='Closed'?'green':'gray'}" style="margin-right:8px;">${esc(s.Status||'Open')}</span>
      ${s.AttachmentURL ? `<a class="attachment-link" style="margin-right:8px;" href="${esc(s.AttachmentURL)}" ${attachmentLinkAttrs(s.AttachmentURL, s.AttachmentName)}>${ICONS.paperclip} ${esc(s.AttachmentName||'File')}</a>` : ''}
      <div class="row-actions" style="opacity:1;">
        <button class="btn secondary small" data-edit="submittal" data-id="${s.SubmittalID}">${ICONS.edit} Edit</button>
      </div>
    </div>`;
  }).join('');
  return `
    <div style="padding:16px 18px;">
      <p style="font-size:12.5px;color:var(--graphite);margin:0 0 14px;">Submittals for <strong>${esc(projectName)}</strong> — shop drawings and product data awaiting review.</p>
      <div class="cta-btn-row" style="margin:0 0 16px;"><button class="btn small" data-add="submittal" data-preset-project="${projectId}">${ICONS.plus} New Submittal</button></div>
      ${rowsHtml || '<div style="color:var(--graphite);font-size:13px;">No submittals yet for this project.</div>'}
    </div>
  `;
}

function renderSubmittalReviewsBody(projectId, projectName){
  if(!projectId) return `<div class="empty-state"><h3>No projects yet</h3><p>Add a project first to log submittal reviews for it.</p></div>`;
  const submittalIds = new Set(DATA.submittals.filter(s=>s.ProjectID===projectId).map(s=>s.SubmittalID));
  const rows = DATA.submittalReviews.filter(r=>submittalIds.has(r.SubmittalID));
  const rowsHtml = rows.map(r=>{
    const submittal = DATA.submittals.find(s=>s.SubmittalID===r.SubmittalID);
    const outcomeClass = r.Outcome==='Approved' ? 'green' : r.Outcome==='Rejected' ? 'red' : 'amber';
    return `
    <div class="settings-division">
      <div class="settings-division-head">
        <span class="divchip">${submittal?esc(submittal.Code):'—'}</span>
        <strong style="font-family:var(--font-display);font-size:13px;">${submittal?esc(submittal.Title):'—'}</strong>
        ${r.Outcome ? `<span class="pill ${outcomeClass}" style="margin-left:8px;"><span class="pill-dot"></span>${esc(r.Outcome)}</span>` : ''}
        ${r.AttachmentURL ? `<a class="attachment-link" style="margin-left:8px;" href="${esc(r.AttachmentURL)}" ${attachmentLinkAttrs(r.AttachmentURL, r.AttachmentName)}>${ICONS.paperclip} ${esc(r.AttachmentName||'File')}</a>` : ''}
        <button class="btn secondary small" style="margin-left:auto;" data-edit="submittalReview" data-id="${r.SubmittalReviewID}">${ICONS.edit} Edit</button>
      </div>
      <div style="padding:12px 14px;font-size:12.5px;">
        <div style="display:flex;gap:16px;margin-bottom:8px;color:var(--graphite);">
          <span>Reviewer: ${esc(r.Reviewer||'—')}</span>
          <span>Date: ${dateOnly(r.ReviewDate)}</span>
        </div>
        ${r.Comments ? `<div>${esc(r.Comments)}</div>` : ''}
      </div>
    </div>`;
  }).join('');
  return `
    <div style="padding:16px 18px;">
      <p style="font-size:12.5px;color:var(--graphite);margin:0 0 14px;">Review rounds for submittals on <strong>${esc(projectName)}</strong> — each round records who reviewed it, when, and the outcome.</p>
      <div class="cta-btn-row" style="margin:0 0 16px;"><button class="btn small" data-add="submittalReview" data-preset-project="${projectId}">${ICONS.plus} New Review</button></div>
      ${rowsHtml || '<div style="color:var(--graphite);font-size:13px;">No submittal reviews logged yet for this project.</div>'}
    </div>
  `;
}

/* ============ Daily Reports ============ */
function renderDailyReportsSection(){
  if(!state.dailyReportsProject && DATA.projects.length){
    state.dailyReportsProject = DATA.projects[0].ProjectID;
  }
  const projectId = state.dailyReportsProject;
  const rows = DATA.dailyReports.filter(r=>r.ProjectID===projectId)
    .sort((a,b)=>(b.ReportDate||'').localeCompare(a.ReportDate||''));

  const rowsHtml = rows.map(r=>{
    const workExcerpt = (r.WorkPerformed||'').length > 90 ? r.WorkPerformed.slice(0,90)+'…' : (r.WorkPerformed||'');
    return `
    <div class="settings-division">
      <div class="settings-division-head">
        <span class="divchip" style="width:auto;padding:0 8px;">${dateOnly(r.ReportDate)}</span>
        <strong style="font-family:var(--font-display);font-size:13px;">${esc(r.Weather||'—')}</strong>
        <span style="font-size:11.5px;color:var(--graphite);">${r.CrewCount ? `${esc(r.CrewCount)} crew` : ''}</span>
        ${r.AttachmentURL ? `<a class="attachment-link" style="margin-left:8px;" href="${esc(r.AttachmentURL)}" ${attachmentLinkAttrs(r.AttachmentURL, r.AttachmentName)}>${ICONS.paperclip} ${esc(r.AttachmentName||'File')}</a>` : ''}
        <button class="btn secondary small" style="margin-left:auto;" data-edit="dailyReport" data-id="${r.DailyReportID}">${ICONS.edit} Edit</button>
      </div>
      <div style="padding:12px 14px;font-size:12.5px;">
        ${workExcerpt ? `<div style="margin-bottom:8px;"><strong style="color:var(--graphite);">Work performed:</strong> ${esc(workExcerpt)}</div>` : ''}
        ${r.DelaysOrIssues ? `<div><strong style="color:var(--graphite);">Delays / issues:</strong> ${esc(r.DelaysOrIssues)}</div>` : ''}
      </div>
    </div>`;
  }).join('');

  return `
    <div class="panel">
      <div class="filter-row">
        <select id="dailyreports-project-select" style="font-family:var(--font-body);font-size:12.5px;border:1px solid var(--hairline);border-radius:100px;padding:6px 12px;background:var(--panel);color:var(--ink-soft);">
          ${DATA.projects.map(p=>`<option value="${p.ProjectID}" ${projectId===p.ProjectID?'selected':''}>${esc(p.ProjectName)}</option>`).join('')}
        </select>
      </div>
      <div style="padding:16px 18px;">
        <p style="font-size:12.5px;color:var(--graphite);margin:0 0 14px;">A day-by-day field log for <strong>${projectId && projectsById[projectId] ? esc(projectsById[projectId].ProjectName) : ''}</strong> — weather, crew size, work performed, and anything notable, most recent first.</p>
        <div class="cta-btn-row" style="margin:0 0 16px;"><button class="btn small" data-add="dailyReport" data-preset-project="${projectId||''}">${ICONS.plus} New Daily Report</button></div>
        ${rowsHtml || '<div style="color:var(--graphite);font-size:13px;">No daily reports logged yet for this project.</div>'}
      </div>
    </div>
  `;
}

function renderPlanReviewsBody(projectId){
  const rows = DATA.planReviews.filter(pr=>pr.ProjectID===projectId);
  if(rows.length===0) return `<div class="empty-state"><h3>No plan revisions logged yet</h3><p>Log a revision milestone for a discipline — e.g. "Structural, 65% CD" — then attach sheets to it.</p></div>`;
  const trs = rows.map(pr=>{
    const disc = DATA.disciplines.find(d=>d.DisciplineID===pr.DisciplineID);
    const sheetCount = DATA.planSheets.filter(s=>s.PlanReviewID===pr.PlanReviewID).length;
    const statusClass = pr.Status==='Approved' ? 'green' : pr.Status==='Comments Returned' ? 'amber' : 'gray';
    return `<tr>
      <td><span class="divchip">${esc(disc?disc.Code:'—')}</span></td>
      <td>${esc(disc?disc.Name:'—')}</td>
      <td>${esc(pr.Phase)}</td>
      <td><span class="pill ${statusClass}"><span class="pill-dot"></span>${esc(pr.Status||'In Review')}</span></td>
      <td>${dateOnly(pr.ReviewDate)}</td>
      <td class="num">${sheetCount} sheet${sheetCount!==1?'s':''}</td>
      <td>${pr.AttachmentURL ? `<a class="attachment-link" href="${esc(pr.AttachmentURL)}" ${attachmentLinkAttrs(pr.AttachmentURL, pr.AttachmentName)}>${ICONS.paperclip} ${esc(pr.AttachmentName||'File')}</a>` : ''}</td>
      <td><div class="row-actions"><button class="btn secondary small" data-edit="planReview" data-id="${pr.PlanReviewID}">${ICONS.edit} Edit</button></div></td>
    </tr>`;
  }).join('');
  return `<table><thead><tr><th>Disc</th><th>Discipline</th><th>Phase</th><th>Status</th><th>Review Date</th><th class="num">Sheets</th><th>Document</th><th></th></tr></thead><tbody>${trs}</tbody></table>`;
}

function renderPlanSheetsBody(projectId){
  const reviewIds = new Set(DATA.planReviews.filter(pr=>pr.ProjectID===projectId).map(pr=>pr.PlanReviewID));
  const rows = DATA.planSheets.filter(s=>reviewIds.has(s.PlanReviewID));
  if(rows.length===0) return `<div class="empty-state"><h3>No plan sheets logged yet</h3><p>Sheets belong to a Plan Revision — log a Plan Revision for this project first, then add sheets to it.</p></div>`;
  const trs = rows.map(s=>{
    const pr = DATA.planReviews.find(p=>p.PlanReviewID===s.PlanReviewID);
    const disc = pr ? DATA.disciplines.find(d=>d.DisciplineID===pr.DisciplineID) : null;
    return `<tr>
      <td style="font-family:var(--font-mono);font-size:12px;">${esc(s.SheetNumber)}</td>
      <td>${esc(s.Title)}</td>
      <td><span class="divchip">${esc(disc?disc.Code:'—')}</span></td>
      <td>${pr ? esc(pr.Phase) : '—'}</td>
      <td>${esc(s.Revision)}</td>
      <td>${dateOnly(s.SheetDate)}</td>
      <td>${s.AttachmentURL ? `<a class="attachment-link" href="${esc(s.AttachmentURL)}" ${attachmentLinkAttrs(s.AttachmentURL, s.AttachmentName)}>${ICONS.paperclip} ${esc(s.AttachmentName||'File')}</a>` : ''}</td>
      <td><div class="row-actions"><button class="btn secondary small" data-edit="planSheet" data-id="${s.PlanSheetID}">${ICONS.edit} Edit</button></div></td>
    </tr>`;
  }).join('');
  return `<table><thead><tr><th>Sheet #</th><th>Title</th><th>Disc</th><th>Phase</th><th>Rev</th><th>Date</th><th>File</th><th></th></tr></thead><tbody>${trs}</tbody></table>`;
}

/* ============ Prime Changes (Change Event -> PCO -> PCCO) ============ */
function renderPrimeChanges(){
  if(!state.primeProject && DATA.projects.length){
    state.primeProject = DATA.projects[0].ProjectID;
  }
  const projectId = state.primeProject;
  const tabs = [
    {id:'events', label:'Change Events'},
    {id:'pcos', label:'PCOs'},
    {id:'pccos', label:'PCCOs'},
    {id:'ccos', label:'CCOs'}
  ];
  let body;
  if(state.primeTab==='pcos') body = renderPCOsBody(projectId);
  else if(state.primeTab==='pccos') body = renderPCCOsBody(projectId);
  else if(state.primeTab==='ccos') body = renderChangeOrders(projectId);
  else body = renderChangeEventsBody(projectId);

  return `
    <div class="panel">
      <div class="filter-row">
        <select id="prime-project-select" style="font-family:var(--font-body);font-size:12.5px;border:1px solid var(--hairline);border-radius:100px;padding:6px 12px;background:var(--panel);color:var(--ink-soft);">
          ${DATA.projects.map(p=>`<option value="${p.ProjectID}" ${projectId===p.ProjectID?'selected':''}>${esc(p.ProjectName)}</option>`).join('')}
        </select>
        ${tabs.map(t=>`<div class="chip-btn ${state.primeTab===t.id?'active':''}" data-prime-tab="${t.id}" tabindex="0" role="button">${t.label}</div>`).join('')}
      </div>
      ${body}
    </div>
  `;
}

function renderChangeEventsBody(projectId){
  const rows = DATA.changeEvents.filter(ce=>ce.ProjectID===projectId);
  if(rows.length===0) return `<div class="empty-state"><h3>No change events logged yet</h3><p>A Change Event is the umbrella for an issue that impacts cost — it can tie together a PCO to the owner and one or more Change Orders to subcontractors. Optional, but useful when one issue touches both sides.</p></div>`;
  const trs = rows.map(ce=>{
    const pcoCount = DATA.pcos.filter(p=>p.ChangeEventID===ce.ChangeEventID).length;
    const ccoCount = DATA.changeOrders.filter(c=>c.ChangeEventID===ce.ChangeEventID).length;
    const statusClass = ce.Status==='Closed' ? 'green' : ce.Status==='Priced' ? 'amber' : 'gray';
    return `<tr>
      <td style="font-family:var(--font-mono);font-size:12px;">${esc(ce.EventNumber)}</td>
      <td>${esc(ce.Title)}</td>
      <td><span class="pill ${statusClass}"><span class="pill-dot"></span>${esc(ce.Status||'Open')}</span></td>
      <td>${dateOnly(ce.DateIdentified)}</td>
      <td class="num">${pcoCount} PCO${pcoCount!==1?'s':''}</td>
      <td class="num">${ccoCount} CCO${ccoCount!==1?'s':''}</td>
      <td>${ce.AttachmentURL ? `<a class="attachment-link" href="${esc(ce.AttachmentURL)}" ${attachmentLinkAttrs(ce.AttachmentURL, ce.AttachmentName)}>${ICONS.paperclip} ${esc(ce.AttachmentName||'File')}</a>` : ''}</td>
      <td><div class="row-actions"><button class="btn secondary small" data-edit="changeEvent" data-id="${ce.ChangeEventID}">${ICONS.edit} Edit</button></div></td>
    </tr>`;
  }).join('');
  return `<table><thead><tr><th>CE #</th><th>Title</th><th>Status</th><th>Identified</th><th class="num">PCOs</th><th class="num">CCOs</th><th>Document</th><th></th></tr></thead><tbody>${trs}</tbody></table>`;
}

function renderPCOsBody(projectId){
  const rows = DATA.pcos.filter(p=>p.ProjectID===projectId);
  if(rows.length===0) return `<div class="empty-state"><h3>No PCOs logged yet</h3><p>A Potential Change Order is the owner-facing, priced-but-not-yet-approved version of a cost impact — including your markup. Approve one to automatically create the executed PCCO.</p></div>`;
  const trs = rows.map(p=>{
    const ce = DATA.changeEvents.find(c=>c.ChangeEventID===p.ChangeEventID);
    const statusClass = p.Status==='Approved' ? 'green' : p.Status==='Rejected' ? 'red' : p.Status==='Submitted' ? 'amber' : 'gray';
    return `<tr>
      <td style="font-family:var(--font-mono);font-size:12px;">${esc(p.PCONumber)}</td>
      <td>${esc(p.Title)}</td>
      <td>${ce ? esc(ce.EventNumber) : '—'}</td>
      <td class="num">${money(p.ProposedAmount)}</td>
      <td><span class="pill ${statusClass}"><span class="pill-dot"></span>${esc(p.Status||'Draft')}</span></td>
      <td>${p.AttachmentURL ? `<a class="attachment-link" href="${esc(p.AttachmentURL)}" ${attachmentLinkAttrs(p.AttachmentURL, p.AttachmentName)}>${ICONS.paperclip} ${esc(p.AttachmentName||'File')}</a>` : ''}</td>
      <td>
        <div class="row-actions">
          ${p.Status!=='Approved' ? `<button class="btn secondary small" data-approve-pco="${p.PCOID}">${ICONS.award} Approve → PCCO</button>` : ''}
          <button class="btn secondary small" data-edit="pco" data-id="${p.PCOID}">${ICONS.edit}</button>
        </div>
      </td>
    </tr>`;
  }).join('');
  return `<table><thead><tr><th>PCO #</th><th>Title</th><th>Change Event</th><th class="num">Proposed</th><th>Status</th><th>Document</th><th></th></tr></thead><tbody>${trs}</tbody></table>`;
}

function renderPCCOsBody(projectId){
  const rows = DATA.pccos.filter(p=>p.ProjectID===projectId);
  if(rows.length===0) return `<div class="empty-state"><h3>No PCCOs yet</h3><p>A Prime Contract Change Order is the formal, executed change to the owner's contract — created automatically when you approve a PCO, or logged manually here.</p></div>`;
  const trs = rows.map(pcco=>{
    const pco = DATA.pcos.find(p=>p.PCOID===pcco.PCOID);
    const statusClass = pcco.Status==='Executed' ? 'green' : 'amber';
    return `<tr>
      <td style="font-family:var(--font-mono);font-size:12px;">${esc(pcco.PCCONumber)}</td>
      <td>${pco ? esc(pco.Title) : '—'}</td>
      <td>${pco ? esc(pco.PCONumber) : '—'}</td>
      <td class="num">${money(pcco.Amount)}</td>
      <td><span class="pill ${statusClass}"><span class="pill-dot"></span>${esc(pcco.Status)}</span></td>
      <td>${dateOnly(pcco.ExecutedDate)}</td>
      <td>${pcco.AttachmentURL ? `<a class="attachment-link" href="${esc(pcco.AttachmentURL)}" ${attachmentLinkAttrs(pcco.AttachmentURL, pcco.AttachmentName)}>${ICONS.paperclip} ${esc(pcco.AttachmentName||'File')}</a>` : ''}</td>
      <td><div class="row-actions"><button class="btn secondary small" data-edit="pcco" data-id="${pcco.PCCOID}">${ICONS.edit}</button></div></td>
    </tr>`;
  }).join('');
  return `<table><thead><tr><th>PCCO #</th><th>Title</th><th>Source PCO</th><th class="num">Amount</th><th>Status</th><th>Executed</th><th>Document</th><th></th></tr></thead><tbody>${trs}</tbody></table>`;
}

/* ============ Budget vs. Actual ============ */
// Committed cost per Cost Code = subcontract original amounts tagged to that
// code, plus any approved Change Orders (CCOs) tagged to that same code —
// a CCO can shift cost between codes independently of its parent subcontract.
// Invoiced cost rolls up through each subcontract's own Cost Code.
function computeBudgetRows(projectId){
  const subs = DATA.subcontracts.filter(s=>s.ProjectID===projectId);
  const ccos = DATA.changeOrders.filter(c=>c.ProjectID===projectId);
  const pos = DATA.purchaseOrders.filter(po=>po.ProjectID===projectId);
  const budgetLines = DATA.budgetLines.filter(b=>b.ProjectID===projectId);

  const costCodeIds = new Set([
    ...budgetLines.map(b=>b.CostCodeID),
    ...subs.filter(s=>s.CostCodeID).map(s=>s.CostCodeID),
    ...ccos.filter(c=>c.CostCodeID).map(c=>c.CostCodeID),
    ...pos.filter(po=>po.CostCodeID).map(po=>po.CostCodeID)
  ]);

  const rows = [...costCodeIds].map(ccId=>{
    const costCode = DATA.costCodes.find(c=>c.CostCodeID===ccId);
    const budget = budgetLines.filter(b=>b.CostCodeID===ccId).reduce((s,b)=>s+(parseFloat(b.BudgetAmount)||0),0);
    const codeSubs = subs.filter(s=>s.CostCodeID===ccId);
    const subsCommitted = codeSubs.reduce((s,c)=>s+(parseFloat(c.OriginalContractAmount)||0),0);
    const approvedCCOs = ccos.filter(c=>c.CostCodeID===ccId && c.Status==='Approved').reduce((s,c)=>s+(parseFloat(c.Amount)||0),0);
    const issuedPOs = pos.filter(po=>po.CostCodeID===ccId && po.Status!=='Draft').reduce((s,po)=>s+(parseFloat(po.Amount)||0),0);
    const committed = subsCommitted + approvedCCOs + issuedPOs;
    const subIds = new Set(codeSubs.map(s=>s.SubcontractID));
    const invoiced = DATA.invoices.filter(i=>subIds.has(i.SubcontractID))
      .reduce((s,i)=>s+(parseFloat(i.AmountApproved)||parseFloat(i.AmountRequested)||0),0);
    const variance = budget - committed;
    return { costCode, budget, committed, invoiced, variance };
  });

  rows.sort((a,b)=>(a.costCode?.Code||'').localeCompare(b.costCode?.Code||''));
  return rows;
}

/* ============ Dashboard Alerts ============
   Scans across every project for things that actually need a human to look
   at them — expiring insurance, invoices sitting too long, stale PCOs,
   approaching bid dates, and cost codes that have gone over budget. */
function computeAlerts(){
  const alerts = [];
  const today = new Date();
  const daysUntil = (dateStr) => {
    if(!dateStr) return null;
    const target = new Date(dateStr);
    if(isNaN(target.getTime())) return null;
    return Math.round((target - today) / 86400000);
  };

  // Insurance expiring or already expired
  DATA.subcontracts.forEach(s=>{
    const days = daysUntil(s.InsuranceExpiration);
    if(days === null || days > 30) return;
    const project = projectsById[s.ProjectID];
    alerts.push({
      severity: days < 0 ? 'red' : 'amber',
      category: 'Insurance',
      message: `${s.Contractor}'s insurance ${days < 0 ? `expired ${Math.abs(days)} day${Math.abs(days)!==1?'s':''} ago` : `expires in ${days} day${days!==1?'s':''}`}${project?` — ${project.ProjectName}`:''}`,
      view: 'subcontracts', projectId: s.ProjectID
    });
  });

  // Invoices sitting in Submitted status too long
  DATA.invoices.forEach(i=>{
    if(i.Status !== 'Submitted') return;
    const days = daysUntil(i.InvoiceDate);
    if(days === null || -days < 30) return;
    const sub = DATA.subcontracts.find(s=>s.SubcontractID===i.SubcontractID);
    const project = sub ? projectsById[sub.ProjectID] : null;
    alerts.push({
      severity: 'amber',
      category: 'Invoices',
      message: `Invoice ${i.InvoiceNumber||'(no #)'} from ${sub?sub.Contractor:'—'} pending ${-days} days${project?` — ${project.ProjectName}`:''}`,
      view: 'invoices', projectId: sub?sub.ProjectID:null
    });
  });

  // PCOs stuck in Draft/Submitted too long
  DATA.pcos.forEach(p=>{
    if(!['Draft','Submitted'].includes(p.Status)) return;
    const days = daysUntil(p.DateSubmitted);
    if(days === null || -days < 14) return;
    const project = projectsById[p.ProjectID];
    alerts.push({
      severity: 'amber',
      category: 'PCOs',
      message: `${p.PCONumber} — ${p.Title} has been ${p.Status.toLowerCase()} for ${-days} days${project?` — ${project.ProjectName}`:''}`,
      view: 'primechanges', projectId: p.ProjectID, presetTab: 'pcos'
    });
  });

  // Bid due dates approaching or passed with no clear resolution
  DATA.projects.forEach(proj=>{
    const days = daysUntil(proj.BidDueDate);
    if(days === null || days > 7) return;
    alerts.push({
      severity: days < 0 ? 'red' : 'amber',
      category: 'Bidding',
      message: `${proj.ProjectName} bids ${days < 0 ? `were due ${Math.abs(days)} day${Math.abs(days)!==1?'s':''} ago` : `due in ${days} day${days!==1?'s':''}`}`,
      view: 'bidding', projectId: proj.ProjectID
    });
  });

  // Cost codes that have gone over budget
  DATA.projects.forEach(proj=>{
    computeBudgetRows(proj.ProjectID).forEach(r=>{
      if(r.budget > 0 && r.committed > r.budget){
        alerts.push({
          severity: 'red',
          category: 'Budget',
          message: `${proj.ProjectName}: ${r.costCode?r.costCode.Code:'Unassigned'} — ${r.costCode?r.costCode.Description:''} is over budget by ${money(r.committed - r.budget)}`,
          view: 'budget', projectId: proj.ProjectID
        });
      }
    });
  });

  // Subcontracts, Change Orders, or Purchase Orders with no Cost Code set —
  // each of these silently disappears from Budget's numbers without one.
  // New records can no longer be saved without a Cost Code, but this catches
  // anything already in the system from before that rule existed.
  DATA.projects.forEach(proj=>{
    const missingSubs = DATA.subcontracts.filter(s=>s.ProjectID===proj.ProjectID && !s.CostCodeID).length;
    const missingCCOs = DATA.changeOrders.filter(c=>c.ProjectID===proj.ProjectID && !c.CostCodeID).length;
    const missingPOs = DATA.purchaseOrders.filter(p=>p.ProjectID===proj.ProjectID && !p.CostCodeID).length;
    const total = missingSubs + missingCCOs + missingPOs;
    if(total > 0){
      const parts = [];
      if(missingSubs) parts.push(`${missingSubs} subcontract${missingSubs!==1?'s':''}`);
      if(missingCCOs) parts.push(`${missingCCOs} change order${missingCCOs!==1?'s':''}`);
      if(missingPOs) parts.push(`${missingPOs} purchase order${missingPOs!==1?'s':''}`);
      alerts.push({
        severity: 'amber',
        category: 'Budget',
        message: `${proj.ProjectName}: ${parts.join(', ')} missing a Cost Code — won't show up in Budget until fixed`,
        view: 'subcontracts', projectId: proj.ProjectID
      });
    }
  });

  alerts.sort((a,b)=> (a.severity==='red'?0:1) - (b.severity==='red'?0:1));
  return alerts;
}

function renderAlertsPanel(){
  const alerts = computeAlerts();
  if(alerts.length === 0){
    return `
      <div class="panel" style="margin-bottom:20px;">
        <div style="padding:16px 18px;display:flex;align-items:center;gap:10px;">
          <span class="pill green"><span class="pill-dot"></span>All clear</span>
          <span style="font-size:12.5px;color:var(--graphite);">No insurance, invoice, PCO, bidding, or budget alerts right now.</span>
        </div>
      </div>`;
  }
  const rows = alerts.slice(0, 25).map(a=>`
    <div class="alert-row" data-alert-view="${a.view}" data-alert-project="${a.projectId||''}" data-alert-tab="${a.presetTab||''}" tabindex="0" role="button">
      <span class="pill ${a.severity}"><span class="pill-dot"></span>${esc(a.category)}</span>
      <span class="alert-message">${esc(a.message)}</span>
      <span class="alert-arrow">${ICONS.chevronRight}</span>
    </div>
  `).join('');
  const hasRed = alerts.some(a=>a.severity==='red');
  return `
    <div class="panel" style="margin-bottom:20px;">
      <div class="panel-head">
        <div class="panel-title">Needs Attention</div>
        <span class="pill ${hasRed?'red':'amber'}">${alerts.length}</span>
      </div>
      <div>${rows}</div>
    </div>
  `;
}

function renderBudget(){
  if(!state.budgetProject && DATA.projects.length){
    state.budgetProject = DATA.projects[0].ProjectID;
  }
  const projectId = state.budgetProject;
  if(!projectId){
    return `<div class="panel"><div class="empty-state"><h3>No projects yet</h3><p>Add a project first to track its budget.</p></div></div>`;
  }
  const rows = computeBudgetRows(projectId);

  const totalBudget = rows.reduce((s,r)=>s+r.budget,0);
  const totalCommitted = rows.reduce((s,r)=>s+r.committed,0);
  const totalInvoiced = rows.reduce((s,r)=>s+r.invoiced,0);
  const totalVariance = totalBudget - totalCommitted;

  const trs = rows.map(r=>{
    const pctUsed = r.budget > 0 ? Math.round((r.committed / r.budget) * 100) : null;
    const overBudget = r.budget > 0 && r.committed > r.budget;
    return `<tr>
      <td><span class="divchip">${r.costCode?esc(r.costCode.Code):'—'}</span></td>
      <td>${r.costCode?esc(r.costCode.Description):'Unassigned'}</td>
      <td class="num">${r.budget ? money(r.budget) : '<span style="color:var(--graphite);">—</span>'}</td>
      <td class="num">${money(r.committed)}</td>
      <td class="num">${money(r.invoiced)}</td>
      <td class="num" style="color:${overBudget?'var(--red)':'var(--ink)'};font-weight:${overBudget?'600':'400'};">${r.budget ? money(r.variance) : '—'}</td>
      <td>${pctUsed!==null ? `<span class="pill ${overBudget?'red':pctUsed>90?'amber':'green'}"><span class="pill-dot"></span>${pctUsed}%</span>` : '<span style="color:var(--graphite);">—</span>'}</td>
    </tr>`;
  }).join('');

  return `
    <div class="stat-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:20px;">
      <div class="stat-card"><div class="stat-label">Total Budget</div><div class="stat-value" style="font-size:20px;">${money(totalBudget)}</div></div>
      <div class="stat-card"><div class="stat-label">Committed</div><div class="stat-value" style="font-size:20px;">${money(totalCommitted)}</div></div>
      <div class="stat-card"><div class="stat-label">Invoiced</div><div class="stat-value" style="font-size:20px;">${money(totalInvoiced)}</div></div>
      <div class="stat-card"><div class="stat-label">Remaining</div><div class="stat-value" style="font-size:20px;color:${totalVariance<0?'var(--red)':'var(--ink)'};">${money(totalVariance)}</div></div>
    </div>
    <div class="panel">
      <div class="filter-row">
        <select id="budget-project-select" style="font-family:var(--font-body);font-size:12.5px;border:1px solid var(--hairline);border-radius:100px;padding:6px 12px;background:var(--panel);color:var(--ink-soft);">
          ${DATA.projects.map(p=>`<option value="${p.ProjectID}" ${projectId===p.ProjectID?'selected':''}>${esc(p.ProjectName)}</option>`).join('')}
        </select>
        <button class="btn secondary small" id="export-budget-csv" style="margin-left:auto;">${ICONS.plus} Export Report (CSV)</button>
      </div>
      ${rows.length===0 ? `<div class="empty-state"><h3>No budget or cost activity yet</h3><p>Set a budget amount per cost code, and assign cost codes to your subcontracts and change orders, to see committed and invoiced costs roll up here.</p></div>` : `
      <table>
        <thead><tr><th>Code</th><th>Cost Code</th><th class="num">Budget</th><th class="num">Committed</th><th class="num">Invoiced</th><th class="num">Variance</th><th>% Used</th></tr></thead>
        <tbody>${trs}</tbody>
      </table>`}
    </div>
  `;
}

/* ============ Settings ============ */
function renderSettings(){
  if(!state.settingsProject && DATA.projects.length){
    state.settingsProject = DATA.projects[0].ProjectID;
  }
  const projectId = state.settingsProject;
  const projectName = projectId && projectsById[projectId] ? projectsById[projectId].ProjectName : 'this project';

  const subtabs = [
    {id:'trades', label:'Divisions & Trades'},
    {id:'costCodes', label:'Cost Codes'},
    {id:'disciplines', label:'Disciplines'},
    {id:'areas', label:'Areas'},
    {id:'emailPrompts', label:'Email Prompts'},
    {id:'backups', label:'Backups'}
  ];

  return `
    <div class="panel">
      <div class="filter-row">
        <select id="settings-project-select" style="font-family:var(--font-body);font-size:12.5px;border:1px solid var(--hairline);border-radius:100px;padding:6px 12px;background:var(--panel);color:var(--ink-soft);">
          ${DATA.projects.map(p=>`<option value="${p.ProjectID}" ${state.settingsProject===p.ProjectID?'selected':''}>${esc(p.ProjectName)}</option>`).join('')}
        </select>
        ${subtabs.map(t=>`<div class="chip-btn ${state.settingsTab===t.id?'active':''}" data-settings-tab="${t.id}" tabindex="0" role="button">${t.label}</div>`).join('')}
      </div>
      ${renderSettingsTabBody(projectId, projectName)}
    </div>
  `;
}

function renderSettingsTabBody(projectId, projectName){
  switch(state.settingsTab){
    case 'costCodes': return renderCostCodesBody();
    case 'disciplines': return renderDisciplinesBody();
    case 'areas': return renderAreasBody(projectId, projectName);
    case 'emailPrompts': return renderEmailPromptsBody(projectId, projectName);
    case 'backups': return renderBackupsBody();
    default: return renderTradesSettingsBody(projectId, projectName);
  }
}

// Backups aren't part of the app's normal DATA (they're files on disk, not
// a CRUD collection), so this section fetches them on demand the first
// time the tab is opened, caches the result, and re-renders once it's back.
function renderBackupsBody(){
  if(state.backupsList === null){
    if(!state._backupsFetching){
      state._backupsFetching = true;
      fetch('/api/backups').then(r=>r.json()).then(list=>{
        state.backupsList = list;
        state._backupsFetching = false;
        if(state.view==='settings' && state.settingsTab==='backups') render();
      }).catch(()=>{ state._backupsFetching = false; });
    }
    return `<div style="padding:16px 18px;color:var(--graphite);font-size:13px;">Loading backups…</div>`;
  }
  const list = state.backupsList;
  const latest = list[0];
  const rows = list.map(b=>`
    <div class="settings-row">
      <span class="settings-row-name" style="font-family:var(--font-mono);font-size:12px;">${esc(b.name)}</span>
      <span style="font-size:11.5px;color:var(--graphite);margin-right:12px;">${(b.size/1024).toFixed(0)} KB</span>
      <span style="font-size:11.5px;color:var(--graphite);">${new Date(b.createdAt).toLocaleString()}</span>
    </div>`).join('');
  return `
    <div style="padding:16px 18px;">
      <p style="font-size:12.5px;color:var(--graphite);margin:0 0 6px;">Balsa backs up <code>balsa.db</code> automatically once a day, and keeps the last 30 days. ${latest ? `Last backup: <strong>${new Date(latest.createdAt).toLocaleString()}</strong>.` : 'No backups yet.'}</p>
      <p style="font-size:11.5px;color:var(--graphite);margin:0 0 14px;">Backup files live in this app's <code>data/backups</code> folder on the host computer — copying that folder to a USB drive or another machine now and then is the easiest extra layer of protection.</p>
      <div class="cta-btn-row" style="margin:0 0 16px;"><button class="btn small" id="run-backup-now-btn">${ICONS.plus} Back Up Now</button></div>
      ${rows || '<div style="color:var(--graphite);font-size:13px;">No backups yet.</div>'}
    </div>
  `;
}

function renderDisciplinesBody(){
  const rows = DATA.disciplines.slice().sort((a,b)=>(a.Code||'').localeCompare(b.Code||''));
  const rowsHtml = rows.map(d=>`
    <div class="settings-row">
      <span class="divchip">${esc(d.Code)}</span>
      <span class="settings-row-name">${esc(d.Name)}</span>
      <div class="row-actions" style="opacity:1;">
        <button class="btn secondary small" data-edit="discipline" data-id="${d.DisciplineID}">${ICONS.edit} Edit</button>
      </div>
    </div>`).join('');
  return `
    <div style="padding:16px 18px;">
      <p style="font-size:12.5px;color:var(--graphite);margin:0 0 14px;">Disciplines are shared across every project — used to organize Plan Revisions and Plan Sheets under Plans.</p>
      <div class="cta-btn-row" style="margin:0 0 16px;"><button class="btn small" data-add="discipline">${ICONS.plus} New Discipline</button></div>
      ${rowsHtml || '<div style="color:var(--graphite);font-size:13px;">No disciplines yet.</div>'}
    </div>
  `;
}

function renderCostCodesBody(){
  const byCostCode = {};
  DATA.subCostCodes.forEach(sc=>{ (byCostCode[sc.CostCodeID] = byCostCode[sc.CostCodeID]||[]).push(sc); });
  const groups = DATA.costCodes.slice().sort((a,b)=>(a.Code||'').localeCompare(b.Code||'')).map(cc=>{
    const subRows = (byCostCode[cc.CostCodeID]||[]).sort((a,b)=>(a.Code||'').localeCompare(b.Code||'')).map(sc=>`
      <div class="settings-row">
        <span class="divchip">${esc(sc.Code)}</span>
        <span class="settings-row-name">${esc(sc.Description)}</span>
        <div class="row-actions" style="opacity:1;">
          <button class="btn secondary small" data-edit="subCostCode" data-id="${sc.SubCostCodeID}">${ICONS.edit} Edit</button>
        </div>
      </div>`).join('');
    return `
      <div class="settings-division">
        <div class="settings-division-head">
          <span class="divchip">${esc(cc.Code)}</span>
          <strong style="font-family:var(--font-display);font-size:13.5px;">${esc(cc.Description)}</strong>
          <button class="btn secondary small" style="margin-left:auto;" data-edit="costCode" data-id="${cc.CostCodeID}">${ICONS.edit} Edit</button>
          <button class="btn secondary small" data-add="subCostCode" data-preset-costcode="${cc.CostCodeID}">${ICONS.plus} Add Sub Code</button>
        </div>
        <div class="settings-trades">${subRows || '<div style="padding:10px 0;color:var(--graphite);font-size:12.5px;">No sub cost codes yet.</div>'}</div>
      </div>`;
  }).join('');
  return `
    <div style="padding:16px 18px;">
      <p style="font-size:12.5px;color:var(--graphite);margin:0 0 14px;">Cost codes are shared across every project, same as Divisions and Trades. Each one can have sub cost codes underneath it.</p>
      <div class="cta-btn-row" style="margin:0 0 16px;"><button class="btn small" data-add="costCode">${ICONS.plus} New Cost Code</button></div>
      ${groups || '<div style="color:var(--graphite);font-size:13px;">No cost codes yet.</div>'}
    </div>
  `;
}

function renderAreasBody(projectId, projectName){
  if(!projectId) return `<div class="empty-state"><h3>No projects yet</h3><p>Add a project first to set up areas for it.</p></div>`;
  const rows = DATA.areas.filter(a=>a.ProjectID===projectId).sort((a,b)=>(a.Code||'').localeCompare(b.Code||''));
  const rowsHtml = rows.map(a=>`
    <div class="settings-row">
      <span class="divchip">${esc(a.Code)}</span>
      <span class="settings-row-name">${esc(a.Description)}</span>
      <div class="row-actions" style="opacity:1;">
        <button class="btn secondary small" data-edit="area" data-id="${a.AreaID}">${ICONS.edit} Edit</button>
      </div>
    </div>`).join('');
  return `
    <div style="padding:16px 18px;">
      <p style="font-size:12.5px;color:var(--graphite);margin:0 0 14px;">Areas/phases for <strong>${esc(projectName)}</strong> — e.g. "Building A," "Phase 1." Used to tag change orders and other records by where the work is.</p>
      <div class="cta-btn-row" style="margin:0 0 16px;"><button class="btn small" data-add="area" data-preset-project="${projectId}">${ICONS.plus} New Area</button></div>
      ${rowsHtml || '<div style="color:var(--graphite);font-size:13px;">No areas yet for this project.</div>'}
    </div>
  `;
}

function renderRfisBody(projectId, projectName){
  if(!projectId) return `<div class="empty-state"><h3>No projects yet</h3><p>Add a project first to log RFIs for it.</p></div>`;
  const rows = DATA.rfis.filter(r=>r.ProjectID===projectId).sort((a,b)=>(a.Code||'').localeCompare(b.Code||''));
  const rowsHtml = rows.map(r=>{
    const responseCount = DATA.rfiResponses.filter(rr=>rr.RFIID===r.RFIID).length;
    return `
    <div class="settings-row">
      <span class="divchip">${esc(r.Code)}</span>
      <span class="settings-row-name">${esc(r.Description)}</span>
      <span style="font-size:11.5px;color:var(--graphite);margin-right:8px;">${responseCount} response${responseCount!==1?'s':''}</span>
      <span class="pill ${r.Status==='Closed'?'green':r.Status==='Answered'?'amber':'gray'}" style="margin-right:8px;">${esc(r.Status||'Open')}</span>
      ${r.AttachmentURL ? `<a class="attachment-link" style="margin-right:8px;" href="${esc(r.AttachmentURL)}" ${attachmentLinkAttrs(r.AttachmentURL, r.AttachmentName)}>${ICONS.paperclip} ${esc(r.AttachmentName||'File')}</a>` : ''}
      <div class="row-actions" style="opacity:1;">
        <button class="btn secondary small" data-edit="rfi" data-id="${r.RFIID}">${ICONS.edit} Edit</button>
      </div>
    </div>`;
  }).join('');
  return `
    <div style="padding:16px 18px;">
      <p style="font-size:12.5px;color:var(--graphite);margin:0 0 14px;">RFIs for <strong>${esc(projectName)}</strong> — logged here so change orders can reference which RFI they came from.</p>
      <div class="cta-btn-row" style="margin:0 0 16px;"><button class="btn small" data-add="rfi" data-preset-project="${projectId}">${ICONS.plus} New RFI</button></div>
      ${rowsHtml || '<div style="color:var(--graphite);font-size:13px;">No RFIs yet for this project.</div>'}
    </div>
  `;
}

function renderRfiResponsesBody(projectId, projectName){
  if(!projectId) return `<div class="empty-state"><h3>No projects yet</h3><p>Add a project first to log RFI responses for it.</p></div>`;
  const rfiIds = new Set(DATA.rfis.filter(r=>r.ProjectID===projectId).map(r=>r.RFIID));
  const rows = DATA.rfiResponses.filter(rr=>rfiIds.has(rr.RFIID));
  const rowsHtml = rows.map(rr=>{
    const rfi = DATA.rfis.find(r=>r.RFIID===rr.RFIID);
    return `
    <div class="settings-division">
      <div class="settings-division-head">
        <span class="divchip">${rfi?esc(rfi.Code):'—'}</span>
        <strong style="font-family:var(--font-display);font-size:13px;">${rfi?esc(rfi.Description):'—'}</strong>
        ${rr.AttachmentURL ? `<a class="attachment-link" style="margin-left:8px;" href="${esc(rr.AttachmentURL)}" ${attachmentLinkAttrs(rr.AttachmentURL, rr.AttachmentName)}>${ICONS.paperclip} ${esc(rr.AttachmentName||'File')}</a>` : ''}
        <button class="btn secondary small" style="margin-left:auto;" data-edit="rfiResponse" data-id="${rr.RFIResponseID}">${ICONS.edit} Edit</button>
      </div>
      <div style="padding:12px 14px;font-size:12.5px;">
        <div style="margin-bottom:8px;"><strong style="color:var(--graphite);">Q:</strong> ${esc(rr.Question)}</div>
        ${rr.Response1 ? `<div style="margin-bottom:8px;"><strong style="color:var(--graphite);">R1:</strong> ${esc(rr.Response1)}</div>` : ''}
        ${rr.Response2 ? `<div><strong style="color:var(--graphite);">R2:</strong> ${esc(rr.Response2)}</div>` : ''}
      </div>
    </div>`;
  }).join('');
  return `
    <div style="padding:16px 18px;">
      <p style="font-size:12.5px;color:var(--graphite);margin:0 0 14px;">Track the back-and-forth on RFIs for <strong>${esc(projectName)}</strong> — the original question, first response, and a follow-up if a second round is needed.</p>
      <div class="cta-btn-row" style="margin:0 0 16px;"><button class="btn small" data-add="rfiResponse" data-preset-project="${projectId}">${ICONS.plus} New Response</button></div>
      ${rowsHtml || '<div style="color:var(--graphite);font-size:13px;">No RFI responses logged yet for this project.</div>'}
    </div>
  `;
}

function renderTradesSettingsBody(projectId, projectName){
  let tradesInScope = null;
  if(state.settingsScope === 'project' && projectId){
    const usedTradeIds = new Set(DATA.vendors.filter(v=>v.ProjectID===projectId).map(v=>v.TradeID));
    const filtered = DATA.trades.filter(t=>usedTradeIds.has(t.TradeID));
    if(filtered.length) tradesInScope = filtered;
  }
  if(!tradesInScope) tradesInScope = DATA.trades;

  const byDivision = {};
  tradesInScope.forEach(t=>{ (byDivision[t.DivisionID] = byDivision[t.DivisionID]||[]).push(t); });
  const divisionIds = Object.keys(byDivision).sort((a,b)=>Number(a)-Number(b));

  const emptyScopeNotice = (state.settingsScope==='project' && projectId && tradesInScope===DATA.trades)
    ? `<p style="font-size:12px;color:var(--amber);margin:0 0 14px;">No trades are tied to ${esc(projectName)} yet, so showing every trade instead.</p>` : '';

  const divisionGroups = divisionIds.map(divId=>{
    const div = DATA.divisions.find(d=>d.DivisionID===divId);
    const trades = byDivision[divId].slice().sort((a,b)=>a.TradeName.localeCompare(b.TradeName));
    const tradeRows = trades.map(t=>`
      <div class="settings-row">
        <span class="divchip">${divCode(divId)}</span>
        <span class="settings-row-name">${esc(t.TradeName)}</span>
        <div class="row-actions" style="opacity:1;">
          <button class="btn secondary small" data-edit="trade" data-id="${t.TradeID}">${ICONS.edit} Edit</button>
        </div>
      </div>`).join('');
    return `
      <div class="settings-division">
        <div class="settings-division-head">
          <strong style="font-family:var(--font-display);font-size:13.5px;">${div?esc(div.DivisionName):'—'}</strong>
          <span class="divchip">${divCode(divId)}</span>
          <button class="btn secondary small" style="margin-left:auto;" data-edit="division" data-id="${divId}">${ICONS.edit} Rename</button>
        </div>
        <div class="settings-trades">${tradeRows || '<div style="padding:10px 0;color:var(--graphite);font-size:12.5px;">No trades in this division yet.</div>'}</div>
      </div>`;
  }).join('');

  return `
    <div class="filter-row">
      <div class="chip-btn ${state.settingsScope==='project'?'active':''}" data-settings-scope="project" tabindex="0" role="button">This project's trades</div>
      <div class="chip-btn ${state.settingsScope==='all'?'active':''}" data-settings-scope="all" tabindex="0" role="button">All trades</div>
    </div>
    <div style="padding:16px 18px;">
      <p style="font-size:12.5px;color:var(--graphite);margin:0 0 14px;">Trades are shared across every project — adding one here also makes it available for ${esc(projectName)} and everywhere else. Renaming a division or trade updates it everywhere it's used.</p>
      ${emptyScopeNotice}
      ${divisionGroups || '<div style="color:var(--graphite);font-size:13px;">No divisions found.</div>'}
    </div>
  `;
}

function renderEmailPromptsBody(projectId, projectName){
  if(!projectId){
    return `<div class="empty-state"><h3>No projects yet</h3><p>Add a project first to set up email prompts for it.</p></div>`;
  }
  const project = projectsById[projectId];
  const projectVendors = DATA.vendors.filter(v=>v.ProjectID===projectId);
  const noResponse = projectVendors.filter(v=>vendorEligibility(v)==='no_response');
  const responded = projectVendors.filter(v=>vendorEligibility(v)==='responded');
  const ineligible = projectVendors.filter(v=>vendorEligibility(v)==='ineligible');

  const noResponsePrompt = promptForProject(projectId, 'no_response');
  const respondedPrompt = promptForProject(projectId, 'responded');

  return `
    <div style="padding:16px 18px;">
      <p style="font-size:12.5px;color:var(--graphite);margin:0 0 18px;">
        Set the default message used when emailing contractors on <strong>${esc(projectName)}</strong>, based on where they stand. Contractors who've declined or already submitted a proposal aren't emailed at all — ${ineligible.length} on this project fall into that group right now.
      </p>

      <div class="settings-division">
        <div class="settings-division-head">
          <strong style="font-family:var(--font-display);font-size:13.5px;">Not Yet Responded</strong>
          <span class="pill gray">${noResponse.length} contractor${noResponse.length!==1?'s':''}</span>
        </div>
        <div style="padding:14px;">
          <div class="field">
            <label>Subject</label>
            <input type="text" id="prompt-noresponse-subject" value="${esc(noResponsePrompt.subject)}"/>
          </div>
          <div class="field" style="margin-bottom:10px;">
            <label>Message</label>
            <textarea id="prompt-noresponse-body" style="min-height:120px;">${esc(noResponsePrompt.body)}</textarea>
          </div>
          <button class="btn small" data-save-prompt="no_response">Save Prompt</button>
        </div>
      </div>

      <div class="settings-division">
        <div class="settings-division-head">
          <strong style="font-family:var(--font-display);font-size:13.5px;">Responded, No Bid Yet</strong>
          <span class="pill amber">${responded.length} contractor${responded.length!==1?'s':''}</span>
        </div>
        <div style="padding:14px;">
          <div class="field">
            <label>Subject</label>
            <input type="text" id="prompt-responded-subject" value="${esc(respondedPrompt.subject)}"/>
          </div>
          <div class="field" style="margin-bottom:10px;">
            <label>Message</label>
            <textarea id="prompt-responded-body" style="min-height:120px;">${esc(respondedPrompt.body)}</textarea>
          </div>
          <button class="btn small" data-save-prompt="responded">Save Prompt</button>
        </div>
      </div>

      <p style="font-size:11.5px;color:var(--graphite);margin-top:4px;">${ineligible.length} contractor${ineligible.length!==1?'s':''} on this project ${ineligible.length===1?'has':'have'} declined or already submitted a bid and won't receive either message.</p>
    </div>
  `;
}

/* ============ Change Orders ============ */
function renderChangeOrders(projectId){
  const rows = DATA.changeOrders.filter(c=> projectId ? c.ProjectID===projectId : true);
  if(rows.length===0) return renderEmpty('changeorders');
  const trs = rows.map(c=>{
    const statusClass = /approved/i.test(c.Status) ? 'green' : /rejected/i.test(c.Status) ? 'red' : 'amber';
    const area = DATA.areas.find(a=>a.AreaID===c.AreaID);
    const rfi = DATA.rfis.find(r=>r.RFIID===c.RFIID);
    const costCode = DATA.costCodes.find(cc=>cc.CostCodeID===c.CostCodeID);
    const subCostCode = DATA.subCostCodes.find(sc=>sc.SubCostCodeID===c.SubCostCodeID);
    const costCodeLabel = subCostCode ? `${subCostCode.Code}` : (costCode ? costCode.Code : '—');
    const changeEvent = DATA.changeEvents.find(ce=>ce.ChangeEventID===c.ChangeEventID);
    return `<tr>
      <td style="font-family:var(--font-mono);font-size:12px;">${esc(c.ChangeOrderNumber)}</td>
      <td>${esc(c.Title)}</td>
      <td>${esc(c.ChangeType)}</td>
      <td class="num">${money(c.Amount)}</td>
      <td><span class="pill ${statusClass}"><span class="pill-dot"></span>${esc(c.Status)}</span></td>
      <td style="font-family:var(--font-mono);font-size:12px;">${changeEvent ? esc(changeEvent.EventNumber) : '—'}</td>
      <td style="font-family:var(--font-mono);font-size:12px;">${area ? esc(area.Code) : '—'}</td>
      <td style="font-family:var(--font-mono);font-size:12px;">${costCodeLabel}</td>
      <td style="font-family:var(--font-mono);font-size:12px;">${rfi ? esc(rfi.Code) : '—'}</td>
      <td>${dateOnly(c.RequestedDate)}</td>
      <td>${c.AttachmentURL ? `<a class="attachment-link" href="${esc(c.AttachmentURL)}" ${attachmentLinkAttrs(c.AttachmentURL, c.AttachmentName)}>${ICONS.paperclip} ${esc(c.AttachmentName||'File')}</a>` : ''}</td>
      <td><div class="row-actions"><button class="btn secondary small" data-edit="changeOrder" data-id="${c.ChangeOrderID}">${ICONS.edit}</button></div></td>
    </tr>`;
  }).join('');
  return `<table><thead><tr><th>CO #</th><th>Title</th><th>Type</th><th class="num">Amount</th><th>Status</th><th>Change Event</th><th>Area</th><th>Cost Code</th><th>RFI</th><th>Requested</th><th>Document</th><th></th></tr></thead><tbody>${trs}</tbody></table>`;
}

/* ============ Invoices ============ */
function renderInvoices(projectId){
  let rows = DATA.invoices;
  if(projectId){
    const subIds = new Set(DATA.subcontracts.filter(s=>s.ProjectID===projectId).map(s=>s.SubcontractID));
    rows = rows.filter(i=>subIds.has(i.SubcontractID));
  }
  if(rows.length===0) return renderEmpty('invoices');
  const trs = rows.map(i=>{
    const sub = DATA.subcontracts.find(s=>s.SubcontractID===i.SubcontractID);
    const statusClass = /paid/i.test(i.Status) ? 'green' : /approved/i.test(i.Status) ? 'amber' : 'gray';
    return `<tr>
      <td style="font-family:var(--font-mono);font-size:12px;">${esc(i.InvoiceNumber)}</td>
      <td>${sub?esc(sub.Contractor):'—'}</td>
      <td class="num">${money(i.AmountRequested)}</td>
      <td class="num">${money(i.AmountApproved)}</td>
      <td class="num">${money(i.AmountPaid)}</td>
      <td><span class="pill ${statusClass}"><span class="pill-dot"></span>${esc(i.Status)}</span></td>
      <td>${i.AttachmentURL ? `<a class="attachment-link" href="${esc(i.AttachmentURL)}" ${attachmentLinkAttrs(i.AttachmentURL, i.AttachmentName)}>${ICONS.paperclip} ${esc(i.AttachmentName||'File')}</a>` : ''}</td>
      <td><div class="row-actions"><button class="btn secondary small" data-edit="invoice" data-id="${i.InvoiceID}">${ICONS.edit}</button></div></td>
    </tr>`;
  }).join('');
  return `<table><thead><tr><th>Invoice #</th><th>Contractor</th><th class="num">Requested</th><th class="num">Approved</th><th class="num">Paid</th><th>Status</th><th>Document</th><th></th></tr></thead><tbody>${trs}</tbody></table>`;
}

/* ============ Empty states ============ */
function renderEmpty(kind){
  const copy = {
    changeorders: {glyph: ICONS.changeorders, title:'No change orders logged yet', body:'Once a change order is created against an active subcontract, it will show up here with its cost impact, status, and approval dates.', add:'changeOrder', label:'Log a Change Order'},
    invoices: {glyph: ICONS.invoices, title:'No invoices logged yet', body:'Draw requests will appear here once a subcontractor submits an invoice against an awarded contract.', add:'invoice', label:'Log an Invoice'},
    bidding: {glyph: ICONS.bidding, title:'No bids on file for this project', body:'Proposals will appear here as vendors respond, grouped by trade with the lowest bid flagged.', add:'bid', label:'Log a Proposal'},
    subcontracts: {glyph: ICONS.subcontracts, title:'No subcontracts awarded yet', body:'Awarded contracts will appear here with value, status, and compliance document tracking.', add:'subcontract', label:'New Subcontract'}
  }[kind];
  return `
    <div class="empty-state">
      <div class="glyph">${copy.glyph}</div>
      <h3>${copy.title}</h3>
      <p>${copy.body}</p>
      <div class="cta-btn-row"><button class="btn secondary small" data-add="${copy.add}">${ICONS.plus} ${copy.label}</button></div>
    </div>`;
}

/* ============ Events ============ */
function makeKeyActivatable(el){
  if(el._keyBound) return;
  el._keyBound = true;
  el.addEventListener('keydown', (e)=>{
    if(e.key==='Enter' || e.key===' '){ e.preventDefault(); el.click(); }
  });
}

function bindOnce(el, event, handler){
  if(!el || el[`_bound_${event}`]) return;
  el[`_bound_${event}`] = true;
  el.addEventListener(event, handler);
}

function bindAddEditButtons(){
  const pickExistingBtn = document.getElementById('pick-existing-vendor-btn');
  bindOnce(pickExistingBtn, 'click', ()=>{
    openExistingVendorPicker(state.vendorProject);
  });
  document.querySelectorAll('[data-add]').forEach(el=>{
    bindOnce(el, 'click', ()=>{
      const key = el.getAttribute('data-add');
      const presetProjectId = el.getAttribute('data-preset-project');
      const presetCostCodeId = el.getAttribute('data-preset-costcode');
      const presets = {};
      if(presetProjectId){ presets.ProjectID = presetProjectId; presets._ProjectFilter = presetProjectId; }
      if(presetCostCodeId){ presets.CostCodeID = presetCostCodeId; }
      openModal(key, null, presets);
    });
  });
  document.querySelectorAll('[data-edit]').forEach(el=>{
    bindOnce(el, 'click', ()=>{
      const key = el.getAttribute('data-edit');
      const id = el.getAttribute('data-id');
      const form = FORMS[key];
      const record = DATA[form.collection].find(r => String(r[form.idField]) === String(id));
      openModal(key, record);
    });
  });
  document.querySelectorAll('[data-award]').forEach(el=>{
    el.addEventListener('click', async ()=>{
      const id = el.getAttribute('data-award');
      el.disabled = true;
      try{
        await awardBid(id);
        await loadAll();
        toast('Bid awarded — subcontract created');
        state.view = 'subcontracts';
        render();
      }catch(err){ alert('Could not award bid: ' + err.message); el.disabled = false; }
    });
  });
  document.querySelectorAll('[data-approve-pco]').forEach(el=>{
    el.addEventListener('click', async ()=>{
      const id = el.getAttribute('data-approve-pco');
      el.disabled = true;
      try{
        await approvePCO(id);
        await loadAll();
        toast('PCO approved — PCCO created');
        state.primeTab = 'pccos';
        render();
      }catch(err){ alert('Could not approve PCO: ' + err.message); el.disabled = false; }
    });
  });
  document.querySelectorAll('[data-contact]').forEach(el=>{
    el.addEventListener('click', ()=>{
      const id = el.getAttribute('data-contact');
      openEmailComposer([id]);
    });
  });
  document.querySelectorAll('[data-toggle-flag]').forEach(el=>{
    el.addEventListener('click', async ()=>{
      const field = el.getAttribute('data-toggle-flag');
      const id = el.getAttribute('data-sub-id');
      const sub = DATA.subcontracts.find(s=>s.SubcontractID===id);
      if(!sub) return;
      const newVal = bool(sub[field]) ? '0' : '1';
      await apiPut('subcontracts', id, {[field]: newVal});
      await loadAll();
      render();
    });
  });
}

function bindEvents(){
  document.querySelectorAll('[role="button"]').forEach(makeKeyActivatable);
  document.querySelectorAll('[data-nav]').forEach(el=>{
    el.addEventListener('click', ()=>{
      state.view = el.getAttribute('data-nav');
      if(state.view !== 'project') state.currentProjectId = null;
      render();
    });
  });
  document.querySelectorAll('[data-project]').forEach(el=>{
    el.addEventListener('click', ()=>{
      state.currentProjectId = el.getAttribute('data-project');
      state.view = 'project';
      state.projectTab = 'bidding';
      render();
    });
  });
  document.querySelectorAll('[data-alert-view]').forEach(el=>{
    el.addEventListener('click', ()=>{
      const view = el.getAttribute('data-alert-view');
      const projectId = el.getAttribute('data-alert-project') || null;
      const tab = el.getAttribute('data-alert-tab') || null;
      if(view === 'primechanges'){
        state.primeProject = projectId;
        if(tab) state.primeTab = tab;
      } else if(view === 'budget'){
        state.budgetProject = projectId;
      } else if(view === 'bidding'){
        state.biddingProject = projectId;
      }
      state.view = view;
      render();
    });
  });
  document.querySelectorAll('[data-ptab]').forEach(el=>{
    el.addEventListener('click', ()=>{
      state.projectTab = el.getAttribute('data-ptab');
      render();
    });
  });
  document.querySelectorAll('[data-bidproject]').forEach(el=>{
    el.addEventListener('click', ()=>{
      const val = el.getAttribute('data-bidproject');
      state.biddingProject = val === '' ? null : val;
      render();
    });
  });
  bindAddEditButtons();
  bindContentFilterEvents();

  const searchInput = document.getElementById('vendor-search-input');
  if(searchInput){
    searchInput.addEventListener('input', ()=>{
      state.vendorSearch = searchInput.value;
      document.getElementById('content').innerHTML = renderVendors();
      bindContentFilterEvents();
    });
  }
}

function bindContentFilterEvents(){
  document.querySelectorAll('#content [role="button"]').forEach(makeKeyActivatable);
  const runBackupBtn = document.getElementById('run-backup-now-btn');
  if(runBackupBtn && !runBackupBtn._bound){
    runBackupBtn._bound = true;
    runBackupBtn.addEventListener('click', async ()=>{
      runBackupBtn.disabled = true;
      runBackupBtn.textContent = 'Backing up…';
      try{
        await fetch('/api/backups/run', {method:'POST'});
        state.backupsList = null; // force a refetch
        document.getElementById('content').innerHTML = renderSettings();
        bindContentFilterEvents();
        toast('Backup complete');
      }catch(err){
        alert('Backup failed: ' + err.message);
        runBackupBtn.disabled = false;
        runBackupBtn.innerHTML = `${ICONS.plus} Back Up Now`;
      }
    });
  }
  document.querySelectorAll('[data-vstatus]').forEach(el=>{
    el.addEventListener('click', ()=>{
      state.vendorStatus = el.getAttribute('data-vstatus') || null;
      document.getElementById('content').innerHTML = renderVendors();
      bindContentFilterEvents();
    });
  });
  const divSel = document.getElementById('division-select');
  if(divSel){
    divSel.addEventListener('change', ()=>{
      state.vendorDivision = divSel.value || null;
      document.getElementById('content').innerHTML = renderVendors();
      bindContentFilterEvents();
    });
  }
  const projSel = document.getElementById('project-select');
  if(projSel){
    projSel.addEventListener('change', ()=>{
      state.vendorProject = projSel.value || null;
      document.getElementById('content').innerHTML = renderVendors();
      bindContentFilterEvents();
    });
  }
  document.querySelectorAll('[data-vendor-cb]').forEach(el=>{
    el.addEventListener('change', ()=>{
      const id = el.getAttribute('data-vendor-cb');
      if(el.checked) state.selectedVendors.add(id);
      else state.selectedVendors.delete(id);
      document.getElementById('content').innerHTML = renderVendors();
      bindContentFilterEvents();
    });
  });
  const selectAll = document.getElementById('select-all-vendors');
  if(selectAll){
    selectAll.addEventListener('change', ()=>{
      document.querySelectorAll('[data-vendor-cb]:not([disabled])').forEach(cb=>{
        const id = cb.getAttribute('data-vendor-cb');
        if(selectAll.checked) state.selectedVendors.add(id);
        else state.selectedVendors.delete(id);
      });
      document.getElementById('content').innerHTML = renderVendors();
      bindContentFilterEvents();
    });
  }
  const emailBtn = document.getElementById('email-selected-btn');
  if(emailBtn){
    emailBtn.addEventListener('click', openBulkEmailModal);
  }
  const clearBtn = document.getElementById('clear-selection-btn');
  if(clearBtn){
    clearBtn.addEventListener('click', ()=>{
      state.selectedVendors = new Set();
      document.getElementById('content').innerHTML = renderVendors();
      bindContentFilterEvents();
    });
  }
  const settingsProjSel = document.getElementById('settings-project-select');
  if(settingsProjSel){
    settingsProjSel.addEventListener('change', ()=>{
      state.settingsProject = settingsProjSel.value || null;
      document.getElementById('content').innerHTML = renderSettings();
      bindContentFilterEvents();
    });
  }
  document.querySelectorAll('[data-settings-scope]').forEach(el=>{
    el.addEventListener('click', ()=>{
      state.settingsScope = el.getAttribute('data-settings-scope');
      document.getElementById('content').innerHTML = renderSettings();
      bindContentFilterEvents();
    });
  });
  document.querySelectorAll('[data-settings-tab]').forEach(el=>{
    el.addEventListener('click', ()=>{
      state.settingsTab = el.getAttribute('data-settings-tab');
      document.getElementById('content').innerHTML = renderSettings();
      bindContentFilterEvents();
    });
  });
  document.querySelectorAll('[data-save-prompt]').forEach(el=>{
    el.addEventListener('click', async ()=>{
      const which = el.getAttribute('data-save-prompt');
      const projectId = state.settingsProject;
      if(!projectId) return;
      const subjectEl = document.getElementById(which==='responded' ? 'prompt-responded-subject' : 'prompt-noresponse-subject');
      const bodyEl = document.getElementById(which==='responded' ? 'prompt-responded-body' : 'prompt-noresponse-body');
      const patch = which==='responded'
        ? { PromptRespondedSubject: subjectEl.value, PromptRespondedBody: bodyEl.value }
        : { PromptNoResponseSubject: subjectEl.value, PromptNoResponseBody: bodyEl.value };
      try{
        await apiPut('projects', projectId, patch);
        await loadAll();
        toast('Prompt saved');
        document.getElementById('content').innerHTML = renderSettings();
        bindContentFilterEvents();
      }catch(err){ alert('Could not save prompt: ' + err.message); }
    });
  });
  const plansProjSel = document.getElementById('plans-project-select');
  if(plansProjSel){
    plansProjSel.addEventListener('change', ()=>{
      state.plansProject = plansProjSel.value || null;
      render();
    });
  }
  document.querySelectorAll('[data-plans-tab]').forEach(el=>{
    el.addEventListener('click', ()=>{
      state.plansTab = el.getAttribute('data-plans-tab');
      render();
    });
  });
  const rfisProjSel = document.getElementById('rfis-project-select');
  if(rfisProjSel){
    rfisProjSel.addEventListener('change', ()=>{
      state.rfisProject = rfisProjSel.value || null;
      render();
    });
  }
  document.querySelectorAll('[data-rfis-tab]').forEach(el=>{
    el.addEventListener('click', ()=>{
      state.rfisTab = el.getAttribute('data-rfis-tab');
      render();
    });
  });
  const submittalsProjSel = document.getElementById('submittals-project-select');
  if(submittalsProjSel){
    submittalsProjSel.addEventListener('change', ()=>{
      state.submittalsProject = submittalsProjSel.value || null;
      render();
    });
  }
  document.querySelectorAll('[data-submittals-tab]').forEach(el=>{
    el.addEventListener('click', ()=>{
      state.submittalsTab = el.getAttribute('data-submittals-tab');
      render();
    });
  });
  const dailyReportsProjSel = document.getElementById('dailyreports-project-select');
  if(dailyReportsProjSel){
    dailyReportsProjSel.addEventListener('change', ()=>{
      state.dailyReportsProject = dailyReportsProjSel.value || null;
      render();
    });
  }
  document.querySelectorAll('[data-subcontracts-tab]').forEach(el=>{
    el.addEventListener('click', ()=>{
      state.subcontractsTab = el.getAttribute('data-subcontracts-tab');
      render();
    });
  });
  const primeProjSel = document.getElementById('prime-project-select');
  if(primeProjSel){
    primeProjSel.addEventListener('change', ()=>{
      state.primeProject = primeProjSel.value || null;
      render();
    });
  }
  document.querySelectorAll('[data-prime-tab]').forEach(el=>{
    el.addEventListener('click', ()=>{
      state.primeTab = el.getAttribute('data-prime-tab');
      render();
    });
  });
  const budgetProjSel = document.getElementById('budget-project-select');
  if(budgetProjSel){
    budgetProjSel.addEventListener('change', ()=>{
      state.budgetProject = budgetProjSel.value || null;
      render();
    });
  }
  const exportBudgetBtn = document.getElementById('export-budget-csv');
  if(exportBudgetBtn){
    exportBudgetBtn.addEventListener('click', ()=>{
      const projectId = state.budgetProject;
      const project = projectsById[projectId];
      const rows = computeBudgetRows(projectId);
      const header = ['Cost Code','Description','Budget','Committed','Invoiced','Variance','% Used'];
      const lines = [header.join(',')];
      rows.forEach(r=>{
        const pct = r.budget > 0 ? Math.round((r.committed / r.budget) * 100) + '%' : '';
        const line = [
          r.costCode ? r.costCode.Code : 'Unassigned',
          `"${(r.costCode ? r.costCode.Description : 'Unassigned').replace(/"/g,'""')}"`,
          r.budget || 0,
          r.committed || 0,
          r.invoiced || 0,
          r.variance || 0,
          pct
        ];
        lines.push(line.join(','));
      });
      const csv = lines.join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const safeName = (project ? project.ProjectName : 'project').replace(/[^a-z0-9]+/gi, '-');
      a.href = url;
      a.download = `budget-report-${safeName}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('Budget report exported');
    });
  }
  bindAddEditButtons();
}

/* ============ Init ============ */
/* ============ Workflow helpers (formerly server-side) ============ */

async function awardBid(bidId){
  const bid = DATA.bids.find(b => String(b.BidID) === String(bidId));
  if(!bid) throw new Error('Bid not found');
  const vendor = DATA.vendors.find(v => v.VendorID === bid.VendorID);
  const trade = DATA.trades.find(t => t.TradeID === bid.TradeID);
  const contractNumber = 'S' + String(DATA.subcontracts.length + 1).padStart(3, '0');
  return apiPost('subcontracts', {
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
}

async function approvePCO(pcoId){
  const pco = DATA.pcos.find(p => String(p.PCOID) === String(pcoId));
  if(!pco) throw new Error('PCO not found');
  const pccoNumber = 'PCCO-' + String(DATA.pccos.length + 1).padStart(3, '0');
  await apiPut('pcos', pco.PCOID, { Status: 'Approved' });
  return apiPost('pccos', {
    ProjectID: pco.ProjectID,
    PCOID: pco.PCOID,
    PCCONumber: pccoNumber,
    Amount: pco.ProposedAmount,
    Status: 'Pending Signature',
    ExecutedDate: new Date().toISOString().slice(0, 10)
  });
}


async function init(){
  document.getElementById('app').innerHTML = `<div style="padding:60px;font-family:var(--font-body);color:var(--graphite);">Loading Balsa Construction Ops…</div>`;
  await loadAll();
  render();
}
init();

/* ============ Bulk email selected vendors ============ */
function openBulkEmailModal(){
  openEmailComposer([...state.selectedVendors]);
}

/* ============ Copy vendors from other projects ============ */
function distinctVendorProfiles(excludeProjectId){
  const alreadyInTarget = new Set(
    DATA.vendors.filter(v => v.ProjectID === excludeProjectId).map(v => `${v.Contractor}|||${v.TradeID}`)
  );
  const seen = new Map();
  DATA.vendors.forEach(v=>{
    const key = `${v.Contractor}|||${v.TradeID}`;
    if(alreadyInTarget.has(key)) return;
    if(!seen.has(key)) seen.set(key, v);
  });
  return [...seen.values()];
}

function openExistingVendorPicker(defaultProjectId){
  if(DATA.projects.length === 0){ alert('Add a project first.'); return; }
  let targetProjectId = defaultProjectId || DATA.projects[0].ProjectID;
  let search = '';
  const selected = new Set(); // keys: Contractor|||TradeID

  const root = document.getElementById('modal-root');

  function profileKey(v){ return `${v.Contractor}|||${v.TradeID}`; }

  function renderList(){
    let profiles = distinctVendorProfiles(targetProjectId);
    if(search){
      const q = search.toLowerCase();
      profiles = profiles.filter(v => (v.Contractor||'').toLowerCase().includes(q) || (v.TradeName||'').toLowerCase().includes(q));
    }
    profiles.sort((a,b)=> a.Contractor.localeCompare(b.Contractor));
    if(profiles.length === 0){
      return `<div style="padding:24px;text-align:center;color:var(--graphite);font-size:13px;">No other vendors found to add${search?' matching your search':''}.</div>`;
    }
    return profiles.map(v=>{
      const key = profileKey(v);
      const checked = selected.has(key);
      return `
        <label class="settings-row" style="cursor:pointer;">
          <input type="checkbox" class="picker-cb" data-picker-key="${esc(key)}" ${checked?'checked':''}/>
          <span class="divchip">${divCode(v.DivisionID)}</span>
          <span class="settings-row-name">${esc(v.Contractor)} <span style="color:var(--graphite);font-weight:400;">— ${esc(v.TradeName)}</span></span>
        </label>`;
    }).join('');
  }

  function renderModal(){
    const profiles = distinctVendorProfiles(targetProjectId);
    root.innerHTML = `
      <div class="modal-overlay" id="modal-overlay">
        <div class="modal" style="max-width:560px;">
          <div class="modal-head">
            <h2>Add Existing Vendor</h2>
            <button class="modal-close" id="modal-close" aria-label="Close">&times;</button>
          </div>
          <div class="modal-body">
            <div class="field">
              <label>Add to Project</label>
              <select id="picker-project-select">
                ${DATA.projects.map(p=>`<option value="${p.ProjectID}" ${targetProjectId===p.ProjectID?'selected':''}>${esc(p.ProjectName)}</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label>Search</label>
              <input type="text" id="picker-search" placeholder="Search by contractor or trade" value="${esc(search)}"/>
            </div>
            <div id="picker-list" style="max-height:320px;overflow-y:auto;border:1px solid var(--hairline);border-radius:8px;padding:0 12px;">
              ${renderList()}
            </div>
          </div>
          <div class="modal-foot">
            <div style="font-size:11.5px;color:var(--graphite);">Copies contractor details as a fresh invite — proposal status resets for the new project</div>
            <div style="display:flex;gap:8px;">
              <button class="btn secondary small" id="modal-cancel">Cancel</button>
              <button class="btn small" id="picker-add-btn" ${selected.size?'':'disabled'}>${ICONS.plus} Add ${selected.size||''} Vendor${selected.size!==1?'s':''}</button>
            </div>
          </div>
        </div>
      </div>`;

    const close = () => { root.innerHTML = ''; };
    document.getElementById('modal-close').onclick = close;
    document.getElementById('modal-cancel').onclick = close;
    document.getElementById('modal-overlay').addEventListener('click', (e)=>{ if(e.target.id==='modal-overlay') close(); });

    document.getElementById('picker-project-select').addEventListener('change', (e)=>{
      targetProjectId = e.target.value;
      selected.clear();
      renderModal();
    });
    document.getElementById('picker-search').addEventListener('input', (e)=>{
      search = e.target.value;
      document.getElementById('picker-list').innerHTML = renderList();
      bindCheckboxes();
      updateAddButton();
    });

    function bindCheckboxes(){
      document.querySelectorAll('.picker-cb').forEach(cb=>{
        cb.addEventListener('change', ()=>{
          const key = cb.getAttribute('data-picker-key');
          if(cb.checked) selected.add(key); else selected.delete(key);
          updateAddButton();
        });
      });
    }
    function updateAddButton(){
      const btn = document.getElementById('picker-add-btn');
      btn.disabled = selected.size === 0;
      btn.innerHTML = `${ICONS.plus} Add ${selected.size||''} Vendor${selected.size!==1?'s':''}`;
    }
    bindCheckboxes();

    document.getElementById('picker-add-btn').onclick = async () => {
      const toAdd = profiles.filter(v => selected.has(profileKey(v)));
      try{
        for(const v of toAdd){
          await apiPost('vendors', {
            ProjectID: targetProjectId,
            TradeID: v.TradeID,
            DivisionID: v.DivisionID,
            TradeName: v.TradeName,
            Contractor: v.Contractor,
            Contact: v.Contact,
            Phone: v.Phone,
            Email: v.Email,
            BidResponse: 'NO RESPONSE',
            ProposalStatus: 'NOT RECEIVED',
            ProposalPrice: '',
            Active: '1',
            Awarded: '0'
          });
        }
        await loadAll();
        close();
        toast(`Added ${toAdd.length} vendor${toAdd.length!==1?'s':''} to ${projectsById[targetProjectId].ProjectName}`);
        state.vendorProject = targetProjectId;
        render();
      }catch(err){ alert('Could not add vendors: ' + err.message); }
    };
  }

  renderModal();
}

function openEmailComposer(vendorIds){
  const selected = DATA.vendors.filter(v => vendorIds.includes(v.VendorID));
  if(selected.length === 0) return;

  const ineligible = selected.filter(v => vendorEligibility(v) === 'ineligible');
  const vendors = selected.filter(v => vendorEligibility(v) !== 'ineligible');
  const withEmail = vendors.filter(v => v.Email);
  const withoutEmail = vendors.filter(v => !v.Email);

  const projectIds = [...new Set(vendors.map(v=>v.ProjectID))];
  const eligs = [...new Set(vendors.map(v=>vendorEligibility(v)))];
  const uniform = projectIds.length === 1 && eligs.length === 1;

  let defaultSubject, defaultBody, mixedNotice = '';
  if(uniform && vendors.length){
    const prompt = promptForProject(projectIds[0], eligs[0]);
    defaultSubject = prompt.subject;
    defaultBody = prompt.body;
  } else {
    const projectNames = [...new Set(vendors.map(v => (projectsById[v.ProjectID]||{}).ProjectName).filter(Boolean))];
    const tradeNames = [...new Set(vendors.map(v => v.TradeName).filter(Boolean))];
    defaultSubject = tradeNames.length === 1 ? `Bid Invitation — ${tradeNames[0]}` : `Bid Invitation — ${projectNames[0] || 'Upcoming Project'}`;
    defaultBody = `Hello,\n\nWe'd like to invite you to bid on the following scope${tradeNames.length>1?'s':''}: ${tradeNames.join(', ')}${projectNames.length?`\nProject: ${projectNames.join(', ')}`:''}.\n\nPlease let us know if you're able to submit a proposal and by when we can expect it.\n\nThanks,\nBalsa Construction`;
    if(vendors.length>1 && (projectIds.length > 1 || eligs.length > 1)){
      mixedNotice = `<div style="font-size:11.5px;color:var(--amber);margin-top:4px;">Selected contractors span more than one project or response status, so the saved prompt templates from Settings don't apply cleanly here — using a generic message instead. Feel free to edit it below.</div>`;
    }
  }

  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-overlay" id="modal-overlay">
      <div class="modal" style="max-width:640px;">
        <div class="modal-head">
          <h2>Email ${vendors.length} Contractor${vendors.length!==1?'s':''}</h2>
          <button class="modal-close" id="modal-close" aria-label="Close">&times;</button>
        </div>
        <div class="modal-body">
          <div class="field">
            <label>Recipients (BCC — they won't see each other)</label>
            <div style="display:flex;flex-wrap:wrap;gap:6px;padding:8px 0;">
              ${withEmail.map(v=>`<span class="pill gray">${esc(v.Contractor)}</span>`).join('')}
            </div>
            ${withoutEmail.length ? `<div style="font-size:11.5px;color:var(--red);margin-top:4px;">${withoutEmail.length} selected contractor${withoutEmail.length!==1?'s have':' has'} no email on file and will be skipped: ${withoutEmail.map(v=>esc(v.Contractor)).join(', ')}</div>` : ''}
            ${ineligible.length ? `<div style="font-size:11.5px;color:var(--red);margin-top:4px;">${ineligible.length} selected contractor${ineligible.length!==1?'s have':' has'} already declined or submitted a bid and won't be emailed: ${ineligible.map(v=>esc(v.Contractor)).join(', ')}</div>` : ''}
            ${mixedNotice}
          </div>
          <form id="bulk-email-form">
            <div class="field">
              <label>Cc <span style="text-transform:none;font-weight:400;">(optional — comma-separated)</span></label>
              <input type="text" name="cc" placeholder="you@company.com, pm@company.com"/>
            </div>
            <div class="field">
              <label>Subject</label>
              <input type="text" name="subject" value="${esc(defaultSubject)}" required/>
            </div>
            <div class="field">
              <label>Message</label>
              <textarea name="body" style="min-height:160px;">${esc(defaultBody)}</textarea>
            </div>
          </form>
        </div>
        <div class="modal-foot">
          <div style="font-size:11.5px;color:var(--graphite);">Opens in your email client, addressed to yourself with everyone BCC'd</div>
          <div style="display:flex;gap:8px;">
            <button class="btn secondary small" id="modal-cancel">Cancel</button>
            <button class="btn small" id="bulk-send-btn" ${withEmail.length?'':'disabled'}>${ICONS.mail} Send</button>
          </div>
        </div>
      </div>
    </div>`;

  const close = () => { root.innerHTML = ''; };
  document.getElementById('modal-close').onclick = close;
  document.getElementById('modal-cancel').onclick = close;
  document.getElementById('modal-overlay').addEventListener('click', (e)=>{ if(e.target.id==='modal-overlay') close(); });

  document.getElementById('bulk-send-btn').onclick = async () => {
    const form = document.getElementById('bulk-email-form');
    if(!form.reportValidity()) return;
    const fd = new FormData(form);
    const cc = (fd.get('cc') || '').trim();
    const subject = fd.get('subject') || '';
    const body = fd.get('body') || '';
    const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);

    for(const v of withEmail){
      const existing = DATA.contactLog.find(c => String(c.VendorID) === String(v.VendorID));
      if(existing){
        await apiPut('contactLog', existing.EmailID, { DateTimeLastContacted: stamp, SelectedToEmail: '1' });
      } else {
        await apiPost('contactLog', {
          ProjectID: v.ProjectID, VendorID: v.VendorID, Contractor: v.Contractor,
          Contact: v.Contact, Email: v.Email, BidResponse: v.BidResponse,
          ProposalStatus: v.ProposalStatus, DateTimeLastContacted: stamp, SelectedToEmail: '1'
        });
      }
    }

    const bcc = withEmail.map(v => v.Email).join(',');
    let mailto = `mailto:?bcc=${encodeURIComponent(bcc)}`;
    if(cc) mailto += `&cc=${encodeURIComponent(cc)}`;
    mailto += `&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    await loadAll();
    state.selectedVendors = new Set();
    close();
    toast(`Emailing ${withEmail.length} contractor${withEmail.length!==1?'s':''}…`);
    render();
    window.location.href = mailto;
  };
}
