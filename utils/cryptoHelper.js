const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

let privateKeyPem = '';
let publicKeyPem = '';

// Load or generate RSA keys
const keysDir = path.join(__dirname, '..', 'keys');
const privateKeyPath = path.join(keysDir, 'private.pem');
const publicKeyPath = path.join(keysDir, 'public.pem');

if (!fs.existsSync(keysDir)) {
  fs.mkdirSync(keysDir);
}

if (fs.existsSync(privateKeyPath) && fs.existsSync(publicKeyPath)) {
  privateKeyPem = fs.readFileSync(privateKeyPath, 'utf8');
  publicKeyPem = fs.readFileSync(publicKeyPath, 'utf8');
  console.log('[DexAuth] Loaded existing RSA keys.');
} else {
  console.log('[DexAuth] Generating new RSA 2048-bit keys...');
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem'
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem'
    }
  });
  privateKeyPem = privateKey;
  publicKeyPem = publicKey;
  fs.writeFileSync(privateKeyPath, privateKey);
  fs.writeFileSync(publicKeyPath, publicKey);
  console.log('[DexAuth] RSA keys generated successfully.');
  console.log('--- PUBLIC KEY FOR C# CLIENT ---');
  console.log(publicKeyPem);
  console.log('--------------------------------');
}

/**
 * Decrypts data using the Server's Private RSA Key (PKCS1 padding for compatibility with standard C# RSACryptoServiceProvider)
 */
function rsaDecrypt(encryptedBase64) {
  try {
    const buffer = Buffer.from(encryptedBase64, 'base64');
    const decrypted = crypto.privateDecrypt(
      {
        key: privateKeyPem,
        padding: crypto.constants.RSA_PKCS1_PADDING
      },
      buffer
    );
    return decrypted.toString('utf8');
  } catch (error) {
    console.error('RSA Decryption Error:', error.message);
    return null;
  }
}

/**
 * Encrypts data using AES-256-CBC
 */
function aesEncrypt(plainText, keyHex, ivHex) {
  try {
    const key = Buffer.from(keyHex, 'hex');
    const iv = Buffer.from(ivHex, 'hex');
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(plainText, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    return encrypted;
  } catch (error) {
    console.error('AES Encryption Error:', error.message);
    return null;
  }
}

/**
 * Decrypts data using AES-256-CBC
 */
function aesDecrypt(cipherTextBase64, keyHex, ivHex) {
  try {
    const key = Buffer.from(keyHex, 'hex');
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(cipherTextBase64, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    console.error('AES Decryption Error:', error.message);
    return null;
  }
}

/**
 * Computes SHA-256 HMAC signature of the encrypted payload
 */
function computeHmac(data, keyHex) {
  const key = Buffer.from(keyHex, 'hex');
  return crypto.createHmac('sha256', key).update(data).digest('hex');
}

module.exports = {
  publicKeyPem,
  rsaDecrypt,
  aesEncrypt,
  aesDecrypt,
  computeHmac
};
