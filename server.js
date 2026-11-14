// ============================================================================
// TOKOKU — Backend publik (di luar Muse)
// Toko klontong "tokoku", khusus warga Perum GKR.
// Satu server Node.js melayani frontend dan API.
// Database: Turso (libSQL, jarak jauh) bila env TURSO_DATABASE_URL +
// TURSO_AUTH_TOKEN tersedia; bila tidak, fallback ke file SQLite lokal
// (./data/tokoku.db) lewat driver libsql yang sama — satu jalur kode saja.
// Jalankan:  node server.js   (port dari env PORT, default 3000)
// File statis: ./public/  (frontend)
// ----------------------------------------------------------------------------
// CATATAN PORTING: pembaruan dari versi Muse di-porting ke file ini.
// Setiap blok fitur ditandai komentar "// FITUR: ..." agar mudah dicari.
// CATATAN DATA (2026-11-08): database TIDAK BOLEH lagi di file lokal Render
// (filesystem ephemeral — hilang tiap deploy). Karena itu data live tinggal
// di Turso; file lokal hanya fallback untuk pengembangan/uji lokal.
// ============================================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('node:crypto');
const { createClient } = require('@libsql/client');

const PORT = Number(process.env.PORT) || 3000;
const BASE_DIR = __dirname;
const PUBLIC_DIR = path.join(BASE_DIR, 'public');
const DATA_DIR = path.join(BASE_DIR, 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'tokoku.db');

// FITUR: Batas body JSON ~5MB (gambar base64 data URL ikut terkirim di JSON)
const MAX_BODY_BYTES = 5 * 1024 * 1024;

// ============================================================================
// FITUR: Database — Turso (libSQL jarak jauh) atau file lokal (fallback)
// Satu driver (@libsql/client) untuk keduanya, jadi perilaku query sama.
// - Turso:  env TURSO_DATABASE_URL (libsql://...) + TURSO_AUTH_TOKEN.
// - Lokal:  file ./data/tokoku.db (atau env DB_PATH), untuk dev/uji lokal.
// ============================================================================
const TURSO_URL = process.env.TURSO_DATABASE_URL || '';
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN || '';
const USE_TURSO = Boolean(TURSO_URL);

let client;
if (USE_TURSO) {
  client = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN || undefined });
  console.log('Database: Turso (remote)');
} else {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  client = createClient({ url: 'file:' + DB_PATH });
  console.log('Database: file lokal ' + DB_PATH);
}

// FITUR: Helper query — libsql mengembalikan { rows, lastInsertRowid, ... }.
// lastInsertRowid berupa BigInt → selalu ubah ke Number sebelum dipakai
// (argumen query / respons JSON tidak boleh mengandung BigInt).
async function q(sql, args = [], ex = null) {
  const r = await (ex || client).execute(sql, args);
  return r.rows;
}

async function qOne(sql, args = [], ex = null) {
  const rows = await q(sql, args, ex);
  return rows[0] || null;
}

// FITUR: Perbaikan transaksi 2026-11-08 — JANGAN ubah kembali ke
// ex.execute(sql, args): transaksi jarak jauh (Turso, HranaTransaction)
// execute()-nya hanya menerima SATU argumen berupa objek {sql, args};
// argumen args kedua DIAM-DIAM DIBUANG sehingga semua '?' terikat NULL,
// UPDATE tidak mengenai baris apa pun tanpa error, dan endpoint tetap
// mengembalikan 200 (top-up live tidak pernah selesai; pesanan/cancel
// juga rusak). Bentuk {sql, args} juga diterima transaksi lokal
// (Sqlite3Transaction), jadi satu jalur ini benar di kedua database.
async function run(sql, args = [], ex = null) {
  if (ex) return ex.execute({ sql, args });
  return client.execute(sql, args);
}

function numId(v) {
  return typeof v === 'bigint' ? Number(v) : v;
}

// ============================================================================
// FITUR: Keamanan Admin 2026-11-14 — password + authenticator (TOTP).
// - Password disimpan sebagai hash scrypt + salt (format scrypt$<saltHex>$<hashHex>),
//   TIDAK PERNAH plaintext.
// - TOTP: secret base32 (20 byte acak), kode 6 digit HMAC-SHA1 langkah 30 detik,
//   diterima langkah sekarang ±1 (toleransi jam).
// - Kredensial admin tinggal di tabel settings (kunci admin_password_hash,
//   admin_totp_secret, admin_totp_enabled) — getSettings() hanya mengembalikan
//   tiga kunci toko, jadi hash/secret TIDAK PERNAH keluar lewat /api/settings.
// - Sesi: token acak 32 byte, hanya sha256-nya yang disimpan di tabel
//   admin_sessions (berlaku 30 hari); token mentah hanya diberikan sekali
//   saat login.
// - Password awal di-seed dari env ADMIN_PASSWORD_HASH (hash scrypt, BUKAN
//   password mentah) saat start — env menang selama masih terpasang, jadi
//   HAPUS env itu setelah password awal berhasil dipakai, supaya ubah password
//   lewat aplikasi tidak tertimpa restart. Bila terkunci: pasang lagi env
//   tersebut (hash password baru) dan/atau ADMIN_RESET_TOTP=1 (menghapus
//   secret TOTP sehingga authenticator bisa diaktifkan ulang), deploy,
//   lalu hapus env-nya.
// ============================================================================
const ADMIN_SESSION_DAYS = 30;
const LOGIN_MAX_FAILS = 5;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const loginAttempts = new Map(); // ip -> { count, lockedUntil }
let lastSessionCleanup = 0;

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(buf) {
  let out = '';
  let bits = 0, value = 0;
  for (const b of buf) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) { out += B32_ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(str) {
  const clean = String(str || '').toUpperCase().replace(/=+$/, '').replace(/[^A-Z2-7]/g, '');
  const bytes = [];
  let bits = 0, value = 0;
  for (const ch of clean) {
    value = (value << 5) | B32_ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(bytes);
}
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64);
  return 'scrypt$' + salt.toString('hex') + '$' + hash.toString('hex');
}
function verifyPassword(password, stored) {
  try {
    const parts = String(stored || '').split('$');
    if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
    const salt = Buffer.from(parts[1], 'hex');
    const expect = Buffer.from(parts[2], 'hex');
    const actual = crypto.scryptSync(String(password), salt, 64);
    return actual.length === expect.length && crypto.timingSafeEqual(actual, expect);
  } catch (e) { return false; }
}
function totpCode(secretB32, stepOffset) {
  const key = base32Decode(secretB32);
  const counter = Math.floor(Date.now() / 1000 / 30) + (stepOffset || 0);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(msg).digest();
  const off = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[off] & 0x7f) << 24) | ((hmac[off + 1] & 0xff) << 16) |
    ((hmac[off + 2] & 0xff) << 8) | (hmac[off + 3] & 0xff);
  return String(code % 1000000).padStart(6, '0');
}
function verifyTotp(secretB32, code) {
  const c = String(code || '').replace(/\D/g, '');
  if (!/^\d{6}$/.test(c)) return false;
  return [-1, 0, 1].some(function (o) { return totpCode(secretB32, o) === c; });
}
function sha256Hex(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}
async function getAdminSetting(key) {
  const row = await qOne('SELECT value FROM settings WHERE key = ?', [key]);
  return row ? row.value : null;
}
async function setAdminSetting(key, value) {
  await run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ' +
    'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value === null || value === undefined ? '' : String(value)]
  );
}
async function deleteAdminSetting(key) {
  await run('DELETE FROM settings WHERE key = ?', [key]);
}
async function getAdminAuth() {
  const passwordHash = await getAdminSetting('admin_password_hash');
  const totpSecret = await getAdminSetting('admin_totp_secret');
  const totpEnabled = (await getAdminSetting('admin_totp_enabled')) === '1';
  return { passwordHash, totpSecret, totpEnabled };
}
function clientIp(req) {
  const fwd = req.headers && req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}
