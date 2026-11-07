/* tokoku — kode bersama aplikasi Warga & Admin (dipakai kedua halaman).
   Berisi: panggilan API, util format, toast, modal, muat settings/produk,
   dan kirim chat (teks + gambar). Tidak ada logika mode di sini.
   Komentar "// FITUR: ..." menandai blok fitur agar mudah di-porting. */
'use strict';

var API = '/api';
var SLOTS = ['09.00-10.00', '11.00-12.00', '16.00-17.00', '19.00-20.00'];

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

// FITUR: modal umum + modal alasan penolakan.
// Modal memakai atribut hidden; CSS "[hidden]{display:none!important}" di
// style.css memastikan display:flex .modal-overlay tidak mengalahkannya
// (bug 2026-11-07: modal kosong menutupi layar dan tidak bisa ditutup).
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
  var r = new FileReader();
  r.onload = function () { pendingChatImage = r.result; var pv = $('chatPreview'); if (pv) pv.innerHTML = '<img src="' + esc(pendingChatImage) + '" alt="Pratinjau gambar"><br><button type="button" class="btn btn-secondary btn-small" onclick="pendingChatImage=null;document.getElementById(\'chatPreview\').innerHTML=\'\'">Batalkan gambar</button>'; };
  r.readAsDataURL(f);
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
