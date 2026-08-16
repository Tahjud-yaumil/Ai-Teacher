import { neon } from '@neondatabase/serverless';
import { get } from '@vercel/blob';
import pdfParse from 'pdf-parse';

export const runtime = 'nodejs';
export const maxDuration = 300;

function getSql() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL belum tersedia.');
  return neon(process.env.DATABASE_URL);
}

function cleanLine(line) {
  return String(line || '').replace(/\s+/g, ' ').trim();
}

function looksLikeHeading(line) {
  const value = cleanLine(line);
  if (value.length < 4 || value.length > 120) return false;
  if (/^BAB\s+[IVXLC0-9]+\b/i.test(value)) return true;
  if (/^BAB\s+\S+/i.test(value)) return true;
  if (/^[A-Z]\s*\.\s+\S+/.test(value)) return true;
  if (/^\d+(?:\.\d+)*\s+\S+/.test(value)) return true;

  const letters = value.replace(/[^A-Za-zÀ-ÿ]/g, '');
  const upper = letters.replace(/[^A-ZÀ-Ý]/g, '');
  return letters.length >= 8 && upper.length / letters.length > 0.88;
}

function findChapterAndSubchapter(pageTexts, startPage) {
  let chapterIndex = -1;
  let chapter = '';
  let subchapter = '';
  let chapterPage = startPage;
  let subchapterPage = startPage;

  for (let i = Math.max(0, startPage - 1); i < pageTexts.length; i += 1) {
    const lines = pageTexts[i].split('\n').map(cleanLine).filter(Boolean);
    for (const line of lines) {
      if (/^BAB\s+/i.test(line)) {
        chapterIndex = i;
        chapter = line;
        chapterPage = i + 1;
        break;
      }
    }
    if (chapterIndex >= 0) break;
  }

  const searchFrom = chapterIndex >= 0 ? chapterIndex : Math.max(0, startPage - 1);
  for (let i = searchFrom; i < Math.min(pageTexts.length, searchFrom + 12); i += 1) {
    const lines = pageTexts[i].split('\n').map(cleanLine).filter(Boolean);
    for (const line of lines) {
      if (!looksLikeHeading(line)) continue;
      if (/^BAB\s+/i.test(line) && chapterIndex < 0) continue;
      if (chapter && line === chapter) continue;
      subchapter = line;
      subchapterPage = i + 1;
      break;
    }
    if (subchapter) break;
  }

  if (!chapter) {
    const fallback = pageTexts[Math.max(0, startPage - 1)]?.split('\n').map(cleanLine).find(looksLikeHeading);
    chapter = fallback || 'Materi berikutnya';
    chapterPage = Math.max(1, startPage);
  }

  if (!subchapter) {
    const fallback = pageTexts[Math.max(0, startPage - 1)]?.split('\n').map(cleanLine).find((line) => looksLikeHeading(line) && line !== chapter);
    subchapter = fallback || 'Subbab berikutnya';
    subchapterPage = Math.max(1, startPage);
  }

  return { bab: chapter, subbab: subchapter, chapterPage, subchapterPage };
}

function buildExcerpt(pageTexts, pageStart, pageEnd) {
  return pageTexts
    .slice(Math.max(0, pageStart - 1), Math.min(pageTexts.length, pageEnd))
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 3000);
}

async function loadPrivatePdf(book) {
  const pathname = book.blob_path;
  const url = book.blob_url;
  const storeId = process.env.BLOB_STORE_ID;
  const oidcToken = process.env.VERCEL_OIDC_TOKEN;

  const attempts = [];
  if (url) attempts.push({ label: 'blob_url', target: url });
  if (pathname) attempts.push({ label: 'blob_path', target: pathname });

  let lastError = null;

  for (const attempt of attempts) {
    try {
      const options = {
        access: 'private',
        useCache: false,
        ...(storeId ? { storeId } : {}),
        ...(oidcToken ? { oidcToken } : {}),
      };

      const result = await get(attempt.target, options);

      if (!result) {
        lastError = new Error(`${attempt.label}: blob tidak ditemukan`);
        continue;
      }

      if (result.statusCode && result.statusCode !== 200) {
        lastError = new Error(`${attempt.label}: Blob HTTP ${result.statusCode}`);
        continue;
      }

      if (!result.stream) {
        lastError = new Error(`${attempt.label}: response tidak memiliki stream`);
        continue;
      }

      return { result, source: attempt.label };
    } catch (error) {
      lastError = error;
    }
  }

  const detail = lastError instanceof Error ? lastError.message : 'unknown fetch error';
  throw new Error(`PDF tidak dapat diambil dari Private Blob (${detail}).`);
}

