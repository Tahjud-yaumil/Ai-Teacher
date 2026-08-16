import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const KBC = [
  'Cinta kepada Allah','Cinta kepada Rasul','Cinta kepada Diri Sendiri',
  'Cinta kepada Sesama','Cinta kepada Lingkungan','Cinta kepada Bangsa dan Negara'
];
const LDI = ['Alquran','Fiqih','Aqidah','SKI'];

const env = (name) => typeof process.env[name] === 'string' ? process.env[name].trim() : '';

const db = () => {
  const url = env('DATABASE_URL') || env('POSTGRES_PRISMA_URL') || env('POSTGRES_URL') || env('DATABASE_URL_UNPOOLED');
  if (!url) throw new Error('DATABASE_URL belum tersedia.');
  return neon(url);
};

const cleanDate = (value) => {
  const s = String(value || '');
  const m = s.match(/\b(20\d{2})[-/](\d{2})[-/](\d{2})\b/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(d);
};

const dayName = (date) => new Intl.DateTimeFormat('id-ID', {
  weekday: 'long', timeZone: 'Asia/Jakarta'
}).format(new Date(`${date}T00:00:00+07:00`));

const shortSchool = (school) => school === 'MTs Darun Najah Gading'
  ? 'Darun Najah'
  : school === 'MTs Brawijaya Kota Mojokerto'
    ? 'Brawijaya'
    : String(school || '').replace(/^MTs\s+/i, '').trim() || 'Sekolah';

const head = (school) => school === 'MTs Darun Najah Gading'
  ? 'Zainuri, S.Pd., M.Pd.I'
  : school === 'MTs Brawijaya Kota Mojokerto'
    ? 'Elya Husniati, S.Pd (NIP. 198003042005012002)'
    : '';

const folder = (mapel, school) =>
  mapel === 'IPS' && school === 'MTs Darun Najah Gading'
    ? 'AI Teacher/Output/IPS/MTs Darun Najah'
    : mapel === 'IPS' && school === 'MTs Brawijaya Kota Mojokerto'
      ? 'AI Teacher/Output/IPS/MTs Brawijaya'
      : mapel === 'IPA'
        ? 'AI Teacher/Output/IPA'
        : mapel === 'Informatika'
          ? 'AI Teacher/Output/Informatika'
          : 'AI Teacher/Output/Ekstrakurikuler';

const defaultKbc = (mapel) => mapel === 'IPA'
  ? 'Cinta kepada Diri Sendiri'
  : mapel === 'Informatika'
    ? 'Cinta kepada Bangsa dan Negara'
    : 'Cinta kepada Sesama';

const safe = (value) => {
  if (value == null) return '';
  if (['string','number','boolean'].includes(typeof value)) return String(value);
  if (Array.isArray(value)) return value.map(safe).filter(Boolean).join(' — ');
  if (typeof value === 'object') {
    const preferred = ['soal','jawaban','kegiatan','aktivitas','teks','isi','deskripsi','tujuan','refleksi','kesimpulan'];
    const picked = preferred.map((k) => value[k] !== undefined ? safe(value[k]) : '').filter(Boolean);
    return picked.length ? picked.join(' — ') : Object.entries(value).map(([k,v]) => `${k}: ${safe(v)}`).join(' — ');
  }
  return String(value);
};

const list = (value) => (Array.isArray(value) ? value : [value])
  .map(safe).map((s) => s.replace(/^[-*]\s*/, '').trim()).filter(Boolean);

const term = (text) => String(text || '')
  .replace(/Peserta didik/gi, 'Murid')
  .replace(/\bSiswa\b/gi, 'Murid')
  .replace(/\bSiswi\b/gi, 'Murid');

const allowed = (value, allowedValues, fallback) => {
  const x = safe(value).trim();
  return allowedValues.includes(x) ? x : fallback;
};

function parseJson(text) {
  const cleaned = String(text || '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try { return JSON.parse(cleaned); } catch (error) {
    const a = cleaned.indexOf('{');
    const b = cleaned.lastIndexOf('}');
    if (a >= 0 && b > a) return JSON.parse(cleaned.slice(a, b + 1));
    throw error;
  }
}

function normalize(raw, doc) {
  const c = raw || {};
  const formative = Array.isArray(c.asesmen_formatif) ? c.asesmen_formatif.slice(0, 5) : [];
  while (formative.length < 5) formative.push({ soal: `Pertanyaan ${formative.length + 1} tentang konsep utama materi.` });

  const keys = list(c.kunci_jawaban).slice(0, 5);
  while (keys.length < 5) keys.push('Jawaban sesuai informasi materi.');

  const rubrics = Array.isArray(c.rubrik_penilaian) ? c.rubrik_penilaian.slice(0, 4) : [];
  const defaultAspects = ['Pemahaman konsep','Analisis','Kolaborasi','Komunikasi'];
  while (rubrics.length < 4) rubrics.push({
    Aspek: defaultAspects[rubrics.length],
    'Skor 4': 'Sangat baik dan tepat.',
    'Skor 3': 'Baik dengan sedikit kekurangan.',
    'Skor 2': 'Sebagian tepat dan perlu bimbingan.',
    'Skor 1': 'Belum menunjukkan penguasaan.'
  });

  const title = doc.mapel === 'Guru Piket'
    ? 'Jurnal Guru Piket'
    : (doc.subbab && doc.subbab !== '-'
      ? doc.subbab.replace(/^\s*[A-Z]\.??\s*/i, '').replace(/\s+\.{2,}.*$/, '').trim()
      : safe(c.judul_materi) || doc.mapel);

  const intr = doc.jenis_kegiatan === 'Intrakurikuler';
  const act = Array.isArray(c.kegiatan_pembelajaran) ? c.kegiatan_pembelajaran.slice(0, 3) : [];
  const activities = act.map((x) => ({
    Tahap: safe(x?.Tahap || x?.tahap),
    'Aktivitas Guru': safe(x?.['Aktivitas Guru'] || x?.aktivitas_guru || x?.guru),
    'Aktivitas Siswa': safe(x?.['Aktivitas Siswa'] || x?.aktivitas_siswa || x?.murid || x?.siswa),
    Waktu: safe(x?.Waktu || x?.waktu || x?.durasi)
  })).filter((x) => x.Tahap);

  return {
    judul_materi: title,
    identitas: {
      sekolah: doc.sekolah,
      kepala_madrasah: doc.kepala_madrasah,
      mapel: doc.mapel,
      kelas: doc.kelas,
      alokasi_waktu: doc.jam,
      pertemuan: doc.pertemuan,
      bab: doc.bab,
      subbab: doc.subbab,
      tema_kbc: intr ? allowed(c?.identitas?.tema_kbc || c.tema_kbc, KBC, doc.tema_kbc) : null,
      lintas_disiplin_ilmu: intr ? allowed(c?.identitas?.lintas_disiplin_ilmu || c.lintas_disiplin_ilmu, LDI, doc.lintas_disiplin_ilmu) : null
    },
    tujuan_pembelajaran: list(c.tujuan_pembelajaran),
    profil_pelajar_pancasila: list(c.profil_pelajar_pancasila).slice(0,4),
    pemahaman_bermakna: list(c.pemahaman_bermakna),
    pertanyaan_pemantik: list(c.pertanyaan_pemantik),
    materi_inti: list(c.materi_inti),
    kegiatan_pembelajaran: activities,
    lkpd: {
      judul: safe(c?.lkpd?.judul) || `LKPD ${title}`,
      tujuan: list(c?.lkpd?.tujuan),
      petunjuk: list(c?.lkpd?.petunjuk),
      alat_bahan: list(c?.lkpd?.alat_bahan),
      bacaan: term(safe(c?.lkpd?.bacaan)),
      aktivitas: list(c?.lkpd?.aktivitas),
      pertanyaan_analisis: list(c?.lkpd?.pertanyaan_analisis),
      refleksi: list(c?.lkpd?.refleksi),
      kesimpulan: term(safe(c?.lkpd?.kesimpulan))
    },
    asesmen_diagnostik: list(c.asesmen_diagnostik).slice(0,3),
    asesmen_formatif: formative.map((q) => ({ soal: term(safe(q?.soal || q)) })),
    rubrik_penilaian: rubrics.map((x) => ({
      Aspek: safe(x?.Aspek || x?.aspek),
      'Skor 4': safe(x?.['Skor 4'] || x?.skor4),
      'Skor 3': safe(x?.['Skor 3'] || x?.skor3),
      'Skor 2': safe(x?.['Skor 2'] || x?.skor2),
      'Skor 1': safe(x?.['Skor 1'] || x?.skor1)
    })),
    kunci_jawaban: keys,
    tugas_rumah: list(c.tugas_rumah),
    catatan_guru: list(c.catatan_guru),
    materi_pengayaan: list(c.materi_pengayaan)
  };
}

function markdown(doc, c) {
  const table = (rows, headers) => [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${headers.map((h) => term(safe(row?.[h]))).join(' | ')} |`)
  ].join('\n');
  const bullets = (items) => list(items).map((x) => `- ${term(x)}`).join('\n') || '-';
  const id = [
    ['Sekolah', doc.sekolah], ['Kepala Madrasah', doc.kepala_madrasah], ['Mapel', doc.mapel], ['Kelas', doc.kelas],
    ['Alokasi Waktu', doc.jam], ['Pertemuan', doc.pertemuan], ['Bab', doc.bab], ['Subbab', doc.subbab],
    ...(doc.tema_kbc ? [['Tema Kurikulum Berbasis Cinta', doc.tema_kbc]] : []),
    ...(doc.lintas_disiplin_ilmu ? [['Lintas Disiplin Ilmu', doc.lintas_disiplin_ilmu]] : [])
  ].map(([Aspek, Keterangan]) => ({ Aspek, Keterangan }));
  const activities = c.kegiatan_pembelajaran.length ? c.kegiatan_pembelajaran : [
    { Tahap:'Pendahuluan', 'Aktivitas Guru':'Membangun kesiapan belajar dan menyampaikan tujuan.', 'Aktivitas Siswa':'Menjawab pertanyaan awal.', Waktu:'10 menit' },
    { Tahap:'Inti', 'Aktivitas Guru':'Memfasilitasi observasi, diskusi, analisis, dan penguatan.', 'Aktivitas Siswa':'Mengamati, berdiskusi, mengerjakan LKPD, dan menyampaikan hasil.', Waktu:'40 menit' },
    { Tahap:'Penutup', 'Aktivitas Guru':'Memfasilitasi refleksi dan kesimpulan.', 'Aktivitas Siswa':'Menyampaikan kesimpulan dan refleksi.', Waktu:'10 menit' }
  ];
  let s = `# ${doc.suggested_file_name}\n\n`;
  s += `## 1. Identitas Pembelajaran\n\n${table(id, ['Aspek','Keterangan'])}\n\n`;
  s += `## 2. Tujuan Pembelajaran\n\n${bullets(c.tujuan_pembelajaran)}\n\n`;
  s += `## 3. Profil Pelajar Pancasila\n\n${bullets(c.profil_pelajar_pancasila)}\n\n`;
  s += `## 4. Pemahaman Bermakna\n\n${bullets(c.pemahaman_bermakna)}\n\n`;
  s += `## 5. Pertanyaan Pemantik\n\n${bullets(c.pertanyaan_pemantik)}\n\n`;
  s += `## 6. Ringkasan Materi Ajar\n\n${bullets(c.materi_inti)}\n\n`;
  s += `## 7. Kegiatan Pembelajaran\n\n${table(activities, ['Tahap','Aktivitas Guru','Aktivitas Siswa','Waktu'])}\n\n`;
  s += `## 8. LKPD\n\n### Judul LKPD\n${term(c.lkpd.judul)}\n\n### Identitas\n- Sekolah: ${doc.sekolah}\n- Mapel: ${doc.mapel}\n- Kelas: ${doc.kelas}\n- Pertemuan: ${doc.pertemuan}\n\n### Tujuan\n${bullets(c.lkpd.tujuan)}\n\n### Petunjuk Kerja\n${bullets(c.lkpd.petunjuk)}\n\n`;
  if (c.lkpd.alat_bahan.length) s += `### Alat dan Bahan\n${bullets(c.lkpd.alat_bahan)}\n\n`;
  if (c.lkpd.bacaan) s += `### Bahan Bacaan / Data\n${term(c.lkpd.bacaan)}\n\n`;
  s += `### Aktivitas Utama\n${bullets(c.lkpd.aktivitas)}\n\n### Pertanyaan Analisis\n${bullets(c.lkpd.pertanyaan_analisis)}\n\n### Refleksi\n${bullets(c.lkpd.refleksi)}\n\n### Kesimpulan\n${term(c.lkpd.kesimpulan) || '-'}\n\n`;
  s += `## 9. Asesmen Diagnostik\n\n${bullets(c.asesmen_diagnostik)}\n\n`;
  s += `## 10. Asesmen Formatif\n\n${c.asesmen_formatif.map((q,i) => `${i+1}. ${term(safe(q.soal))}`).join('\n\n')}\n\n`;
  s += `## 11. Rubrik Penilaian\n\n${table(c.rubrik_penilaian, ['Aspek','Skor 4','Skor 3','Skor 2','Skor 1'])}\n\n`;
  s += `## 12. Kunci Jawaban\n\n${c.kunci_jawaban.map((x,i) => `${i+1}. ${term(x)}`).join('\n')}\n\n`;
  s += `## 13. Tugas Rumah\n\n${c.tugas_rumah.length ? bullets(c.tugas_rumah) : '- Tidak ada tugas rumah khusus.'}\n\n`;
  s += `## 14. Catatan Guru\n\n${bullets(c.catatan_guru)}\n\n`;
  if (c.materi_pengayaan.length) s += `## 15. Materi Pengayaan\n\n${bullets(c.materi_pengayaan)}\n\n`;
  s += `> Catatan internal guru: sumber materi halaman ${doc.halaman}.\n`;
  return s;
}

function geminiKeys() {
  const raw = [
    ['legacy', env('GEMINI_API_KEY')],
    ['1', env('GEMINI_API_KEY_1')],
    ['2', env('GEMINI_API_KEY_2')]
  ];
  const seen = new Set();
  return raw.filter(([,key]) => {
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isFailoverError(status, message) {
  const text = String(message || '').toLowerCase();
  return status === 429 || /resource_exhausted|quota|rate.?limit|too many requests/.test(text);
}

async function callGemini(prompt, startIndex = 0) {
  const model = env('GEMINI_MODEL') || 'gemini-2.5-flash';
  const keys = geminiKeys();
  if (!keys.length) throw new Error('GEMINI_API_KEY belum tersedia.');
  const failures = [];

  for (let i = startIndex; i < keys.length; i++) {
    const [slot, key] = keys[i];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
          maxOutputTokens: 12288
        }
      }),
      cache: 'no-store'
    });
    const data = await response.json().catch(() => ({}));
    const message = data?.error?.message || 'request gagal';
    if (response.ok) {
      return {
        provider: 'gemini', model, key_slot: slot,
        text: (data?.candidates || []).flatMap((x) => x?.content?.parts || []).map((x) => x?.text || '').join('').trim(),
        finishReason: data?.candidates?.[0]?.finishReason || null
      };
    }
    failures.push(`key_${slot}: HTTP ${response.status}`);
    if (!isFailoverError(response.status, message)) {
      throw new Error(`Gemini HTTP ${response.status}: ${message}`);
    }
    // Quota/rate limit: immediately move to the next configured key.
  }

  throw new Error(`Semua Gemini API key gagal/quota: ${failures.join(', ')}.`);
}

