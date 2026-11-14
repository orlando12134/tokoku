# Cara memindahkan perubahan dari versi Muse ke versi publik

Alur kerja yang disepakati dengan Andrik (2026-11-06): **setiap pembaruan
dibuat dulu di versi Muse** (artifact slug `toko-klontong`, diperbaiki lewat
`artifact.edit`/`artifact.inspect`), **lalu dipindahkan ke versi publik** di
folder ini. Tujuannya: pembaruan berikutnya tidak dibangun ulang dari nol.

## Prinsip susunan kode (supaya porting mudah)

- **Satu server, satu dependensi.** `server.js` memakai modul bawaan Node
  (`http`) + `@libsql/client` untuk database. `npm install` di Render
  memasang dependensi itu dari `package-lock.json`; update Node tetap jalan.
  Jangan tambah dependensi tanpa alasan kuat.
- **Dua aplikasi terpisah, satu server + satu database (sejak 2026-11-07).**
  `public/warga.html` + `public/warga.js` (aplikasi Warga, rute `/`),
  `public/admin.html` + `public/admin.js` (aplikasi Admin, rute `/admin`),
  `public/common.js` (kode bersama: API, toast, modal, muat settings/produk,
  kirim chat). Tidak ada framework/build step, tidak ada mode-switch.
  Perubahan tampilan/teks warga ubah di `warga.*`; admin di `admin.*`;
  yang dipakai keduanya di `common.js` / `style.css`.
- **Penanda fitur.** Setiap blok fitur di `server.js` dan `public/common.js`,
  `public/warga.js`, `public/admin.js` diawali komentar `// FITUR: ...`.
  Saat memindahkan perubahan, cari penanda yang sama di file-file itu dan
  ubah blok itu saja.
- **Kontrak API tetap.** Frontend hanya memanggil endpoint `/api/...` yang
  didokumentasikan di `README.md`. Perubahan perilaku server harus menjaga
  bentuk respons yang sama, atau ubah frontend di tempat yang sama.
- **Data tidak ikut pindah.** Yang dipindahkan hanya kode/perilaku. Data
  (barang, warga, pesanan, saldo) di versi publik tetap milik versi publik
  dan tidak ditimpa oleh porting.

## Langkah porting perubahan (checklist)

1. **Catat perubahan di versi Muse.** Setelah perbaikan di versi Muse
   selesai dan terverifikasi, tulis apa yang berubah: fitur, layar yang
   terkena, aturan baru (mis. harga, batas, status), dan nilai bawaan
   (mis. ongkir Rp2.000, saklar mati).
2. **Cari penanda fitur di versi publik.** Buka `FITUR.md`, temukan baris
   fitur yang bersangkutan, lalu cari komentar `// FITUR: ...` yang sama
   di `server.js` dan/atau `public/common.js`, `public/warga.js`,
   `public/admin.js`.
3. **Ubah di tempat yang sama.**
   - Perubahan aturan/data (harga, ongkir, status pesanan, validasi):
     ubah di `server.js` dulu — server yang menegakkan aturan.
   - Perubahan tampilan/teks: ubah di `public/warga.html` / `public/admin.html` / `public/style.css`.
   - Perubahan alur di layar (tombol, form, navigasi): ubah di `public/warga.js` (warga),
     `public/admin.js` (admin), atau `public/common.js` (dipakai keduanya).
   - Perubahan struktur data: tambah kolom/tabel di fungsi init database
     `server.js` dengan migrasi "tambah bila belum ada" (jangan hapus
     tabel — data warga yang sudah ada harus selamat).
4. **Perbarui `FITUR.md`.** Tambah/ubah baris fitur dan, bila perlu,
   bagian "Batasan yang diketahui".
5. **Uji lokal sebelum deploy.** Jalankan `node server.js`, lalu uji lewat
   `http://localhost:3000` alur yang berubah (lihat README.md "Uji lokal").
   Periksa juga di lebar HP: bilah keranjang tidak tertutup menu bawah,
   teks header tidak terpotong.
6. **Deploy ulang.** Push ke repo GitHub → layanan hosting men-deploy
   otomatis (Render/Railway). Cek URL publik setelah deploy selesai.

## Pemetaan fitur → file

