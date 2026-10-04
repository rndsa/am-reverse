# ⚡ Alight Motion Reverse API — Dokumentasi

API aktivasi Alight Motion Premium otomatis. Magic link dikirim ke email, akun langsung jadi premium.

**Base URL**: `https://v.axjet.xyz`

**Sistem aktivasi Hybrid**: server mencoba provider utama (expiry **1 September 2027**) dulu. Kalau provider utama bermasalah, otomatis pindah ke cadangan — aktivasi tetap sukses, hanya beda tanggal kadaluarsa. Field `engine` di respons menunjukkan yang dipakai: utama atau cadangan.

---

## 🔑 Autentikasi

Semua request dari **luar** (bukan dari Web UI) wajib bawa API Key, lewat salah satu cara:

| Cara | Contoh |
| --- | --- |
| Header | `x-api-key: am-sk-xxxxx` |
| Header Bearer | `Authorization: Bearer am-sk-xxxxx` |
| ~~Query param~~ | ❌ **DILARANG** — `?api_key=` bocor ke log/Referer/riwayat |

> ⚠️ **Kredensial lewat URL DILARANG.** API key di query string bisa kecatat di log server,
> riwayat browser, dan header Referer. **Selalu** kirim lewat header. Contoh lama yang memakai
> `?api_key=` sudah **tidak berfungsi** (menerima 401).

---

## 📡 Semua Endpoint

### 1. Kirim Magic Link

Kirim link verifikasi ke email (cek inbox/spam).

**POST**
```json
POST /api/send-link
Header: x-api-key: am-sk-xxxxx
{ "email": "user@gmail.com" }
```

**Response**
```json
{
  "success": true,
  "email": "user@gmail.com",
  "message": "link dikirim ke user@gmail.com. cek inbox / spam."
}
```

---

### 2. Verifikasi Magic Link (ambil token)

Tukar magic link dari email dengan token akun. Param `rawLink` menerima URL lengkap dari email, atau cuma kode `oobCode`-nya saja.

**POST**
```json
POST /api/verify
Header: x-api-key: am-sk-xxxxx
{ "email": "user@gmail.com", "rawLink": "https://alightcreative.page.link/...?oobCode=xxx" }
```

**Response**
```json
{
  "success": true,
  "message": "magic link valid, token berhasil didapat.",
  "data": {
    "email": "user@gmail.com",
    "uid": "5ThOmXr3...",
    "isNewUser": true,
    "idToken": "eyJhbGci...",
    "refreshToken": "AM3-vEv...",
    "profile": { ... }
  }
}
```

> Simpan `idToken` & `refreshToken`. `idToken` dipakai untuk langkah 3, `refreshToken` untuk langkah 5.

---

### 3. Aktivasi Premium

Aktifkan premium pakai `idToken` dari langkah 2.

**POST**
```json
POST /api/provision
Header: x-api-key: am-sk-xxxxx
{ "email": "user@gmail.com", "idToken": "eyJhbGci..." }
```

**POST** (alternatif)
```json
POST /api/provision
{ "email": "user@gmail.com", "idToken": "eyJhbGci..." }
```

**Response**
```json
{
  "success": true,
  "message": "premium berhasil diaktifkan.",
  "data": {
    "engine": "standard",
    "status": "ACTIVE",
    "membershipStatus": "PREMIUM_ACTIVE",
    "planName": "Alight Motion Pro / Member",
    "subscriptionType": "Yearly VIP License (hybrid)",
    "orderId": "neo-...",
    "expiryTimeMillis": 1819796995395,
    "validUntil": "1 September 2027",
    "validUntilTimestamp": 1819796995395,
    "stats": { "total": 296, "today": 2 }
  }
}
```

---

### 4. Auto Flow: Verifikasi + Aktivasi Sekaligus

Gabungan langkah 2 + 3 dalam satu panggilan — paling praktis untuk bot.

**POST**
```json
POST /api/verify-link
Header: x-api-key: am-sk-xxxxx
{ "email": "user@gmail.com", "magicLink": "https://alightcreative.page.link/..." }
```
*(alias param link: `magicLink`, `rawLink`, `link`, `url`, `code`)*

