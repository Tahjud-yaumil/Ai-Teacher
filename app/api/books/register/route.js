import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';

function getSql() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL belum tersedia.');
  return neon(process.env.DATABASE_URL);
}

export async function POST(request) {
  try {
    const body = await request.json();
    const {
      nama_buku,
      mapel,
      kelas,
      penerbit = '',
      tahun = null,
      file_name,
      blob_path,
      blob_url,
      file_size = 0,
      mime_type = 'application/pdf',
    } = body;

    if (!nama_buku || !mapel || !kelas || !file_name || !blob_path || !blob_url) {
      return Response.json({ error: 'Metadata buku dan informasi blob wajib diisi.' }, { status: 400 });
    }

    const sql = getSql();

    await sql`
      CREATE TABLE IF NOT EXISTS books (
        id BIGSERIAL PRIMARY KEY,
        nama_buku TEXT NOT NULL,
        mapel TEXT NOT NULL,
        kelas TEXT NOT NULL,
        penerbit TEXT DEFAULT '',
        tahun INTEGER,
        file_name TEXT NOT NULL,
        blob_path TEXT NOT NULL,
        blob_url TEXT NOT NULL,
        file_size BIGINT DEFAULT 0,
        mime_type TEXT DEFAULT 'application/pdf',
        aktif BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    const rows = await sql`
      INSERT INTO books (
        nama_buku, mapel, kelas, penerbit, tahun,
        file_name, blob_path, blob_url, file_size, mime_type
      ) VALUES (
        ${nama_buku}, ${mapel}, ${kelas}, ${penerbit}, ${tahun ? Number(tahun) : null},
        ${file_name}, ${blob_path}, ${blob_url}, ${Number(file_size) || 0}, ${mime_type}
      )
      RETURNING id, nama_buku, mapel, kelas, penerbit, tahun, file_name, blob_path, blob_url, file_size, created_at
    `;

    return Response.json({ status: 'success', book: rows[0] });
  } catch (error) {
    console.error('Book register error:', error);
    return Response.json(
      { status: 'error', error: error instanceof Error ? error.message : 'Gagal menyimpan metadata buku.' },
      { status: 500 }
    );
  }
}
