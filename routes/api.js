const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const cryptoHelper = require('../utils/cryptoHelper');
const { License, User, Variable, File, Log } = require('../localDb');
const { sendWebhook } = require('../utils/webhook');

// In-memory active session store
// Keys: sessionId, Values: { aesKey, aesIv, usedNonces, lastActive, username }
const activeSessions = new Map();

// Session timeout: 2 hours
const SESSION_TIMEOUT = 2 * 60 * 60 * 1000;

// Cleanup expired sessions every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [sid, session] of activeSessions.entries()) {
    if (now - session.lastActive > SESSION_TIMEOUT) {
      activeSessions.delete(sid);
      console.log(`[DexAuth] Session ${sid} expired and removed.`);
    }
  }
}, 10 * 60 * 1000);

/**
 * Endpoint: /api/handshake
 * Establishes a secure session by exchanging the AES key encrypted with the server's RSA private key.
 */
router.post('/handshake', async (req, res) => {
  try {
    const { encryptedSessionData } = req.body;
    if (!encryptedSessionData) {
      return res.status(400).json({ error: 'Missing encryptedSessionData' });
    }

    // Decrypt using Server's RSA Private Key
    const decryptedJson = cryptoHelper.rsaDecrypt(encryptedSessionData);
    if (!decryptedJson) {
      return res.status(400).json({ error: 'Failed to decrypt session handshake' });
    }

    const payload = JSON.parse(decryptedJson);
    const { aesKey, aesIv, timestamp } = payload;

    if (!aesKey || !aesIv || !timestamp) {
      return res.status(400).json({ error: 'Invalid handshake payload structure' });
    }

    // Validate timestamp (prevent replay) - within 120 seconds
    const timeDiff = Math.abs(Math.floor(Date.now() / 1000) - timestamp);
    if (timeDiff > 120) {
      return res.status(400).json({ error: 'Handshake timestamp expired' });
    }

    // Generate Session ID
    const sessionId = uuidv4();
    activeSessions.set(sessionId, {
      aesKey,
      aesIv,
      usedNonces: new Set(),
      lastActive: Date.now(),
      username: null
    });

    // Encrypt response confirmation using client's AES session key
    const responsePayload = JSON.stringify({
      status: 'success',
      message: 'Session established',
      timestamp: Math.floor(Date.now() / 1000),
      sessionId
    });

    const encryptedData = cryptoHelper.aesEncrypt(responsePayload, aesKey, aesIv);
    const signature = cryptoHelper.computeHmac(encryptedData, aesKey);

    return res.json({
      sessionId,
      data: encryptedData,
      signature
    });
  } catch (error) {
    console.error('Handshake Error:', error);
    return res.status(500).json({ error: 'Internal server error during handshake' });
  }
});

/**
 * Middleware: Decrypt, authenticate, and validate payload
 */
async function secureApiMiddleware(req, res, next) {
  const sessionId = req.headers['x-session-id'];
  const clientSignature = req.headers['x-signature'];

  if (!sessionId || !clientSignature) {
    return res.status(401).json({ error: 'Missing security headers' });
  }

  const session = activeSessions.get(sessionId);
  if (!session) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }

  // Update last active
  session.lastActive = Date.now();

  const { data } = req.body;
  if (!data) {
    return res.status(400).json({ error: 'Missing encrypted data payload' });
  }

  // Verify HMAC Signature to check for integrity/tampering
  const expectedSignature = cryptoHelper.computeHmac(data, session.aesKey);
  if (clientSignature !== expectedSignature) {
    return res.status(403).json({ error: 'Signature verification failed (tampering detected)' });
  }

  // Decrypt payload using AES
  const decryptedText = cryptoHelper.aesDecrypt(data, session.aesKey, session.aesIv);
  if (!decryptedText) {
    return res.status(400).json({ error: 'Decryption failed' });
  }

  let payload;
  try {
    payload = JSON.parse(decryptedText);
  } catch (e) {
    return res.status(400).json({ error: 'Decrypted data is not valid JSON' });
  }

  const { action, timestamp, nonce, params } = payload;
  if (!action || !timestamp || !nonce) {
    return res.status(400).json({ error: 'Missing action, timestamp, or nonce in decrypted body' });
  }

  // Validate Replay Attack: Timestamp within 120s window
  const timeDiff = Math.abs(Math.floor(Date.now() / 1000) - timestamp);
  if (timeDiff > 120) {
    return res.status(400).json({ error: 'Request timestamp expired' });
  }

  // Validate Nonce Reuse
  if (session.usedNonces.has(nonce)) {
    return res.status(400).json({ error: 'Replay attack detected: nonce already used' });
  }
  session.usedNonces.add(nonce);

  // Attach variables to request object
  req.sessionData = session;
  req.decryptedAction = action;
  req.decryptedParams = params || {};
  req.clientNonce = nonce;

  next();
}

/**
 * Unified API Request Router (POST /api/request)
 * Decrypts, processes, and encrypts responses.
 */
