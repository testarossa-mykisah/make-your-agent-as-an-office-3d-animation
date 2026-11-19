// Katalog role, urutan eksekusi, saran role otomatis, dan template kontribusi
// untuk simulasi orkestrasi lokal. Semua teks kontribusi disusun dari teks
// misi pengguna + template role — tidak ada fakta eksternal yang dikarang.

export const ROLES = [
  "Koordinator Misi",
  "Peneliti",
  "Penalar Logika",
  "Programmer",
  "Penulis dan Perencana",
  "Spesialis Multibahasa",
  "Pengkritik",
  "Editor dan Peringkas",
  "Perancang",
] as const;

export type Role = (typeof ROLES)[number];

// Urutan agen berbicara saat misi berjalan.
export const ROLE_ORDER: Role[] = [
  "Koordinator Misi",
  "Peneliti",
  "Penalar Logika",
  "Programmer",
  "Penulis dan Perencana",
  "Spesialis Multibahasa",
  "Pengkritik",
  "Editor dan Peringkas",
  "Perancang",
];

export function roleRank(role: string): number {
  const i = (ROLE_ORDER as string[]).indexOf(role);
  return i === -1 ? ROLE_ORDER.length : i;
}

// Saran role otomatis berdasarkan kata kunci pada nama model. Pilihan manual
// pengguna tidak pernah ditimpa; saran hanya ditampilkan sebagai chip.
const MODEL_ROLE_HINTS: { match: RegExp; role: Role }[] = [
  { match: /gpt|chatgpt|o[0-9]/i, role: "Koordinator Misi" },
  { match: /claude/i, role: "Programmer" },
  { match: /gemini/i, role: "Peneliti" },
  { match: /muse|spark/i, role: "Penulis dan Perencana" },
  { match: /grok/i, role: "Pengkritik" },
  { match: /deepseek|qwq|r1/i, role: "Penalar Logika" },
  { match: /qwen/i, role: "Spesialis Multibahasa" },
  { match: /mistral|mixtral/i, role: "Editor dan Peringkas" },
  { match: /llama/i, role: "Penulis dan Perencana" },
];

export function suggestRoleForModel(model: string): Role | null {
  for (const hint of MODEL_ROLE_HINTS) {
    if (hint.match.test(model)) return hint.role;
  }
  return null;
}

export const MISSION_PRESETS: { label: string; text: string }[] = [
  {
    label: "Bangun Produk",
    text: "Rancang rencana membangun aplikasi pencatat keuangan pribadi untuk pengguna Indonesia: fitur inti, tahapan pengerjaan, dan risiko terbesarnya.",
  },
  {
    label: "Riset Topik",
    text: "Susun rencana riset tentang tren kerja jarak jauh di Asia Tenggara: pertanyaan kunci, sumber yang perlu diperiksa, dan cara memvalidasi temuan.",
  },
  {
    label: "Tulis Draf",
    text: "Buat kerangka artikel blog tentang kebiasaan pagi yang realistis untuk pekerja kantoran, lengkap dengan sudut pandang dan alur tulisannya.",
  },
  {
    label: "Perbaiki Kode",
    text: "Susun rencana memperbaiki fungsi pencarian yang lambat di aplikasi web: langkah diagnosis, dugaan penyebab, dan cara menguji perbaikannya.",
  },
];

export interface StepDraft {
  headline: string;
  text: string;
}