function loginLocked(ip) {
  const rec = loginAttempts.get(ip);
  return !!(rec && rec.lockedUntil && Date.now() < rec.lockedUntil);
}
function recordLoginFail(ip) {
  const rec = loginAttempts.get(ip) || { count: 0, lockedUntil: 0 };
  rec.count += 1;
  if (rec.count >= LOGIN_MAX_FAILS) {
    rec.lockedUntil = Date.now() + LOGIN_LOCK_MS;
    rec.count = 0;
  }
  loginAttempts.set(ip, rec);
}
function resetLoginRate(ip) { loginAttempts.delete(ip); }
async function createAdminSession() {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + ADMIN_SESSION_DAYS * 24 * 3600 * 1000).toISOString();
  await run('INSERT INTO admin_sessions (token_hash, expires_at) VALUES (?, ?)', [sha256Hex(token), expiresAt]);
  return { token, expiresAt };
}
function bearerToken(req) {
  const h = (req.headers && (req.headers.authorization || req.headers['x-admin-token'])) || '';
  return String(h).replace(/^Bearer\s+/i, '').trim();
}
async function requireAdmin(req) {
  try {
    const token = bearerToken(req);
    if (!token) return false;
    // Bersihkan sesi kedaluwarsa paling cepat sejam sekali (bukan tiap request).
    if (Date.now() - lastSessionCleanup > 3600 * 1000) {
      lastSessionCleanup = Date.now();
      await run('DELETE FROM admin_sessions WHERE expires_at <= ?', [nowIso()]).catch(function () {});
    }
    const row = await qOne('SELECT token_hash FROM admin_sessions WHERE token_hash = ?', [sha256Hex(token)]);
    return !!row;
  } catch (e) { return false; }
}
async function deleteAdminSession(req) {
  const token = bearerToken(req);
  if (token) await run('DELETE FROM admin_sessions WHERE token_hash = ?', [sha256Hex(token)]).catch(function () {});
}
// Endpoint admin yang wajib sesi login (endpoint warga tetap publik).
function adminProtected(pathname, method) {
  if (pathname === '/api/settings' && method === 'POST') return true;
  if (pathname === '/api/products' && method === 'POST') return true;
  if (/^\/api\/products\/\d+$/.test(pathname) && method === 'PUT') return true;
  if (pathname === '/api/admin/warga' && method === 'GET') return true;
  if (pathname === '/api/admin/warga/lite' && method === 'GET') return true;
  if (/^\/api\/admin\/warga\/\d+\/(approve|reject|history)$/.test(pathname)) return true;
  if (pathname === '/api/topup/pending' && method === 'GET') return true;
  if (/^\/api\/topup\/\d+\/(approve|reject)$/.test(pathname) && method === 'POST') return true;
  if (pathname === '/api/orders' && method === 'GET') return true;
  if (pathname === '/api/orders/lite' && method === 'GET') return true;
  if (/^\/api\/orders\/\d+\/status$/.test(pathname) && method === 'POST') return true;
  if (/^\/api\/orders\/\d+\/struk$/.test(pathname) && method === 'GET') return true;
  if (pathname === '/api/chat/threads' && method === 'GET') return true;
  if (pathname === '/api/chat/threads/lite' && method === 'GET') return true;
  return false;
}
// Seed/reset dari env saat start (lihat komentar blok di atas).
async function seedAdminFromEnv() {
  const hash = process.env.ADMIN_PASSWORD_HASH || '';
  if (hash) {
    await setAdminSetting('admin_password_hash', hash);
    console.log('Admin: password awal di-seed dari env ADMIN_PASSWORD_HASH');
  }
  if (process.env.ADMIN_RESET_TOTP === '1') {
    await deleteAdminSetting('admin_totp_secret');
    await setAdminSetting('admin_totp_enabled', '0');
    console.log('Admin: TOTP di-reset dari env ADMIN_RESET_TOTP');
  }
}

// FITUR: Performa 2026-11-14 — hash gambar untuk endpoint lite + cache
// gambar klien. Hash = MD5 12 hex pertama dari string data-URL gambar
// (encoding base64 deterministik, jadi gambar yang sama selalu hash yang
// sama); null bila tidak ada gambar. Endpoint lite mengembalikan hash
// sebagai pengganti bytes base64 sehingga daftar hanya beberapa KB;
// klien mengunduh gambar penuh sekali per sesi dan menyimpannya di cache
// menurut hash. Tidak ada perubahan skema DB dan tidak ada data yang
// diubah (snapshot pesanan tetap menyimpan gambar penuh di DB).
function imgHash(s) {
  if (!s) return null;
  try { return crypto.createHash('md5').update(String(s)).digest('hex').slice(0, 12); }
  catch (e) { return null; }
}
function withProductHash(p) {
  if (!p) return p;
  return { ...p, imageHash: imgHash(p.image) };
}
function withWargaHash(w) {
  if (!w) return w;
  return { ...w, photoHash: imgHash(w.photo) };
}
// Item pesanan disimpan sebagai JSON string; lite mengganti image dengan
// imageHash (tanpa bytes), full menambah imageHash di samping image.
function parseOrderItems(items) {
  if (Array.isArray(items)) return items;
  if (typeof items === 'string') { try { return JSON.parse(items); } catch (e) { return []; } }
  return [];
}
function orderWithHash(order, lite) {
  if (!order) return order;
  const items = parseOrderItems(order.items).map(function (it) {
    const h = imgHash(it.image);
    if (lite) return { ...it, image: undefined, imageHash: h };
    return { ...it, imageHash: h };
  });
  return { ...order, items: JSON.stringify(items) };
}

// FITUR: Transaksi atomik via libsql (client.transaction('write')).
// Callback menerima executor tx; semua query di dalamnya memakai tx.
async function withTransaction(fn) {
  const tx = await client.transaction('write');
  try {
    const result = await fn(tx);
    await tx.commit();
    return result;
  } catch (err) {
    try { await tx.rollback(); } catch { /* sudah rollback */ }
    throw err;
  } finally {
    tx.close();
  }
}

// FITUR: Skema tabel — dibuat saat start (CREATE TABLE IF NOT EXISTS)
const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    price INTEGER NOT NULL DEFAULT 0,
    specialPrice INTEGER NULL,
    stock INTEGER NOT NULL DEFAULT 0,
    category TEXT DEFAULT '',
    image TEXT NULL,
    visible INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS warga (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT UNIQUE NOT NULL,
    blok TEXT DEFAULT '',
    houseNo TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    rejectReason TEXT NULL,
    balance INTEGER NOT NULL DEFAULT 0,
    photo TEXT NULL,
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS topups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wargaId INTEGER NOT NULL,
    amount INTEGER NOT NULL,
    method TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    rejectReason TEXT NULL,
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wargaId INTEGER NOT NULL,
    wargaName TEXT NOT NULL,
    items TEXT NOT NULL,
    subtotal INTEGER NOT NULL,
    deliveryFee INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL,
    payment TEXT NOT NULL,
    method TEXT NOT NULL,
    slot TEXT NOT NULL,
    note TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'baru',
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wargaId INTEGER NOT NULL,
    sender TEXT NOT NULL,
    text TEXT DEFAULT '',
    image TEXT NULL,
    createdAt TEXT NOT NULL,
    readByAdmin INTEGER NOT NULL DEFAULT 0,
    readByWarga INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash TEXT PRIMARY KEY,
    expires_at TEXT NOT NULL
  );
