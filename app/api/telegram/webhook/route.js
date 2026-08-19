import { neon } from '@neondatabase/serverless';
import { after } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const env = (n) => typeof process.env[n] === 'string' ? process.env[n].trim() : '';
const DAY_NAMES = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];

function jakartaNow() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(p => [p.type, p.value]));
  const date = new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)));
  return { tanggal: `${values.year}-${values.month}-${values.day}`, hari: DAY_NAMES[date.getUTCDay()] };
}

function formatTime(v) {
  const s = String(v ?? '').trim();
  if (!s) return '-';
  const m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : s.slice(0, 5);
}

async function sendMessage(chatId, text) {
  const token = env('TELEGRAM_BOT_TOKEN');
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN belum tersedia.');
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }), cache: 'no-store'
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d?.ok !== true) throw new Error(`Telegram sendMessage gagal: ${d?.description || `HTTP ${r.status}`}`);
  return d.result;
}

function originFrom(request) {
  const host = request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  return host ? `${proto}://${host}` : `https://${env('VERCEL_URL')}`;
}

async function runDailyPipeline(origin, tanggal) {
  const secret = env('CRON_SECRET');
  const headers = { 'content-type': 'application/json', 'cache-control': 'no-cache' };
  if (secret) headers.authorization = `Bearer ${secret}`;
  const response = await fetch(`${origin}/api/cron/daily-pipeline?manual=${Date.now()}`, { method: 'GET', headers, cache: 'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.reason || `Daily pipeline HTTP ${response.status}`);
  return data;
}

async function ensureRunTable(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS pipeline_runs (
      tanggal DATE PRIMARY KEY,
      status TEXT NOT NULL,
      tasks JSONB,
      documents JSONB,
      publisher JSONB,
      reason TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

async function resendStoredRun(origin, chatId, tanggal, run) {
  const documents = Array.isArray(run.documents) ? run.documents : [];
  const tasks = Array.isArray(run.tasks) ? run.tasks : [];
  if (!documents.length) {
    await sendMessage(chatId, `📋 Hasil ${tanggal} tercatat sudah generate, tetapi tidak ada dokumen tersimpan untuk dikirim ulang.`);
    return;
  }
  await sendMessage(chatId, `📤 Hasil ${tanggal} sudah pernah digenerate.\nTidak membuat konten baru.\nMengirim ulang ${documents.length} dokumen...`);
  const response = await fetch(`${origin}/api/publisher?manual_resend=${Date.now()}`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'cache-control': 'no-cache' },
    body: JSON.stringify({ tanggal, documents, tasks }), cache: 'no-store'
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.status !== 'success') throw new Error(data?.reason || `Publisher HTTP ${response.status}`);
}

export async function POST(request) {
  try {
    const update = await request.json().catch(() => ({}));
    const message = update?.message;
    const chatId = message?.chat?.id;
    const text = String(message?.text || '').trim();
    if (!chatId) return Response.json({ ok: true, ignored: true });

    const allowedChatId = env('TELEGRAM_CHAT_ID');
    if (allowedChatId && String(chatId) !== String(allowedChatId)) return Response.json({ ok: true, ignored: true });

    const command = text.split(/\s+/)[0].toLowerCase().split('@')[0];

    if (command === '/hari_ini' || command === 'hari_ini') {
      const databaseUrl = env('DATABASE_URL');
      if (!databaseUrl) throw new Error('DATABASE_URL belum tersedia.');
      const sql = neon(databaseUrl);
      const { tanggal } = jakartaNow();
      await ensureRunTable(sql);
      const origin = originFrom(request);
      const existing = await sql`
        SELECT status, tasks, documents, publisher, reason
        FROM pipeline_runs
        WHERE tanggal = ${tanggal}
        LIMIT 1
      `;
      const run = existing[0];

      if (run?.status === 'running') {
        await sendMessage(chatId, `⏳ Generate ${tanggal} masih berjalan.\nTidak menjalankan pipeline baru.`);
        return Response.json({ ok: true, command: '/hari_ini', tanggal, action: 'already_running' });
      }

      if (run?.status === 'success') {
        after(async () => {
          try { await resendStoredRun(origin, chatId, tanggal, run); }
          catch (error) {
            console.error('Manual resend error:', error);
            try { await sendMessage(chatId, `❌ Gagal mengirim ulang hasil ${tanggal}: ${error instanceof Error ? error.message : 'error'}`); } catch {}
          }
        });
        return Response.json({ ok: true, command: '/hari_ini', tanggal, action: 'resend_existing' });
      }

      // Atomically claim the date for this run. A concurrent request that wins the insert/update will own the run.
      const claimed = await sql`
        INSERT INTO pipeline_runs (tanggal, status, tasks, documents, publisher, reason, updated_at)
        VALUES (${tanggal}, 'running', '[]'::jsonb, '[]'::jsonb, NULL, NULL, NOW())
        ON CONFLICT (tanggal) DO UPDATE SET
          status = CASE WHEN pipeline_runs.status = 'running' THEN 'running' ELSE 'running' END,
          reason = NULL,
          updated_at = NOW()
        RETURNING status
      `;

      if (claimed[0]?.status !== 'running') {
        await sendMessage(chatId, `⏳ Generate ${tanggal} sedang diproses.`);
        return Response.json({ ok: true, command: '/hari_ini', tanggal, action: 'already_running' });
      }

      await sendMessage(chatId, `🔄 Generate hari ini dimulai.\n📅 ${tanggal}\nPipeline dijalankan sekarang...`);
      after(async () => {
        try {
          const result = await runDailyPipeline(origin, tanggal);
          if (result?.status !== 'success') throw new Error(result?.reason || 'Pipeline gagal.');
        } catch (error) {
          console.error('Manual pipeline error:', error);
          try { await sendMessage(chatId, `❌ Generate hari ini ${tanggal} gagal:\n${error instanceof Error ? error.message : 'error'}`); } catch {}
        }
      });
      return Response.json({ ok: true, command: '/hari_ini', tanggal, action: 'generate' });
    }

    if (command !== '/jadwal') return Response.json({ ok: true, ignored: true });

    const databaseUrl = env('DATABASE_URL');
    if (!databaseUrl) throw new Error('DATABASE_URL belum tersedia.');
    const sql = neon(databaseUrl);
    const { tanggal, hari } = jakartaNow();
    const rows = await sql`
      SELECT sekolah, jam_mulai, jam_selesai, mapel, kelas, jenis_kegiatan, catatan
      FROM jadwal
      WHERE hari = ${hari} AND aktif = TRUE
      ORDER BY jam_mulai ASC NULLS LAST, id ASC
    `;

    const lines = ['📅 YAUMITEACH — JADWAL HARI INI', `${hari}, ${tanggal.split('-').reverse().join('/')}`, ''];
    if (!rows.length) {
      lines.push('Tidak ada jadwal mengajar hari ini.');
    } else {
      let lastSchool = '';
      for (const row of rows) {
        if (row.sekolah !== lastSchool) {
          if (lastSchool) lines.push('');
          lines.push(`🏫 ${row.sekolah}`);
          lastSchool = row.sekolah;
        }
        const start = formatTime(row.jam_mulai), end = formatTime(row.jam_selesai);
        const jam = start === '-' && end === '-' ? '-' : `${start}-${end}`;
        const isPiket = String(row.mapel || '').toLowerCase() === 'guru piket';
        const isEks = String(row.jenis_kegiatan || '').toLowerCase().includes('ekstrakurikuler');
        const icon = isPiket ? '📋' : isEks ? '🎨' : '📚';
        const kelas = row.kelas && row.kelas !== '-' ? ` Kelas ${row.kelas}` : '';
        lines.push(`${icon} ${jam} — ${row.mapel}${kelas}`);
        if (row.catatan) lines.push(`   ${row.catatan}`);
      }
    }

    await sendMessage(chatId, lines.join('\n'));
    return Response.json({ ok: true, command: '/jadwal', tanggal, hari, total: rows.length });
  } catch (error) {
    console.error('Telegram webhook error:', error);
    return Response.json({ ok: true }, { status: 200 });
  }
}
