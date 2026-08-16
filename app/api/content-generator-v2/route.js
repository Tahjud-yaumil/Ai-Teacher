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

function cleanDate(value) {
  const s = String(value || '');
  const m = s.match(/\b(20\d{2})[-/](\d{2})[-/](\d{2})\b/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(value);
  if (!Number.isNaN(d.getTime())) {
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    return `${y}-${mo}-${da}`;
  }
  return s || new Date().toISOString().slice(0, 10);
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

function defaultKbc(mapel) {
  if (mapel === 'IPA') return 'Cinta kepada Diri Sendiri';
  if (mapel === 'IPS') return 'Cinta kepada Lingkungan';
  if (mapel === 'Informatika') return 'Cinta kepada Diri Sendiri';
  return 'Cinta kepada Sesama';
}

function defaultLdi(mapel) {
  if (mapel === 'IPA') return 'Aqidah';
  if (mapel === 'IPS') return 'Aqidah';
  return 'Alquran';
}

function allowed(value, options, fallback) {
  const s = String(value || '').trim();
  return options.includes(s) ? s : fallback;
}

function safeText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(safeText).filter(Boolean).join('\n');
  if (typeof value === 'object') {
    const preferred = ['kegiatan', 'aktivitas', 'aktivitas_utama', 'tujuan', 'tujuan_pembelajaran', 'soal', 'jawaban', 'respon', 'deskripsi', 'isi', 'teks', 'pertanyaan', 'kesimpulan', 'refleksi'];
    const parts = [];
    for (const key of preferred) if (value[key] !== undefined) {
      const t = safeText(value[key]);
      if (t) parts.push(t);
    }
    if (parts.length) return parts.join(' — ');
    return Object.entries(value).map(([k, v]) => `${k}: ${safeText(v)}`).join(' — ');
  }
  return String(value);
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return value ? [safeText(value)] : [];
  return value.map(safeText).map(s => s.replace(/^[-*]\s*/, '').trim()).filter(Boolean);
}

function normalizeQuestions(value) {
  if (!Array.isArray(value)) return [];
  return value.map((q) => {
    if (typeof q === 'string') return { soal: q };
    return { ...q, soal: safeText(q?.soal || q?.pertanyaan || q?.question || q) };
  }).filter(q => q.soal);
}

function normalizeRubric(value) {
  if (!Array.isArray(value)) return [];
  return value.map(r => ({
    Aspek: safeText(r?.Aspek || r?.aspek || r?.aspect),
    'Skor 4': safeText(r?.['Skor 4'] || r?.skor4 || r?.score4),
    'Skor 3': safeText(r?.['Skor 3'] || r?.skor3 || r?.score3),
    'Skor 2': safeText(r?.['Skor 2'] || r?.skor2 || r?.score2),
    'Skor 1': safeText(r?.['Skor 1'] || r?.skor1 || r?.score1),
  })).filter(r => r.Aspek);
}

function normalizeActivities(value) {
  if (!Array.isArray(value)) return [];
  return value.map(r => ({
    Tahap: safeText(r?.Tahap || r?.tahap),
    'Aktivitas Guru': safeText(r?.['Aktivitas Guru'] || r?.aktivitas_guru || r?.guru),
    'Aktivitas Siswa': safeText(r?.['Aktivitas Siswa'] || r?.aktivitas_siswa || r?.murid || r?.siswa),
    Waktu: safeText(r?.Waktu || r?.waktu || r?.durasi),
  })).filter(r => r.Tahap);
}

function sanitizeStudentTerm(text) {
  return String(text || '')
    .replace(/Peserta didik/gi, 'Murid')
    .replace(/siswa/gi, 'Murid')
    .replace(/siswi/gi, 'Murid');
}

function sanitizeForbiddenBookInstructions(text) {
  return sanitizeStudentTerm(text)
    .replace(/\b(buka|lihat|bacalah|pelajari)\s+(?:buku|halaman)\s*(?:halaman\s*)?\d+(?:\s*[-–]\s*\d+)?/gi, 'Gunakan bahan yang tersedia pada LKPD')
    .replace(/\bhalaman\s+\d+(?:\s*[-–]\s*\d+)?/gi, 'bagian sumber');
}

function markdownTable(rows, headers) {
  const lines = [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
  ];
  for (const row of rows) lines.push(`| ${headers.map(h => sanitizeForbiddenBookInstructions(row?.[h] || '')).join(' | ')} |`);
  return lines.join('\n');
}

function listMarkdown(items) {
  return normalizeStringList(items).map(x => `- ${sanitizeForbiddenBookInstructions(x)}`).join('\n');
}

function chooseTitle(doc, content) {
  if (doc.mapel === 'Guru Piket') return 'Jurnal Guru Piket';
  if (doc.subbab && doc.subbab !== '-' && doc.subbab.length > 2) {
    return doc.subbab.replace(/^\s*[A-Z]\.?\s*/i, '').replace(/\s+\.{2,}.*$/, '').trim() || doc.mapel;
  }
  return safeText(content.judul_materi) || doc.mapel || 'Pembelajaran';
}

function normalizeContent(raw, doc) {
  const c = raw || {};
  const kbc = doc.jenis_kegiatan === 'Intrakurikuler'
    ? allowed(c?.identitas?.tema_kbc || c.tema_kbc, KBC_OPTIONS, doc.tema_kbc)
    : null;
  const ldi = doc.jenis_kegiatan === 'Intrakurikuler'
    ? allowed(c?.identitas?.lintas_disiplin_ilmu || c.lintas_disiplin_ilmu, LDI_OPTIONS, doc.lintas_disiplin_ilmu)
    : null;

  const formatif = normalizeQuestions(c.asesmen_formatif).slice(0, 5);
  while (formatif.length < 5) formatif.push({ soal: `Pertanyaan ${formatif.length + 1} tentang konsep utama materi.` });
  const kunci = normalizeStringList(c.kunci_jawaban).slice(0, 5);
  while (kunci.length < 5) kunci.push('Jawaban sesuai informasi yang tersedia pada materi dan LKPD.');

  const kegiatan = normalizeActivities(c.kegiatan_pembelajaran);
  const rubric = normalizeRubric(c.rubrik_penilaian);
  while (rubric.length < 4) rubric.push({
    Aspek: ['Pemahaman konsep', 'Analisis', 'Kolaborasi', 'Komunikasi'][rubric.length],
    'Skor 4': 'Sangat baik dan tepat.',
    'Skor 3': 'Baik dengan sedikit kekurangan.',
    'Skor 2': 'Sebagian tepat dan masih perlu bimbingan.',
    'Skor 1': 'Belum menunjukkan penguasaan yang diharapkan.',
  });

  const docTitle = chooseTitle(doc, c);
  return {
    judul_materi: docTitle,
    identitas: {
      sekolah: doc.sekolah,
      kepala_madrasah: doc.kepala_madrasah,
      mapel: doc.mapel,
      kelas: doc.kelas,
      alokasi_waktu: doc.jam,
      pertemuan: doc.pertemuan,
      bab: doc.bab,
      subbab: doc.subbab,
      tema_kbc: kbc,
      lintas_disiplin_ilmu: ldi,
    },
    tujuan_pembelajaran: normalizeStringList(c.tujuan_pembelajaran),
    profil_pelajar_pancasila: normalizeStringList(c.profil_pelajar_pancasila).slice(0, 4),
    pemahaman_bermakna: normalizeStringList(c.pemahaman_bermakna),
    pertanyaan_pemantik: normalizeStringList(c.pertanyaan_pemantik),
    materi_inti: normalizeStringList(c.materi_inti),
    kegiatan_pembelajaran: kegiatan,
    lkpd: {
      judul: safeText(c?.lkpd?.judul) || `LKPD ${docTitle}`,
      tujuan: normalizeStringList(c?.lkpd?.tujuan),
      petunjuk: normalizeStringList(c?.lkpd?.petunjuk),
      alat_bahan: normalizeStringList(c?.lkpd?.alat_bahan),
      bacaan: sanitizeForbiddenBookInstructions(safeText(c?.lkpd?.bacaan)),
      aktivitas: normalizeStringList(c?.lkpd?.aktivitas),
      pertanyaan_analisis: normalizeStringList(c?.lkpd?.pertanyaan_analisis),
      refleksi: normalizeStringList(c?.lkpd?.refleksi),
      kesimpulan: sanitizeForbiddenBookInstructions(safeText(c?.lkpd?.kesimpulan)),
    },
    asesmen_diagnostik: normalizeStringList(c.asesmen_diagnostik).slice(0, 3),
    asesmen_formatif: formatif,
    rubrik_penilaian: rubric,
    kunci_jawaban: kunci,
    tugas_rumah: normalizeStringList(c.tugas_rumah),
    catatan_guru: normalizeStringList(c.catatan_guru),
    materi_pengayaan: normalizeStringList(c.materi_pengayaan),
    source_fidelity: { factual_content: 'source_derived', pedagogical_additions: 'teacher_recommendations' },
  };
}

function fallbackContent(task, ctx, pertemuan) {
  const title = task.mapel === 'Guru Piket' ? 'Jurnal Guru Piket' : chooseTitle({ ...task, subbab: ctx?.subbab || '-' }, {});
  const isIntrakurikuler = task.jenis_kegiatan === 'Intrakurikuler';
  const isMultimedia = task.jenis_kegiatan === 'Ekstrakurikuler' && /Multimedia/i.test(task.mapel);
  const isExtraIps = task.jenis_kegiatan === 'Ekstrakurikuler' && /IPS/i.test(task.mapel);
  if (task.mapel === 'Guru Piket') {
    return normalizeContent({
      judul_materi: 'Jurnal Guru Piket',
      tujuan_pembelajaran: ['Tugas piket terlaksana tertib dan terdokumentasi.'],
      profil_pelajar_pancasila: ['Mandiri', 'Gotong royong', 'Bernalar kritis'],
      pemahaman_bermakna: ['Pencatatan yang tertib membantu memastikan tindak lanjut tugas piket.'],
      pertanyaan_pemantik: ['Apa saja kondisi yang perlu dipantau saat piket?'],
      materi_inti: ['Checklist tugas, jurnal piket, dan catatan pemantauan.'],
      kegiatan_pembelajaran: [
        { Tahap: 'Pendahuluan', 'Aktivitas Guru': 'Menjelaskan pembagian tugas piket.', 'Aktivitas Siswa': 'Memeriksa tugas masing-masing.', Waktu: '10 menit' },
        { Tahap: 'Inti', 'Aktivitas Guru': 'Memantau pelaksanaan checklist dan tindak lanjut.', 'Aktivitas Siswa': 'Melaksanakan checklist dan mencatat kejadian.', Waktu: '40 menit' },
        { Tahap: 'Penutup', 'Aktivitas Guru': 'Memeriksa jurnal dan catatan.', 'Aktivitas Siswa': 'Menyerahkan checklist dan menyampaikan temuan.', Waktu: '10 menit' },
      ],
      lkpd: { judul: 'Checklist dan Jurnal Guru Piket', tujuan: ['Memantau kondisi madrasah secara tertib.'], petunjuk: ['Centang tugas yang selesai.', 'Catat temuan dan tindak lanjut.'], aktivitas: ['Periksa kondisi lingkungan.', 'Catat kejadian khusus.', 'Tuliskan tindak lanjut.'], pertanyaan_analisis: ['Apa temuan utama hari ini?'], refleksi: ['Apa yang perlu ditindaklanjuti?'], kesimpulan: 'Tugas piket selesai dan temuan tercatat.' },
      asesmen_diagnostik: ['Apa tugas utama guru piket?', 'Apa yang perlu dicatat?', 'Mengapa pencatatan penting?'],
      asesmen_formatif: [{ soal: 'Lengkapi checklist tugas piket.' }, { soal: 'Catat satu temuan penting.' }, { soal: 'Tuliskan tindak lanjut.' }, { soal: 'Tuliskan waktu pemeriksaan.' }, { soal: 'Berikan catatan akhir piket.' }],
      kunci_jawaban: ['Checklist lengkap.', 'Temuan faktual.', 'Tindak lanjut sesuai temuan.', 'Waktu tercatat.', 'Catatan akhir jelas.'],
      materi_pengayaan: [],
    }, { ...task, kepala_madrasah: headMaster(task.sekolah), jam: task.jam_mulai && task.jam_selesai ? `${task.jam_mulai}-${task.jam_selesai}` : '-', kelas: '-', pertemuan, bab: '-', subbab: '-', tema_kbc: null, lintas_disiplin_ilmu: null });
  }
  return normalizeContent({
    judul_materi: title,
    tujuan_pembelajaran: [`Murid mampu memahami konsep utama ${title}.`, `Murid mampu mengidentifikasi informasi penting dari materi ${title}.`, `Murid mampu mengomunikasikan hasil pemahaman.`],
    profil_pelajar_pancasila: ['Bernalar Kritis', 'Mandiri', 'Gotong royong'],
    pemahaman_bermakna: [`Konsep ${title} membantu murid memahami fenomena atau keterampilan yang dekat dengan kehidupan.`],
    pertanyaan_pemantik: [`Apa yang sudah kamu ketahui tentang ${title}?`, 'Mengapa materi ini penting dipahami?'],
    materi_inti: [safeText(ctx?.context)],
    kegiatan_pembelajaran: [
      { Tahap: 'Pendahuluan', 'Aktivitas Guru': 'Mengaitkan materi dengan pengalaman awal murid dan menyampaikan tujuan.', 'Aktivitas Siswa': 'Menjawab pertanyaan awal.', Waktu: '10 menit' },
      { Tahap: 'Inti', 'Aktivitas Guru': isMultimedia ? 'Memfasilitasi Project Based Learning dan pembuatan produk nyata.' : isExtraIps ? 'Memfasilitasi latihan analitis dan pembahasan strategi soal.' : task.mapel === 'IPA' ? 'Memfasilitasi observasi, diskusi, analisis, dan kesimpulan.' : 'Memfasilitasi eksplorasi, praktik, diskusi, dan penguatan konsep.', 'Aktivitas Siswa': 'Mengamati, mengerjakan LKPD, berdiskusi, dan menyampaikan hasil.', Waktu: '40 menit' },
      { Tahap: 'Penutup', 'Aktivitas Guru': 'Memfasilitasi refleksi dan kesimpulan.', 'Aktivitas Siswa': 'Menyampaikan kesimpulan dan refleksi.', Waktu: '10 menit' },
    ],
    lkpd: { judul: `LKPD ${title}`, tujuan: [`Memahami ${title}.`], petunjuk: ['Kerjakan secara berurutan.', 'Gunakan informasi yang tersedia di LKPD.', 'Tuliskan jawaban dengan jelas.'], alat_bahan: ['Alat tulis'], bacaan: safeText(ctx?.context), aktivitas: ['Identifikasi konsep penting.', 'Susun informasi utama.', 'Diskusikan hasil.'], pertanyaan_analisis: ['Apa konsep paling penting?', 'Bagaimana hubungan antar konsep?', 'Bagaimana penerapannya?'], refleksi: ['Apa yang sudah dipahami?', 'Apa yang masih membingungkan?'], kesimpulan: `Tuliskan kesimpulan tentang ${title}.` },
    asesmen_diagnostik: [`Apa yang sudah kamu ketahui tentang ${title}?`, 'Contoh apa yang pernah kamu temui?', 'Apa yang ingin kamu ketahui?'],
    asesmen_formatif: [{ soal: 'Jelaskan satu konsep utama materi.' }, { soal: 'Sebutkan dua informasi penting.' }, { soal: 'Jelaskan hubungan dua konsep.' }, { soal: 'Terapkan konsep pada situasi sederhana.' }, { soal: 'Tuliskan satu kesimpulan.' }],
    kunci_jawaban: ['Sesuai context.', 'Sesuai context.', 'Hubungan logis.', 'Penerapan sesuai context.', 'Kesimpulan sesuai context.'],
    tugas_rumah: [],
    catatan_guru: [],
    materi_pengayaan: [],
    identitas: { tema_kbc: isIntrakurikuler ? defaultKbc(task.mapel) : null, lintas_disiplin_ilmu: isIntrakurikuler ? defaultLdi(task.mapel) : null },
  }, { ...task, kepala_madrasah: headMaster(task.sekolah), jam: task.jam_mulai && task.jam_selesai ? `${task.jam_mulai}-${task.jam_selesai}` : '-', pertemuan, bab: ctx?.bab || '-', subbab: ctx?.subbab || '-', tema_kbc: isIntrakurikuler ? defaultKbc(task.mapel) : null, lintas_disiplin_ilmu: isIntrakurikuler ? defaultLdi(task.mapel) : null });
}

function buildDocumentMarkdown(doc, c) {
  const identitasRows = [
    { Aspek: 'Sekolah', Keterangan: doc.sekolah },
    { Aspek: 'Kepala Madrasah', Keterangan: doc.kepala_madrasah },
    { Aspek: 'Mapel', Keterangan: doc.mapel },
    { Aspek: 'Kelas', Keterangan: doc.kelas },
    { Aspek: 'Alokasi Waktu', Keterangan: doc.jam || 'Disesuaikan dengan jadwal' },
    { Aspek: 'Pertemuan', Keterangan: String(doc.pertemuan) },
    { Aspek: 'Bab', Keterangan: doc.bab },
    { Aspek: 'Subbab', Keterangan: doc.subbab },
  ];
  if (doc.tema_kbc) identitasRows.push({ Aspek: 'Tema Kurikulum Berbasis Cinta', Keterangan: doc.tema_kbc });
  if (doc.lintas_disiplin_ilmu) identitasRows.push({ Aspek: 'Lintas Disiplin Ilmu', Keterangan: doc.lintas_disiplin_ilmu });

  const kegiatan = c.kegiatan_pembelajaran?.length ? c.kegiatan_pembelajaran : [
    { Tahap: 'Pendahuluan', 'Aktivitas Guru': 'Membangun kesiapan belajar, menyampaikan tujuan, dan mengaitkan materi dengan pengalaman murid.', 'Aktivitas Siswa': 'Menjawab pertanyaan awal.', Waktu: '10 menit' },
    { Tahap: 'Inti', 'Aktivitas Guru': 'Memfasilitasi eksplorasi, analisis, diskusi, dan penguatan konsep.', 'Aktivitas Siswa': 'Mengamati, menganalisis, berdiskusi, mengerjakan LKPD, dan menyampaikan hasil.', Waktu: '40 menit' },
    { Tahap: 'Penutup', 'Aktivitas Guru': 'Memfasilitasi refleksi dan menyimpulkan pembelajaran.', 'Aktivitas Siswa': 'Menyampaikan kesimpulan dan refleksi.', Waktu: '10 menit' },
  ];
  const lkpd = c.lkpd || {};
  const formatif = c.asesmen_formatif || [];
  const kunci = c.kunci_jawaban || [];
  const rubric = c.rubrik_penilaian || [];

  let md = `# ${doc.suggested_file_name}\n\n`;
  md += `## 1. Identitas Pembelajaran\n\n${markdownTable(identitasRows, ['Aspek', 'Keterangan'])}\n\n`;
  md += `## 2. Tujuan Pembelajaran\n\n${listMarkdown(c.tujuan_pembelajaran)}\n\n`;
  md += `## 3. Profil Pelajar Pancasila\n\n${listMarkdown(c.profil_pelajar_pancasila)}\n\n`;
  md += `## 4. Pemahaman Bermakna\n\n${listMarkdown(c.pemahaman_bermakna)}\n\n`;
  md += `## 5. Pertanyaan Pemantik\n\n${listMarkdown(c.pertanyaan_pemantik)}\n\n`;
  md += `## 6. Ringkasan Materi Ajar\n\n${listMarkdown(c.materi_inti)}\n\n`;
  md += `## 7. Kegiatan Pembelajaran\n\n${markdownTable(kegiatan, ['Tahap', 'Aktivitas Guru', 'Aktivitas Siswa', 'Waktu'])}\n\n`;
  md += `## 8. LKPD\n\n`;
  md += `### Judul LKPD\n${sanitizeForbiddenBookInstructions(lkpd.judul || `LKPD ${doc.mapel}`)}\n\n`;
  md += `### Identitas\n- Sekolah: ${doc.sekolah}\n- Mapel: ${doc.mapel}\n- Kelas: ${doc.kelas}\n- Pertemuan: ${doc.pertemuan}\n\n`;
  md += `### Tujuan\n${listMarkdown(lkpd.tujuan)}\n\n`;
  md += `### Petunjuk Kerja\n${listMarkdown(lkpd.petunjuk)}\n\n`;
  if (lkpd.alat_bahan?.length) md += `### Alat dan Bahan\n${listMarkdown(lkpd.alat_bahan)}\n\n`;
  if (lkpd.bacaan) md += `### Bahan Bacaan / Data\n${sanitizeForbiddenBookInstructions(lkpd.bacaan)}\n\n`;
  md += `### Aktivitas Utama\n${listMarkdown(lkpd.aktivitas)}\n\n`;
  md += `### Pertanyaan Analisis\n${listMarkdown(lkpd.pertanyaan_analisis)}\n\n`;
  md += `### Refleksi\n${listMarkdown(lkpd.refleksi)}\n\n`;
  md += `### Kesimpulan\n${sanitizeForbiddenBookInstructions(lkpd.kesimpulan)}\n\n`;
  md += `## 9. Asesmen Diagnostik\n\n${listMarkdown(c.asesmen_diagnostik)}\n\n`;
  md += `## 10. Asesmen Formatif\n\n`;
  formatif.slice(0, 5).forEach((q, i) => { md += `${i + 1}. ${sanitizeForbiddenBookInstructions(q.soal)}\n\n`; });
  md += `## 11. Rubrik Penilaian\n\n${markdownTable(rubric, ['Aspek', 'Skor 4', 'Skor 3', 'Skor 2', 'Skor 1'])}\n\n`;
  md += `## 12. Kunci Jawaban\n\n`;
  kunci.slice(0, 5).forEach((a, i) => { md += `${i + 1}. ${sanitizeForbiddenBookInstructions(a)}\n\n`; });
  md += `## 13. Tugas Rumah\n\n${c.tugas_rumah.length ? listMarkdown(c.tugas_rumah) : '- Tidak ada tugas rumah khusus.'}\n\n`;
  md += `## 14. Catatan Guru\n\n${listMarkdown(c.catatan_guru)}\n\n`;
  if (c.materi_pengayaan.length) md += `## 15. Materi Pengayaan\n\n${listMarkdown(c.materi_pengayaan)}\n\n`;
  md += `> Catatan internal guru: sumber materi halaman ${doc.halaman}. Jangan digunakan sebagai instruksi kepada murid.\n`;
  return sanitizeStudentTerm(md);
}

function buildPrompt(task, ctx, pertemuan) {
  const intrakurikuler = task.jenis_kegiatan === 'Intrakurikuler';
  const multimedia = task.jenis_kegiatan === 'Ekstrakurikuler' && /Multimedia/i.test(task.mapel);
  const extraIps = task.jenis_kegiatan === 'Ekstrakurikuler' && /IPS/i.test(task.mapel);
  const approaches = task.mapel === 'IPS'
    ? 'Problem Based Learning, Case Method, literasi data, peta/grafik jika relevan, HOTS.'
    : task.mapel === 'IPA'
      ? 'pendekatan saintifik: observasi, eksperimen sederhana bila relevan, diskusi, analisis hasil, kesimpulan.'
      : task.mapel === 'Informatika'
        ? 'praktik, computational thinking, dan langkah kerja jelas sesuai materi.'
        : multimedia
          ? 'Project Based Learning dan produk nyata.'
          : extraIps
            ? 'latihan soal analitis, pembahasan, strategi memahami soal, pengayaan konsep.'
            : task.mapel === 'Guru Piket'
              ? 'checklist tugas, jurnal piket, catatan pemantauan.'
              : 'pendekatan aktif dan kolaboratif.';

  const context = safeText(ctx?.context || '');
  return `Kamu adalah Agent Content Generator dan AI Instructional Designer untuk guru MTs.

HASILKAN SATU PERANGKAT PEMBELAJARAN LENGKAP DARI TASK INI.

ATURAN MUTLAK:
1. Buku/context adalah sumber utama. Fakta, definisi, angka, nama, dan klaim materi harus berasal dari SOURCE CONTEXT untuk task berbuku.
2. Jangan keluar dari cakupan source context dan jangan memasukkan materi dari bab/subbab lain.
3. Satu pertemuan hanya satu subbab.
4. Gunakan kata "Murid", bukan "Peserta didik" atau "siswa".
5. Jangan menulis perintah membuka/membaca buku atau halaman tertentu. Semua bahan yang dibutuhkan murid harus ada di LKPD.
6. Jika membuat tambahan pedagogis, tandai sebagai rekomendasi guru secara tersirat melalui aktivitas/tugas. Jangan menyamarkannya sebagai fakta buku.
7. Hal yang benar-benar berada di luar source context hanya boleh masuk field materi_pengayaan.
8. KBC tepat satu dari ${JSON.stringify(KBC_OPTIONS)} hanya untuk Intrakurikuler.
9. Lintas Disiplin Ilmu tepat satu dari ${JSON.stringify(LDI_OPTIONS)} hanya untuk Intrakurikuler.
10. Pendekatan mapel: ${approaches}
11. Profil Pelajar Pancasila maksimal 4 dimensi.
12. Asesmen diagnostik tepat 3 item.
13. Asesmen formatif tepat 5 soal.
14. Rubrik tepat minimal 4 aspek, skor 1-4.
15. LKPD wajib berisi judul, identitas, tujuan, petunjuk, alat/bahan bila relevan, bahan bacaan/data, aktivitas utama, pertanyaan analisis, refleksi, kesimpulan.
16. Jangan mengembalikan object pada array aktivitas atau kunci jawaban; semua elemen array harus berupa string sederhana, kecuali kegiatan_pembelajaran dan rubrik yang memang object sesuai schema.
17. Output JSON valid saja. Tidak ada markdown fence.

TASK:
${JSON.stringify({ ...task, kepala_madrasah: headMaster(task.sekolah), pertemuan }, null, 2)}

SOURCE CONTEXT:
${context || '(Task non-buku atau tidak membutuhkan context buku.)'}

OUTPUT SCHEMA:
{
  "judul_materi": "",
  "identitas": {"tema_kbc": null, "lintas_disiplin_ilmu": null},
  "tujuan_pembelajaran": [""],
  "profil_pelajar_pancasila": [""],
  "pemahaman_bermakna": [""],
  "pertanyaan_pemantik": [""],
  "materi_inti": [""],
  "kegiatan_pembelajaran": [
    {"Tahap":"Pendahuluan","Aktivitas Guru":"","Aktivitas Siswa":"","Waktu":"10 menit"},
    {"Tahap":"Inti","Aktivitas Guru":"","Aktivitas Siswa":"","Waktu":"40 menit"},
    {"Tahap":"Penutup","Aktivitas Guru":"","Aktivitas Siswa":"","Waktu":"10 menit"}
  ],
  "lkpd": {"judul":"","tujuan":[""],"petunjuk":[""],"alat_bahan":[""],"bacaan":"","aktivitas":[""],"pertanyaan_analisis":[""],"refleksi":[""],"kesimpulan":""},
  "asesmen_diagnostik":["","",""],
  "asesmen_formatif":[{"soal":""},{"soal":""},{"soal":""},{"soal":""},{"soal":""}],
  "rubrik_penilaian":[{"Aspek":"","Skor 4":"","Skor 3":"","Skor 2":"","Skor 1":""}],
  "kunci_jawaban":["","","","",""],
  "tugas_rumah":[""],
  "catatan_guru":[""],
  "materi_pengayaan":[""],
  "source_fidelity":{"factual_content":"source_derived","pedagogical_additions":"teacher_recommendations"}
}`;
}

function parseJson(text) {
  const cleaned = String(text || '').replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
  return JSON.parse(cleaned);
}

async function generateGemini(prompt) {
  const key = env('GEMINI_API_KEY');
  if (!key) return null;
  const model = env('GEMINI_MODEL') || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.1, responseMimeType: 'application/json' } }), cache: 'no-store' });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Gemini HTTP ${r.status}: ${data?.error?.message || 'request gagal'}`);
  const text = (data?.candidates || []).flatMap(c => c?.content?.parts || []).map(p => p?.text || '').join('\n').trim();
  if (!text) throw new Error('Gemini tidak mengembalikan konten.');
  return { provider: 'gemini', model, text };
}

async function generateOpenAI(prompt) {
  const key = env('OPENAI_API_KEY');
  if (!key) return null;
  const model = env('OPENAI_MODEL') || 'gpt-4.1-mini';
  const r = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ model, temperature: 0.1, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: 'Return only valid JSON. Use Murid, not Peserta didik or siswa.' }, { role: 'user', content: prompt }] }), cache: 'no-store' });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`OpenAI HTTP ${r.status}: ${data?.error?.message || 'request gagal'}`);
  const text = data?.choices?.[0]?.message?.content?.trim() || '';
  if (!text) throw new Error('OpenAI tidak mengembalikan konten.');
  return { provider: 'openai', model, text };
}

async function getContextOrigin(request) {
  const proto = request.headers.get('x-forwarded-proto');
  const host = request.headers.get('host');
  return proto && host ? `${proto}://${host}` : `https://${env('VERCEL_URL')}`;
}