| Perubahan | File yang diubah |
|---|---|
| Aturan harga/ongkir/status/validasi | `server.js` (blok `// FITUR: ...`) |
| Teks, label, placeholder, warna, ukuran font | `public/warga.html`, `public/admin.html`, `public/style.css` |
| Alur layar, tombol, form, navigasi (warga) | `public/warga.js` (blok `// FITUR: ...`) |
| Alur layar, tombol, form, navigasi (admin) | `public/admin.js` (blok `// FITUR: ...`) |
| Alur layar, tombol, form, navigasi (bersama) | `public/common.js` (blok `// FITUR: ...`) |
| Layar loading awal (splash hijau + logo + titik berputar) | `public/warga.html`, `public/admin.html` (elemen `#splash` + pengaman 15 detik), `public/style.css` (`.splash`, `.splash-orbit`), `public/common.js` (`hideSplash()`), `public/warga.js` / `public/admin.js` (panggil di akhir `render()`) |
| Live update tanpa refresh (polling 10 detik, hanya bila berubah) | `public/warga.js` / `public/admin.js` (`startLivePoll()` / `pollLive()` + snapshot `lastLive`), `public/common.js` (`preserveScroll()`, `viewHasFormFocus()`, `chatBubblesHtml()`) |
| Snapshot gambar di data pesanan | `server.js` (tambah `image` di tiap item saat `POST /api/orders`), `public/common.js` (`orderItemsHtml()`), `public/warga.js` / `public/admin.js` (pakai `orderItemsHtml()` di kartu pesanan) |
| Detail produk (klik gambar) | `public/warga.js` (`openProductDetail()` / `renderProductDetail()` / `detailAddToCart()`), `public/style.css` (`.product-detail-*`, `.detail-qty-row`) |
| Status toko buka/tutup live tanpa refresh | `public/warga.js` / `public/admin.js` (`pollLive()` mem-poll `/api/settings` di semua tab + perbarui header/etalase/saklar), `public/common.js` (`isStoreOpen()`) |
| Foto profil warga | `server.js` (kolom `photo` + migrasi aman + `POST /api/register` + `PUT /api/warga/:id/profile` + foto di `/api/admin/warga`, `/api/admin/warga/:id/history`, `/api/chat/threads`), `public/warga.js` (upload saat daftar + Akun), `public/admin.js` (daftar/riwayat/chat), `public/common.js` (`avatarHtml()`), `public/style.css` (`.avatar`) |
| Modal konfirmasi pengganti `confirm()` bawaan | `public/common.js` (`openConfirmModal()` / `submitConfirm()`, `openModal(html, opts)`), `public/warga.js` (`cancelOrder()`), `public/style.css` (`.modal-confirm`) |
| Kolom/tabel baru | `server.js` (init database + migrasi) |
| Database Turso vs file lokal | `server.js` (client `@libsql/client`: env `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` → Turso; bila tidak ada → file lokal `DB_PATH`/`data/tokoku.db`); `package.json` (dependensi) |
| Endpoint baru | `server.js` + pemanggilnya di `public/common.js` / `public/warga.js` / `public/admin.js` |
| Aset baru (logo, QRIS, foto) | `public/` + referensi di `public/warga.html` / `public/admin.html` |

- **Pola live update (sejak 2026-11-07 malam).** Polling 10 detik di
  `warga.js`/`admin.js` membandingkan `JSON.stringify` data baru dengan
  snapshot `lastLive` dan hanya membangun ulang tampilan bila berubah;
  `preserveScroll()` menjaga posisi scroll, `viewHasFormFocus()` menahan
  pembangunan ulang saat formulir sedang diisi, dan chat hanya mengganti
  isi `#chatBox` (bukan seluruh tampilan) supaya teks ketikan tidak hilang.
  Jangan kembalikan interval chat per-tab yang membangun ulang seluruh
  tampilan — itu yang dulu menghapus teks ketikan.
- **Pola snapshot (sejak 2026-11-07 malam).** Data yang harus bertahan
  walau sumbernya berubah/dihapus (mis. foto barang di pesanan) disimpan
  sebagai snapshot di JSON pesanan saat dibuat (`server.js`), bukan dibaca
  ulang dari katalog. Tidak perlu ubah skema DB selama field-nya sudah
  berupa JSON string; pesanan lama tanpa field itu tetap bisa dibaca
  (tampil tanpa gambar).
