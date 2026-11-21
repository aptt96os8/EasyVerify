const crypto = require('node:crypto');
const { HttpError } = require('./errors');
const { logAction } = require('./database');

const units = { minutes: 60, hours: 3600, days: 86400 };
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function integer(value, label, min = 1, max = 1000000) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new HttpError(400, 'INVALID_NUMBER', `${label}必须是 ${min} 至 ${max} 的整数`);
  }
  return number;
}

function serials(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw new HttpError(400, 'INVALID_SERIALS', '请选择 1 至 100 张卡密');
  }
  const result = [...new Set(value.map((item) => typeof item === 'string' ? item.trim().toUpperCase() : ''))];
  if (result.some((item) => !item || item.length > 64)) throw new HttpError(400, 'INVALID_SERIALS', '卡密格式不正确');
  return result;
}

function seconds(value, unit) {
  if (!Object.hasOwn(units, unit)) throw new HttpError(400, 'INVALID_UNIT', '时长单位只支持分钟、小时或天');
  const multiplier = units[unit];
  const duration = integer(value, '时长');
  if (duration * multiplier > Number.MAX_SAFE_INTEGER) throw new HttpError(400, 'INVALID_DURATION', '卡密时长超出范围');
  return duration * multiplier;
}

function newSerial() {
  const bytes = crypto.randomBytes(12);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

function formatCard(card, now) {
  return {
    serial: card.serial,
    durationSeconds: card.duration_seconds,
    maxConcurrent: card.max_concurrent,
    activeSessions: card.active_sessions,
    createdAt: new Date(card.created_at).toISOString(),
    activatedAt: card.activated_at === null ? null : new Date(card.activated_at).toISOString(),
    expiresAt: card.expires_at === null ? null : new Date(card.expires_at).toISOString(),
    bannedAt: card.banned_at === null ? null : new Date(card.banned_at).toISOString(),
    boundDeviceId: card.bound_device_id || '',
    status: card.banned ? 'banned' : card.expires_at !== null && card.expires_at <= now ? 'expired' : card.activated_at === null ? 'unused' : 'active',
  };
}

class CardService {
  constructor(db) {
    this.db = db;
    this.cardQuery = `SELECT c.*,(SELECT COUNT(*) FROM client_sessions cs
      WHERE cs.serial = c.serial AND cs.last_heartbeat_at > ?) AS active_sessions FROM cards c`;
  }

  list(query, config) {
    const start = query.start === undefined ? 0 : integer(query.start, '分页起点', 0, Number.MAX_SAFE_INTEGER);
    const end = query.end === undefined ? 20 : integer(query.end, '分页终点', 1, Number.MAX_SAFE_INTEGER);
    if (end <= start || end - start > 100) throw new HttpError(400, 'INVALID_PAGINATION', '分页范围不正确，每页最多 100 张');
    const now = Date.now();
    const cutoff = now - config.heartbeatTimeoutSeconds * 1000;
    const cards = this.db.prepare(`${this.cardQuery} ORDER BY c.created_at DESC,c.rowid DESC LIMIT ? OFFSET ?`)
      .all(cutoff, end - start, start).map((card) => formatCard(card, now));
    return { code: 0, cards, total: this.db.prepare('SELECT COUNT(*) AS count FROM cards').get().count, start, end };
  }

  generate(body, context) {
    const count = integer(body.count, '生成数量', 1, 1000);
    const durationSeconds = seconds(body.duration, body.durationUnit || 'days');
    const maxConcurrent = integer(body.maxConcurrent || 1, '同时在线数量', 1, 100);
    const now = Date.now();
    const insert = this.db.prepare('INSERT INTO cards (serial,duration_seconds,max_concurrent,created_at) VALUES (?,?,?,?)');
    const created = this.db.transaction(() => {
      const result = [];
      for (let index = 0; index < count; index++) {
        let serial;
        for (let attempt = 0; attempt < 5; attempt++) {
          serial = newSerial();
          try {
            insert.run(serial, durationSeconds, maxConcurrent, now);
            break;
          } catch (error) {
            if (error.code !== 'SQLITE_CONSTRAINT_PRIMARYKEY' || attempt === 4) throw error;
          }
        }
        result.push(serial);
      }
      logAction(this.db, { actor: context.username, action: '生成卡密', detail: { count, durationSeconds, maxConcurrent }, ip: context.ip });
      return result;
    }).immediate();
    return { code: 0, msg: `成功生成 ${count} 张卡密`, serials: created };
  }

  importCards(body, context) {
    if (!Array.isArray(body.serials) || body.serials.length < 1) throw new HttpError(400, 'INVALID_SERIALS', '没有可导入的卡密');
    const durationSeconds = seconds(body.duration, body.durationUnit || 'days');
    const maxConcurrent = integer(body.maxConcurrent || 1, '同时在线数量', 1, 100);
    const lines = [...new Set(body.serials.map((item) => typeof item === 'string' ? item.trim().toUpperCase() : '').filter(Boolean))];
    const accepted = lines.filter((serial) => serial.length <= 64);
    const tooLong = lines.length - accepted.length;
    const now = Date.now();
    const insert = this.db.prepare('INSERT OR IGNORE INTO cards (serial,duration_seconds,max_concurrent,created_at) VALUES (?,?,?,?)');
    const imported = this.db.transaction(() => {
      let count = 0;
      for (const serial of accepted) count += insert.run(serial, durationSeconds, maxConcurrent, now).changes;
      logAction(this.db, { actor: context.username, action: '导入卡密', detail: { imported: count, existing: accepted.length - count, tooLong, durationSeconds, maxConcurrent }, ip: context.ip });
      return count;
    }).immediate();
    return { code: 0, msg: `成功导入 ${imported} 张卡密`, imported, existing: accepted.length - imported, tooLong };
  }

  adjust(body, context) {
    const selected = serials(body.serials);
    const delta = seconds(body.amount, body.durationUnit || 'days') * (body.direction === 'add' ? 1 : body.direction === 'subtract' ? -1 : 0);
    if (delta === 0) throw new HttpError(400, 'INVALID_DIRECTION', '调整方向不正确');
    const select = this.db.prepare('SELECT serial,duration_seconds FROM cards WHERE serial = ?');
    const update = this.db.prepare(`UPDATE cards SET duration_seconds = ?,
      expires_at = CASE WHEN activated_at IS NULL THEN NULL ELSE activated_at + ? * 1000 END WHERE serial = ?`);
    const changes = this.db.transaction(() => {
      const result = [];
      for (const serial of selected) {
        const card = select.get(serial);
        if (!card) throw new HttpError(404, 'CARD_NOT_FOUND', `卡密不存在：${serial}`);
        const next = Math.max(0, card.duration_seconds + delta);
        if (!Number.isSafeInteger(next)) throw new HttpError(400, 'INVALID_DURATION', `卡密时长超出范围：${serial}`);
        update.run(next, next, serial);
        result.push({ serial, before: card.duration_seconds, after: next });
      }
      logAction(this.db, { actor: context.username, action: body.direction === 'add' ? '加时' : '减时', detail: { changes: result }, ip: context.ip });
      return result;
    }).immediate();
    return { code: 0, msg: `已调整 ${changes.length} 张卡密`, changes };
  }

  ban(body, context) {
    const selected = serials(body.serials);
    const select = this.db.prepare('SELECT 1 FROM cards WHERE serial = ?');
    const update = this.db.prepare('UPDATE cards SET banned = 1,banned_at = COALESCE(banned_at,?) WHERE serial = ?');
    this.db.transaction(() => {
      for (const serial of selected) {
        if (!select.get(serial)) throw new HttpError(404, 'CARD_NOT_FOUND', `卡密不存在：${serial}`);
      }
      const now = Date.now();
      for (const serial of selected) update.run(now, serial);
      logAction(this.db, { actor: context.username, action: '封禁卡密', detail: { serials: selected }, ip: context.ip });
    }).immediate();
    return { code: 0, msg: `已封禁 ${selected.length} 张卡密` };
  }

  remove(body, context) {
    const selected = serials(body.serials);
    const select = this.db.prepare('SELECT 1 FROM cards WHERE serial = ?');
    const remove = this.db.prepare('DELETE FROM cards WHERE serial = ?');
    this.db.transaction(() => {
      for (const serial of selected) {
        if (!select.get(serial)) throw new HttpError(404, 'CARD_NOT_FOUND', `卡密不存在：${serial}`);
      }
      for (const serial of selected) remove.run(serial);
      logAction(this.db, { actor: context.username, action: '删除卡密', detail: { serials: selected }, ip: context.ip });
    }).immediate();
    return { code: 0, msg: `已删除 ${selected.length} 张卡密` };
  }

  unbind(body, context) {
    const selected = serials(body.serials);
    const select = this.db.prepare('SELECT 1 FROM cards WHERE serial = ?');
    const update = this.db.prepare('UPDATE cards SET bound_device_id = NULL WHERE serial = ?');
    this.db.transaction(() => {
      for (const serial of selected) {
        if (!select.get(serial)) throw new HttpError(404, 'CARD_NOT_FOUND', `卡密不存在：${serial}`);
      }
      for (const serial of selected) update.run(serial);
      logAction(this.db, { actor: context.username, action: '解绑机器码', detail: { serials: selected }, ip: context.ip });
    }).immediate();
    return { code: 0, msg: `已解绑 ${selected.length} 张卡密的机器码` };
  }

  device(body, context) {
    if (typeof body.serial !== 'string') throw new HttpError(400, 'INVALID_SERIAL', '卡密格式不正确');
    if (typeof body.deviceId !== 'string' || body.deviceId.trim().length > 128) {
      throw new HttpError(400, 'INVALID_DEVICE', '机器码不能超过 128 个字符');
    }
    const serial = body.serial.trim().toUpperCase();
    const deviceId = body.deviceId.trim();
    this.db.transaction(() => {
      const previous = this.db.prepare('SELECT bound_device_id FROM cards WHERE serial = ?').get(serial);
      if (!previous) throw new HttpError(404, 'CARD_NOT_FOUND', '卡密不存在！');
      this.db.prepare('UPDATE cards SET bound_device_id = ? WHERE serial = ?').run(deviceId || null, serial);
      logAction(this.db, { actor: context.username, action: deviceId ? '修改机器码' : '清空机器码', target: serial, detail: { previous: previous.bound_device_id || '', next: deviceId }, ip: context.ip });
    }).immediate();
    return { code: 0, msg: deviceId ? '机器码已更新' : '机器码已清空' };
  }

  concurrency(body, context) {
    const selected = serials(body.serials);
    const maxConcurrent = integer(body.maxConcurrent, '同时在线数量', 1, 100);
    const select = this.db.prepare('SELECT 1 FROM cards WHERE serial = ?');
    const update = this.db.prepare('UPDATE cards SET max_concurrent = ? WHERE serial = ?');
    this.db.transaction(() => {
      for (const serial of selected) {
        if (!select.get(serial)) throw new HttpError(404, 'CARD_NOT_FOUND', `卡密不存在：${serial}`);
      }
      for (const serial of selected) update.run(maxConcurrent, serial);
      logAction(this.db, { actor: context.username, action: '设定同时在线数量', detail: { serials: selected, maxConcurrent }, ip: context.ip });
    }).immediate();
    return { code: 0, msg: `已将 ${selected.length} 张卡密的同时在线数量设为 ${maxConcurrent}` };
  }

  stats(config) {
    const now = Date.now();
    const cutoff = now - config.heartbeatTimeoutSeconds * 1000;
    const result = this.db.prepare(`SELECT
      (SELECT COUNT(*) FROM cards) AS total,
      (SELECT COUNT(*) FROM cards WHERE activated_at IS NOT NULL AND banned = 0 AND expires_at > ?) AS activated,
      (SELECT COUNT(DISTINCT cs.serial) FROM client_sessions cs JOIN cards c ON c.serial = cs.serial
        WHERE cs.last_heartbeat_at > ? AND c.banned = 0 AND c.expires_at > ?) AS online`).get(now, cutoff, now);
    return { code: 0, onlineCards: result.online, totalCards: result.total, activatedCards: result.activated };
  }

  logs(query) {
    const limit = query.limit === undefined ? 100 : integer(query.limit, '日志数量', 1, 200);
    const rows = this.db.prepare('SELECT * FROM operation_logs ORDER BY id DESC LIMIT ?').all(limit);
    return {
      code: 0,
      logs: rows.map((row) => ({ ...row, createdAt: new Date(row.created_at).toISOString() })),
    };
  }
}

module.exports = { CardService };
