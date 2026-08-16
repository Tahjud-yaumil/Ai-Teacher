import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';

function getSql() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL belum tersedia.');
  return neon(process.env.DATABASE_URL);
}

export async function GET() {
  try {
    const sql = getSql();
    const rows = await sql`
      SELECT id, nama_buku, mapel, kelas, penerbit, tahun,
             file_name, blob_path, file_size, mime_type,
             aktif, created_at
      FROM books
      WHERE aktif = TRUE
      ORDER BY mapel, kelas, nama_buku
    `;

    return Response.json({
      status: 'success',
      total: rows.length,
      books: rows,
    });
  } catch (error) {
    return Response.json(
      { status: 'error', error: error instanceof Error ? error.message : 'Gagal membaca daftar buku.' },
      { status: 500 }
    );
  }
}
