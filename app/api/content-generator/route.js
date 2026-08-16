import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

function env(name) { return typeof process.env[name] === 'string' ? process.env[name].trim() : ''; }
function dbClient() {
  const url = env('DATABASE_URL') || env('POSTGRES_PRISMA_URL') || env('POSTGRES_URL') || env('DATABASE_URL_UNPOOLED');
  if (!url) throw new Error('DATABASE_URL belum tersedia.');
  return neon(url);
}
function extractGeminiText(data) { return (data?.candidates || []).flatMap(c => c?.content?.parts || []).map(p => p?.text || '').join('\n').trim(); }
function extractOpenAIText(data) { return data?.choices?.[0]?.message?.content?.trim() || ''; }
function parseJson(text) { const cleaned = String(text || '').replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim(); return JSON.parse(cleaned); }

function fallbackGenerate(task, ctx) {
  const context = String(ctx.context || '').trim();
  const title = ctx.subbab || ctx.bab || task.mapel;
  return {
    generator_mode: 'extractive_fallback',
    source_fidelity: { factual_content: 'source_derived', pedagogical_additions: 'teacher_recommendations' },
    identitas: { sekolah: task.sekolah, mapel: task.mapel, kelas: task.kelas, jenis_kegiatan: task.jenis_kegiatan, bab: ctx.bab, subbab: ctx.subbab },
    tujuan_pembelajaran: [
      `Peserta didik mampu menjelaskan konsep utama ${title.toLowerCase()} berdasarkan materi sumber.`,
      `Peserta didik mampu mengidentifikasi informasi penting dari materi ${title.toLowerCase()}.`,
      `Peserta didik mampu mengomunikasikan pemahaman tentang ${title.toLowerCase()} berdasarkan sumber belajar.`,
    ],
    materi_inti: [context],
    aktivitas: [
      'Guru mengaitkan materi dengan pengetahuan atau pengalaman awal peserta didik.',
      'Peserta didik membaca dan mengamati konteks materi yang disediakan.',
      'Peserta didik menandai konsep, istilah, fakta, proses, atau data penting.',
      'Peserta didik berdiskusi untuk menjelaskan kembali materi dengan kata-kata sendiri.',
      'Peserta didik mengerjakan pertanyaan pemahaman dan melakukan refleksi singkat.',
    ],
    kbc: task.requires_kbc ? [
      'Peserta didik dilatih bertanggung jawab terhadap tugas.',
      'Peserta didik menghargai pendapat dan kontribusi teman saat diskusi.',
    ] : [],
    lintas_disiplin: task.requires_lintas_disiplin ? [
      'Gunakan keterkaitan lintas disiplin hanya pada bagian yang benar-benar didukung oleh sumber dan konteks kegiatan.',
    ] : [],
    pertanyaan_pemantik: [
      `Apa yang sudah kamu ketahui tentang ${title.toLowerCase()}?`,
      `Informasi apa dalam materi yang menurutmu paling penting? Mengapa?`,
      'Bagaimana materi tersebut dapat dikaitkan dengan kehidupan sehari-hari?',
    ],
    asesmen: {
      diagnostik: ['Pertanyaan awal tentang pengetahuan prasyarat peserta didik.'],
      formatif: ['Pertanyaan lisan', 'Catatan diskusi', 'Exit ticket/refleksi'],
      sumatif: ['Tugas atau tes pemahaman yang disusun guru berdasarkan materi sumber.'],
    },
    refleksi: ['Apa konsep terpenting yang saya pahami?', 'Bagian mana yang masih membingungkan?', 'Apa langkah saya setelah pembelajaran ini?'],
    tugas: ['Buat ringkasan materi berdasarkan sumber dengan kata-kata sendiri.'],
  };
}

function buildPrompt(task, ctx) {
  return `Anda adalah Content Generator YaumiTeach untuk guru MTs. Buat rancangan pembelajaran siap digunakan berdasarkan SUMBER yang diberikan.

ATURAN KERAS SUMBER:
1. Fakta, definisi, angka, nama, hubungan sebab-akibat, dan klaim materi harus berasal dari SOURCE CONTEXT.
2. Jangan menambahkan fakta umum dari pengetahuan model yang tidak ada di SOURCE CONTEXT.
3. Anda boleh membuat REKOMENDASI PEDAGOGIS baru (misalnya bentuk diskusi, asesmen, refleksi, atau tugas), tetapi jangan menuliskannya seolah-olah berasal dari buku.
4. Jangan membuat kegiatan lanjutan yang mensyaratkan informasi yang tidak tersedia di SOURCE CONTEXT.
5. Jangan menambahkan materi baru. Jika suatu detail tidak didukung sumber, nyatakan sebagai rekomendasi guru atau hilangkan.
6. Untuk tugas/asesmen yang tidak disebutkan eksplisit di sumber, tetap boleh dibuat sebagai rekomendasi pedagogis, tetapi jangan mengatakan bahwa sumber memerintahkannya.
7. Pertahankan istilah dan struktur materi sumber sedapat mungkin.
8. KBC dan lintas disiplin harus konkret dan terkait isi sumber. Hindari daftar nilai/genre disiplin yang hanya bersifat generik.
9. Output harus JSON valid saja, tanpa markdown fence.

TASK:\n${JSON.stringify(task, null, 2)}\n\nSOURCE CONTEXT:\n${ctx.context}\n\nOUTPUT JSON:\n{
  "identitas": {"sekolah":"","mapel":"","kelas":"","bab":"","subbab":"","jenis_kegiatan":""},
  "tujuan_pembelajaran": ["..."],
  "materi_inti": ["fakta/konsep yang benar-benar didukung sumber"],
  "aktivitas": ["langkah kegiatan pembelajaran; tandai aktivitas rekomendasi secara wajar, jangan klaim sebagai isi buku"],
  "kbc": ["integrasi karakter yang konkret dan relevan dengan isi sumber"],
  "lintas_disiplin": ["kaitan lintas disiplin yang konkret dan didukung isi sumber"],
  "pertanyaan_pemantik": ["..."],
  "asesmen": {"diagnostik":["..."],"formatif":["..."],"sumatif":["..."]},
  "refleksi": ["..."],
  "tugas": ["..."] ,
  "source_fidelity": {"factual_content":"source_derived","pedagogical_additions":"teacher_recommendations"}
}`;
}

