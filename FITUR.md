# Daftar fitur versi publik tokoku

Versi publik ini adalah pembangunan ulang aplikasi toko klontong "tokoku"
milik Andrik (khusus warga Perum GKR) agar bisa dibuka lewat tautan publik
dengan database bersama. Versi Muse (artifact slug `toko-klontong`) tetap
menjadi tempat pertama setiap pembaruan dibuat; versi ini mengikutinya
(lihat PORTING.md). Data awal kosong — Andrik mengisi barang dan warga
asli sendiri.

## Struktur kode (sejak 2026-11-07: dua aplikasi terpisah, satu server + satu database)

| Bagian | File |
|---|---|
| Server + API + database Turso (libSQL) / file lokal | `server.js` |
| Satu-satunya dependensi: `@libsql/client` | `package.json` (+ `package-lock.json`) |
| Aplikasi Warga — `/` (warga) | `public/warga.html` + `public/warga.js` |
| Aplikasi Admin — `/admin` (admin) | `public/admin.html` + `public/admin.js` |
| Kode bersama (API, toast, modal, chat) | `public/common.js` |
| Tampilan (mobile-first) | `public/style.css` |
| Pengalihan `/index.html` → `/` | `public/index.html` |
| Logo toko | `public/logo.png` |
| Gambar QRIS | `public/qris.jpg` |
| Database file lokal — HANYA fallback dev/uji lokal | `data/tokoku.db` |

Rute server: `/` menyajikan aplikasi Warga, `/admin` menyajikan aplikasi
Admin. Tidak ada tombol ganti mode — warga hanya bisa membuka aplikasi
Warga, admin membuka aplikasi Admin lewat `/admin`. Data tetap satu:
pesanan, saldo, dan chat warga masuk ke aplikasi Admin.

## Migrasi database ke Turso 2026-11-08 (data tidak hilang lagi saat deploy)

- **Latar:** database live sebelumnya di file SQLite di Render (filesystem
  ephemeral) — hilang tiap deploy/restart. Pada 2026-11-07 malam barang
  dan warga yang sudah dimasukkan hilang setelah deploy. Andrik memilih
  pindah ke database gratis (bukan paket berbayar).
- **Sekarang:** data live tinggal di **Turso (libSQL, gratis)** — database
  "tokoku", Singapore, akun orlando12134. Deploy/restart Render **tidak
  lagi menghapus data**.
- **Cara kerja:** `server.js` memakai satu driver `@libsql/client` untuk
  keduanya. Bila env `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` tersedia
  (sudah tersimpan di Render) → client Turso jarak jauh; bila tidak →
  fallback ke file lokal `data/tokoku.db` (atau env `DB_PATH`) untuk
  pengembangan/uji lokal. Semua query ditulis async/await; transaksi
  (buat/batalkan pesanan, setujui top-up) memakai
  `client.transaction('write')` supaya tetap atomik.
- **Skema & API tidak berubah:** tabel dan kolom sama persis (products,
  warga + kolom `photo`, topups, orders, messages, settings); format
  respons, kode status, dan pesan error API identik. Satu-satunya
  perubahan perilaku yang disengaja: `GET /api/chat/threads` kini memakai
  3 query gabungan (bukan N+1 per warga) supaya polling tetap cepat
  lewat Turso jarak jauh; bentuk responsnya sama persis.
- **Yang belum bisa diuji lokal:** round-trip jaringan ke Turso
  (token tidak tersedia di lingkungan uji) — diverifikasi setelah deploy
  live dengan uji ketahanan data (isi barang → deploy ulang → barang
  tetap ada).

## Perbaikan 2026-11-08 (3 perbaikan: status toko live, foto profil, modal konfirmasi)

- **Status toko buka/tutup live tanpa refresh:** `pollLive()` di
  `warga.js` dan `admin.js` kini mem-poll `/api/settings` di SEMUA tab
  (sebelumnya Warga hanya di tab Belanja, Admin hanya tersirat di kunci
  Beranda — dan kunci itu memakai `settings` basi dari `render()`, jadi
  perubahan dari admin lain tidak terdeteksi). Bila `storeOpen` berubah:
  teks header "Toko Buka/Tutup" diperbarui langsung, etalase Warga
  disembunyikan/ditampilkan dan bilah keranjang diperbarui tanpa refresh
  (tab Keranjang ikut dibangun ulang; tab lain cukup headernya). Di
  Admin, saklar di Beranda ikut berubah setelah polling. Posisi scroll
  dijaga (`preserveScroll()`); formulir yang sedang diisi tidak dibangun
  ulang (`viewHasFormFocus()`).
