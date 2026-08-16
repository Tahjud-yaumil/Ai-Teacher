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

const STOP = new Set(['yang','dengan','untuk','dari','pada','dalam','manusia','kelas','dan','atau','bagi','serta','oleh','tentang']);

function normalize(v) {
  return clean(v).toLowerCase()
    .replace(/k\s+oordinasi/g, 'koordinasi')
    .replace(/s\s+istem/g, 'sistem')
    .replace(/z\s+at/g, 'zat')
    .replace(/p\s+ewarisan/g, 'pewarisan')
    .replace(/listrik\s+,/g, 'listrik,')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function tokens(text) {
  return normalize(text).split(' ').filter((x) => x.length >= 4 && !STOP.has(x));
}

function similarity(a, b) {
  const A = new Set(tokens(a));
  const B = tokens(b);
  if (!A.size || !B.length) return 0;
  return B.filter((x) => A.has(x)).length / B.length;
}

function isFrontMatter(text) {
  const t = normalize(text);
  return [
    'kata pengantar','daftar isi','daftar gambar','daftar tabel','petunjuk penggunaan',
    'glosarium','indeks','biodata penulis','profil penulis','hak cipta','isbn',
    'dilindungi undang undang','kementerian pendidikan','kementerian agama',
    'diterbitkan oleh','prakata','penjelasan fitur buku','penerbit','penulis'
  ].some((x) => t.includes(x));
}

function chapterNumber(value) {
  const s = String(value || '').toUpperCase();
  if (/^\d+$/.test(s)) return Number(s);
  const map = { I:1, II:2, III:3, IV:4, V:5, VI:6, VII:7, VIII:8, IX:9, X:10, XI:11, XII:12 };
  return map[s] || null;
}

function chapterHeading(line) {
  return /^BAB\s+(?:[IVXLC]+|\d+)\b/i.test(clean(line));
}

function stripChapterLabel(line) {
  return clean(String(line || '').replace(/^BAB\s+(?:[IVXLC]+|\d+)\b/i, '').replace(/\.{2,}/g, ' '));
}

function findTocPage(pages) {
  for (let i = 0; i < Math.min(pages.length, 80); i++) {
    if (/daftar\s+isi/i.test(String(pages[i] || ''))) return i;
  }
  return -1;
}

function parseChapterEntry(line) {
  const v = clean(line);
  const m = v.match(/^Bab\s+([IVXLC]+|\d+)\s+(.+?)(?:\s+\.{2,}\s*|\s+…+\s*|\s{3,}|\s+)(\d{1,3})\s*$/i);
  if (!m) return null;
  const number = chapterNumber(m[1]);
  const printedPage = Number(m[3]);
  if (!number || !printedPage) return null;
  const title = clean(m[2].replace(/\.{2,}|…+/g, ' '));
  if (!title || title.length < 3) return null;
  return { number, roman: m[1].toUpperCase(), title, printedPage };
}

function parseTocChapters(pages) {
  const tocIndex = findTocPage(pages);
  if (tocIndex < 0) return { tocIndex: -1, chapters: [], tocText: '' };

  const tocPages = [];
  for (let i = tocIndex; i < Math.min(pages.length, tocIndex + 16); i++) {
    tocPages.push(String(pages[i] || '').replace(/\u0000/g, ' '));
  }
  const raw = tocPages.join('\n');
  const lines = raw.split('\n').map(clean).filter(Boolean);
  const chapters = [];

  for (const line of lines) {
    const entry = parseChapterEntry(line);
    if (entry && !chapters.some((c) => c.number === entry.number)) chapters.push(entry);
  }

  // OCR/layout fallback: chapter title and page may be split over several tokens/lines.
  if (!chapters.length) {
    const compact = raw.replace(/\s+/g, ' ');
    const matches = [...compact.matchAll(/\bBab\s+([IVXLC]+|\d+)\b/gi)];
    for (let i = 0; i < matches.length; i++) {
      const number = chapterNumber(matches[i][1]);
      if (!number || chapters.some((c) => c.number === number)) continue;
      const start = matches[i].index + matches[i][0].length;
      const end = matches[i + 1]?.index ?? Math.min(compact.length, start + 320);
      const chunk = clean(compact.slice(start, end));
      const nums = [...chunk.matchAll(/\b(\d{1,3})\b/g)];
      const last = nums.at(-1);
      const printedPage = last ? Number(last[1]) : null;
      let title = last ? clean(chunk.slice(0, last.index)) : chunk;
      title = title.replace(/\.{2,}|…+/g, ' ').trim();
      if (printedPage && printedPage > 0 && title.length >= 3) {
        chapters.push({ number, roman: matches[i][1].toUpperCase(), title, printedPage });
      }
    }
  }

  // Secondary fallback: find the first A-subchapter in TOC and attach the nearest preceding Bab 1 text.
  if (!chapters.length) {
    const firstSub = compactFirstSubchapter(raw);
    if (firstSub) {
      const before = clean(raw.slice(0, firstSub.index));
      const babMatches = [...before.matchAll(/\bBab\s+([IVXLC]+|\d+)\s+(.{3,260}?)(?:\.{2,}|…+|\s{3,})(\d{1,3})/gi)];
      const nearest = babMatches.at(-1);
      if (nearest) {
        const number = chapterNumber(nearest[1]);
        if (number) chapters.push({ number, roman: nearest[1].toUpperCase(), title: clean(nearest[2]), printedPage: Number(nearest[3]) });
      }
    }
  }

  return { tocIndex, chapters: chapters.sort((a, b) => a.number - b.number), tocText: raw };
}

function compactFirstSubchapter(raw) {
  const re = /(^|\n)\s*A(?:\.|\))\s+(.{3,180}?)(?:\.{2,}|…+|\s{3,})(\d{1,3})\s*(?=\n|$)/im;
  const m = raw.match(re);
  if (!m || m.index == null) return null;
  return { index: m.index, title: clean(m[2]), printedPage: Number(m[3]) };
}

