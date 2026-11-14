/* tokoku — aplikasi ADMIN (vanilla JS, tanpa framework / CDN).
   Hanya fitur admin: verifikasi warga, kelola barang + foto, persetujuan
   top-up, pesanan + cetak struk + pencarian, pengaturan ongkir / gratis
   ongkir saldo, buka/tutup toko, chat, riwayat warga. Tidak ada tampilan
   warga di sini. Semua pemanggilan fetch mengikuti kontrak API di /api.
   Komentar "// FITUR: ..." menandai blok fitur agar mudah di-porting. */
'use strict';

var ADMIN_TABS = [['beranda', 'Beranda'], ['barang', 'Barang'], ['pesanan', 'Pesanan'], ['warga', 'Warga'], ['topup', 'Top-up'], ['chat', 'Chat']];

// ---------- State ----------
var adminTab = 'beranda';
var unreadAdminTotal = 0;
var pendingProductImage = null;
var productEditId = null;
var adminChatWargaId = null;
var adminOrderFilter = { date: '', slot: '' };
var lastAdminChatKey = '';
// FITUR: Bukti pembayaran top-up — peta id top-up -> data URL bukti,
// diisi saat daftar top-up / riwayat dimuat; dipakai showTopupProof().
var lastTopupProofs = {};
// FITUR: Live update tanpa refresh — polling 10 detik, snapshot terakhir
// tiap tab; tampilan hanya diperbarui bila data benar-benar berubah.
var liveTimer = null;
// FITUR: Performa 2026-11-14 — penjaga tumpang-tindih polling: bila satu
// siklus polling belum selesai (server lambat), siklus berikutnya dilewati
// supaya request tidak menumpuk di server.
var pollBusy = false;
var lastLive = { home: '', orders: '', warga: '', topups: '', threads: '', products: '', settings: '', unread: null };

function isApproved(w) { if (!w) return false; var s = String(w.status || '').toLowerCase(); return s === 'approved' || s === 'verified' || s === 'active' || w.approved === 1 || w.approved === true || w.verified === 1; }
function isPending(w) { if (!w) return false; var s = String(w.status || '').toLowerCase(); return s === 'pending' || s === 'menunggu' || s === 'waiting'; }
function rejectReason(w) { return (w && (w.rejectReason || w.rejectionReason || w.reason)) || ''; }

function setTab(t) {
  adminTab = t;
  render();
}

// FITUR: lencana pesan belum dibaca (admin — total semua thread). Pakai
// loadThreads (lite) supaya tidak mengunduh ulang foto warga tiap render.
async function refreshUnread() {
  unreadAdminTotal = 0;
  try {
    var threads = await loadThreads();
    (threads || []).forEach(function (t) { unreadAdminTotal += Number(t.unreadAdmin) || 0; });
  } catch (e) {}
}

async function render() {
  // FITUR: Performa — tiga fetch independen dijalankan PARALEL; sebelumnya
  // berurutan sehingga satu klik menu menunggu 4-6 detik. Produk memakai
  // pola lite-dulu (loadProducts).
  await Promise.all([loadSettings(), loadProducts(), refreshUnread()]);
  var ss = $('storeStatus');
  if (ss) { ss.textContent = isStoreOpen() ? 'Toko Buka' : 'Toko Tutup'; ss.classList.toggle('closed', !isStoreOpen()); }
  await refreshUnread();
  renderNav();
  var view = $('view');
  if (adminTab === 'beranda') await renderAdminHome(view);
  else if (adminTab === 'barang') renderAdminProducts(view);
  else if (adminTab === 'pesanan') await renderAdminOrders(view);
  else if (adminTab === 'warga') await renderAdminWarga(view);
  else if (adminTab === 'topup') await renderAdminTopup(view);
  else if (adminTab === 'chat') await renderAdminChat(view);
  // FITUR: Layar loading awal — sembunyikan splash hijau setelah render pertama.
  hideSplash();
  // FITUR: Live update tanpa refresh — catat snapshot data saat ini.
  // FITUR: Performa — snapshot produk memakai kunci murah (tanpa bytes gambar).
  lastLive.products = productsKey();
  lastLive.settings = JSON.stringify(settings);
  lastLive.unread = unreadAdminTotal;
}