- **Foto profil warga:** warga bisa pasang foto saat daftar (pratinjau)
  dan di menu Akun (ganti/hapus foto). Foto disimpan sebagai snapshot
  data URL, sama seperti foto barang/chat. Kolom baru `photo` di tabel
  `warga` (`server.js`): ada di `CREATE TABLE` untuk DB baru, dan
  ditambah ke DB lama lewat migrasi aman `ALTER TABLE ... ADD COLUMN
  photo TEXT NULL` bila belum ada — warga lama tetap terbaca
  (`photo = null`). Endpoint baru `PUT /api/warga/:id/profile`
  (foto/nama/blok/nomor rumah; `photo: null` menghapus foto).
  `GET /api/admin/warga`, `GET /api/admin/warga/:id/history`, dan
  `GET /api/chat/threads` mengembalikan foto. Foto tampil di Admin:
  daftar warga (termasuk yang menunggu verifikasi), riwayat warga, dan
  daftar chat. Bila warga belum pasang foto, tampil lingkaran berisi
  inisial nama (`avatarHtml()` di `common.js`, gaya `.avatar` di
  `style.css`).
- **Konfirmasi batalkan pesanan tanpa dialog bawaan browser:** tidak ada
  lagi `window.confirm` di kode (satu-satunya pemakaian, di
  `cancelOrder()` `warga.js`, sudah diganti — dicek lewat `grep`).
  Penggantinya `openConfirmModal()` di `common.js`: modal umum yang
  sudah ada, overlay hijau lembut terang (`.modal-confirm`, bukan layar
  gelap), kartu putih, tombol "Ya, batalkan pesanan" (merah) dan "Tidak
  jadi"; tombol Tutup bawaan disembunyikan selama modal konfirmasi
  tampil. Perilaku batal tidak berubah: stok dan saldo (bila bayar pakai
  saldo) dikembalikan.

## Perbaikan 2026-11-07 (malam — 5 perbaikan dari versi Muse)

- **Layar loading awal:** `#splash` statis di `warga.html`/`admin.html`
  tampil sebelum JS jalan — background hijau #166534, logo tokoku, tulisan
  "Memuat…", tiga titik berputar (animasi CSS murni, `.splash-orbit` di
  `style.css`). Disembunyikan JS (`hideSplash()` di `common.js`) setelah
  render pertama selesai; ada pengaman 15 detik di HTML bila JS gagal.
  Bukan layar hitam.
- **Live update tanpa refresh:** polling tiap 10 detik (`startLivePoll()` /
  `pollLive()` di `warga.js` dan `admin.js`) untuk data tab yang sedang
  dibuka — Admin: pesanan baru, top-up menunggu, verifikasi menunggu, chat;
  Warga: status pesanan, status top-up, saldo, chat, status verifikasi.
  Tampilan hanya dibangun ulang bila data benar-benar berubah (banding
  `JSON.stringify` dengan snapshot terakhir); posisi scroll dijaga
  (`preserveScroll()`); chat hanya mengganti kotak pesan bila ada pesan
  baru sehingga teks yang sedang diketik tidak hilang; formulir yang
  sedang diisi tidak dibangun ulang (`viewHasFormFocus()`). Tanpa
  WebSocket (server tidak mendukungnya).
- **Peringatan saldo (Warga):** menu Saldo menampilkan PERSIS (di bawah
  angka saldo, di atas formulir top-up, kotak `.warn-box`):
  "Saldo tokoku tidak dapat di uangkan kembali. Saldo hanya bisa di pakai
  untuk belanja di tokoku, jadi isi secukupnya sesuai kebutuhan belanja Kamu".
- **Gambar di pesanan:** server menyimpan snapshot gambar barang di data
  pesanan saat pesanan dibuat (`image` di tiap item `orders.items`,
  `server.js`) — gambar tetap tampil di Pesanan Saya (Warga) dan Pesanan
  (Admin) walau barangnya nanti diubah/dihapus admin. Pesanan lama tanpa
  snapshot tampil tanpa gambar. Tidak perlu ubah skema DB (items sudah
  JSON string), jadi tidak ada migrasi.
