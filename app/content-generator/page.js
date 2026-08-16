'use client';

import { useState } from 'react';

export default function ContentGeneratorPage() {
  const [tanggal, setTanggal] = useState('2026-08-15');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  async function run() {
    setLoading(true);
    setResult(null);
    try {
      const r = await fetch(`/api/content-generator?run=${Date.now()}`, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'content-type': 'application/json', 'cache-control': 'no-cache' },
        body: JSON.stringify({ tanggal }),
      });
      const data = await r.json();
      setResult(data);
    } catch (e) {
      setResult({ status: 'error', reason: e?.message || 'Gagal memanggil API.' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 1100, margin: '40px auto', padding: '0 20px', fontFamily: 'Arial,sans-serif' }}>
      <h1>YaumiTeach / Step 7</h1>
      <p>Content Generator — mengubah context pembelajaran yang sudah tervalidasi menjadi rancangan pembelajaran siap digunakan.</p>
      <p style={{ fontSize: 13, color: '#666' }}>Sumber utama: context extractor. AI hanya boleh menggunakan fakta yang didukung context.</p>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', margin: '20px 0' }}>
        <input type="date" value={tanggal} onChange={e => setTanggal(e.target.value)} style={{ padding: 10 }} />
        <button onClick={run} disabled={loading} style={{ padding: '10px 16px', cursor: 'pointer' }}>{loading ? 'Memproses...' : 'Jalankan Content Generator'}</button>
      </div>
      {result && <pre style={{ whiteSpace: 'pre-wrap', background: '#f5f5f5', padding: 16, borderRadius: 10, overflow: 'auto' }}>{JSON.stringify(result, null, 2)}</pre>}
    </main>
  );
}
