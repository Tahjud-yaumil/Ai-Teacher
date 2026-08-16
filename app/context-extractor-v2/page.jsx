'use client';

import { useState } from 'react';

export default function ContextExtractorV2Page() {
  const [tanggal, setTanggal] = useState('2026-08-15');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  async function run() {
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const res = await fetch('/api/context-extractor-v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tanggal }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.reason || data?.error || `HTTP ${res.status}`);
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menjalankan Context Extractor V2.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 1100, margin: '0 auto', padding: 40, fontFamily: 'system-ui, sans-serif' }}>
      <p style={{ opacity: 0.7 }}>YAUMITEACH / STEP 6C V2</p>
      <h1 style={{ fontSize: 38, marginBottom: 8 }}>Context Extractor V2</h1>
      <p style={{ opacity: 0.8, marginBottom: 28 }}>
        Mengambil konteks materi dari halaman subbab yang sebenarnya, bukan halaman Daftar Isi.
      </p>

      <section style={{ border: '1px solid #333', borderRadius: 16, padding: 24, background: '#111' }}>
        <label style={{ display: 'block', marginBottom: 8 }}>Tanggal task</label>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="date"
            value={tanggal}
            onChange={(e) => setTanggal(e.target.value)}
            style={{ padding: '12px 14px', borderRadius: 10, border: '1px solid #444', background: '#181818', color: '#fff' }}
          />
          <button
            type="button"
            onClick={run}
            disabled={loading}
            style={{ padding: '12px 18px', borderRadius: 10, border: 0, cursor: loading ? 'wait' : 'pointer' }}
          >
            {loading ? 'Menjalankan...' : 'Jalankan Context Extractor V2'}
          </button>
        </div>
      </section>

      {error && (
        <pre style={{ marginTop: 20, whiteSpace: 'pre-wrap', color: '#ff8f8f', background: '#261616', padding: 20, borderRadius: 12 }}>
          {error}
        </pre>
      )}

      {result && (
        <pre style={{ marginTop: 20, whiteSpace: 'pre-wrap', overflowX: 'auto', background: '#0d0d0d', padding: 20, borderRadius: 12, border: '1px solid #333', lineHeight: 1.5 }}>
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </main>
  );
}
