import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';
export const maxDuration = 30;
export const dynamic = 'force-dynamic';

const env = (n) => typeof process.env[n] === 'string' ? process.env[n].trim() : '';
const DAY_NAMES = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];

function jakartaNow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(p => [p.type, p.value]));
  const date = new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)));
  return {
    tanggal: `${values.year}-${values.month}-${values.day}`,
    hari: DAY_NAMES[date.getUTCDay()]
  };
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
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
    cache: 'no-store'
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d?.ok !== true) throw new Error(`Telegram sendMessage gagal: ${d?.description || `HTTP ${r.status}`}`);
  return d.result;
}

export async function POST(request) {
  try {
    const update = await request.json().catch(() => ({}));
    const message = update?.message;
    const chatId = message?.chat?.id;
    const text = String(message?.text || '').trim();
    if (!chatId) return Response.json({ ok: true, ignored: true });

    const allowedChatId = env('TELEGRAM_CHAT_ID');
    if (allowedChatId && String(chatId) !== String(allowedChatId)) {
      return Response.json({ ok: true, ignored: true });
    }

    const command = text.split(/\s+/)[0].toLowerCase().split('@')[0];
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

    const lines = [
      '📅 YAUMITEACH — JADWAL HARI INI',
      `${hari}, ${tanggal.split('-').reverse().join('/')}`,
      ''
    ];

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
        const start = formatTime(row.jam_mulai);
        const end = formatTime(row.jam_selesai);
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
