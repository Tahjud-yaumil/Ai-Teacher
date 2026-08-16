import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';

const HEADMASTER_BY_SCHOOL = {
  'MTs Darun Najah Gading': 'Zainuri, S.Pd., M.Pd.I',
  'MTs Brawijaya Kota Mojokerto': 'Elya Husniati, S.Pd (NIP. 198003042005012002)',
};

const DAY_NAMES = [
  'Minggu',
  'Senin',
  'Selasa',
  'Rabu',
  'Kamis',
  'Jumat',
  'Sabtu',
];

function getJakartaDateString() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function getDayName(dateString) {
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return DAY_NAMES[date.getUTCDay()];
}

function isValidDateString(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function buildTaskFlags(jenisKegiatan) {
  const normalized = String(jenisKegiatan || '').toLowerCase();
  const intrakurikuler = normalized.includes('intrakurikuler');
  const ekstrakurikuler = normalized.includes('ekstrakurikuler');

  return {
    requiresBook: intrakurikuler,
    requiresGoogleDoc: intrakurikuler || ekstrakurikuler,
    requiresProgressUpdate: intrakurikuler || ekstrakurikuler,
    requiresKbc: intrakurikuler,
    requiresLintasDisiplin: intrakurikuler,
  };
}

export async function POST(request) {
  try {
    if (!process.env.DATABASE_URL) {
      return Response.json(
        { agent: 'scheduler', status: 'error', reason: 'DATABASE_URL belum tersedia.' },
        { status: 500 }
      );
    }

    let requestedDate = '';
    try {
      const body = await request.json();
      requestedDate = body?.date || '';
    } catch {
      // Empty body is valid; use today's Jakarta date.
    }

    const tanggal = requestedDate || getJakartaDateString();

    if (!isValidDateString(tanggal)) {
      return Response.json(
        { agent: 'scheduler', status: 'error', reason: 'Format tanggal harus YYYY-MM-DD.' },
        { status: 400 }
      );
    }

    const hari = getDayName(tanggal);
    const sql = neon(process.env.DATABASE_URL);

    const schedules = await sql`
      SELECT
        id,
        sekolah,
        jam_mulai,
        jam_selesai,
        mapel,
        kelas,
        jenis_kegiatan,
        catatan
      FROM jadwal
      WHERE hari = ${hari}
        AND aktif = TRUE
      ORDER BY jam_mulai ASC NULLS LAST, id ASC
    `;

    if (schedules.length === 0) {
      return Response.json({
        agent: 'scheduler',
        status: 'no_schedule',
        tanggal,
        hari,
        timezone: 'Asia/Jakarta',
        tasks: [],
      });
    }

    const tasks = [];

    for (let index = 0; index < schedules.length; index += 1) {
      const row = schedules[index];
      const taskId = `${tanggal}-${String(index + 1).padStart(3, '0')}`;
      const flags = buildTaskFlags(row.jenis_kegiatan);
      const isGuruPiket = String(row.mapel).toLowerCase() === 'guru piket';
      const kepalaMadrasah = HEADMASTER_BY_SCHOOL[row.sekolah] || '';

      const task = {
        task_id: taskId,
        tanggal,
        hari,
        sekolah: row.sekolah,
        kepala_madrasah: kepalaMadrasah,
        jam_mulai: row.jam_mulai ? String(row.jam_mulai).slice(0, 5) : null,
        jam_selesai: row.jam_selesai ? String(row.jam_selesai).slice(0, 5) : null,
        mapel: row.mapel,
        kelas: row.jenis_kegiatan === 'Ekstrakurikuler' ? '-' : row.kelas,
        jenis_kegiatan: row.jenis_kegiatan,
        catatan: row.catatan || '',
        requires_book: isGuruPiket ? false : flags.requiresBook,
        requires_google_doc: isGuruPiket ? false : flags.requiresGoogleDoc,
        requires_progress_update: isGuruPiket ? false : flags.requiresProgressUpdate,
        requires_kbc: isGuruPiket ? false : flags.requiresKbc,
        requires_lintas_disiplin: isGuruPiket ? false : flags.requiresLintasDisiplin,
      };

      await sql`
        INSERT INTO tasks (
          task_id,
          tanggal,
          hari,
          sekolah,
          kepala_madrasah,
          jam_mulai,
          jam_selesai,
          mapel,
          kelas,
          jenis_kegiatan,
          catatan,
          requires_book,
          requires_google_doc,
          requires_progress_update,
          requires_kbc,
          requires_lintas_disiplin,
          status
        ) VALUES (
          ${task.task_id},
          ${task.tanggal},
          ${task.hari},
          ${task.sekolah},
          ${task.kepala_madrasah},
          ${task.jam_mulai},
          ${task.jam_selesai},
          ${task.mapel},
          ${task.kelas},
          ${task.jenis_kegiatan},
          ${task.catatan},
          ${task.requires_book},
          ${task.requires_google_doc},
          ${task.requires_progress_update},
          ${task.requires_kbc},
          ${task.requires_lintas_disiplin},
          'pending'
        )
        ON CONFLICT (task_id) DO NOTHING
      `;

      tasks.push(task);
    }

    return Response.json({
      agent: 'scheduler',
      status: 'success',
      tanggal,
      hari,
      timezone: 'Asia/Jakarta',
      tasks,
    });
  } catch (error) {
    console.error('Scheduler error:', error);
    return Response.json(
      {
        agent: 'scheduler',
        status: 'error',
        reason: error instanceof Error ? error.message : 'Scheduler gagal dijalankan.',
      },
      { status: 500 }
    );
  }
}