- **Pola splash (sejak 2026-11-07 malam).** Elemen `#splash` ditulis
  langsung di HTML sebelum `<script>` agar tampil sebelum JS jalan;
  disembunyikan di akhir `render()` pertama (`hideSplash()`), dengan
  pengaman `setTimeout` 15 detik di HTML bila JS gagal.

## Backup database live — sekarang berkala, bukan wajib sebelum deploy

**Latar:** sebelum migrasi Turso (2026-11-08), Render Free memakai
filesystem ephemeral — setiap deploy/restart menghapus `data/tokoku.db`.
Pada 2026-11-07 malam, barang dan warga yang sudah dimasukkan Andrik
hilang setelah deploy karena tidak ada backup.

**Sejak migrasi Turso, data live TIDAK lagi hilang saat deploy.**
Database tinggal di Turso (libSQL, database "tokoku", Singapore), di luar
filesystem Render — deploy/restart tidak menyentuhnya. Jadi langkah
backup sebelum deploy **tidak lagi wajib**.

Yang tetap disarankan: **backup berkala** (mis. seminggu sekali) lewat
dashboard Turso — ekspor/salin database dan simpan salinannya di tempat
aman di luar Turso. Bila suatu hari perlu pindah layanan database lagi,
salinan itu yang dipakai.

Catatan keamanan: JANGAN menambahkan endpoint unduh database tanpa
pengaman — Admin saat ini tanpa kata sandi, jadi endpoint seperti itu
akan membuka seluruh data warga ke publik. Token Turso (`TURSO_AUTH_TOKEN`
di Render) juga jangan dibagikan ke siapa pun — pemegangnya bisa membaca
dan mengubah seluruh data toko.

**Bila data hilang setelah deploy (tidak seharusnya terjadi lagi):**
jangan isi ulang manual dulu — cek dulu dashboard Turso (apakah database
masih ada dan berisi data) dan log deploy Render; bila database Turso
masih utuh, masalahnya di koneksi (env var), bukan di data.

## Perbaikan 2026-11-08 siang (laporan Andrik: foto profil, harga spesial di keranjang, verifikasi top-up + bukti pembayaran)

Port dari versi Muse (v14) ke publik, setelah perbaikan transaksi Turso
(commit f7c93bc, live 11:11 WIB) dan persetujuan top-up Tri wahyu Rp50.000.

- **Foto profil:** foto warga kini tampil juga di kartu verifikasi top-up
  Admin (sebelumnya kartu itu tidak menampilkan foto) — pending API ikut
  mengirim `wargaPhoto`. Semua gambar (foto profil, foto barang, gambar
  chat, bukti top-up) diperkecil otomatis di sisi warga sebelum dikirim
  (`readImageFile` di `common.js`, canvas: profil 800px, barang/chat
  1000px, bukti 1200px) karena foto kamera HP 3-5MB melebihi batas body
  server ~5MB sehingga gagal tersimpan.
- **Harga spesial di keranjang:** baris barang di halaman Keranjang memakai
  harga sesuai cara bayar yang dipilih (spesial + harga normal dicoret +
  catatan saat saldo; normal saat tunai) dan ikut berubah saat radio cara
  bayar diganti (`cartItemsHtml(payment)` di `warga.js`).
- **Bukti pembayaran top-up:** kolom `proof` (nullable, migrasi AMAN) di
  `topups`; `POST /api/topup` menerima `proof` opsional; form top-up warga
  punya lampiran bukti (pratinjau, hapus; disembunyikan untuk tunai);
  kartu verifikasi Admin menampilkan thumbnail bukti (klik → modal ukuran
  penuh) atau "Tanpa bukti pembayaran"; riwayat warga di Admin punya tautan
  "Lihat bukti".
- **Uji lokal sebelum deploy:** regresi API 32 pemeriksaan lolos (termasuk
  semua jalur transaksi), API bukti lolos, browser HP 20 pemeriksaan lolos
  (foto 5MB → 201KB tersimpan, keranjang saldo/tunai, bukti ujung ke ujung
  sampai saldo bertambah).