async function generateWithGemini(prompt) {
  const key = env('GEMINI_API_KEY'); if (!key) return null;
  const model = env('GEMINI_MODEL') || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.15, responseMimeType: 'application/json' } }), cache: 'no-store' });
  const data = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`Gemini HTTP ${r.status}: ${data?.error?.message || 'request gagal'}`);
  const text = extractGeminiText(data); if (!text) throw new Error('Gemini tidak mengembalikan konten.');
  return { provider: 'gemini', model, text };
}

async function generateWithOpenAI(prompt) {
  const key = env('OPENAI_API_KEY'); if (!key) return null;
  const model = env('OPENAI_MODEL') || 'gpt-4.1-mini';
  const r = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ model, temperature: 0.15, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: 'Return only valid JSON and separate source-derived facts from teacher recommendations.' }, { role: 'user', content: prompt }] }), cache: 'no-store' });
  const data = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`OpenAI HTTP ${r.status}: ${data?.error?.message || 'request gagal'}`);
  const text = extractOpenAIText(data); if (!text) throw new Error('OpenAI tidak mengembalikan konten.');
  return { provider: 'openai', model, text };
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const tanggal = String(body?.tanggal || '2026-08-15');
    const taskId = body?.task_id ? String(body.task_id) : null;
    const origin = request.headers.get('x-forwarded-proto') && request.headers.get('host') ? `${request.headers.get('x-forwarded-proto')}://${request.headers.get('host')}` : `https://${process.env.VERCEL_URL}`;
    const r = await fetch(`${origin}/api/context-extractor-engine?run=${Date.now()}`, { method: 'POST', headers: { 'content-type': 'application/json', 'cache-control': 'no-cache' }, body: JSON.stringify({ tanggal }), cache: 'no-store' });
    const extracted = await r.json();
    if (!r.ok || extracted?.status !== 'success') return Response.json({ agent: 'content_generator', status: 'error', reason: 'Context Extractor gagal.', context_result: extracted }, { status: 500 });

    const db = dbClient();
    const taskRows = taskId ? await db`SELECT * FROM tasks WHERE task_id=${taskId} LIMIT 1` : await db`SELECT * FROM tasks WHERE tanggal=${tanggal} AND requires_book=TRUE ORDER BY task_id`;
    const taskMap = new Map(taskRows.map(t => [String(t.task_id), t]));
    const tasks = (extracted.tasks || []).filter(t => t.status === 'success' && t.context_valid && (!taskId || t.task_id === taskId));
    if (!tasks.length) return Response.json({ agent: 'content_generator', status: 'no_tasks', tanggal, reason: 'Tidak ada context_valid yang siap digenerate.', context_result: extracted });

    const generated = [];
    for (const ctx of tasks) {
      const row = taskMap.get(String(ctx.task_id)) || {};
      const task = {
        task_id: ctx.task_id, tanggal, sekolah: row.sekolah || '', kepala_madrasah: row.kepala_madrasah || '', mapel: row.mapel || ctx.mapel, kelas: row.kelas || ctx.kelas,
        jenis_kegiatan: row.jenis_kegiatan || 'Intrakurikuler', catatan: row.catatan || '', requires_kbc: Boolean(row.requires_kbc), requires_lintas_disiplin: Boolean(row.requires_lintas_disiplin),
      };
      const prompt = buildPrompt(task, ctx);
      let providerResult = null;
      if (env('GEMINI_API_KEY')) providerResult = await generateWithGemini(prompt); else if (env('OPENAI_API_KEY')) providerResult = await generateWithOpenAI(prompt);
      let content; let mode;
      if (providerResult) { content = parseJson(providerResult.text); mode = `ai:${providerResult.provider}`; } else { content = fallbackGenerate(task, ctx); mode = 'extractive_fallback'; }
      content.identitas = { ...(content.identitas || {}), sekolah: task.sekolah, mapel: task.mapel, kelas: task.kelas, jenis_kegiatan: task.jenis_kegiatan, bab: ctx.bab, subbab: ctx.subbab };
      content.source_fidelity = content.source_fidelity || { factual_content: 'source_derived', pedagogical_additions: 'teacher_recommendations' };
      generated.push({ task_id: ctx.task_id, status: 'success', mode, provider: providerResult?.provider || null, model: providerResult?.model || null, source_pages: ctx.pages, source_characters: ctx.total_context_characters, content });
    }
    return Response.json({ agent: 'content_generator', status: 'success', tanggal, generated });
  } catch (error) {
    console.error('Content Generator error:', error);
    return Response.json({ agent: 'content_generator', status: 'error', reason: error instanceof Error ? error.message : 'Content Generator gagal.' }, { status: 500 });
  }
}