function findActualChapterPage(pages, tocIndex, tocChapter) {
  const candidates = [];
  for (let i = Math.max(0, tocIndex + 1); i < pages.length; i++) {
    const text = String(pages[i] || '').trim();
    if (!text || text.length < 120) continue;
    const normalized = normalize(text);
    const lines = text.split('\n').map(clean).filter(Boolean);

    for (const line of lines.slice(0, 40)) {
      if (!chapterHeading(line)) continue;
      const m = line.match(/^BAB\s+([IVXLC]+|\d+)/i);
      if (chapterNumber(m?.[1]) !== tocChapter.number) continue;
      const title = stripChapterLabel(line);
      const sim = similarity(title, tocChapter.title);
      const learning = /tujuan pembelajaran|kata kunci|pertanyaan pemantik|aktivitas pembelajaran|kegiatan pembelajaran/.test(normalized);
      if (sim >= 0.2 || learning) candidates.push({ page: i + 1, title, similarity: sim, score: sim * 100 + (learning ? 12 : 0) });
    }

    const bodySim = similarity(normalized.slice(0, 2200), tocChapter.title);
    const explicit = new RegExp(`\\bbab\\s+${tocChapter.number}\\b`).test(normalized);
    if (explicit && bodySim >= 0.45) {
      const learning = /tujuan pembelajaran|kata kunci|pertanyaan pemantik|aktivitas pembelajaran|kegiatan pembelajaran/.test(normalized);
      candidates.push({ page: i + 1, title: tocChapter.title, similarity: bodySim, score: 45 + bodySim * 40 + (learning ? 10 : 0) });
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.page - b.page);
  return candidates[0] || null;
}

function findActualSubchapterPage(pages, tocIndex, sub) {
  if (!sub?.title) return null;
  const target = normalize(sub.title);
  const candidates = [];
  for (let i = Math.max(0, tocIndex + 1); i < pages.length; i++) {
    const text = String(pages[i] || '').trim();
    if (!text || text.length < 100) continue;
    const lines = text.split('\n').map(clean).filter(Boolean);
    for (const line of lines.slice(0, 40)) {
      const m = line.match(/^A(?:\.|\))\s+(.{3,180})$/i);
      if (!m) continue;
      const sim = similarity(m[1], target);
      if (sim >= 0.55) candidates.push({ page: i + 1, title: clean(m[1]), score: sim * 100 });
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.page - b.page);
  return candidates[0] || null;
}

function findFirstSubchapter(pages, chapterPage) {
  const start = Math.max(0, chapterPage - 1);
  const end = Math.min(pages.length, start + 30);
  const excluded = /^(ayo\s+uji|aktivitas|projek|proyek|pengayaan|remedial|refleksi|rangkuman|evaluasi|asesmen|glosarium|kata kunci|tujuan pembelajaran)/i;
  for (let i = start; i < end; i++) {
    const lines = pages[i].split('\n').map(clean).filter(Boolean);
    for (const line of lines) {
      if (!line || excluded.test(line) || isFrontMatter(line)) continue;
      const m = line.match(/^([A-Z])(?:\.|\))\s+(.{4,180})$/);
      if (!m || /^\d/.test(m[2])) continue;
      return { label: m[1].toUpperCase(), title: clean(m[2]), page: i + 1 };
    }
  }
  return null;
}

