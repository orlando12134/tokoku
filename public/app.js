/* tokoku — frontend publik (vanilla JS, tanpa framework / CDN).
   Semua pemanggilan fetch mengikuti kontrak API di /api (lihat server).
   Komentar "// FITUR: ..." menandai blok fitur agar mudah di-porting. */
'use strict';

var API = '/api';
var SLOTS = ['09.00-10.00', '11.00-12.00', '16.00-17.00', '19.00-20.00'];
var WARGA_TABS = [['belanja', 'Belanja'], ['keranjang', 'Keranjang'], ['pesanan', 'Pesanan'], ['saldo', 'Saldo'], ['chat', 'Chat'], ['akun', 'Akun']];
var ADMIN_TABS = [['beranda', 'Beranda'], ['barang', 'Barang'], ['pesanan', 'Pesanan'], ['warga', 'Warga'], ['topup', 'Top-up'], ['chat', 'Chat']];

// ---------- State ----------
var settings = { deliveryFee: 2000, freeShippingBalance: false, storeOpen: 1 };
var products = [];
var warga = null; // {id,name,phone,blok,houseNo,status,rejectReason,...}
var cart = [];    // [{productId, qty}]
var mode = 'warga';
var wargaTab = 'belanja';
var adminTab = 'beranda';
var authView = 'login'; // 'login' | 'register'
var unreadWarga = 0;
var unreadAdminTotal = 0;
var chatPoll = null;
var pendingChatImage = null;
var pendingProductImage = null;
var productEditId = null;
var adminChatWargaId = null;
var reasonCb = null;
var adminOrderFilter = { date: '', slot: '' };

try {
  mode = localStorage.getItem('tokoku_mode') || 'warga';
  warga = JSON.parse(localStorage.getItem('tokoku_warga') || 'null');
  cart = JSON.parse(localStorage.getItem('tokoku_cart') || '[]');
} catch (e) { warga = null; cart = []; }
function saveLocal() {
  try {
    localStorage.setItem('tokoku_mode', mode);
    localStorage.setItem('tokoku_warga', JSON.stringify(warga));
    localStorage.setItem('tokoku_cart', JSON.stringify(cart));
  } catch (e) {}
}

// ---------- Util ----------
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function fmtRp(n) { n = Number(n) || 0; return 'Rp' + n.toLocaleString('id-ID'); }
function fmtDate(d) { try { return new Date(d).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return String(d || ''); } }
function $(id) { return document.getElementById(id); }
function isStoreOpen() { return settings.storeOpen === 1 || settings.storeOpen === true || settings.storeOpen === '1'; }
function isApproved(w) { if (!w) return false; var s = String(w.status || '').toLowerCase(); return s === 'approved' || s === 'verified' || s === 'active' || w.approved === 1 || w.approved === true || w.verified === 1; }
function isPending(w) { if (!w) return false; var s = String(w.status || '').toLowerCase(); return s === 'pending' || s === 'menunggu' || s === 'waiting'; }
function isRejected(w) { if (!w) return false; var s = String(w.status || '').toLowerCase(); return s === 'rejected' || s === 'ditolak'; }
function rejectReason(w) { return (w && (w.rejectReason || w.rejectionReason || w.reason)) || ''; }

// FITUR: pesan hasil (toast) untuk semua aksi penting
var toastTimer = null;
function toast(msg, ok) {
  var el = $('toast'); if (!el) return;
  el.textContent = msg; el.hidden = false;
  el.style.background = ok === false ? '#b91c1c' : '#111827';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.hidden = true; }, 4000);
}

