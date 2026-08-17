export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const env = (n) => typeof process.env[n] === 'string' ? process.env[n].trim() : '';

export async function GET(request) {
  try {
    const token = env('TELEGRAM_BOT_TOKEN');
    if (!token) return Response.json({ ok: false, reason: 'TELEGRAM_BOT_TOKEN belum tersedia.' }, { status: 500 });

    const url = new URL('/api/telegram/webhook', request.url).toString();
    const r = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url, allowed_updates: ['message'], drop_pending_updates: false }),
      cache: 'no-store'
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data?.ok !== true) {
      return Response.json({ ok: false, reason: data?.description || `HTTP ${r.status}`, webhook_url: url }, { status: 500 });
    }

    return Response.json({ ok: true, webhook_url: url, telegram: data.result });
  } catch (error) {
    return Response.json({ ok: false, reason: error instanceof Error ? error.message : 'Setup webhook gagal.' }, { status: 500 });
  }
}
