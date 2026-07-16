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
