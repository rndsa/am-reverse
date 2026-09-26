# ⚡ Alight Motion Reverse API — Dokumentasi

API aktivasi Alight Motion Premium otomatis. Magic link dikirim ke email, akun langsung jadi premium.

**Base URL**: `https://v.axjet.xyz`

**Sistem aktivasi Hybrid**: server mencoba provider utama (expiry **1 September 2027**) dulu. Kalau provider utama bermasalah, otomatis pindah ke cadangan — aktivasi tetap sukses, hanya beda tanggal kadaluarsa. Field `engine` di respons menunjukkan yang dipakai: `dhans` (utama) atau `annual` (cadangan).

---

## 🔑 Autentikasi

Semua request dari **luar** (bukan dari Web UI) wajib bawa API Key, lewat salah satu cara:

| Cara | Contoh |
| --- | --- |
| Header | `x-api-key: am-sk-xxxxx` |
| Header Bearer | `Authorization: Bearer am-sk-xxxxx` |
| Query param | `?api_key=am-sk-xxxxx` |

> Kalau pakai **GET**, paling gampang lewat query param: `?email=...&api_key=am-sk-xxxxx`

---

## 📡 Semua Endpoint

### 1. Kirim Magic Link

Kirim link verifikasi ke email (cek inbox/spam).

**GET**
```
GET /api/send-link?email=user@gmail.com&api_key=am-sk-xxxxx
```

**POST** (alternatif)
```json
POST /api/send-link
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

**GET**
```
GET /api/verify?email=user@gmail.com&rawLink=https://alightcreative.com/auth_action/?...oobCode=xxx&api_key=am-sk-xxxxx
```
*(ingat URL-encode magic link-nya)*

**POST** (alternatif)
```json
POST /api/verify
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

**GET**
```
GET /api/provision?email=user@gmail.com&idToken=eyJhbGci...&api_key=am-sk-xxxxx
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
    "engine": "dhans",
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

**GET**
```
GET /api/verify-link?email=user@gmail.com&magicLink=https://alightcreative.page.link/...&api_key=am-sk-xxxxx
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
    "engine": "dhans",
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

**GET**
```
GET /api/reactivate?refreshToken=AM3-vEv...&api_key=am-sk-xxxxx
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
    "engine": "dhans",
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
1. GET /api/send-link?email=budi@gmail.com&api_key=am-sk-xxxxx
2. (budi buka email, salin magic link-nya)
3. GET /api/verify-link?email=budi@gmail.com&magicLink=URL_MAGIC_LINK&api_key=am-sk-xxxxx
   → selesai! premium aktif, respon berisi validUntil.
```

Atau mode manual (verifikasi & aktivasi terpisah):
```
1. GET /api/send-link?email=budi@gmail.com&api_key=am-sk-xxxxx
2. GET /api/verify?email=budi@gmail.com&rawLink=MAGIC_LINK&api_key=am-sk-xxxxx → dapat idToken
3. GET /api/provision?email=budi@gmail.com&idToken=ID_TOKEN&api_key=am-sk-xxxxx → premium aktif
```

---

## 📝 Catatan

* **Magic link hanya berlaku ± 5 menit** dan sekali pakai. Kalau gagal, kirim ulang magic link (langkah 1).
* Field `engine` di respon: `dhans` = jalur utama (expiry 1 September 2027), `annual` = jalur cadangan.
* `expiryTimeMillis` = tanggal kadaluarsa **asli dari server Alight** (bukan perkiraan).
* Web UI di `https://v.axjet.xyz` bisa dipakai tanpa API Key — request dari halaman sendiri gratis.
* Error umum: `401` API key salah/kosong · `400` email/link tidak valid atau magic link kedaluwarsa · `503` layanan sedang dimatikan admin.

---

## 🛠️ Manajemen API Key (Admin)

Gunakan Master API Key untuk mengelola key client:

| Aksi | Endpoint |
| --- | --- |
| Buat key baru | `POST /api/keys` body `{"name": "Bot Telegram"}` |
| Lihat semua key + pemakaian | `GET /api/keys` |
| Cabut key | `DELETE /api/keys/:key` |

Semua pakai header `x-api-key: <MASTER_KEY>`.

Admin panel: `https://v.axjet.xyz/panel-x8k2`
