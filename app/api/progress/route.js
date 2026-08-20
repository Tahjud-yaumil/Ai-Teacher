import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';

const BASELINE_SUBBAB = 3;
const BASELINE_MEETING = BASELINE_SUBBAB - 1;

function getSql() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL belum tersedia.');
  return neon(process.env.DATABASE_URL);
}
function json(data, status = 200) { return Response.json(data, { status }); }
function nextTeachingMeeting(row) {
  const last = Number(row?.pertemuan_terakhir || 0);
  return Math.max(BASELINE_SUBBAB, last + 1);
}
function payload(task, row, meeting, progressStatus, extra = {}) {
  return {
    task_id: task.task_id,
    sekolah: task.sekolah,
    mapel: task.mapel,
    kelas: task.kelas,
    pertemuan_berikutnya: meeting,
    target_subbab: `Subab ${BASELINE_SUBBAB}`,
    progress_status: progressStatus,
    bab_sebelumnya: row?.bab_terakhir || '',
    subbab_sebelumnya: row?.subbab_terakhir || '',
    halaman_akhir_sebelumnya: Number(row?.halaman_akhir || 0),
    materi_terakhir: row?.materi_terakhir || '',
    status_progress: row?.status || 'new',
    requires_book: Boolean(task.requires_book),
    requires_kbc: Boolean(task.requires_kbc),
    requires_lintas_disiplin: Boolean(task.requires_lintas_disiplin),
    ...extra,
  };
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const sql = getSql();
    const taskId = body.task_id ? String(body.task_id) : null;
    const tanggal = body.tanggal ? String(body.tanggal) : null;
    if (!taskId && !tanggal) return json({ agent: 'progress_manager', status: 'error', reason: 'Kirim task_id atau tanggal.' }, 400);

    const tasks = taskId
      ? await sql`SELECT * FROM tasks WHERE task_id = ${taskId} LIMIT 1`
      : await sql`SELECT * FROM tasks WHERE tanggal = ${tanggal} AND status IN ('pending','progress_ready') ORDER BY jam_mulai NULLS LAST, task_id`;

    if (!tasks.length) {
      const diagnostics = tanggal
        ? await sql`SELECT (SELECT COUNT(*)::int FROM tasks) AS total_tasks, (SELECT COUNT(*)::int FROM tasks WHERE tanggal = ${tanggal}) AS matching_date_tasks, (SELECT COUNT(*)::int FROM tasks WHERE tanggal = ${tanggal} AND status = 'pending') AS pending_date_tasks, (SELECT COUNT(*)::int FROM tasks WHERE tanggal = ${tanggal} AND status = 'progress_ready') AS progress_ready_date_tasks, (SELECT COUNT(*)::int FROM progress) AS progress_rows`
        : await sql`SELECT (SELECT COUNT(*)::int FROM tasks) AS total_tasks, 0::int AS matching_date_tasks, 0::int AS pending_date_tasks, 0::int AS progress_ready_date_tasks, (SELECT COUNT(*)::int FROM progress) AS progress_rows`;
      return json({ agent: 'progress_manager', status: 'no_tasks', tanggal, tasks: [], diagnostics: diagnostics[0], reason: 'Tidak ada task yang siap diproses untuk tanggal tersebut.' });
    }

    const results = [];
    for (const task of tasks) {
      if (task.status === 'progress_ready' && task.pertemuan_berikutnya !== null) {
        results.push(payload(task, null, Number(task.pertemuan_berikutnya), task.progress_status || 'existing', { status_progress: 'reused', idempotent: true }));
        continue;
      }

      if (task.jenis_kegiatan === 'Tugas Tambahan' || task.mapel === 'Guru Piket') {
        await sql`UPDATE tasks SET progress_status='not_required', status='progress_ready', updated_at=NOW() WHERE task_id=${task.task_id}`;
        results.push({ task_id: task.task_id, progress_status: 'not_required', pertemuan_berikutnya: null, target_subbab: null, sekolah: task.sekolah, mapel: task.mapel, kelas: task.kelas, catatan: 'Guru Piket tidak membutuhkan progres pembelajaran.' });
        continue;
      }

      const kelas = task.kelas || '-';
      const previous = await sql`SELECT * FROM progress WHERE sekolah=${task.sekolah} AND mapel=${task.mapel} AND kelas=${task.jenis_kegiatan === 'Ekstrakurikuler' ? '-' : kelas} LIMIT 1`;
      let row = previous[0] || null;

      // Pengajaran sudah berjalan sebelum pipeline ini dipasang. Untuk akun/progres
      // yang masih menyimpan pertemuan 0/1, persist baseline agar Content Generator
      // yang membaca tabel progress juga mendapatkan pertemuan berikutnya yang benar.
      if (row) {
        const lastMeeting = Number(row.pertemuan_terakhir || 0);
        if (lastMeeting < BASELINE_MEETING) {
          await sql`
            UPDATE progress
            SET pertemuan_terakhir=${BASELINE_MEETING},
                subbab_terakhir=CASE
                  WHEN COALESCE(subbab_terakhir, '') = '' THEN ${`Subab ${BASELINE_MEETING}`}
                  ELSE subbab_terakhir
                END,
                updated_at=NOW()
            WHERE sekolah=${task.sekolah}
              AND mapel=${task.mapel}
              AND kelas=${task.jenis_kegiatan === 'Ekstrakurikuler' ? '-' : kelas}
          `;
          row = { ...row, pertemuan_terakhir: BASELINE_MEETING, subbab_terakhir: row.subbab_terakhir || `Subab ${BASELINE_MEETING}` };
        }
      }

      const nextMeeting = nextTeachingMeeting(row);
      const progressStatus = row ? 'existing' : 'new';

      await sql`UPDATE tasks SET pertemuan_berikutnya=${nextMeeting}, progress_status=${progressStatus}, status='progress_ready', updated_at=NOW() WHERE task_id=${task.task_id}`;
      results.push(payload(task, row, nextMeeting, progressStatus));
    }

    return json({ agent: 'progress_manager', status: 'success', tanggal: tanggal || tasks[0]?.tanggal, tasks: results, baseline_subbab: BASELINE_SUBBAB });
  } catch (error) {
    console.error('Progress Manager error:', error);
    return json({ agent: 'progress_manager', status: 'error', reason: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const tanggal = searchParams.get('tanggal');
    const sql = getSql();
    const rows = tanggal
      ? await sql`SELECT t.task_id,t.tanggal,t.sekolah,t.mapel,t.kelas,t.pertemuan_berikutnya,t.progress_status,t.status,p.bab_terakhir,p.subbab_terakhir,p.halaman_akhir,p.materi_terakhir,p.tanggal_terakhir,p.status AS progress_status_sheet FROM tasks t LEFT JOIN progress p ON p.sekolah=t.sekolah AND p.mapel=t.mapel AND p.kelas=t.kelas WHERE t.tanggal=${tanggal} ORDER BY t.jam_mulai NULLS LAST,t.task_id`
      : await sql`SELECT * FROM progress ORDER BY sekolah,mapel,kelas`;
    return json({ agent: 'progress_manager', status: 'success', tanggal, data: rows, baseline_subbab: BASELINE_SUBBAB });
  } catch (error) {
    return json({ agent: 'progress_manager', status: 'error', reason: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
}