async function ai(prompt, provider, startIndex = 0) {
  if (provider === 'gemini') return callGemini(prompt, startIndex);
  if (provider === 'openai') {
    const model = env('OPENAI_MODEL') || 'gpt-4.1-mini';
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${env('OPENAI_API_KEY')}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          { role:'system', content:'Return only valid compact JSON. Use Murid, not Peserta didik or Siswa.' },
          { role:'user', content:prompt }
        ]
      }),
      cache: 'no-store'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`OpenAI HTTP ${response.status}: ${data?.error?.message || 'request gagal'}`);
    return { provider:'openai', model, key_slot:null, text:data?.choices?.[0]?.message?.content || '', finishReason:data?.choices?.[0]?.finish_reason || null };
  }
  return null;
}

function fallbackContent(task, ctx, pertemuan) {
  const title = ctx?.subbab || ctx?.bab || task.mapel;
  return {
    identitas: {},
    judul_materi: title,
    tujuan_pembelajaran: [
      `Murid mampu menjelaskan konsep utama ${title}.`,
      `Murid mampu mengidentifikasi informasi penting dari materi ${title}.`,
      'Murid mampu menerapkan konsep pada situasi sederhana.'
    ],
    profil_pelajar_pancasila: ['Bernalar kritis','Mandiri','Gotong royong'],
    pemahaman_bermakna: ['Konsep yang dipelajari berkaitan dengan kehidupan sehari-hari.'],
    pertanyaan_pemantik: ['Apa yang sudah kamu ketahui tentang materi ini?','Mengapa materi ini penting dipahami?'],
    materi_inti: ctx?.context ? [ctx.context.slice(0, 6000)] : ['Materi buku tidak tersedia.'],
    kegiatan_pembelajaran: [],
    lkpd: { judul:`LKPD ${title}`, tujuan:['Memahami materi utama.'], petunjuk:['Kerjakan secara berkelompok.'], alat_bahan:[], bacaan:ctx?.context ? ctx.context.slice(0, 2500) : '', aktivitas:['Ringkas konsep utama.'], pertanyaan_analisis:['Apa konsep utama yang kamu temukan?'], refleksi:['Apa yang paling kamu pahami?'], kesimpulan:'Murid menyusun kesimpulan singkat.' },
    asesmen_diagnostik:['Apa yang sudah kamu ketahui?','Contoh apa yang kamu temui?','Apa yang ingin kamu pahami?'],
    asesmen_formatif:[{soal:'Jelaskan konsep utama materi.'}],
    rubrik_penilaian:[],
    kunci_jawaban:['Jawaban sesuai context buku.'],
    tugas_rumah:[], catatan_guru:['Gunakan context buku sebagai sumber utama.'], materi_pengayaan:[]
  };
}

