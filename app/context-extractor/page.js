'use client';

import { useState } from 'react';

export default function ContextExtractorPage() {
  const [tanggal, setTanggal] = useState('2026-08-15');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  async function run() {
    setLoading(true); setResult(null);
    try {
      const r = await fetch('/api/context-extractor', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({tanggal}) });
      setResult(await r.json());
    } catch (e) { setResult({status:'error', reason:e?.message || 'Gagal memanggil API.'}); }
    finally { setLoading(false); }
  }

  return (
    <main style={{maxWidth:1100,margin:'40px auto',padding:'0 20px',fontFamily:'Arial,sans-serif'}}>
      <h1>YaumiTeach / Step 6C</h1>
      <p>Context Extractor — mengambil konteks bersih dari subbab yang dipilih Book Reader.</p>
      <div style={{display:'flex',gap:12,alignItems:'center',margin:'20px 0'}}>
        <input type="date" value={tanggal} onChange={e=>setTanggal(e.target.value)} style={{padding:10}} />
        <button onClick={run} disabled={loading} style={{padding:'10px 16px',cursor:'pointer'}}>{loading?'Memproses...':'Jalankan Context Extractor'}</button>
      </div>
      {result && <pre style={{whiteSpace:'pre-wrap',background:'#f5f5f5',padding:16,borderRadius:10,overflow:'auto'}}>{JSON.stringify(result,null,2)}</pre>}
    </main>
  );
}
