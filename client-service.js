const crypto = require('node:crypto');
const { HttpError } = require('./errors');
const { logAction } = require('./database');
const { compareVersions } = require('./client-version');

const tokenHash = (token) => crypto.createHash('sha256').update(token).digest('hex');

function readToken(req, body) {
  if (typeof body.token === 'string' && body.token.trim() && body.token.length <= 200) return body.token.trim();
  const authorization = req.headers.authorization || '';
  if (!authorization.startsWith('Bearer ') || authorization.length > 200) {
    throw new HttpError(401, 'TOKEN_REQUIRED', '请提供 Bearer Token，或在加密请求中提供 token 字段');
  }
  return authorization.slice(7).trim();
}

class ClientService {
  constructor(db, config) {
    this.db = db;
    this.config = config;
  }

  checkVersion(version) {
    const required = this.config.requiredClientVersion;
    if (!required) return;
    const order = compareVersions(version, required);
    if (this.config.versionPolicy === 'exact' && order !== 0) {
      throw new HttpError(403, 'CLIENT_VERSION_REJECTED', `客户端版本不符，请使用 ${required} 版本`);
    }
    if (this.config.versionPolicy !== 'exact' && order < 0) {
      throw new HttpError(403, 'CLIENT_VERSION_REJECTED', `客户端版本过低，请更新至 ${required} 或更高版本`);
    }
  }

  login(body, context) {
    if (typeof body.serial !== 'string' || !body.serial.trim() || body.serial.length > 64) {
      throw new HttpError(400, 'SERIAL_REQUIRED', '请输入卡密');
    }
    const bindDevice = this.config.bindDevice;
    if (bindDevice && body.deviceId !== undefined && (typeof body.deviceId !== 'string' || body.deviceId.length > 128)) {
      throw new HttpError(400, 'INVALID_DEVICE', '设备标识不能超过 128 个字符');
    }
    const serial = body.serial.trim().toUpperCase();
    const deviceId = bindDevice && typeof body.deviceId === 'string' ? body.deviceId.trim() : '';
    if (bindDevice && !deviceId) {
      throw new HttpError(400, 'DEVICE_REQUIRED', '系统已开启设备绑定，请提供设备标识');
    }
    const clientVersion = body.clientVersion;
    const now = Date.now();
    try {
      this.checkVersion(clientVersion);
      return this.db.transaction(() => {
        const card = this.db.prepare('SELECT * FROM cards WHERE serial = ?').get(serial);
        if (!card) throw new HttpError(404, 'CARD_NOT_FOUND', '卡密不存在！');
        if (card.banned) throw new HttpError(403, 'CARD_BANNED', '该卡密已被封禁！');
        if (card.expires_at !== null && card.expires_at <= now) throw new HttpError(403, 'CARD_EXPIRED', '卡密已过期！');
        if (bindDevice && card.bound_device_id && card.bound_device_id !== deviceId) {
          throw new HttpError(403, 'DEVICE_MISMATCH', '该卡密已绑定其他设备！');
        }
        const cutoff = now - this.config.heartbeatTimeoutSeconds * 1000;
        const active = this.db.prepare('SELECT COUNT(*) AS count FROM client_sessions WHERE serial = ? AND last_heartbeat_at > ?').get(serial, cutoff).count;
        if (active >= card.max_concurrent) throw new HttpError(429, 'CONCURRENCY_LIMIT', '该卡密已达到同时在线数量上限！');
        let expiresAt = card.expires_at;
        if (expiresAt === null) {
          expiresAt = now + card.duration_seconds * 1000;
          this.db.prepare('UPDATE cards SET activated_at = ?, expires_at = ? WHERE serial = ?').run(now, expiresAt, serial);
        }
        if (bindDevice && !card.bound_device_id) {
          this.db.prepare('UPDATE cards SET bound_device_id = ? WHERE serial = ?').run(deviceId, serial);
        }
        const token = crypto.randomBytes(32).toString('hex');
        this.db.prepare('INSERT INTO client_sessions (token_hash,serial,device_id,created_at,last_heartbeat_at) VALUES (?,?,?,?,?)')
          .run(tokenHash(token), serial, deviceId, now, now);
        logAction(this.db, { actor: '客户端', action: '登录成功', target: serial, detail: deviceId ? { deviceId, clientVersion } : { clientVersion }, ip: context.ip });
        return {
          code: 0, msg: '登录成功', serial, token, deviceId,
          expiresAt: new Date(expiresAt).toISOString(),
          activeSessions: active + 1,
          maxConcurrent: card.max_concurrent,
          heartbeatIntervalSeconds: this.config.heartbeatIntervalSeconds,
          heartbeatTimeoutSeconds: this.config.heartbeatTimeoutSeconds,
        };
      }).immediate();
    } catch (error) {
      logAction(this.db, { actor: '客户端', action: '登录失败', target: serial, detail: deviceId ? { deviceId, clientVersion, reason: error.message } : { clientVersion, reason: error.message }, ip: context.ip });
      throw error;
    }
  }

  getSession(req, body) {
    const hash = tokenHash(readToken(req, body));
    const session = this.db.prepare(`SELECT cs.*,c.max_concurrent,c.banned,c.expires_at
      FROM client_sessions cs JOIN cards c ON c.serial = cs.serial WHERE cs.token_hash = ?`).get(hash);
    if (!session) throw new HttpError(401, 'INVALID_TOKEN', '登录凭证无效，请重新登录');
    const now = Date.now();
    if (session.banned) throw new HttpError(403, 'CARD_BANNED', '该卡密已被封禁！');
    if (session.expires_at <= now) throw new HttpError(403, 'CARD_EXPIRED', '卡密已过期！');
    if (session.last_heartbeat_at <= now - this.config.heartbeatTimeoutSeconds * 1000) {
      throw new HttpError(401, 'HEARTBEAT_EXPIRED', '心跳已超时，请重新登录');
    }
    return { session, hash, now };
  }

  sessionResult(session, msg) {
    return {
      code: 0, msg, serial: session.serial, deviceId: session.device_id,
      expiresAt: new Date(session.expires_at).toISOString(),
      maxConcurrent: session.max_concurrent,
      heartbeatIntervalSeconds: this.config.heartbeatIntervalSeconds,
      heartbeatTimeoutSeconds: this.config.heartbeatTimeoutSeconds,
      serverTime: new Date().toISOString(),
    };
  }

  heartbeat(req, body) {
    const { session, hash, now } = this.getSession(req, body);
    this.db.prepare('UPDATE client_sessions SET last_heartbeat_at = ? WHERE token_hash = ?').run(now, hash);
    return this.sessionResult(session, '心跳正常');
  }

  verify(req, body) {
    const { session } = this.getSession(req, body);
    return this.sessionResult(session, '验证通过');
  }

  logout(req, body, context) {
    const hash = tokenHash(readToken(req, body));
    const session = this.db.prepare('SELECT serial,device_id FROM client_sessions WHERE token_hash = ?').get(hash);
    if (session) {
      this.db.transaction(() => {
        this.db.prepare('DELETE FROM client_sessions WHERE token_hash = ?').run(hash);
        logAction(this.db, { actor: '客户端', action: '退出登录', target: session.serial, detail: session.device_id ? { deviceId: session.device_id } : '', ip: context.ip });
      }).immediate();
    }
    return { code: 0, msg: '已退出登录' };
  }
}

module.exports = { ClientService };
