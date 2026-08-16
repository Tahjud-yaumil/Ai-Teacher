import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const KBC_OPTIONS = [
  'Cinta kepada Allah',
  'Cinta kepada Rasul',
  'Cinta kepada Diri Sendiri',
  'Cinta kepada Sesama',
  'Cinta kepada Lingkungan',
  'Cinta kepada Bangsa dan Negara',
];

const LDI_OPTIONS = ['Alquran', 'Fiqih', 'Aqidah', 'SKI'];

function env(name) {
  return typeof process.env[name] === 'string' ? process.env[name].trim() : '';
}

function dbClient() {
  const url = env('DATABASE_URL') || env('POSTGRES_PRISMA_URL') || env('POSTGRES_URL') || env('DATABASE_URL_UNPOOLED');
  if (!url) throw new Error('DATABASE_URL belum tersedia.');
  return neon(url);
}

function dayName(date) {
  return new Intl.DateTimeFormat('id-ID', { weekday: 'long', timeZone: 'Asia/Jakarta' }).format(new Date(`${date}T00:00:00+07:00`));
}

function shortSchool(school) {
  if (school === 'MTs Darun Najah Gading') return 'Darun Najah';
  if (school === 'MTs Brawijaya Kota Mojokerto') return 'Brawijaya';
  return String(school || '').replace(/^MTs\s+/i, '').trim() || 'Sekolah';
}

function headMaster(school) {
  if (school === 'MTs Darun Najah Gading') return 'Zainuri, S.Pd., M.Pd.I';
  if (school === 'MTs Brawijaya Kota Mojokerto') return 'Elya Husniati, S.Pd (NIP. 198003042005012002)';
  return '';
}

function outputFolder(mapel, school) {
  if (mapel === 'IPS' && school === 'MTs Darun Najah Gading') return 'AI Teacher/Output/IPS/MTs Darun Najah';
  if (mapel === 'IPS' && school === 'MTs Brawijaya Kota Mojokerto') return 'AI Teacher/Output/IPS/MTs Brawijaya';
  if (mapel === 'IPA') return 'AI Teacher/Output/IPA';
  if (mapel === 'Informatika') return 'AI Teacher/Output/Informatika';
  return 'AI Teacher/Output/Ekstrakurikuler';
}

function envAiProvider() {
  if (env('GEMINI_API_KEY')) return 'gemini';
  if (env('OPENAI_API_KEY')) return 'openai';
  return null;
}

function extractGeminiText(data) {
  return (data?.candidates || [])
    .flatMap(c => c?.content?.parts || [])
    .map(p => p?.text || '')
    .join('\n')
    .trim();
}

function extractOpenAIText(data) {
  return data?.choices?.[0]?.message?.content?.trim() || '';
}

function parseJson(text) {
  const cleaned = String(text || '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  return JSON.parse(cleaned);
}

function pickAllowed(value, options, fallback) {
  const text = String(value || '').trim();
  return options.includes(text) ? text : fallback;
}

function defaultKbc(mapel) {
  if (mapel === 'IPA') return 'Cinta kepada Diri Sendiri';
  if (mapel === 'IPS') return 'Cinta kepada Sesama';
  if (mapel === 'Informatika') return 'Cinta kepada Diri Sendiri';
  return 'Cinta kepada Sesama';
}

function defaultLdi(mapel) {
  if (mapel === 'IPA') return 'Alquran';
  if (mapel === 'IPS') return 'SKI';
  return 'Alquran';
}

function markdownTable(rows, headers) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const lines = [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
  ];
  for (const row of safeRows) lines.push(`| ${headers.map(h => String(row?.[h] ?? '')).join(' | ')} |`);
  return lines.join('\n');
}

function listMarkdown(items) {
  return (Array.isArray(items) ? items : []).map(x => `- ${x}`).join('\n');
}

