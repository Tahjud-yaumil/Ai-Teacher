import { neon } from '@neondatabase/serverless';
import { issueSignedToken, list, presignUrl } from '@vercel/blob';
import pdfParse from 'pdf-parse';

export const runtime = 'nodejs';
export const maxDuration = 300;

function getSql() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL belum tersedia.');
  return neon(process.env.DATABASE_URL);
}

const clean = (v) => String(v || '').replace(/\s+/g, ' ').trim();

function isFrontMatter(text) {
  const t = String(text || '').toLowerCase();
  return [
    'kata pengantar', 'daftar isi', 'daftar gambar', 'daftar tabel',
    'petunjuk penggunaan', 'glosarium', 'indeks', 'biodata penulis',
    'profil penulis', 'hak cipta', 'isbn', 'dilindungi undang-undang',
    'kementerian pendidikan', 'kementerian agama', 'diterbitkan oleh'
  ].some((x) => t.includes(x));
}

function chapterHeading(line) {
  const v = clean(line);
  if (v.length < 5 || v.length > 140) return false;
  if ((v.match(/\.{3,}/g) || []).length) return false;
  return /^BAB\s+(?:[IVXLC]+|\d+)\b/i.test(v) || /^BAB\s+\S+/i.test(v);
}

function subchapterHeading(line) {
  const v = clean(line);
  if (v.length < 5 || v.length > 140) return false;
  if (/^BAB\s+/i.test(v)) return false;
  if (/^(KEMENTERIAN|ISBN|HAK CIPTA|KATA PENGANTAR|DAFTAR ISI|DAFTAR GAMBAR|DAFTAR TABEL)$/i.test(v)) return false;
  if ((v.match(/\.{3,}/g) || []).length) return false;
  return /^\d+(?:\.\d+)+\s+\S+/.test(v) || /^[A-Z]\s*\.\s+\S+/.test(v) || /^[A-Z][A-Z0-9 &,:()'-]{8,}$/.test(v);
}

function findFirstRealChapter(pages) {
  const candidates = [];
  for (let i = 4; i < Math.min(pages.length, 120); i++) {
    const text = String(pages[i] || '').trim();
    if (!text || isFrontMatter(text)) continue;
    if (text.toLowerCase().includes('daftar isi')) continue;
    const lines = text.split('\n').map(clean).filter(Boolean);
    const chapter = lines.find(chapterHeading);
    if (!chapter) continue;
    const next = pages.slice(i + 1, i + 3).map((p) => String(p || '').trim());
    const nextSubstantive = next.some((p) => p.length >= 600 && !isFrontMatter(p));
    const learning = /tujuan pembelajaran|kata kunci|pertanyaan pemantik|aktivitas pembelajaran|kegiatan pembelajaran/i.test(text);
    let score = 20 + (i >= 8 ? 5 : 0) + (text.length >= 700 ? 4 : 0) + (nextSubstantive ? 8 : 0) + (learning ? 3 : 0);
    candidates.push({ page: i + 1, chapter, score, hasLearningSignals: learning, nextSubstantive });
  }
  return candidates.sort((a, b) => a.page - b.page || b.score - a.score)[0] || { page: 1, chapter: '', score: 0, hasLearningSignals: false, nextSubstantive: false };
}

function findChapterAndSubchapter(pages, startPage) {
  let chapter = '';
  let subchapter = '';
  let chapterPage = startPage;
  let subchapterPage = startPage;
  for (let i = Math.max(0, startPage - 1); i < pages.length; i++) {
    const lines = pages[i].split('\n').map(clean).filter(Boolean);
    const c = lines.find(chapterHeading);
    if (c) { chapter = c; chapterPage = i + 1; break; }
  }
  const begin = Math.max(0, chapterPage - 1);
  for (let i = begin; i < Math.min(pages.length, begin + 20); i++) {
    const s = pages[i].split('\n').map(clean).find(subchapterHeading);
    if (s) { subchapter = s; subchapterPage = i + 1; break; }
  }
  return { bab: chapter || 'Materi berikutnya', subbab: subchapter || 'Subbab berikutnya', chapterPage, subchapterPage };
}

function baseFileName(name) {
  return String(name || '').split(/[\\/]/).pop().replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function filenameMatches(pathname, originalName) {
  const a = baseFileName(pathname);
  const b = baseFileName(originalName);
  return Boolean(a && b && a.includes(b));
}

async function resolveBlob(sql, book, mapel, kelas) {
  const prefix = `books/${mapel}/${kelas}/`;
  if (book.blob_path) {
    try {
      const d = await issueSignedToken({ pathname: book.blob_path, operations: ['get'], validUntil: Date.now() + 300000, storeId: process.env.BLOB_STORE_ID });
      const s = await presignUrl(d, { operation: 'get', pathname: book.blob_path, access: 'private', validUntil: Date.now() + 120000, useCache: false });
      const probe = await fetch(s.presignedUrl, { method: 'HEAD', cache: 'no-store' });
      if (probe.ok) return { pathname: book.blob_path, source: 'database' };
    } catch {}
  }
  const inv = await list({ prefix, limit: 1000 });
  const matches = inv.blobs.filter((b) => filenameMatches(b.pathname, book.file_name)).sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
  if (!matches.length) throw new Error(`Blob tidak ditemukan di folder ${prefix} dengan nama yang cocok dengan ${book.file_name}.`);
  const actual = matches[0];
  await sql`UPDATE books SET blob_path=${actual.pathname}, blob_url=${actual.url || ''}, file_size=${Number(actual.size) || 0}, updated_at=NOW() WHERE id=${book.id}`;
  return { pathname: actual.pathname, source: 'blob_inventory' };
}

async function loadPdf(pathname) {
  const storeId = process.env.BLOB_STORE_ID;
  const oidcToken = process.env.VERCEL_OIDC_TOKEN;
  if (!storeId) throw new Error('BLOB_STORE_ID belum tersedia di environment Vercel.');
  const d = await issueSignedToken({ pathname, operations: ['get'], validUntil: Date.now() + 600000, ...(oidcToken ? { oidcToken } : {}), storeId });
  const s = await presignUrl(d, { operation: 'get', pathname, access: 'private', validUntil: Date.now() + 300000, useCache: false });
  const r = await fetch(s.presignedUrl, { cache: 'no-store' });
  if (!r.ok) throw new Error(`Blob GET HTTP ${r.status} untuk pathname aktual ${pathname}.`);
  return Buffer.from(await r.arrayBuffer());
}

async function extractPages(buffer) {
  const pages = [];
  const pagerender = async (pageData) => {
    const tc = await pageData.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false });
    const lines = [];
    let current = '';
    let lastY = null;
    for (const item of tc.items || []) {
      const str = String(item.str || '');
      if (!str) continue;
      const y = item.transform?.[5];
      if (current && lastY !== null && typeof y === 'number' && Math.abs(y - lastY) > 4) { lines.push(clean(current)); current = ''; }
      current += `${current ? ' ' : ''}${str}`;
      lastY = typeof y === 'number' ? y : lastY;
      if (item.hasEOL) { lines.push(clean(current)); current = ''; }
    }
    if (current) lines.push(clean(current));
    const text = lines.filter(Boolean).join('\n').trim();
    pages.push(text);
    return text;
  };
  const parsed = await pdfParse(buffer, { pagerender });
  const totalPages = Number(parsed.numpages) || pages.length;
  if (!totalPages) throw new Error('PDF tidak memiliki halaman yang terbaca.');
  return { pages, totalPages, totalTextCharacters: pages.reduce((n, p) => n + p.length, 0) };
}

