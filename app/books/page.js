'use client';

import { useState } from 'react';
import { upload } from '@vercel/blob/client';

const MAPEL = ['IPS', 'IPA', 'Informatika'];
const KELAS = ['VII', 'VIII', 'IX'];

function formatBytes(value) {
  if (!value) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(value) / Math.log(1024));
  return `${(value / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

export default function BooksPage() {
  const [form, setForm] = useState({
    nama_buku: '',
    mapel: 'IPS',
    kelas: 'VII',
    penerbit: '',
    tahun: '2026',
  });
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();

    if (!file) {
      setStatus('Pilih file PDF terlebih dahulu.');
      return;
    }

    if (file.type !== 'application/pdf') {
      setStatus('File harus berupa PDF.');
      return;
    }

    if (file.size > 100 * 1024 * 1024) {
      setStatus('Ukuran PDF maksimal 100 MB.');
      return;
    }

    setLoading(true);
    setStatus('Menyiapkan upload...');

    try {
      const blob = await upload(
        `books/${form.mapel}/${form.kelas}/${file.name}`,
        file,
        {
          access: 'private',
          handleUploadUrl: '/api/books/upload',
          clientPayload: JSON.stringify({ source: 'yaumiteach-books' }),
          multipart: true,
        }
      );

      setStatus('PDF berhasil diupload. Menyimpan metadata...');

      const response = await fetch('/api/books/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          tahun: form.tahun || null,
          file_name: file.name,
          blob_path: blob.pathname,
          blob_url: blob.url,
          file_size: file.size,
          mime_type: file.type,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Metadata gagal disimpan.');

      setStatus(`Berhasil: ${data.book.nama_buku} — ${formatBytes(file.size)}`);
      setForm({ nama_buku: '', mapel: 'IPS', kelas: 'VII', penerbit: '', tahun: '2026' });
      setFile(null);
      event.target.reset();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Upload gagal.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ minHeight: '100vh', background: '#0a0a0a', color: '#f5f5f5', padding: '40px 24px', fontFamily: 'Arial, sans-serif' }}>
      <section style={{ maxWidth: 900, margin: '0 auto' }}>
        <p style={{ color: '#888', fontSize: 13 }}>YAUMITEACH / BUKU PEGANGAN</p>
        <h1 style={{ marginBottom: 8 }}>Upload Buku PDF</h1>
        <p style={{ color: '#aaa', lineHeight: 1.6 }}>
          Buku disimpan di Private Vercel Blob. Metadata buku disimpan di Neon untuk digunakan Book Reader.
        </p>

        <form onSubmit={handleSubmit} style={{ marginTop: 28, background: '#111', border: '1px solid #262626', borderRadius: 18, padding: 24, display: 'grid', gap: 18 }}>
          <label style={{ display: 'grid', gap: 8 }}>
            <span>Nama Buku</span>
            <input required value={form.nama_buku} onChange={(e) => setForm({ ...form, nama_buku: e.target.value })} placeholder="Contoh: Ilmu Pengetahuan Alam Kelas IX" style={inputStyle} />
          </label>

          <div style={gridStyle}>
            <label style={{ display: 'grid', gap: 8 }}>
              <span>Mapel</span>
              <select value={form.mapel} onChange={(e) => setForm({ ...form, mapel: e.target.value })} style={inputStyle}>
                {MAPEL.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label style={{ display: 'grid', gap: 8 }}>
              <span>Kelas</span>
              <select value={form.kelas} onChange={(e) => setForm({ ...form, kelas: e.target.value })} style={inputStyle}>
                {KELAS.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
          </div>

          <div style={gridStyle}>
            <label style={{ display: 'grid', gap: 8 }}>
              <span>Penerbit</span>
              <input value={form.penerbit} onChange={(e) => setForm({ ...form, penerbit: e.target.value })} placeholder="Opsional" style={inputStyle} />
            </label>
            <label style={{ display: 'grid', gap: 8 }}>
              <span>Tahun</span>
              <input value={form.tahun} onChange={(e) => setForm({ ...form, tahun: e.target.value })} inputMode="numeric" style={inputStyle} />
            </label>
          </div>

          <label style={{ display: 'grid', gap: 8 }}>
            <span>File PDF</span>
            <input required type="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} style={{ color: '#ddd' }} />
            {file && <small style={{ color: '#999' }}>{file.name} — {formatBytes(file.size)}</small>}
          </label>

          <button disabled={loading} type="submit" style={{ background: '#fff', color: '#000', border: 0, borderRadius: 10, padding: '13px 18px', fontWeight: 700, cursor: loading ? 'wait' : 'pointer' }}>
            {loading ? 'Mengupload…' : 'Upload Buku'}
          </button>

          {status && <div style={{ padding: 14, borderRadius: 10, background: '#0c0c0c', border: '1px solid #2c2c2c', color: '#ddd' }}>{status}</div>}
        </form>
      </section>
    </main>
  );
}

const inputStyle = {
  background: '#0b0b0b',
  color: '#fff',
  border: '1px solid #333',
  borderRadius: 10,
  padding: '12px 14px',
};

const gridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 16,
};
