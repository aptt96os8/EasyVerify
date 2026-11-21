const crypto = require('node:crypto');
const { HttpError } = require('./errors');
const { logAction } = require('./database');
const { versionPattern } = require('./client-version');

const versionPolicies = ['minimum', 'exact'];

function integer(value, label, minimum, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new HttpError(400, 'INVALID_SETTING', `${label}必须是 ${minimum} 至 ${maximum} 的整数`);
  }
  return number;
}

function boolean(value, label) {
  if (typeof value !== 'boolean') throw new HttpError(400, 'INVALID_SETTING', `${label}必须是布尔值`);
  return value;
}

class SettingsService {
  constructor(db, config) {
    this.db = db;
    this.config = config;
    config.requiredClientVersion = '';
    config.versionPolicy = 'minimum';
    const rows = db.prepare('SELECT key,value FROM settings').all();
    for (const { key, value } of rows) {
      if (key === 'bindDevice' || key === 'encryptionRequired') config[key] = value === 'true';
      else if (key === 'heartbeatIntervalSeconds' || key === 'heartbeatTimeoutSeconds') config[key] = Number(value);
      else if (key === 'requiredClientVersion' && (value === '' || versionPattern.test(value))) config[key] = value;
      else if (key === 'versionPolicy' && versionPolicies.includes(value)) config[key] = value;
    }
  }

  systemSettings() {
    return {
      bindDevice: this.config.bindDevice,
      encryptionRequired: this.config.encryptionRequired,
      heartbeatIntervalSeconds: this.config.heartbeatIntervalSeconds,
      heartbeatTimeoutSeconds: this.config.heartbeatTimeoutSeconds,
    };
  }

  versionSettings() {
    return {
      requiredClientVersion: this.config.requiredClientVersion,
      versionPolicy: this.config.versionPolicy,
    };
  }

  result() {
    return { code: 0, ...this.systemSettings(), ...this.versionSettings() };
  }

  save(next, action, context) {
    const previous = action === '修改系统设置' ? this.systemSettings() : this.versionSettings();
    const update = this.db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    this.db.transaction(() => {
      for (const [key, value] of Object.entries(next)) update.run(key, String(value));
      Object.assign(this.config, next);
      logAction(this.db, { actor: context.username, action, detail: { previous, next }, ip: context.ip });
    }).immediate();
  }

  update(body, context) {
    const next = {
      bindDevice: boolean(body.bindDevice, '设备绑定'),
      encryptionRequired: boolean(body.encryptionRequired, '客户端强制加密'),
      heartbeatIntervalSeconds: integer(body.heartbeatIntervalSeconds, '心跳间隔', 1, 3600),
      heartbeatTimeoutSeconds: integer(body.heartbeatTimeoutSeconds, '心跳超时', 2, 86400),
    };
    if (next.heartbeatIntervalSeconds >= next.heartbeatTimeoutSeconds) {
      throw new HttpError(400, 'INVALID_HEARTBEAT', '心跳间隔必须小于心跳超时时间');
    }
    this.save(next, '修改系统设置', context);
    return { ...this.result(), msg: '系统设置已保存并立即生效' };
  }

  updateVersion(body, context) {
    if (typeof body.requiredClientVersion !== 'string') throw new HttpError(400, 'INVALID_SETTING', '版本号格式不正确');
    const requiredClientVersion = body.requiredClientVersion.trim();
    if (requiredClientVersion && !versionPattern.test(requiredClientVersion)) {
      throw new HttpError(400, 'INVALID_SETTING', '版本号格式不正确，应为 1.0.0 这样的数字版本号');
    }
    if (!versionPolicies.includes(body.versionPolicy)) throw new HttpError(400, 'INVALID_SETTING', '登录规则不正确');
    this.save({ requiredClientVersion, versionPolicy: body.versionPolicy }, '修改版本管理', context);
    return { ...this.result(), msg: '版本设置已保存并立即生效' };
  }

  updateAccount(body, context) {
    if (typeof body.currentPassword !== 'string' || !body.currentPassword || body.currentPassword.length > 128) {
      throw new HttpError(400, 'CURRENT_PASSWORD_REQUIRED', '请输入当前密码');
    }
    if (typeof body.newUsername !== 'string' || !body.newUsername.trim() || body.newUsername.trim().length > 32) {
      throw new HttpError(400, 'INVALID_USERNAME', '新登录名不能为空且不能超过 32 个字符');
    }
    if (typeof body.newPassword !== 'string' || body.newPassword.length < 8 || body.newPassword.length > 128) {
      throw new HttpError(400, 'INVALID_PASSWORD', '新密码长度必须为 8 至 128 个字符');
    }
    const admin = this.db.prepare('SELECT * FROM admins WHERE username = ?').get(context.username);
    if (!admin) throw new HttpError(401, 'ADMIN_SESSION_EXPIRED', '管理员不存在，请重新登录');
    const actual = crypto.scryptSync(body.currentPassword, Buffer.from(admin.password_salt, 'hex'), 64);
    const expected = Buffer.from(admin.password_hash, 'hex');
    if (!crypto.timingSafeEqual(actual, expected)) {
      logAction(this.db, { actor: context.username, action: '修改管理员账号失败', detail: '当前密码错误', ip: context.ip });
      throw new HttpError(403, 'INVALID_CURRENT_PASSWORD', '当前密码错误');
    }
    const newUsername = body.newUsername.trim();
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(body.newPassword, salt, 64);
    this.db.transaction(() => {
      const result = this.db.prepare('UPDATE admins SET username = ?,password_hash = ?,password_salt = ? WHERE username = ?')
        .run(newUsername, hash.toString('hex'), salt.toString('hex'), context.username);
      if (!result.changes) throw new HttpError(409, 'ADMIN_CHANGED', '管理员账号已被其他会话修改，请重新登录');
      this.db.prepare('DELETE FROM admin_sessions WHERE username = ?').run(context.username);
      logAction(this.db, { actor: context.username, action: '修改管理员账号', detail: { previousUsername: context.username, newUsername }, ip: context.ip });
    }).immediate();
    return { code: 0, msg: '管理员登录名和密码已更新，请使用新账号重新登录' };
  }
}

module.exports = { SettingsService };
