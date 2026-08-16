import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';
export const maxDuration = 120;
export const dynamic = 'force-dynamic';

const env = (n) => typeof process.env[n] === 'string' ? process.env[n].trim() : '';
const db = () => { const u = env('DATABASE_URL') || env('POSTGRES_PRISMA_URL') || env('POSTGRES_URL') || env('DATABASE_URL_UNPOOLED'); if (!u) throw new Error('DATABASE_URL belum tersedia.'); return neon(u); };
const cleanDate = (v) => { const s=String(v||''); const m=s.match(/\b(20\d{2})[-/](\d{2})[-/](\d{2})\b/); if(m)return `${m[1]}-${m[2]}-${m[3]}`; const d=new Date(v); return Number.isNaN(d.getTime())?new Date().toISOString().slice(0,10):new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta'}).format(d); };

function structuralReview(doc){
  const md=String(doc.document_markdown||'');
  const checks={
    identity:/## 1\. Identitas Pembelajaran/.test(md), objectives:/## 2\. Tujuan Pembelajaran/.test(md), profile:/## 3\. Profil Pelajar Pancasila/.test(md), meaning:/## 4\. Pemahaman Bermakna/.test(md), prompts:/## 5\. Pertanyaan Pemantik/.test(md), material:/## 6\. Ringkasan Materi Ajar/.test(md), activities:/## 7\. Kegiatan Pembelajaran/.test(md), lkpd:/## 8\. LKPD/.test(md), diagnostic:/## 9\. Asesmen Diagnostik/.test(md), formative:/## 10\. Asesmen Formatif/.test(md), rubric:/## 11\. Rubrik Penilaian/.test(md), answerKey:/## 12\. Kunci Jawaban/.test(md), homework:/## 13\. Tugas Rumah/.test(md), teacherNotes:/## 14\. Catatan Guru/.test(md), learnerTerm:!/(Peserta didik|\bSiswa\b|\bSiswi\b)/i.test(md), noBookInstruction:!/(buka|lihat|bacalah)\s+(buku|halaman)/i.test(md), noObjectObject:!(/\[object Object\]/.test(md)), oneAnswerKey:(md.match(/## 12\. Kunci Jawaban/g)||[]).length===1, dateFormat:/^20\d{2}-\d{2}-\d{2} - /.test(String(doc.suggested_file_name||'')) };
  const failures=Object.entries(checks).filter(([,v])=>!v).map(([k])=>k); const warnings=[];
  if(doc.jam && /:\d{2}-/.test(doc.jam)) warnings.push('Format jam masih mengandung detik.');
  if(/^\./.test(String(doc.judul_materi||''))) warnings.push('Judul materi diawali titik.');
  if(!doc.halaman || doc.halaman==='-') warnings.push('Tidak ada rentang halaman sumber.');
  const formative=(md.match(/## 10\. Asesmen Formatif[\s\S]*?## 11\./)||[''])[0]; const qCount=(formative.match(/^\d+\./gm)||[]).length; if(qCount!==5) failures.push(`asesmen_formatif_${qCount}_soal`);
  const diag=(md.match(/## 9\. Asesmen Diagnostik[\s\S]*?## 10\./)||[''])[0]; const dCount=(diag.match(/^- /gm)||[]).length; if(dCount!==3) failures.push(`asesmen_diagnostik_${dCount}_soal`);
  const rub=(md.match(/## 11\. Rubrik Penilaian[\s\S]*?## 12\./)||[''])[0]; const rCount=Math.max(0,(rub.match(/^\| [^|]+ \|/gm)||[]).length-1); if(rCount<4) failures.push(`rubrik_${rCount}_aspek`);
  const quality=failures.length?'revise':warnings.length?'review':'pass'; return {quality_gate:quality,checks,failures,warnings};
}

function reviewTask(doc){
  if(doc.status!=='success') return {task_id:doc.task_id,status:'skipped',reason:doc.reason||'Dokumen tidak sukses.'};
  const structural=structuralReview(doc);
  const issues=[...structural.failures.map(x=>({type:'error',code:x})),...structural.warnings.map(x=>({type:'warning',message:x}))];
  const suggestions=[];
  if(structural.checks.learnerTerm===false) suggestions.push('Ganti istilah Peserta didik/Siswa/Siswi menjadi Murid.');
  if(structural.checks.noBookInstruction===false) suggestions.push('Hapus instruksi yang meminta murid membuka atau melihat buku/halaman.');
  if(structural.checks.noObjectObject===false) suggestions.push('Perbaiki renderer yang menghasilkan [object Object].');
  if(structural.checks.oneAnswerKey===false) suggestions.push('Pastikan hanya ada satu bagian Kunci Jawaban.');
  if(structural.warnings.some(x=>/jam/.test(x))) suggestions.push('Normalisasi alokasi waktu menjadi HH:MM-HH:MM.');
  if(structural.warnings.some(x=>/judul/.test(x))) suggestions.push('Bersihkan tanda titik/prefix pada judul materi.');
  return {task_id:doc.task_id,sekolah:doc.sekolah,mapel:doc.mapel,kelas:doc.kelas,judul_materi:doc.judul_materi,status:'reviewed',quality_gate:structural.quality_gate,structural_review:structural,issues,suggestions,suggested_file_name:doc.suggested_file_name,output_folder:doc.output_folder};
}

export async function POST(req){
  try{
    const body=await req.json().catch(()=>({}));
    const tanggal=cleanDate(body?.tanggal);
    let docs=Array.isArray(body?.documents)?body.documents:null;
    if(!docs){
      if(body?.require_input===true) return Response.json({agent:'quality_reviewer',status:'error',reason:'Step 8 membutuhkan documents dari Step 7. Tidak ada AI yang dipanggil oleh Quality Reviewer.'},{status:400});
      const sql=db();
      const rows=await sql`SELECT task_id,sekolah,mapel,kelas,jenis_kegiatan,jam_mulai,jam_selesai,requires_progress_update FROM tasks WHERE tanggal=${tanggal} ORDER BY task_id`;
      return Response.json({agent:'quality_reviewer',status:'ready',tanggal,hari:new Intl.DateTimeFormat('id-ID',{weekday:'long',timeZone:'Asia/Jakarta'}).format(new Date(`${tanggal}T00:00:00+07:00`)),ai_used:false,requires_input_documents:true,tasks:rows});
    }
    const results=docs.map(reviewTask); const summary={total:results.length,pass:results.filter(x=>x.quality_gate==='pass').length,review:results.filter(x=>x.quality_gate==='review').length,revise:results.filter(x=>x.quality_gate==='revise').length,skipped:results.filter(x=>x.status==='skipped').length};
    return Response.json({agent:'quality_reviewer',status:'success',tanggal,hari:new Intl.DateTimeFormat('id-ID',{weekday:'long',timeZone:'Asia/Jakarta'}).format(new Date(`${tanggal}T00:00:00+07:00`)),ai_used:false,summary,results});
  }catch(e){ console.error(e); return Response.json({agent:'quality_reviewer',status:'error',reason:e instanceof Error?e.message:'Quality Reviewer gagal.'},{status:500}); }
}
