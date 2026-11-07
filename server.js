// ============================================================================
// TOKOKU — Backend publik (di luar Muse)
// Toko klontong "tokoku", khusus warga Perum GKR.
// Node.js TANPA dependensi eksternal: modul bawaan http + node:sqlite saja.
// Jalankan:  node server.js   (port dari env PORT, default 3000)
// Database:  ./data/tokoku.db  (dibuat otomatis saat start)
// File statis: ./public/  (frontend)
// ----------------------------------------------------------------------------
// CATATAN PORTING: pembaruan dari versi Muse di-porting ke file ini.
// Setiap blok fitur ditandai komentar "// FITUR: ..." agar mudah dicari.
// ============================================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT) || 3000;
const BASE_DIR = __dirname;
const PUBLIC_DIR = path.join(BASE_DIR, 'public');
const DATA_DIR = path.join(BASE_DIR, 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'tokoku.db');

// FITUR: Batas body JSON ~5MB (gambar base64 data URL ikut terkirim di JSON)
const MAX_BODY_BYTES = 5 * 1024 * 1024;

// ============================================================================
// FITUR: Database SQLite — buat folder + tabel saat start
// ============================================================================
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);

db.exec(`
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
`);

// FITUR: Settings default — ongkir Rp2.000, gratis ongkir saldo mati, toko buka
const seedSetting = db.prepare(
  'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)'
);
seedSetting.run('deliveryFee', '2000');
seedSetting.run('freeShippingBalance', '0');
seedSetting.run('storeOpen', '1');

// ============================================================================
// FITUR: Helper umum
// ============================================================================
function nowIso() {
  return new Date().toISOString();
}

// FITUR: Transaksi atomik (node:sqlite tidak punya db.transaction):
// BEGIN IMMEDIATE + COMMIT, ROLLBACK bila fn melempar error
function withTransaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* sudah rollback */ }
    throw err;
  }
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
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
function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = { deliveryFee: 2000, freeShippingBalance: 0, storeOpen: 1 };
  for (const r of rows) out[r.key] = toInt(r.value, out[r.key]);
  return out;
}