function buildDocumentMarkdown(doc, c) {
  const ident = c.identitas || {};
  const tujuan = c.tujuan_pembelajaran || [];
  const profil = c.profil_pelajar_pancasila || [];
  const pemahaman = c.pemahaman_bermakna || [];
  const pemantik = c.pertanyaan_pemantik || [];
  const materi = c.materi_inti || [];
  const kegiatan = Array.isArray(c.kegiatan_pembelajaran) ? c.kegiatan_pembelajaran : [];
  const lkpd = c.lkpd || {};
  const diagnostik = c.asesmen_diagnostik || [];
  const formatif = c.asesmen_formatif || [];
  const rubrik = Array.isArray(c.rubrik_penilaian) ? c.rubrik_penilaian : [];
  const kunci = Array.isArray(c.kunci_jawaban) ? c.kunci_jawaban : [];
  const tugas = Array.isArray(c.tugas_rumah) ? c.tugas_rumah : [];
  const catatan = Array.isArray(c.catatan_guru) ? c.catatan_guru : [];
  const alokasi = doc.jam && doc.jam.includes('-') ? doc.jam : '';

  const identitasRows = [
    { Aspek: 'Sekolah', Keterangan: doc.sekolah },
    { Aspek: 'Kepala Madrasah', Keterangan: doc.kepala_madrasah },
    { Aspek: 'Mapel', Keterangan: doc.mapel },
    { Aspek: 'Kelas', Keterangan: doc.kelas },
    { Aspek: 'Alokasi Waktu', Keterangan: alokasi || 'Disesuaikan dengan jadwal' },
    { Aspek: 'Pertemuan', Keterangan: String(doc.pertemuan) },
    { Aspek: 'Bab', Keterangan: doc.bab },
    { Aspek: 'Subbab', Keterangan: doc.subbab },
  ];
  if (doc.tema_kbc) identitasRows.push({ Aspek: 'Tema Kurikulum Berbasis Cinta', Keterangan: doc.tema_kbc });
  if (doc.lintas_disiplin_ilmu) identitasRows.push({ Aspek: 'Lintas Disiplin Ilmu', Keterangan: doc.lintas_disiplin_ilmu });

  const kegiatanRows = kegiatan.length ? kegiatan : [
    { Tahap: 'Pendahuluan', 'Aktivitas Guru': 'Membangun kesiapan belajar, menyampaikan tujuan, dan mengaitkan materi dengan pengalaman murid.', 'Aktivitas Siswa': 'Menjawab pertanyaan awal dan menyampaikan pengalaman atau pengetahuan awal.', Waktu: '10 menit' },
    { Tahap: 'Inti', 'Aktivitas Guru': 'Memfasilitasi observasi/eksplorasi, diskusi, analisis, dan penguatan konsep.', 'Aktivitas Siswa': 'Mengamati, menganalisis, berdiskusi, mengerjakan LKPD, dan menyampaikan hasil.', Waktu: '40 menit' },
    { Tahap: 'Penutup', 'Aktivitas Guru': 'Memfasilitasi refleksi dan menyimpulkan pembelajaran.', 'Aktivitas Siswa': 'Menyampaikan kesimpulan dan refleksi.', Waktu: '10 menit' },
  ];

  const rubricRows = rubrik.length ? rubrik : [
    { Aspek: 'Pemahaman konsep', 'Skor 4': 'Sangat tepat dan lengkap', 'Skor 3': 'Tepat dengan sedikit kekurangan', 'Skor 2': 'Sebagian tepat', 'Skor 1': 'Belum memahami' },
    { Aspek: 'Analisis', 'Skor 4': 'Analisis logis dan mendalam', 'Skor 3': 'Analisis cukup logis', 'Skor 2': 'Analisis masih terbatas', 'Skor 1': 'Belum mampu menganalisis' },
    { Aspek: 'Kolaborasi', 'Skor 4': 'Aktif dan menghargai anggota', 'Skor 3': 'Bekerja sama dengan baik', 'Skor 2': 'Partisipasi terbatas', 'Skor 1': 'Tidak menunjukkan kolaborasi' },
    { Aspek: 'Komunikasi', 'Skor 4': 'Jelas, runtut, dan percaya diri', 'Skor 3': 'Cukup jelas dan runtut', 'Skor 2': 'Kurang runtut', 'Skor 1': 'Belum mampu menyampaikan hasil' },
  ];

  let md = `# ${doc.suggested_file_name}\n\n`;
  md += `## 1. Identitas Pembelajaran\n\n${markdownTable(identitasRows, ['Aspek', 'Keterangan'])}\n\n`;
  md += `## 2. Tujuan Pembelajaran\n\n${listMarkdown(tujuan)}\n\n`;
  md += `## 3. Profil Pelajar Pancasila\n\n${listMarkdown(profil)}\n\n`;
  md += `## 4. Pemahaman Bermakna\n\n${listMarkdown(pemahaman)}\n\n`;
  md += `## 5. Pertanyaan Pemantik\n\n${listMarkdown(pemantik)}\n\n`;
  md += `## 6. Ringkasan Materi Ajar\n\n${listMarkdown(materi)}\n\n`;
  md += `## 7. Kegiatan Pembelajaran\n\n${markdownTable(kegiatanRows, ['Tahap', 'Aktivitas Guru', 'Aktivitas Siswa', 'Waktu'])}\n\n`;
  md += `## 8. LKPD\n\n`;
  md += `### Judul LKPD\n${lkpd.judul || `LKPD ${doc.mapel} - ${doc.subbab}`}\n\n`;
  md += `### Identitas\n- Sekolah: ${doc.sekolah}\n- Mapel: ${doc.mapel}\n- Kelas: ${doc.kelas}\n- Pertemuan: ${doc.pertemuan}\n\n`;
  md += `### Tujuan\n${listMarkdown(lkpd.tujuan || tujuan)}\n\n`;
  md += `### Petunjuk Kerja\n${listMarkdown(lkpd.petunjuk || ['Kerjakan secara berurutan.', 'Gunakan informasi yang tersedia pada LKPD.', 'Tuliskan jawaban dengan kalimat yang jelas.'])}\n\n`;
  if (lkpd.alat_bahan?.length) md += `### Alat dan Bahan\n${listMarkdown(lkpd.alat_bahan)}\n\n`;
  if (lkpd.bacaan) md += `### Bahan Bacaan / Data\n${lkpd.bacaan}\n\n`;
  md += `### Aktivitas Utama\n${listMarkdown(lkpd.aktivitas || [])}\n\n`;
  md += `### Pertanyaan Analisis\n${listMarkdown(lkpd.pertanyaan_analisis || [])}\n\n`;
  md += `### Refleksi\n${listMarkdown(lkpd.refleksi || [])}\n\n`;
  md += `### Kesimpulan\n${lkpd.kesimpulan || 'Tuliskan kesimpulan berdasarkan hasil kegiatan.'}\n\n`;
  md += `## 9. Asesmen Diagnostik\n\n${listMarkdown(diagnostik)}\n\n`;
  md += `## 10. Asesmen Formatif\n\n`;
  if (formatif.length) {
    md += formatif.map((q, i) => `${i + 1}. ${q.soal || q}\n`).join('\n');
  }
  md += `\n### Kunci Jawaban\n${listMarkdown(kunci.slice(0, 5))}\n\n`;
  md += `## 11. Rubrik Penilaian\n\n${markdownTable(rubricRows, ['Aspek', 'Skor 4', 'Skor 3', 'Skor 2', 'Skor 1'])}\n\n`;
  md += `## 12. Kunci Jawaban\n\n${listMarkdown(kunci)}\n\n`;
  md += `## 13. Tugas Rumah\n\n${tugas.length ? listMarkdown(tugas) : '- Tidak ada tugas rumah khusus.'}\n\n`;
  md += `## 14. Catatan Guru\n\n${listMarkdown(catatan)}\n\n`;
  if (c.materi_pengayaan?.length) md += `## 15. Materi Pengayaan\n\n${listMarkdown(c.materi_pengayaan)}\n\n`;
  md += `> Catatan internal guru: sumber materi halaman ${doc.halaman}. Jangan digunakan sebagai instruksi kepada murid.\n`;
  return md;
}

