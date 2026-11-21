const { HttpError } = require('./errors');
const { logAction } = require('./database');

function text(value, label, maximum) {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, 'INVALID_ANNOUNCEMENT', `${label}不能为空`);
  const trimmed = value.trim();
  if (trimmed.length > maximum) throw new HttpError(400, 'INVALID_ANNOUNCEMENT', `${label}不能超过 ${maximum} 个字符`);
  return trimmed;
}

function priority(value) {
  const number = Number(value);
  if (value === '' || value === null || !Number.isSafeInteger(number) || number < 0 || number > 9999) {
    throw new HttpError(400, 'INVALID_ANNOUNCEMENT', '优先级必须是 0 至 9999 的整数');
  }
  return number;
}

function announcementId(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new HttpError(400, 'INVALID_ANNOUNCEMENT', '公告编号不正确');
  return number;
}

class AnnouncementService {
  constructor(db) {
    this.db = db;
  }

  list() {
    const rows = this.db.prepare('SELECT * FROM announcements ORDER BY priority DESC, id DESC').all();
    return {
      code: 0,
      announcements: rows.map((row) => ({
        id: row.id,
        title: row.title,
        content: row.content,
        priority: row.priority,
        enabled: row.enabled === 1,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    };
  }

  published() {
    return this.db.prepare('SELECT id,title,content,updated_at FROM announcements WHERE enabled = 1 ORDER BY priority DESC, id DESC').all()
      .map((row) => ({ id: row.id, title: row.title, content: row.content, updatedAt: new Date(row.updated_at).toISOString() }));
  }

  find(id) {
    const row = this.db.prepare('SELECT * FROM announcements WHERE id = ?').get(id);
    if (!row) throw new HttpError(404, 'ANNOUNCEMENT_NOT_FOUND', '公告不存在或已删除');
    return row;
  }

  create(body, context) {
    const title = text(body.title, '公告标题', 100);
    const content = text(body.content, '公告内容', 5000);
    const level = priority(body.priority);
    const now = Date.now();
    const id = this.db.transaction(() => {
      const result = this.db.prepare('INSERT INTO announcements (title,content,priority,enabled,created_at,updated_at) VALUES (?,?,?,1,?,?)')
        .run(title, content, level, now, now);
      logAction(this.db, { actor: context.username, action: '新增公告', target: title, detail: { id: Number(result.lastInsertRowid), priority: level }, ip: context.ip });
      return Number(result.lastInsertRowid);
    }).immediate();
    return { code: 0, msg: '公告已新增并开始下发', id };
  }

  setPriority(body, context) {
    const id = announcementId(body.id);
    const level = priority(body.priority);
    this.db.transaction(() => {
      const row = this.find(id);
      this.db.prepare('UPDATE announcements SET priority = ?, updated_at = ? WHERE id = ?').run(level, Date.now(), id);
      logAction(this.db, { actor: context.username, action: '设定公告优先级', target: row.title, detail: { id, previous: row.priority, next: level }, ip: context.ip });
    }).immediate();
    return { code: 0, msg: `公告优先级已设为 ${level}` };
  }

  setStatus(body, context) {
    const id = announcementId(body.id);
    if (typeof body.enabled !== 'boolean') throw new HttpError(400, 'INVALID_ANNOUNCEMENT', '公告状态不正确');
    this.db.transaction(() => {
      const row = this.find(id);
      this.db.prepare('UPDATE announcements SET enabled = ?, updated_at = ? WHERE id = ?').run(body.enabled ? 1 : 0, Date.now(), id);
      logAction(this.db, { actor: context.username, action: body.enabled ? '恢复公告下发' : '停止公告下发', target: row.title, detail: { id }, ip: context.ip });
    }).immediate();
    return { code: 0, msg: body.enabled ? '公告已恢复下发' : '公告已停止下发' };
  }

  remove(body, context) {
    const id = announcementId(body.id);
    this.db.transaction(() => {
      const row = this.find(id);
      this.db.prepare('DELETE FROM announcements WHERE id = ?').run(id);
      logAction(this.db, { actor: context.username, action: '删除公告', target: row.title, detail: { id }, ip: context.ip });
    }).immediate();
    return { code: 0, msg: '公告已删除' };
  }
}

module.exports = { AnnouncementService };
