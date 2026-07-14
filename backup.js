// Automated backups for balsa.db. Runs once immediately on startup (so
// there's always a recent backup even if the server gets restarted often),
// then again every 24 hours. Old backups beyond the retention window get
// pruned automatically so this doesn't quietly fill up the disk over time.
const fs = require('fs');
const path = require('path');
const db = require('./db');

const BACKUPS_DIR = path.join(__dirname, 'data', 'backups');
const RETENTION_DAYS = 30;
const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });

function timestampForFilename(date) {
  return date.toISOString().replace(/:/g, '-').replace(/\..+/, '');
}

function runBackup() {
  const now = new Date();
  const filename = `balsa-${timestampForFilename(now)}.db`;
  const destPath = path.join(BACKUPS_DIR, filename);
  db.backupTo(destPath);
  pruneOldBackups();
  const stats = fs.statSync(destPath);
  return { name: filename, size: stats.size, createdAt: now.toISOString() };
}

function pruneOldBackups() {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  for (const file of fs.readdirSync(BACKUPS_DIR)) {
    const fullPath = path.join(BACKUPS_DIR, file);
    const stats = fs.statSync(fullPath);
    if (stats.mtimeMs < cutoff) fs.unlinkSync(fullPath);
  }
}

function listBackups() {
  if (!fs.existsSync(BACKUPS_DIR)) return [];
  return fs.readdirSync(BACKUPS_DIR)
    .filter(f => f.endsWith('.db'))
    .map(f => {
      const stats = fs.statSync(path.join(BACKUPS_DIR, f));
      return { name: f, size: stats.size, createdAt: stats.mtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function startSchedule() {
  try {
    runBackup();
    console.log('Startup backup complete.');
  } catch (err) {
    console.error('Startup backup failed:', err.message);
  }
  setInterval(() => {
    try {
      runBackup();
      console.log('Scheduled backup complete.');
    } catch (err) {
      console.error('Scheduled backup failed:', err.message);
    }
  }, INTERVAL_MS);
}

module.exports = { runBackup, listBackups, startSchedule, BACKUPS_DIR };