function prompt(task, ctx, pertemuan) {
  const intr = task.jenis_kegiatan === 'Intrakurikuler';
  return `Anda adalah Agent Content Generator untuk guru MTs. Buat perangkat lengkap dari SOURCE CONTEXT. Gunakan Bahasa Indonesia formal dan kata Murid. Fakta, angka, dan definisi hanya dari context. Satu pertemuan satu subbab. Jangan memberi instruksi membuka buku. Semua bahan analisis harus ada di LKPD. KBC tepat satu dari ${JSON.stringify(KBC)} dan LDI tepat satu dari ${JSON.stringify(LDI)} hanya untuk Intrakurikuler. Diagnostik tepat 3, formatif tepat 5, rubrik tepat 4 aspek. Jangan menyalin context panjang; ringkas. LKPD bacaan maksimal 700 kata. Aktivitas maksimal 4. Jawaban maksimal 2 kalimat. Keluarkan JSON valid SAJA.\n\nTASK:\n${JSON.stringify({...task, pertemuan})}\n\nSOURCE CONTEXT:\n${ctx?.context || '(non-buku)'}\n\nSCHEMA:\n{"judul_materi":"","identitas":{"tema_kbc":${intr?'""':'null'},"lintas_disiplin_ilmu":${intr?'""':'null'}},"tujuan_pembelajaran":[],"profil_pelajar_pancasila":[],"pemahaman_bermakna":[],"pertanyaan_pemantik":[],"materi_inti":[],"kegiatan_pembelajaran":[{"Tahap":"Pendahuluan","Aktivitas Guru":"","Aktivitas Siswa":"","Waktu":"10 menit"},{"Tahap":"Inti","Aktivitas Guru":"","Aktivitas Siswa":"","Waktu":"40 menit"},{"Tahap":"Penutup","Aktivitas Guru":"","Aktivitas Siswa":"","Waktu":"10 menit"}],"lkpd":{"judul":"","tujuan":[],"petunjuk":[],"alat_bahan":[],"bacaan":"","aktivitas":[],"pertanyaan_analisis":[],"refleksi":[],"kesimpulan":""},"asesmen_diagnostik":[],"asesmen_formatif":[{"soal":""}],"rubrik_penilaian":[{"Aspek":"","Skor 4":"","Skor 3":"","Skor 2":"","Skor 1":""}],"kunci_jawaban":[],"tugas_rumah":[],"catatan_guru":[],"materi_pengayaan":[]}`;
}

