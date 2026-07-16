const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { Application, License, User, Variable, File, Log } = require('../localDb');
const { OAuth2Client } = require('google-auth-library');

const GOOGLE_CLIENT_ID    = process.env.GOOGLE_CLIENT_ID    || '';
const ALLOWED_ADMIN_EMAIL = process.env.ALLOWED_ADMIN_EMAIL || '';
const client = new OAuth2Client(GOOGLE_CLIENT_ID);

// ─── In-memory admin session store ────────────────────────────────────────────
const adminSessions = new Set();

// ─── Helper: safe try/catch wrapper for DB calls ──────────────────────────────
const safeLog = async (data) => {
  try { await Log.create(data); } catch (_) {}
};

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/auth/google', async (req, res) => {
  const { idToken } = req.body;
  if (!idToken) return res.status(400).json({ error: 'Missing Google ID Token' });

  try {
    const ticket = await client.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    const email = payload.email;

    if (!email) return res.status(400).json({ error: 'Failed to retrieve email from Google Account' });
    if (ALLOWED_ADMIN_EMAIL.toLowerCase() !== email.toLowerCase())
      return res.status(403).json({ error: `Access Denied: ${email} is not authorized` });

    const sessionToken = crypto.randomBytes(32).toString('hex');
    adminSessions.add(sessionToken);

    await safeLog({ action: `Admin Logged In via Google (${email})` });
    return res.json({ sessionToken, email, name: payload.name, picture: payload.picture });
  } catch (error) {
    console.error('Google Auth Error:', error.message);
    return res.status(401).json({ error: 'Invalid Google Authentication Token' });
  }
});

router.get('/google-client-id-config', (req, res) => {
  return res.json({ googleClientId: GOOGLE_CLIENT_ID });
});

// ─── Admin Auth Middleware ─────────────────────────────────────────────────────
function adminAuth(req, res, next) {
  const sessionToken = req.headers['x-admin-token'] || req.query.token;
  if (!sessionToken || !adminSessions.has(sessionToken))
    return res.status(401).json({ error: 'Unauthorized. Please sign in with Google.' });
  next();
}

