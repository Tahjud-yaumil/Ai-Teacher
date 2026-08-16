import { neon } from '@neondatabase/serverless';
import { issueSignedToken, list, presignUrl } from '@vercel/blob';
import pdfParse from 'pdf-parse';

export const runtime = 'nodejs';
export const maxDuration = 300;

const clean = (v) => String(v || '').replace(/\s+/g, ' ').trim();
const norm = (v) => clean(v).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const stop = new Set(['yang','dengan','untuk','dari','pada','dalam','manusia','kelas','dan','atau','bagi','serta','oleh','tentang']);
const tokens = (v) => norm(v).split(' ').filter(x => x.length >= 4 && !stop.has(x));
const sim = (a,b) => { const A = new Set(tokens(a)); const B = tokens(b); if (!A.size || !B.length) return 0; return B.filter(x => A.has(x)).length / B.length; };

function sqlClient() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL belum tersedia.');
  return neon(process.env.DATABASE_URL);
}

function fileBase(v) { return String(v || '').split(/[\\/]/).pop().replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim(); }
function filenameMatches(path, original) { const a=fileBase(path), b=fileBase(original); return Boolean(a && b && a.includes(b)); }

async function resolveBlob(sql, book, mapel, kelas) {
  const prefix = `books/${mapel}/${kelas}/`;
  if (book.blob_path) {
    try {
      const d = await issueSignedToken({ pathname: book.blob_path, operations: ['get'], validUntil: Date.now()+300000, storeId: process.env.BLOB_STORE_ID });
      const s = await presignUrl(d, { operation:'get', pathname:book.blob_path, access:'private', validUntil:Date.now()+120000, useCache:false });
      const probe = await fetch(s.presignedUrl, { method:'HEAD', cache:'no-store' });
      if (probe.ok) return { pathname: book.blob_path, source:'database' };
    } catch {}
  }
  const inv = await list({ prefix, limit:1000 });
  const matches = inv.blobs.filter(b=>filenameMatches(b.pathname, book.file_name)).sort((a,b)=>new Date(b.uploadedAt).getTime()-new Date(a.uploadedAt).getTime());
  if (!matches.length) throw new Error(`Blob tidak ditemukan untuk ${book.file_name}.`);
  const actual = matches[0];
  await sql`UPDATE books SET blob_path=${actual.pathname}, blob_url=${actual.url || ''}, file_size=${Number(actual.size)||0}, updated_at=NOW() WHERE id=${book.id}`;
  return { pathname:actual.pathname, source:'blob_inventory' };
}

async function loadPdf(pathname) {
  const storeId = process.env.BLOB_STORE_ID;
  if (!storeId) throw new Error('BLOB_STORE_ID belum tersedia.');
  const d = await issueSignedToken({ pathname, operations:['get'], validUntil:Date.now()+600000, storeId, ...(process.env.VERCEL_OIDC_TOKEN ? { oidcToken:process.env.VERCEL_OIDC_TOKEN } : {}) });
  const s = await presignUrl(d, { operation:'get', pathname, access:'private', validUntil:Date.now()+300000, useCache:false });
  const r = await fetch(s.presignedUrl, { cache:'no-store' });
  if (!r.ok) throw new Error(`Blob GET HTTP ${r.status}.`);
  return Buffer.from(await r.arrayBuffer());
}

async function extractPages(buffer) {
  const pages=[];
  const pagerender = async (pageData) => {
    const tc = await pageData.getTextContent({ normalizeWhitespace:true, disableCombineTextItems:false });
    const lines=[]; let current=''; let lastY=null;
    for (const item of tc.items || []) {
      const str=String(item.str || ''); if(!str) continue;
      const y=item.transform?.[5];
      if(current && lastY!==null && typeof y==='number' && Math.abs(y-lastY)>4) { lines.push(clean(current)); current=''; }
      current += `${current ? ' ' : ''}${str}`;
      lastY = typeof y==='number' ? y : lastY;
      if(item.hasEOL){ lines.push(clean(current)); current=''; }
    }
    if(current) lines.push(clean(current));
    const text=lines.filter(Boolean).join('\n').trim(); pages.push(text); return text;
  };
  const parsed=await pdfParse(buffer,{pagerender});
  return { pages, totalPages:Number(parsed.numpages)||pages.length, totalTextCharacters:pages.reduce((n,p)=>n+p.length,0) };
}