router.post('/request', secureApiMiddleware, async (req, res) => {
  const action = req.decryptedAction;
  const params = req.decryptedParams;
  const session = req.sessionData;
  const ip = req.ip || req.headers['x-forwarded-for'] || '';

  let responseData = { status: 'error', message: 'Unknown action' };

  try {
    switch (action) {
      case 'register': {
        const { username, password, key, hwid } = params;
        if (!username || !password || !key || !hwid) {
          responseData = { status: 'error', message: 'Missing parameters' };
          break;
        }

        // Check if user already exists
        const existingUser = await User.findOne({ username });
        if (existingUser) {
          responseData = { status: 'error', message: 'Username is already taken' };
          break;
        }

        // Find and validate the license key
        const license = await License.findOne({ key });
        if (!license) {
          responseData = { status: 'error', message: 'License key not found' };
          break;
        }

        if (license.status === 'banned') {
          responseData = { status: 'error', message: `License is banned: ${license.banReason}` };
          break;
        }

        if (license.status === 'active') {
          responseData = { status: 'error', message: 'License key is already activated' };
          break;
        }

        // Hash password (MD5/SHA256/bcrypt - for simplicity, SHA256)
        const passwordHash = crypto.createHash('sha256').update(password).digest('hex');

        // Bind license key details
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + license.durationDays);

        await License.findOneAndUpdate({ key }, {
          expiry: expiryDate, hwid, status: 'active'
        });

        // Create User with appId from license
        await User.create({
          username, passwordHash, licenseKey: key, hwid, appId: license.appId
        });

        // Log action
        await Log.create({ username, action: 'Register', ip, hwid });

        sendWebhook({
          title: '📝 New Registration',
          color: 0x00ff00,
          fields: { Username: username, 'License Key': key, HWID: hwid, IP: ip, Expiry: expiryDate.toISOString() }
        });

        session.username = username;
        responseData = {
          status: 'success',
          message: 'Registration successful',
          info: { username, expiry: expiryDate.toISOString() }
        };
        break;
      }

      case 'login': {
        const { username, password, hwid } = params;
        if (!username || !password || !hwid) {
          responseData = { status: 'error', message: 'Missing login parameters' };
          break;
        }

        const user = await User.findOne({ username });
        if (!user) {
          responseData = { status: 'error', message: 'User not found' };
          break;
        }

        if (user.banned) {
          responseData = { status: 'error', message: `User is banned: ${user.banReason}` };
          break;
        }

        // Verify password hash
        const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
        if (user.passwordHash !== passwordHash) {
          responseData = { status: 'error', message: 'Invalid password' };
          break;
        }

        // Validate License Key (if bound)
        let loginExpiry = null;
        if (user.licenseKey) {
          const license = await License.findOne({ key: user.licenseKey });
          if (!license) {
            responseData = { status: 'error', message: 'Associated license key not found' };
            break;
          }

          if (license.status === 'banned') {
            responseData = { status: 'error', message: `License key is banned: ${license.banReason}` };
            break;
          }

          // Check expiry
          if (license.expiry && new Date() > license.expiry) {
            await License.findOneAndUpdate({ key: user.licenseKey }, { status: 'expired' });
            responseData = { status: 'error', message: 'License key has expired' };
            break;
          }

          // Verify HWID
          if (license.hwid && license.hwid !== hwid) {
            responseData = { status: 'error', message: 'HWID mismatch. Please reset HWID via Admin Dashboard.' };
            break;
          } else if (!license.hwid) {
            // Bind if it was somehow unbound
            await License.findOneAndUpdate({ key: user.licenseKey }, { hwid });
            await User.findOneAndUpdate({ username }, { hwid });
          }
          loginExpiry = license.expiry;
        }

        // Log action
        await Log.create({ username, action: 'Login', ip, hwid });

        sendWebhook({
          title: '🔑 User Login',
          color: 0x00aaff,
          fields: { Username: username, HWID: hwid, IP: ip }
        });

        session.username = username;
        responseData = {
          status: 'success',
          message: 'Logged in successfully',
          info: { username, expiry: loginExpiry ? loginExpiry.toISOString() : 'Lifetime' }
        };
        break;
      }

      case 'verify': {
        // Simple session verification
        if (!session.username) {
          responseData = { status: 'error', message: 'Session not authenticated' };
          break;
        }

        const user = await User.findOne({ username: session.username });
        if (!user || user.banned) {
          responseData = { status: 'error', message: 'User is banned or no longer exists' };
          break;
        }

        const license = await License.findOne({ key: user.licenseKey });
        if (!license || license.status === 'banned' || (license.expiry && new Date() > license.expiry)) {
          responseData = { status: 'error', message: 'License expired or banned' };
          break;
        }

        responseData = {
          status: 'success',
          message: 'Session is active',
          info: { username: user.username, expiry: license.expiry ? license.expiry.toISOString() : 'Lifetime' }
        };
        break;
      }

      case 'fetch_var': {
        const { varName } = params;
        if (!session.username) {
          responseData = { status: 'error', message: 'Session unauthorized' };
          break;
        }

        const variable = await Variable.findOne({ name: varName });
        if (!variable) {
          responseData = { status: 'error', message: 'Variable not found' };
          break;
        }

        responseData = {
          status: 'success',
          name: varName,
          value: variable.value
        };
        break;
      }

      case 'download_file': {
        const { fileName } = params;
        if (!session.username) {
          responseData = { status: 'error', message: 'Session unauthorized' };
          break;
        }

        const file = await File.findOne({ name: fileName });
        if (!file) {
          responseData = { status: 'error', message: 'File not found' };
          break;
        }

        responseData = {
          status: 'success',
          fileName: file.fileName,
          fileData: file.data, // Base64 representation of file
          fileHash: file.hash
        };
        break;
      }

      default:
        responseData = { status: 'error', message: 'Invalid action requested' };
        break;
    }
  } catch (error) {
    console.error('Request Action Error:', error);
    responseData = { status: 'error', message: 'Internal server error processing request' };
  }

  // Encrypt response using Session AES Key
  const responsePayload = JSON.stringify({
    status: responseData.status,
    nonce: req.clientNonce,
    timestamp: Math.floor(Date.now() / 1000),
    data: responseData
  });

  const encryptedData = cryptoHelper.aesEncrypt(responsePayload, session.aesKey, session.aesIv);
  const signature = cryptoHelper.computeHmac(encryptedData, session.aesKey);

  return res.json({
    data: encryptedData,
    signature
  });
});

module.exports = router;
