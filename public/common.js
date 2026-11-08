/* tokoku — kode bersama aplikasi Warga & Admin (dipakai kedua halaman).
   Berisi: panggilan API, util format, toast, modal, muat settings/produk,
   dan kirim chat (teks + gambar). Tidak ada logika mode di sini.
   Komentar "// FITUR: ..." menandai blok fitur agar mudah di-porting. */
'use strict';

var API = '/api';
var SLOTS = ['09.00-10.00', '11.00-12.00', '16.00-17.00', '19.00-20.00'];

// FITUR: PWA — daftarkan service worker minimal (tanpa cache) supaya
// syarat install "Tambahkan ke Layar utama" terpenuhi. Pendaftaran bersifat
// menjaga: hanya mendaftar bila berkas /sw.js benar-benar tersaji (cek HEAD
// dulu), dan gagal diam-diam bila tidak ada — aplikasi tetap jalan normal
// tanpa service worker.
(function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  fetch('/sw.js', { method: 'HEAD' }).then(function (r) {
    if (!r.ok) return;
    return navigator.serviceWorker.register('/sw.js');
  }).catch(function () { /* abaikan: aplikasi tetap jalan tanpa SW */ });
})();

// ---------- State bersama ----------
var settings = { deliveryFee: 2000, freeShippingBalance: false, storeOpen: 1 };
var products = [];
var chatPoll = null;
var pendingChatImage = null;
var reasonCb = null;

// ---------- Util ----------
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function fmtRp(n) { n = Number(n) || 0; return 'Rp' + n.toLocaleString('id-ID'); }
function fmtDate(d) { try { return new Date(d).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return String(d || ''); } }
function $(id) { return document.getElementById(id); }
function isStoreOpen() { return settings.storeOpen === 1 || settings.storeOpen === true || settings.storeOpen === '1'; }
// FITUR: daftar barang pesanan disimpan sebagai JSON string di SQLite —
// API mengembalikan apa adanya, jadi parse dulu sebelum dipakai.
// FITUR: status pesanan di server lowercase ('baru','diproses','selesai','dibatalkan');
// tampilkan dengan huruf kapital di UI.
var ORDER_STATUS_LABEL = { baru: 'Baru', diproses: 'Diproses', selesai: 'Selesai', dibatalkan: 'Dibatalkan' };
function orderStatusLabel(s) { return ORDER_STATUS_LABEL[String(s || '').toLowerCase()] || String(s || ''); }
function orderStatusRaw(s) { return String(s || 'baru').toLowerCase(); }
function parseItems(o) {
  if (Array.isArray(o)) return o;
  if (typeof o === 'string') { try { return JSON.parse(o); } catch (e) { return []; } }
  return [];
}

// FITUR: Perkecil foto sebelum dikirim (2026-11-08) — foto kamera HP
// ukuran penuh (3-4MB) melebihi batas body JSON server (~5MB setelah
// base64) sehingga gagal tersimpan dan foto profil tidak pernah muncul.
// Baca file, perkecil lewat canvas (sisi terpanjang maxDim, JPEG quality),
// lalu serahkan data URL hasilnya ke cb. Bila file sudah cukup kecil atau
// gagal diproses, cb dipanggil dengan data URL asli apa adanya.
function readImageFile(file, maxDim, quality, cb) {
  if (!file) { cb(null); return; }
  var reader = new FileReader();
  reader.onload = function () {
    var src = reader.result;
    var img = new Image();
    img.onload = function () {
      try {
        var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
        if (!w || !h) { cb(src); return; }
        var scale = Math.min(1, maxDim / Math.max(w, h));
        if (scale >= 1) { cb(src); return; } // sudah cukup kecil
        var cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
        var cv = document.createElement('canvas');
        cv.width = cw; cv.height = ch;
        cv.getContext('2d').drawImage(img, 0, 0, cw, ch);
        cb(cv.toDataURL('image/jpeg', quality));
      } catch (e) { cb(src); }
    };
    img.onerror = function () { cb(src); };
    img.src = src;
  };
  reader.onerror = function () { cb(null); };
  reader.readAsDataURL(file);
}

