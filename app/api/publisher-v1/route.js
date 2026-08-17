import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, HeadingLevel, WidthType, AlignmentType, ShadingType } from 'docx';

export const runtime='nodejs';
export const maxDuration=180;
export const dynamic='force-dynamic';

const env=(n)=>typeof process.env[n]==='string'?process.env[n].trim():'';
const cleanDate=(v)=>{const s=String(v||'');const m=s.match(/\b(20\d{2})[-/](\d{2})[-/](\d{2})\b/);if(m)return `${m[1]}-${m[2]}-${m[3]}`;const d=new Date(v);return Number.isNaN(d.getTime())?new Date().toISOString().slice(0,10):new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta'}).format(d)};
const formatTime=(v)=>{const s=String(v??'').trim();if(!s||s==='-')return '-';const m=s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);return m?`${m[1].padStart(2,'0')}:${m[2]}`:s.slice(0,5)};
const timeRange=(d)=>{const a=formatTime(d?.jam_mulai),b=formatTime(d?.jam_selesai);return a==='-'&&b==='-'?'-':`${a}-${b}`};

function telegramConfig(){const token=env('TELEGRAM_BOT_TOKEN'),chatId=env('TELEGRAM_CHAT_ID');if(!token)throw new Error('TELEGRAM_BOT_TOKEN belum tersedia.');if(!chatId)throw new Error('TELEGRAM_CHAT_ID belum tersedia.');return{token,chatId};}
async function telegram(method,body){const{token}=telegramConfig();const r=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',body,cache:'no-store'});const d=await r.json().catch(()=>({}));if(!r.ok||d?.ok!==true)throw new Error(`Telegram ${method} gagal: ${d?.description||`HTTP ${r.status}`}`);return d.result;}
const txt=(v)=>String(v??'').replace(/\r/g,'').trim();
const cleanHeading=(s)=>txt(s).replace(/^#{1,6}\s+/,'').trim();

function parseMarkdown(md){
  const lines=String(md||'').replace(/\r/g,'').split('\n');
  const blocks=[];let i=0;
  while(i<lines.length){
    const line=lines[i];
    if(!line.trim()){i++;continue;}
    const h=line.match(/^(#{1,4})\s+(.*)$/);
    if(h){blocks.push({type:'heading',level:h[1].length,text:cleanHeading(h[2])});i++;continue;}
    if(/^\|/.test(line)&&i+1<lines.length&&/^\|\s*:?-+/.test(lines[i+1])){
      const rows=[];const parseRow=(x)=>x.split('|').slice(1,-1).map(c=>txt(c));rows.push(parseRow(line));i+=2;while(i<lines.length&&/^\|/.test(lines[i])){rows.push(parseRow(lines[i]));i++;}blocks.push({type:'table',rows});continue;}
    const bullet=line.match(/^\s*[-*]\s+(.*)$/);const num=line.match(/^\s*\d+\.\s+(.*)$/);
    if(bullet){blocks.push({type:'bullet',text:txt(bullet[1])});i++;continue;}
    if(num){blocks.push({type:'number',text:txt(num[1])});i++;continue;}
    blocks.push({type:'paragraph',text:txt(line).replace(/^>\s*/, '').replace(/\*\*/g,'')});i++;
  }
  return blocks;
}

const runText=(text,bold=false,size=22)=>new TextRun({text:txt(text),font:'Arial',size,bold});
function makeCell(text,bold=false){return new TableCell({children:[new Paragraph({spacing:{after:40},children:[runText(text,bold,20)]})]});}
function makeTable(rows){
  return new Table({
    rows:rows.map((row,ri)=>new TableRow({children:row.map(cell=>makeCell(cell,ri===0))})),
    width:{size:100,type:WidthType.PERCENTAGE},
    borders:{top:{style:'single',size:4,color:'B7B7B7'},bottom:{style:'single',size:4,color:'B7B7B7'},left:{style:'single',size:4,color:'B7B7B7'},right:{style:'single',size:4,color:'B7B7B7'},insideHorizontal:{style:'single',size:4,color:'D9D9D9'},insideVertical:{style:'single',size:4,color:'D9D9D9'}}
  });
}

function markdownToDocx(md,meta){
  const blocks=parseMarkdown(md);const children=[];
  children.push(new Paragraph({alignment:AlignmentType.CENTER,spacing:{after:180},children:[new TextRun({text:meta.suggested_file_name||'YaumiTeach',bold:true,font:'Arial',size:32,color:'17365D'})]}));
  for(const b of blocks){
    if(b.type==='heading'){
      const level=b.level===1?HeadingLevel.HEADING_1:b.level===2?HeadingLevel.HEADING_2:b.level===3?HeadingLevel.HEADING_3:HeadingLevel.HEADING_4;
      children.push(new Paragraph({heading:level,spacing:{before:b.level===1?180:120,after:80},children:[new TextRun({text:b.text,font:'Arial',bold:true,size:b.level===1?28:b.level===2?24:22,color:'17365D'})]}));
    } else if(b.type==='table'){
      children.push(makeTable(b.rows));
      children.push(new Paragraph({spacing:{after:100},children:[new TextRun('')]}));
    } else if(b.type==='bullet'){
      children.push(new Paragraph({leftIndent:360,hanging:180,spacing:{after:55},children:[runText(`• ${b.text}`,false,22)]}));
    } else if(b.type==='number'){
      children.push(new Paragraph({leftIndent:360,hanging:180,spacing:{after:55},children:[runText(`${b.text}`,false,22)]}));
    } else {
      children.push(new Paragraph({spacing:{after:80,line:1.1},children:[runText(b.text,false,22)]}));
    }
  }
  return new Document({
    creator:'YaumiTeach',
    title:meta.suggested_file_name||'YaumiTeach',
    description:'Perangkat pembelajaran YaumiTeach',
    sections:[{properties:{page:{margin:{top:720,right:720,bottom:720,left:720}}},children}]
  });
}
async function docxBuffer(doc){return Packer.toBuffer(markdownToDocx(doc.document_markdown,doc));}
async function sendDoc(doc,buffer){
  const{chatId}=telegramConfig();const form=new FormData();form.append('chat_id',chatId);form.append('document',new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}),`${doc.suggested_file_name}.docx`);
  const caption=['📘 YaumiTeach',`📅 ${doc.tanggal||'-'}`,`⏰ Jam: ${timeRange(doc)}`,`🏫 ${doc.sekolah||'-'}`,`📚 ${doc.mapel||'-'} — Kelas ${doc.kelas||'-'}`,`📖 ${doc.judul_materi||'-'}`,`🔢 Pertemuan: ${doc.pertemuan??'-'}`].join('\n');
  form.append('caption',caption.slice(0,1024));return telegram('sendDocument',form);
}
async function sendScheduleSummary(tasks,docs,tanggal){
  const{chatId}=telegramConfig();const sent=new Set((docs||[]).map(d=>String(d.task_id)));const lines=['🤖 YaumiTeach — Jadwal Hari Ini',`📅 ${tanggal}`,''];
  for(const t of tasks){const piket=String(t.mapel||'').toLowerCase()==='guru piket';const label=piket?'📋 Guru Piket':t.jenis_kegiatan==='Ekstrakurikuler'?'🎨 Ekstrakurikuler':'📚 '+(t.mapel||'-');const kelas=t.kelas&&t.kelas!=='-'?` — Kelas ${t.kelas}`:'';const jam=timeRange(t);const status=piket?'Dokumen tidak dibuat':sent.has(String(t.task_id))?'Dokumen terkirim':'Tidak diterbitkan';lines.push(`${jam} — ${label}${kelas}`,`   ${status}`);}
  const form=new URLSearchParams({chat_id:chatId,text:lines.join('\n')});return telegram('sendMessage',form);
}

export async function POST(req){
  try{
    const body=await req.json().catch(()=>({}));const tanggal=cleanDate(body?.tanggal);
    if(body?.skip_publisher===true)return Response.json({agent:'publisher',status:'skipped',tanggal,channel:'telegram',reason:'Publisher dilewati sesuai konfigurasi skip_publisher=true.',next_step:'progress_updater'});
    let docs=body?.documents||body?.generated||null;let tasks=Array.isArray(body?.tasks)?body.tasks:null;
    if(!docs){const host=req.headers.get('host'),proto=req.headers.get('x-forwarded-proto'),origin=proto&&host?`${proto}://${host}`:`https://${env('VERCEL_URL')}`;const r=await fetch(`${origin}/api/content-generator-v4?run=${Date.now()}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({tanggal}),cache:'no-store'});const data=await r.json().catch(()=>({}));if(!r.ok||data?.status!=='success')return Response.json({agent:'publisher',status:'error',reason:'Content Generator gagal.',content_result:data},{status:500});docs=data.documents||[];}
    if(!tasks){const host=req.headers.get('host'),proto=req.headers.get('x-forwarded-proto'),origin=proto&&host?`${proto}://${host}`:`https://${env('VERCEL_URL')}`;const r=await fetch(`${origin}/api/scheduler?run=${Date.now()}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({date:tanggal}),cache:'no-store'});const data=await r.json().catch(()=>({}));tasks=data?.tasks||[];}
    const selected=docs.filter(d=>String(d?.mapel||'').toLowerCase()!=='guru piket'&&d?.status==='success'&&d?.document_markdown&&d?.quality_gate!=='revise');
    const results=[];
    for(const doc of selected){try{const buffer=await docxBuffer(doc);const message=await sendDoc(doc,buffer);results.push({task_id:doc.task_id,status:'success',telegram_message_id:message?.message_id||null,file_name:`${doc.suggested_file_name}.docx`});}catch(e){results.push({task_id:doc.task_id,status:'error',reason:e instanceof Error?e.message:'Telegram publish gagal.'});}}
    try{await sendScheduleSummary(tasks,selected,tanggal);}catch(e){console.warn('Telegram schedule summary gagal:',e);}
    return Response.json({agent:'publisher',status:'success',tanggal,channel:'telegram',documents_sent:results.filter(x=>x.status==='success').length,failed:results.filter(x=>x.status==='error').length,guru_piket_documents:0,results});
  }catch(e){return Response.json({agent:'publisher',status:'error',channel:'telegram',reason:e instanceof Error?e.message:'Publisher gagal.'},{status:500});}
}
