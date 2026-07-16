const mongoose = require('mongoose');

// ─── Application Schema ───────────────────────────────────────────────────────
const applicationSchema = new mongoose.Schema({
  name:        { type: String, required: true },
  ownerId:     { type: String, required: true },          // admin email or ID
  appId:       { type: String, required: true, unique: true },   // e.g. "app_xxxx"
  appSecret:   { type: String, required: true },          // secret for API auth
  version:     { type: String, default: '1.0.0' },
  status:      { type: String, enum: ['active', 'disabled'], default: 'active' },
  hwidLock:    { type: Boolean, default: true },          // lock users to their HWIDs
  developerMode: { type: Boolean, default: false },
  totalUsers:  { type: Number, default: 0 },
  createdAt:   { type: Date, default: Date.now }
});

// ─── License Schema (linked to an app) ────────────────────────────────────────
const licenseSchema = new mongoose.Schema({
  key:          { type: String, required: true, unique: true },
  appId:        { type: String, required: true },         // which app this key belongs to
  durationDays: { type: Number, required: true },
  expiry:       { type: Date, default: null },
  hwid:         { type: String, default: null },
  maxHwidResets:  { type: Number, default: 3 },
  hwidResetsUsed: { type: Number, default: 0 },
  status:       { type: String, enum: ['unused', 'active', 'banned', 'expired'], default: 'unused' },
  usedBy:       { type: String, default: null },          // username who activated it
  banReason:    { type: String, default: '' },
  note:         { type: String, default: '' },
  createdAt:    { type: Date, default: Date.now }
});

// ─── User Schema ──────────────────────────────────────────────────────────────
const userSchema = new mongoose.Schema({
  username:     { type: String, required: true },
  passwordHash: { type: String, required: true },
  email:        { type: String, default: '' },
  appId:        { type: String, required: true },         // which app this user belongs to
  licenseKey:   { type: String, default: null },
  hwid:         { type: String, default: null },
  ip:           { type: String, default: null },
  banned:       { type: Boolean, default: false },
  banReason:    { type: String, default: '' },
  subscriptionExpiry: { type: Date, default: null },
  lastLogin:    { type: Date, default: null },
  createdAt:    { type: Date, default: Date.now }
});
// Compound unique: username must be unique per app
userSchema.index({ username: 1, appId: 1 }, { unique: true });

// ─── Variable Schema (per app) ────────────────────────────────────────────────
const variableSchema = new mongoose.Schema({
  appId:  { type: String, required: true },
  name:   { type: String, required: true },
  value:  { type: String, required: true }
});
variableSchema.index({ name: 1, appId: 1 }, { unique: true });

// ─── File Schema (per app) ────────────────────────────────────────────────────
const fileSchema = new mongoose.Schema({
  appId:    { type: String, required: true },
  name:     { type: String, required: true },
  fileName: { type: String, required: true },
  data:     { type: String, required: true },             // Base64 encoded
  hash:     { type: String, required: true }              // SHA-256
});

// ─── Audit Log Schema ─────────────────────────────────────────────────────────
const logSchema = new mongoose.Schema({
  appId:     { type: String, default: 'system' },
  username:  { type: String, default: 'System' },
  action:    { type: String, required: true },
  ip:        { type: String, default: '' },
  hwid:      { type: String, default: '' },
  timestamp: { type: Date, default: Date.now }
});

const Application = mongoose.model('Application', applicationSchema);
const License     = mongoose.model('License', licenseSchema);
const User        = mongoose.model('User', userSchema);
const Variable    = mongoose.model('Variable', variableSchema);
const File        = mongoose.model('File', fileSchema);
const Log         = mongoose.model('Log', logSchema);

module.exports = { Application, License, User, Variable, File, Log };
