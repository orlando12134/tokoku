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