**POST** (alternatif)
```json
POST /api/verify-link
{ "email": "user@gmail.com", "magicLink": "https://alightcreative.page.link/...?oobCode=xxx" }
```

**Response**
```json
{
  "success": true,
  "message": "verifikasi berhasil, premium aktif.",
  "data": {
    "engine": "standard",
    "uid": "GSyZUOi...",
    "email": "user@gmail.com",
    "status": "ACTIVE",
    "membershipStatus": "PREMIUM_ACTIVE",
    "expiryTimeMillis": 1819796995395,
    "validUntil": "1 September 2027",
    "validUntilTimestamp": 1819796995395,
    "idToken": "eyJhbGci...",
    "refreshToken": "AM3-vEv...",
    "profile": { ... }
  }
}
```

---

### 5. Perpanjang via Refresh Token

Refresh token akun + re-aktivasi premium. Berguna kalau `idToken` kedaluwarsa (umur ± 1 jam).

**POST**
```json
POST /api/reactivate
Header: x-api-key: am-sk-xxxxx
{ "refreshToken": "AM3-vEv..." }
```

**POST** (alternatif)
```json
POST /api/reactivate
{ "refreshToken": "AM3-vEv..." }
```

**Response**
```json
{
  "success": true,
  "message": "Token berhasil di-refresh dan premium diperpanjang.",
  "data": {
    "engine": "standard",
    "status": "ACTIVE",
    "idToken": "eyJhbGci...",
    "refreshToken": "AM3-vEv..."
  }
}
```

---

### 6. Status & Statistik (Publik, tanpa key)

```
GET /api/status   → { "status": "online", "timestamp": "..." }
GET /api/stats    → { "success": true, "total": 296, "today": 2 }
```

---

## 🔄 Urutan Lengkap (contoh nyata)

```
1. POST /api/send-link  {email: budi@gmail.com}
2. (budi buka email, salin magic link-nya)
3. POST /api/verify-link  {email: budi@gmail.com, magicLink: URL_MAGIC_LINK}
   → selesai! premium aktif, respon berisi validUntil.
```

Atau mode manual (verifikasi & aktivasi terpisah):
```
1. POST /api/send-link  {email: budi@gmail.com}
2. POST /api/verify  {email: budi@gmail.com, rawLink: MAGIC_LINK} → dapat idToken
3. POST /api/provision  {email: budi@gmail.com, idToken: ID_TOKEN} → premium aktif
```

---

## 📝 Catatan

* **Magic link hanya berlaku ± 5 menit** dan sekali pakai. Kalau gagal, kirim ulang magic link (langkah 1).
* Field `engine` di respon: utama = jalur utama (expiry 1 September 2027), cadangan = jalur cadangan otomatis.
* `expiryTimeMillis` = tanggal kadaluarsa **asli dari server Alight** (bukan perkiraan).
* Web UI di `https://v.axjet.xyz` bisa dipakai tanpa API Key — request dari halaman sendiri gratis.
* Error umum: `401` API key salah/kosong · `400` email/link tidak valid atau magic link kedaluwarsa · `503` layanan sedang dimatikan admin.

---

## 🛠️ Manajemen API Key (Admin)

> ⚠️ **Penting:** sejak pemisahan hak, **Master API Key TIDAK bisa lagi** mengakses endpoint admin
> (akan menerima `403`). Endpoint admin hanya menerima **Admin Key** (`am-adm-...`) atau
> **token sesi** hasil login panel.

| Aksi | Endpoint |
| --- | --- |
| Login panel | `POST /api/keys/login` body `{"password": "..."}` → dapat token sesi |
| Buat key baru | `POST /api/keys` body `{"name": "Bot Telegram"}` |
| Lihat semua key + pemakaian | `GET /api/keys` |
| Cabut key | `DELETE /api/keys/:key` |

Semua pakai header `x-master-key: am-adm-xxxxx` (atau `Authorization: Bearer am-adm-xxxxx`),
atau `x-admin-password: <token sesi>` setelah login.

**Master API Key** (`am-sk-...`) hanya untuk memanggil endpoint aktivasi, **bukan** untuk admin.

Admin panel: `https://v.axjet.xyz/panel-x8k2`
