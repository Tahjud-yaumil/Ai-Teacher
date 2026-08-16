'use client';
import {useState} from 'react';
export default function QualityReviewerPage(){
 const [tanggal,setTanggal]=useState('2026-08-15');
 const [input,setInput]=useState('');
 const [loading,setLoading]=useState(false);
 const [result,setResult]=useState(null);
 async function run(){
  setLoading(true);setResult(null);
  try{
   const parsed=input.trim()?JSON.parse(input):null;
   const body=parsed?.documents?{tanggal,documents:parsed.documents}:parsed?.generated?{tanggal,documents:parsed.generated}:parsed?{tanggal,documents:Array.isArray(parsed)?parsed:[]}: {tanggal,require_input:true};
   const r=await fetch(`/api/quality-reviewer?run=${Date.now()}`,{method:'POST',headers:{'content-type':'application/json','cache-control':'no-cache'},body:JSON.stringify(body)});
   setResult(await r.json());
  }catch(e){setResult({agent:'quality_reviewer',status:'error',reason:e?.message||'JSON input tidak valid.'});}
  finally{setLoading(false);}
 }
 return <main style={{maxWidth:1150,margin:'40px auto',padding:'0 20px',fontFamily:'Arial,sans-serif'}}>
  <h1>YaumiTeach / Step 8</h1>
  <p>Quality Reviewer — pemeriksaan deterministik tanpa AI. Step 8 tidak menggunakan kuota Gemini.</p>
  <p style={{fontSize:13,color:'#666'}}>Tempel hasil JSON dari Step 7 pada kotak di bawah, lalu jalankan reviewer. Pemeriksaan meliputi struktur, 3 asesmen diagnostik, 5 asesmen formatif, rubrik, istilah Murid, instruksi buku, [object Object], dan format metadata.</p>
  <div style={{display:'flex',gap:12,alignItems:'center',margin:'20px 0'}}>
   <input type="date" value={tanggal} onChange={e=>setTanggal(e.target.value)} style={{padding:10}}/>
   <button onClick={run} disabled={loading} style={{padding:'10px 16px',cursor:'pointer'}}>{loading?'Memeriksa...':'Jalankan Quality Reviewer'}</button>
  </div>
  <textarea value={input} onChange={e=>setInput(e.target.value)} placeholder="Tempel JSON hasil Step 7 di sini..." style={{width:'100%',minHeight:320,padding:12,fontFamily:'Consolas,monospace',fontSize:13,boxSizing:'border-box'}}/>
  {result&&<><div style={{display:'flex',gap:12,margin:'16px 0',flexWrap:'wrap'}}>{result.summary&&Object.entries(result.summary).map(([k,v])=><div key={k} style={{border:'1px solid #ddd',borderRadius:10,padding:12,minWidth:100}}><b>{k}</b><div style={{fontSize:24}}>{v}</div></div>)}</div><pre style={{whiteSpace:'pre-wrap',background:'#f5f5f5',padding:16,borderRadius:10,overflow:'auto'}}>{JSON.stringify(result,null,2)}</pre></>}
 </main>
}