// ═══════════════════════════════════════════════════════════════════════════════
// STATS
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/stats', adminAuth, async (req, res) => {
  try {
    const [totalApps, totalKeys, activeKeys, unusedKeys, bannedKeys, totalUsers, bannedUsers] =
      await Promise.all([
        Application.countDocuments({}).catch(() => 0),
        License.countDocuments({}).catch(() => 0),
        License.countDocuments({ status: 'active' }).catch(() => 0),
        License.countDocuments({ status: 'unused' }).catch(() => 0),
        License.countDocuments({ status: 'banned' }).catch(() => 0),
        User.countDocuments({}).catch(() => 0),
        User.countDocuments({ banned: true }).catch(() => 0),
      ]);
    const recentLogs = await Log.findRecent(10);
    return res.json({ totalApps, totalKeys, activeKeys, unusedKeys, bannedKeys, totalUsers, bannedUsers, recentLogs });
  } catch (error) {
    return res.json({ totalApps: 0, totalKeys: 0, activeKeys: 0, unusedKeys: 0, bannedKeys: 0, totalUsers: 0, bannedUsers: 0, recentLogs: [] });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// APPLICATIONS
// ═══════════════════════════════════════════════════════════════════════════════

// List all apps
router.get('/apps', adminAuth, async (req, res) => {
  try {
    const apps = await Application.find_sorted({}, 'createdAt', -1);
    return res.json(apps);
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

// Create a new app
router.post('/apps', adminAuth, async (req, res) => {
  try {
    const { name, version, hwidLock } = req.body;
    if (!name) return res.status(400).json({ error: 'App name is required' });

    const appId     = 'app_' + crypto.randomBytes(8).toString('hex');
    const appSecret = crypto.randomBytes(32).toString('hex');
    const ownerId   = ALLOWED_ADMIN_EMAIL;

    const app = await Application.create({
      name, ownerId, appId, appSecret,
      version: version || '1.0.0',
      hwidLock: hwidLock !== false
    });
    await safeLog({ action: `Created application "${name}" (${appId})` });
    return res.json({ message: 'Application created', app });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

// Get single app details
router.get('/apps/:appId', adminAuth, async (req, res) => {
  try {
    const app = await Application.findOne({ appId: req.params.appId });
    if (!app) return res.status(404).json({ error: 'App not found' });
    const userCount = await User.countDocuments({ appId: app.appId }).catch(() => 0);
    const keyCount  = await License.countDocuments({ appId: app.appId }).catch(() => 0);
    return res.json({ ...app, userCount, keyCount });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

// Update app settings
router.put('/apps/:appId', adminAuth, async (req, res) => {
  try {
    const { name, version, status, hwidLock, developerMode } = req.body;
    const app = await Application.findOne({ appId: req.params.appId });
    if (!app) return res.status(404).json({ error: 'App not found' });

    if (name)    app.name    = name;
    if (version) app.version = version;
    if (status)  app.status  = status;
    if (hwidLock !== undefined) app.hwidLock = hwidLock;
    if (developerMode !== undefined) app.developerMode = developerMode;

    await app.save();
    await safeLog({ action: `Updated application "${app.name}" (${app.appId})` });
    return res.json({ message: 'Application updated', app });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

// Regenerate app secret
router.post('/apps/:appId/regen-secret', adminAuth, async (req, res) => {
  try {
    const app = await Application.findOne({ appId: req.params.appId });
    if (!app) return res.status(404).json({ error: 'App not found' });
    app.appSecret = crypto.randomBytes(32).toString('hex');
    await app.save();
    await safeLog({ action: `Regenerated secret for app "${app.name}"` });
    return res.json({ message: 'Secret regenerated', appSecret: app.appSecret });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

// Delete app (and all its data)
router.delete('/apps/:appId', adminAuth, async (req, res) => {
  try {
    const app = await Application.findOne({ appId: req.params.appId });
    if (!app) return res.status(404).json({ error: 'App not found' });

    await Promise.all([
      License.deleteMany({ appId: app.appId }),
      User.deleteMany({ appId: app.appId }),
      Variable.deleteMany({ appId: app.appId }),
      File.deleteMany({ appId: app.appId }),
      Application.deleteOne({ appId: app.appId })
    ]);

    await safeLog({ action: `Deleted application "${app.name}" and all its data` });
    return res.json({ message: 'Application and all associated data deleted' });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// LICENSE KEYS (per app)
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/keys', adminAuth, async (req, res) => {
  try {
    const { appId } = req.query;
    const filter = appId ? { appId } : {};
    const keys = await License.find_sorted(filter, 'createdAt', -1);
    return res.json(keys);
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

router.post('/keys/generate', adminAuth, async (req, res) => {
  try {
    const { appId, amount, durationDays, note } = req.body;
    if (!appId || !amount || !durationDays)
      return res.status(400).json({ error: 'Missing appId, amount, or durationDays' });

    const app = await Application.findOne({ appId });
    if (!app) return res.status(404).json({ error: 'App not found' });

    const generated = [];
    for (let i = 0; i < parseInt(amount); i++) {
      const raw = crypto.randomBytes(16).toString('hex').toUpperCase();
      const key = `DEX-${raw.slice(0,4)}-${raw.slice(4,8)}-${raw.slice(8,12)}-${raw.slice(12,16)}`;
      const newLic = await License.create({ key, appId, durationDays: parseInt(durationDays), note: note || '' });
      generated.push(newLic);
    }

    await safeLog({ action: `Generated ${amount} keys for app "${app.name}" (${durationDays} days)` });
    return res.json({ message: 'Keys generated', keys: generated });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

router.delete('/keys/:id', adminAuth, async (req, res) => {
  try {
    const lic = await License.findByIdAndDelete(req.params.id);
    if (!lic) return res.status(404).json({ error: 'License not found' });
    await safeLog({ action: `Deleted key ${lic.key}` });
    return res.json({ message: 'License deleted' });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

router.post('/keys/ban', adminAuth, async (req, res) => {
  try {
    const { key, banReason } = req.body;
    const lic = await License.findOne({ key });
    if (!lic) return res.status(404).json({ error: 'License not found' });
    const newStatus = lic.status === 'banned' ? 'active' : 'banned';
    const newBanReason = newStatus === 'banned' ? (banReason || 'Banned by admin') : '';
    await License.findOneAndUpdate({ key }, { status: newStatus, banReason: newBanReason });
    await safeLog({ action: `${newStatus === 'banned' ? 'Banned' : 'Unbanned'} key ${key}` });
    return res.json({ message: `Key ${newStatus}`, license: { ...lic, status: newStatus, banReason: newBanReason } });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

router.post('/keys/reset-hwid', adminAuth, async (req, res) => {
  try {
    const { key } = req.body;
    const lic = await License.findOne({ key });
    if (!lic) return res.status(404).json({ error: 'License not found' });
    await License.findOneAndUpdate({ key }, { hwid: null });
    await safeLog({ action: `Reset HWID for key ${key}` });
    return res.json({ message: 'HWID reset', license: { ...lic, hwid: null } });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// USERS (per app)
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/users', adminAuth, async (req, res) => {
  try {
    const { appId } = req.query;
    const filter = appId ? { appId } : {};
    const users = await User.find_sorted(filter, 'createdAt', -1);
    return res.json(users);
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

router.delete('/users/:id', adminAuth, async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    await safeLog({ action: `Deleted user "${user.username}" from app ${user.appId}` });
    return res.json({ message: 'User deleted' });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

router.post('/users/ban', adminAuth, async (req, res) => {
  try {
    const { userId, username, banReason } = req.body;
    const user = userId ? await User.findById(userId) : await User.findOne({ username });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const newBanned    = !user.banned;
    const newBanReason = newBanned ? (banReason || 'Banned by admin') : '';
    await User.findOneAndUpdate({ _id: user._id }, { banned: newBanned, banReason: newBanReason });
    await safeLog({ action: `${newBanned ? 'Banned' : 'Unbanned'} user "${user.username}"` });
    return res.json({ message: `User ${newBanned ? 'banned' : 'unbanned'}`, user: { ...user, banned: newBanned, banReason: newBanReason } });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

router.post('/users/reset-hwid', adminAuth, async (req, res) => {
  try {
    const { userId } = req.body;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    await User.findOneAndUpdate({ _id: userId }, { hwid: null });
    await safeLog({ action: `Reset HWID for user "${user.username}"` });
    return res.json({ message: 'HWID reset', user: { ...user, hwid: null } });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

router.post('/users', adminAuth, async (req, res) => {
  try {
    const { username, password, appId, licenseKey } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: 'Username and password are required' });

    const existing = await User.findOne({ username });
    if (existing)
      return res.status(409).json({ error: 'Username already exists' });

    const passwordHash = crypto.createHash('sha256').update(password).digest('hex');

    let linkedLicense = null;
    if (licenseKey) {
      const lic = await License.findOne({ key: licenseKey });
      if (!lic)
        return res.status(404).json({ error: 'License key not found' });
      if (lic.status === 'banned')
        return res.status(400).json({ error: 'License key is banned' });
      if (lic.status === 'active')
        return res.status(400).json({ error: 'License key is already in use' });

      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + lic.durationDays);
      await License.findOneAndUpdate({ key: licenseKey }, {
        status: 'active', expiry: expiryDate
      });
      linkedLicense = licenseKey;
    }

    const user = await User.create({
      username, passwordHash, appId: appId || '', licenseKey: linkedLicense
    });

    await safeLog({ action: `Created user "${username}" via admin panel` });
    return res.json({ message: 'User created successfully', user });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// VARIABLES (per app)
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/variables', adminAuth, async (req, res) => {
  try {
    const { appId } = req.query;
    const filter = appId ? { appId } : {};
    return res.json(await Variable.find(filter));
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

router.post('/variables', adminAuth, async (req, res) => {
  try {
    const { appId, name, value } = req.body;
    if (!appId || !name || !value) return res.status(400).json({ error: 'Missing appId, name or value' });
    const v = await Variable.findOneAndUpdate({ appId, name }, { value }, { new: true, upsert: true });
    await safeLog({ action: `Saved variable "${name}" for app ${appId}` });
    return res.json({ message: 'Variable saved', variable: v });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

router.delete('/variables/:id', adminAuth, async (req, res) => {
  try {
    const v = await Variable.findByIdAndDelete(req.params.id);
    if (!v) return res.status(404).json({ error: 'Variable not found' });
    await safeLog({ action: `Deleted variable "${v.name}"` });
    return res.json({ message: 'Variable deleted' });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// FILES (per app)
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/files', adminAuth, async (req, res) => {
  try {
    const { appId } = req.query;
    const filter = appId ? { appId } : {};
    return res.json(await File.find(filter, { data: 0 }));
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

router.post('/files', adminAuth, async (req, res) => {
  try {
    const { appId, name, fileName, base64Data } = req.body;
    if (!appId || !name || !fileName || !base64Data) return res.status(400).json({ error: 'Missing params' });
    const hash = crypto.createHash('sha256').update(Buffer.from(base64Data, 'base64')).digest('hex');
    const f = await File.findOneAndUpdate({ appId, name }, { fileName, data: base64Data, hash }, { new: true, upsert: true });
    await safeLog({ action: `Uploaded file "${name}" for app ${appId}` });
    return res.json({ message: 'File saved', file: { name, fileName, hash } });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

router.delete('/files/:id', adminAuth, async (req, res) => {
  try {
    const f = await File.findByIdAndDelete(req.params.id);
    if (!f) return res.status(404).json({ error: 'File not found' });
    await safeLog({ action: `Deleted file "${f.name}"` });
    return res.json({ message: 'File deleted' });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// LOGS
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/logs', adminAuth, async (req, res) => {
  try {
    const { appId } = req.query;
    const filter = appId ? { appId } : {};
    const logs = await Log.findAll(filter, 200);
    return res.json(logs);
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

module.exports = router;