function fallbackStructured(task, ctx, pertemuan) {
  const title = ctx.subbab || ctx.bab || task.mapel;
  const kbc = task.jenis_kegiatan === 'Intrakurikuler' ? defaultKbc(task.mapel) : null;
  const ldi = task.jenis_kegiatan === 'Intrakurikuler' ? defaultLdi(task.mapel) : null;
  const isPiket = task.mapel === 'Guru Piket';
  if (isPiket) {
    return {
      identitas: { sekolah: task.sekolah, mapel: task.mapel, kelas: '-', jenis_kegiatan: task.jenis_kegiatan, bab: '-', subbab: '-' },
      tujuan_pembelajaran: ['Tugas piket terlaksana tertib dan terdokumentasi.'],
      profil_pelajar_pancasila: ['Mandiri', 'Gotong royong', 'Bernalar kritis'],
      pemahaman_bermakna: ['Kedisiplinan dan tanggung jawab membantu menjaga ketertiban lingkungan madrasah.'],
      pertanyaan_pemantik: ['Apa saja kondisi madrasah yang perlu dipantau saat piket?'],
      materi_inti: ['Tugas pokok piket: pemeriksaan kondisi kelas/lingkungan, pencatatan kejadian, dan tindak lanjut sederhana.'],
      kegiatan_pembelajaran: [
        { Tahap: 'Pendahuluan', 'Aktivitas Guru': 'Menjelaskan pembagian dan target piket.', 'Aktivitas Siswa': 'Memeriksa pembagian tugas.', Waktu: '10 menit' },
        { Tahap: 'Inti', 'Aktivitas Guru': 'Memantau checklist dan tindak lanjut.', 'Aktivitas Siswa': 'Melaksanakan checklist piket dan mencatat kejadian.', Waktu: '40 menit' },
        { Tahap: 'Penutup', 'Aktivitas Guru': 'Memeriksa jurnal piket.', 'Aktivitas Siswa': 'Menyerahkan checklist dan menyampaikan catatan.', Waktu: '10 menit' },
      ],
      lkpd: { judul: 'Checklist dan Jurnal Guru Piket', tujuan: ['Memantau kondisi madrasah secara tertib.'], petunjuk: ['Centang setiap tugas yang selesai.', 'Catat temuan penting dan tindak lanjut.'], aktivitas: ['Periksa kebersihan dan ketertiban.', 'Periksa kehadiran dan kondisi kelas sesuai tugas.', 'Catat kejadian khusus.'], pertanyaan_analisis: ['Apa temuan utama hari ini?'], refleksi: ['Apa yang perlu ditindaklanjuti?'], kesimpulan: 'Tugas piket selesai dan temuan tercatat.' },
      asesmen_diagnostik: ['Apa tugas utama guru piket?', 'Apa yang harus dicatat?', 'Mengapa pencatatan penting?'],
      asesmen_formatif: [{ soal: 'Lengkapi checklist piket sesuai kondisi lapangan.' }, { soal: 'Catat satu temuan penting.' }, { soal: 'Tentukan tindak lanjut yang diperlukan.' }, { soal: 'Tuliskan waktu pemeriksaan.' }, { soal: 'Paraf/check hasil pemeriksaan.' }],
      rubrik_penilaian: [], kunci_jawaban: ['Checklist terisi lengkap.', 'Temuan ditulis faktual.', 'Tindak lanjut sesuai temuan.'], tugas_rumah: [], catatan_guru: ['Tidak ada update progres pembelajaran untuk Guru Piket.'], materi_pengayaan: [],
      tema_kbc: null, lintas_disiplin_ilmu: null,
    };
  }
  const isExtra = task.jenis_kegiatan === 'Ekstrakurikuler';
  const approach = isExtra && /Multimedia/i.test(task.mapel)
    ? ['Project Based Learning']
    : isExtra && /IPS/i.test(task.mapel)
      ? ['Latihan soal analitis', 'Pembahasan strategi soal']
      : task.mapel === 'IPA'
        ? ['Pendekatan saintifik']
        : task.mapel === 'Informatika'
          ? ['Praktik', 'Computational thinking']
          : ['Problem Based Learning', 'Case Method', 'Diskusi'];
  return {
    identitas: { sekolah: task.sekolah, mapel: task.mapel, kelas: task.kelas, jenis_kegiatan: task.jenis_kegiatan, bab: ctx.bab || '-', subbab: ctx.subbab || '-' },
    tujuan_pembelajaran: [
      `Murid mampu menjelaskan konsep utama ${title.toLowerCase()} berdasarkan materi sumber.`,
      `Murid mampu mengidentifikasi informasi penting dari ${title.toLowerCase()}.`,
      `Murid mampu mengomunikasikan hasil pemahaman berdasarkan materi yang dipelajari.`,
    ],
    profil_pelajar_pancasila: ['Bernalar kritis', 'Mandiri', 'Gotong royong'],
    pemahaman_bermakna: [`Konsep ${title.toLowerCase()} membantu murid memahami fenomena dan masalah yang dekat dengan kehidupan.`],
    pertanyaan_pemantik: [`Apa yang sudah kamu ketahui tentang ${title.toLowerCase()}?`, 'Mengapa materi ini penting dipahami?'],
    materi_inti: [String(ctx.context || '').trim()],
    kegiatan_pembelajaran: [
      { Tahap: 'Pendahuluan', 'Aktivitas Guru': 'Mengaitkan topik dengan pengalaman awal murid dan menyampaikan tujuan.', 'Aktivitas Siswa': 'Menjawab pertanyaan awal dan menyampaikan pengetahuan awal.', Waktu: '10 menit' },
      { Tahap: 'Inti', 'Aktivitas Guru': `${approach.join(', ')}: memfasilitasi observasi/eksplorasi, analisis, diskusi, dan penguatan.`, 'Aktivitas Siswa': 'Mengamati, menganalisis, mengerjakan LKPD, berdiskusi, dan menyampaikan hasil.', Waktu: '40 menit' },
      { Tahap: 'Penutup', 'Aktivitas Guru': 'Memfasilitasi refleksi dan menyimpulkan materi.', 'Aktivitas Siswa': 'Menyampaikan kesimpulan dan refleksi.', Waktu: '10 menit' },
    ],
    lkpd: { judul: `LKPD ${task.mapel} - ${ctx.subbab || title}`, tujuan: [`Memahami ${title.toLowerCase()}.`], petunjuk: ['Kerjakan berurutan.', 'Gunakan informasi yang tersedia dalam LKPD.', 'Tulis jawaban dengan jelas.'], aktivitas: ['Identifikasi konsep penting.', 'Susun informasi utama dalam tabel/diagram sederhana.', 'Diskusikan hasil dengan kelompok.'], pertanyaan_analisis: ['Konsep apa yang paling penting?', 'Apa hubungan antar konsep?', 'Bagaimana penerapannya pada situasi yang dekat dengan kehidupan?'], refleksi: ['Apa yang sudah dipahami?', 'Apa yang masih membingungkan?'], kesimpulan: 'Tuliskan kesimpulan berdasarkan hasil kegiatan.' },
    asesmen_diagnostik: [`Apa yang sudah kamu ketahui tentang ${title.toLowerCase()}?`, 'Contoh apa yang pernah kamu temui?', 'Apa yang ingin kamu ketahui?'],
    asesmen_formatif: [{ soal: 'Jelaskan satu konsep utama dari materi.' }, { soal: 'Sebutkan dua informasi penting dari materi.' }, { soal: 'Berikan hubungan antara dua konsep yang dipelajari.' }, { soal: 'Terapkan konsep pada situasi sederhana.' }, { soal: 'Tuliskan satu kesimpulan.' }],
    rubrik_penilaian: [],
    kunci_jawaban: ['Sesuai informasi dan konsep pada context sumber.', 'Jawaban menunjukkan pemahaman terhadap materi.', 'Hubungan konsep dijelaskan secara logis.', 'Penerapan tidak bertentangan dengan sumber.', 'Kesimpulan sesuai materi.'],
    tugas_rumah: ['Buat ringkasan singkat materi dengan kata-kata sendiri.'],
    catatan_guru: [`Sumber internal: halaman ${ctx.pages?.join(', ') || '-'}.`, 'Pastikan pembelajaran tetap berada dalam cakupan subbab yang dipilih.'],
    materi_pengayaan: [],
    tema_kbc: kbc,
    lintas_disiplin_ilmu: ldi,
    source_fidelity: { factual_content: 'source_derived', pedagogical_additions: 'teacher_recommendations' },
    pertemuan,
  };
}

