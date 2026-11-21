const { HttpError } = require('./errors');

const versionPattern = /^\d{1,9}(\.\d{1,9}){0,3}$/;

function clientVersion(value) {
  if (value === undefined || value === null || value === '') {
    throw new HttpError(400, 'CLIENT_VERSION_REQUIRED', '请求缺少客户端版本号 clientVersion');
  }
  if (typeof value !== 'string' || !versionPattern.test(value.trim())) {
    throw new HttpError(400, 'INVALID_CLIENT_VERSION', '客户端版本号格式不正确，应为 1.0.0 这样的数字版本号');
  }
  return value.trim();
}

function compareVersions(left, right) {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

module.exports = { versionPattern, clientVersion, compareVersions };
