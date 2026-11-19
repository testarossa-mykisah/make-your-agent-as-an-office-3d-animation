# Space 3D Agen

Kantor 3D interaktif (Three.js) tempat delapan agen model AI dari berbagai
provider bekerja sebagai karakter voxel humanoid. Beri mereka sebuah misi,
dan mereka menjalankannya bergiliran — berjalan ke meja masing-masing,
duduk, dan mengetik di laptop. Saat tidak ada job, mereka ngopi, main game,
ngobrol santai, peregangan, cek ponsel, atau jalan santai di sekitar kantor.

> **Simulasi orkestrasi lokal — bukan panggilan API provider.** Misi
> dijalankan sebagai simulasi di sisi aplikasi: tidak ada API key, tidak ada
> panggilan ke provider mana pun, dan kontribusi tiap agen diturunkan dari
> teks misi plus template per-role. Jangan menganggap hasilnya sebagai
> keluaran model yang sebenarnya.

## Agen bawaan (8)

| Provider | Model | Role |
| --- | --- | --- |
| OpenAI | GPT-5 | Koordinator Misi |
| Anthropic | Claude Sonnet 4.5 | Programmer |
| Google | Gemini 2.5 Pro | Peneliti |
| Meta | Muse Wonder | Penulis dan Perencana |
| xAI | Grok 4 | Pengkritik |
| DeepSeek | DeepSeek R1 | Penalar Logika |
| Alibaba | Qwen3-Max | Spesialis Multibahasa |
| Mistral | Mistral Large | Editor dan Peringkas |

Ada 9 pilihan role. Role disarankan otomatis saat model berubah, tapi
pilihan manual tetap dipertahankan.

## Fitur

- **Misi:** 4 preset (Bangun Produk, Riset Topik, Tulis Draf, Perbaiki Kode)
  atau misi bebas. Agen bekerja berurutan sesuai urutan role, dengan log
  berwaktu, timer durasi, tombol Stop, hasil akhir yang bisa disalin, dan
  riwayat misi yang tersimpan.
- **Roster:** aktif/nonaktif per agen, instruksi kustom per agen, tambah
  agen kustom, reset roster, hapus agen (per agen dengan dialog konfirmasi,
  atau hapus massal lewat checkbox — minimal 1 agen harus tersisa, dan
  hapus dinonaktifkan selama misi berjalan). Riwayat misi tidak ikut
  terhapus saat agen dihapus.
- **Latar Luar (3 tema):** Gunung Fuji, Burj Khalifa, dan Luar Angkasa.
  Setiap tema mengubah interior kantor, furnitur, dan pencahayaan — dan
  sebuah panorama silinder raksasa mengelilingi seluruh ruangan dengan
  lukisan tema aktif, sehingga pemandangan terlihat ke segala arah saat
  kamera diputar 360°. Pilihan tema tersimpan dan bertahan setelah reload,
  dan bisa diganti di tengah misi tanpa mereset misi. Semua pemandangan
  dan tekstur dibuat prosedural di kode (tanpa gambar eksternal).
- **Kamera:** orbit 360° penuh (sudut vertikal dibatasi agar tidak menembus
  lantai), zoom, tombol Reset Kamera, dan rotasi dengan tombol panah saat
  kanvas fokus. Label nama agen pendek satu baris, ditumpuk otomatis saat
  bertumpuk dan dijepit ke dalam kanvas.
- **Animasi santai:** tombol Jeda/Lanjutkan Animasi Santai membekukan hanya
  gerakan idle, bukan animasi kerja.

## Teknologi

- Client: React 19 + TypeScript, Three.js, Tailwind CSS 4, TanStack Query
- Server: server actions TypeScript, Drizzle ORM + SQLite (libSQL)
- Build: Bun (`client/build.mjs`, `bun build` untuk server)
- Migrasi database: `drizzle/0001_initial.sql`,
  `drizzle/0002_agents_and_mission_runs.sql`,
  `drizzle/0003_add_settings_table.sql`

## Menjalankan

Repo ini adalah **Muse/Hatch TypeScript space** (`space.json`, runtime
`typescript`). Cara menjalankannya adalah sebagai space di dalam runtime
Hatch/Muse — bukan sebagai server standalone. Dependensi
`@hatch/space-sdk` di `package.json` mengarah ke instalasi Hatch
(`file:/opt/hatch/skills/spaces/ts-runtime/dist/space-sdk.tgz`), dan
entry point runtime adalah `client/dist/index.html`.

```bash
bun install
bun run typecheck   # tsc client + server
bun run build       # build server lalu client
```

Data roster, riwayat misi, dan tema tersimpan di database SQLite yang
dikelola runtime (file `app.db` tidak disertakan di repo ini).

## Struktur

```text
client/src/App.tsx        # UI utama: roster, misi, riwayat, pemilih tema
client/src/Plaza3D.tsx    # scene Three.js: kantor, karakter voxel, panorama
client/src/characters.ts  # definisi karakter voxel per agen
client/src/catalog.ts     # katalog provider/model/role
client/src/api.ts         # pemanggilan server actions
server/src/actions.ts     # actions: roster, misi, riwayat, tema
server/src/schema.ts      # skema Drizzle
drizzle/                  # migrasi SQL
```