// FITUR: Live update tanpa refresh — polling tiap 10 detik untuk data tab
// yang sedang dibuka. Hanya memperbarui tampilan bila data benar-benar
// berubah (banding JSON.stringify dengan snapshot terakhir); posisi scroll
// dijaga; input chat tidak disentuh (hanya kotak pesan yang diganti bila
// ada pesan baru); formulir yang sedang diisi tidak dibangun ulang.
// Tanpa WebSocket (server tidak mendukungnya).
function startLivePoll() {
  if (liveTimer) return;
  liveTimer = setInterval(pollLive, 10000);
}
async function pollLive() {
  if (pollBusy) return; // FITUR: Performa — jangan tumpuk siklus polling bila siklus sebelumnya belum selesai
  pollBusy = true;
  try {
    // FITUR: Performa — settings + thread chat paralel (sebelumnya berurutan).
    var prefix = await Promise.all([
      api('/settings').catch(function () { return null; }),
      loadThreads().catch(function () { return []; })
    ]);
    var ssLive = prefix[0];
    var threads = prefix[1] || [];
    // FITUR: Status toko live — poll /api/settings di SEMUA tab; bila
    // berubah, perbarui teks header tanpa refresh (dan saklar di Beranda
    // ikut diperbarui lewat kunci home di bawah, yang memakai settings
    // segar ini — sebelumnya kunci memakai settings basi dari render()).
    if (ssLive) {
      var ssKey = JSON.stringify(ssLive);
      if (ssKey !== lastLive.settings) {
        settings = ssLive;
        lastLive.settings = ssKey;
        var ssEl = $('storeStatus');
        if (ssEl) { ssEl.textContent = isStoreOpen() ? 'Toko Buka' : 'Toko Tutup'; ssEl.classList.toggle('closed', !isStoreOpen()); }
      }
    }
    var un = 0;
    (threads || []).forEach(function (t) { un += Number(t.unreadAdmin) || 0; });
    if (un !== lastLive.unread) { unreadAdminTotal = un; lastLive.unread = un; renderNav(); }
    if (adminTab === 'beranda') {
      // FITUR: Performa — pesanan + top-up + warga paralel (sebelumnya berurutan).
      var homeData = await Promise.all([
        loadOrderList('/orders', ''),
        api('/topup/pending').catch(function () { return []; }),
        loadWargaList()
      ]);
      var orders = homeData[0] || [];
      var topups = homeData[1] || [];
      var wargaList = homeData[2] || [];
      var key = JSON.stringify([ordersKey(orders), topupsKey(topups), wargaKey(wargaList), productsKey(), settings]);
      if (key !== lastLive.home) {
        lastLive.home = key;
        if (viewHasFormFocus()) return; // jangan hapus isian ongkir yang sedang diketik
        await preserveScroll(function () { return renderAdminHome($('view')); });
      }
    } else if (adminTab === 'barang') {
      await loadProducts();
      if (productsKey() !== lastLive.products) {
        lastLive.products = productsKey();
        if (productEditId) return; // sedang ubah barang — jangan bangun ulang form
        if (viewHasFormFocus()) return;
        await preserveScroll(function () { renderAdminProducts($('view')); });
      }
    } else if (adminTab === 'pesanan') {
      var q = '';
      if (adminOrderFilter.date) q += (q ? '&' : '?') + 'date=' + encodeURIComponent(adminOrderFilter.date);
      if (adminOrderFilter.slot) q += (q ? '&' : '?') + 'slot=' + encodeURIComponent(adminOrderFilter.slot);
      var ords = await loadOrderList('/orders', q);
      var ok = ordersKey(ords);
      if (ok !== lastLive.orders) {
        lastLive.orders = ok;
        await preserveScroll(function () { return renderAdminOrders($('view')); });
      }
    } else if (adminTab === 'warga') {
      var wl = await loadWargaList();
      var wk = wargaKey(wl);
      if (wk !== lastLive.warga) {
        lastLive.warga = wk;
        await preserveScroll(function () { return renderAdminWarga($('view')); });
      }
    } else if (adminTab === 'topup') {
      var tp = await api('/topup/pending');
      var tk = topupsKey(tp);
      if (tk !== lastLive.topups) {
        lastLive.topups = tk;
        await preserveScroll(function () { return renderAdminTopup($('view')); });
      }
    } else if (adminTab === 'chat') {
      if (adminChatWargaId) {
        var d = await loadChat(adminChatWargaId);
        var key2 = (d.messages || []).map(function (m) { return m.id; }).join(',');
        if (key2 !== lastAdminChatKey) {
          lastAdminChatKey = key2;
          var box = $('chatBox');
          if (box) {
            var nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
            box.innerHTML = chatBubblesHtml(d.messages || [], 'admin') || '<p class="muted">Belum ada pesan.</p>';
            if (nearBottom) box.scrollTop = box.scrollHeight;
          }
        }
      } else {
        var th = threadsKey(threads);
        if (th !== lastLive.threads) {
          lastLive.threads = th;
          await preserveScroll(function () { return renderAdminChat($('view')); });
        }
      }
    }
  } catch (e) { /* polling gagal sesaat — coba lagi 10 detik berikut */ }
  finally { pollBusy = false; }
}

