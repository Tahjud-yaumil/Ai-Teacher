import { Document, Packer, Paragraph, HeadingLevel, TextRun, Table, TableRow, TableCell } from 'docx';

export const runtime='nodejs';
export const maxDuration=180;
export const dynamic='force-dynamic';

const env=(n)=>typeof process.env[n]==='string'?process.env[n].trim():'';
const cleanDate=(v)=>{const s=String(v||'');const m=s.match(/\b(20\d{2})[-/](\d{2})[-/](\d{2})\b/);if(m)return `${m[1]}-${m[2]}-${m[3]}`;const d=new Date(v);return Number.isNaN(d.getTime())?new Date().toISOString().slice(0,10):new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta'}).format(d)};

function telegramConfig(){
  const token=env('TELEGRAM_BOT_TOKEN');
  const chatId=env('TELEGRAM_CHAT_ID');
  if(!token) throw new Error('TELEGRAM_BOT_TOKEN belum tersedia.');
  if(!chatId) throw new Error('TELEGRAM_CHAT_ID belum tersedia.');
  return {token,chatId};
}

async function telegram(method,body){
  const {token}=telegramConfig();
  const r=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',body,cache:'no-store'});
  const d=await r.json().catch(()=>({}));
  if(!r.ok||d?.ok!==true) throw new Error(`Telegram ${method} gagal: ${d?.description||`HTTP ${r.status}`}`);
  return d.result;
}

const text=(v)=>String(v??'').replace(/\r/g,'').trim();
function inlineRuns(value){
  const s=text(value); if(!s)return [new TextRun('')];
  return [new TextRun({text:s.replace(/\*\*/g,''),font:'Arial',size:22})];
}

function markdownToDocx(md){
  const lines=text(md).split(/\n/);
  const children=[];
  let i=0;
  while(i<lines.length){
    const line=lines[i];
    if(!line.trim()){children.push(new Paragraph({spacing:{after:90},children:[new TextRun('')]}));i++;continue;}
    const h=line.match(/^(#{1,6})\s+(.*)$/);
    if(h){
      const level=Math.min(h[1].length,4);
      children.push(new Paragraph({heading:level===1?HeadingLevel.HEADING_1:level===2?HeadingLevel.HEADING_2:level===3?HeadingLevel.HEADING_3:HeadingLevel.HEADING_4,children:inlineRuns(h[2])}));
      i++;continue;
    }
    if(/^\|/.test(line) && i+1<lines.length && /^\|\s*:?-+/.test(lines[i+1])){
      const table=[]; const headerCells=line.split('|').slice(1,-1).map(text); i+=2;
      table.push(new TableRow({children:headerCells.map(c=>new TableCell({children:[new Paragraph({children:[new TextRun({text:c,bold:true,font:'Arial',size:20})]})]}))}));
      while(i<lines.length&&/^\|/.test(lines[i])){const cells=lines[i].split('|').slice(1,-1).map(text);table.push(new TableRow({children:cells.map(c=>new TableCell({children:[new Paragraph({children:[new TextRun({text:c,font:'Arial',size:20})]})]}))}));i++;}
      children.push(new Table({rows:table,width:{size:100,type:0}}));
      children.push(new Paragraph({spacing:{after:100},children:[new TextRun('')] })); continue;
    }
    const bullet=line.match(/^\s*[-*]\s+(.*)$/); const num=line.match(/^\s*\d+\.\s+(.*)$/);
    children.push(new Paragraph({bullet:bullet?{level:0}:undefined,numbering:num?{reference:'default-numbering',level:0}:undefined,children:inlineRuns(bullet?bullet[1]:num?num[1]:line)}));
    i++;
  }
  return new Document({sections:[{properties:{},children}]});
}

async function docxBuffer(doc){return Packer.toBuffer(markdownToDocx(doc.document_markdown));}

async function sendDoc(doc,buffer){
  const {chatId}=telegramConfig();
  const form=new FormData();
  form.append('chat_id',chatId);
  form.append('document',new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}),`${doc.suggested_file_name}.docx`);
  const caption=[`📚 YaumiTeach`,`Mapel: ${doc.mapel||'-'}`,`Kelas: ${doc.kelas||'-'}`,`Materi: ${doc.judul_materi||'-'}`,`Pertemuan: ${doc.pertemuan??'-'}`].join('\n');
  form.append('caption',caption.slice(0,1024));
  return telegram('sendDocument',form);
}

async function sendSummary(docs,tanggal){
  const {chatId}=telegramConfig();
  const lines=['🤖 YaumiTeach Publisher',`Tanggal: ${tanggal}`,`Dokumen: ${docs.length}`,''];
  for(const d of docs){lines.push(`✅ ${d.mapel||'-'} — Kelas ${d.kelas||'-'} — ${d.judul_materi||'Materi'}`);}
  const form=new URLSearchParams({chat_id:chatId,text:lines.join('\n')});
  return telegram('sendMessage',form);
}

export async function POST(req){
  try{
    const body=await req.json().catch(()=>({}));
    const tanggal=cleanDate(body?.tanggal);
    if(body?.skip_publisher===true){return Response.json({agent:'publisher',status:'skipped',tanggal,channel:'telegram',reason:'Publisher dilewati sesuai konfigurasi skip_publisher=true.',next_step:'progress_updater'});}

    let docs=body?.documents||body?.generated||null;
    if(!docs){
      const host=req.headers.get('host'),proto=req.headers.get('x-forwarded-proto');
      const origin=proto&&host?`${proto}://${host}`:`https://${env('VERCEL_URL')}`;
      const r=await fetch(`${origin}/api/content-generator-v4?run=${Date.now()}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({tanggal}),cache:'no-store'});
      const data=await r.json().catch(()=>({}));
      if(!r.ok||data?.status!=='success') return Response.json({agent:'publisher',status:'error',reason:'Content Generator gagal.',content_result:data},{status:500});
      docs=data.documents||[];
    }

    const selected=docs.filter(d=>d?.status==='success'&&d?.document_markdown&&d?.quality_gate!=='revise');
    const results=[];
    for(const doc of selected){
      try{
        const buffer=await docxBuffer(doc);
        const message=await sendDoc(doc,buffer);
        results.push({task_id:doc.task_id,status:'success',telegram_message_id:message?.message_id||null,file_name:`${doc.suggested_file_name}.docx`,chat_id:env('TELEGRAM_CHAT_ID')});
      }catch(e){results.push({task_id:doc.task_id,status:'error',reason:e instanceof Error?e.message:'Telegram publish gagal.'});}
    }
    if(results.some(x=>x.status==='success')){try{await sendSummary(results.filter(x=>x.status==='success').map(x=>({...x,...docs.find(d=>d.task_id===x.task_id)})),tanggal);}catch(e){console.warn('Telegram summary gagal:',e);}}
    return Response.json({agent:'publisher',status:'success',tanggal,channel:'telegram',documents_sent:results.filter(x=>x.status==='success').length,failed:results.filter(x=>x.status==='error').length,skipped:docs.length-selected.length,results});
  }catch(e){return Response.json({agent:'publisher',status:'error',channel:'telegram',reason:e instanceof Error?e.message:'Publisher gagal.'},{status:500});}
}