async function nextMeeting(db, task) {
  try {
    const rows = await db`SELECT pertemuan_terakhir FROM progress WHERE sekolah=${task.sekolah} AND mapel=${task.mapel} AND kelas=${task.kelas || '-'} LIMIT 1`;
    const last = Number(rows?.[0]?.pertemuan_terakhir);
    return Number.isFinite(last) && last > 0 ? last + 1 : 1;
  } catch { return 1; }
}

function normalizeTask(task, ctx, pertemuan) {
  const tanggal = cleanDate(task.tanggal);
  const jam = task.jam_mulai && task.jam_selesai ? `${task.jam_mulai}-${task.jam_selesai}` : '-';
  const isPiket = task.jenis_kegiatan === 'Tugas Tambahan' || task.mapel === 'Guru Piket';
  const isIntrakurikuler = task.jenis_kegiatan === 'Intrakurikuler';
  const kelas = task.kelas || '-';
  const subbab = ctx?.subbab || '-';
  return {
    task_id: String(task.task_id), tanggal, sekolah: task.sekolah || '', kepala_madrasah: headMaster(task.sekolah), jam,
    mapel: task.mapel || '', kelas, pertemuan, bab: ctx?.bab || '-', subbab,
    halaman: ctx?.pages?.length ? `${Math.min(...ctx.pages)}-${Math.max(...ctx.pages)}` : '-',
    jenis_kegiatan: task.jenis_kegiatan || '',
    tema_kbc: isIntrakurikuler ? defaultKbc(task.mapel) : null,
    lintas_disiplin_ilmu: isIntrakurikuler ? defaultLdi(task.mapel) : null,
    suggested_file_name: isPiket ? `${tanggal} - ${shortSchool(task.sekolah)} - Guru Piket` : `${tanggal} - ${shortSchool(task.sekolah)} - ${task.mapel} - Kelas ${kelas} - Pertemuan ${pertemuan}`,
    output_folder: outputFolder(task.mapel, task.sekolah),
    progress_update_required: Boolean(task.requires_progress_update),
  };
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const tanggal = cleanDate(body?.tanggal || new Date().toISOString().slice(0, 10));
    const taskId = body?.task_id ? String(body.task_id) : null;
    const origin = await getContextOrigin(request);
    const contextResponse = await fetch(`${origin}/api/context-extractor-engine?run=${Date.now()}`, { method: 'POST', headers: { 'content-type': 'application/json', 'cache-control': 'no-cache' }, body: JSON.stringify({ tanggal }), cache: 'no-store' });
    const contextResult = await contextResponse.json();
    if (!contextResponse.ok || contextResult?.status !== 'success') return Response.json({ agent: 'content_generator', status: 'error', reason: 'Context Extractor gagal.', context_result: contextResult }, { status: 500 });

    const db = dbClient();
    const taskRows = taskId ? await db`SELECT * FROM tasks WHERE task_id=${taskId} LIMIT 1` : await db`SELECT * FROM tasks WHERE tanggal=${tanggal} ORDER BY task_id`;
    const contextMap = new Map((contextResult.tasks || []).map(t => [String(t.task_id), t]));
    const provider = env('GEMINI_API_KEY') ? 'gemini' : env('OPENAI_API_KEY') ? 'openai' : null;
    const documents = [];

    for (const row of taskRows) {
      const ctx = contextMap.get(String(row.task_id)) || null;
      if (row.requires_book && (!ctx || ctx.status !== 'success' || !ctx.context_valid)) {
        documents.push({ task_id: row.task_id, status: 'skipped', reason: 'Context buku belum valid.', sekolah: row.sekolah, mapel: row.mapel, kelas: row.kelas });
        continue;
      }
      const pertemuan = await nextMeeting(db, row);
      const doc = normalizeTask(row, ctx, pertemuan);
      let raw;
      let mode = 'extractive_fallback';
      let meta = { provider: null, model: null };
      if (provider) {
        const prompt = buildPrompt(row, ctx || {}, pertemuan);
        const result = provider === 'gemini' ? await generateGemini(prompt) : await generateOpenAI(prompt);
        raw = parseJson(result.text);
        mode = `ai:${result.provider}`;
        meta = result;
      } else {
        raw = fallbackContent(row, ctx || {}, pertemuan);
      }

      const content = normalizeContent(raw, doc);
      doc.judul_materi = content.judul_materi;
      doc.tema_kbc = content.identitas.tema_kbc;
      doc.lintas_disiplin_ilmu = content.identitas.lintas_disiplin_ilmu;
      doc.document_markdown = buildDocumentMarkdown(doc, content);

      documents.push({ ...doc, status: 'success', mode, provider: meta.provider, model: meta.model, source_pages: ctx?.pages || [], source_characters: ctx?.total_context_characters || 0 });
    }

    return Response.json({ agent: 'content_generator', status: 'success', tanggal, hari: dayName(tanggal), documents });
  } catch (error) {
    console.error('Content Generator V2 error:', error);
    return Response.json({ agent: 'content_generator', status: 'error', reason: error instanceof Error ? error.message : 'Content Generator gagal.' }, { status: 500 });
  }
}