function setSettings(patch) {
  const allowed = ['deliveryFee', 'freeShippingBalance', 'storeOpen'];
  const stmt = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ' +
    'ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );
  for (const key of allowed) {
    if (patch[key] !== undefined && patch[key] !== null) {
      const v = toInt(patch[key]);
      if (v === null) continue;
      // freeShippingBalance & storeOpen hanya 0/1
      const val = (key === 'deliveryFee') ? String(v) : String(v ? 1 : 0);
      stmt.run(key, val);
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
  // ---- Settings ------------------------------------------------------------
  if (pathname === '/api/settings' && req.method === 'GET') {
    return sendJson(res, 200, getSettings());
  }
  if (pathname === '/api/settings' && req.method === 'POST') {
    const body = await readBody(req);
    return sendJson(res, 200, setSettings(body));
  }

  // ---- Produk --------------------------------------------------------------
  if (pathname === '/api/products' && req.method === 'GET') {
    const rows = db.prepare(
      'SELECT * FROM products ORDER BY name COLLATE NOCASE ASC'
    ).all();
    return sendJson(res, 200, rows);
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
    const info = db.prepare(
      'INSERT INTO products (name, price, specialPrice, stock, category, image, visible) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(
      String(b.name).trim(), toInt(b.price), special, stock,
      b.category ? String(b.category) : '',
      b.image ? String(b.image) : null,
      b.visible === undefined ? 1 : (b.visible ? 1 : 0)
    );
    const row = db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid);
    return sendJson(res, 201, row);
  }
  const productIdMatch = pathname.match(/^\/api\/products\/(\d+)$/);
  if (productIdMatch && req.method === 'PUT') {
    const id = Number(productIdMatch[1]);
    const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
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
    db.prepare(
      'UPDATE products SET name=?, price=?, specialPrice=?, stock=?, category=?, image=?, visible=? WHERE id=?'
    ).run(
      name, price, special, stock,
      b.category !== undefined ? String(b.category) : existing.category,
      b.image !== undefined ? (b.image ? String(b.image) : null) : existing.image,
      b.visible !== undefined ? (b.visible ? 1 : 0) : existing.visible,
      id
    );
    return sendJson(res, 200, db.prepare('SELECT * FROM products WHERE id = ?').get(id));
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
    const existing = db.prepare('SELECT * FROM warga WHERE phone = ?').get(phone);
    if (existing) {
      return sendJson(res, 200, { alreadyRegistered: true, warga: existing });
    }
    const info = db.prepare(
      'INSERT INTO warga (name, phone, blok, houseNo, status, balance, createdAt) ' +
      'VALUES (?, ?, ?, ?, ?, 0, ?)'
    ).run(name, phone, blok, houseNo, 'pending', nowIso());
    const warga = db.prepare('SELECT * FROM warga WHERE id = ?').get(info.lastInsertRowid);
    return sendJson(res, 201, { alreadyRegistered: false, warga });
  }
  // FITUR: Login warga by phone
  if (pathname === '/api/login' && req.method === 'POST') {
    const b = await readBody(req);
    const phone = String(b.phone || '').trim();
    if (!phone) return sendError(res, 400, 'Nomor HP wajib diisi');
    const warga = db.prepare('SELECT * FROM warga WHERE phone = ?').get(phone);
    return sendJson(res, 200, { found: !!warga, warga: warga || null });
  }

  // ---- Admin: kelola warga -------------------------------------------------
  if (pathname === '/api/admin/warga' && req.method === 'GET') {
    const rows = db.prepare(
      'SELECT * FROM warga ORDER BY createdAt DESC, id DESC'
    ).all();
    return sendJson(res, 200, rows);
  }
  const wargaApproveMatch = pathname.match(/^\/api\/admin\/warga\/(\d+)\/approve$/);
  if (wargaApproveMatch && req.method === 'POST') {
    const id = Number(wargaApproveMatch[1]);
    const warga = db.prepare('SELECT * FROM warga WHERE id = ?').get(id);
    if (!warga) return sendError(res, 404, 'Warga tidak ditemukan');
    db.prepare("UPDATE warga SET status='approved', rejectReason=NULL WHERE id=?").run(id);
    return sendJson(res, 200, db.prepare('SELECT * FROM warga WHERE id = ?').get(id));
  }
  const wargaRejectMatch = pathname.match(/^\/api\/admin\/warga\/(\d+)\/reject$/);
  if (wargaRejectMatch && req.method === 'POST') {
    const id = Number(wargaRejectMatch[1]);
    const warga = db.prepare('SELECT * FROM warga WHERE id = ?').get(id);
    if (!warga) return sendError(res, 404, 'Warga tidak ditemukan');
    const b = await readBody(req);
    const reason = String(b.reason || '').trim();
    if (!reason) return sendError(res, 400, 'Alasan penolakan wajib diisi');
    db.prepare("UPDATE warga SET status='rejected', rejectReason=? WHERE id=?").run(reason, id);
    return sendJson(res, 200, db.prepare('SELECT * FROM warga WHERE id = ?').get(id));
  }
  // FITUR: Riwayat warga — profil + pesanan + top-up + total belanja
  const wargaHistoryMatch = pathname.match(/^\/api\/admin\/warga\/(\d+)\/history$/);
  if (wargaHistoryMatch && req.method === 'GET') {
    const id = Number(wargaHistoryMatch[1]);
    const warga = db.prepare('SELECT * FROM warga WHERE id = ?').get(id);
    if (!warga) return sendError(res, 404, 'Warga tidak ditemukan');
    const orders = db.prepare(
      'SELECT * FROM orders WHERE wargaId = ? ORDER BY createdAt DESC, id DESC'
    ).all(id);
    const topups = db.prepare(
      'SELECT * FROM topups WHERE wargaId = ? ORDER BY createdAt DESC, id DESC'
    ).all(id);
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
    const warga = db.prepare('SELECT * FROM warga WHERE id = ?').get(wargaId);
    if (!warga) return sendJson(res, 404, { ok: false, error: 'Warga tidak ditemukan' });
    const pending = db.prepare(
      "SELECT id FROM topups WHERE wargaId = ? AND status = 'pending' LIMIT 1"
    ).get(wargaId);
    if (pending) {
      return sendJson(res, 400, {
        ok: false,
        error: 'Masih ada pengajuan top-up yang menunggu persetujuan. Tunggu sampai diproses admin.',
      });
    }
    const info = db.prepare(
      "INSERT INTO topups (wargaId, amount, method, status, createdAt) VALUES (?, ?, ?, 'pending', ?)"
    ).run(wargaId, amount, method, nowIso());
    const topup = db.prepare('SELECT * FROM topups WHERE id = ?').get(info.lastInsertRowid);
    return sendJson(res, 201, { ok: true, topup });
  }
  if (pathname === '/api/topup/pending' && req.method === 'GET') {
    const rows = db.prepare(
      "SELECT t.*, w.name AS wargaName, w.phone AS wargaPhone " +
      'FROM topups t JOIN warga w ON w.id = t.wargaId ' +
      "WHERE t.status = 'pending' ORDER BY t.createdAt ASC, t.id ASC"
    ).all();
    return sendJson(res, 200, rows);
  }
  const topupApproveMatch = pathname.match(/^\/api\/topup\/(\d+)\/approve$/);
  if (topupApproveMatch && req.method === 'POST') {
    const id = Number(topupApproveMatch[1]);
    const topup = db.prepare('SELECT * FROM topups WHERE id = ?').get(id);
    if (!topup) return sendError(res, 404, 'Top-up tidak ditemukan');
    if (topup.status !== 'pending') {
      return sendError(res, 400, 'Top-up sudah diproses sebelumnya');
    }
    // FITUR: Approve top-up menambah saldo warga (atomik)
    withTransaction(() => {
      db.prepare("UPDATE topups SET status='approved' WHERE id=?").run(id);
      db.prepare('UPDATE warga SET balance = balance + ? WHERE id = ?').run(topup.amount, topup.wargaId);
    });
    return sendJson(res, 200, db.prepare('SELECT * FROM topups WHERE id = ?').get(id));
  }
  const topupRejectMatch = pathname.match(/^\/api\/topup\/(\d+)\/reject$/);
  if (topupRejectMatch && req.method === 'POST') {
    const id = Number(topupRejectMatch[1]);
    const topup = db.prepare('SELECT * FROM topups WHERE id = ?').get(id);
    if (!topup) return sendError(res, 404, 'Top-up tidak ditemukan');
    if (topup.status !== 'pending') {
      return sendError(res, 400, 'Top-up sudah diproses sebelumnya');
    }
    const b = await readBody(req);
    const reason = String(b.reason || '').trim();
    if (!reason) return sendError(res, 400, 'Alasan penolakan wajib diisi');
    db.prepare("UPDATE topups SET status='rejected', rejectReason=? WHERE id=?").run(reason, id);
    return sendJson(res, 200, db.prepare('SELECT * FROM topups WHERE id = ?').get(id));
  }
  const balanceMatch = pathname.match(/^\/api\/warga\/(\d+)\/balance$/);
  if (balanceMatch && req.method === 'GET') {
    const warga = db.prepare('SELECT balance FROM warga WHERE id = ?').get(Number(balanceMatch[1]));
    if (!warga) return sendError(res, 404, 'Warga tidak ditemukan');
    return sendJson(res, 200, { balance: warga.balance });
  }
  // FITUR: Status top-up warga — untuk menyembunyikan form bila ada pending
  const topupStatusMatch = pathname.match(/^\/api\/warga\/(\d+)\/topup-status$/);
  if (topupStatusMatch && req.method === 'GET') {
    const warga = db.prepare('SELECT id FROM warga WHERE id = ?').get(Number(topupStatusMatch[1]));
    if (!warga) return sendError(res, 404, 'Warga tidak ditemukan');
    const pending = db.prepare(
      "SELECT id FROM topups WHERE wargaId = ? AND status = 'pending' LIMIT 1"
    ).get(Number(topupStatusMatch[1]));
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
    const settings = getSettings();
    if (settings.storeOpen === 0) {
      return sendJson(res, 400, { ok: false, error: 'Toko sedang tutup, pesanan belum bisa dibuat' });
    }
    const warga = db.prepare('SELECT * FROM warga WHERE id = ?').get(wargaId);
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
      const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
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
      items.push({ productId, name: product.name, qty, price: unitPrice });
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
    withTransaction(() => {
      const info = db.prepare(
        'INSERT INTO orders (wargaId, wargaName, items, subtotal, deliveryFee, total, ' +
        "payment, method, slot, note, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'baru', ?)"
      ).run(wargaId, warga.name, JSON.stringify(items), subtotal, deliveryFee, total,
        payment, method, slot, note, nowIso());
      orderId = info.lastInsertRowid;
      const decStock = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?');
      for (const it of items) decStock.run(it.qty, it.productId);
      if (payment === 'saldo') {
        db.prepare('UPDATE warga SET balance = balance - ? WHERE id = ?').run(total, wargaId);
      }
    });
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    return sendJson(res, 201, { ok: true, order });
  }

  // FITUR: Daftar pesanan (admin) — filter tanggal dibuat dan/atau slot
  if (pathname === '/api/orders' && req.method === 'GET') {
    const conditions = [];
    const params = [];
    if (query.date) {
      // createdAt disimpan ISO; filter berdasarkan tanggal UTC dari ISO
      conditions.push("substr(createdAt, 1, 10) = ?");
      params.push(query.date);
    }
    if (query.slot) {
      conditions.push('slot = ?');
      params.push(query.slot);
    }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const rows = db.prepare(
      `SELECT * FROM orders ${where} ORDER BY createdAt DESC, id DESC`
    ).all(...params);
    return sendJson(res, 200, rows);
  }

  const wargaOrdersMatch = pathname.match(/^\/api\/warga\/(\d+)\/orders$/);
  if (wargaOrdersMatch && req.method === 'GET') {
    const wargaId = Number(wargaOrdersMatch[1]);
    const rows = db.prepare(
      'SELECT * FROM orders WHERE wargaId = ? ORDER BY createdAt DESC, id DESC'
    ).all(wargaId);
    return sendJson(res, 200, rows);
  }

  // FITUR: Batalkan pesanan (warga pemilik, hanya saat status 'baru')
  const cancelMatch = pathname.match(/^\/api\/orders\/(\d+)\/cancel$/);
  if (cancelMatch && req.method === 'POST') {
    const id = Number(cancelMatch[1]);
    const b = await readBody(req);
    const wargaId = toInt(b.wargaId);
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
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
    withTransaction(() => {
      db.prepare("UPDATE orders SET status='dibatalkan' WHERE id=?").run(id);
      const incStock = db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?');
      for (const it of items) incStock.run(it.qty, it.productId);
      if (order.payment === 'saldo') {
        db.prepare('UPDATE warga SET balance = balance + ? WHERE id = ?').run(order.total, order.wargaId);
      }
    });
    const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    return sendJson(res, 200, { ok: true, order: updated });
  }

  // FITUR: Admin ubah status pesanan baru → diproses → selesai
  const statusMatch = pathname.match(/^\/api\/orders\/(\d+)\/status$/);
  if (statusMatch && req.method === 'POST') {
    const id = Number(statusMatch[1]);
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    if (!order) return sendError(res, 404, 'Pesanan tidak ditemukan');
    const b = await readBody(req);
    const next = String(b.status || '');
    const allowed = { baru: ['diproses'], diproses: ['selesai'] };
    if (!allowed[order.status] || !allowed[order.status].includes(next)) {
      return sendError(res, 400,
        `Status pesanan tidak bisa diubah dari "${order.status}" ke "${next || '(kosong)'}"`);
    }
    db.prepare('UPDATE orders SET status=? WHERE id=?').run(next, id);
    return sendJson(res, 200, db.prepare('SELECT * FROM orders WHERE id = ?').get(id));
  }

  // FITUR: Struk pesanan — halaman HTML gaya kertas thermal + tombol Cetak
  const strukMatch = pathname.match(/^\/api\/orders\/(\d+)\/struk$/);
  if (strukMatch && req.method === 'GET') {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(strukMatch[1]));
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
  if (pathname === '/api/chat/threads' && req.method === 'GET') {
    const wargaList = db.prepare('SELECT id, name FROM warga ORDER BY name COLLATE NOCASE ASC').all();
    const threads = wargaList.map((w) => {
      const last = db.prepare(
        'SELECT * FROM messages WHERE wargaId = ? ORDER BY createdAt DESC, id DESC LIMIT 1'
      ).get(w.id);
      const unread = db.prepare(
        "SELECT COUNT(*) AS c FROM messages WHERE wargaId = ? AND sender = 'warga' AND readByAdmin = 0"
      ).get(w.id);
      return {
        wargaId: w.id,
        wargaName: w.name,
        unreadAdmin: unread.c,
        lastMessage: last
          ? { text: last.text, image: !!last.image, sender: last.sender, createdAt: last.createdAt }
          : null,
      };
    });
    return sendJson(res, 200, threads);
  }
  const chatMatch = pathname.match(/^\/api\/chat\/(\d+)$/);
  if (chatMatch && req.method === 'GET') {
    const wargaId = Number(chatMatch[1]);
    const messages = db.prepare(
      'SELECT * FROM messages WHERE wargaId = ? ORDER BY createdAt ASC, id ASC'
    ).all(wargaId);
    const unread = db.prepare(
      "SELECT COUNT(*) AS c FROM messages WHERE wargaId = ? AND sender = 'admin' AND readByWarga = 0"
    ).get(wargaId);
    return sendJson(res, 200, { messages, unreadWarga: unread.c });
  }
  if (chatMatch && req.method === 'POST') {
    const wargaId = Number(chatMatch[1]);
    const warga = db.prepare('SELECT id FROM warga WHERE id = ?').get(wargaId);
    if (!warga) return sendError(res, 404, 'Warga tidak ditemukan');
    const b = await readBody(req);
    const sender = String(b.sender || '');
    if (!['admin', 'warga'].includes(sender)) {
      return sendError(res, 400, "Pengirim harus 'admin' atau 'warga'");
    }
    const text = String(b.text || '').trim();
    const image = b.image ? String(b.image) : null;
    if (!text && !image) return sendError(res, 400, 'Pesan kosong');
    // FITUR: Pesan baru dari warga → belum dibaca admin; dari admin → belum dibaca warga
    const readByAdmin = sender === 'admin' ? 1 : 0;
    const readByWarga = sender === 'warga' ? 1 : 0;
    const info = db.prepare(
      'INSERT INTO messages (wargaId, sender, text, image, createdAt, readByAdmin, readByWarga) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(wargaId, sender, text, image, nowIso(), readByAdmin, readByWarga);
    return sendJson(res, 201, db.prepare('SELECT * FROM messages WHERE id = ?').get(info.lastInsertRowid));
  }
  // FITUR: Tandai semua pesan di thread sudah dibaca oleh pihak yang membuka
  const chatReadMatch = pathname.match(/^\/api\/chat\/(\d+)\/read$/);
  if (chatReadMatch && req.method === 'POST') {
    const wargaId = Number(chatReadMatch[1]);
    const b = await readBody(req);
    const by = String(b.by || '');
    if (by === 'admin') {
      db.prepare("UPDATE messages SET readByAdmin = 1 WHERE wargaId = ? AND sender = 'warga'").run(wargaId);
    } else if (by === 'warga') {
      db.prepare("UPDATE messages SET readByWarga = 1 WHERE wargaId = ? AND sender = 'admin'").run(wargaId);
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
        'Access-Control-Allow-Headers': 'Content-Type',
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

server.listen(PORT, () => {
  console.log(`tokoku berjalan di http://localhost:${PORT}`);
  console.log(`Database: ${DB_PATH}`);
});