- **Klik gambar produk (Belanja Warga):** gambar (dan nama) produk bisa
  diklik — membuka detail produk (foto besar, nama, harga normal + harga
  spesial saldo, stok, kategori) dengan pilihan jumlah, lalu tombol
  "Tambah ke keranjang" dengan jumlah itu (`openProductDetail()` di
  `warga.js`, memakai modal umum). Tombol +/- cepat di kartu produk tetap
  berfungsi seperti biasa.
- **Catatan:** produk tidak punya kolom deskripsi di skema publik, jadi
  detail produk menampilkan kategori bila ada (bukan deskripsi).

## Perbaikan 2026-11-07 (bug situs tidak bisa dipakai + pemisahan)

- **Bug modal (penyebab situs tidak bisa dipakai):** `.modal-overlay`
  memakai `display:flex` yang mengalahkan atribut `hidden`, sehingga modal
  kosong menutupi layar saat load dan tombol Tutup tidak berfungsi.
  Diperbaiki dengan aturan `[hidden] { display: none !important; }` di
  `style.css` (juga memperbaiki `cartBar`, `toast`, dan catatan tunai yang
  memakai `hidden` + class ber-display sendiri). Modal kini hanya muncul
  saat dibuka (alasan penolakan / riwayat), bisa ditutup lewat tombol Tutup
  maupun klik di luar kotak.
- **Status pesanan:** server menyimpan status lowercase (`baru`,
  `diproses`, ...), tetapi frontend membandingkan dengan huruf kapital
  (`Baru`), sehingga tombol Batalkan pesanan dan Ubah status tidak pernah
  muncul/berfungsi. Diperbaiki dengan pemetaan status di `common.js`
  (`orderStatusLabel` / `orderStatusRaw`).
- **Daftar barang pesanan:** API mengembalikan `items` sebagai JSON string
  (kolom TEXT SQLite); frontend memanggil `.map` langsung sehingga halaman
  Pesanan bisa gagal render. Diperbaiki dengan `parseItems` di `common.js`.
- **Pratinjau chat admin:** `lastMessage` dari API berupa objek, tetapi
  dirender sebagai string sehingga tampil `[object Object]`. Diperbaiki —
  kini menampilkan teks pesan atau "📷 Gambar".
- **Status warga basi:** data warga di `localStorage` tidak diperbarui
  setelah admin menyetujui/menolak, sehingga warga harus log in ulang.
  Aplikasi Warga kini menyegarkan data warga dari server tiap render.
- **Poll chat:** pembaruan chat tiap 10 detik membangun ulang seluruh
  tampilan sehingga teks yang sedang diketik bisa hilang. Kini hanya
  membangun ulang bila ada pesan baru.

## Fitur

### Header dan tampilan
- [x] Logo keranjang hijau TOKOKU di header (Admin dan Warga).
- [x] Tulisan "Warga Perum GKR saja" di bawah logo: besar, tebal, warna emas.
- [x] Tampilan HP: bilah keranjang dan barang terakhir tidak tertutup menu bawah/gesture bar (padding memperhitungkan safe-area); teks header tidak terpotong.

### Warga — akun
- [x] Daftar: nama, nomor HP, blok (contoh "mawar"), nomor rumah (contoh "AA01").
- [x] Foto profil: pasang foto saat daftar dan di menu Akun (ganti/hapus); foto tampil di Admin (daftar warga, verifikasi, kartu verifikasi top-up, riwayat, chat); bila belum ada foto tampil inisial nama. Foto diperkecil otomatis sebelum dikirim (sisi terpanjang 800px, JPEG) supaya foto kamera HP tidak melebihi batas body server (~5MB) — sebelumnya foto besar gagal tersimpan.
- [x] Foto barang dan gambar chat juga diperkecil otomatis sebelum dikirim (maks 1000px).
- [x] Verifikasi admin sebelum bisa belanja; penolakan menampilkan alasan admin.
- [x] 1 nomor HP = 1 akun (nomor yang sudah terdaftar menampilkan "Masuk sebagai ...", tidak membuat akun kedua).
- [x] Log in pakai nomor HP; log out di tab Akun.

