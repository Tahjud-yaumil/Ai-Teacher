'use client';

import { useState } from 'react';

export default function BookReaderPage() {
  const [tanggal, setTanggal] = useState('2026-08-15');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  async function runBookReader() {
    setLoading(true);
    setResult(null);
    try {
      const response = await fetch('/api/book-reader', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tanggal }),
      });
      const data = await response.json();
      setResult(data);
    } catch (error) {
      setResult({ status: 'error', reason: error instanceof Error ? error.message : 'Request gagal.' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ minHeight: '100vh', background: '#0a0a0a', color: '#f5f5f5', padding: '40px 24px', fontFamily: 'Arial, sans-serif' }}>
      <section style={{ maxWidth: 1100, margin: '0 auto' }}>
        <p style={{ color: '#888', fontSize: 13 }}>YAUMITEACH / STEP 6</p>
        <h1 style={{ marginBottom: 8 }}>Book Reader</h1>
        <p style={{ color: '#aaa', lineHeight: 1.6 }}>
          Membaca PDF dari Private Vercel Blob, memilih buku sesuai mapel + kelas, lalu mengambil materi setelah posisi progres terakhir.
        </p>

        <div style={{ marginTop: 28, display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
          <label style={{ display: 'grid', gap: 8 }}>
            <span style={{ color: '#aaa', fontSize: 13 }}>Tanggal task</span>
            <input
              type="date"
              value={tanggal}
              onChange={(e) => setTanggal(e.target.value)}
              style={{ background: '#111', color: '#fff', border: '1px solid #333', borderRadius: 10, padding: '12px 14px' }}
            />
          </label>
          <button
            onClick={runBookReader}
            disabled={loading}
            style={{ background: '#fff', color: '#000', border: 0, borderRadius: 10, padding: '12px 18px', fontWeight: 700, cursor: loading ? 'wait' : 'pointer' }}
          >
            {loading ? 'Membaca PDF…' : 'Jalankan Book Reader'}
          </button>
        </div>

        {result && (
          <pre style={{ marginTop: 28, background: '#111', border: '1px solid #222', borderRadius: 14, padding: 18, overflow: 'auto', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
            {JSON.stringify(result, null, 2)}
          </pre>
        )}
      </section>
    </main>
  );
}
