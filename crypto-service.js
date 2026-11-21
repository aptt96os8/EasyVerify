const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { HttpError } = require('./errors');

const protocolVersion = 1;
const cipherAlgorithm = 'chacha20-poly1305';
const maxRequestAgeMs = 300000;
const maxFutureSkewMs = 30000;

function decodeBase64(value, label, expectedLength) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new HttpError(400, 'INVALID_ENVELOPE', `${label}格式不正确`);
  }
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length !== expectedLength || decoded.toString('base64') !== value) {
    throw new HttpError(400, 'INVALID_ENVELOPE', `${label}格式不正确`);
  }
  return decoded;
}

function requestAad(envelope) {
  return Buffer.from(JSON.stringify({
    v: envelope.v,
    clientPublicKey: envelope.clientPublicKey,
    timestamp: envelope.timestamp,
    nonce: envelope.nonce,
  }));
}

function responsePayload(payload) {
  return Buffer.from(JSON.stringify({
    v: payload.v,
    requestNonce: payload.requestNonce,
    timestamp: payload.timestamp,
    nonce: payload.nonce,
    iv: payload.iv,
    ciphertext: payload.ciphertext,
    authTag: payload.authTag,
  }));
}

function deriveKey(secret, publicKey, info) {
  return Buffer.from(crypto.hkdfSync('sha256', secret, publicKey, info, 32));
}

class CryptoService {
  constructor(db, rootDir) {
    this.db = db;
    const keyDir = path.resolve(rootDir, process.env.AUTH_KEY_DIR || 'keys');
    fs.mkdirSync(keyDir, { recursive: true, mode: 0o700 });
    this.ed25519PrivateKey = this.loadKeyPair(keyDir, 'ed25519');
    this.x25519PrivateKey = this.loadKeyPair(keyDir, 'x25519');
    this.publicKeyInfo = {
      code: 0,
      version: protocolVersion,
      keyExchange: 'X25519',
      keyDerivation: 'HKDF-SHA256',
      encryption: 'ChaCha20-Poly1305',
      signature: 'Ed25519',
      x25519PublicKey: crypto.createPublicKey(this.x25519PrivateKey).export({ format: 'der', type: 'spki' }).toString('base64'),
      ed25519PublicKey: crypto.createPublicKey(this.ed25519PrivateKey).export({ format: 'der', type: 'spki' }).toString('base64'),
      timestampUnit: 'unix-milliseconds',
      maxRequestAgeSeconds: maxRequestAgeMs / 1000,
      maxFutureSkewSeconds: maxFutureSkewMs / 1000,
    };
  }

  loadKeyPair(keyDir, algorithm) {
    const privatePath = path.join(keyDir, `${algorithm}-private.pem`);
    if (fs.existsSync(privatePath)) {
      return crypto.createPrivateKey(fs.readFileSync(privatePath));
    }
    const { privateKey } = crypto.generateKeyPairSync(algorithm);
    fs.writeFileSync(privatePath, privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600, flag: 'wx' });
    return privateKey;
  }

  decryptRequest(envelope) {
    if (envelope.v !== protocolVersion || !Number.isSafeInteger(envelope.timestamp)) {
      throw new HttpError(400, 'INVALID_ENVELOPE', '加密请求版本或时间戳不正确');
    }
    const now = Date.now();
    if (envelope.timestamp < now - maxRequestAgeMs || envelope.timestamp > now + maxFutureSkewMs) {
      throw new HttpError(400, 'TIMESTAMP_EXPIRED', '请求时间戳已过期，请同步客户端时间');
    }
    const publicDer = decodeBase64(envelope.clientPublicKey, '客户端公钥', 44);
    decodeBase64(envelope.nonce, '请求随机数', 16);
    const iv = decodeBase64(envelope.iv, '初始化向量', 12);
    const authTag = decodeBase64(envelope.authTag, '认证标签', 16);
    if (typeof envelope.ciphertext !== 'string' || envelope.ciphertext.length > 131072) {
      throw new HttpError(400, 'INVALID_ENVELOPE', '密文格式不正确');
    }
    const ciphertext = Buffer.from(envelope.ciphertext, 'base64');
    let clientPublicKey;
    try {
      clientPublicKey = crypto.createPublicKey({ key: publicDer, format: 'der', type: 'spki' });
      if (clientPublicKey.asymmetricKeyType !== 'x25519') throw new Error();
    } catch {
      throw new HttpError(400, 'INVALID_ENVELOPE', '客户端公钥必须是 X25519 公钥');
    }
    const secret = crypto.diffieHellman({ privateKey: this.x25519PrivateKey, publicKey: clientPublicKey });
    const context = { secret, clientPublicKey: envelope.clientPublicKey, requestNonce: envelope.nonce };
    let body;
    try {
      const decipher = crypto.createDecipheriv(cipherAlgorithm, deriveKey(secret, publicDer, 'light-card-auth/request/v1'), iv, { authTagLength: 16 });
      decipher.setAAD(requestAad(envelope));
      decipher.setAuthTag(authTag);
      body = JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'));
      if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error();
    } catch {
      throw new HttpError(400, 'DECRYPTION_FAILED', '请求解密失败或内容已损坏');
    }
    const nonceHash = crypto.createHash('sha256').update(envelope.nonce).digest('hex');
    try {
      this.db.prepare('INSERT INTO request_nonces (nonce_hash,expires_at) VALUES (?,?)').run(nonceHash, envelope.timestamp + maxRequestAgeMs);
    } catch (error) {
      if (error.code && error.code.startsWith('SQLITE_CONSTRAINT')) {
        const replay = new HttpError(409, 'REPLAY_DETECTED', '检测到重复请求，请使用新的随机数');
        replay.encryptionContext = context;
        throw replay;
      }
      throw error;
    }
    return { body, context };
  }

  encryptResponse(result, context) {
    const timestamp = Date.now();
    const nonce = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const publicKey = Buffer.from(context.clientPublicKey, 'base64');
    const cipher = crypto.createCipheriv(cipherAlgorithm, deriveKey(context.secret, publicKey, 'light-card-auth/response/v1'), iv, { authTagLength: 16 });
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(result), 'utf8'), cipher.final()]);
    const payload = {
      encrypted: true,
      v: protocolVersion,
      requestNonce: context.requestNonce,
      timestamp,
      nonce: nonce.toString('base64'),
      iv: iv.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
    };
    payload.signature = crypto.sign(null, responsePayload(payload), this.ed25519PrivateKey).toString('base64');
    return payload;
  }

  signPublic(requestNonce, data) {
    if (typeof requestNonce !== 'string' || !/^[A-Za-z0-9+/=_-]{16,128}$/.test(requestNonce)) {
      throw new HttpError(400, 'NONCE_REQUIRED', '请提供 16 至 128 个字符的随机 nonce');
    }
    const payload = JSON.stringify({ requestNonce, timestamp: Date.now(), ...data });
    return {
      code: 0,
      msg: '获取成功',
      payload,
      signature: crypto.sign(null, Buffer.from(payload, 'utf8'), this.ed25519PrivateKey).toString('base64'),
    };
  }
}

module.exports = { CryptoService };
