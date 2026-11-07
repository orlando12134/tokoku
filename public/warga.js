/* tokoku — aplikasi WARGA (vanilla JS, tanpa framework / CDN).
   Hanya fitur warga: daftar/log in, belanja, keranjang, pesanan, saldo /
   top-up + QRIS, chat, akun. Tidak ada menu Admin di sini.
   Semua pemanggilan fetch mengikuti kontrak API di /api (lihat server).
   Komentar "// FITUR: ..." menandai blok fitur agar mudah di-porting. */
'use strict';

var WARGA_TABS = [['belanja', 'Belanja'], ['keranjang', 'Keranjang'], ['pesanan', 'Pesanan'], ['saldo', 'Saldo'], ['chat', 'Chat'], ['akun', 'Akun']];

// ---------- State ----------
var warga = null; // {id,name,phone,blok,houseNo,status,rejectReason,...}
var cart = [];    // [{productId, qty}]
var wargaTab = 'belanja';
var authView = 'login'; // 'login' | 'register'
var unreadWarga = 0;
var lastChatKey = '';

try {
  warga = JSON.parse(localStorage.getItem('tokoku_warga') || 'null');
  cart = JSON.parse(localStorage.getItem('tokoku_cart') || '[]');
} catch (e) { warga = null; cart = []; }
function saveLocal() {
  try {
    localStorage.setItem('tokoku_warga', JSON.stringify(warga));
    localStorage.setItem('tokoku_cart', JSON.stringify(cart));
  } catch (e) {}
}

function isApproved(w) { if (!w) return false; var s = String(w.status || '').toLowerCase(); return s === 'approved' || s === 'verified' || s === 'active' || w.approved === 1 || w.approved === true || w.verified === 1; }
function isPending(w) { if (!w) return false; var s = String(w.status || '').toLowerCase(); return s === 'pending' || s === 'menunggu' || s === 'waiting'; }
function isRejected(w) { if (!w) return false; var s = String(w.status || '').toLowerCase(); return s === 'rejected' || s === 'ditolak'; }
function rejectReason(w) { return (w && (w.rejectReason || w.rejectionReason || w.reason)) || ''; }

// FITUR: segarkan data warga dari server tiap render — supaya status yang
// berubah di sisi admin (disetujui/ditolak) langsung terlihat tanpa log in ulang.
async function refreshWarga() {
  if (!warga || !warga.phone) return;
  try {
    var r = await api('/login', { method: 'POST', body: { phone: warga.phone } });
    if (r.found && r.warga) { warga = r.warga; saveLocal(); }
  } catch (e) {}
}

function setTab(t) {
  wargaTab = t;
  stopChatPoll(); render();
}

// FITUR: lencana pesan belum dibaca (warga)
async function refreshUnread() {
  unreadWarga = 0;
  try {
    if (warga && warga.id) {
      var c = await api('/chat/' + warga.id);
      unreadWarga = (c && c.unreadWarga) || 0;
    }
  } catch (e) {}
}

async function render() {
  await loadSettings();
  await loadProducts();
  await refreshWarga(); // status warga bisa berubah di server (disetujui/ditolak admin)
  var ss = $('storeStatus');
  if (ss) { ss.textContent = isStoreOpen() ? 'Toko Buka' : 'Toko Tutup'; ss.classList.toggle('closed', !isStoreOpen()); }
  await refreshUnread();
  renderNav();
  var view = $('view');
  if (!warga || !isApproved(warga)) { renderAuth(view); }
  else if (wargaTab === 'belanja') renderShop(view);
  else if (wargaTab === 'keranjang') renderCartView(view);
  else if (wargaTab === 'pesanan') await renderWargaOrders(view);
  else if (wargaTab === 'saldo') await renderSaldo(view);
  else if (wargaTab === 'chat') await renderWargaChat(view);
  else if (wargaTab === 'akun') renderAccount(view);
  updateCartBar();
}

function renderNav() {
  var nav = $('bottomNav'); if (!nav) return;
  nav.innerHTML = WARGA_TABS.map(function (t) {
    var badge = '';
    if (t[0] === 'chat' && unreadWarga > 0) badge = '<span class="badge">' + unreadWarga + '</span>';
    if (t[0] === 'keranjang' && cart.length > 0) badge = '<span class="badge">' + cart.reduce(function (a, c) { return a + c.qty; }, 0) + '</span>';
    return '<button type="button" class="' + (wargaTab === t[0] ? 'active' : '') + '" onclick="setTab(\'' + t[0] + '\')">' + badge + esc(t[1]) + '</button>';
  }).join('');
}

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
  if (!warga || !isApproved(warga) || wargaTab !== 'belanja' || cart.length === 0 || !isStoreOpen()) { bar.hidden = true; bar.innerHTML = ''; return; }
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
    // PERBAIKAN: status server lowercase ('baru'); bandingkan lowercase,
    // tampilkan label kapital (sebelumnya tombol Batalkan tidak pernah muncul).
    var rawStatus = orderStatusRaw(o.status);
    var status = orderStatusLabel(rawStatus);
    // PERBAIKAN: items dari API berupa JSON string (kolom TEXT SQLite).
    var itemsTxt = parseItems(o.items).map(function (it) { var p = findProduct(it.productId); return (p ? p.name : 'Barang #' + it.productId) + ' × ' + it.qty; }).join(', ');
    html += '<div class="card"><div class="row-between"><b>Pesanan #' + esc(o.id) + '</b><span class="status-pill status-' + esc(status) + '">' + esc(status) + '</span></div>' +
      '<p class="muted">' + fmtDate(o.createdAt || o.date) + ' · ' + esc(o.method === 'antar' ? 'Diantar' : 'Ambil di toko') + ' · ' + esc(o.slot || '') + ' · ' + esc(o.payment === 'saldo' ? 'Saldo' : 'Tunai') + '</p>' +
      '<p>' + esc(itemsTxt) + '</p><p><b>Total: ' + fmtRp(o.total) + '</b></p>' +
      (rawStatus === 'baru' ? '<button type="button" class="btn btn-danger btn-small" onclick="cancelOrder(' + o.id + ')">Batalkan pesanan</button>' : '') +
      (rawStatus === 'diproses' ? '<p class="muted">Pesanan sedang diproses, tidak bisa dibatalkan.</p>' : '') + '</div>';
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
  lastChatKey = msgs.map(function (m) { return m.id; }).join(',');
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
  // Perbarui hanya bila ada pesan baru — supaya teks yang sedang diketik tidak hilang tiap 10 detik
  chatPoll = setInterval(async function () {
    if (wargaTab !== 'chat') return;
    try {
      var d = await api('/chat/' + warga.id);
      var key = (d.messages || []).map(function (m) { return m.id; }).join(',');
      if (key !== lastChatKey) { var v = $('view'); if (v) await renderWargaChat(v); }
    } catch (e) {}
  }, 10000);
}
async function sendWargaChat() { await sendChat('warga', warga.id); }

function renderAccount(view) {
  view.innerHTML = '<h1>Akun Saya</h1><div class="card">' +
    '<p><b>' + esc(warga.name) + '</b><br>' + esc(warga.phone) + '<br>Blok ' + esc(warga.blok) + ' No. ' + esc(warga.houseNo) + '<br>Status: ' + esc(warga.status || 'terverifikasi') + '</p>' +
    '<button type="button" class="btn btn-secondary btn-block" onclick="logout()">Log Out</button></div>';
}

// ---------- Start ----------
document.addEventListener('DOMContentLoaded', render);
render();
