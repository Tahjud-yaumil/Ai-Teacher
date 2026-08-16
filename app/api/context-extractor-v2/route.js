import { neon } from '@neondatabase/serverless';
import { issueSignedToken, list, presignUrl } from '@vercel/blob';
import pdfParse from 'pdf-parse';

export const runtime = 'nodejs';
export const maxDuration = 300;

const clean = (v) => String(v || '').replace(/\s+/g, ' ').trim();
const norm = (v) => clean(v).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const tokens = (v) => norm(v).split(' ').filter(x => x.length >= 4);
const sim = (a,b) => { const A=new Set(tokens(a)); const B=tokens(b); if(!A.size||!B.length)return 0; return B.filter(x=>A.has(x)).length/B.length; };

const UNIT_RE = /^(?:BAB|B\s*A\s*B|TEMA)\s+([IVXLC]+|\d+)\b\s*(.*)$/i;
function unitNum(v){const s=String(v||'').toUpperCase();if(/^\d+$/.test(s))return Number(s);return ({I:1,II:2,III:3,IV:4,V:5,VI:6,VII:7,VIII:8,IX:9,X:10})[s]||null;}
function parseUnit(line){const m=clean(line).match(UNIT_RE);if(!m)return null;return{type:/^TEMA/i.test(line)?'tema':'bab',number:unitNum(m[1]),roman:m[1].toUpperCase(),title:clean(m[2].replace(/\.{2,}/g,' '))};}
function lines(text){return String(text||'').split('\n').map(clean).filter(Boolean);}
function isNoise(line){const t=norm(line);return !t||/^\d{1,4}$/.test(t)||/^(kata pengantar|daftar isi|daftar gambar|daftar tabel|prakata|isbn|hak cipta|kementerian pendidikan|kementerian agama)/.test(t);}

async function sqlClient(){if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL belum tersedia.');return neon(process.env.DATABASE_URL);}
async function resolveBlob(sql,book,mapel,kelas){
  const prefix=`books/${mapel}/${kelas}/`;
  if(book.blob_path){try{const d=await issueSignedToken({pathname:book.blob_path,operations:['get'],validUntil:Date.now()+300000,storeId:process.env.BLOB_STORE_ID});const s=await presignUrl(d,{operation:'get',pathname:book.blob_path,access:'private',validUntil:Date.now()+120000,useCache:false});if((await fetch(s.presignedUrl,{method:'HEAD',cache:'no-store'})).ok)return book.blob_path;}catch{}}
  const inv=await list({prefix,limit:1000});const base=String(book.file_name||'').replace(/\.[^.]+$/,'').toLowerCase();const m=inv.blobs.filter(b=>String(b.pathname).toLowerCase().includes(base)).sort((a,b)=>new Date(b.uploadedAt)-new Date(a.uploadedAt))[0];if(!m)throw new Error(`Blob tidak ditemukan untuk ${book.file_name}.`);return m.pathname;
}
async function loadPages(pathname){const d=await issueSignedToken({pathname,operations:['get'],validUntil:Date.now()+600000,storeId:process.env.BLOB_STORE_ID,...(process.env.VERCEL_OIDC_TOKEN?{oidcToken:process.env.VERCEL_OIDC_TOKEN}: {})});const s=await presignUrl(d,{operation:'get',pathname,access:'private',validUntil:Date.now()+300000,useCache:false});const r=await fetch(s.presignedUrl,{cache:'no-store'});if(!r.ok)throw new Error(`Blob GET HTTP ${r.status}.`);const buf=Buffer.from(await r.arrayBuffer());const pages=[];const parsed=await pdfParse(buf,{pagerender:async p=>{const tc=await p.getTextContent({normalizeWhitespace:true,disableCombineTextItems:false});const out=[];let cur='';let y0=null;for(const it of tc.items||[]){const str=String(it.str||'');if(!str)continue;const y=it.transform?.[5];if(cur&&y0!==null&&typeof y==='number'&&Math.abs(y-y0)>4){out.push(clean(cur));cur='';}cur+=`${cur?' ':''}${str}`;y0=typeof y==='number'?y:y0;if(it.hasEOL){out.push(clean(cur));cur='';}}if(cur)out.push(clean(cur));const t=out.filter(Boolean).join('\n').trim();pages.push(t);return t;}});return{pages,totalPages:Number(parsed.numpages)||pages.length};}

function findToc(pages){for(let i=0;i<Math.min(pages.length,80);i++)if(/daftar\s+isi/i.test(pages[i])||norm(pages[i]).replace(/\s+/g,'').includes('daftarisi'))return i;return -1;}
function tocUnits(pages,toc){if(toc<0)return[];const raw=pages.slice(toc,Math.min(pages.length,toc+16)).join('\n');const out=[];for(const l of lines(raw)){const u=parseUnit(l);if(u&&u.number===1&&!out.length)out.push(u);}if(out.length)return out;const flat=raw.replace(/\s+/g,' ');const m=flat.match(/(?:BAB|B\s*A\s*B|TEMA)\s+([IVXLC]+|\d+)\s+(.{3,260}?)(?:\.{2,}|…+|\s+—\s*|\s{3,})(\d{1,3})/i);if(m){const u={type:/^TEMA/i.test(m[0])?'tema':'bab',number:unitNum(m[1]),roman:m[1].toUpperCase(),title:clean(m[2]),printedPage:Number(m[3])};if(u.number===1)return[u];}return[];}
function findUnitPage(pages,toc,u){const cand=[];for(let i=Math.max(0,toc+1);i<pages.length;i++){const text=pages[i];if(!text||text.length<120)continue;const ls=lines(text);for(const l of ls.slice(0,80)){const x=parseUnit(l);if(!x||x.type!==u.type||x.number!==u.number)continue;const s=sim(x.title,u.title);cand.push({page:i+1,score:80+s*30,title:x.title});}const body=sim(text.slice(0,2200),u.title);if(norm(text).includes(`${u.type==='tema'?'tema':'bab'} ${u.number}`)&&body>.35)cand.push({page:i+1,score:45+body*40,title:u.title});}cand.sort((a,b)=>b.score-a.score||a.page-b.page);return cand[0]||null;}
function findSubPage(pages,unitPage){for(let i=unitPage-1;i<Math.min(pages.length,unitPage+12);i++){for(const l of lines(pages[i])){const m=l.match(/^([A-G])(?:\.|\))\s+(.{4,180})$/);if(m&&!isNoise(l))return{page:i+1,label:m[1].toUpperCase(),title:clean(m[2])};}}return null;}
function nextSubPage(pages,start,label){const idx='ABCDEFG'.indexOf(label);if(idx<0||idx>=6)return -1;const n='ABCDEFG'[idx+1];for(let i=start;i<pages.length;i++)for(const l of lines(pages[i]))if(new RegExp(`^${n}[.)]\\s+`,'i').test(l))return i;return -1;}
function cleanPage(text,unitTitle){const out=[];for(const l of lines(text)){if(isNoise(l))continue;if(UNIT_RE.test(l)){if(sim(l,unitTitle)>=0.35)out.push(l);continue;}out.push(l);}return out.join(' ');}

