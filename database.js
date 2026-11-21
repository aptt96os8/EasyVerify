const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');

function readInitialAdmin() {
  const username = (process.env.ADMIN_USERNAME ?? 'admin').trim();
  if (!username || username.length > 32) throw new Error('ADMIN_USERNAME 必须为 1 至 32 个字符');
  const password = process.env.ADMIN_PASSWORD;
  if (!password || password.trim().length < 8 || password.length > 128) {
    throw new Error('首次创建管理员必须设置 ADMIN_PASSWORD（去除首尾空白后至少 8 个字符，总长度不超过 128 个字符）');
  }
  return { username, password };
}

function openDatabase(config, rootDir) {
  const configuredPath = process.env.AUTH_DB_PATH || config.databasePath;
  if (typeof configuredPath !== 'string' || !configuredPath.trim()) throw new Error('配置项 databasePath 无效');
  const databasePath = path.resolve(rootDir, configuredPath);
  const initialAdmin = fs.existsSync(databasePath) ? undefined : readInitialAdmin();
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new Database(databasePath);
  try {
    db.pragma('busy_timeout = 5000');
    db.pragma('foreign_keys = ON');
    db.transaction(() => initializeDatabase(db, config, initialAdmin)).immediate();
    db.pragma('journal_mode = WAL');
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function initializeDatabase(db, config, initialAdmin) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      username TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cards (
      serial TEXT PRIMARY KEY,
      duration_seconds INTEGER NOT NULL CHECK(duration_seconds >= 0),
      max_concurrent INTEGER NOT NULL CHECK(max_concurrent BETWEEN 1 AND 100),
      banned INTEGER NOT NULL DEFAULT 0 CHECK(banned IN (0, 1)),
      created_at INTEGER NOT NULL,
      activated_at INTEGER,
      expires_at INTEGER,
      banned_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS client_sessions (
      token_hash TEXT PRIMARY KEY,
      serial TEXT NOT NULL REFERENCES cards(serial) ON DELETE CASCADE,
      device_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_heartbeat_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_client_sessions_serial ON client_sessions(serial);
    CREATE INDEX IF NOT EXISTS idx_client_sessions_heartbeat ON client_sessions(last_heartbeat_at);
    CREATE TABLE IF NOT EXISTS operation_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at INTEGER NOT NULL,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      target TEXT NOT NULL DEFAULT '',
      detail TEXT NOT NULL DEFAULT '',
      ip TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_operation_logs_created ON operation_logs(created_at DESC);
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS request_nonces (
      nonce_hash TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_request_nonces_expiry ON request_nonces(expires_at);
    CREATE TABLE IF NOT EXISTS announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 0 CHECK(priority BETWEEN 0 AND 9999),
      enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_announcements_order ON announcements(enabled, priority DESC, id DESC);
  `);
  const cardColumns = db.prepare('PRAGMA table_info(cards)').all().map((column) => column.name);
  if (!cardColumns.includes('bound_device_id')) db.exec('ALTER TABLE cards ADD bound_device_id TEXT');
  const setDefault = db.prepare('INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)');
  for (const key of ['bindDevice', 'encryptionRequired', 'heartbeatIntervalSeconds', 'heartbeatTimeoutSeconds']) {
    setDefault.run(key, String(config[key]));
  }
  if (!db.prepare('SELECT 1 FROM admins LIMIT 1').get()) {
    const { username, password } = initialAdmin ?? readInitialAdmin();
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(password, salt, 64);
    db.prepare('INSERT INTO admins (username,password_hash,password_salt,created_at) VALUES (?,?,?,?)')
      .run(username, hash.toString('hex'), salt.toString('hex'), Date.now());
  }
}

function logAction(db, { actor, action, target = '', detail = '', ip = '' }) {
  db.prepare('INSERT INTO operation_logs (created_at,actor,action,target,detail,ip) VALUES (?,?,?,?,?,?)')
    .run(Date.now(), actor, action, target, typeof detail === 'string' ? detail : JSON.stringify(detail), ip);
}

module.exports = { openDatabase, logAction };