function isNoiseLine(line) {
  const t=norm(line);
  if(!t) return true;
  if(/^\d{1,4}$/.test(t)) return true;
  if(/^page\s+\d+$/i.test(t)) return true;
  if(/^[ivxlcdm]+$/.test(t)) return true;
  if(t.includes('kementerian pendidikan') || t.includes('kementerian agama')) return true;
  if(t.includes('hak cipta') || t.includes('isbn')) return true;
  if(t.includes('ilmu pengetahuan alam') && t.length < 90) return true;
  if(t.includes('ilmu pengetahuan sosial') && t.length < 90) return true;
  if(t.includes('untuk smp/mts') && t.length < 100) return true;
  return false;
}

function splitLines(text){ return String(text||'').split('\n').map(clean).filter(Boolean); }
function isSubheading(line){ return /^(?:A|B|C|D|E|F|G)(?:\.|\))\s+.{3,180}$/i.test(clean(line)); }
function isChapterHeading(line){ return /^(?:BAB\s+(?:[IVXLC]+|\d+)|Tema\s+[IVXLC]+|Tema\s+\d+)\b/i.test(clean(line)); }

function extractCleanPage(pageText, allowedChapter) {
  const lines=splitLines(pageText);
  const out=[];
  for (const line of lines) {
    if(isNoiseLine(line)) continue;
    if(isChapterHeading(line)) {
      if(!allowedChapter || sim(line,allowedChapter) >= 0.35 || norm(line).includes(norm(allowedChapter))) out.push(line);
      continue;
    }
    out.push(line);
  }
  return out.join(' ');
}

function findSubchapterPage(pages, label, title, startPage) {
  const target=norm(title);
  for(let i=Math.max(0,startPage-1); i<pages.length; i++){
    const lines=splitLines(pages[i]);
    for(const line of lines){
      const m=line.match(new RegExp(`^${label}\\s*[.)]\\s+(.{3,180})$`,'i'));
      if(m && sim(m[1], title) >= 0.45) return i;
    }
  }
  return -1;
}

function findNextSubchapterPage(pages, startPage, currentLabel) {
  const labels='ABCDEFG';
  const idx=labels.indexOf(String(currentLabel||'').toUpperCase());
  const nextLabel=idx>=0 && idx<labels.length-1 ? labels[idx+1] : null;
  if(!nextLabel) return -1;
  for(let i=Math.max(0,startPage); i<pages.length; i++){
    for(const line of splitLines(pages[i])) if(new RegExp(`^${nextLabel}\\s*[.)]\\s+`,'i').test(line)) return i;
  }
  return -1;
}

function chooseContextWindow(pages, chapterPage, subLabel, subTitle, totalPages) {
  let start=findSubchapterPage(pages, subLabel, subTitle, chapterPage+1);
  if(start<0) start=Math.max(0,chapterPage-1);
  let end=findNextSubchapterPage(pages,start+1,subLabel);
  if(end<0) end=Math.min(totalPages,start+8);
  const maxPages=Math.min(end,start+12);
  return { startPage:start+1, endPage:maxPages, pageIndexes:Array.from({length:Math.max(1,maxPages-start)},(_,i)=>start+i) };
}