async function process(sql,task){
  if(!task.requires_book)return{task_id:task.task_id,status:'not_required'};
  const kelas=task.jenis_kegiatan==='Ekstrakurikuler'?'-':task.kelas;const rows=await sql`SELECT * FROM books WHERE aktif=TRUE AND mapel=${task.mapel} AND kelas=${kelas} ORDER BY created_at DESC LIMIT 1`;if(!rows.length)return{task_id:task.task_id,status:'book_missing'};const book=rows[0];const pathname=await resolveBlob(sql,book,task.mapel,kelas);const {pages,totalPages}=await loadPages(pathname);
  const progress=(await sql`SELECT * FROM progress WHERE sekolah=${task.sekolah} AND mapel=${task.mapel} AND kelas=${kelas} LIMIT 1`)[0]||null;const anchor=Number(progress?.halaman_akhir||0);
  const toc=findToc(pages);const units=tocUnits(pages,toc);const unit=units[0]||null;const actual=unit?findUnitPage(pages,toc,unit):null;
  if(!actual)throw new Error(`Tidak dapat menemukan awal unit materi untuk ${task.mapel} ${kelas}.`);
  const sub=findSubPage(pages,actual.page)||{page:actual.page,label:'A',title:'Subbab berikutnya'};const start=Math.max(1,anchor?anchor+1:sub.page);const endRaw=nextSubPage(pages,start,sub.label);const end=Math.min(totalPages,endRaw>=0?endRaw:sub.page+8);const pageIndexes=[];for(let i=start-1;i<end;i++)pageIndexes.push(i);
  const selected=pageIndexes.map(i=>({page:i+1,text:cleanPage(pages[i],unit.title)})).filter(x=>x.text.length>40);const context=selected.map(x=>`[Halaman ${x.page}] ${x.text}`).join('\n\n').slice(0,18000);const bad=selected.filter(x=>{const t=norm(x.text);const units=t.match(/\b(?:bab|tema)\s+[2-9ivx]+\b/gi)||[];return units.length>0 && sim(t,unit.title)<0.25;}).length;
  return{task_id:task.task_id,status:'success',context_valid:context.length>200&&bad===0,blob_path:pathname,mapel:task.mapel,kelas,buku:book.nama_buku,bab:`${unit.type==='tema'?'Tema':'Bab'} ${unit.roman} ${unit.title}`,subbab:`${sub.label}. ${sub.title}`,halaman_awal:selected[0]?.page||start,halaman_akhir:selected.at(-1)?.page||end,total_context_characters:context.length,contamination_pages:bad,pages:selected.map(x=>x.page),context};
}

export async function POST(req){try{const b=await req.json().catch(()=>({}));const sql=await sqlClient();const tanggal=b.tanggal?String(b.tanggal):null;const taskId=b.task_id?String(b.task_id):null;if(!tanggal&&!taskId)return Response.json({agent:'context_extractor_v2',status:'error',reason:'Kirim task_id atau tanggal.'},{status:400});const tasks=taskId?await sql`SELECT * FROM tasks WHERE task_id=${taskId} LIMIT 1`:await sql`SELECT * FROM tasks WHERE tanggal=${tanggal} AND requires_book=TRUE ORDER BY task_id`;if(!tasks.length)return Response.json({agent:'context_extractor_v2',status:'no_tasks',tasks:[]});const out=[];for(const t of tasks){try{out.push(await process(sql,t));}catch(e){out.push({task_id:t.task_id,status:'error',error:e instanceof Error?e.message:'Context Extractor gagal.'});}}return Response.json({agent:'context_extractor_v2',status:'success',tanggal: tanggal||tasks[0]?.tanggal,tasks:out});}catch(e){return Response.json({agent:'context_extractor_v2',status:'error',reason:e instanceof Error?e.message:'Context Extractor gagal.'},{status:500});}}
