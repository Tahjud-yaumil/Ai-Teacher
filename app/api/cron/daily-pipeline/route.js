import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const env = (name) => typeof process.env[name] === 'string' ? process.env[name].trim() : '';

function jakartaDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
}

function authorized(request) {
  const secret = env('CRON_SECRET');
  if (!secret) return true;
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

async function call(origin, path, body) {
  const response = await fetch(`${origin}${path}?cron=${Date.now()}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cache-control': 'no-cache' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${path} HTTP ${response.status}: ${data?.reason || 'request gagal'}`);
  }
  return data;
}

export async function GET(request) {
  if (!authorized(request)) return new NextResponse('Unauthorized', { status: 401 });

  const date = jakartaDate();
  const origin = new URL(request.url).origin;
  const startedAt = Date.now();
  const steps = {};

  try {
    steps.scheduler = await call(origin, '/api/scheduler', { date });
    if (steps.scheduler?.status !== 'success' && steps.scheduler?.status !== 'no_schedule') {
      throw new Error(`Scheduler: ${steps.scheduler?.reason || 'gagal'}`);
    }

    if (steps.scheduler?.status === 'no_schedule') {
      return NextResponse.json({
        agent: 'daily_pipeline',
        status: 'no_schedule',
        tanggal: date,
        ai_used: false,
        steps,
        duration_ms: Date.now() - startedAt,
      });
    }

    steps.progress = await call(origin, '/api/progress', { tanggal: date });
    if (steps.progress?.status !== 'success' && steps.progress?.status !== 'no_tasks') {
      throw new Error(`Progress Manager: ${steps.progress?.reason || 'gagal'}`);
    }

    // Content Generator v4 performs the validated context extraction internally.
    // This keeps the daily cron within the single scheduled invocation while preserving
    // the current working Book Reader/Context Extractor endpoints for manual audit.
    steps.content_generator = await call(origin, '/api/content-generator-v4', { tanggal: date });
    if (steps.content_generator?.status !== 'success') {
      throw new Error(`Content Generator: ${steps.content_generator?.reason || 'gagal'}`);
    }

    const documents = (steps.content_generator.documents || []).filter((doc) => doc?.status === 'success');
    if (documents.length) {
      steps.publisher = await call(origin, '/api/publisher', {
        tanggal: date,
        documents,
        tasks: steps.scheduler.tasks || [],
      });
    } else {
      steps.publisher = { agent: 'publisher', status: 'skipped', reason: 'Tidak ada dokumen sukses untuk diterbitkan.' };
    }

    return NextResponse.json({
      agent: 'daily_pipeline',
      status: 'success',
      tanggal: date,
      timezone: 'Asia/Jakarta',
      ai_used: true,
      quality_review: 'skipped',
      steps,
      summary: {
        tasks: (steps.scheduler.tasks || []).length,
        documents_generated: documents.length,
        documents_sent: steps.publisher?.documents_sent || 0,
      },
      duration_ms: Date.now() - startedAt,
    });
  } catch (error) {
    console.error('Daily pipeline error:', error);
    return NextResponse.json({
      agent: 'daily_pipeline',
      status: 'error',
      tanggal: date,
      timezone: 'Asia/Jakarta',
      steps,
      reason: error instanceof Error ? error.message : 'Daily pipeline gagal.',
      duration_ms: Date.now() - startedAt,
    }, { status: 500 });
  }
}
