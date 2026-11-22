const http = require('node:http');
const fs = require('node:fs/promises');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { openDatabase, logAction } = require('./database');
const { CardService } = require('./card-service');
const { ClientService } = require('./client-service');
const { SettingsService } = require('./settings-service');
const { CryptoService } = require('./crypto-service');
const { AnnouncementService } = require('./announcement-service');
const { clientVersion } = require('./client-version');
const { HttpError } = require('./errors');

const rootDir = __dirname;
const configPath = path.resolve(rootDir, process.env.AUTH_CONFIG_PATH || 'config.json');
const config = JSON.parse(readFileSync(configPath, 'utf8'));
if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('配置必须是 JSON 对象');
if (process.env.AUTH_LISTEN_HOST !== undefined) config.listenHost = process.env.AUTH_LISTEN_HOST;
if (process.env.PORT !== undefined) config.listenPort = Number(process.env.PORT);
if (typeof config.listenHost !== 'string' || !config.listenHost.trim()) throw new Error('配置项 listenHost 无效');
config.listenHost = config.listenHost.trim();
for (const [key, minimum, maximum] of [['listenPort', 1, 65535], ['sessionHours', 1, 8760], ['heartbeatIntervalSeconds', 1, 3600], ['heartbeatTimeoutSeconds', 2, 86400], ['maxRequestBytes', 1024, 1048576]]) {
  if (!Number.isSafeInteger(config[key]) || config[key] < minimum || config[key] > maximum) throw new Error(`配置项 ${key} 无效`);
}
for (const key of ['bindDevice', 'encryptionRequired']) {
  if (typeof config[key] !== 'boolean') throw new Error(`配置项 ${key} 无效`);
}
if (config.heartbeatIntervalSeconds >= config.heartbeatTimeoutSeconds) throw new Error('心跳间隔必须小于心跳超时时间');
const secureCookies = process.env.AUTH_SECURE_COOKIES ?? '0';
if (secureCookies !== '0' && secureCookies !== '1') throw new Error('AUTH_SECURE_COOKIES 必须为 0 或 1');
const publicDir = path.join(rootDir, 'public');
const db = openDatabase(config, rootDir);
const cards = new CardService(db);
const clients = new ClientService(db, config);
const settings = new SettingsService(db, config);
const clientCrypto = new CryptoService(db, rootDir);
const announcements = new AnnouncementService(db);
const cookieName = 'auth_admin_session';
const tokenHash = (token) => crypto.createHash('sha256').update(token).digest('hex');
const staticFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
]);

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

function sendJson(res, status, data, extraHeaders = {}) {
  res.writeHead(status, {
    ...securityHeaders,
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    ...extraHeaders,
  });
  res.end(JSON.stringify(data));
}

function sendClientJson(res, status, data, encryptionContext) {
  sendJson(res, status, encryptionContext ? clientCrypto.encryptResponse(data, encryptionContext) : data);
}

function adminCookie(token = '', maxAge = 0) {
  return `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secureCookies === '1' ? '; Secure' : ''}`;
}

function parseCookies(req) {
  const cookies = {};
  for (const item of (req.headers.cookie || '').split(';')) {
    const separator = item.indexOf('=');
    if (separator > 0) cookies[item.slice(0, separator).trim()] = item.slice(separator + 1).trim();
  }
  return cookies;
}

function getAdmin(req) {
  const token = parseCookies(req)[cookieName];
  if (!token) throw new HttpError(401, 'ADMIN_SESSION_REQUIRED', '请先登录');
  const session = db.prepare('SELECT username,expires_at FROM admin_sessions WHERE token_hash = ?').get(tokenHash(token));
  if (!session || session.expires_at <= Date.now()) {
    db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(tokenHash(token));
    throw new HttpError(401, 'ADMIN_SESSION_EXPIRED', '登录已失效，请重新登录');
  }
  return session;
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > config.maxRequestBytes) throw new HttpError(413, 'BODY_TOO_LARGE', '请求内容过大');
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error();
    return body;
  } catch {
    throw new HttpError(400, 'INVALID_JSON', '请求内容必须是 JSON 对象');
  }
}