async function processTask(sql, task) {
  if(!task.requires_book) return { task_id:task.task_id, status:'not_required' };
  const kelas=task.jenis_kegiatan==='Ekstrakurikuler' ? '-' : task.kelas;
  const books=await sql`SELECT * FROM books WHERE aktif=TRUE AND mapel=${task.mapel} AND kelas=${kelas} ORDER BY created_at DESC LIMIT 1`;
  if(!books.length) return { task_id:task.task_id, status:'book_missing', reason:`Tidak ada buku untuk ${task.mapel} ${kelas}.` };
  const book=books[0]; const blob=await resolveBlob(sql,book,task.mapel,kelas); const buffer=await loadPdf(blob.pathname); const {pages,totalPages,totalTextCharacters}=await extractPages(buffer);
  const previousRows=await sql`SELECT * FROM progress WHERE sekolah=${task.sekolah} AND mapel=${task.mapel} AND kelas=${kelas} LIMIT 1`;
  const progress=previousRows[0]||null;
  const anchorPage=Number(progress?.halaman_akhir||0);

  const bookTask=await sql`SELECT * FROM tasks WHERE task_id=${task.task_id} LIMIT 1`;
  const hintedChapter = clean(bookTask[0]?.book_chapter || '');
  const hintedSub = clean(bookTask[0]?.book_subchapter || '');

  let chapter=hintedChapter; let sub=hintedSub;
  const start=Math.max(1,anchorPage+1);
  if(!chapter || !sub){
    const candidates=[];
    for(let i=Math.max(0,start-1);i<Math.min(totalPages,start+24);i++){
      const lines=splitLines(pages[i]);
      for(const line of lines){
        if(isChapterHeading(line)) chapter ||= line;
        const m=line.match(/^([A-G])\s*[.)]\s+(.{4,180})$/);
        if(m && !sub) { sub=`${m[1].toUpperCase()}. ${clean(m[2])}`; break; }
      }
      if(chapter && sub) break;
    }
  }
  if(!chapter) chapter='Materi berikutnya';
  if(!sub) sub='Subbab berikutnya';
  const sm=sub.match(/^([A-G])\.?\s+(.+)$/); const subLabel=sm?.[1]||'A'; const subTitle=sm?.[2]||sub;
  const window=chooseContextWindow(pages,Math.max(1,start),subLabel,subTitle,totalPages);
  const selectedPages=window.pageIndexes.map(i=>({page:i+1,text:extractCleanPage(pages[i],chapter)})).filter(x=>x.text.length>40);
  let context=selectedPages.map(x=>`[Halaman ${x.page}] ${x.text}`).join('\n\n');
  context=context.replace(/\b(?:Bab\s+[IVXLC]+|Bab\s+\d+|Tema\s+[IVXLC]+|Tema\s+\d+)\b[^\n]{0,140}/gi, m=>sim(m,chapter)>=0.3?m:'');
  context=context.slice(0,18000).trim();
  const contamination=selectedPages.filter(x=>{ const t=norm(x.text); return /bab\s+[2-9]|tema\s+[2-9]/i.test(t) && !t.includes(norm(chapter)); }).length;
  return { task_id:task.task_id, status:'success', context_valid:context.length>200 && contamination===0, blob_path:blob.pathname, mapel:task.mapel, kelas, buku:book.nama_buku, bab:chapter, subbab:sub, halaman_awal:window.startPage, halaman_akhir:window.endPage, total_context_characters:context.length, contamination_pages:contamination, pages:selectedPages.map(x=>x.page), context };
}

export async function POST(request){
  try{
    const body=await request.json().catch(()=>({})); const sql=sqlClient();
    const taskId=body.task_id?String(body.task_id):null; const tanggal=body.tanggal?String(body.tanggal):null;
    if(!taskId&&!tanggal) return Response.json({agent:'context_extractor',status:'error',reason:'Kirim task_id atau tanggal.'},{status:400});
    const tasks=taskId ? await sql`SELECT * FROM tasks WHERE task_id=${taskId} LIMIT 1` : await sql`SELECT * FROM tasks WHERE tanggal=${tanggal} AND status IN ('book_ready','progress_ready','book_error') ORDER BY task_id`;
    if(!tasks.length) return Response.json({agent:'context_extractor',status:'no_tasks',tanggal,tasks:[]});
    const results=[]; for(const task of tasks){ try{results.push(await processTask(sql,task));}catch(e){results.push({task_id:task.task_id,status:'error',error:e instanceof Error?e.message:'Context Extractor gagal.'});} }
    return Response.json({agent:'context_extractor',status:'success',tanggal: tanggal||tasks[0]?.tanggal,tasks:results});
  }catch(e){ return Response.json({agent:'context_extractor',status:'error',reason:e instanceof Error?e.message:'Context Extractor gagal.'},{status:500}); }
}
