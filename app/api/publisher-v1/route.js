import crypto from 'node:crypto';

export const runtime='nodejs';
export const maxDuration=180;
export const dynamic='force-dynamic';

const env=(n)=>typeof process.env[n]==='string'?process.env[n].trim():'';
const cleanDate=(v)=>{const s=String(v||'');const m=s.match(/\b(20\d{2})[-/](\d{2})[-/](\d{2})\b/);if(m)return `${m[1]}-${m[2]}-${m[3]}`;const d=new Date(v);return Number.isNaN(d.getTime())?new Date().toISOString().slice(0,10):new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta'}).format(d)};
const b64u=(v)=>Buffer.from(v).toString('base64url');
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));

function serviceAccount(){
  const raw=env('GOOGLE_SERVICE_ACCOUNT_JSON');
  if(!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON belum tersedia.');
  const obj=JSON.parse(raw);
  if(!obj.client_email||!obj.private_key) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON tidak lengkap.');
  return obj;
}

async function googleAccessToken(){
  const sa=serviceAccount();
  const now=Math.floor(Date.now()/1000);
  const header=b64u(JSON.stringify({alg:'RS256',typ:'JWT'}));
  const claim=b64u(JSON.stringify({iss:sa.client_email,scope:'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/documents',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600}));
  const input=`${header}.${claim}`;
  const signer=crypto.createSign('RSA-SHA256');
  signer.update(input); signer.end();
  const signature=signer.sign(sa.private_key,'base64url');
  const jwt=`${input}.${signature}`;
  const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:jwt}),cache:'no-store'});
  const d=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(`Google OAuth HTTP ${r.status}: ${d?.error_description||d?.error||'token gagal'}`);
  return d.access_token;
}

async function driveFetch(token,url,options={}){
  const r=await fetch(url,{...options,headers:{authorization:`Bearer ${token}`,'content-type':'application/json',...(options.headers||{})},cache:'no-store'});
  const d=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(`Google API HTTP ${r.status}: ${d?.error?.message||'request gagal'}`);
  return d;
}

async function findFolder(token,name,parentId){
  const q=[`mimeType='application/vnd.google-apps.folder'`,`name='${String(name).replace(/'/g,"\\'")}'`,'trashed=false'];
  if(parentId) q.push(`'${parentId}' in parents`);
  const data=await driveFetch(token,`https://www.googleapis.com/drive/v3/files?spaces=drive&corpora=user&q=${encodeURIComponent(q.join(' and '))}&fields=files(id,name,mimeType)&pageSize=10`);
  return data.files?.[0]||null;
}

async function ensurePath(token,path,rootId){
  const parts=String(path||'').split('/').map(x=>x.trim()).filter(Boolean);
  let parent=rootId||null;
  const created=[];
  for(const part of parts){
    let folder=await findFolder(token,part,parent);
    if(!folder){
      const body={name:part,mimeType:'application/vnd.google-apps.folder'};
      if(parent) body.parents=[parent];
      folder=await driveFetch(token,'https://www.googleapis.com/drive/v3/files',{method:'POST',body:JSON.stringify(body)});
      created.push(part);
    }
    parent=folder.id;
  }
  return {folderId:parent,created};
}

function markdownToBlocks(md){
  const lines=String(md||'').split(/\r?\n/);
  const out=[];
  let skipSeparator=false;
  for(let i=0;i<lines.length;i++){
    const line=lines[i];
    if(/^\|/.test(line)){
      if(/^\|\s*-{2,}/.test(line)) continue;
      const cells=line.split('|').slice(1,-1).map(x=>x.trim());
      if(cells.length){ out.push(cells.join('  |  ')); }
      continue;
    }
    let text=line
      .replace(/^#{1,6}\s+/,'')
      .replace(/^\s*[-*]\s+/,'• ')
      .replace(/^\s*\d+\.\s+/,'')
      .replace(/\*\*(.*?)\*\*/g,'$1')
      .replace(/\*(.*?)\*/g,'$1')
      .replace(/^>\s*/,'');
    if(!text.trim()){ out.push(''); continue; }
    out.push(text);
  }
  return out.join('\n');
}

async function createDoc(token,doc,folderId){
  const file=await driveFetch(token,'https://www.googleapis.com/drive/v3/files',{method:'POST',body:JSON.stringify({name:doc.suggested_file_name,mimeType:'application/vnd.google-apps.document',parents:folderId?[folderId]:undefined})});
  const content=markdownToBlocks(doc.document_markdown);
  if(content){
    await driveFetch(token,`https://docs.googleapis.com/v1/documents/${file.id}:batchUpdate`,{method:'POST',body:JSON.stringify({requests:[{insertText:{location:{index:1},text:content}}]})});
  }
  return {id:file.id,name:file.name,url:`https://docs.google.com/document/d/${file.id}/edit`};
}

async function publishOne(token,doc,rootId){
  if(doc.progress_update_required===false && doc.mapel==='Guru Piket'){
    // Guru Piket is still publishable; it simply does not update instructional progress.
  }
  const folderPath=doc.output_folder||'AI Teacher/Output';
  const {folderId,created}=await ensurePath(token,folderPath,rootId);
  const published=await createDoc(token,doc,folderId);
  return {...published,folder_path:folderPath,created_folders:created};
}

export async function POST(req){
  try{
    const body=await req.json().catch(()=>({}));
    const tanggal=cleanDate(body?.tanggal);
    if(body?.skip_publisher===true){return Response.json({agent:'publisher',status:'skipped',tanggal,reason:'Publisher dilewati sesuai konfigurasi skip_publisher=true.',next_step:'progress_updater'});}

    let docs=body?.documents||body?.generated||null;
    if(!docs){
      const host=req.headers.get('host'),proto=req.headers.get('x-forwarded-proto');
      const origin=proto&&host?`${proto}://${host}`:`https://${env('VERCEL_URL')}`;
      const r=await fetch(`${origin}/api/content-generator-v4?run=${Date.now()}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({tanggal}),cache:'no-store'});
      const data=await r.json().catch(()=>({}));
      if(!r.ok||data?.status!=='success') return Response.json({agent:'publisher',status:'error',reason:'Content Generator gagal.',content_result:data},{status:500});
      docs=data.documents||[];
    }

    const selected=docs.filter(d=>d?.status==='success' && d?.document_markdown && d?.quality_gate!=='revise');
    const token=googleAccessToken();
    const root=env('GOOGLE_DRIVE_ROOT_FOLDER_ID');
    const results=[];
    for(const doc of selected){
      try{ results.push({task_id:doc.task_id,status:'success',...(await publishOne(await token,doc,root))}); }
      catch(e){ results.push({task_id:doc.task_id,status:'error',reason:e instanceof Error?e.message:'Publish gagal.'}); }
    }
    return Response.json({agent:'publisher',status:'success',tanggal,google_docs_created:results.filter(x=>x.status==='success').length,failed:results.filter(x=>x.status==='error').length,skipped:docs.length-selected.length,results});
  }catch(e){return Response.json({agent:'publisher',status:'error',reason:e instanceof Error?e.message:'Publisher gagal.'},{status:500});}
}