`;

// FITUR: Inisialisasi database saat start — skema + migrasi + settings default.
// Dijalankan sebelum server mulai mendengarkan (async, lihat main() di bawah).
async function initDb() {
  await client.executeMultiple(SCHEMA_SQL);

  // FITUR: Foto profil warga — migrasi AMAN untuk database lama: tambah
  // kolom photo (data URL snapshot, nullable) hanya bila belum ada; data
  // warga lama tetap bisa dibaca (photo = null → tampil inisial).
  // ALTER gagal bila kolom sudah ada → abaikan error itu.
  try {
    await client.execute('ALTER TABLE warga ADD COLUMN photo TEXT NULL');
  } catch { /* kolom photo sudah ada */ }

  // FITUR: Bukti pembayaran top-up (2026-11-08) — migrasi AMAN: tambah
  // kolom proof (data URL snapshot, nullable) hanya bila belum ada;
  // pengajuan lama tetap bisa dibaca (proof = null → "Tanpa bukti").
  try {
    await client.execute('ALTER TABLE topups ADD COLUMN proof TEXT NULL');
  } catch { /* kolom proof sudah ada */ }

  // FITUR: Settings default — ongkir Rp2.000, gratis ongkir saldo mati, toko buka
  await client.execute(
    'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)',
    ['deliveryFee', '2000']
  );
  await client.execute(
    'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)',
    ['freeShippingBalance', '0']
  );
  await client.execute(
    'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)',
    ['storeOpen', '1']
  );
}

// ============================================================================
// FITUR: Helper umum
// ============================================================================
function nowIso() {
  return new Date().toISOString();
}

function sendJson(res, status, obj) {
  // Pengaman: ubah BigInt (mis. lastInsertRowid) jadi Number agar
  // JSON.stringify tidak melempar error.
  const body = JSON.stringify(obj, (k, v) => (typeof v === 'bigint' ? Number(v) : v));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(body);
}

function sendError(res, status, message) {
  sendJson(res, status, { ok: false, error: message });
}

// FITUR: Baca body JSON (limit ~5MB, tolak bila melebihi)
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooBig = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooBig = true;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooBig) return reject(new Error('Body terlalu besar (maks ~5MB)'));
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Body bukan JSON yang valid'));
      }
    });
    req.on('error', reject);
  });
}

function toInt(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ============================================================================
// FITUR: Settings — baca/tulis (deliveryFee, freeShippingBalance, storeOpen)
// ============================================================================
async function getSettings() {
  const rows = await q('SELECT key, value FROM settings');
  const out = { deliveryFee: 2000, freeShippingBalance: 0, storeOpen: 1 };
  // FITUR: Keamanan Admin — hanya tiga kunci toko yang dikembalikan; kunci
  // admin_* (hash password, secret TOTP) TIDAK PERNAH keluar lewat API ini.
  for (const r of rows) {
    if (r.key === 'deliveryFee' || r.key === 'freeShippingBalance' || r.key === 'storeOpen') {
      out[r.key] = toInt(r.value, out[r.key]);
    }
  }
  return out;
}

async function setSettings(patch) {
  const allowed = ['deliveryFee', 'freeShippingBalance', 'storeOpen'];
  for (const key of allowed) {
    if (patch[key] !== undefined && patch[key] !== null) {
      const v = toInt(patch[key]);
      if (v === null) continue;
      // freeShippingBalance & storeOpen hanya 0/1
      const val = (key === 'deliveryFee') ? String(v) : String(v ? 1 : 0);
      await run(
        'INSERT INTO settings (key, value) VALUES (?, ?) ' +
        'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        [key, val]
      );
    }
  }
  return getSettings();
}

// ============================================================================
// FITUR: File statis dari ./public/
// ============================================================================
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  // FITUR: PWA — manifest harus disajikan sebagai application/manifest+json
  // supaya Chrome menerimanya sebagai manifest aplikasi.
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath);
  // FITUR: Aplikasi terpisah — "/" = aplikasi Warga, "/admin" = aplikasi Admin.
  // Satu server + satu database; data (pesanan, saldo, chat) tetap bersama.
  if (rel === '/' || rel === '') rel = '/warga.html';
  if (rel === '/admin' || rel === '/admin/') rel = '/admin.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  // Cegah path traversal keluar dari public/
  if (!filePath.startsWith(PUBLIC_DIR)) {
    return sendError(res, 403, 'Akses ditolak');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (rel === '/index.html') {
        // Frontend belum ada: beri info singkat, bukan error mentah
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h1>tokoku</h1><p>Backend berjalan. Frontend (public/index.html) belum tersedia.</p>');
        return;
      }
      return sendError(res, 404, 'File tidak ditemukan');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(data);
  });
}

// ============================================================================
// FITUR: Router API
// ============================================================================
async function handleApi(req, res, pathname, query) {
  // ---- Keamanan Admin (password + authenticator TOTP) -----------------------
  // Status publik: klien perlu tahu apakah password sudah ada & TOTP aktif
  // (untuk menampilkan kolom kode). TIDAK membocorkan apa pun selain itu.
  if (pathname === '/api/admin/status' && req.method === 'GET') {
    const auth = await getAdminAuth();
    return sendJson(res, 200, { hasPassword: !!auth.passwordHash, totpEnabled: auth.totpEnabled });
  }
  if (pathname === '/api/admin/login' && req.method === 'POST') {
    const ip = clientIp(req);
    if (loginLocked(ip)) return sendError(res, 429, 'Terlalu banyak percobaan gagal. Coba lagi 15 menit lagi.');
    const body = await readBody(req);
    const auth = await getAdminAuth();
    // Pesan error sengaja generik: jangan bocorkan apakah password atau kode
    // yang salah, atau apakah password sudah diatur.
    if (!auth.passwordHash || !verifyPassword(body.password, auth.passwordHash)) {
      recordLoginFail(ip);
      return sendError(res, 401, 'Password atau kode salah.');
    }
    if (auth.totpEnabled && !verifyTotp(auth.totpSecret, body.totp)) {
      recordLoginFail(ip);
      return sendError(res, 401, 'Password atau kode salah.');
    }
    resetLoginRate(ip);
    const sess = await createAdminSession();
    return sendJson(res, 200, { ok: true, token: sess.token, expiresAt: sess.expiresAt, totpEnabled: auth.totpEnabled });
  }
  if (pathname === '/api/admin/logout' && req.method === 'POST') {
    await deleteAdminSession(req);
    return sendJson(res, 200, { ok: true });
  }
  if (pathname === '/api/admin/me' && req.method === 'GET') {
    if (!(await requireAdmin(req))) return sendError(res, 401, 'Sesi admin tidak valid. Silakan login lagi.');
    const auth = await getAdminAuth();
    return sendJson(res, 200, { ok: true, totpEnabled: auth.totpEnabled });
  }
  if (pathname === '/api/admin/totp/setup' && req.method === 'POST') {
    if (!(await requireAdmin(req))) return sendError(res, 401, 'Sesi admin tidak valid. Silakan login lagi.');
    const auth = await getAdminAuth();
    let secret = auth.totpSecret;
    if (!secret) {
      secret = base32Encode(crypto.randomBytes(20));
      await setAdminSetting('admin_totp_secret', secret);
    }
    const otpauthUrl = 'otpauth://totp/' + encodeURIComponent('tokoku admin') +
      '?secret=' + secret + '&issuer=' + encodeURIComponent('tokoku');
    return sendJson(res, 200, { secret, otpauthUrl, enabled: auth.totpEnabled });
  }
  if (pathname === '/api/admin/totp/verify' && req.method === 'POST') {
    if (!(await requireAdmin(req))) return sendError(res, 401, 'Sesi admin tidak valid. Silakan login lagi.');
    const body = await readBody(req);
    const auth = await getAdminAuth();
    if (!auth.totpSecret || !verifyTotp(auth.totpSecret, body.code)) {
      return sendError(res, 400, 'Kode authenticator salah.');
    }
    await setAdminSetting('admin_totp_enabled', '1');
    return sendJson(res, 200, { ok: true });
  }
  if (pathname === '/api/admin/totp/disable' && req.method === 'POST') {
    if (!(await requireAdmin(req))) return sendError(res, 401, 'Sesi admin tidak valid. Silakan login lagi.');
    const body = await readBody(req);
    const auth = await getAdminAuth();
    if (!auth.passwordHash || !verifyPassword(body.password, auth.passwordHash) ||
        (auth.totpEnabled && !verifyTotp(auth.totpSecret, body.code))) {
      return sendError(res, 401, 'Password atau kode salah.');
    }
    await deleteAdminSetting('admin_totp_secret');
    await setAdminSetting('admin_totp_enabled', '0');
    return sendJson(res, 200, { ok: true });
  }
  if (pathname === '/api/admin/password/change' && req.method === 'POST') {
    if (!(await requireAdmin(req))) return sendError(res, 401, 'Sesi admin tidak valid. Silakan login lagi.');
    const body = await readBody(req);
    const auth = await getAdminAuth();
    if (!auth.passwordHash || !verifyPassword(body.currentPassword, auth.passwordHash) ||
        (auth.totpEnabled && !verifyTotp(auth.totpSecret, body.totp))) {
      return sendError(res, 401, 'Password atau kode salah.');
    }
    const next = String(body.newPassword || '');
    if (next.length < 8) return sendError(res, 400, 'Password baru minimal 8 karakter.');
    await setAdminSetting('admin_password_hash', hashPassword(next));
    // Keluar dari perangkat lain (sesi lain dihapus; sesi saat ini dipertahankan).
    await run('DELETE FROM admin_sessions WHERE token_hash <> ?', [sha256Hex(bearerToken(req))]);
    return sendJson(res, 200, { ok: true });
  }
  // FITUR: Keamanan Admin — endpoint admin wajib sesi login; endpoint warga
  // tetap publik (katalog, login/daftar warga, pesanan warga, chat warga,
  // saldo/top-up warga).
  if (adminProtected(pathname, req.method) && !(await requireAdmin(req))) {
    return sendError(res, 401, 'Sesi admin tidak valid. Silakan login lagi.');
  }

  // ---- Settings ------------------------------------------------------------
  if (pathname === '/api/settings' && req.method === 'GET') {
    return sendJson(res, 200, await getSettings());
  }
  if (pathname === '/api/settings' && req.method === 'POST') {
    const body = await readBody(req);
    return sendJson(res, 200, await setSettings(body));
  }

  // ---- Produk --------------------------------------------------------------
  if (pathname === '/api/products' && req.method === 'GET') {
    const rows = await q(
      'SELECT * FROM products ORDER BY name COLLATE NOCASE ASC'
    );
    return sendJson(res, 200, rows.map(withProductHash));
  }
  // FITUR: Performa 2026-11-14 — daftar produk ringan tanpa bytes gambar
  // (dipakai refresh/polling; gambar diambil dari cache klien menurut
  // imageHash). Kolom image tetap dibaca dari Turso untuk menghitung hash
  // (transfer dalam region Singapura, cepat) tapi TIDAK dikirim ke klien.
  if (pathname === '/api/products/lite' && req.method === 'GET') {
    const rows = await q(
      'SELECT * FROM products ORDER BY name COLLATE NOCASE ASC'
    );
    return sendJson(res, 200, rows.map(function (p) {
      return {
        id: p.id, name: p.name, price: p.price, specialPrice: p.specialPrice,
        stock: p.stock, category: p.category, visible: p.visible,
        imageHash: imgHash(p.image),
      };
    }));
  }
  if (pathname === '/api/products' && req.method === 'POST') {
    const b = await readBody(req);
    if (!b.name || toInt(b.price) === null || toInt(b.price) < 0) {
      return sendError(res, 400, 'Nama dan harga produk wajib diisi dengan benar');
    }
    const stock = toInt(b.stock, 0);
    if (stock === null || stock < 0) return sendError(res, 400, 'Stok tidak valid');
    const special = b.specialPrice === null || b.specialPrice === undefined || b.specialPrice === ''
      ? null : toInt(b.specialPrice);
    const info = await run(
      'INSERT INTO products (name, price, specialPrice, stock, category, image, visible) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        String(b.name).trim(), toInt(b.price), special, stock,
        b.category ? String(b.category) : '',
        b.image ? String(b.image) : null,
        b.visible === undefined ? 1 : (b.visible ? 1 : 0),
      ]
    );
    const row = await qOne('SELECT * FROM products WHERE id = ?', [numId(info.lastInsertRowid)]);
    return sendJson(res, 201, row);
  }
  const productIdMatch = pathname.match(/^\/api\/products\/(\d+)$/);
  if (productIdMatch && req.method === 'PUT') {
    const id = Number(productIdMatch[1]);
    const existing = await qOne('SELECT * FROM products WHERE id = ?', [id]);
    if (!existing) return sendError(res, 404, 'Produk tidak ditemukan');
    const b = await readBody(req);
    const name = b.name !== undefined ? String(b.name).trim() : existing.name;
    const price = b.price !== undefined ? toInt(b.price) : existing.price;
    if (!name || price === null || price < 0) {
      return sendError(res, 400, 'Nama dan harga produk tidak valid');
    }
    const stock = b.stock !== undefined ? toInt(b.stock) : existing.stock;
    if (stock === null || stock < 0) return sendError(res, 400, 'Stok tidak valid');
    let special;
    if (b.specialPrice === undefined) special = existing.specialPrice;
    else if (b.specialPrice === null || b.specialPrice === '') special = null;
    else special = toInt(b.specialPrice);
    await run(
      'UPDATE products SET name=?, price=?, specialPrice=?, stock=?, category=?, image=?, visible=? WHERE id=?',
      [
        name, price, special, stock,
        b.category !== undefined ? String(b.category) : existing.category,
        b.image !== undefined ? (b.image ? String(b.image) : null) : existing.image,
        b.visible !== undefined ? (b.visible ? 1 : 0) : existing.visible,
        id,
      ]
    );
    return sendJson(res, 200, await qOne('SELECT * FROM products WHERE id = ?', [id]));
  }

  // ---- Registrasi & login warga --------------------------------------------
  // FITUR: Registrasi — phone unik; bila sudah terdaftar kembalikan akun lama
  if (pathname === '/api/register' && req.method === 'POST') {
    const b = await readBody(req);
    const name = String(b.name || '').trim();
    const phone = String(b.phone || '').trim();
    const blok = String(b.blok || '').trim();
    const houseNo = String(b.houseNo || '').trim();
    if (!name || !phone) return sendError(res, 400, 'Nama dan nomor HP wajib diisi');
    const existing = await qOne('SELECT * FROM warga WHERE phone = ?', [phone]);
    if (existing) {
      return sendJson(res, 200, { alreadyRegistered: true, warga: existing });
    }
    // FITUR: Foto profil warga — snapshot data URL saat daftar (opsional)
    const photo = b.photo ? String(b.photo) : null;
    const info = await run(
      'INSERT INTO warga (name, phone, blok, houseNo, status, balance, photo, createdAt) ' +
      'VALUES (?, ?, ?, ?, ?, 0, ?, ?)',
      [name, phone, blok, houseNo, 'pending', photo, nowIso()]
    );
    const warga = await qOne('SELECT * FROM warga WHERE id = ?', [numId(info.lastInsertRowid)]);
    return sendJson(res, 201, { alreadyRegistered: false, warga });
  }
  // FITUR: Login warga by phone
  if (pathname === '/api/login' && req.method === 'POST') {
    const b = await readBody(req);
    const phone = String(b.phone || '').trim();
    if (!phone) return sendError(res, 400, 'Nomor HP wajib diisi');
    const warga = await qOne('SELECT * FROM warga WHERE phone = ?', [phone]);
    return sendJson(res, 200, { found: !!warga, warga: warga || null });
  }

  // FITUR: Foto profil warga — ubah foto/nama/blok/nomor rumah warga.
  // photo boleh data URL baru, atau null/kosong untuk menghapus foto.
  const profileMatch = pathname.match(/^\/api\/warga\/(\d+)\/profile$/);
  if (profileMatch && req.method === 'PUT') {
    const id = Number(profileMatch[1]);
    const existing = await qOne('SELECT * FROM warga WHERE id = ?', [id]);
    if (!existing) return sendError(res, 404, 'Warga tidak ditemukan');
    const b = await readBody(req);
    const photo = b.photo === undefined ? existing.photo : (b.photo ? String(b.photo) : null);
    const name = (b.name !== undefined && String(b.name).trim())
      ? String(b.name).trim() : existing.name;
    const blok = b.blok !== undefined ? String(b.blok) : existing.blok;
    const houseNo = b.houseNo !== undefined ? String(b.houseNo) : existing.houseNo;
    await run(
      'UPDATE warga SET photo=?, name=?, blok=?, houseNo=? WHERE id=?',
      [photo, name, blok, houseNo, id]
    );
    return sendJson(res, 200, await qOne('SELECT * FROM warga WHERE id = ?', [id]));
  }

  // ---- Admin: kelola warga -------------------------------------------------
  if (pathname === '/api/admin/warga' && req.method === 'GET') {
    const rows = await q(
      'SELECT * FROM warga ORDER BY createdAt DESC, id DESC'
    );
    return sendJson(res, 200, rows.map(withWargaHash));
  }
  // FITUR: Performa 2026-11-14 — daftar warga ringan tanpa foto (foto
  // diambil dari cache klien menurut photoHash). Kolom photo tetap dibaca
  // untuk menghitung hash tapi TIDAK dikirim ke klien.
  if (pathname === '/api/admin/warga/lite' && req.method === 'GET') {
    const rows = await q(
      'SELECT * FROM warga ORDER BY createdAt DESC, id DESC'
    );
    return sendJson(res, 200, rows.map(function (w) {
      return {
        id: w.id, name: w.name, phone: w.phone, blok: w.blok,
        houseNo: w.houseNo, status: w.status, rejectReason: w.rejectReason,
        balance: w.balance, createdAt: w.createdAt,
        photoHash: imgHash(w.photo),
      };
    }));
  }
  const wargaApproveMatch = pathname.match(/^\/api\/admin\/warga\/(\d+)\/approve$/);
  if (wargaApproveMatch && req.method === 'POST') {
    const id = Number(wargaApproveMatch[1]);
    const warga = await qOne('SELECT * FROM warga WHERE id = ?', [id]);
    if (!warga) return sendError(res, 404, 'Warga tidak ditemukan');
    await run("UPDATE warga SET status='approved', rejectReason=NULL WHERE id=?", [id]);
    return sendJson(res, 200, await qOne('SELECT * FROM warga WHERE id = ?', [id]));
  }
  const wargaRejectMatch = pathname.match(/^\/api\/admin\/warga\/(\d+)\/reject$/);
  if (wargaRejectMatch && req.method === 'POST') {
    const id = Number(wargaRejectMatch[1]);
    const warga = await qOne('SELECT * FROM warga WHERE id = ?', [id]);
    if (!warga) return sendError(res, 404, 'Warga tidak ditemukan');
    const b = await readBody(req);
    const reason = String(b.reason || '').trim();
    if (!reason) return sendError(res, 400, 'Alasan penolakan wajib diisi');
    await run("UPDATE warga SET status='rejected', rejectReason=? WHERE id=?", [reason, id]);
    return sendJson(res, 200, await qOne('SELECT * FROM warga WHERE id = ?', [id]));
  }
  // FITUR: Riwayat warga — profil + pesanan + top-up + total belanja
  const wargaHistoryMatch = pathname.match(/^\/api\/admin\/warga\/(\d+)\/history$/);
  if (wargaHistoryMatch && req.method === 'GET') {
    const id = Number(wargaHistoryMatch[1]);
    const warga = await qOne('SELECT * FROM warga WHERE id = ?', [id]);
    if (!warga) return sendError(res, 404, 'Warga tidak ditemukan');
    const orders = await q(
      'SELECT * FROM orders WHERE wargaId = ? ORDER BY createdAt DESC, id DESC',
      [id]
    );
    const topups = await q(
      'SELECT * FROM topups WHERE wargaId = ? ORDER BY createdAt DESC, id DESC',
      [id]
    );
    const totalSpent = orders
      .filter((o) => o.status !== 'dibatalkan')
      .reduce((sum, o) => sum + o.total, 0);
    return sendJson(res, 200, { warga, orders, topups, totalSpent });
  }

  // ---- Top-up ---------------------------------------------------------------
  // FITUR: Top-up — tolak bila masih ada top-up pending milik warga itu
  if (pathname === '/api/topup' && req.method === 'POST') {
    const b = await readBody(req);
    const wargaId = toInt(b.wargaId);
    const amount = toInt(b.amount);
    const method = String(b.method || '');
    if (!wargaId || !amount || amount <= 0) {
      return sendJson(res, 400, { ok: false, error: 'Warga dan jumlah top-up tidak valid' });
    }
    if (!['qris', 'transfer', 'tunai'].includes(method)) {
      return sendJson(res, 400, { ok: false, error: 'Metode top-up tidak valid (qris/transfer/tunai)' });
    }
    const warga = await qOne('SELECT * FROM warga WHERE id = ?', [wargaId]);
    if (!warga) return sendJson(res, 404, { ok: false, error: 'Warga tidak ditemukan' });
    const pending = await qOne(
      "SELECT id FROM topups WHERE wargaId = ? AND status = 'pending' LIMIT 1",
      [wargaId]
    );
    if (pending) {
      return sendJson(res, 400, {
        ok: false,
        error: 'Masih ada pengajuan top-up yang menunggu persetujuan. Tunggu sampai diproses admin.',
      });
    }
    const info = await run(
      // FITUR: Bukti pembayaran top-up — snapshot data URL (opsional,
      // sudah diperkecil di sisi warga sebelum dikirim).
      "INSERT INTO topups (wargaId, amount, method, status, proof, createdAt) VALUES (?, ?, ?, 'pending', ?, ?)",
      [wargaId, amount, method, b.proof ? String(b.proof) : null, nowIso()]
    );
    const topup = await qOne('SELECT * FROM topups WHERE id = ?', [numId(info.lastInsertRowid)]);
    return sendJson(res, 201, { ok: true, topup });
  }
  if (pathname === '/api/topup/pending' && req.method === 'GET') {
    const rows = await q(
      // FITUR: Foto profil warga — ikut dikirim supaya Admin melihat foto
      // warga di kartu verifikasi top-up (null bila belum pasang foto).
      "SELECT t.*, w.name AS wargaName, w.phone AS wargaPhone, w.photo AS wargaPhoto " +
      'FROM topups t JOIN warga w ON w.id = t.wargaId ' +
      "WHERE t.status = 'pending' ORDER BY t.createdAt ASC, t.id ASC"
    );
    return sendJson(res, 200, rows);
  }
  const topupApproveMatch = pathname.match(/^\/api\/topup\/(\d+)\/approve$/);
  if (topupApproveMatch && req.method === 'POST') {
    const id = Number(topupApproveMatch[1]);
    const topup = await qOne('SELECT * FROM topups WHERE id = ?', [id]);
    if (!topup) return sendError(res, 404, 'Top-up tidak ditemukan');
    if (topup.status !== 'pending') {
      return sendError(res, 400, 'Top-up sudah diproses sebelumnya');
    }
    // FITUR: Approve top-up menambah saldo warga (atomik)
    await withTransaction(async (tx) => {
      await run("UPDATE topups SET status='approved' WHERE id=?", [id], tx);
      await run('UPDATE warga SET balance = balance + ? WHERE id = ?', [topup.amount, topup.wargaId], tx);
    });
    return sendJson(res, 200, await qOne('SELECT * FROM topups WHERE id = ?', [id]));
  }
  const topupRejectMatch = pathname.match(/^\/api\/topup\/(\d+)\/reject$/);
  if (topupRejectMatch && req.method === 'POST') {
    const id = Number(topupRejectMatch[1]);
    const topup = await qOne('SELECT * FROM topups WHERE id = ?', [id]);
    if (!topup) return sendError(res, 404, 'Top-up tidak ditemukan');
    if (topup.status !== 'pending') {
      return sendError(res, 400, 'Top-up sudah diproses sebelumnya');
    }
    const b = await readBody(req);
    const reason = String(b.reason || '').trim();
    if (!reason) return sendError(res, 400, 'Alasan penolakan wajib diisi');
    await run("UPDATE topups SET status='rejected', rejectReason=? WHERE id=?", [reason, id]);
    return sendJson(res, 200, await qOne('SELECT * FROM topups WHERE id = ?', [id]));
  }
  const balanceMatch = pathname.match(/^\/api\/warga\/(\d+)\/balance$/);
  if (balanceMatch && req.method === 'GET') {
    const warga = await qOne('SELECT balance FROM warga WHERE id = ?', [Number(balanceMatch[1])]);
    if (!warga) return sendError(res, 404, 'Warga tidak ditemukan');
    return sendJson(res, 200, { balance: warga.balance });
  }
  // FITUR: Status top-up warga — untuk menyembunyikan form bila ada pending
  const topupStatusMatch = pathname.match(/^\/api\/warga\/(\d+)\/topup-status$/);
  if (topupStatusMatch && req.method === 'GET') {
    const warga = await qOne('SELECT id FROM warga WHERE id = ?', [Number(topupStatusMatch[1])]);
    if (!warga) return sendError(res, 404, 'Warga tidak ditemukan');
    const pending = await qOne(
      "SELECT id FROM topups WHERE wargaId = ? AND status = 'pending' LIMIT 1",
      [Number(topupStatusMatch[1])]
    );
    return sendJson(res, 200, { hasPending: !!pending });
  }

  // ---- Pesanan --------------------------------------------------------------
  // FITUR: Buat pesanan — harga spesial saldo, cek stok, ongkir, cek saldo
  if (pathname === '/api/orders' && req.method === 'POST') {
    const b = await readBody(req);
    const wargaId = toInt(b.wargaId);
    const itemsReq = Array.isArray(b.items) ? b.items : [];
    const method = String(b.method || '');
    const slot = String(b.slot || '');
    const payment = String(b.payment || '');
    const note = String(b.note || '');
    if (!wargaId) return sendJson(res, 400, { ok: false, error: 'Warga tidak valid' });
    if (!itemsReq.length) return sendJson(res, 400, { ok: false, error: 'Keranjang masih kosong' });
    if (!['antar', 'ambil'].includes(method)) {
      return sendJson(res, 400, { ok: false, error: 'Metode pengiriman tidak valid (antar/ambil)' });
    }
    if (!['saldo', 'tunai'].includes(payment)) {
      return sendJson(res, 400, { ok: false, error: 'Cara bayar tidak valid (saldo/tunai)' });
    }
    // FITUR: Jam antar/ambil — 09.00-10.00, 11.00-12.00, 16.00-17.00, 19.00-20.00
    const validSlots = ['09.00-10.00', '11.00-12.00', '16.00-17.00', '19.00-20.00'];
    if (!validSlots.includes(slot)) {
      return sendJson(res, 400, { ok: false, error: 'Jam antar/ambil tidak valid' });
    }
    const settings = await getSettings();
    if (settings.storeOpen === 0) {
      return sendJson(res, 400, { ok: false, error: 'Toko sedang tutup, pesanan belum bisa dibuat' });
    }
    const warga = await qOne('SELECT * FROM warga WHERE id = ?', [wargaId]);
    if (!warga) return sendJson(res, 404, { ok: false, error: 'Warga tidak ditemukan' });
    if (warga.status !== 'approved') {
      return sendJson(res, 403, { ok: false, error: 'Akun belum disetujui admin, belum bisa belanja' });
    }

    // Hitung harga + cek stok (pakai harga spesial bila bayar pakai saldo)
    const items = [];
    let subtotal = 0;
    for (const it of itemsReq) {
      const productId = toInt(it.productId);
      const qty = toInt(it.qty);
      if (!productId || !qty || qty <= 0) {
        return sendJson(res, 400, { ok: false, error: 'Jumlah barang tidak valid' });
      }
      const product = await qOne('SELECT * FROM products WHERE id = ?', [productId]);
      if (!product) {
        return sendJson(res, 400, { ok: false, error: 'Ada barang yang tidak ditemukan' });
      }
      if (product.visible === 0) {
        return sendJson(res, 400, { ok: false, error: `Barang "${product.name}" sedang tidak tersedia` });
      }
      if (product.stock < qty) {
        return sendJson(res, 400, { ok: false, error: `Stok "${product.name}" tidak cukup (tersisa ${product.stock})` });
      }
      const unitPrice = (payment === 'saldo' && product.specialPrice !== null && product.specialPrice !== undefined)
        ? product.specialPrice : product.price;
      // FITUR: Snapshot gambar barang di data pesanan — supaya gambar tetap
      // tampil di Pesanan Warga/Admin walau barangnya nanti diubah/dihapus.
      // Tidak perlu ubah skema DB: items disimpan sebagai JSON string.
      items.push({ productId, name: product.name, qty, price: unitPrice, image: product.image || null });
      subtotal += unitPrice * qty;
    }

    // FITUR: Ongkir — ambil di toko gratis; antar = deliveryFee,
    // kecuali bayar saldo dan freeShippingBalance=1 → gratis
    let deliveryFee = 0;
    if (method === 'antar') {
      deliveryFee = (payment === 'saldo' && settings.freeShippingBalance === 1)
        ? 0 : settings.deliveryFee;
    }
    const total = subtotal + deliveryFee;

    if (payment === 'saldo' && warga.balance < total) {
      return sendJson(res, 400, { ok: false, error: 'Saldo tidak cukup untuk pesanan ini' });
    }

    // Simpan pesanan + kurangi stok + kurangi saldo (atomik)
    let orderId;
    await withTransaction(async (tx) => {
      const info = await run(
        'INSERT INTO orders (wargaId, wargaName, items, subtotal, deliveryFee, total, ' +
        "payment, method, slot, note, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'baru', ?)",
        [wargaId, warga.name, JSON.stringify(items), subtotal, deliveryFee, total,
          payment, method, slot, note, nowIso()],
        tx
      );
      orderId = numId(info.lastInsertRowid);
      for (const it of items) {
        await run('UPDATE products SET stock = stock - ? WHERE id = ?', [it.qty, it.productId], tx);
      }
      if (payment === 'saldo') {
        await run('UPDATE warga SET balance = balance - ? WHERE id = ?', [total, wargaId], tx);
      }
    });
    const order = await qOne('SELECT * FROM orders WHERE id = ?', [orderId]);
    return sendJson(res, 201, { ok: true, order });
  }

  // FITUR: Daftar pesanan (admin) — filter tanggal dibuat dan/atau slot
  if (pathname === '/api/orders' && req.method === 'GET') {
    const conditions = [];
    const params = [];
    if (query.date) {
      // createdAt disimpan ISO; filter berdasarkan tanggal UTC dari ISO
      conditions.push('substr(createdAt, 1, 10) = ?');
      params.push(query.date);
    }
    if (query.slot) {
      conditions.push('slot = ?');
      params.push(query.slot);
    }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const rows = await q(
      `SELECT * FROM orders ${where} ORDER BY createdAt DESC, id DESC`,
      params
    );
    return sendJson(res, 200, rows.map(function (o) { return orderWithHash(o, false); }));
  }
  // FITUR: Performa 2026-11-14 — daftar pesanan ringan (item tanpa bytes
  // gambar snapshot, pakai imageHash; gambar diambil dari cache klien).
  if (pathname === '/api/orders/lite' && req.method === 'GET') {
    const conditions = [];
    const params = [];
    if (query.date) {
      conditions.push('substr(createdAt, 1, 10) = ?');
      params.push(query.date);
    }
    if (query.slot) {
      conditions.push('slot = ?');
      params.push(query.slot);
    }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const rows = await q(
      `SELECT * FROM orders ${where} ORDER BY createdAt DESC, id DESC`,
      params
    );
    return sendJson(res, 200, rows.map(function (o) { return orderWithHash(o, true); }));
  }

  const wargaOrdersMatch = pathname.match(/^\/api\/warga\/(\d+)\/orders$/);
  if (wargaOrdersMatch && req.method === 'GET') {
    const wargaId = Number(wargaOrdersMatch[1]);
    const rows = await q(
      'SELECT * FROM orders WHERE wargaId = ? ORDER BY createdAt DESC, id DESC',
      [wargaId]
    );
    return sendJson(res, 200, rows.map(function (o) { return orderWithHash(o, false); }));
  }
  // FITUR: Performa 2026-11-14 — pesanan warga ringan (tanpa bytes gambar).
  const wargaOrdersLiteMatch = pathname.match(/^\/api\/warga\/(\d+)\/orders\/lite$/);
  if (wargaOrdersLiteMatch && req.method === 'GET') {
    const wargaId = Number(wargaOrdersLiteMatch[1]);
    const rows = await q(
      'SELECT * FROM orders WHERE wargaId = ? ORDER BY createdAt DESC, id DESC',
      [wargaId]
    );
    return sendJson(res, 200, rows.map(function (o) { return orderWithHash(o, true); }));
  }

  // FITUR: Batalkan pesanan (warga pemilik, hanya saat status 'baru')
  const cancelMatch = pathname.match(/^\/api\/orders\/(\d+)\/cancel$/);
  if (cancelMatch && req.method === 'POST') {
    const id = Number(cancelMatch[1]);
    const b = await readBody(req);
    const wargaId = toInt(b.wargaId);
    const order = await qOne('SELECT * FROM orders WHERE id = ?', [id]);
    if (!order) return sendJson(res, 404, { ok: false, error: 'Pesanan tidak ditemukan' });
    if (order.wargaId !== wargaId) {
      return sendJson(res, 403, { ok: false, error: 'Pesanan ini bukan milik Anda' });
    }
    if (order.status !== 'baru') {
      if (order.status === 'diproses') {
        return sendJson(res, 400, { ok: false, error: 'Pesanan sudah diproses, tidak bisa dibatalkan' });
      }
      return sendJson(res, 400, { ok: false, error: `Pesanan berstatus "${order.status}", tidak bisa dibatalkan` });
    }
    // Kembalikan stok + kembalikan saldo bila bayar pakai saldo (atomik)
    const items = JSON.parse(order.items);
    await withTransaction(async (tx) => {
      await run("UPDATE orders SET status='dibatalkan' WHERE id=?", [id], tx);
      for (const it of items) {
        await run('UPDATE products SET stock = stock + ? WHERE id = ?', [it.qty, it.productId], tx);
      }
      if (order.payment === 'saldo') {
        await run('UPDATE warga SET balance = balance + ? WHERE id = ?', [order.total, order.wargaId], tx);
      }
    });
    const updated = await qOne('SELECT * FROM orders WHERE id = ?', [id]);
    return sendJson(res, 200, { ok: true, order: updated });
  }

  // FITUR: Admin ubah status pesanan baru → diproses → selesai
  const statusMatch = pathname.match(/^\/api\/orders\/(\d+)\/status$/);
  if (statusMatch && req.method === 'POST') {
    const id = Number(statusMatch[1]);
    const order = await qOne('SELECT * FROM orders WHERE id = ?', [id]);
    if (!order) return sendError(res, 404, 'Pesanan tidak ditemukan');
    const b = await readBody(req);
    const next = String(b.status || '');
    const allowed = { baru: ['diproses'], diproses: ['selesai'] };
    if (!allowed[order.status] || !allowed[order.status].includes(next)) {
      return sendError(res, 400,
        `Status pesanan tidak bisa diubah dari "${order.status}" ke "${next || '(kosong)'}"`);
    }
    await run('UPDATE orders SET status=? WHERE id=?', [next, id]);
    return sendJson(res, 200, await qOne('SELECT * FROM orders WHERE id = ?', [id]));
  }

  // FITUR: Struk pesanan — halaman HTML gaya kertas thermal + tombol Cetak
  const strukMatch = pathname.match(/^\/api\/orders\/(\d+)\/struk$/);
  if (strukMatch && req.method === 'GET') {
    const order = await qOne('SELECT * FROM orders WHERE id = ?', [Number(strukMatch[1])]);
    if (!order) return sendError(res, 404, 'Pesanan tidak ditemukan');
    const items = JSON.parse(order.items);
    const rupiah = (n) => 'Rp' + Number(n).toLocaleString('id-ID');
    const d = new Date(order.createdAt);
    const tanggal = d.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
    const rowsHtml = items.map((it) => `
      <tr>
        <td>${escHtml(it.name)}<br><span class="kecil">${it.qty} x ${rupiah(it.price)}</span></td>
        <td class="kanan">${rupiah(it.qty * it.price)}</td>
      </tr>`).join('');
    const html = `<!DOCTYPE html>
