require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Google OAuth2 Middleware
const { OAuth2Client } = require('google-auth-library');
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Google auth endpoint
app.post('/api/admin/auth/google', async (req, res) => {
  const { idToken } = req.body;
  try {
    const ticket = await client.verifyIdToken({
      idToken: idToken,
      audience: process.env.GOOGLE_CLIENT_ID
    });
    const payload = ticket.getPayload();
    const email = payload.email;
    
    if (email !== process.env.ALLOWED_ADMIN_EMAIL) {
      return res.status(403).json({ error: 'Unauthorized Google account' });
    }
    
    // Generate a simple admin token (session-based)
    const crypto = require('crypto');
    const sessionToken = crypto.randomBytes(16).toString('hex');
    
    return res.json({ 
      success: true, 
      sessionToken: sessionToken,
      email: email,
      expiresIn: 86400 // 24 hours
    });
  } catch (error) {
    return res.status(401).json({ error: 'Invalid Google token' });
  }
});

// Admin session verification middleware
const adminSessions = new Map();

function adminAuthMiddleware(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!token) {
    return res.status(401).json({ error: 'No admin token provided' });
  }
  
  const session = adminSessions.get(token);
  if (!session || session.expiry <= Date.now()) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
  
  req.adminSession = session;
  next();
}

// Google Client ID config endpoint
app.get('/api/admin/google-client-id-config', (req, res) => {
  res.json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com'
  });
});

// Load local DB (NeDB — no MongoDB required)
require('./localDb');

// Load Routes
const apiRouter   = require('./routes/api');
const adminRouter = require('./routes/admin');

app.use('/api',       apiRouter);
app.use('/api/admin', adminRouter);

// Fallback to Dashboard
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`[DexAuth] 🚀 Server running on port ${PORT}`);
  console.log(`[DexAuth] 🌐 Dashboard: http://localhost:${PORT}`);
});
