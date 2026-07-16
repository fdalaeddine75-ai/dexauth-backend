/**
 * DexAuth Local Database (NeDB-based)
 * Works 100% without MongoDB — stores data in local .db files
 * Drop-in replacement with Mongoose-like API
 */
const Datastore = require('@seald-io/nedb');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const DB_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

// Create datastores
const db = {
  apps:      new Datastore({ filename: path.join(DB_DIR, 'apps.db'),      autoload: true }),
  licenses:  new Datastore({ filename: path.join(DB_DIR, 'licenses.db'),  autoload: true }),
  users:     new Datastore({ filename: path.join(DB_DIR, 'users.db'),     autoload: true }),
  variables: new Datastore({ filename: path.join(DB_DIR, 'variables.db'), autoload: true }),
  files:     new Datastore({ filename: path.join(DB_DIR, 'files.db'),     autoload: true }),
  logs:      new Datastore({ filename: path.join(DB_DIR, 'logs.db'),      autoload: true }),
};

// Ensure unique indexes
db.apps.ensureIndex({ fieldName: 'appId', unique: true });
db.licenses.ensureIndex({ fieldName: 'key', unique: true });
db.users.ensureIndex({ fieldName: 'username' });
db.logs.ensureIndex({ fieldName: 'timestamp' });

// ─── Promise wrappers ──────────────────────────────────────────────────────────
const promisify = (store, method, ...args) =>
  new Promise((resolve, reject) =>
    store[method](...args, (err, result) => err ? reject(err) : resolve(result))
  );

// ─── Generic Model Factory ─────────────────────────────────────────────────────
function createModel(store, defaults = {}) {
  return {
    // Find all matching docs
    find: (query = {}, projection = null) => {
      if (projection && Object.keys(projection).length > 0) {
        return promisify(store, 'find', query, projection);
      }
      return promisify(store, 'find', query);
    },

    // Find one doc
    findOne: (query = {}) => promisify(store, 'findOne', query),

    // Find by _id
    findById: (id) => promisify(store, 'findOne', { _id: id }),

    // Count documents
    countDocuments: (query = {}) => promisify(store, 'count', query),

    // Create new doc
    create: (data) => {
      const doc = { ...defaults, ...data, createdAt: data.createdAt || new Date() };
      return promisify(store, 'insert', doc);
    },

    // Find one and update (upsert supported)
    findOneAndUpdate: (query, update, options = {}) =>
      new Promise((resolve, reject) => {
        store.update(query, { $set: update }, { upsert: options.upsert || false }, (err, numAffected, affectedDoc) => {
          if (err) return reject(err);
          // If upserted or updated, return the document
          store.findOne(query, (err2, doc) => err2 ? reject(err2) : resolve(doc));
        });
      }),

    // Find by ID and delete
    findByIdAndDelete: (id) =>
      new Promise((resolve, reject) => {
        store.findOne({ _id: id }, (err, doc) => {
          if (err) return reject(err);
          if (!doc) return resolve(null);
          store.remove({ _id: id }, {}, (err2) => err2 ? reject(err2) : resolve(doc));
        });
      }),

    // Delete many
    deleteMany: (query) => promisify(store, 'remove', query, { multi: true }),

    // Delete one
    deleteOne: (query) => promisify(store, 'remove', query, {}),

    // Sort helper (returns object with sort/limit)
    find_sorted: (query = {}, sortField = 'createdAt', sortDir = -1, limit = 0) =>
      new Promise((resolve, reject) => {
        let cursor = store.find(query).sort({ [sortField]: sortDir });
        if (limit > 0) cursor = cursor.limit(limit);
        cursor.exec((err, docs) => err ? reject(err) : resolve(docs));
      }),

    // Raw NeDB store access
    _store: store
  };
}

// ─── Application Model ─────────────────────────────────────────────────────────
const Application = createModel(db.apps, {
  status: 'active', hwidLock: true, developerMode: false, totalUsers: 0, version: '1.0.0'
});

// ─── License Model ─────────────────────────────────────────────────────────────
const License = createModel(db.licenses, {
  status: 'unused', hwid: null, maxHwidResets: 3, hwidResetsUsed: 0,
  expiry: null, usedBy: null, banReason: '', note: ''
});

// ─── User Model ───────────────────────────────────────────────────────────────
const User = createModel(db.users, {
  email: '', hwid: null, ip: null, banned: false, banReason: '',
  subscriptionExpiry: null, lastLogin: null, licenseKey: null
});

// ─── Variable Model ───────────────────────────────────────────────────────────
const Variable = createModel(db.variables);

// ─── File Model ───────────────────────────────────────────────────────────────
const File = createModel(db.files);

// ─── Log Model ────────────────────────────────────────────────────────────────
const Log = {
  ...createModel(db.logs, { username: 'System', ip: '', hwid: '', appId: 'system' }),
  // Override find to support sort/limit easily
  find: (query = {}) => ({
    sort: (sortObj) => ({
      limit: (n) => ({
        catch: (fn) => new Promise((resolve) => {
          let cursor = db.logs.find(query).sort(sortObj);
          if (n) cursor = cursor.limit(n);
          cursor.exec((err, docs) => err ? resolve(fn(err)) : resolve(docs));
        })
      }),
      exec: () => new Promise((resolve, reject) => {
        db.logs.find(query).sort(sortObj).exec((err, docs) => err ? reject(err) : resolve(docs));
      })
    }),
    exec: () => new Promise((resolve, reject) => {
      db.logs.find(query).exec((err, docs) => err ? reject(err) : resolve(docs));
    })
  }),
  // Simple create
  create: (data) => {
    const doc = { username: 'System', ip: '', hwid: '', appId: 'system', ...data, timestamp: new Date() };
    return promisify(db.logs, 'insert', doc);
  },
  // Simple find returning array for dashboard
  findRecent: (limit = 10) =>
    new Promise((resolve) => {
      db.logs.find({}).sort({ timestamp: -1 }).limit(limit).exec((err, docs) => resolve(docs || []));
    }),
  findAll: (query = {}, limit = 200) =>
    new Promise((resolve) => {
      db.logs.find(query).sort({ timestamp: -1 }).limit(limit).exec((err, docs) => resolve(docs || []));
    })
};

console.log('[DexAuth] ✅ Local NeDB database initialized (no MongoDB required)');
console.log(`[DexAuth] 📁 Data stored in: ${DB_DIR}`);

module.exports = { Application, License, User, Variable, File, Log };