function buildPrompt(task, ctx, pertemuan) {
  const isIntrakurikuler = task.jenis_kegiatan === 'Intrakurikuler';
  const isPiket = task.mapel === 'Guru Piket';
  const isMultimedia = task.jenis_kegiatan === 'Ekstrakurikuler' && /Multimedia/i.test(task.mapel);
  const isExtraIps = task.jenis_kegiatan === 'Ekstrakurikuler' && /IPS/i.test(task.mapel);
  const approaches = task.mapel === 'IPS'
    ? 'Problem Based Learning, Case Method, literasi data, interpretasi grafik/peta bila relevan, dan HOTS.'
    : task.mapel === 'IPA'
      ? 'pendekatan saintifik dengan observasi, eksperimen sederhana bila relevan, diskusi, analisis hasil, dan kesimpulan.'
      : task.mapel === 'Informatika'
        ? 'praktik, computational thinking, dan langkah kerja yang jelas sesuai materi.'
        : isMultimedia
          ? 'Project Based Learning dengan produk nyata.'
          : isExtraIps
            ? 'latihan soal analitis, pembahasan strategi memahami soal, dan pengayaan konsep.'
            : isPiket
              ? 'checklist tugas, jurnal piket, dan catatan pemantauan.'
              : 'pendekatan aktif dan kolaboratif.';

  return `Kamu adalah Agent Content Generator dan AI Instructional Designer untuk guru MTs.

Buat perangkat pembelajaran LENGKAP untuk satu task berdasarkan SOURCE CONTEXT.

ATURAN MUTLAK:
1. Buku adalah referensi utama. Jangan keluar dari cakupan context.
2. Jangan mengulang materi sebelumnya.
3. Satu pertemuan tepat satu subbab.
4. Gunakan istilah pada sumber.
5. Gunakan kata "Murid", bukan "Peserta didik".
6. Jangan menulis instruksi untuk membuka atau membaca halaman buku tertentu.
7. Semua teks, kasus, data, tabel, dan bahan analisis yang dibutuhkan murid harus tersedia langsung di LKPD.
8. Fakta, angka, definisi, nama, dan klaim materi harus didukung SOURCE CONTEXT.
9. Jika membuat tambahan pedagogis, itu adalah rekomendasi guru, bukan fakta dari buku.
10. Jika ada materi di luar SOURCE CONTEXT yang benar-benar diperlukan, masukkan hanya dalam field materi_pengayaan dan beri label "Materi Pengayaan".
11. Gunakan Bahasa Indonesia formal, komunikatif, dan mudah dipahami murid MTs.
12. Gunakan tepat SATU tema KBC dari ${JSON.stringify(KBC_OPTIONS)} untuk kegiatan Intrakurikuler. Jangan isi KBC untuk Ekstrakurikuler atau Guru Piket.
13. Gunakan tepat SATU Lintas Disiplin Ilmu dari ${JSON.stringify(LDI_OPTIONS)} untuk kegiatan Intrakurikuler. Jangan isi untuk Ekstrakurikuler atau Guru Piket.
14. Pendekatan khusus mapel: ${approaches}
15. Maksimal 4 dimensi Profil Pelajar Pancasila.
16. Asesmen diagnostik tepat 3 pertanyaan.
17. Asesmen formatif tepat 5 soal campuran pilihan ganda, isian, dan uraian bila cocok.
18. Rubrik minimal 4 aspek, skor 1-4.
19. LKPD wajib memiliki judul, identitas, tujuan, petunjuk kerja, alat/bahan jika relevan, aktivitas utama, pertanyaan analisis, refleksi, kesimpulan.
20. OUTPUT JSON valid saja tanpa markdown fence.

TASK:
${JSON.stringify({ ...task, pertemuan }, null, 2)}

SOURCE CONTEXT:
${ctx.context || '(Tidak ada context buku; ini task non-buku.)'}

OUTPUT:
{
  "judul_materi":"",
  "identitas": {"sekolah":"","kepala_madrasah":"","mapel":"","kelas":"","aloksi_waktu":"","pertemuan":${pertemuan},"bab":"","subbab":"","tema_kbc":null,"lintas_disiplin_ilmu":null},
  "tujuan_pembelajaran":[],
  "profil_pelajar_pancasila":[],
  "pemahaman_bermakna":[],
  "pertanyaan_pemantik":[],
  "materi_inti":[],
  "kegiatan_pembelajaran":[{"Tahap":"Pendahuluan","Aktivitas Guru":"","Aktivitas Siswa":"","Waktu":""},{"Tahap":"Inti","Aktivitas Guru":"","Aktivitas Siswa":"","Waktu":""},{"Tahap":"Penutup","Aktivitas Guru":"","Aktivitas Siswa":"","Waktu":""}],
  "lkpd":{"judul":"","tujuan":[],"petunjuk":[],"alat_bahan":[],"bacaan":"","aktivitas":[],"pertanyaan_analisis":[],"refleksi":[],"kesimpulan":""},
  "asesmen_diagnostik":[],
  "asesmen_formatif":[{"soal":""},{"soal":""},{"soal":""},{"soal":""},{"soal":""}],
  "rubrik_penilaian":[{"Aspek":"","Skor 4":"","Skor 3":"","Skor 2":"","Skor 1":""}],
  "kunci_jawaban":[],
  "tugas_rumah":[],
  "catatan_guru":[],
  "materi_pengayaan":[],
  "source_fidelity":{"factual_content":"source_derived","pedagogical_additions":"teacher_recommendations"}
}`;
}