<html lang="id"><head><meta charset="utf-8">
<title>Struk #${order.id} — tokoku</title>
<style>
  body{font-family:monospace,monospace;font-size:14px;color:#000;margin:0;padding:16px}
  .struk{max-width:320px;margin:0 auto}
  h1{text-align:center;font-size:20px;margin:0}
  .tengah{text-align:center}.kanan{text-align:right}
  table{width:100%;border-collapse:collapse}
  td{padding:2px 0;vertical-align:top}
  hr{border:none;border-top:1px dashed #000;margin:8px 0}
  .kecil{font-size:12px;color:#333}
  button{display:block;margin:16px auto;padding:10px 24px;font-size:16px;cursor:pointer}
  @media print{button{display:none}body{padding:0}}
</style></head><body>
<div class="struk">
  <h1>tokoku</h1>
  <p class="tengah">Toko Klontong — Perum GKR</p>
  <hr>
  <p>No. Pesanan: #${order.id}<br>
  Tanggal: ${escHtml(tanggal)}<br>
  Pembeli: ${escHtml(order.wargaName)}<br>
  ${order.method === 'antar' ? 'Antar ke rumah' : 'Ambil di toko'} — Jam ${escHtml(order.slot)}<br>
  Cara bayar: ${order.payment === 'saldo' ? 'Saldo tokoku' : 'Tunai'}</p>
  <hr>
  <table>${rowsHtml}</table>
  <hr>
  <table>
    <tr><td>Subtotal</td><td class="kanan">${rupiah(order.subtotal)}</td></tr>
    <tr><td>Ongkir</td><td class="kanan">${order.deliveryFee ? rupiah(order.deliveryFee) : 'GRATIS'}</td></tr>
    <tr><td><strong>Total</strong></td><td class="kanan"><strong>${rupiah(order.total)}</strong></td></tr>
  </table>
  <hr>
  ${order.note ? `<p class="kecil">Catatan: ${escHtml(order.note)}</p>` : ''}
  ${order.payment === 'tunai' ? '<p class="tengah"><strong>Mohon bayar dengan uang pas</strong></p>' : ''}
  <p class="tengah kecil">Terima kasih sudah belanja di tokoku</p>
  <button onclick="window.print()">Cetak</button>
</div>
</body></html>`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(html);
  }

  // ---- Chat toko ------------------------------------------------------------
  // FITUR: Daftar thread chat — per warga, badge belum dibaca admin
  // (lite = tanpa foto warga, pakai wargaPhotoHash; foto diambil dari cache klien)
  async function loadChatThreads(lite) {
    // FITUR: Foto profil warga — ikut dikirim supaya Admin melihat foto
    // warga di daftar chat (null bila warga belum pasang foto).
    const wargaList = await q('SELECT id, name, photo FROM warga ORDER BY name COLLATE NOCASE ASC');
    // Ambil pesan terakhir tiap warga + hitungan belum dibaca dalam 2 query
    // gabungan (bukan N+1) — penting karena Turso jarak jauh: tiap query
    // adalah round-trip HTTP.
    const lastMsgs = await q(
      'SELECT m.* FROM messages m WHERE m.id IN ' +
      '(SELECT MAX(id) FROM messages GROUP BY wargaId)'
    );
    const lastByWarga = {};
    for (const m of lastMsgs) lastByWarga[m.wargaId] = m;
    const unreadRows = await q(
      "SELECT wargaId, COUNT(*) AS c FROM messages " +
      "WHERE sender = 'warga' AND readByAdmin = 0 GROUP BY wargaId"
    );
    const unreadByWarga = {};
    for (const r of unreadRows) unreadByWarga[r.wargaId] = r.c;
    return wargaList.map((w) => {
      const last = lastByWarga[w.id] || null;
      const t = {
        wargaId: w.id,
        wargaName: w.name,
        unreadAdmin: unreadByWarga[w.id] || 0,
        lastMessage: last
          ? { text: last.text, image: !!last.image, sender: last.sender, createdAt: last.createdAt }
          : null,
      };
      if (lite) t.wargaPhotoHash = imgHash(w.photo);
      else { t.wargaPhoto = w.photo || null; t.wargaPhotoHash = imgHash(w.photo); }
      return t;
    });
  }
  if (pathname === '/api/chat/threads' && req.method === 'GET') {
    return sendJson(res, 200, await loadChatThreads(false));
  }
  // FITUR: Performa 2026-11-14 — thread chat ringan (tanpa foto warga).
  if (pathname === '/api/chat/threads/lite' && req.method === 'GET') {
    return sendJson(res, 200, await loadChatThreads(true));
  }
  const chatMatch = pathname.match(/^\/api\/chat\/(\d+)$/);
  if (chatMatch && req.method === 'GET') {
    const wargaId = Number(chatMatch[1]);
    const messages = await q(
      'SELECT * FROM messages WHERE wargaId = ? ORDER BY createdAt ASC, id ASC',
      [wargaId]
    );
    const unread = await qOne(
      "SELECT COUNT(*) AS c FROM messages WHERE wargaId = ? AND sender = 'admin' AND readByWarga = 0",
      [wargaId]
    );
    return sendJson(res, 200, {
      messages: messages.map(function (m) { return { ...m, imageHash: imgHash(m.image) }; }),
      unreadWarga: unread.c,
    });
  }
  // FITUR: Performa 2026-11-14 — pesan chat ringan (tanpa bytes gambar).
  const chatLiteMatch = pathname.match(/^\/api\/chat\/(\d+)\/lite$/);
  if (chatLiteMatch && req.method === 'GET') {
    const wargaId = Number(chatLiteMatch[1]);
    const messages = await q(
      'SELECT * FROM messages WHERE wargaId = ? ORDER BY createdAt ASC, id ASC',
      [wargaId]
    );
    const unread = await qOne(
      "SELECT COUNT(*) AS c FROM messages WHERE wargaId = ? AND sender = 'admin' AND readByWarga = 0",
      [wargaId]
    );
    return sendJson(res, 200, {
      messages: messages.map(function (m) {
        return {
          id: m.id, wargaId: m.wargaId, sender: m.sender, text: m.text,
          createdAt: m.createdAt, readByAdmin: m.readByAdmin,
          readByWarga: m.readByWarga, imageHash: imgHash(m.image),
        };
      }),
      unreadWarga: unread.c,
    });
  }
  if (chatMatch && req.method === 'POST') {
    const wargaId = Number(chatMatch[1]);
    const warga = await qOne('SELECT id FROM warga WHERE id = ?', [wargaId]);
    if (!warga) return sendError(res, 404, 'Warga tidak ditemukan');
    const b = await readBody(req);
    const sender = String(b.sender || '');
    if (!['admin', 'warga'].includes(sender)) {
      return sendError(res, 400, "Pengirim harus 'admin' atau 'warga'");
    }
    // FITUR: Keamanan Admin 2026-11-14 — pesan sebagai 'admin' wajib sesi
    // login admin; kalau tidak, siapa pun bisa menyamar sebagai toko.
    // Pesan warga ('warga') tetap tanpa sesi (warga belum punya auth).
    if (sender === 'admin' && !(await requireAdmin(req))) {
      return sendError(res, 401, 'Sesi admin tidak valid. Silakan login lagi.');
    }
    const text = String(b.text || '').trim();
    const image = b.image ? String(b.image) : null;
    if (!text && !image) return sendError(res, 400, 'Pesan kosong');
    // FITUR: Pesan baru dari warga → belum dibaca admin; dari admin → belum dibaca warga
    const readByAdmin = sender === 'admin' ? 1 : 0;
    const readByWarga = sender === 'warga' ? 1 : 0;
    const info = await run(
      'INSERT INTO messages (wargaId, sender, text, image, createdAt, readByAdmin, readByWarga) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?)',
      [wargaId, sender, text, image, nowIso(), readByAdmin, readByWarga]
    );
    return sendJson(res, 201, await qOne('SELECT * FROM messages WHERE id = ?', [numId(info.lastInsertRowid)]));
  }
  // FITUR: Tandai semua pesan di thread sudah dibaca oleh pihak yang membuka
  const chatReadMatch = pathname.match(/^\/api\/chat\/(\d+)\/read$/);
  if (chatReadMatch && req.method === 'POST') {
    const wargaId = Number(chatReadMatch[1]);
    const b = await readBody(req);
    const by = String(b.by || '');
    // FITUR: Keamanan Admin 2026-11-14 — menandai dibaca sebagai 'admin'
    // wajib sesi login admin (kalau tidak, siapa pun bisa menghapus lencana
    // pesan belum dibaca milik admin).
    if (by === 'admin' && !(await requireAdmin(req))) {
      return sendError(res, 401, 'Sesi admin tidak valid. Silakan login lagi.');
    }
    if (by === 'admin') {
      await run("UPDATE messages SET readByAdmin = 1 WHERE wargaId = ? AND sender = 'warga'", [wargaId]);
    } else if (by === 'warga') {
      await run("UPDATE messages SET readByWarga = 1 WHERE wargaId = ? AND sender = 'admin'", [wargaId]);
    } else {
      return sendError(res, 400, "Parameter 'by' harus 'admin' atau 'warga'");
    }
    return sendJson(res, 200, { ok: true });
  }

  return sendError(res, 404, 'Endpoint tidak ditemukan');
}

// ============================================================================
// FITUR: Server HTTP — CORS, routing API vs file statis
// ============================================================================
const server = http.createServer(async (req, res) => {
  try {
    // FITUR: CORS izinkan semua origin
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      });
      return res.end();
    }
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;
    const query = Object.fromEntries(url.searchParams.entries());
    if (pathname.startsWith('/api/')) {
      await handleApi(req, res, pathname, query);
    } else {
      serveStatic(req, res, pathname);
    }
  } catch (err) {
    console.error('Error:', err);
    if (!res.headersSent) sendError(res, 500, err.message || 'Terjadi kesalahan server');
    else res.end();
  }
});

// FITUR: Start — inisialisasi database dulu (skema + migrasi + default),
// baru dengarkan port. Bila init gagal, proses keluar dengan error jelas.
async function main() {
  await initDb();
  await seedAdminFromEnv();
  server.listen(PORT, () => {
    console.log(`tokoku berjalan di http://localhost:${PORT}`);
    console.log(USE_TURSO ? 'Database: Turso (remote)' : `Database: file lokal ${DB_PATH}`);
  });
}

main().catch((err) => {
  console.error('Gagal memulai server:', err);
  process.exit(1);
});