function findFirstRealChapter(pages) {
  const toc = parseTocChapters(pages);
  if (toc.chapters.length) {
    const first = toc.chapters[0];
    const actual = findActualChapterPage(pages, toc.tocIndex, first);
    const tocSub = compactFirstSubchapter(toc.tocText);
    const actualSub = tocSub ? findActualSubchapterPage(pages, toc.tocIndex, tocSub) : null;

    if (actual || actualSub) {
      const page = actual?.page || actualSub?.page || 1;
      const sub = actualSub ? { label: 'A', title: actualSub.title, page: actualSub.page } : findFirstSubchapter(pages, page);
      return {
        page,
        chapter: `Bab ${first.roman} ${first.title}`,
        score: actual?.score || 55,
        hasLearningSignals: /tujuan pembelajaran|kata kunci|pertanyaan pemantik|aktivitas pembelajaran|kegiatan pembelajaran/.test(String(pages[page - 1] || '').toLowerCase()),
        nextSubstantive: String(pages[page] || '').length >= 600,
        source: 'table_of_contents',
        tocIndex: toc.tocIndex + 1,
        tocPrintedPage: first.printedPage,
        subchapter: sub,
      };
    }
  }

  // Last-resort: use the first real A-subchapter found after front matter, and infer its nearest chapter heading.
  const tocIndex = findTocPage(pages);
  const subCandidates = [];
  for (let i = Math.max(4, tocIndex + 1); i < Math.min(pages.length, 120); i++) {
    const lines = String(pages[i] || '').split('\n').map(clean).filter(Boolean);
    for (const line of lines) {
      const m = line.match(/^A(?:\.|\))\s+(.{4,180})$/i);
      if (!m || isFrontMatter(line)) continue;
      const sim = similarity(m[1], '');
      subCandidates.push({ page: i + 1, title: clean(m[1]), score: sim });
      break;
    }
  }
  if (subCandidates.length) {
    const chosen = subCandidates[0];
    for (let i = chosen.page - 1; i >= Math.max(1, chosen.page - 8); i--) {
      const line = String(pages[i - 1] || '').split('\n').map(clean).find(chapterHeading);
      if (line) {
        return { page: i, chapter: line, score: 30, hasLearningSignals: false, nextSubstantive: String(pages[i] || '').length >= 600, source: 'chapter_backtracking_fallback', tocIndex: tocIndex >= 0 ? tocIndex + 1 : null, tocPrintedPage: null, subchapter: { label: 'A', title: chosen.title, page: chosen.page } };
      }
    }
  }

  return { page: 1, chapter: 'Materi berikutnya', score: 0, hasLearningSignals: false, nextSubstantive: false, source: 'fallback' };
}

function findChapterAndSubchapter(pages, startPage) {
  const first = findFirstRealChapter(pages);
  const detected = first.subchapter || findFirstSubchapter(pages, first.page);
  return { bab: first.chapter, subbab: detected ? `${detected.label}. ${detected.title}` : 'Subbab berikutnya', chapterPage: first.page, subchapterPage: detected?.page || first.page };
}

