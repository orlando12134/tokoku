# tokoku — versi publik (di luar Muse)

Aplikasi web toko klontong "tokoku" khusus warga Perum GKR, dibangun ulang
agar bisa dibuka lewat tautan publik dengan database bersama. Satu server
Node.js tanpa dependensi eksternal melayani frontend dan API; data di SQLite.

Versi Muse (artifact slug `toko-klontong`) tetap menjadi tempat pertama
setiap pembaruan dibuat — lihat `PORTING.md` untuk cara memindahkannya ke sini.
Daftar fitur ada di `FITUR.md`.

## Menjalankan lokal

Butuh Node.js 22 atau lebih baru (memakai `node:sqlite` bawaan).

```bash
cd toko-klontong-publik
node server.js
# buka http://localhost:3000
```

Database dibuat otomatis di `data/tokoku.db` (kosong saat pertama jalan).
Variabel lingkungan: `PORT` (default 3000), `DB_PATH` (default
`data/tokoku.db` — isi dengan path disk persisten saat deploy).

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

**Peringatan data — baca sebelum memakai serius:**
- Paket **Free Render memakai filesystem ephemeral**: database SQLite
  hilang setiap deploy/restart. Cocok untuk uji coba, TIDAK untuk
  pemakaian serius.
- Supaya data bertahan, perlu paket **Starter (berbayar, sekitar
  $7/bulan)** + **Persistent Disk** (mount path mis. `/var/data`, lalu
  set env `DB_PATH=/var/data/tokoku.db`), atau pakai PostgreSQL
  terkelola Render.
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
server.js            Server + API + SQLite (tanpa dependensi)
public/warga.html    Aplikasi Warga (rute /)
public/warga.js      Logika aplikasi Warga
public/admin.html    Aplikasi Admin (rute /admin)
public/admin.js      Logika aplikasi Admin
public/common.js     Kode bersama (API, toast, modal, chat)
public/index.html    Pengalihan ke / (aplikasi Warga)
public/style.css     Tampilan mobile-first
public/logo.png      Logo keranjang hijau TOKOKU
public/qris.jpg      Kode QRIS (Toko Khayla)
data/tokoku.db       Database (dibuat otomatis; kosong di awal)
FITUR.md             Daftar fitur versi publik
PORTING.md           Cara memindahkan perubahan dari versi Muse
render.yaml          Blueprint Render (lihat peringatan data di atas)
```
