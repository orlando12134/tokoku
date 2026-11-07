# tokoku — versi publik (di luar Muse)

Aplikasi web toko klontong "tokoku" khusus warga Perum GKR, dibangun ulang
agar bisa dibuka lewat tautan publik dengan database bersama. Satu server
Node.js melayani frontend dan API; data tinggal di Turso (libSQL, gratis)
bila env `TURSO_DATABASE_URL` tersedia, bila tidak di file SQLite lokal.

Versi Muse (artifact slug `toko-klontong`) tetap menjadi tempat pertama
setiap pembaruan dibuat — lihat `PORTING.md` untuk cara memindahkannya ke sini.
Daftar fitur ada di `FITUR.md`.

## Menjalankan lokal

Butuh Node.js 22 atau lebih baru.

```bash
cd toko-klontong-publik
npm install
node server.js
# buka http://localhost:3000
```

Tanpa env Turso, database dibuat otomatis di `data/tokoku.db` (kosong saat
pertama jalan) — hanya untuk pengembangan/uji lokal. Variabel lingkungan:
`PORT` (default 3000), `DB_PATH` (default `data/tokoku.db`, hanya untuk
fallback lokal), `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` (pakai Turso
jarak jauh — inilah yang dipakai di Render, supaya data tidak hilang
saat deploy).

## Deploy ke URL publik

**Status: LIVE sejak 2026-11-06 23:20 WIB** di
**https://tokoku-a642.onrender.com** (Render Free, region Singapore,
repo GitHub `orlando12134/tokoku`, branch `main`).

### Jalur yang disarankan: Render (paling sederhana)

1. Buat akun **GitHub** (gratis) dan akun **Render** (gratis, bisa daftar
   memakai akun GitHub).
2. Push folder ini ke repo GitHub (mis. nama repo `tokoku`).
3. Di dashboard Render: **New → Web Service** → hubungkan repo GitHub.
   - Runtime: `Node`
   - Build Command: `npm install`
   - Start Command: `node server.js`
   - Plan: `Free` untuk coba-coba (lihat peringatan data di bawah).
4. URL publik menjadi `https://tokoku.onrender.com` (nama bisa dipilih
   saat pembuatan service; angka acak ditambahkan Render bila nama sudah
   dipakai).

**Data aman saat deploy (sejak migrasi Turso 2026-11-08):**
- Data live tinggal di **Turso (libSQL, gratis)** — bukan lagi di file
  SQLite di Render. Deploy/restart **tidak lagi menghapus data**:
  barang, warga, pesanan, dan saldo tetap ada setelah update.
- Env `TURSO_DATABASE_URL` dan `TURSO_AUTH_TOKEN` sudah tersimpan di
  Render (dashboard → service `tokoku` → Environment). **Jangan
  membagikan token itu** — siapa pun yang memegangnya bisa membaca
  dan mengubah seluruh data toko.
- **Backup berkala tetap disarankan** (bukan lagi wajib sebelum tiap
  deploy): sesekali salin isi database Turso lewat dashboard Turso
  (atau `sqld`/CLI Turso) dan simpan salinannya di tempat aman.
  Jangan menambahkan endpoint unduh database tanpa pengaman — Admin
  saat ini tanpa kata sandi.
- Dulu (sebelum 2026-11-08) paket Free Render memakai filesystem
  ephemeral sehingga database SQLite hilang setiap deploy/restart;
  pada 2026-11-07 malam barang dan warga yang sudah dimasukkan hilang
  karena deploy tanpa backup. Masalah itu selesai dengan Turso —
  file `data/tokoku.db` sekarang hanya fallback lokal.
- Supaya data bertahan, **tidak perlu lagi** paket Starter berbayar +
  Persistent Disk — Turso gratis sudah menanganinya.
- Paket Free juga "tidur" setelah 15 menit tanpa kunjungan; kunjungan
  pertama setelah itu lambat (±30–60 detik) sampai server bangun.

### Alternatif: Railway

Serupa dengan Render (Web Service dari repo GitHub, `node server.js`),
dengan volume persisten. Paket gratis berupa kredit percobaan, setelah
itu berbayar sesuai pemakaian. Cocok bila Andrik lebih nyaman dengan
Railway daripada Render.

### Tidak disarankan: Vercel/Netlify untuk arsitektur ini

Keduanya serverless — SQLite lokal tidak bertahan antar request, jadi
perlu database eksternal (mis. Supabase Postgres gratis) dan penulisan
ulang lapisan database. Hanya dipilih bila Andrik memang mau jalur itu.

## Uji lokal (ringkasan hasil 2026-11-08 — migrasi database ke Turso)

Diuji end-to-end lewat HTTP + browser Chromium headless (lebar HP 390px)
terhadap server lokal (database uji terpisah di /tmp, sudah dihapus;
database produksi tidak tersentuh, hash SHA-256 tetap
`ced51d79b366e536fe4fcb16057d57aa2cd890b6315788749477c52ca0ffdfd0`):
**60 pemeriksaan API lulus (22 dari skrip lama + 38 tambahan), 31
pemeriksaan browser lulus, 0 gagal.**

