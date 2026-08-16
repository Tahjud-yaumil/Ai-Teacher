import { neon } from '@neondatabase/serverless';
import { issueSignedToken, list, presignUrl } from '@vercel/blob';
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

function baseFileName(name) {
  return String(name || '')
    .split(/[\\/]/)
    .pop()
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function filenameMatches(pathname, originalName) {
  const pathBase = baseFileName(pathname);
  const originalBase = baseFileName(originalName);
  if (!pathBase || !originalBase) return false;
  return pathBase.includes(originalBase);
}

async function findActualBlob(sql, book, mapel, kelas) {
  const expectedPrefix = `books/${mapel}/${kelas}/`;

  if (book.blob_path) {
    try {
      const delegation = await issueSignedToken({
        pathname: book.blob_path,
        operations: ['get'],
        validUntil: Date.now() + 5 * 60 * 1000,
        storeId: process.env.BLOB_STORE_ID,
      });
      const signed = await presignUrl(delegation, {
        operation: 'get',
        pathname: book.blob_path,
        access: 'private',
        validUntil: Date.now() + 2 * 60 * 1000,
        useCache: false,
      });
      const probe = await fetch(signed.presignedUrl, { method: 'HEAD', cache: 'no-store' });
      if (probe.ok) {
        return { pathname: book.blob_path, url: book.blob_url || '', source: 'database' };
      }
    } catch {
      // Fall through to inventory lookup.
    }
  }

  const inventory = await list({ prefix: expectedPrefix, limit: 1000 });
  const candidates = inventory.blobs
    .filter((blob) => filenameMatches(blob.pathname, book.file_name))
    .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());

  if (!candidates.length) {
    throw new Error(`Blob tidak ditemukan di folder ${expectedPrefix} dengan nama yang cocok dengan ${book.file_name}.`);
  }

  const actual = candidates[0];

  await sql`
    UPDATE books
    SET blob_path = ${actual.pathname},
        blob_url = ${actual.url || ''},
        file_size = ${Number(actual.size) || Number(book.file_size) || 0},
        updated_at = NOW()
    WHERE id = ${book.id}
  `;

  return { pathname: actual.pathname, url: actual.url || '', source: 'blob_inventory' };
}

async function loadPrivatePdf(actualPathname) {
  const storeId = process.env.BLOB_STORE_ID;
  const oidcToken = process.env.VERCEL_OIDC_TOKEN;

  if (!actualPathname) throw new Error('Pathname Blob kosong.');
  if (!storeId) throw new Error('BLOB_STORE_ID belum tersedia di environment Vercel.');

  const delegation = await issueSignedToken({
    pathname: actualPathname,
    operations: ['get'],
    validUntil: Date.now() + 10 * 60 * 1000,
    ...(oidcToken ? { oidcToken } : {}),
    storeId,
  });

  const signed = await presignUrl(delegation, {
    operation: 'get',
    pathname: actualPathname,
    access: 'private',
    validUntil: Date.now() + 5 * 60 * 1000,
    useCache: false,
  });

  const response = await fetch(signed.presignedUrl, { method: 'GET', cache: 'no-store' });
  if (!response.ok) throw new Error(`Blob GET HTTP ${response.status} untuk pathname aktual ${actualPathname}.`);

  return Buffer.from(await response.arrayBuffer());
}

async function extractPdfPages(buffer) {
  const pageTexts = [];

  const pagerender = async (pageData) => {
    const textContent = await pageData.getTextContent({
      normalizeWhitespace: true,
      disableCombineTextItems: false,
    });

    const lines = [];
    let current = '';
    let lastY = null;

    for (const item of textContent.items || []) {
      const str = String(item.str || '');
      if (!str) continue;
      const y = item.transform?.[5];
      const gap = lastY !== null && typeof y === 'number' ? Math.abs(y - lastY) : 0;

      if (current && gap > 4) {
        lines.push(cleanLine(current));
        current = '';
      }

      current += `${current ? ' ' : ''}${str}`;
      lastY = typeof y === 'number' ? y : lastY;

      if (item.hasEOL) {
        lines.push(cleanLine(current));
        current = '';
      }
    }

    if (current) lines.push(cleanLine(current));

    const pageText = lines.filter(Boolean).join('\n').trim();
    pageTexts.push(pageText);
    return pageText;
  };

  const parsed = await pdfParse(buffer, { pagerender });

  // pagerender is called once per page. Sort order is preserved for normal PDF parsing.
  const pages = pageTexts.map((text) => String(text || '').trim());
  const totalPages = Number(parsed.numpages) || pages.length;

  if (!totalPages) {
    throw new Error('PDF tidak memiliki halaman yang terbaca.');
  }

  // 6A diagnostic: do not fake page count from form-feed characters.
  return {
    pages,
    totalPages,
    extractionMethod: 'pdf-parse-pagerender',
    totalTextCharacters: pages.reduce((sum, page) => sum + page.length, 0),
  };
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
      UPDATE tasks
      SET status = 'book_missing', book_path = '',
          error_message = ${`Buku ${task.mapel} kelas ${klasse} belum tersedia.`},
          updated_at = NOW()
      WHERE task_id = ${task.task_id}
    `;
    return { task_id: task.task_id, status: 'book_missing', mapel: task.mapel, kelas: klasse, reason: `Tidak ada buku untuk ${task.mapel} ${klasse}.` };
  }

  const book = books[0];
  const actual = await findActualBlob(sql, book, task.mapel, klasse);
  const previous = await sql`
    SELECT * FROM progress
    WHERE sekolah = ${task.sekolah} AND mapel = ${task.mapel} AND kelas = ${klasse}
    LIMIT 1
  `;
  const progress = previous[0] || null;
  const previousEndPage = Number(progress?.halaman_akhir || 0);
  const startPage = previousEndPage > 0 ? previousEndPage + 1 : 1;

  const buffer = await loadPrivatePdf(actual.pathname);
  if (buffer.length < 5) throw new Error(`PDF kosong: ${book.file_name}`);
  if (buffer.subarray(0, 5).toString() !== '%PDF-') throw new Error(`Objek Blob bukan PDF valid: ${book.file_name}`);

  const extracted = await extractPdfPages(buffer);
  const { pages: pageTexts, totalPages, extractionMethod, totalTextCharacters } = extracted;

  const safeStart = Math.min(Math.max(1, startPage), totalPages);
  const safeEnd = Math.min(totalPages, safeStart + 3);
  const selection = findChapterAndSubchapter(pageTexts, safeStart);
  const excerpt = buildExcerpt(pageTexts, safeStart, safeEnd);

  await sql`
    UPDATE tasks
    SET status = 'book_ready',
        book_path = ${actual.pathname},
        error_message = '',
        updated_at = NOW()
    WHERE task_id = ${task.task_id}
  `;

  return {
    task_id: task.task_id,
    status: 'success',
    blob_resolution: actual.source,
    blob_path: actual.pathname,
    sekolah: task.sekolah,
    mapel: task.mapel,
    kelas: klasse,
    pertemuan: task.pertemuan_berikutnya,
    buku: book.nama_buku,
    file_name: book.file_name,
    extraction_method: extractionMethod,
    total_halaman: totalPages,
    total_text_characters: totalTextCharacters,
    halaman_awal: safeStart,
    halaman_akhir: safeEnd,
    preview_halaman: pageTexts.slice(0, 3).map((text, index) => ({
      halaman: index + 1,
      karakter: text.length,
      cuplikan: text.slice(0, 500),
    })),
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