// FITUR: Foto profil warga — foto bila ada, kalau belum pasang foto
// tampilkan lingkaran berisi inisial nama (avatar bawaan).
function initialsOf(name) {
  var parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
  var init = parts.slice(0, 2).map(function (p) { return p.charAt(0).toUpperCase(); }).join('');
  return init || '?';
}
function avatarHtml(w, cls) {
  var name = (w && (w.name || w.wargaName)) || '?';
  var photo = w && (w.photo || w.wargaPhoto);
  var c = 'avatar' + (cls ? ' ' + cls : '');
  if (photo) return '<img src="' + esc(photo) + '" alt="Foto ' + esc(name) + '" class="' + c + '">';
  return '<span class="' + c + ' avatar-initials" aria-hidden="true">' + esc(initialsOf(name)) + '</span>';
}

// FITUR: Layar loading awal — sembunyikan splash hijau setelah render
// pertama selesai (dipanggil sekali; pengaman 15 detik ada di HTML).
var splashHidden = false;
function hideSplash() {
  if (splashHidden) return;
  splashHidden = true;
  var s = $('splash');
  if (s) s.hidden = true;
}

// FITUR: Live update tanpa refresh — jalankan ulang fn sambil menjaga
// posisi scroll halaman (dipakai saat polling menemukan data berubah).
function preserveScroll(fn) {
  var y = window.scrollY || 0;
  var r = fn();
  if (r && typeof r.then === 'function') {
    return r.then(function (v) { window.scrollTo(0, y); return v; });
  }
  window.scrollTo(0, y);
  return r;
}

// FITUR: Live update tanpa refresh — lewati pembaruan tampilan bila pengguna
// sedang mengetik di formulir pada layar yang sedang dibuka (supaya isian
// tidak hilang saat polling).
function viewHasFormFocus() {
  var a = document.activeElement;
  if (!a) return false;
  var tag = (a.tagName || '').toLowerCase();
  if (tag !== 'input' && tag !== 'select' && tag !== 'textarea') return false;
  var view = $('view');
  return !!(view && view.contains(a));
}

// FITUR: Gelembung chat — dipakai warga & admin; pembaruan polling hanya
// mengganti isi kotak chat ini, input ketik tidak disentuh.
function chatBubblesHtml(msgs, mySender) {
  return (msgs || []).map(function (m) {
    var mine = m.sender === mySender;
    return '<div class="bubble' + (mine ? ' mine' : '') + '">' + (m.text ? esc(m.text) : '') + (m.image ? '<img src="' + esc(m.image) + '" alt="Gambar chat">' : '') +
      '<div class="muted" style="font-size:11px">' + fmtDate(m.createdAt) + '</div></div>';
  }).join('');
}

// FITUR: Baris barang pesanan — foto diambil dari SNAPSHOT di data pesanan
// (it.image, disimpan server saat pesanan dibuat), bukan dari katalog saat
// ini; jadi gambar tetap tampil walau barang diubah/dihapus admin.
// Pesanan lama tanpa snapshot tampil tanpa gambar.
function orderItemsHtml(items) {
  var list = parseItems(items);
  if (!list.length) return '';
  return '<div class="order-items">' + list.map(function (it) {
    var p = findProduct(it.productId);
    var name = it.name || (p ? p.name : 'Barang #' + it.productId);
    var img = it.image ? '<img src="' + esc(it.image) + '" alt="' + esc(name) + '" onerror="this.style.display=\'none\'">' : '';
    return '<div class="order-item">' + img + '<div class="order-item-info"><b>' + esc(name) + '</b><br><span class="muted">' + fmtRp(it.price) + ' × ' + it.qty + '</span></div>' +
      '<span class="order-item-price">' + fmtRp((Number(it.price) || 0) * (Number(it.qty) || 0)) + '</span></div>';
  }).join('') + '</div>';
}

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

