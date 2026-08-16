import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const env = (n) => typeof process.env[n] === 'string' ? process.env[n].trim() : '';
const db = () => { const u = env('DATABASE_URL') || env('POSTGRES_PRISMA_URL') || env('POSTGRES_URL') || env('DATABASE_URL_UNPOOLED'); if (!u) throw new Error('DATABASE_URL belum tersedia.'); return neon(u); };
const cleanDate = (v) => { const s=String(v||''); const m=s.match(/\b(20\d{2})[-/](\d{2})[-/](\d{2})\b/); if(m)return `${m[1]}-${m[2]}-${m[3]}`; const d=new Date(v); return Number.isNaN(d.getTime())?new Date().toISOString().slice(0,10):new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta'}).format(d); };
const keys = () => { const a=[['legacy',env('GEMINI_API_KEY')],['1',env('GEMINI_API_KEY_1')],['2',env('GEMINI_API_KEY_2')]]; const seen=new Set(); return a.filter(([,k])=>k&&!seen.has(k)&&seen.add(k)); };
const asText = (v) => Array.isArray(v)?v.join('\n'):typeof v==='string'?v:JSON.stringify(v||'');

function structuralReview(doc){
  const md=String(doc.document_markdown||'');
  const checks={
    identity:/## 1\. Identitas Pembelajaran/.test(md),
    objectives:/## 2\. Tujuan Pembelajaran/.test(md),
    profile:/## 3\. Profil Pelajar Pancasila/.test(md),
    meaning:/## 4\. Pemahaman Bermakna/.test(md),
    prompts:/## 5\. Pertanyaan Pemantik/.test(md),
    material:/## 6\. Ringkasan Materi Ajar/.test(md),
    activities:/## 7\. Kegiatan Pembelajaran/.test(md),
    lkpd:/## 8\. LKPD/.test(md),
    diagnostic:/## 9\. Asesmen Diagnostik/.test(md),
    formative:/## 10\. Asesmen Formatif/.test(md),
    rubric:/## 11\. Rubrik Penilaian/.test(md),
    answerKey:/## 12\. Kunci Jawaban/.test(md),
    homework:/## 13\. Tugas Rumah/.test(md),
    teacherNotes:/## 14\. Catatan Guru/.test(md),
    learnerTerm:!/(Peserta didik|\bSiswa\b|\bSiswi\b)/i.test(md),
    noBookInstruction:!/(buka|lihat|bacalah) (buku|halaman)/i.test(md),
    noObjectObject:!(/\[object Object\]/.test(md)),
    oneAnswerKey:(md.match(/## 12\. Kunci Jawaban/g)||[]).length===1,
    dateFormat:/^20\d{2}-\d{2}-\d{2} - /.test(String(doc.suggested_file_name||'')),
    pageInternalNote:/> Catatan internal guru:/.test(md)
  };
  const failures=Object.entries(checks).filter(([,v])=>!v).map(([k])=>k);
  const warnings=[];
  if(doc.jam && /:\d{2}-/.test(doc.jam)) warnings.push('Format jam masih mengandung detik.');
  if(/^\./.test(String(doc.judul_materi||''))) warnings.push('Judul materi diawali titik.');
  const formative=(md.match(/## 10\. Asesmen Formatif[\s\S]*?## 11\./)||[''])[0];
  const qCount=(formative.match(/^\d+\./gm)||[]).length;
  if(qCount!==5) failures.push(`asesmen_formatif_${qCount}_soal`);
  const diag=(md.match(/## 9\. Asesmen Diagnostik[\s\S]*?## 10\./)||[''])[0];
  const dCount=(diag.match(/^- /gm)||[]).length;
  if(dCount!==3) failures.push(`asesmen_diagnostik_${dCount}_soal`);
  const rub=(md.match(/## 11\. Rubrik Penilaian[\s\S]*?## 12\./)||[''])[0];
  const rCount=(rub.match(/^\| [^|]+ \|/gm)||[]).length-1;
  if(rCount<4) failures.push(`rubrik_${Math.max(rCount,0)}_aspek`);
  const score=failures.length? 'revise':warnings.length?'review':'pass';
  return {score, checks, failures, warnings};
}

async function aiReview(doc, contextText){
  const arr=keys(); if(!arr.length) return {status:'skipped',reason:'Tidak ada Gemini API key.'};
  const model=env('GEMINI_INTERACTION_MODEL')||'gemini-3.6-flash';
  const prompt=`Anda adalah Quality Reviewer perangkat pembelajaran MTs. Nilai dokumen di bawah terhadap sumber context. Jangan menulis ulang dokumen. Kembalikan JSON ringkas dengan: source_fidelity_score (0-100), pedagogical_score (0-100), compliance_score (0-100), strengths (maks 4), issues (maks 6), severity (pass/revise). Fokus: 1 subbab pertemuan, fakta sesuai context, tidak keluar cakupan, LKPD mandiri tanpa instruksi membuka buku, 3 diagnostik, 5 formatif, rubrik >=4 aspek, KBC/LDI tepat untuk intrakurikuler. Istilah harus Murid. Jika klaim tidak didukung context, tandai. JSON saja.\n\nDOCUMENT:\n${String(doc.document_markdown||'').slice(0,18000)}\n\nSOURCE CONTEXT:\n${String(contextText||'').slice(0,14000)}`;
  for(let i=0;i<arr.length;i++){
    const [slot,key]=arr[i];
    const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/interactions?key=${encodeURIComponent(key)}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model,input:prompt,response_format:{type:'text',mime_type:'application/json'},store:false}),cache:'no-store'});
    const d=await r.json().catch(()=>({}));
    if(r.ok){const text=d?.output_text||d?.steps?.slice().reverse().flatMap(s=>s?.content||[]).filter(x=>x?.type==='text').map(x=>x.text||'').join('')||''; try{return {status:'success',api_key_slot:slot,...JSON.parse(text)};}catch{return {status:'error',reason:'AI reviewer mengembalikan JSON yang tidak dapat diparse.',api_key_slot:slot};}}
    const msg=d?.error?.message||''; if(!(r.status===429||r.status===503||/quota|rate.?limit|resource_exhausted/i.test(msg))) return {status:'error',reason:`Gemini reviewer HTTP ${r.status}: ${msg}`,api_key_slot:slot};
  }
  return {status:'skipped',reason:'Semua Gemini key reviewer terkena quota/rate limit.'};
}

export async function POST(req){
  try{
    const body=await req.json().catch(()=>({}));
    const tanggal=cleanDate(body?.tanggal);
    const sql=db();
    const rows=await sql`SELECT * FROM tasks WHERE tanggal=${tanggal} ORDER BY task_id`;
    const host=req.headers.get('host'), proto=req.headers.get('x-forwarded-proto'), origin=proto&&host?`${proto}://${host}`:`https://${env('VERCEL_URL')}`;
    const cr=await fetch(`${origin}/api/content-generator?run=${Date.now()}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({tanggal}),cache:'no-store'});
    const content=await cr.json();
    if(!cr.ok||content?.status!=='success') return Response.json({agent:'quality_reviewer',status:'error',reason:'Content Generator gagal.',content_result:content},{status:500});
    const docs=content.documents||[];
    const results=[];
    for(const doc of docs){
      if(doc.status!=='success'){results.push({task_id:doc.task_id,status:'skipped',reason:doc.reason});continue;}
      const structural=structuralReview(doc);
      let ai={status:'skipped',reason:'AI review tidak dijalankan.'};
      if(body?.use_ai!==false && doc.requires_book!==false){
        try{
          const xr=await fetch(`${origin}/api/context-extractor-engine?run=${Date.now()}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({tanggal,task_id:doc.task_id}),cache:'no-store'});
          const x=await xr.json().catch(()=>({})); const ctx=x?.tasks?.find(t=>String(t.task_id)===String(doc.task_id)); ai=await aiReview(doc,ctx?.context||'');
        }catch(e){ai={status:'error',reason:e instanceof Error?e.message:'AI review gagal.'};}
      }
      const finalSeverity=structural.score==='revise'||ai?.severity==='revise'?'revise':structural.score==='review'||ai?.severity==='review'?'review':'pass';
      results.push({task_id:doc.task_id,sekolah:doc.sekolah,mapel:doc.mapel,kelas:doc.kelas,judul_materi:doc.judul_materi,quality_gate:finalSeverity,structural_review:structural,ai_review:ai,suggested_file_name:doc.suggested_file_name,output_folder:doc.output_folder});
    }
    return Response.json({agent:'quality_reviewer',status:'success',tanggal,hari:content.hari,summary:{total:results.length,pass:results.filter(x=>x.quality_gate==='pass').length,review:results.filter(x=>x.quality_gate==='review').length,revise:results.filter(x=>x.quality_gate==='revise').length},results});
  }catch(e){console.error(e);return Response.json({agent:'quality_reviewer',status:'error',reason:e instanceof Error?e.message:'Quality Reviewer gagal.'},{status:500});}
}