function adminLogin(body, ip) {
  if (typeof body.username !== 'string' || typeof body.password !== 'string' || !body.username.trim() || !body.password) {
    throw new HttpError(400, 'CREDENTIALS_REQUIRED', '请输入用户名和密码');
  }
  const username = body.username.trim();
  const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
  const salt = admin ? Buffer.from(admin.password_salt, 'hex') : Buffer.alloc(16);
  const expected = admin ? Buffer.from(admin.password_hash, 'hex') : Buffer.alloc(64);
  const actual = crypto.scryptSync(body.password, salt, 64);
  if (!admin || !crypto.timingSafeEqual(actual, expected)) {
    logAction(db, { actor: username, action: '管理员登录失败', ip });
    throw new HttpError(401, 'INVALID_CREDENTIALS', '用户名或密码错误');
  }
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + config.sessionHours * 3600000;
  db.transaction(() => {
    db.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?').run(Date.now());
    db.prepare('INSERT INTO admin_sessions (token_hash,username,expires_at) VALUES (?,?,?)').run(tokenHash(token), username, expiresAt);
    logAction(db, { actor: username, action: '管理员登录成功', ip });
  }).immediate();
  return { token, result: { code: 0, msg: '登录成功', username, expiresAt } };
}

function adminLogout(req, ip) {
  const token = parseCookies(req)[cookieName];
  if (token) {
    const session = db.prepare('SELECT username FROM admin_sessions WHERE token_hash = ?').get(tokenHash(token));
    db.transaction(() => {
      db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(tokenHash(token));
      if (session) logAction(db, { actor: session.username, action: '管理员退出', ip });
    }).immediate();
  }
}

async function serveStatic(req, res, pathname) {
  const file = staticFiles.get(pathname);
  if (!file) throw new HttpError(404, 'NOT_FOUND', '页面不存在');
  const content = await fs.readFile(path.join(publicDir, file[0]));
  res.writeHead(200, { ...securityHeaders, 'Cache-Control': 'no-store', 'Content-Type': file[1] });
  res.end(req.method === 'HEAD' ? undefined : content);
}