- PIN/kata sandi untuk mode Admin (saat ini saklar mode tanpa kata sandi).
- Pencarian barang di katalog warga.
- Notifikasi di luar aplikasi (mis. WhatsApp) saat pesanan/top-up masuk.
- Ekspor laporan (pesanan/penjualan) ke spreadsheet.

## Perbaikan 2026-11-08 siang (menu kategori di Belanja warga)

Port dari versi Muse (v15) ke publik. Hanya `public/warga.js` (state
`shopCategory`, `renderShop` + `setShopCategory`) dan `public/style.css`
(`.cat-row`, `.cat-chip`); server.js tidak berubah.

- **Menu kategori:** chip "Semua (N)" + satu chip per kategori dari barang
  yang tampil + jumlahnya; barang tanpa kategori masuk "Lainnya"; kategori
  barang tersembunyi tidak muncul; bila kategori yang dipilih kehabisan
  barang (Admin menyembunyikan semuanya) pilihan kembali ke "Semua".
  Filter dan keranjang dipertahankan saat polling maupun buka/tutup detail.
- **Jebakan yang ditemukan saat uji lokal:** `JSON.stringify` untuk nama
  kategori di `onclick="..."` menghasilkan tanda petik ganda yang memutus
  atribut HTML sehingga chip tidak berfungsi sama sekali — diperbaiki
  dengan `jsQuote()` (petik tunggal + escape). Uji browser pertama
  menangkap ini (filter tidak berubah walau chip tampil benar).
- **Uji lokal sebelum deploy:** browser HP 19 pemeriksaan lolos (chip +
  hitungan benar, filter Mie instan/Sabun mandi/Lainnya, keranjang tetap
  saat ganti kategori dan buka/tutup detail, pesanan ujung ke ujung
  saldo 100.000 → 94.700). Regresi API tidak dijalankan ulang untuk
  perubahan ini karena server.js tidak berubah; alur pesan diuji lewat
  browser di atas.

## Perbaikan 2026-11-08 sore (pintasan layar utama / PWA berlogo tokoku)