async function nextMeeting(database, task) {
  try {
    const rows = await database`SELECT pertemuan_terakhir FROM progress WHERE sekolah=${task.sekolah} AND mapel=${task.mapel} AND kelas=${task.kelas || '-'} LIMIT 1`;
    const n = Number(rows?.[0]?.pertemuan_terakhir);
    return Number.isFinite(n) && n > 0 ? n + 1 : 1;
  } catch {
    return 1;
  }
}

function docOf(task, ctx, pertemuan, tanggal) {
  const kelas = task.kelas || ctx?.kelas || '-';
  return {
    task_id: String(task.task_id), tanggal,
    sekolah: task.sekolah, kepala_madrasah: head(task.sekolah),
    jam: task.jam_mulai && task.jam_selesai ? `${task.jam_mulai}-${task.jam_selesai}` : '-',
    mapel: task.mapel || ctx?.mapel || '', kelas, pertemuan,
    bab: ctx?.bab || '-', subbab: ctx?.subbab || '-',
    halaman: ctx?.pages?.length ? `${Math.min(...ctx.pages)}-${Math.max(...ctx.pages)}` : '-',
    judul_materi: ctx?.subbab || ctx?.bab || task.mapel,
    jenis_kegiatan: task.jenis_kegiatan,
    tema_kbc: task.jenis_kegiatan === 'Intrakurikuler' ? (task.mapel === 'IPS' ? 'Cinta kepada Lingkungan' : defaultKbc(task.mapel)) : null,
    lintas_disiplin_ilmu: task.jenis_kegiatan === 'Intrakurikuler' ? 'Aqidah' : null,
    suggested_file_name: task.jenis_kegiatan === 'Tugas Tambahan'
      ? `${tanggal} - ${shortSchool(task.sekolah)} - Guru Piket`
      : `${tanggal} - ${shortSchool(task.sekolah)} - ${task.mapel} - Kelas ${kelas} - Pertemuan ${pertemuan}`,
    output_folder: folder(task.mapel, task.sekolah),
    progress_update_required: Boolean(task.requires_progress_update)
  };
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const tanggal = cleanDate(body?.tanggal);
    const taskId = body?.task_id ? String(body.task_id) : null;
    const database = db();
    const rows = taskId
      ? await database`SELECT * FROM tasks WHERE task_id=${taskId} LIMIT 1`
      : await database`SELECT * FROM tasks WHERE tanggal=${tanggal} ORDER BY task_id`;

    const host = request.headers.get('host');
    const proto = request.headers.get('x-forwarded-proto');
    const origin = proto && host ? `${proto}://${host}` : `https://${env('VERCEL_URL')}`;
    const extractedResponse = await fetch(`${origin}/api/context-extractor-engine?run=${Date.now()}`, {
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({ tanggal }), cache:'no-store'
    });
    const extracted = await extractedResponse.json();
    if (!extractedResponse.ok || extracted?.status !== 'success') {
      return Response.json({ agent:'content_generator', status:'error', reason:'Context Extractor gagal.', context_result:extracted }, { status:500 });
    }

    const contextMap = new Map((extracted.tasks || []).map((x) => [String(x.task_id), x]));
    const provider = geminiKeys().length ? 'gemini' : (env('OPENAI_API_KEY') ? 'openai' : null);
    const documents = [];

    for (const row of rows) {
      const ctx = contextMap.get(String(row.task_id));
      if (row.requires_book && (!ctx || ctx.status !== 'success' || !ctx.context_valid)) {
        documents.push({ task_id:row.task_id, status:'skipped', reason:'Context buku belum valid.' });
        continue;
      }

      const pertemuan = await nextMeeting(database, row);
      const doc = docOf(row, ctx, pertemuan, tanggal);
      let content;
      let meta = null;
      let mode = 'extractive_fallback';

      if (provider) {
        const basePrompt = prompt(row, ctx || {}, pertemuan);
        const first = await ai(basePrompt, provider);
        try {
          content = normalize(parseJson(first.text), doc);
          mode = `ai:${first.provider}`;
          meta = first;
        } catch (parseError) {
          const retryPrompt = `${basePrompt}\nPENTING: respons sebelumnya tidak dapat diparse. Buat JSON jauh lebih ringkas, jangan menyalin context, LKPD bacaan maksimal 400 kata, aktivitas 3 item, dan pastikan objek JSON ditutup lengkap.`;
          const second = await ai(retryPrompt, provider);
          content = normalize(parseJson(second.text), doc);
          mode = `ai:${second.provider}:retry`;
          meta = second;
        }
      } else {
        content = normalize(fallbackContent(row, ctx || {}, pertemuan), doc);
      }

      doc.judul_materi = content.judul_materi || doc.judul_materi;
      doc.tema_kbc = content.identitas.tema_kbc;
      doc.lintas_disiplin_ilmu = content.identitas.lintas_disiplin_ilmu;
      doc.document_markdown = markdown(doc, content);

      documents.push({
        ...doc,
        status:'success', mode,
        provider:meta?.provider || null,
        model:meta?.model || null,
        api_key_slot:meta?.key_slot || null,
        source_pages:ctx?.pages || [],
        source_characters:ctx?.total_context_characters || 0
      });
    }

    return Response.json({ agent:'content_generator', status:'success', tanggal, hari:dayName(tanggal), documents });
  } catch (error) {
    console.error(error);
    return Response.json({ agent:'content_generator', status:'error', reason:error instanceof Error ? error.message : 'Content Generator gagal.' }, { status:500 });
  }
}