const server = http.createServer(async (req, res) => {
  let encryptionContext;
  try {
    const url = new URL(req.url, 'http://localhost');
    const route = `${req.method} ${url.pathname}`;
    const ip = req.socket.remoteAddress || '';
    if ((req.method === 'GET' || req.method === 'HEAD') && staticFiles.has(url.pathname)) {
      await serveStatic(req, res, url.pathname);
      return;
    }
    if (route === 'POST /api/login') {
      const { token, result } = adminLogin(await readJson(req), ip);
      const maxAge = config.sessionHours * 3600;
      sendJson(res, 200, result, { 'Set-Cookie': adminCookie(token, maxAge) });
      return;
    }
    if (route === 'POST /api/logout') {
      adminLogout(req, ip);
      sendJson(res, 200, { code: 0, msg: '已退出登录' }, { 'Set-Cookie': adminCookie() });
      return;
    }
    if (route === 'GET /api/crypto/public-key') {
      clientVersion(url.searchParams.get('clientVersion'));
      sendJson(res, 200, clientCrypto.publicKeyInfo);
      return;
    }
    if (route.startsWith('POST /api/client/')) {
      let body = await readJson(req);
      if (body.encrypted === true) {
        const decrypted = clientCrypto.decryptRequest(body);
        body = decrypted.body;
        encryptionContext = decrypted.context;
      } else if (config.encryptionRequired) {
        throw new HttpError(426, 'ENCRYPTION_REQUIRED', '系统已开启客户端强制加密，请使用加密请求');
      }
      body.clientVersion = clientVersion(body.clientVersion);
      if (route === 'POST /api/client/login') sendClientJson(res, 200, clients.login(body, { ip }), encryptionContext);
      else if (route === 'POST /api/client/heartbeat') sendClientJson(res, 200, clients.heartbeat(req, body), encryptionContext);
      else if (route === 'POST /api/client/verify') sendClientJson(res, 200, clients.verify(req, body), encryptionContext);
      else if (route === 'POST /api/client/logout') sendClientJson(res, 200, clients.logout(req, body, { ip }), encryptionContext);
      else if (route === 'POST /api/client/announcements') {
        const list = announcements.published();
        if (encryptionContext) sendClientJson(res, 200, { code: 0, msg: '获取成功', announcements: list }, encryptionContext);
        else sendJson(res, 200, clientCrypto.signPublic(body.nonce, { announcements: list }));
      }
      else throw new HttpError(404, 'NOT_FOUND', '接口不存在');
      return;
    }
    const admin = getAdmin(req);
    const context = { username: admin.username, ip };
    if (route === 'GET /api/session') {
      sendJson(res, 200, { code: 0, username: admin.username, expiresAt: admin.expires_at });
      return;
    }
    if (route === 'GET /api/cards') {
      sendJson(res, 200, cards.list(Object.fromEntries(url.searchParams), config));
      return;
    }
    if (route === 'GET /api/logs') {
      sendJson(res, 200, cards.logs(Object.fromEntries(url.searchParams)));
      return;
    }
    if (route === 'GET /api/stats') {
      sendJson(res, 200, cards.stats(config));
      return;
    }
    if (route === 'GET /api/announcements') {
      sendJson(res, 200, announcements.list());
      return;
    }
    if (route === 'GET /api/settings') {
      sendJson(res, 200, settings.result());
      return;
    }
    if (route === 'POST /api/admin/account') {
      const result = settings.updateAccount(await readJson(req), context);
      sendJson(res, 200, result, { 'Set-Cookie': adminCookie() });
      return;
    }
    const handlers = {
      'POST /api/cards/generate': (body) => cards.generate(body, context),
      'POST /api/cards/import': (body) => cards.importCards(body, context),
      'POST /api/cards/adjust': (body) => cards.adjust(body, context),
      'POST /api/cards/ban': (body) => cards.ban(body, context),
      'POST /api/cards/delete': (body) => cards.remove(body, context),
      'POST /api/cards/unbind': (body) => cards.unbind(body, context),
      'POST /api/cards/concurrency': (body) => cards.concurrency(body, context),
      'POST /api/settings': (body) => settings.update(body, context),
      'POST /api/settings/version': (body) => settings.updateVersion(body, context),
      'POST /api/announcements/create': (body) => announcements.create(body, context),
      'POST /api/announcements/priority': (body) => announcements.setPriority(body, context),
      'POST /api/announcements/status': (body) => announcements.setStatus(body, context),
      'POST /api/announcements/delete': (body) => announcements.remove(body, context),
    };
    if (!handlers[route]) throw new HttpError(404, 'NOT_FOUND', '接口不存在');
    sendJson(res, 200, handlers[route](await readJson(req)));
  } catch (error) {
    const status = error.status || 500;
    if (status === 500) log(`请求处理失败：${req.method}：${error.stack}`);
    const result = { code: error.code || 'INTERNAL_ERROR', msg: status === 500 ? '服务器内部错误' : error.message };
    encryptionContext = encryptionContext || error.encryptionContext;
    if (!res.headersSent) sendClientJson(res, status, result, encryptionContext);
    else res.end();
  }
});

server.listen(config.listenPort, config.listenHost, () => {
  const host = config.listenHost.includes(':') ? `[${config.listenHost}]` : config.listenHost;
  log(`极简网络验证服务已启动：http://${host}:${config.listenPort}`);
  log(`心跳间隔 ${config.heartbeatIntervalSeconds} 秒，超时 ${config.heartbeatTimeoutSeconds} 秒`);
});

const cleanup = setInterval(() => {
  const now = Date.now();
  db.prepare('DELETE FROM client_sessions WHERE last_heartbeat_at <= ?').run(now - config.heartbeatTimeoutSeconds * 1000);
  db.prepare('DELETE FROM request_nonces WHERE expires_at <= ?').run(now);
}, 15000);
cleanup.unref();

function shutdown() {
  clearInterval(cleanup);
  server.close(() => {
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