function baseFileName(name) { return String(name || '').split(/[\\/]/).pop().replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function filenameMatches(pathname, originalName) { const a = baseFileName(pathname); const b = baseFileName(originalName); return Boolean(a && b && a.includes(b)); }

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
  return { pages, totalPages, totalTextCharacters: pages.reduce((n,p)=>n+p.length,0) };
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
  if (buffer.subarray(0,5).toString() !== '%PDF-') throw new Error(`Objek Blob bukan PDF valid: ${book.file_name}`);
  const { pages, totalPages, totalTextCharacters } = await extractPages(buffer);
  const firstChapter = findFirstRealChapter(pages);
  const safeStart = Math.min(Math.max(1, previousEndPage > 0 ? previousEndPage + 1 : firstChapter.page), totalPages);
  const safeEnd = Math.min(totalPages, safeStart + 3);
  const selection = findChapterAndSubchapter(pages, safeStart);
  const excerpt = pages.slice(safeStart - 1, safeEnd).join('\n').replace(/\s+/g,' ').trim().slice(0,3000);
  await sql`UPDATE tasks SET status='book_ready', book_path=${actual.pathname}, error_message='', updated_at=NOW() WHERE task_id=${task.task_id}`;
  return { task_id: task.task_id,status:'success',blob_resolution:actual.source,blob_path:actual.pathname,sekolah:task.sekolah,mapel:task.mapel,kelas,pertemuan:task.pertemuan_berikutnya,buku:book.nama_buku,file_name:book.file_name,extraction_method:'pdf-parse-pagerender',total_halaman:totalPages,total_text_characters:totalTextCharacters,halaman_awal:safeStart,halaman_akhir:safeEnd,first_content_page:firstChapter.page,front_matter_pages:Math.max(0,firstChapter.page-1),first_content_chapter:firstChapter.chapter,content_detection_score:firstChapter.score,content_detection_signals:{hasLearningSignals:firstChapter.hasLearningSignals,nextSubstantive:firstChapter.nextSubstantive},content_locator_source:firstChapter.source,toc_index_page:firstChapter.tocIndex||null,toc_printed_page:firstChapter.tocPrintedPage||null,preview_halaman:pages.slice(firstChapter.page-1,firstChapter.page+2).map((text,i)=>({halaman:firstChapter.page+i,karakter:text.length,cuplikan:text.slice(0,700)})),bab:selection.bab,subbab:selection.subbab,halaman_bab:selection.chapterPage,halaman_subbab:selection.subchapterPage,materi_excerpt:excerpt,previous_progress:{bab_terakhir:progress?.bab_terakhir||'',subbab_terakhir:progress?.subbab_terakhir||'',halaman_akhir:previousEndPage,materi_terakhir:progress?.materi_terakhir||''}};
}

export async function POST(request) {
  try {
    const body = await request.json().catch(()=>({}));
    const sql = getSql();
    const taskId = body.task_id ? String(body.task_id) : null;
    const tanggal = body.tanggal ? String(body.tanggal) : null;
    if (!taskId && !tanggal) return Response.json({agent:'book_reader',status:'error',reason:'Kirim task_id atau tanggal.'},{status:400});
    const tasks = taskId ? await sql`SELECT * FROM tasks WHERE task_id=${taskId} LIMIT 1` : await sql`SELECT * FROM tasks WHERE tanggal=${tanggal} AND status IN ('progress_ready','book_ready','book_error') ORDER BY jam_mulai NULLS LAST, task_id`;
    if (!tasks.length) return Response.json({agent:'book_reader',status:'no_tasks',tanggal,tasks:[]});
    const results=[];
    for (const task of tasks) { try { results.push(await readTask(sql,task)); } catch(e) { const message=e instanceof Error?e.message:'Book Reader gagal membaca PDF.'; await sql`UPDATE tasks SET status='book_error', error_message=${message}, updated_at=NOW() WHERE task_id=${task.task_id}`; results.push({task_id:task.task_id,status:'error',error:message}); } }
    return Response.json({agent:'book_reader',status:'success',tanggal:tanggal||tasks[0]?.tanggal,tasks:results});
  } catch(e) { return Response.json({agent:'book_reader',status:'error',reason:e instanceof Error?e.message:'Book Reader gagal dijalankan.'},{status:500}); }
}
