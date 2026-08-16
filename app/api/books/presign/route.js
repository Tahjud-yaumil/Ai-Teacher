import { issueSignedToken, presignUrl } from '@vercel/blob';

export const runtime = 'nodejs';

const MAX_SIZE = 100 * 1024 * 1024;

function safeSegment(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120) || 'file';
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const filename = safeSegment(body.filename);
    const mapel = safeSegment(body.mapel);
    const kelas = safeSegment(body.kelas);
    const size = Number(body.size || 0);
    const contentType = String(body.contentType || 'application/pdf');

    if (!filename.toLowerCase().endsWith('.pdf') || contentType !== 'application/pdf') {
      return Response.json({ error: 'File harus berupa PDF.' }, { status: 400 });
    }

    if (!size || size > MAX_SIZE) {
      return Response.json({ error: 'Ukuran PDF maksimal 100 MB.' }, { status: 400 });
    }

    const token = await issueSignedToken({
      operations: ['put'],
      allowedContentTypes: ['application/pdf'],
      maximumSizeInBytes: MAX_SIZE,
    });

    const pathname = `books/${mapel}/${kelas}/${Date.now()}-${filename}`;

    const { presignedUrl, validUntil } = await presignUrl(token, {
      pathname,
      operation: 'put',
      validUntil: Date.now() + 15 * 60 * 1000,
    });

    return Response.json({
      pathname,
      presignedUrl,
      validUntil,
      contentType,
      maxSize: MAX_SIZE,
    });
  } catch (error) {
    console.error('Book presign error:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Gagal membuat upload URL.' },
      { status: 500 }
    );
  }
}