// FITUR: helper API JSON — semua endpoint persis kontrak /api, tanpa endpoint karangan
async function api(path, opts) {
  opts = opts || {};
  var res = await fetch(API + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  var data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  if (!res.ok) throw new Error((data && (data.error || data.message)) || ('HTTP ' + res.status));
  if (data && data.ok === false) throw new Error(data.error || 'Permintaan gagal');
  return data;
}

// FITUR: modal umum + modal alasan penolakan
function openModal(html) { $('modalBody').innerHTML = html; $('modal').hidden = false; }
function closeModal() { $('modal').hidden = true; $('modalBody').innerHTML = ''; reasonCb = null; }
function openReasonModal(title, cb) {
  reasonCb = cb;
  openModal('<h2>' + esc(title) + '</h2><label>Alasan penolakan (akan ditampilkan ke warga)</label>' +
    '<textarea id="reasonText" rows="3" placeholder="Tulis alasan penolakan..."></textarea>' +
    '<button type="button" class="btn btn-danger btn-block" onclick="submitReason()">Tolak dengan alasan ini</button>');
}
async function submitReason() {
  var reason = ($('reasonText') || {}).value || '';
  if (!reason.trim()) { toast('Alasan penolakan wajib diisi.', false); return; }
  var cb = reasonCb; closeModal();
  if (cb) await cb(reason.trim());
}

// ---------- Mode & navigasi ----------
function setMode(m) {
  mode = m; saveLocal(); stopChatPoll();
  if (m === 'warga') wargaTab = 'belanja'; else adminTab = 'beranda';
  render();
}
function setTab(t) {
  if (mode === 'warga') wargaTab = t; else adminTab = t;
  stopChatPoll(); render();
}
function stopChatPoll() { if (chatPoll) { clearInterval(chatPoll); chatPoll = null; } }

async function loadSettings() { try { var s = await api('/settings'); if (s) settings = s; } catch (e) {} }
async function loadProducts() { try { products = await api('/products'); if (!Array.isArray(products)) products = []; } catch (e) { products = []; } }
function visibleProducts() { return products.filter(function (p) { return p.visible !== 0 && p.visible !== false; }); }
function findProduct(id) { return products.find(function (p) { return String(p.id) === String(id); }); }
function effPrice(p, payment) { // FITUR: harga spesial bila bayar pakai saldo
  if (payment === 'saldo' && p.specialPrice != null && Number(p.specialPrice) > 0) return Number(p.specialPrice);
  return Number(p.price) || 0;
}

// FITUR: lencana pesan belum dibaca (warga & admin)
async function refreshUnread() {
  unreadWarga = 0; unreadAdminTotal = 0;
  try {
    if (mode === 'warga' && warga && warga.id) {
      var c = await api('/chat/' + warga.id);
      unreadWarga = (c && c.unreadWarga) || 0;
    } else if (mode === 'admin') {
      var threads = await api('/chat/threads');
      (threads || []).forEach(function (t) { unreadAdminTotal += Number(t.unreadAdmin) || 0; });
    }
  } catch (e) {}
}

async function render() {
  await loadSettings();
  await loadProducts();
  var mw = $('modeWargaBtn'), ma = $('modeAdminBtn');
  if (mw) mw.classList.toggle('active', mode === 'warga');
  if (ma) ma.classList.toggle('active', mode === 'admin');
  var ss = $('storeStatus');
  if (ss) { ss.textContent = isStoreOpen() ? 'Toko Buka' : 'Toko Tutup'; ss.classList.toggle('closed', !isStoreOpen()); }
  await refreshUnread();
  renderNav();
  var view = $('view');
  if (mode === 'admin') {
    if (adminTab === 'beranda') await renderAdminHome(view);
    else if (adminTab === 'barang') renderAdminProducts(view);
    else if (adminTab === 'pesanan') await renderAdminOrders(view);
    else if (adminTab === 'warga') await renderAdminWarga(view);
    else if (adminTab === 'topup') await renderAdminTopup(view);
    else if (adminTab === 'chat') await renderAdminChat(view);
  } else {
    if (!warga || !isApproved(warga)) { renderAuth(view); }
    else if (wargaTab === 'belanja') renderShop(view);
    else if (wargaTab === 'keranjang') renderCartView(view);
    else if (wargaTab === 'pesanan') await renderWargaOrders(view);
    else if (wargaTab === 'saldo') await renderSaldo(view);
    else if (wargaTab === 'chat') await renderWargaChat(view);
    else if (wargaTab === 'akun') renderAccount(view);
  }
  updateCartBar();
}

function renderNav() {
  var nav = $('bottomNav'); if (!nav) return;
  var tabs = mode === 'warga' ? WARGA_TABS : ADMIN_TABS;
  var cur = mode === 'warga' ? wargaTab : adminTab;
  nav.innerHTML = tabs.map(function (t) {
    var badge = '';
    if (mode === 'warga' && t[0] === 'chat' && unreadWarga > 0) badge = '<span class="badge">' + unreadWarga + '</span>';
    if (mode === 'admin' && t[0] === 'chat' && unreadAdminTotal > 0) badge = '<span class="badge">' + unreadAdminTotal + '</span>';
    if (mode === 'warga' && t[0] === 'keranjang' && cart.length > 0) badge = '<span class="badge">' + cart.reduce(function (a, c) { return a + c.qty; }, 0) + '</span>';
    return '<button type="button" class="' + (cur === t[0] ? 'active' : '') + '" onclick="setTab(\'' + t[0] + '\')">' + badge + esc(t[1]) + '</button>';
  }).join('');
}

// ================= MODE WARGA =================

// FITUR: log in / daftar warga (blok placeholder "mawar", nomor rumah "AA01")
function renderAuth(view) {
  var html = '';
  if (warga && isPending(warga)) {
    html = '<div class="card"><h1>Menunggu verifikasi</h1><p>Halo, <b>' + esc(warga.name) + '</b>. Pendaftaranmu sedang menunggu verifikasi admin toko. Silakan cek lagi nanti.</p>' +
      '<p class="muted">Nomor HP: ' + esc(warga.phone) + ' · Blok ' + esc(warga.blok) + ' No. ' + esc(warga.houseNo) + '</p>' +
      '<button type="button" class="btn btn-secondary btn-block" onclick="logout()">Keluar / ganti nomor</button></div>';
  } else if (warga && isRejected(warga)) {
    html = '<div class="card"><h1>Pendaftaran ditolak</h1><div class="notice error">Alasan: ' + esc(rejectReason(warga) || 'Tidak ada keterangan.') + '</div>' +
      '<p>Silakan daftar ulang dengan data yang benar, atau hubungi toko.</p>' +
      '<button type="button" class="btn btn-block" onclick="logout()">Daftar ulang</button></div>';
  } else if (authView === 'register') {
    html = '<div class="card"><h1>Daftar sebagai Warga Perum GKR</h1>' +
      '<form onsubmit="doRegister(event)">' +
      '<label>Nama</label><input id="regName" required placeholder="Nama lengkap">' +
      '<label>Nomor HP</label><input id="regPhone" required inputmode="tel" placeholder="cth. 0812xxxxxxx">' +
      '<label>Blok</label><input id="regBlok" required placeholder="mawar">' +
      '<label>Nomor rumah</label><input id="regHouse" required placeholder="AA01">' +
      '<button type="submit" class="btn btn-block">Kirim Pendaftaran</button></form>' +
      '<p style="text-align:center"><button type="button" class="linklike" onclick="authView=\'login\';render()">Sudah terdaftar? Log In</button></p></div>';
  } else {
    html = '<div class="card"><h1>Log In Warga</h1><p class="muted">Masuk dengan nomor HP yang sudah terdaftar &amp; terverifikasi.</p>' +
      '<form onsubmit="doLogin(event)"><label>Nomor HP</label><input id="loginPhone" required inputmode="tel" placeholder="cth. 0812xxxxxxx">' +
      '<button type="submit" class="btn btn-block">Masuk</button></form>' +
      '<p style="text-align:center"><button type="button" class="linklike" onclick="authView=\'register\';render()">Belum terdaftar? Daftar di sini</button></p></div>';
  }
  view.innerHTML = html;
  updateCartBar();
}

async function doLogin(e) {
  e.preventDefault();
  var phone = $('loginPhone').value.trim();
  if (!phone) return;
  try {
    var r = await api('/login', { method: 'POST', body: { phone: phone } });
    if (!r.found || !r.warga) { toast('Nomor belum terdaftar. Silakan daftar dulu.', false); authView = 'register'; render(); return; }
    warga = r.warga; saveLocal();
    if (isApproved(warga)) { toast('Selamat datang, ' + warga.name + '!'); wargaTab = 'belanja'; }
    else if (isPending(warga)) toast('Pendaftaranmu masih menunggu verifikasi admin.');
    else if (isRejected(warga)) toast('Pendaftaran ditolak: ' + rejectReason(warga), false);
    render();
  } catch (err) { toast('Gagal log in: ' + err.message, false); }
}

async function doRegister(e) {
  e.preventDefault();
  var body = { name: $('regName').value.trim(), phone: $('regPhone').value.trim(), blok: $('regBlok').value.trim(), houseNo: $('regHouse').value.trim() };
  if (!body.name || !body.phone || !body.blok || !body.houseNo) { toast('Lengkapi semua data pendaftaran.', false); return; }
  try {
    var r = await api('/register', { method: 'POST', body: body });
    // FITUR: nomor sudah terdaftar → "Masuk sebagai [nama]"
    if (r.alreadyRegistered && r.warga) {
      warga = r.warga; saveLocal();
      toast('Nomor ini sudah terdaftar. Masuk sebagai ' + r.warga.name + '.');
      render(); return;
    }
    warga = r.warga || body; saveLocal();
    toast('Pendaftaran terkirim. Menunggu verifikasi admin.');
    render();
  } catch (err) { toast('Gagal mendaftar: ' + err.message, false); }
}

function logout() { warga = null; cart = []; saveLocal(); authView = 'login'; wargaTab = 'belanja'; render(); toast('Kamu sudah keluar.'); }

// FITUR: katalog Belanja + toko tutup + harga saldo
function renderShop(view) {
  if (!isStoreOpen()) {
    view.innerHTML = '<div class="shop-wrap"><div class="card"><h1>Maaf, tokoku sedang tutup</h1><p>Toko sedang tutup. Etalase dan pemesanan tidak tersedia saat ini. Silakan kembali lagi saat toko buka.</p></div></div>';
    return;
  }
  var list = visibleProducts();
  var cards = list.map(function (p) {
    var inCart = cart.find(function (c) { return String(c.productId) === String(p.id); });
    var qty = inCart ? inCart.qty : 0;
    var special = (p.specialPrice != null && Number(p.specialPrice) > 0) ? '<div class="product-special">Harga saldo: ' + fmtRp(p.specialPrice) + '</div>' : '';
    return '<div class="product-card">' +
      (p.image ? '<img src="' + esc(p.image) + '" alt="' + esc(p.name) + '" onerror="this.style.display=\'none\'">' : '') +
      '<div class="product-name">' + esc(p.name) + '</div>' +
      '<div class="product-price">' + fmtRp(p.price) + '</div>' + special +
      '<div class="muted" style="font-size:12px">Stok: ' + esc(p.stock) + (p.category ? ' · ' + esc(p.category) : '') + '</div>' +
      '<div class="qty-row"><button type="button" onclick="changeQty(' + JSON.stringify(p.id) + ',-1)" aria-label="Kurangi">−</button><b>' + qty + '</b>' +
      '<button type="button" onclick="changeQty(' + JSON.stringify(p.id) + ',1)" aria-label="Tambah">+</button>' +
      '<button type="button" class="btn btn-small" style="margin-left:auto" onclick="changeQty(' + JSON.stringify(p.id) + ',1)">+ Keranjang</button></div></div>';
  }).join('');
  view.innerHTML = '<div class="shop-wrap"><h1>Belanja</h1>' +
    (list.length ? '<div class="product-grid">' + cards + '</div>' : '<div class="card"><p>Belum ada barang di etalase.</p></div>') + '</div>';
}

function changeQty(productId, delta) {
  var p = findProduct(productId); if (!p) return;
  var item = cart.find(function (c) { return String(c.productId) === String(productId); });
  var cur = item ? item.qty : 0;
  var next = cur + delta;
  if (next > Number(p.stock || 0)) { toast('Stok ' + p.name + ' hanya tersisa ' + p.stock + '.', false); return; }
  if (next <= 0) cart = cart.filter(function (c) { return String(c.productId) !== String(productId); });
  else if (item) item.qty = next; else cart.push({ productId: productId, qty: next });
  saveLocal(); render();
}

function cartLines(payment) {
  return cart.map(function (c) {
    var p = findProduct(c.productId); if (!p) return null;
    return { p: p, qty: c.qty, price: effPrice(p, payment), sub: effPrice(p, payment) * c.qty };
  }).filter(Boolean);
}
function deliveryFeeFor(method, payment) {
  if (method !== 'antar') return 0;
  if (payment === 'saldo' && settings.freeShippingBalance) return 0;
  return Number(settings.deliveryFee) || 0;
}

// FITUR: bilah keranjang melayang (safe-area, di atas nav bawah)
function updateCartBar() {
  var bar = $('cartBar'); if (!bar) return;
  if (mode !== 'warga' || !warga || !isApproved(warga) || wargaTab !== 'belanja' || cart.length === 0 || !isStoreOpen()) { bar.hidden = true; bar.innerHTML = ''; return; }
  var total = cartLines('tunai').reduce(function (a, l) { return a + l.sub; }, 0);
  var count = cart.reduce(function (a, c) { return a + c.qty; }, 0);
  bar.hidden = false;
  bar.innerHTML = '<div><b>' + count + ' barang</b><br><span>' + fmtRp(total) + '</span></div>' +
    '<button type="button" class="btn" onclick="setTab(\'keranjang\')">Lihat Keranjang</button>';
}

// FITUR: Keranjang — antar/ambil + slot jam + catatan + saldo/tunai + ongkir
function renderCartView(view) {
  if (!isStoreOpen()) { view.innerHTML = '<div class="card"><h1>Maaf, tokoku sedang tutup</h1><p>Pemesanan tidak tersedia saat toko tutup.</p></div>'; return; }
  var lines = cartLines('tunai');
  if (!lines.length) { view.innerHTML = '<div class="card"><h1>Keranjang</h1><p>Keranjangmu masih kosong. Yuk belanja dulu.</p><button type="button" class="btn btn-block" onclick="setTab(\'belanja\')">Ke Belanja</button></div>'; return; }
  var itemsHtml = lines.map(function (l) {
    return '<div class="list-item row-between"><div><b>' + esc(l.p.name) + '</b><br><span class="muted">' + fmtRp(l.price) + ' × ' + l.qty + '</span></div>' +
      '<div class="row"><button type="button" class="btn btn-secondary btn-small" onclick="changeQty(' + JSON.stringify(l.p.id) + ',-1)">−</button><b>' + l.qty + '</b>' +
      '<button type="button" class="btn btn-secondary btn-small" onclick="changeQty(' + JSON.stringify(l.p.id) + ',1)">+</button></div></div>';
  }).join('');
  view.innerHTML = '<div class="card"><h1>Keranjang</h1>' + itemsHtml + '</div>' +
    '<div class="card"><h2>Pengiriman</h2>' +
    '<label><input type="radio" name="method" value="antar" checked style="width:auto"> Diantar ke rumah</label>' +
    '<label><input type="radio" name="method" value="ambil" style="width:auto"> Ambil di toko (gratis)</label>' +
    '<label>Jam antar / ambil (wajib pilih)</label><select id="slotSel">' + SLOTS.map(function (s) { return '<option>' + s + '</option>'; }).join('') + '</select>' +
    '<label>Catatan untuk toko</label><input id="orderNote" placeholder="cth. Tolong di taruh di kranjang paket">' +
    '<h2>Pembayaran</h2>' +
    '<label><input type="radio" name="payment" value="saldo" checked style="width:auto"> Bayar pakai saldo</label>' +
    '<label><input type="radio" name="payment" value="tunai" style="width:auto"> Bayar tunai</label>' +
    '<div id="tunaiNote" class="notice" hidden>Mohon bayar dengan uang pas</div>' +
    '<div id="cartSummary"></div>' +
    '<button type="button" class="btn btn-block" onclick="submitOrder()">Pesan Sekarang</button></div>';
  // Perbarui ringkasan + catatan tunai sesuai pilihan saat ini
  var upd = function () {
    var method = (document.querySelector('input[name="method"]:checked') || {}).value || 'antar';
    var payment = (document.querySelector('input[name="payment"]:checked') || {}).value || 'saldo';
    var ls = cartLines(payment);
    var sub = ls.reduce(function (a, l) { return a + l.sub; }, 0);
    var fee = deliveryFeeFor(method, payment);
    var freeNote = (method === 'antar' && payment === 'saldo' && settings.freeShippingBalance) ? 'GRATIS (bayar pakai saldo)' : fmtRp(fee);
    var tn = $('tunaiNote'); if (tn) tn.hidden = payment !== 'tunai';
    var sum = $('cartSummary');
    if (sum) sum.innerHTML = '<div class="row-between" style="margin-top:10px"><span>Subtotal</span><b>' + fmtRp(sub) + '</b></div>' +
      '<div class="row-between"><span>Ongkir</span><b>' + freeNote + '</b></div>' +
      '<div class="row-between"><span>Total</span><b>' + fmtRp(sub + fee) + '</b></div>';
  };
  document.querySelectorAll('input[name="method"],input[name="payment"]').forEach(function (el) { el.addEventListener('change', upd); });
  upd();
}

async function submitOrder() {
  if (!warga) { toast('Silakan log in dulu.', false); return; }
  var method = (document.querySelector('input[name="method"]:checked') || {}).value;
  var payment = (document.querySelector('input[name="payment"]:checked') || {}).value;
  var slot = ($('slotSel') || {}).value || '';
  var note = ($('orderNote') || {}).value || '';
  if (!method) { toast('Pilih Diantar ke rumah atau Ambil di toko.', false); return; }
  if (!slot) { toast('Pilih jam antar/ambil.', false); return; }
  if (!payment) { toast('Pilih cara bayar.', false); return; }
  if (!cart.length) { toast('Keranjang masih kosong.', false); return; }
  try {
    var r = await api('/orders', { method: 'POST', body: { wargaId: warga.id, items: cart.map(function (c) { return { productId: c.productId, qty: c.qty }; }), method: method, slot: slot, payment: payment, note: note } });
    cart = []; saveLocal();
    toast('Pesanan berhasil dibuat' + (r.order && r.order.id ? ' (#' + r.order.id + ')' : '') + '.');
    wargaTab = 'pesanan'; render();
  } catch (err) { toast('Gagal membuat pesanan: ' + err.message, false); }
}

// FITUR: Pesanan warga — batalkan hanya bila status Baru
async function renderWargaOrders(view) {
  var orders = [];
  try { orders = await api('/warga/' + warga.id + '/orders'); } catch (e) { toast('Gagal memuat pesanan: ' + e.message, false); }
  if (!Array.isArray(orders)) orders = [];
  var html = '<h1>Pesanan Saya</h1>';
  if (!orders.length) html += '<div class="card"><p>Belum ada pesanan.</p></div>';
  orders.forEach(function (o) {
    var status = o.status || 'Baru';
    var itemsTxt = (o.items || []).map(function (it) { var p = findProduct(it.productId); return (p ? p.name : 'Barang #' + it.productId) + ' × ' + it.qty; }).join(', ');
    html += '<div class="card"><div class="row-between"><b>Pesanan #' + esc(o.id) + '</b><span class="status-pill status-' + esc(status) + '">' + esc(status) + '</span></div>' +
      '<p class="muted">' + fmtDate(o.createdAt || o.date) + ' · ' + esc(o.method === 'antar' ? 'Diantar' : 'Ambil di toko') + ' · ' + esc(o.slot || '') + ' · ' + esc(o.payment === 'saldo' ? 'Saldo' : 'Tunai') + '</p>' +
      '<p>' + esc(itemsTxt) + '</p><p><b>Total: ' + fmtRp(o.total) + '</b></p>' +
      (status === 'Baru' ? '<button type="button" class="btn btn-danger btn-small" onclick="cancelOrder(' + o.id + ')">Batalkan pesanan</button>' : '') +
      (status === 'Diproses' ? '<p class="muted">Pesanan sedang diproses, tidak bisa dibatalkan.</p>' : '') + '</div>';
  });
  view.innerHTML = html;
}
async function cancelOrder(orderId) {
  if (!confirm('Batalkan pesanan ini? Stok dikembalikan dan saldo (bila dibayar pakai saldo) dikembalikan.')) return;
  try {
    await api('/orders/' + orderId + '/cancel', { method: 'POST', body: { wargaId: warga.id } });
    toast('Pesanan dibatalkan.');
    render();
  } catch (err) { toast('Gagal membatalkan: ' + err.message, false); }
}

// FITUR: Saldo — peringatan tidak bisa diuangkan, QRIS, form top-up / pengajuan menunggu
async function renderSaldo(view) {
  var balance = 0, hasPending = false;
  try { var b = await api('/warga/' + warga.id + '/balance'); balance = (b && b.balance) || 0; } catch (e) {}
  try { var s = await api('/warga/' + warga.id + '/topup-status'); hasPending = !!(s && s.hasPending); } catch (e) {}
  var html = '<h1>Saldo Saya</h1><div class="card"><div class="muted">Saldo tokoku</div><h1 style="font-size:28px">' + fmtRp(balance) + '</h1></div>' +
    '<div class="warn-box">Saldo tokoku tidak dapat diuangkan kembali.</div>' +
    '<div class="card"><h2>Bayar top-up dengan QRIS</h2>' +
    '<img src="qris.jpg" alt="QRIS Toko Khayla" class="qris-img" onerror="this.style.display=\'none\'">' +
    '<p><b>QRIS Toko Khayla</b><br>NMID: ID1022215364889 · A01<br><span class="muted">Scan pakai aplikasi bank / e-wallet.</span></p></div>';
  if (hasPending) {
    html += '<div class="notice"><b>Ada pengajuan top-up yang menunggu persetujuan admin.</b><br>Kamu belum bisa mengajukan top-up baru sampai pengajuan sebelumnya disetujui atau ditolak.</div>';
  } else {
    html += '<div class="card"><h2>Isi saldo</h2><form onsubmit="submitTopup(event)">' +
      '<label>Nominal (Rp)</label><input id="topupAmount" type="number" min="1000" step="1000" required placeholder="cth. 50000">' +
      '<label>Metode</label><select id="topupMethod"><option value="qris">QRIS</option><option value="transfer">Transfer</option><option value="tunai">Tunai</option></select>' +
      '<button type="submit" class="btn btn-block">Ajukan top-up</button></form></div>';
  }
  view.innerHTML = html;
}
async function submitTopup(e) {
  e.preventDefault();
  var amount = Number(($('topupAmount') || {}).value) || 0;
  var method = ($('topupMethod') || {}).value || 'qris';
  if (amount <= 0) { toast('Masukkan nominal top-up yang benar.', false); return; }
  try {
    await api('/topup', { method: 'POST', body: { wargaId: warga.id, amount: amount, method: method } });
    toast('Pengajuan top-up terkirim. Menunggu persetujuan admin.');
    render();
  } catch (err) { toast('Gagal mengajukan top-up: ' + err.message, false); }
}

// FITUR: Chat warga — teks + gambar (lampirkan, pratinjau, gelembung), lencana belum dibaca
async function renderWargaChat(view) {
  var data = { messages: [], unreadWarga: 0 };
  try { data = await api('/chat/' + warga.id); } catch (e) { toast('Gagal memuat chat: ' + e.message, false); }
  var msgs = data.messages || [];
  view.innerHTML = '<h1>Chat Toko</h1><div class="card"><div class="chat-box">' +
    (msgs.length ? msgs.map(function (m) {
      var mine = m.sender === 'warga';
      return '<div class="bubble' + (mine ? ' mine' : '') + '">' + (m.text ? esc(m.text) : '') + (m.image ? '<img src="' + esc(m.image) + '" alt="Gambar chat">' : '') +
        '<div class="muted" style="font-size:11px">' + fmtDate(m.createdAt) + '</div></div>';
    }).join('') : '<p class="muted">Belum ada pesan. Sapa toko di bawah.</p>') + '</div>' +
    '<div id="chatPreview" class="img-preview"></div>' +
    '<div class="chat-input-row"><label class="btn btn-secondary btn-small" style="padding:9px 12px">📎<input type="file" accept="image/*" hidden onchange="onChatImageChange(this)"></label>' +
    '<input type="text" id="chatText" placeholder="Tulis pesan..." onkeydown="if(event.key===\'Enter\')sendWargaChat()">' +
    '<button type="button" class="btn" onclick="sendWargaChat()">Kirim</button></div></div>';
  try { await api('/chat/' + warga.id + '/read', { method: 'POST', body: { by: 'warga' } }); unreadWarga = 0; renderNav(); } catch (e) {}
  stopChatPoll();
  chatPoll = setInterval(async function () { if (mode === 'warga' && wargaTab === 'chat') { var v = $('view'); if (v) await renderWargaChat(v); } }, 10000);
}
function onChatImageChange(input) {
  var f = input.files && input.files[0]; if (!f) return;
  var r = new FileReader();
  r.onload = function () { pendingChatImage = r.result; var pv = $('chatPreview'); if (pv) pv.innerHTML = '<img src="' + esc(pendingChatImage) + '" alt="Pratinjau gambar"><br><button type="button" class="btn btn-secondary btn-small" onclick="pendingChatImage=null;document.getElementById(\'chatPreview\').innerHTML=\'\'">Batalkan gambar</button>'; };
  r.readAsDataURL(f);
}
async function sendWargaChat() { await sendChat('warga', warga.id); }
async function sendChat(sender, wargaId) {
  var text = ($('chatText') || {}).value || '';
  if (!text.trim() && !pendingChatImage) { toast('Tulis pesan atau lampirkan gambar dulu.', false); return; }
  try {
    await api('/chat/' + wargaId, { method: 'POST', body: { sender: sender, text: text.trim() || undefined, image: pendingChatImage || undefined } });
    pendingChatImage = null;
    toast('Pesan terkirim.');
    render();
  } catch (err) { toast('Gagal mengirim pesan: ' + err.message, false); }
}

function renderAccount(view) {
  view.innerHTML = '<h1>Akun Saya</h1><div class="card">' +
    '<p><b>' + esc(warga.name) + '</b><br>' + esc(warga.phone) + '<br>Blok ' + esc(warga.blok) + ' No. ' + esc(warga.houseNo) + '<br>Status: ' + esc(warga.status || 'terverifikasi') + '</p>' +
    '<button type="button" class="btn btn-secondary btn-block" onclick="logout()">Log Out</button></div>';
}

// ================= MODE ADMIN =================

// FITUR: Beranda admin — antrean, ongkir, gratis ongkir saldo, toko buka/tutup
async function renderAdminHome(view) {
  var orders = [], topups = [], wargaList = [];
  try { orders = await api('/orders'); } catch (e) {}
  try { topups = await api('/topup/pending'); } catch (e) {}
  try { wargaList = await api('/admin/warga'); } catch (e) {}
  if (!Array.isArray(orders)) orders = [];
  if (!Array.isArray(topups)) topups = [];
  if (!Array.isArray(wargaList)) wargaList = [];
  var newOrders = orders.filter(function (o) { return o.status === 'Baru'; }).length;
  var pendingWarga = wargaList.filter(function (w) { return isPending(w); }).length;
  var lowStock = products.filter(function (p) { return Number(p.stock || 0) <= 5; }).length;
  view.innerHTML = '<h1>Beranda Admin</h1>' +
    '<div class="grid-2">' +
    '<div class="card"><b style="font-size:24px">' + newOrders + '</b><br>Pesanan baru</div>' +
    '<div class="card"><b style="font-size:24px">' + topups.length + '</b><br>Top-up menunggu</div>' +
    '<div class="card"><b style="font-size:24px">' + pendingWarga + '</b><br>Verifikasi menunggu</div>' +
    '<div class="card"><b style="font-size:24px">' + lowStock + '</b><br>Stok menipis (≤ 5)</div></div>' +
    '<div class="card"><h2>Ongkir antar ke rumah</h2>' +
    '<label>Nominal ongkir (Rp)</label><input id="feeInput" type="number" min="0" step="500" value="' + Number(settings.deliveryFee || 0) + '">' +
    '<button type="button" class="btn btn-block" onclick="saveDeliveryFee()">Simpan ongkir</button>' +
    '<div class="switch-row"><span>Gratis ongkir bila bayar pakai saldo</span><label class="switch"><input type="checkbox" ' + (settings.freeShippingBalance ? 'checked' : '') + ' onchange="toggleFreeShipping(this.checked)"><span class="slider"></span></label></div>' +
    '<div class="switch-row"><span>Toko Buka / Tutup</span><label class="switch"><input type="checkbox" ' + (isStoreOpen() ? 'checked' : '') + ' onchange="toggleStoreOpen(this.checked)"><span class="slider"></span></label></div>' +
    '<p class="muted">Saat ini: <b>' + (isStoreOpen() ? 'Buka' : 'Tutup') + '</b> · Gratis ongkir saldo: <b>' + (settings.freeShippingBalance ? 'Aktif' : 'Mati') + '</b></p></div>';
}
async function saveSettingsPatch(patch) {
  try { var s = await api('/settings', { method: 'POST', body: patch }); if (s) settings = s; toast('Pengaturan tersimpan.'); render(); }
  catch (err) { toast('Gagal menyimpan pengaturan: ' + err.message, false); }
}
async function saveDeliveryFee() { var v = Number(($('feeInput') || {}).value); if (isNaN(v) || v < 0) { toast('Nominal ongkir tidak valid.', false); return; } await saveSettingsPatch({ deliveryFee: v }); }
async function toggleFreeShipping(on) { await saveSettingsPatch({ freeShippingBalance: !!on }); }
async function toggleStoreOpen(on) { await saveSettingsPatch({ storeOpen: on ? 1 : 0 }); }

// FITUR: Barang admin — +Barang (foto + pratinjau, harga spesial saldo), ubah/sembunyikan
function renderAdminProducts(view) {
  var formTitle = productEditId ? 'Ubah Barang' : '+Barang';
  view.innerHTML = '<h1>Barang</h1><div class="card"><h2>' + formTitle + '</h2><form onsubmit="submitProduct(event)">' +
    '<label>Nama barang</label><input id="prodName" required>' +
    '<label>Harga (Rp)</label><input id="prodPrice" type="number" min="0" required>' +
    '<label>Harga spesial bayar pakai saldo (Rp, opsional)</label><input id="prodSpecial" type="number" min="0" placeholder="Kosongkan bila sama dengan harga normal">' +
    '<label>Stok</label><input id="prodStock" type="number" min="0" required>' +
    '<label>Kategori</label><input id="prodCategory" placeholder="cth. Sembako">' +
    '<label>Foto barang</label><input type="file" accept="image/*" onchange="onProductImageChange(this)">' +
    '<div id="prodPreview" class="img-preview"></div>' +
    '<button type="submit" class="btn btn-block">Simpan</button>' +
    (productEditId ? '<button type="button" class="btn btn-secondary btn-block" onclick="productEditId=null;pendingProductImage=null;render()">Batal ubah</button>' : '') +
    '</form></div>' +
    '<div id="productList">' + products.map(function (p) {
      return '<div class="card"><div class="row-between"><b>' + esc(p.name) + '</b><span class="status-pill">' + (p.visible === 0 || p.visible === false ? 'Disembunyikan' : 'Tampil') + '</span></div>' +
        '<p>' + fmtRp(p.price) + (p.specialPrice ? ' · Harga saldo: ' + fmtRp(p.specialPrice) : '') + ' · Stok: ' + esc(p.stock) + (p.category ? ' · ' + esc(p.category) : '') + '</p>' +
        '<div class="row"><button type="button" class="btn btn-secondary btn-small" onclick="editProduct(' + p.id + ')">Ubah</button>' +
        '<button type="button" class="btn btn-secondary btn-small" onclick="toggleProductVisible(' + p.id + ',' + (p.visible === 0 || p.visible === false ? 1 : 0) + ')">' + (p.visible === 0 || p.visible === false ? 'Tampilkan' : 'Sembunyikan') + '</button></div></div>';
    }).join('') + '</div>';
  if (productEditId) {
    var p = findProduct(productEditId);
    if (p) { $('prodName').value = p.name || ''; $('prodPrice').value = p.price || 0; $('prodSpecial').value = p.specialPrice || ''; $('prodStock').value = p.stock || 0; $('prodCategory').value = p.category || ''; if (p.image) $('prodPreview').innerHTML = '<img src="' + esc(p.image) + '" alt="Foto barang">'; }
  }
}
function onProductImageChange(input) {
  var f = input.files && input.files[0]; if (!f) return;
  var r = new FileReader();
  r.onload = function () { pendingProductImage = r.result; var pv = $('prodPreview'); if (pv) pv.innerHTML = '<img src="' + esc(pendingProductImage) + '" alt="Pratinjau foto barang">'; };
  r.readAsDataURL(f);
}
function editProduct(id) { productEditId = id; pendingProductImage = null; render(); }
async function toggleProductVisible(id, visible) {
  try { await api('/products/' + id, { method: 'PUT', body: { visible: visible } }); toast(visible ? 'Barang ditampilkan.' : 'Barang disembunyikan.'); render(); }
  catch (err) { toast('Gagal mengubah barang: ' + err.message, false); }
}
async function submitProduct(e) {
  e.preventDefault();
  var body = {
    name: $('prodName').value.trim(),
    price: Number($('prodPrice').value) || 0,
    specialPrice: $('prodSpecial').value ? Number($('prodSpecial').value) : undefined,
    stock: Number($('prodStock').value) || 0,
    category: $('prodCategory').value.trim() || undefined,
    image: pendingProductImage || undefined
  };
  if (!body.name) { toast('Nama barang wajib diisi.', false); return; }
  try {
    if (productEditId) await api('/products/' + productEditId, { method: 'PUT', body: body });
    else await api('/products', { method: 'POST', body: body });
    toast(productEditId ? 'Barang berhasil diubah.' : 'Barang berhasil ditambahkan.');
    productEditId = null; pendingProductImage = null; render();
  } catch (err) { toast('Gagal menyimpan barang: ' + err.message, false); }
}

// FITUR: Pesanan admin — cari tanggal & jam antar/ambil, ubah status, cetak struk
async function renderAdminOrders(view) {
  var q = '';
  if (adminOrderFilter.date) q += (q ? '&' : '?') + 'date=' + encodeURIComponent(adminOrderFilter.date);
  if (adminOrderFilter.slot) q += (q ? '&' : '?') + 'slot=' + encodeURIComponent(adminOrderFilter.slot);
  var orders = [];
  try { orders = await api('/orders' + q); } catch (e) { toast('Gagal memuat pesanan: ' + e.message, false); }
  if (!Array.isArray(orders)) orders = [];
  view.innerHTML = '<h1>Pesanan</h1><div class="card"><h2>Pencarian</h2>' +
    '<label>Tanggal pesanan</label><input id="ordDate" type="date" value="' + esc(adminOrderFilter.date) + '">' +
    '<label>Jam antar / ambil</label><select id="ordSlot"><option value="">Semua jam</option>' + SLOTS.map(function (s) { return '<option ' + (adminOrderFilter.slot === s ? 'selected' : '') + '>' + s + '</option>'; }).join('') + '</select>' +
    '<button type="button" class="btn btn-block" onclick="applyOrderFilter()">Cari</button>' +
    '<button type="button" class="btn btn-secondary btn-block" onclick="adminOrderFilter={date:\'\',slot:\'\'};render()">Reset</button></div>' +
    (orders.length ? orders.map(function (o) {
      var status = o.status || 'Baru';
      var next = status === 'Baru' ? 'Diproses' : (status === 'Diproses' ? 'Selesai' : null);
      var itemsTxt = (o.items || []).map(function (it) { var p = findProduct(it.productId); return (p ? p.name : 'Barang #' + it.productId) + ' × ' + it.qty; }).join(', ');
      return '<div class="card"><div class="row-between"><b>Pesanan #' + esc(o.id) + '</b><span class="status-pill status-' + esc(status) + '">' + esc(status) + '</span></div>' +
        '<p class="muted">' + fmtDate(o.createdAt || o.date) + ' · ' + esc(o.method === 'antar' ? 'Diantar' : 'Ambil') + ' · ' + esc(o.slot || '') + ' · ' + esc(o.payment === 'saldo' ? 'Saldo' : 'Tunai') + '</p>' +
        '<p>' + esc(itemsTxt) + '</p><p><b>Total: ' + fmtRp(o.total) + '</b>' + (o.note ? '<br><span class="muted">Catatan: ' + esc(o.note) + '</span>' : '') + '</p>' +
        '<div class="row">' + (next ? '<button type="button" class="btn btn-small" onclick="setOrderStatus(' + o.id + ',\'' + next + '\')">Ubah ke ' + next + '</button>' : '') +
        '<button type="button" class="btn btn-secondary btn-small" onclick="window.open(\'/api/orders/' + o.id + '/struk\',\'_blank\')">Cetak struk</button></div></div>';
    }).join('') : '<div class="card"><p>Tidak ada pesanan untuk pencarian ini.</p></div>');
}
function applyOrderFilter() { adminOrderFilter = { date: ($('ordDate') || {}).value || '', slot: ($('ordSlot') || {}).value || '' }; render(); }
async function setOrderStatus(id, status) {
  try { await api('/orders/' + id + '/status', { method: 'POST', body: { status: status } }); toast('Status pesanan diubah ke ' + status + '.'); render(); }
  catch (err) { toast('Gagal mengubah status: ' + err.message, false); }
}

// FITUR: Warga admin — setujui/tolak (kotak alasan), riwayat transaksi
async function renderAdminWarga(view) {
  var list = [];
  try { list = await api('/admin/warga'); } catch (e) { toast('Gagal memuat warga: ' + e.message, false); }
  if (!Array.isArray(list)) list = [];
  view.innerHTML = '<h1>Warga</h1>' + (list.length ? list.map(function (w) {
    var st = w.status || '';
    return '<div class="card"><b>' + esc(w.name) + '</b> <span class="status-pill">' + esc(st) + '</span>' +
      '<p class="muted">' + esc(w.phone) + ' · Blok ' + esc(w.blok) + ' No. ' + esc(w.houseNo) + (rejectReason(w) ? '<br>Alasan ditolak: ' + esc(rejectReason(w)) : '') + '</p>' +
      '<div class="row">' +
      (isPending(w) ? '<button type="button" class="btn btn-small" onclick="approveWarga(' + w.id + ')">Setujui</button>' +
        '<button type="button" class="btn btn-danger btn-small" onclick="rejectWarga(' + w.id + ')">Tolak</button>' : '') +
      (isApproved(w) ? '<button type="button" class="btn btn-secondary btn-small" onclick="showWargaHistory(' + w.id + ')">Riwayat transaksi</button>' : '') +
      '</div></div>';
  }).join('') : '<div class="card"><p>Belum ada warga terdaftar.</p></div>');
}
async function approveWarga(id) {
  try { await api('/admin/warga/' + id + '/approve', { method: 'POST', body: {} }); toast('Pendaftaran warga disetujui.'); render(); }
  catch (err) { toast('Gagal menyetujui: ' + err.message, false); }
}
function rejectWarga(id) {
  openReasonModal('Tolak pendaftaran warga', async function (reason) {
    try { await api('/admin/warga/' + id + '/reject', { method: 'POST', body: { reason: reason } }); toast('Pendaftaran warga ditolak.'); render(); }
    catch (err) { toast('Gagal menolak: ' + err.message, false); }
  });
}
async function showWargaHistory(id) {
  try {
    var h = await api('/admin/warga/' + id + '/history');
    var w = h.warga || {};
    var orders = h.orders || [], topups = h.topups || [];
    openModal('<h2>Riwayat — ' + esc(w.name || ('Warga #' + id)) + '</h2>' +
      '<p><b>Total belanja: ' + fmtRp(h.totalSpent) + '</b></p>' +
      '<h3>Pesanan (' + orders.length + ')</h3>' + (orders.length ? orders.map(function (o) { return '<div class="list-item">' + fmtDate(o.createdAt || o.date) + ' · ' + esc(o.status || '') + ' · <b>' + fmtRp(o.total) + '</b></div>'; }).join('') : '<p class="muted">Belum ada pesanan.</p>') +
      '<h3>Top-up (' + topups.length + ')</h3>' + (topups.length ? topups.map(function (t) { return '<div class="list-item">' + fmtDate(t.createdAt) + ' · ' + fmtRp(t.amount) + ' · ' + esc(t.method || '') + ' · ' + esc(t.status || '') + '</div>'; }).join('') : '<p class="muted">Belum ada top-up.</p>'));
  } catch (err) { toast('Gagal memuat riwayat: ' + err.message, false); }
}

// FITUR: Top-up admin — setujui/tolak pengajuan menunggu (penolakan pakai alasan)
async function renderAdminTopup(view) {
  var list = [];
  try { list = await api('/topup/pending'); } catch (e) { toast('Gagal memuat top-up: ' + e.message, false); }
  if (!Array.isArray(list)) list = [];
  view.innerHTML = '<h1>Top-up Menunggu</h1>' + (list.length ? list.map(function (t) {
    return '<div class="card"><b>' + fmtRp(t.amount) + '</b> <span class="status-pill">' + esc(t.method || '') + '</span>' +
      '<p class="muted">' + esc(t.wargaName || t.name || ('Warga #' + t.wargaId)) + ' · ' + fmtDate(t.createdAt) + '</p>' +
      '<div class="row"><button type="button" class="btn btn-small" onclick="approveTopup(' + t.id + ')">Setujui</button>' +
      '<button type="button" class="btn btn-danger btn-small" onclick="rejectTopup(' + t.id + ')">Tolak</button></div></div>';
  }).join('') : '<div class="card"><p>Tidak ada pengajuan top-up yang menunggu.</p></div>');
}
async function approveTopup(id) {
  try { await api('/topup/' + id + '/approve', { method: 'POST', body: {} }); toast('Top-up disetujui, saldo warga bertambah.'); render(); }
  catch (err) { toast('Gagal menyetujui top-up: ' + err.message, false); }
}
function rejectTopup(id) {
  openReasonModal('Tolak top-up', async function (reason) {
    try { await api('/topup/' + id + '/reject', { method: 'POST', body: { reason: reason } }); toast('Top-up ditolak.'); render(); }
    catch (err) { toast('Gagal menolak top-up: ' + err.message, false); }
  });
}

// FITUR: Chat admin — daftar percakapan + lencana belum dibaca, kirim teks/gambar
async function renderAdminChat(view) {
  if (adminChatWargaId) { await renderAdminChatThread(view, adminChatWargaId); return; }
  var threads = [];
  try { threads = await api('/chat/threads'); } catch (e) { toast('Gagal memuat chat: ' + e.message, false); }
  if (!Array.isArray(threads)) threads = [];
  view.innerHTML = '<h1>Chat Warga</h1>' + (threads.length ? threads.map(function (t) {
    return '<div class="card" style="cursor:pointer" onclick="adminChatWargaId=' + t.wargaId + ';render()"><div class="row-between"><b>' + esc(t.wargaName || ('Warga #' + t.wargaId)) + '</b>' +
      (Number(t.unreadAdmin) > 0 ? '<span class="badge-inline">' + t.unreadAdmin + '</span>' : '') + '</div>' +
      '<p class="muted">' + esc(t.lastMessage || '') + '</p></div>';
  }).join('') : '<div class="card"><p>Belum ada percakapan.</p></div>');
}
async function renderAdminChatThread(view, wargaId) {
  var data = { messages: [] };
  try { data = await api('/chat/' + wargaId); } catch (e) { toast('Gagal memuat chat: ' + e.message, false); }
  var msgs = data.messages || [];
  var name = '';
  try { var threads = await api('/chat/threads'); var th = (threads || []).find(function (t) { return String(t.wargaId) === String(wargaId); }); if (th) name = th.wargaName || ''; } catch (e) {}
  view.innerHTML = '<button type="button" class="btn btn-secondary btn-small" onclick="adminChatWargaId=null;render()">← Semua chat</button>' +
    '<h1>Chat — ' + esc(name || ('Warga #' + wargaId)) + '</h1><div class="card"><div class="chat-box">' +
    (msgs.length ? msgs.map(function (m) {
      var mine = m.sender === 'admin';
      return '<div class="bubble' + (mine ? ' mine' : '') + '">' + (m.text ? esc(m.text) : '') + (m.image ? '<img src="' + esc(m.image) + '" alt="Gambar chat">' : '') +
        '<div class="muted" style="font-size:11px">' + fmtDate(m.createdAt) + '</div></div>';
    }).join('') : '<p class="muted">Belum ada pesan.</p>') + '</div>' +
    '<div id="chatPreview" class="img-preview"></div>' +
    '<div class="chat-input-row"><label class="btn btn-secondary btn-small" style="padding:9px 12px">📎<input type="file" accept="image/*" hidden onchange="onChatImageChange(this)"></label>' +
    '<input type="text" id="chatText" placeholder="Tulis balasan..." onkeydown="if(event.key===\'Enter\')sendAdminChat()">' +
    '<button type="button" class="btn" onclick="sendAdminChat()">Kirim</button></div></div>';
  try { await api('/chat/' + wargaId + '/read', { method: 'POST', body: { by: 'admin' } }); unreadAdminTotal = 0; renderNav(); } catch (e) {}
  stopChatPoll();
  chatPoll = setInterval(async function () { if (mode === 'admin' && adminTab === 'chat' && adminChatWargaId) { var v = $('view'); if (v) await renderAdminChatThread(v, adminChatWargaId); } }, 10000);
}
async function sendAdminChat() { if (adminChatWargaId) await sendChat('admin', adminChatWargaId); }

// ---------- Start ----------
document.addEventListener('DOMContentLoaded', render);
render();