async function readTask(sql, task) {
  if (!task.requires_book) {
    return { task_id: task.task_id, status: 'not_required', reason: 'Task ini tidak membutuhkan buku pegangan.' };
  }

  const klasse = task.jenis_kegiatan === 'Ekstrakurikuler' ? '-' : task.kelas;
  const books = await sql`
    SELECT * FROM books
    WHERE aktif = TRUE AND mapel = ${task.mapel} AND kelas = ${klasse}
    ORDER BY created_at DESC
    LIMIT 1
  `;

  if (!books.length) {
    await sql`
      UPDATE tasks SET status = 'book_missing', book_path = '', error_message = ${`Buku ${task.mapel} kelas ${klasse} belum tersedia.`}, updated_at = NOW()
      WHERE task_id = ${task.task_id}
    `;
    return { task_id: task.task_id, status: 'book_missing', mapel: task.mapel, kelas: klasse, reason: `Tidak ada buku untuk ${task.mapel} ${klasse}.` };
  }

  const book = books[0];
  const previous = await sql`
    SELECT * FROM progress
    WHERE sekolah = ${task.sekolah} AND mapel = ${task.mapel} AND kelas = ${klasse}
    LIMIT 1
  `;
  const progress = previous[0] || null;
  const previousEndPage = Number(progress?.halaman_akhir || 0);
  const startPage = previousEndPage > 0 ? previousEndPage + 1 : 1;

  const { result, source } = await loadPrivatePdf(book);
  const arrayBuffer = await new Response(result.stream).arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (buffer.length < 5) throw new Error(`PDF kosong: ${book.file_name}`);
  if (buffer.subarray(0, 5).toString() !== '%PDF-') throw new Error(`Objek Blob bukan PDF valid: ${book.file_name}`);

  const parsed = await pdfParse(buffer);
  const text = String(parsed.text || '').trim();
  if (!text) throw new Error(`PDF berhasil diambil tetapi tidak memiliki text layer: ${book.file_name}. Kemungkinan PDF hasil scan.`);

  const pageTexts = text.split('\f').map((page) => page.trim());
  const totalPages = pageTexts.length || parsed.numpages || 0;
  if (!totalPages) throw new Error(`Jumlah halaman PDF tidak terbaca: ${book.file_name}`);

  const boundedStart = Math.min(Math.max(1, startPage), totalPages);
  const boundedEnd = Math.min(totalPages, boundedStart + 3);
  const selection = findChapterAndSubchapter(pageTexts, boundedStart);
  const excerpt = buildExcerpt(pageTexts, boundedStart, boundedEnd);

  await sql`
    UPDATE tasks
    SET status = 'book_ready', book_path = ${book.blob_path}, updated_at = NOW(), error_message = ''
    WHERE task_id = ${task.task_id}
  `;

  return {
    task_id: task.task_id,
    status: 'success',
    source,
    sekolah: task.sekolah,
    mapel: task.mapel,
    kelas: klasse,
    pertemuan: task.pertemuan_berikutnya,
    buku: book.nama_buku,
    file_name: book.file_name,
    total_halaman: totalPages,
    halaman_awal: boundedStart,
    halaman_akhir: boundedEnd,
    bab: selection.bab,
    subbab: selection.subbab,
    halaman_bab: selection.chapterPage,
    halaman_subbab: selection.subchapterPage,
    materi_excerpt: excerpt,
    previous_progress: {
      bab_terakhir: progress?.bab_terakhir || '',
      subbab_terakhir: progress?.subbab_terakhir || '',
      halaman_akhir: previousEndPage,
      materi_terakhir: progress?.materi_terakhir || '',
    },
  };
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const sql = getSql();
    const taskId = body.task_id ? String(body.task_id) : null;
    const tanggal = body.tanggal ? String(body.tanggal) : null;

    if (!taskId && !tanggal) {
      return Response.json({ agent: 'book_reader', status: 'error', reason: 'Kirim task_id atau tanggal.' }, { status: 400 });
    }

    const tasks = taskId
      ? await sql`SELECT * FROM tasks WHERE task_id = ${taskId} LIMIT 1`
      : await sql`
          SELECT * FROM tasks
          WHERE tanggal = ${tanggal}
            AND status IN ('progress_ready', 'book_ready', 'book_error')
          ORDER BY jam_mulai NULLS LAST, task_id
        `;

    if (!tasks.length) return Response.json({ agent: 'book_reader', status: 'no_tasks', tanggal, tasks: [] });

    const results = [];
    for (const task of tasks) {
      try {
        results.push(await readTask(sql, task));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Book Reader gagal membaca PDF.';
        await sql`
          UPDATE tasks SET status = 'book_error', error_message = ${message}, updated_at = NOW()
          WHERE task_id = ${task.task_id}
        `;
        results.push({ task_id: task.task_id, status: 'error', error: message });
      }
    }

    return Response.json({ agent: 'book_reader', status: 'success', tanggal: tanggal || tasks[0]?.tanggal, tasks: results });
  } catch (error) {
    console.error('Book Reader error:', error);
    return Response.json({ agent: 'book_reader', status: 'error', reason: error instanceof Error ? error.message : 'Book Reader gagal dijalankan.' }, { status: 500 });
  }
}