function renderNav() {
  var nav = $('bottomNav'); if (!nav) return;
  nav.innerHTML = ADMIN_TABS.map(function (t) {
    var badge = '';
    if (t[0] === 'chat' && unreadAdminTotal > 0) badge = '<span class="badge">' + unreadAdminTotal + '</span>';
    return '<button type="button" class="' + (adminTab === t[0] ? 'active' : '') + '" onclick="setTab(\'' + t[0] + '\')">' + badge + esc(t[1]) + '</button>';
  }).join('');
}

// FITUR: Beranda admin — antrean, ongkir, gratis ongkir saldo, toko buka/tutup
async function renderAdminHome(view) {
  var orders = [], topups = [], wargaList = [];
  // FITUR: Performa — tiga fetch independen paralel (sebelumnya berurutan).
  var homeData = await Promise.all([
    loadOrderList('/orders', ''),
    api('/topup/pending').catch(function () { return []; }),
    loadWargaList()
  ]);
  orders = homeData[0] || [];
  topups = homeData[1] || [];
  wargaList = homeData[2] || [];
  if (!Array.isArray(orders)) orders = [];
  if (!Array.isArray(topups)) topups = [];
  if (!Array.isArray(wargaList)) wargaList = [];
  // FITUR: Performa — kunci home memakai kunci murah (tanpa bytes gambar).
  lastLive.home = JSON.stringify([ordersKey(orders), topupsKey(topups), wargaKey(wargaList), productsKey(), settings]);
  var newOrders = orders.filter(function (o) { return orderStatusRaw(o.status) === 'baru'; }).length;
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
  // FITUR: Foto diperkecil sebelum dikirim — lihat readImageFile.
  readImageFile(f, 1000, 0.85, function (dataUrl) {
    if (!dataUrl) return;
    pendingProductImage = dataUrl; var pv = $('prodPreview'); if (pv) pv.innerHTML = '<img src="' + esc(pendingProductImage) + '" alt="Pratinjau foto barang">';
  });
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
    productEditId = null; pendingProductImage = null;
    // FITUR: Performa — foto barang mungkin berubah: muat ulang penuh sekali
    // supaya cache gambar diperbarui, baru render.
    await loadProducts(true); render();
  } catch (err) { toast('Gagal menyimpan barang: ' + err.message, false); }
}

