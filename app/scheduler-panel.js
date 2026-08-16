'use client';

import { useState } from 'react';

export default function SchedulerPanel() {
  const [date, setDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  async function runScheduler() {
    setLoading(true);
    setResult(null);

    try {
      const response = await fetch('/api/scheduler', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(date ? { date } : {}),
      });

      const data = await response.json();
      setResult(data);
    } catch (error) {
      setResult({
        status: 'error',
        reason: error instanceof Error ? error.message : 'Gagal memanggil scheduler.',
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <section style={{ marginTop: 32, border: '1px solid #262626', background: '#111', borderRadius: 16, padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0 }}>Scheduler</h2>
          <p style={{ color: '#a3a3a3', lineHeight: 1.6, maxWidth: 700 }}>
            Membaca jadwal dari Neon dan membuat task hanya untuk tanggal yang dipilih. Kosongkan tanggal untuk menjalankan tanggal hari ini (Asia/Jakarta).
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            style={{ background: '#0a0a0a', color: '#f5f5f5', border: '1px solid #333', borderRadius: 10, padding: '10px 12px' }}
          />
          <button
            type="button"
            onClick={runScheduler}
            disabled={loading}
            style={{ background: '#f5f5f5', color: '#0a0a0a', border: 0, borderRadius: 10, padding: '10px 16px', fontWeight: 700, cursor: loading ? 'wait' : 'pointer' }}
          >
            {loading ? 'Menjalankan...' : 'Jalankan Scheduler'}
          </button>
        </div>
      </div>

      {result && (
        <pre style={{ marginTop: 20, padding: 16, borderRadius: 12, background: '#0a0a0a', border: '1px solid #262626', overflowX: 'auto', color: '#d4d4d4', fontSize: 13 }}>
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </section>
  );
}