### Admin — barang
- [x] +Barang: nama, harga, stok, kategori, upload foto (pratinjau), kolom "Harga spesial bayar pakai saldo".
- [x] Ubah harga/stok/kategori dan sembunyikan barang; foto tampil di daftar admin, katalog warga, dan keranjang.

### Saldo dan top-up
- [x] Top-up via QRIS (gambar atas nama Toko Khayla, NMID ID1022215364889, A01), transfer, atau tunai; admin menyetujui.
- [x] Bukti pembayaran top-up (opsional, untuk QRIS/transfer; tidak perlu untuk tunai): warga melampirkan foto bukti saat mengajukan (pratinjau, bisa dihapus, diperkecil otomatis maks 1200px); admin melihat thumbnail bukti di kartu verifikasi top-up (ketuk untuk ukuran penuh) dan tautan "Lihat bukti" di riwayat; pengajuan tanpa bukti diberi catatan "Tanpa bukti pembayaran".
- [x] Perbaikan transaksi Turso 2026-11-08: parameter query di dalam transaksi harus dikirim sebagai objek `{sql, args}` — cara lama `tx.execute(sql, args)` diam-diam membuang argumen di database jarak jauh sehingga persetujuan top-up, pembuatan pesanan, dan pembatalan pesanan tidak pernah tersimpan walau server menjawab 200. Sudah diuji live (top-up Tri wahyu Rp50.000 selesai, saldo bertambah).
- [x] Halaman saldo menampilkan peringatan persis: "Saldo tokoku tidak dapat di uangkan kembali. Saldo hanya bisa di pakai untuk belanja di tokoku, jadi isi secukupnya sesuai kebutuhan belanja Kamu" (kotak peringatan di bawah angka saldo, di atas formulir top-up).
- [x] Tidak bisa mengajukan top-up baru sebelum pengajuan lama disetujui (form diganti pemberitahuan; server juga menolak).
- [x] Penolakan top-up memakai kotak alasan; alasan tampil ke warga.

### Pesanan
- [x] Diantar ke rumah (ongkir Rp2.000, bisa diubah admin; gratis kalau ambil di toko) atau ambil di toko.
- [x] Foto barang tampil di tiap baris barang pada kartu pesanan (Warga "Pesanan saya" dan Pesanan Admin), dari snapshot saat pesanan dibuat — tetap tampil walau barang diubah/dihapus admin; pesanan lama tanpa snapshot tampil tanpa gambar.
- [x] Wajib pilih jam: 09.00-10.00, 11.00-12.00, 16.00-17.00, 19.00-20.00; jam tampil di kartu pesanan.
- [x] Bayar pakai saldo (memakai harga spesial bila ada) atau tunai (catatan "Mohon bayar dengan uang pas" di menu bayar dan kartu pesanan). Harga spesial tampil di tiap baris barang di keranjang bila bayar pakai saldo (harga normal dicoret + catatan "Harga spesial saldo"), dan baris barang ikut berubah saat cara bayar diganti; ringkasan sudah memakai harga spesial sejak awal.
- [x] Catatan untuk toko, contoh "cth. Tolong di taruh di kranjang paket".
- [x] Saklar on/off "Gratis ongkir bila bayar pakai saldo" di pengaturan admin (bawaan mati); keranjang menampilkan "GRATIS (bayar pakai saldo)" bila aktif.
- [x] Warga bisa membatalkan pesanan Baru (stok dan saldo dikembalikan); tidak bisa membatalkan bila sudah Diproses (server juga menolak). Konfirmasi batal memakai modal buatan sendiri ("Ya, batalkan pesanan" / "Tidak jadi"), bukan dialog bawaan browser — tidak ada lagi `window.confirm` di kode.
- [x] Admin memproses Baru → Diproses → Selesai; cari pesanan berdasarkan tanggal dan jam; cetak struk per pesanan.
- [x] Admin melihat riwayat transaksi tiap warga terverifikasi (pesanan, top-up, total belanja).

### Chat
- [x] Chat Admin–Warga: kirim teks dan gambar (lampirkan, pratinjau, tampil di gelembung).
- [x] Lencana jumlah pesan belum dibaca di kedua sisi; tertandai terbaca saat percakapan dibuka.
- [x] Pesan baru muncul tanpa refresh (polling 10 detik); teks yang sedang diketik tidak hilang saat polling.