async function readTask(sql, task) {
  if (!task.requires_book) return { task_id: task.task_id, status: 'not_required', reason: 'Task ini tidak membutuhkan buku pegangan.' };
  const kelas = task.jenis_kegiatan === 'Ekstrakurikuler' ? '-' : task.kelas;
  const books = await sql`SELECT * FROM books WHERE aktif=TRUE AND mapel=${task.mapel} AND kelas=${kelas} ORDER BY created_at DESC LIMIT 1`;
  if (!books.length) return { task_id: task.task_id, status: 'book_missing', reason: `Tidak ada buku untuk ${task.mapel} ${kelas}.` };

  const book = books[0];
  const actual = await resolveBlob(sql, book, task.mapel, kelas);
  const previous = await sql`SELECT * FROM progress WHERE sekolah=${task.sekolah} AND mapel=${task.mapel} AND kelas=${kelas} LIMIT 1`;
  const progress = previous[0] || null;
  const previousEndPage = Number(progress?.halaman_akhir || 0);

  const buffer = await loadPdf(actual.pathname);
  if (buffer.subarray(0, 5).toString() !== '%PDF-') throw new Error(`Objek Blob bukan PDF valid: ${book.file_name}`);
  const { pages, totalPages, totalTextCharacters } = await extractPages(buffer);
  const firstChapter = findFirstRealChapter(pages);
  const startPage = previousEndPage > 0 ? previousEndPage + 1 : firstChapter.page;
  const safeStart = Math.min(Math.max(1, startPage), totalPages);
  const safeEnd = Math.min(totalPages, safeStart + 3);
  const selection = findChapterAndSubchapter(pages, safeStart);
  const excerpt = pages.slice(safeStart - 1, safeEnd).join('\n').replace(/\s+/g, ' ').trim().slice(0, 3000);

  await sql`UPDATE tasks SET status='book_ready', book_path=${actual.pathname}, error_message='', updated_at=NOW() WHERE task_id=${task.task_id}`;
  return {
    task_id: task.task_id, status: 'success', blob_resolution: actual.source, blob_path: actual.pathname,
    sekolah: task.sekolah, mapel: task.mapel, kelas, pertemuan: task.pertemuan_berikutnya,
    buku: book.nama_buku, file_name: book.file_name, extraction_method: 'pdf-parse-pagerender',
    total_halaman: totalPages, total_text_characters: totalTextCharacters,
    halaman_awal: safeStart, halaman_akhir: safeEnd,
    first_content_page: firstChapter.page, front_matter_pages: Math.max(0, firstChapter.page - 1),
    first_content_chapter: firstChapter.chapter || selection.bab,
    content_detection_score: firstChapter.score,
    content_detection_signals: { hasLearningSignals: firstChapter.hasLearningSignals, nextSubstantive: firstChapter.nextSubstantive },
    preview_halaman: pages.slice(firstChapter.page - 1, firstChapter.page + 2).map((text, i) => ({ halaman: firstChapter.page + i, karakter: text.length, cuplikan: text.slice(0, 700) })),
    bab: selection.bab, subbab: selection.subbab, halaman_bab: selection.chapterPage, halaman_subbab: selection.subchapterPage,
    materi_excerpt: excerpt,
    previous_progress: { bab_terakhir: progress?.bab_terakhir || '', subbab_terakhir: progress?.subbab_terakhir || '', halaman_akhir: previousEndPage, materi_terakhir: progress?.materi_terakhir || '' }
  };
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const sql = getSql();
    const taskId = body.task_id ? String(body.task_id) : null;
    const tanggal = body.tanggal ? String(body.tanggal) : null;
    if (!taskId && !tanggal) return Response.json({ agent: 'book_reader', status: 'error', reason: 'Kirim task_id atau tanggal.' }, { status: 400 });
    const tasks = taskId
      ? await sql`SELECT * FROM tasks WHERE task_id=${taskId} LIMIT 1`
      : await sql`SELECT * FROM tasks WHERE tanggal=${tanggal} AND status IN ('progress_ready','book_ready','book_error') ORDER BY jam_mulai NULLS LAST, task_id`;
    if (!tasks.length) return Response.json({ agent: 'book_reader', status: 'no_tasks', tanggal, tasks: [] });
    const results = [];
    for (const task of tasks) {
      try { results.push(await readTask(sql, task)); }
      catch (e) {
        const message = e instanceof Error ? e.message : 'Book Reader gagal membaca PDF.';
        await sql`UPDATE tasks SET status='book_error', error_message=${message}, updated_at=NOW() WHERE task_id=${task.task_id}`;
        results.push({ task_id: task.task_id, status: 'error', error: message });
      }
    }
    return Response.json({ agent: 'book_reader', status: 'success', tanggal: tanggal || tasks[0]?.tanggal, tasks: results });
  } catch (e) {
    return Response.json({ agent: 'book_reader', status: 'error', reason: e instanceof Error ? e.message : 'Book Reader gagal dijalankan.' }, { status: 500 });
  }
}
