export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

function cleanDate(value) {
  const s = String(value || '');
  const m = s.match(/\b(20\d{2})[-/](\d{2})[-/](\d{2})\b/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(value);
  if (!Number.isNaN(d.getTime())) {
    const y = d.getUTCFullYear(); const mo = String(d.getUTCMonth() + 1).padStart(2, '0'); const da = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${mo}-${da}`;
  }
  return s || new Date().toISOString().slice(0, 10);
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const proto = request.headers.get('x-forwarded-proto');
    const host = request.headers.get('host');
    const origin = proto && host ? `${proto}://${host}` : `https://${process.env.VERCEL_URL}`;
    const tanggal = cleanDate(body?.tanggal || new Date().toISOString().slice(0, 10));
    const qs = new URLSearchParams({ tanggal });
    if (body?.task_id) qs.set('task_id', String(body.task_id));
    const response = await fetch(`${origin}/api/content-generator-v3?${qs.toString()}&run=${Date.now()}`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'cache-control': 'no-cache' },
      body: JSON.stringify({ tanggal, task_id: body?.task_id || null }), cache: 'no-store'
    });
    const data = await response.json();
    return Response.json(data, { status: response.status });
  } catch (error) {
    return Response.json({ agent: 'content_generator', status: 'error', reason: error instanceof Error ? error.message : 'Content Generator gagal.' }, { status: 500 });
  }
}
