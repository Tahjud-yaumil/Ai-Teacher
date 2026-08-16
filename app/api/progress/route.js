import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';

function getSql() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL belum tersedia.');
  }
  return neon(process.env.DATABASE_URL);
}

function json(data, status = 200) {
  return Response.json(data, { status });
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const sql = getSql();

    const taskId = body.task_id ? String(body.task_id) : null;
    const tanggal = body.tanggal ? String(body.tanggal) : null;

    if (!taskId && !tanggal) {
      return json({
        agent: 'progress_manager',
        status: 'error',
        reason: 'Kirim task_id atau tanggal.'
      }, 400);
    }

    const tasks = taskId
      ? await sql`
          SELECT * FROM tasks
          WHERE task_id = ${taskId}
          LIMIT 1
        `
      : await sql`
          SELECT * FROM tasks
          WHERE tanggal = ${tanggal}
            AND status = 'pending'
          ORDER BY jam_mulai NULLS LAST, task_id
        `;

    if (!tasks.length) {
      return json({
        agent: 'progress_manager',
        status: 'no_tasks',
        tanggal,
        tasks: []
      });
    }

    const results = [];

    for (const task of tasks) {
      if (task.jenis_kegiatan === 'Tugas Tambahan' || task.mapel === 'Guru Piket') {
        await sql`
          UPDATE tasks
          SET
            progress_status = 'not_required',
            status = 'progress_ready',
            updated_at = NOW()
          WHERE task_id = ${task.task_id}
        `;

        results.push({
          task_id: task.task_id,
          progress_status: 'not_required',
          pertemuan_berikutnya: null,
          sekolah: task.sekolah,
          mapel: task.mapel,
          kelas: task.kelas,
          catatan: 'Guru Piket tidak membutuhkan progres pembelajaran.'
        });
        continue;
      }

      const kelas = task.kelas || '-';

      let previous = [];
      if (task.jenis_kegiatan === 'Ekstrakurikuler') {
        previous = await sql`
          SELECT * FROM progress
          WHERE sekolah = ${task.sekolah}
            AND mapel = ${task.mapel}
            AND kelas = '-'
          LIMIT 1
        `;
      } else {
        previous = await sql`
          SELECT * FROM progress
          WHERE sekolah = ${task.sekolah}
            AND mapel = ${task.mapel}
            AND kelas = ${kelas}
          LIMIT 1
        `;
      }

      const row = previous[0] || null;
      const nextMeeting = row ? Number(row.pertemuan_terakhir || 0) + 1 : 1;
      const progressStatus = row ? 'existing' : 'new';

      await sql`
        UPDATE tasks
        SET
          pertemuan_berikutnya = ${nextMeeting},
          progress_status = ${progressStatus},
          status = 'progress_ready',
          updated_at = NOW()
        WHERE task_id = ${task.task_id}
      `;

      results.push({
        task_id: task.task_id,
        sekolah: task.sekolah,
        mapel: task.mapel,
        kelas,
        pertemuan_berikutnya: nextMeeting,
        progress_status: progressStatus,
        bab_sebelumnya: row?.bab_terakhir || '',
        subbab_sebelumnya: row?.subbab_terakhir || '',
        halaman_akhir_sebelumnya: Number(row?.halaman_akhir || 0),
        materi_terakhir: row?.materi_terakhir || '',
        status_progress: row?.status || 'new',
        requires_book: Boolean(task.requires_book),
        requires_kbc: Boolean(task.requires_kbc),
        requires_lintas_disiplin: Boolean(task.requires_lintas_disiplin)
      });
    }

    return json({
      agent: 'progress_manager',
      status: 'success',
      tanggal: tanggal || tasks[0]?.tanggal,
      tasks: results
    });
  } catch (error) {
    console.error('Progress Manager error:', error);
    return json({
      agent: 'progress_manager',
      status: 'error',
      reason: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const tanggal = searchParams.get('tanggal');
    const sql = getSql();

    const rows = tanggal
      ? await sql`
          SELECT t.task_id, t.tanggal, t.sekolah, t.mapel, t.kelas,
                 t.pertemuan_berikutnya, t.progress_status, t.status,
                 p.bab_terakhir, p.subbab_terakhir, p.halaman_akhir,
                 p.materi_terakhir, p.tanggal_terakhir, p.status AS progress_status_sheet
          FROM tasks t
          LEFT JOIN progress p
            ON p.sekolah = t.sekolah
           AND p.mapel = t.mapel
           AND p.kelas = t.kelas
          WHERE t.tanggal = ${tanggal}
          ORDER BY t.jam_mulai NULLS LAST, t.task_id
        `
      : await sql`
          SELECT * FROM progress
          ORDER BY sekolah, mapel, kelas
        `;

    return json({
      agent: 'progress_manager',
      status: 'success',
      tanggal,
      data: rows
    });
  } catch (error) {
    return json({
      agent: 'progress_manager',
      status: 'error',
      reason: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
}