async function generateWithGemini(prompt) {
  const key = env('GEMINI_API_KEY');
  if (!key) return null;
  const model = env('GEMINI_MODEL') || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.12, responseMimeType: 'application/json' },
    }),
    cache: 'no-store',
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Gemini HTTP ${r.status}: ${data?.error?.message || 'request gagal'}`);
  const text = extractGeminiText(data);
  if (!text) throw new Error('Gemini tidak mengembalikan konten.');
  return { provider: 'gemini', model, text };
}

async function generateWithOpenAI(prompt) {
  const key = env('OPENAI_API_KEY');
  if (!key) return null;
  const model = env('OPENAI_MODEL') || 'gpt-4.1-mini';
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0.12,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Return only valid JSON. Use "Murid", not "Peserta didik".' },
        { role: 'user', content: prompt },
      ],
    }),
    cache: 'no-store',
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`OpenAI HTTP ${r.status}: ${data?.error?.message || 'request gagal'}`);
  const text = extractOpenAIText(data);
  if (!text) throw new Error('OpenAI tidak mengembalikan konten.');
  return { provider: 'openai', model, text };
}

async function getTaskRows(db, tanggal, taskId) {
  if (taskId) return db`SELECT * FROM tasks WHERE task_id=${taskId} LIMIT 1`;
  return db`SELECT * FROM tasks WHERE tanggal=${tanggal} ORDER BY task_id`;
}

async function getNextMeeting(db, task) {
  try {
    const kelas = task.kelas || '-';
    const rows = await db`SELECT pertemuan_terakhir FROM progress WHERE sekolah=${task.sekolah} AND mapel=${task.mapel} AND kelas=${kelas} LIMIT 1`;
    const last = Number(rows?.[0]?.pertemuan_terakhir);
    return Number.isFinite(last) && last > 0 ? last + 1 : 1;
  } catch {
    return 1;
  }
}

function normalizeTask(task, ctx, pertemuan) {
  const jamMulai = task.jam_mulai || '';
  const jamSelesai = task.jam_selesai || '';
  return {
    task_id: String(task.task_id),
    tanggal: String(task.tanggal),
    sekolah: task.sekolah || '',
    kepala_madrasah: headMaster(task.sekolah),
    jam: jamMulai && jamSelesai ? `${jamMulai}-${jamSelesai}` : '-',
    mapel: task.mapel || ctx?.mapel || '',
    kelas: task.kelas || ctx?.kelas || '-',
    pertemuan,
    bab: ctx?.bab || '-',
    subbab: ctx?.subbab || '-',
    halaman: ctx?.pages?.length ? `${Math.min(...ctx.pages)}-${Math.max(...ctx.pages)}` : '-',
    judul_materi: ctx?.subbab || ctx?.bab || task.mapel || task.jenis_kegiatan || 'Kegiatan Pembelajaran',
    jenis_kegiatan: task.jenis_kegiatan || '',
    tema_kbc: task.jenis_kegiatan === 'Intrakurikuler' ? defaultKbc(task.mapel) : null,
    lintas_disiplin_ilmu: task.jenis_kegiatan === 'Intrakurikuler' ? defaultLdi(task.mapel) : null,
    suggested_file_name: task.jenis_kegiatan === 'Tugas Tambahan'
      ? `${task.tanggal} - ${shortSchool(task.sekolah)} - Guru Piket`
      : `${task.tanggal} - ${shortSchool(task.sekolah)} - ${task.mapel} - Kelas ${task.kelas} - Pertemuan ${pertemuan}`,
    output_folder: outputFolder(task.mapel, task.sekolah),
    progress_update_required: Boolean(task.requires_progress_update),
  };
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const tanggal = String(body?.tanggal || new Date().toISOString().slice(0, 10));
    const taskId = body?.task_id ? String(body.task_id) : null;
    const origin = request.headers.get('x-forwarded-proto') && request.headers.get('host')
      ? `${request.headers.get('x-forwarded-proto')}://${request.headers.get('host')}`
      : `https://${env('VERCEL_URL')}`;

    const r = await fetch(`${origin}/api/context-extractor-engine?run=${Date.now()}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cache-control': 'no-cache' },
      body: JSON.stringify({ tanggal }),
      cache: 'no-store',
    });
    const extracted = await r.json();
    if (!r.ok || extracted?.status !== 'success') {
      return Response.json({ agent: 'content_generator', status: 'error', reason: 'Context Extractor gagal.', context_result: extracted }, { status: 500 });
    }

    const db = dbClient();
    const taskRows = await getTaskRows(db, tanggal, taskId);
    const taskMap = new Map(taskRows.map(t => [String(t.task_id), t]));
    const contextMap = new Map((extracted.tasks || []).map(t => [String(t.task_id), t]));

    const selectedRows = taskId ? taskRows : taskRows;
    if (!selectedRows.length) return Response.json({ agent: 'content_generator', status: 'no_tasks', tanggal, documents: [] });

    const provider = envAiProvider();
    const documents = [];
    for (const row of selectedRows) {
      const ctx = contextMap.get(String(row.task_id)) || null;
      if (row.requires_book && (!ctx || ctx.status !== 'success' || !ctx.context_valid)) {
        documents.push({ task_id: row.task_id, status: 'skipped', reason: 'Context buku belum valid.', sekolah: row.sekolah, mapel: row.mapel, kelas: row.kelas });
        continue;
      }
      const pertemuan = await getNextMeeting(db, row);
      const doc = normalizeTask(row, ctx, pertemuan);
      const prompt = buildPrompt(row, ctx || { context: '' }, pertemuan);
      let content;
      let mode;
      let aiMeta = { provider: null, model: null };
      if (provider === 'gemini') {
        const result = await generateWithGemini(prompt);
        content = parseJson(result.text);
        mode = 'ai:gemini';
        aiMeta = result;
      } else if (provider === 'openai') {
        const result = await generateWithOpenAI(prompt);
        content = parseJson(result.text);
        mode = 'ai:openai';
        aiMeta = result;
      } else {
        content = fallbackStructured(row, ctx || {}, pertemuan);
        mode = 'extractive_fallback';
      }

      content.identitas = {
        ...(content.identitas || {}),
        sekolah: doc.sekolah,
        kepala_madrasah: doc.kepala_madrasah,
        mapel: doc.mapel,
        kelas: doc.kelas,
        aloksi_waktu: doc.jam,
        pertemuan: doc.pertemuan,
        bab: doc.bab,
        subbab: doc.subbab,
        tema_kbc: row.jenis_kegiatan === 'Intrakurikuler' ? pickAllowed(content.identitas?.tema_kbc || content.tema_kbc, KBC_OPTIONS, doc.tema_kbc) : null,
        lintas_disiplin_ilmu: row.jenis_kegiatan === 'Intrakurikuler' ? pickAllowed(content.identitas?.lintas_disiplin_ilmu || content.lintas_disiplin_ilmu, LDI_OPTIONS, doc.lintas_disiplin_ilmu) : null,
      };
      content.tema_kbc = content.identitas.tema_kbc;
      content.lintas_disiplin_ilmu = content.identitas.lintas_disiplin_ilmu;
      content.source_fidelity = content.source_fidelity || { factual_content: 'source_derived', pedagogical_additions: 'teacher_recommendations' };

      doc.judul_materi = content.judul_materi || doc.judul_materi;
      doc.tema_kbc = content.identitas.tema_kbc;
      doc.lintas_disiplin_ilmu = content.identitas.lintas_disiplin_ilmu;
      doc.document_markdown = buildDocumentMarkdown(doc, content);
      documents.push({ ...doc, status: 'success', mode, provider: aiMeta.provider, model: aiMeta.model, source_pages: ctx?.pages || [], source_characters: ctx?.total_context_characters || 0 });
    }

    return Response.json({
      agent: 'content_generator',
      status: 'success',
      tanggal,
      hari: dayName(tanggal),
      documents,
    });
  } catch (error) {
    console.error('Content Generator error:', error);
    return Response.json({ agent: 'content_generator', status: 'error', reason: error instanceof Error ? error.message : 'Content Generator gagal.' }, { status: 500 });
  }
}