// FITUR: Pesanan admin — cari tanggal & jam antar/ambil, ubah status, cetak struk
async function renderAdminOrders(view) {
  var q = '';
  if (adminOrderFilter.date) q += (q ? '&' : '?') + 'date=' + encodeURIComponent(adminOrderFilter.date);
  if (adminOrderFilter.slot) q += (q ? '&' : '?') + 'slot=' + encodeURIComponent(adminOrderFilter.slot);
  var orders = [];
  try { orders = await loadOrderList('/orders', q); } catch (e) { toast('Gagal memuat pesanan: ' + e.message, false); }
  if (!Array.isArray(orders)) orders = [];
  lastLive.orders = ordersKey(orders);
  view.innerHTML = '<h1>Pesanan</h1><div class="card"><h2>Pencarian</h2>' +
    '<label>Tanggal pesanan</label><input id="ordDate" type="date" value="' + esc(adminOrderFilter.date) + '">' +
    '<label>Jam antar / ambil</label><select id="ordSlot"><option value="">Semua jam</option>' + SLOTS.map(function (s) { return '<option ' + (adminOrderFilter.slot === s ? 'selected' : '') + '>' + s + '</option>'; }).join('') + '</select>' +
    '<button type="button" class="btn btn-block" onclick="applyOrderFilter()">Cari</button>' +
    '<button type="button" class="btn btn-secondary btn-block" onclick="adminOrderFilter={date:\'\',slot:\'\'};render()">Reset</button></div>' +
    (orders.length ? orders.map(function (o) {
      // PERBAIKAN: status server lowercase ('baru'); kirim lowercase ke server,
      // tampilkan label kapital (sebelumnya tombol Ubah status selalu ditolak server).
      var rawStatus = orderStatusRaw(o.status);
      var status = orderStatusLabel(rawStatus);
      var next = rawStatus === 'baru' ? { send: 'diproses', label: 'Diproses' } : (rawStatus === 'diproses' ? { send: 'selesai', label: 'Selesai' } : null);
      // FITUR: Gambar barang di pesanan — dari snapshot di data pesanan
      // (orderItemsHtml), tetap tampil walau barang diubah/dihapus admin.
      return '<div class="card"><div class="row-between"><b>Pesanan #' + esc(o.id) + '</b><span class="status-pill status-' + esc(status) + '">' + esc(status) + '</span></div>' +
        '<p class="muted">' + fmtDate(o.createdAt || o.date) + ' · ' + esc(o.method === 'antar' ? 'Diantar' : 'Ambil') + ' · ' + esc(o.slot || '') + ' · ' + esc(o.payment === 'saldo' ? 'Saldo' : 'Tunai') + '</p>' +
        orderItemsHtml(o.items) + '<p><b>Total: ' + fmtRp(o.total) + '</b>' + (o.note ? '<br><span class="muted">Catatan: ' + esc(o.note) + '</span>' : '') + '</p>' +
        '<div class="row">' + (next ? '<button type="button" class="btn btn-small" onclick="setOrderStatus(' + o.id + ',\'' + next.send + '\')">Ubah ke ' + next.label + '</button>' : '') +
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
  try { list = await loadWargaList(); } catch (e) { toast('Gagal memuat warga: ' + e.message, false); }
  if (!Array.isArray(list)) list = [];
  lastLive.warga = wargaKey(list);
  view.innerHTML = '<h1>Warga</h1>' + (list.length ? list.map(function (w) {
    var st = w.status || '';
    // FITUR: Foto profil warga — foto di daftar warga (termasuk yang
    // menunggu verifikasi); inisial bila warga belum pasang foto.
    return '<div class="card"><div class="warga-row">' + avatarHtml(w, 'avatar-sm') + '<div class="warga-info"><b>' + esc(w.name) + '</b> <span class="status-pill">' + esc(st) + '</span>' +
      '<p class="muted">' + esc(w.phone) + ' · Blok ' + esc(w.blok) + ' No. ' + esc(w.houseNo) + (rejectReason(w) ? '<br>Alasan ditolak: ' + esc(rejectReason(w)) : '') + '</p></div></div>' +
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
      // FITUR: Foto profil warga — foto (atau inisial) di riwayat warga.
      '<div class="warga-row">' + avatarHtml(w, 'avatar-lg') + '<div class="warga-info">' + esc(w.phone || '') + '<br>Blok ' + esc(w.blok || '') + ' No. ' + esc(w.houseNo || '') + '<br>Saldo: <b>' + fmtRp(w.balance || 0) + '</b></div></div>' +
      '<p><b>Total belanja: ' + fmtRp(h.totalSpent) + '</b></p>' +
      '<h3>Pesanan (' + orders.length + ')</h3>' + (orders.length ? orders.map(function (o) { return '<div class="list-item">' + fmtDate(o.createdAt || o.date) + ' · ' + esc(orderStatusLabel(o.status)) + ' · <b>' + fmtRp(o.total) + '</b></div>'; }).join('') : '<p class="muted">Belum ada pesanan.</p>') +
      '<h3>Top-up (' + topups.length + ')</h3>' + (topups.length ? topups.map(function (t) {
        // FITUR: Bukti pembayaran — tautan "Lihat bukti" bila ada.
        if (t.proof) lastTopupProofs[t.id] = t.proof;
        return '<div class="list-item">' + fmtDate(t.createdAt) + ' · ' + fmtRp(t.amount) + ' · ' + esc(t.method || '') + ' · ' + esc(t.status || '') + (t.proof ? ' · <button type="button" class="linklike" onclick="showTopupProof(' + t.id + ')">Lihat bukti</button>' : '') + '</div>';
      }).join('') : '<p class="muted">Belum ada top-up.</p>'));
  } catch (err) { toast('Gagal memuat riwayat: ' + err.message, false); }
}

// FITUR: Top-up admin — setujui/tolak pengajuan menunggu (penolakan pakai alasan)
// FITUR: Foto profil warga di kartu verifikasi + bukti pembayaran (2026-11-08)
async function renderAdminTopup(view) {
  var list = [];
  try { list = await api('/topup/pending'); } catch (e) { toast('Gagal memuat top-up: ' + e.message, false); }
  if (!Array.isArray(list)) list = [];
  lastLive.topups = topupsKey(list);
  view.innerHTML = '<h1>Top-up Menunggu</h1>' + (list.length ? list.map(function (t) {
    if (t.proof) lastTopupProofs[t.id] = t.proof;
    return '<div class="card"><div class="warga-row">' + avatarHtml({ name: t.wargaName, photo: t.wargaPhoto }, 'avatar-sm') + '<div class="warga-info"><b>' + fmtRp(t.amount) + '</b> <span class="status-pill">' + esc(t.method || '') + '</span>' +
      '<p class="muted">' + esc(t.wargaName || t.name || ('Warga #' + t.wargaId)) + ' · ' + fmtDate(t.createdAt) + '</p></div></div>' +
      (t.proof ? '<div class="proof-thumb"><img src="' + esc(t.proof) + '" alt="Bukti pembayaran" onclick="showTopupProof(' + t.id + ')"></div><p class="muted">Ketuk gambar untuk ukuran penuh.</p>' : '<p class="muted">Tanpa bukti pembayaran.</p>') +
      '<div class="row"><button type="button" class="btn btn-small" onclick="approveTopup(' + t.id + ')">Setujui</button>' +
      '<button type="button" class="btn btn-danger btn-small" onclick="rejectTopup(' + t.id + ')">Tolak</button></div></div>';
  }).join('') : '<div class="card"><p>Tidak ada pengajuan top-up yang menunggu.</p></div>');
}
// FITUR: Bukti pembayaran — tampilkan gambar bukti ukuran penuh di modal.
function showTopupProof(id) {
  var proof = lastTopupProofs[id];
  if (!proof) { toast('Bukti pembayaran tidak ditemukan.', false); return; }
  openModal('<h2>Bukti pembayaran</h2><img src="' + esc(proof) + '" alt="Bukti pembayaran" style="max-width:100%;border-radius:8px">');
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
  try { threads = await loadThreads(); } catch (e) { toast('Gagal memuat chat: ' + e.message, false); }
  if (!Array.isArray(threads)) threads = [];
  lastLive.threads = threadsKey(threads);
  view.innerHTML = '<h1>Chat Warga</h1>' + (threads.length ? threads.map(function (t) {
    // PERBAIKAN: lastMessage dari API berupa objek {text,image,...}, bukan string.
    var lm = t.lastMessage;
    var preview = !lm ? '' : (lm.text ? lm.text : (lm.image ? '📷 Gambar' : ''));
    // FITUR: Foto profil warga — foto (atau inisial) di daftar chat admin.
    return '<div class="card" style="cursor:pointer" onclick="adminChatWargaId=' + t.wargaId + ';render()"><div class="warga-row">' + avatarHtml({ name: t.wargaName, photo: t.wargaPhoto }, 'avatar-sm') + '<div class="warga-info"><div class="row-between"><b>' + esc(t.wargaName || ('Warga #' + t.wargaId)) + '</b>' +
      (Number(t.unreadAdmin) > 0 ? '<span class="badge-inline">' + t.unreadAdmin + '</span>' : '') + '</div>' +
      '<p class="muted">' + esc(preview) + '</p></div></div></div>';
  }).join('') : '<div class="card"><p>Belum ada percakapan.</p></div>');
}
async function renderAdminChatThread(view, wargaId) {
  var data = { messages: [] };
  var name = '';
  var threadPhoto = null;
  // FITUR: Performa — pesan + daftar thread paralel (sebelumnya berurutan).
  var threadData = await Promise.all([
    loadChat(wargaId).catch(function () { return { messages: [] }; }),
    loadThreads().catch(function () { return []; })
  ]);
  data = threadData[0] || { messages: [] };
  var threads = threadData[1] || [];
  var th = (threads || []).find(function (t) { return String(t.wargaId) === String(wargaId); });
  if (th) { name = th.wargaName || ''; threadPhoto = th.wargaPhoto || null; }
  var msgs = data.messages || [];
  lastAdminChatKey = msgs.map(function (m) { return m.id; }).join(',');
  view.innerHTML = '<button type="button" class="btn btn-secondary btn-small" onclick="adminChatWargaId=null;render()">← Semua chat</button>' +
    '<div class="warga-row" style="margin:10px 0">' + avatarHtml({ name: name, photo: threadPhoto }, 'avatar-sm') + '<h1 style="margin:0">Chat — ' + esc(name || ('Warga #' + wargaId)) + '</h1></div><div class="card"><div class="chat-box" id="chatBox">' +
    (msgs.length ? chatBubblesHtml(msgs, 'admin') : '<p class="muted">Belum ada pesan.</p>') + '</div>' +
    '<div id="chatPreview" class="img-preview"></div>' +
    '<div class="chat-input-row"><label class="btn btn-secondary btn-small" style="padding:9px 12px">📎<input type="file" accept="image/*" hidden onchange="onChatImageChange(this)"></label>' +
    '<input type="text" id="chatText" placeholder="Tulis balasan..." onkeydown="if(event.key===\'Enter\')sendAdminChat()">' +
    '<button type="button" class="btn" onclick="sendAdminChat()">Kirim</button></div></div>';
  try { await api('/chat/' + wargaId + '/read', { method: 'POST', body: { by: 'admin' } }); unreadAdminTotal = 0; renderNav(); } catch (e) {}
  // FITUR: Live update tanpa refresh — polling chat ditangani polling global
  // 10 detik (pollLive): hanya kotak pesan yang diganti bila ada pesan baru,
  // input ketik tidak disentuh.
}
async function sendAdminChat() { if (adminChatWargaId) await sendChat('admin', adminChatWargaId); }

// ---------- Start ----------
// FITUR: Live update tanpa refresh — polling global tiap 10 detik.
document.addEventListener('DOMContentLoaded', render);
render();
startLivePoll();