- Semua endpoint `/api/*` berperilaku identik setelah migrasi
  (format respons, kode status, pesan error sama): settings default;
  daftar warga (dengan foto profil) → verifikasi → top-up → setujui →
  belanja saldo (harga spesial) + tunai → batalkan pesanan (saldo & stok
  kembali) → chat teks + gambar + lencana belum dibaca → status toko
  tutup memblokir order → ubah ongkir → gratis ongkir saldo → struk
  (memuat "Mohon bayar dengan uang pas") → pencarian pesanan by tanggal/
  jam → riwayat warga → penolakan warga/top-up dengan alasan → blokir
  top-up duplikat saat pending → daftar ulang nomor sama kembali ke akun
  lama.
- Transaksi tetap atomik (buat pesanan: simpan order + kurangi stok +
  potong saldo; batalkan: kembalikan stok + saldo; setujui top-up:
  tambah saldo) — sekarang via `client.transaction('write')` libsql.
- Restart server dengan DB file yang sama: data tetap utuh (5 warga,
  5 pesanan, 4 produk, settings) — tidak ada yang hilang.
- Cabang env Turso diuji dengan `TURSO_DATABASE_URL=file:...` (tanpa
  token): server mencatat "Database: Turso (remote)" dan API berjalan
  normal — jalur kode yang sama dengan Turso jarak jauh; yang belum
  bisa diuji lokal hanyalah round-trip jaringan ke Turso (token tidak
  tersedia di lingkungan uji) — itu diverifikasi setelah deploy live.
- Migrasi DB lama: database tanpa kolom `photo` tetap terbaca
  (`photo: null`), kolom ditambah otomatis, update foto ke warga lama
  berhasil.
- Browser 390px: foto profil (daftar, Admin, Akun, ganti foto), status
  toko live tanpa refresh, modal batalkan pesanan (0 dialog bawaan),
  tanpa overflow horizontal.
- Satu-satunya perubahan perilaku yang disengaja: `GET /api/chat/threads`
  kini memakai 3 query gabungan (bukan N+1 per warga) supaya polling
  tetap cepat lewat Turso jarak jauh; bentuk responsnya sama persis.

## Uji lokal (ringkasan hasil 2026-11-08 — 3 perbaikan: status toko live, foto profil, modal konfirmasi)

Diuji end-to-end lewat HTTP + browser Chromium headless (lebar HP 390px)
terhadap server lokal di port 3101 (database uji terpisah, sudah dihapus;
database produksi tidak tersentuh, hash SHA-256 tetap
`ced51d79b366e536fe4fcb16057d57aa2cd890b6315788749477c52ca0ffdfd0`):
**22 pemeriksaan API lulus, 31 pemeriksaan browser lulus, 0 gagal.**
Migrasi aman juga diuji terpisah: database lama tanpa kolom `photo`
tetap terbaca (warga lama tampil `photo: null`), kolom ditambah otomatis,
dan update foto ke warga lama berhasil.

- Status toko live: admin menutup toko lewat saklar Beranda → warga
  (tanpa refresh, lewat polling) langsung "Toko Tutup" + etalase hilang;
  dibuka lagi → "Toko Buka" + etalase muncul. Sebaliknya: ubah via API
  → header Admin (tab Warga) dan saklar Beranda ikut berubah setelah
  polling.
- Foto profil: daftar dengan foto (pratinjau tampil) → tersimpan di
  server; foto tampil di daftar warga Admin, riwayat warga (+ info
  saldo), dan daftar chat; warga tanpa foto tampil inisial (mis. "SA");
  ganti foto di Akun → foto baru tampil di Akun dan di Admin setelah
  polling; hapus foto dan update profil via `PUT /api/warga/:id/profile`
  teruji via API.
- Modal batalkan pesanan: klik "Batalkan pesanan" membuka modal buatan
  sendiri (overlay hijau lembut, "Ya, batalkan pesanan" / "Tidak jadi",
  tanpa dialog bawaan browser — 0 event dialog tercatat); "Tidak jadi"
  menutup modal dan pesanan tetap Baru; "Ya, batalkan pesanan" →
  Dibatalkan, saldo Budi kembali Rp100.000, stok Gula kembali 10.
- Lebar HP 390px: tidak ada overflow horizontal di Warga maupun Admin.

## Uji lokal (ringkasan hasil 2026-11-07 malam — 5 perbaikan dari versi Muse)

Diuji end-to-end lewat HTTP + browser Chromium headless (lebar HP 390px)
terhadap server lokal di port 3100 (database uji terpisah, sudah dihapus;
database produksi tetap kosong, hash tidak berubah): **22 pemeriksaan
browser lulus, 0 gagal.**

- Splash awal Warga & Admin: layar hijau #166534 + logo + "Memuat…" +
  tiga titik berputar (animasi `splash-spin`) tampil sebelum JS jalan,
  hilang setelah render pertama; bukan layar hitam.