### Toko buka/tutup
- [x] Saklar di Beranda Admin (bawaan buka); saat tutup, warga tidak bisa melihat etalase dan tidak bisa memesan (server menolak pesanan baru).
- [x] Status buka/tutup berubah live tanpa refresh di Warga dan Admin (polling `/api/settings` di semua tab; header, etalase, dan saklar Beranda ikut berubah).

### Loading awal & live update
- [x] Layar loading hijau (#166534) + logo + "Memuat…" + titik berputar tampil sebelum JS jalan di Warga dan Admin, hilang setelah render pertama (bukan layar hitam).
- [x] Live update tanpa refresh (polling 10 detik, hanya bila data berubah, scroll dijaga): pesanan/top-up/verifikasi/chat di Admin; status pesanan, status top-up, saldo, dan chat di Warga; status buka/tutup toko di kedua aplikasi.
- [x] Modal konfirmasi buatan sendiri (`openConfirmModal()` di `common.js`, overlay hijau lembut) menggantikan semua `confirm()` bawaan browser.
- [x] Klik gambar/nama produk di katalog Belanja membuka detail produk (foto besar, harga normal + harga spesial saldo, stok, kategori) dengan pilihan jumlah dan tombol "Tambah ke keranjang"; tombol +/- cepat di kartu tetap berfungsi.
- [x] Menu kategori di Belanja warga: baris chip di atas grid produk — "Semua" plus satu chip per kategori dari barang yang tampil, masing-masing dengan jumlah barangnya; kategori diambil otomatis dari data (kategori baru muncul sendiri, kategori yang barangnya sudah tidak ada hilang sendiri), barang tanpa kategori masuk "Lainnya", kategori barang tersembunyi tidak muncul. Ketuk chip untuk memfilter; pilihan kategori dan isi keranjang tetap saat ganti kategori maupun buka/tutup detail produk; chip bisa digeser horizontal di layar HP.
- [x] Pintasan layar utama (PWA) berlogo tokoku: manifest (`manifest.webmanifest`, nama "tokoku", display standalone, warna tema hijau #166534), ikon persegi latar putih dari logo (192, 512, maskable 512, apple-touch-icon 180), favicon logo, dan service worker minimal TANPA cache (install langsung aktif, hapus cache lama, fetch tidak dicegat) supaya update aplikasi tidak pernah basi. Pasang dari menu browser HP (Chrome: "Tambahkan ke Layar utama").

## Batasan yang diketahui
- Aplikasi Admin dibuka lewat URL `/admin` tanpa kata sandi — siapa pun
  yang tahu tautannya bisa membuka panel admin (sama seperti saklar mode
  tanpa kata sandi di versi gabungan sebelumnya). Untuk pemakaian serius
  jangka panjang, tambahkan PIN/kata sandi admin (lihat PORTING.md,
  "Yang belum ada").
- Server ini satu proses; data live di Turso (libSQL, gratis) sehingga
  bertahan tiap deploy/restart — cocok untuk skala komplek (10–20 warga).
  File `data/tokoku.db` hanya fallback lokal.


## Performa menu (2026-11-14)
- [x] Klik menu cepat: fetch paralel + endpoint lite + cache gambar (produk 2,1 MB → lite <1 KB; pesanan 3,8 MB → lite <1 KB; gambar hanya diunduh sekali per sesi)
- [x] Polling 10 detik tetap live, tidak menumpuk (pollBusy) dan tidak mengunduh ulang gambar
- [x] Foto produk/warga/pesanan/chat tetap tampil; foto baru langsung terlihat lewat polling tanpa refresh

## Keamanan Admin (2026-11-14)
- [x] Login admin: password (hash scrypt + salt, tidak pernah plaintext) + kode authenticator 6 digit (TOTP) bila aktif
- [x] Authenticator: setup secret base32 + entri manual di aplikasi authenticator (tanpa QR pihak ketiga), verifikasi kode untuk mengaktifkan, nonaktifkan wajib password + kode
- [x] Sesi 30 hari (token acak, hanya hash-nya disimpan), muat ulang tetap masuk, tombol Keluar, ubah password (mencabut sesi perangkat lain)
- [x] Kunci 15 menit setelah 5x login gagal; semua endpoint admin 401 tanpa sesi; warga tetap tanpa login
- [x] Password awal publik di-seed dari env Render `ADMIN_PASSWORD_HASH` (lihat PORTING.md); hapus env setelah dipakai
