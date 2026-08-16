import { handleUpload } from '@vercel/blob/client';
import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';

function getSql() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL belum tersedia.');
  return neon(process.env.DATABASE_URL);
}

export async function POST(request) {
  try {
    const sql = getSql();
    const body = await request.json();

    const response = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async () => {
        return {
          allowedContentTypes: ['application/pdf'],
          addRandomSuffix: true,
          maximumSizeInBytes: 100 * 1024 * 1024,
          tokenPayload: JSON.stringify({ source: 'yaumiteach-books' }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        const metadata = tokenPayload ? JSON.parse(tokenPayload) : {};
        const sqlInner = getSql();

        await sqlInner`
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

        // Metadata is finalized by /api/books/register after the client upload.
        console.log('Book upload completed:', {
          pathname: blob.pathname,
          url: blob.url,
          source: metadata.source || 'unknown',
        });
      },
    });

    return Response.json(response);
  } catch (error) {
    console.error('Book upload error:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Upload gagal.' },
      { status: 500 }
    );
  }
}