// FITUR: modal umum + modal alasan penolakan + modal konfirmasi.
// Modal memakai atribut hidden; CSS "[hidden]{display:none!important}" di
// style.css memastikan display:flex .modal-overlay tidak mengalahkannya
// (bug 2026-11-07: modal kosong menutupi layar dan tidak bisa ditutup).
function openModal(html, opts) {
  $('modalBody').innerHTML = html;
  $('modal').hidden = false;
  // FITUR: Modal konfirmasi — sembunyikan tombol Tutup bawaan supaya hanya
  // ada tombol aksi konfirmasi ("Ya, ..." / "Tidak jadi"); overlay memakai
  // warna hijau lembut, bukan gelap (lihat .modal-confirm di style.css).
  var overlay = $('modal');
  var closeBtn = document.querySelector('.modal-close');
  if (opts && opts.confirm) overlay.classList.add('modal-confirm'); else overlay.classList.remove('modal-confirm');
  if (closeBtn) closeBtn.style.display = (opts && opts.hideClose) ? 'none' : '';
}
function closeModal() {
  $('modal').hidden = true;
  $('modal').classList.remove('modal-confirm');
  $('modalBody').innerHTML = '';
  var closeBtn = document.querySelector('.modal-close');
  if (closeBtn) closeBtn.style.display = '';
  reasonCb = null;
  confirmCb = null;
}

// FITUR: Modal konfirmasi buatan sendiri — PENGGANTI confirm() bawaan
// browser (yang menampilkan layar gelap + "tokoku-a642.onrender.com
// menyatakan"). Dipakai untuk batalkan pesanan dan semua konfirmasi lain;
// tidak ada lagi window.confirm di kode.
// opts: { title, message, confirmText, cancelText, onConfirm }
var confirmCb = null;
function openConfirmModal(opts) {
  opts = opts || {};
  confirmCb = opts.onConfirm || null;
  openModal('<h2>' + esc(opts.title || 'Konfirmasi') + '</h2>' +
    (opts.message ? '<p>' + esc(opts.message) + '</p>' : '') +
    '<button type="button" class="btn btn-danger btn-block" onclick="submitConfirm()">' + esc(opts.confirmText || 'Ya') + '</button>' +
    '<button type="button" class="btn btn-secondary btn-block" onclick="closeModal()">' + esc(opts.cancelText || 'Tidak jadi') + '</button>',
    { confirm: true, hideClose: true });
}
async function submitConfirm() {
  var cb = confirmCb; closeModal();
  if (cb) await cb();
}
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

function stopChatPoll() { if (chatPoll) { clearInterval(chatPoll); chatPoll = null; } }

async function loadSettings() { try { var s = await api('/settings'); if (s) settings = s; } catch (e) {} }
async function loadProducts() { try { products = await api('/products'); if (!Array.isArray(products)) products = []; } catch (e) { products = []; } }
function visibleProducts() { return products.filter(function (p) { return p.visible !== 0 && p.visible !== false; }); }
function findProduct(id) { return products.find(function (p) { return String(p.id) === String(id); }); }
function effPrice(p, payment) { // FITUR: harga spesial bila bayar pakai saldo
  if (payment === 'saldo' && p.specialPrice != null && Number(p.specialPrice) > 0) return Number(p.specialPrice);
  return Number(p.price) || 0;
}

// FITUR: chat — lampirkan gambar (pratinjau) lalu kirim teks/gambar
function onChatImageChange(input) {
  var f = input.files && input.files[0]; if (!f) return;
  // FITUR: Foto diperkecil sebelum dikirim — lihat readImageFile.
  readImageFile(f, 1000, 0.85, function (dataUrl) {
    if (!dataUrl) return;
    pendingChatImage = dataUrl; var pv = $('chatPreview'); if (pv) pv.innerHTML = '<img src="' + esc(pendingChatImage) + '" alt="Pratinjau gambar"><br><button type="button" class="btn btn-secondary btn-small" onclick="pendingChatImage=null;document.getElementById(\'chatPreview\').innerHTML=\'\'">Batalkan gambar</button>';
  });
}
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