function clip(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

// Kalimat bubble singkat yang tampil di atas karakter saat giliran bicara.
export const BUBBLES: Record<string, string> = {
  "Koordinator Misi": "Saya susun rencana langkahnya dulu.",
  Peneliti: "Saya petakan pertanyaan risetnya.",
  "Penalar Logika": "Saya urai alur logikanya.",
  Programmer: "Saya rancang sisi teknisnya.",
  "Penulis dan Perencana": "Saya buat kerangka drafnya.",
  "Spesialis Multibahasa": "Saya cek istilah dan bahasanya.",
  Pengkritik: "Saya uji celah dan risikonya.",
  "Editor dan Peringkas": "Saya rangkum jadi hasil akhir.",
  Perancang: "Saya pikirkan bentuk tampilannya.",
};

export function buildContribution(
  role: string,
  mission: string,
  priorHeadlines: string[],
): StepDraft {
  const m = clip(mission, 220);
  switch (role) {
    case "Koordinator Misi":
      return {
        headline: "Rencana langkah misi",
        text:
          `Tujuan misi: ${m}\n` +
          `Langkah kerja yang saya susun:\n` +
          `1. Kunci dulu hasil akhir yang diharapkan dari misi ini, dalam satu kalimat.\n` +
          `2. Kumpulkan bahan dan pertanyaan terbuka sebelum mulai mengerjakan.\n` +
          `3. Kerjakan inti misi mengikuti urutan peran tim: riset, logika, teknis, draf.\n` +
          `4. Uji hasilnya lewat sudut pandang pengkritik, lalu perbaiki titik lemahnya.\n` +
          `5. Tutup dengan ringkasan akhir yang bisa langsung dipakai.`,
      };
    case "Peneliti":
      return {
        headline: "Pertanyaan riset yang perlu dijawab",
        text:
          `Agar misi "${m}" berdiri di atas dasar yang kuat, ini pertanyaan yang harus dijawab lebih dulu:\n` +
          `• Apa konteks dan batasan masalahnya? Siapa yang terdampak?\n` +
          `• Fakta apa yang sudah pasti, dan mana yang masih asumsi?\n` +
          `• Contoh atau pendekatan serupa apa yang sudah pernah dicoba orang lain?\n` +
          `• Bukti apa yang cukup untuk menyatakan hasilnya berhasil?\n` +
          `Catatan: jawaban faktualnya perlu diverifikasi dari sumber nyata di luar simulasi ini.`,
      };
    case "Penalar Logika":
      return {
        headline: "Uraian logika dan urutan keputusan",
        text:
          `Alur berpikir untuk misi ini:\n` +
          `1. Premis: hasil yang diminta adalah "${m}".\n` +
          `2. Pecah premis menjadi sub-masalah yang bisa diputuskan satu per satu.\n` +
          `3. Untuk tiap sub-masalah, urutkan pilihan dari yang paling sedikit risikonya.\n` +
          `4. Periksa rantai sebab-akibat: keputusan awal yang salah akan menggeser semua langkah berikutnya.\n` +
          `5. Kesimpulan sementara: mulai dari sub-masalah dengan ketidakpastian terbesar, karena di situlah nilai pengujian paling tinggi.`,
      };
    case "Programmer":
      return {
        headline: "Rancangan teknis dan checklist pengerjaan",
        text:
          `Sisi teknis misi "${m}" saya susun sebagai checklist:\n` +
          `☐ Tentukan struktur data / bahan masukan yang dibutuhkan.\n` +
          `☐ Buat versi paling sederhana yang sudah bekerja ujung ke ujung.\n` +
          `☐ Tambahkan penanganan kasus tepi: masukan kosong, data tidak valid, kegagalan di tengah jalan.\n` +
          `☐ Uji dengan contoh nyata, bukan hanya contoh ideal.\n` +
          `☐ Catat keputusan teknis dan alasannya agar mudah ditinjau ulang.`,
      };
    case "Penulis dan Perencana":
      return {
        headline: "Kerangka draf hasil",
        text:
          `Kerangka tulisan untuk menyampaikan hasil misi:\n` +
          `Judul kerja: ${clip(mission, 80)}\n` +
          `• Pembuka: masalah atau kebutuhan yang melatarbelakangi misi, dalam 2–3 kalimat.\n` +
          `• Isi: temuan dan langkah utama, disusun dari yang paling penting.\n` +
          `• Bukti pendukung: contoh konkret untuk setiap klaim besar.\n` +
          `• Penutup: kesimpulan dan satu tindakan lanjutan yang jelas untuk pembaca.`,
      };
    case "Spesialis Multibahasa":
      return {
        headline: "Catatan istilah dan bahasa",
        text:
          `Agar hasil misi konsisten bahasanya:\n` +
          `• Gunakan Bahasa Indonesia sebagai bahasa utama, dengan istilah teknis asing ditulis miring atau diberi padanan saat pertama muncul.\n` +
          `• Samakan istilah kunci di seluruh dokumen — satu konsep, satu istilah.\n` +
          `• Hindari kalimat berlapis; satu kalimat satu gagasan, terutama pada bagian instruksi.\n` +
          `• Bila hasil ini diterjemahkan nanti, terjemahkan gagasan per paragraf, bukan kata per kata, supaya nuansanya tidak hilang.`,
      };
    case "Pengkritik":
      return {
        headline: "Risiko dan titik lemah",
        text:
          `Saya uji rencana ini dari sisi sebaliknya:\n` +
          `• Risiko terbesar: ruang lingkup misi "${clip(mission, 90)}" bisa melebar diam-diam. Kunci batasnya sejak awal.\n` +
          `• Asumsi yang belum diuji dianggap fakta — tandai semua asumsi secara eksplisit.\n` +
          `• Tidak ada rencana cadangan bila langkah inti gagal; siapkan alternatif yang lebih sederhana.\n` +
          `• Keberhasilan belum terdefinisi terukur, jadi sulit menyatakan misi selesai.\n` +
          `Selama empat hal ini dijawab, rencananya layak jalan.`,
      };
    case "Perancang":
      return {
        headline: "Konsep bentuk dan pengalaman",
        text:
          `Dari sisi perancangan hasil misi:\n` +
          `• Satu keputusan utama harus terlihat paling menonjol; sisanya mendukung, bukan bersaing.\n` +
          `• Susun informasi dari yang paling sering dibutuhkan ke yang jarang.\n` +
          `• Beri ruang napas: kelompokkan elemen yang berkaitan dan pisahkan yang tidak.\n` +
          `• Pastikan hasil tetap terbaca dan bisa dipakai di layar kecil lebih dulu, baru diperluas ke layar besar.`,
      };
    case "Editor dan Peringkas":
    default:
      return {
        headline: "Sintesis akhir",
        text: buildSynthesis(mission, priorHeadlines),
      };
  }
}

export function buildSynthesis(mission: string, priorHeadlines: string[]): string {
  const lines = priorHeadlines.map((h, i) => `${i + 1}. ${h}`);
  return (
    `Ringkasan akhir misi: ${clip(mission, 220)}\n` +
    (lines.length > 0
      ? `Kontribusi tim yang sudah masuk:\n${lines.join("\n")}\n`
      : "") +
    `Kesimpulan: misi dipecah menjadi langkah yang bisa dikerjakan berurutan — mulai dari perencanaan dan pertanyaan riset, dilanjutkan uraian logika serta rancangan teknis, dibentuk menjadi draf, diuji risikonya, dan ditutup dengan bahasa yang konsisten. Langkah berikutnya: kerjakan butir pertama dari rencana koordinator dan verifikasi fakta dari sumber nyata sebelum hasil ini dipakai.`
  );
}