Port dari versi Muse (v16) ke publik. Yang berubah: `public/manifest.webmanifest`
(nama "tokoku", display standalone, theme #166534, ikon 192/512/maskable),
ikon baru dari logo (`public/icon-192.png`, `icon-512.png`,
`icon-maskable-512.png`, `apple-touch-icon.png` — dibuat dari `logo.png`
dengan PIL: potong tepi putih, pasang di tengah kanvas persegi putih,
tidak dipotong/di-stretch; maskable diberi padding lebih besar supaya logo
tetap di zona aman), `public/sw.js` (service worker TANPA cache: install
skipWaiting, activate hapus semua cache, fetch tidak dicegat — JANGAN
tambah caching tanpa persetujuan, supaya update tidak basi),
`public/warga.html` + `public/admin.html` (link manifest, favicon,
apple-touch-icon, meta theme-color), `public/common.js` (pendaftaran SW
bersifat menjaga: cek HEAD /sw.js dulu, gagal diam-diam bila tidak ada),
dan `server.js` (MIME `.webmanifest` → application/manifest+json).

- **Catatan platform:** di versi Muse, service worker TIDAK bisa tersaji
  (pipeline hanya mengizinkan satu berkas JS di bundel) — manifest + ikon
  tetap jalan di sana, tapi prompt "Install aplikasi" penuh hanya ada di
  versi publik yang menyajikan sw.js dari root.
- **Uji lokal sebelum deploy:** browser HP 15 pemeriksaan lolos (manifest
  valid + content-type benar, semua ikon + sw.js 200, SW terdaftar &
  aktif, tag PWA di Warga dan Admin, plus regresi kategori + pesanan
  ujung ke ujung saldo 100.000 → 94.700).


## Performa — semua menu lelet (2026-11-14)
**Laporan Andrik:** "kenapa semua menu ketika di klik kok lelet banget".
**Penyebab (terukur):** setiap klik memanggil `render()` yang `await` BERURUTAN: `loadSettings()` + `loadProducts()` (2,1 MB) + `refreshWarga()` + `refreshUnread()` + fetch tab — satu klik 4–6 detik. Payload: `/api/products` 2,1 MB (99,9% gambar base64), `/api/orders` 3,8 MB, `/api/warga/:id/orders` 1,3 MB, `/api/chat/threads` 221 KB, `/api/admin/warga` 221 KB. Polling 10 detik mengulang rantai yang sama termasuk unduh ulang 2,1 MB, tanpa penjaga tumpang-tindih.
**Perbaikan (server.js):** endpoint lite baru — `/api/products/lite`, `/api/admin/warga/lite`, `/api/orders/lite`, `/api/warga/:id/orders/lite`, `/api/chat/threads/lite`, `/api/chat/:id/lite` — sama seperti endpoint penuh tapi tanpa bytes gambar, diganti hash MD5 12 hex dari string data-URL (`imgHash`, `node:crypto`, tanpa dependensi baru). Endpoint penuh juga mendapat field hash (`imageHash`/`photoHash`/`wargaPhotoHash`). Tidak ada perubahan skema DB; snapshot pesanan tetap menyimpan gambar penuh di DB.
**Perbaikan (common.js):** satu cache gambar beralamat hash (`imgCache`), helper merge per entitas, smart loader pola lite-dulu (`loadProducts(forceFull)`, `loadWargaList`, `loadOrderList(path, q)`, `loadChat`, `loadThreads`), kunci snapshot murah (`productsKey`, `wargaKey`, `ordersKey`, `threadsKey`, `topupsKey`) — jangan pernah `JSON.stringify` array bergambar.
**Perbaikan (warga.js/admin.js):** `render()` dan `pollLive` memakai `Promise.all` untuk fetch independen; `pollBusy` mencegah siklus polling menumpuk; semua tab memakai smart loader; admin `submitProduct` memanggil `loadProducts(true)` sekali setelah simpan supaya cache foto diperbarui.
**Jebakan saat uji lokal:** klik tab nav di Playwright mobile gagal hit-test karena `innerHeight` (892) ≠ viewport (844) sehingga titik klik jatuh di luar viewport dan tertutup konten; di browser asli tombolnya kena hit-test dengan benar dan klik JS berfungsi. Di test, klik nav memakai `evaluate(el.click())`.
**Uji lokal (2026-11-14):** 22/22 lulus di Chromium 390px + latensi /api 600ms: semua tab warga+admin, pesanan saldo + batal (saldo kembali), top-up disetujui, tambah barang lewat form + foto, foto produk berubah lewat polling tanpa refresh, klik ulang tidak mengunduh ulang `/api/products` penuh (2x total = sekali per halaman), lite 678 byte vs penuh 2.295.375 byte (produk), lite 441 byte vs penuh 1.147.913 byte (pesanan).

## Keamanan Admin: password + authenticator TOTP (2026-11-14)
**Permintaan Andrik:** aplikasi admin diberi pengamanan password dan authenticator.
**Kontrak (sama dengan versi Muse; versi Muse memakai PBKDF2, publik memakai scrypt — keduanya hash + salt acak, tidak pernah plaintext):**
- Login admin: password + kode TOTP 6 digit bila TOTP aktif. Sesi: token acak 32 byte, hanya sha256-nya disimpan di tabel baru `admin_sessions` (berlaku 30 hari); token mentah hanya diberikan sekali saat login. Tombol Keluar menghapus sesi di server + klien. Muat ulang tidak perlu login ulang selama sesi berlaku.
- TOTP: secret base32 (20 byte acak), kode HMAC-SHA1 langkah 30 detik, diterima ±1 langkah. Setup menampilkan secret sebagai TEKS + tombol salin + langkah entri manual ("Enter a setup key", akun "tokoku admin") — JANGAN pakai layanan QR pihak ketiga (secret tidak boleh dikirim ke server lain). Verifikasi kode untuk mengaktifkan; nonaktifkan wajib password + kode saat ini; ubah password wajib password lama (+ kode bila TOTP aktif) dan mencabut sesi perangkat lain.
- Brute-force: 5x gagal dari satu IP → kunci 15 menit (in-memory Map; reset bila login berhasil). Pesan error login generik ("Password atau kode salah.").
- Endpoint admin yang dilindungi (401 tanpa sesi): POST /api/settings, POST /api/products, PUT /api/products/:id, GET /api/admin/warga(+/lite), approve/reject/history warga, GET /api/topup/pending, approve/reject top-up, GET /api/orders(+/lite), POST /api/orders/:id/status, GET /api/orders/:id/struk, GET /api/chat/threads(+/lite). Endpoint warga tetap publik (katalog, register/login warga, pesanan warga, chat warga, saldo/top-up warga). GET /api/settings tetap publik (warga butuh status toko).
- Kredensial tinggal di tabel `settings` (kunci `admin_password_hash`, `admin_totp_secret`, `admin_totp_enabled`); `getSettings()` HANYA mengembalikan tiga kunci toko, jadi hash/secret tidak pernah keluar lewat /api/settings. `setSettings()` sudah punya allowlist tiga kunci.
- Struk: admin.js tidak lagi `window.open` langsung (tanpa header token) — `printStruk(id)` memakai fetch + Bearer lalu buka blob URL.
- Klien: `api()` di common.js mengirim `Authorization: Bearer <token>` bila token ada (localStorage `tokoku_admin_token`) + hook 401 → `onUnauthorized()` (bersihkan token + tampilkan layar login). admin.js: `initAdminAuth()` (cek /api/admin/me) → `renderLogin()` bila belum login; `render()`/`pollLive()` tidak memuat data admin sebelum login. Kartu "Keamanan Admin" di Beranda: status TOTP, aktifkan/nonaktifkan, ubah password, keluar.
**Password awal (publik):** TIDAK ada penyiapan mandiri di aplikasi (siapa pun yang tahu URL /admin bisa merebutnya bila kosong). Server me-seed dari env `ADMIN_PASSWORD_HASH` (hash scrypt, BUKAN password mentah) saat start — env menang selama terpasang, jadi HAPUS env setelah password awal berhasil dipakai supaya ubah password lewat aplikasi tidak tertimpa restart. Prosedur: (1) deploy kode, (2) pasang env `ADMIN_PASSWORD_HASH` di Render (memicu redeploy), (3) verifikasi login live dengan password awal, (4) hapus env, (5) verifikasi login masih jalan (password tersimpan di settings). Bila terkunci: pasang lagi env hash baru dan/atau `ADMIN_RESET_TOTP=1` (menghapus secret TOTP), deploy, lalu hapus env-nya. Versi Muse berbeda: penyiapan awal "Buat password admin" di aplikasi (hanya Andrik yang bisa membuka artifact) — jadi password Muse dan password publik BERBEDA dan diatur terpisah.
**Jebakan saat uji lokal:** (1) Hook 401 di `api()` harus mengecualikan path TANPA awalan /api (`path !== '/admin/login'`, bukan `'/api/admin/login'`) — pemanggil memakai '/admin/login'; salah tulis membuat layar login ter-render ulang di tengah login gagal sehingga pesan error hilang. (2) Di Playwright, `text=Masuk` mengenai judul "Masuk Admin"/paragraf, bukan tombol — klik tombol pakai selector spesifik (`button.btn-primary`, `button:has-text("...")`); sama untuk "Aktifkan authenticator" (paragraf kartu mengandung teks yang sama).
**Uji lokal (2026-11-14):** 49/49 lulus (API + Playwright Chromium 390px, DB /tmp): status/settings (tidak bocor kunci admin_*), login salah 401, login benar + token, 14 endpoint admin tanpa token → 401, dengan token → 200, warga tetap publik (daftar/setujui/pesan tunai), struk 401/200, UI login (layar kunci, error, Beranda + kartu Keamanan), setup TOTP lewat modal + verifikasi kode, reload tetap login, keluar → login + kolom kode, login tanpa kode 401, ubah password (lama 401, sesi lain dicabut, baru + kode 200), nonaktifkan TOTP, logout → 401, rate-limit 429 setelah 5 gagal, token palsu → layar login. Restart TANPA env: password baru tetap jalan, password seed lama 401 (bukti seed bertahan di settings).
**Catatan:** thread chat warga tunggal (`/api/chat/:id`) tetap bisa dibaca siapa pun yang tahu ID warga (angka) — perilaku lama, tidak diubah batch ini; yang dikunci adalah daftar thread admin (`/api/chat/threads`).