- Live update tanpa refresh (polling 10 detik, maks tunggu ~15 detik):
  pesanan baru warga muncul di Admin; status pesanan diubah admin ke
  Diproses berubah di Warga; pengajuan top-up baru terlihat di Warga dan
  saldo berubah Rp100.000 → Rp150.000 setelah disetujui; pesan chat admin
  muncul di Warga; pendaftaran warga baru muncul di Admin; teks yang
  sedang diketik di chat tidak hilang saat polling.
- Teks peringatan saldo tampil persis: "Saldo tokoku tidak dapat di uangkan kembali. Saldo hanya bisa di pakai untuk belanja di tokoku, jadi isi secukupnya sesuai kebutuhan belanja Kamu".
- Gambar tampil di Pesanan Saya (Warga) dan Pesanan (Admin); setelah
  barang diubah admin (nama + gambar baru), pesanan tetap menampilkan
  gambar dan nama snapshot lama.
- Klik gambar produk → detail (foto besar, Rp17.000 + harga saldo
  Rp15.000, stok 20) → pilih jumlah 3 → tambah ke keranjang (badge 3);
  tombol +/- cepat di kartu tetap berfungsi (badge 3 → 4).
- Lebar HP 390px: tidak ada overflow horizontal di Warga maupun Admin.

## Uji lokal (ringkasan hasil 2026-11-07 — setelah pemisahan Warga/Admin)

Diuji end-to-end lewat HTTP + browser Chromium headless (lebar HP 390px)
terhadap server lokal (database uji terpisah, sudah dihapus; database
produksi tetap kosong): **69 pemeriksaan API lulus, 66 pemeriksaan browser
lulus, 0 gagal.**

- Modal tidak muncul saat load di kedua aplikasi; tombol Tutup dan klik di
  luar kotak menutup modal (alasan penolakan, riwayat transaksi).
- Warga: daftar → verifikasi admin → top-up Rp100.000 → disetujui → saldo
  Rp100.000; top-up kedua saat masih pending ditolak; daftar ulang nomor
  sama → akun lama, tanpa akun ganda; log in nomor tak dikenal → tidak
  ditemukan.
- Pesanan saldo 1× Beras (harga spesial Rp55.000) + antar: total
  Rp57.000 (ongkir Rp2.000), saldo tersisa Rp43.000.
- Pesanan tunai ambil dibatalkan saat Baru → status dibatalkan (stok
  kembali); batal saat Diproses ditolak; tombol Batalkan hanya tampil
  untuk status Baru.
- Gratis ongkir saldo menyala → pesanan saldo antar ongkir Rp0;
  pesanan tunai tetap kena ongkir; ongkir diubah ke Rp3.000 berlaku untuk
  order baru.
- Toko ditutup → pesanan ditolak dan warga melihat "Maaf, tokoku sedang
  tutup"; dibuka lagi normal.
- Chat teks + gambar terkirim; lencana belum dibaca 2 → 0 setelah
  dibaca admin, dan sebaliknya; pratinjau thread menampilkan teks pesan.
- Struk pesanan tunai memuat "Mohon bayar dengan uang pas".
- Cari pesanan berdasarkan tanggal dan jam berfungsi; riwayat warga
  menampilkan pesanan, top-up, dan total belanja.
- Penolakan warga dan top-up dengan alasan tersimpan dan tampil saat log in.
- Halaman `/`, `/admin`, `common.js`, `warga.js`, `admin.js`, logo, dan
  QRIS terlayani (HTTP 200); tidak ada URL eksternal/CDN di frontend.
- Lebar HP 390px: tidak ada overflow horizontal; kartu produk terakhir
  dan bilah keranjang tampil utuh di atas nav bawah; tagline header tidak
  terpotong.

Catatan: uji browser memakai Chromium biasa pada lebar 390px. Emulasi
`isMobile:true` di headless shell menimbulkan artefak (layout viewport
membesar jadi 892px setelah reload) sehingga klik Playwright pada nav
bawah gagal padahal hit-test JS menemukan tombolnya — itu artefak harness,
bukan bug aplikasi. Minta Andrik mencoba di HP-nya sebelum mengumumkan
ke warga — sesuai skill `app_creation_phone_check`.

## Struktur

```
server.js            Server + API + database Turso (libSQL) / file lokal
package.json         Satu-satunya dependensi: @libsql/client
package-lock.json    Versi dependensi yang terkunci (ikut di-push)
public/warga.html    Aplikasi Warga (rute /)
public/warga.js      Logika aplikasi Warga
public/admin.html    Aplikasi Admin (rute /admin)
public/admin.js      Logika aplikasi Admin
public/common.js     Kode bersama (API, toast, modal, chat)
public/index.html    Pengalihan ke / (aplikasi Warga)
public/style.css     Tampilan mobile-first
public/logo.png      Logo keranjang hijau TOKOKU
public/qris.jpg      Kode QRIS (Toko Khayla)
data/tokoku.db       Database file lokal — HANYA fallback dev/uji lokal;
                     data live tinggal di Turso (lihat di atas)
FITUR.md             Daftar fitur versi publik
PORTING.md           Cara memindahkan perubahan dari versi Muse
render.yaml          Blueprint Render (lihat peringatan data di atas)
```
