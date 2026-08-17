'use client';
import {useState} from 'react';
export default function PublisherPage(){
 const [tanggal,setTanggal]=useState('2026-08-15');
 const [skip,setSkip]=useState(false);
 const [input,setInput]=useState('');
 const [loading,setLoading]=useState(false);
 const [result,setResult]=useState(null);
 async function run(){
  setLoading(true);setResult(null);
  try{
   const parsed=input.trim()?JSON.parse(input):null;
   const body={tanggal,skip_publisher:skip,...(parsed?.documents?{documents:parsed.documents}:parsed?.generated?{documents:parsed.generated}:parsed?{documents:Array.isArray(parsed)?parsed:[]}: {})};
   const r=await fetch(`/api/publisher?run=${Date.now()}`,{method:'POST',headers:{'content-type':'application/json','cache-control':'no-cache'},body:JSON.stringify(body)});
   setResult(await r.json());
  }catch(e){setResult({agent:'publisher',status:'error',reason:e?.message||'JSON input tidak valid.'});}
  finally{setLoading(false);}
 }
 return <main style={{maxWidth:1150,margin:'40px auto',padding:'0 20px',fontFamily:'Arial,sans-serif'}}>
  <h1>YaumiTeach / Step 9</h1>
  <p>Publisher — mengubah hasil Content Generator menjadi file DOCX dan mengirimkannya langsung ke Bot Telegram.</p>
  <p style={{fontSize:13,color:'#666'}}>Publisher tidak menggunakan Gemini, Google Drive, atau Google Docs. Dibutuhkan TELEGRAM_BOT_TOKEN dan TELEGRAM_CHAT_ID.</p>
  <div style={{display:'flex',gap:18,alignItems:'center',margin:'20px 0',flexWrap:'wrap'}}>
   <input type="date" value={tanggal} onChange={e=>setTanggal(e.target.value)} style={{padding:10}}/>
   <label style={{display:'flex',gap:8,alignItems:'center'}}><input type="checkbox" checked={skip} onChange={e=>setSkip(e.target.checked)}/> Skip Publisher</label>
   <button onClick={run} disabled={loading} style={{padding:'10px 16px',cursor:'pointer'}}>{loading?'Mengirim...':skip?'Lewati Publisher':'Kirim ke Telegram'}</button>
  </div>
  {!skip&&<textarea value={input} onChange={e=>setInput(e.target.value)} placeholder="Opsional: tempel JSON hasil Step 7/Step 8. Kosongkan untuk mengambil hasil Step 7 otomatis." style={{width:'100%',minHeight:260,padding:12,fontFamily:'Consolas,monospace',fontSize:13,boxSizing:'border-box'}}/>}
  {!skip&&<div style={{marginTop:12,padding:12,border:'1px solid #ddd',borderRadius:10}}>Publisher hanya mengirim dokumen dengan <b>status success</b> dan tidak berstatus <b>quality_gate=revise</b>.</div>}
  {result&&<pre style={{whiteSpace:'pre-wrap',background:'#f5f5f5',padding:16,borderRadius:10,overflow:'auto',marginTop:20}}>{JSON.stringify(result,null,2)}</pre>}
 </main>
}
