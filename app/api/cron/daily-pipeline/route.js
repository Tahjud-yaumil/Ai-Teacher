import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const env = (name) => typeof process.env[name] === 'string' ? process.env[name].trim() : '';
const sqlDb = () => { const url = env('DATABASE_URL'); if (!url) throw new Error('DATABASE_URL belum tersedia.'); return neon(url); };

function jakartaDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
}

function authorized(request) {
  const secret = env('CRON_SECRET');
  if (!secret) return true;
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

async function ensureRunTable(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS pipeline_runs (
      tanggal DATE PRIMARY KEY,
      status TEXT NOT NULL,
      tasks JSONB,
      documents JSONB,
      publisher JSONB,
      reason TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

async function saveRun(sql, { date, status, tasks = [], documents = [], publisher = null, reason = null }) {
  await ensureRunTable(sql);
  await sql`
    INSERT INTO pipeline_runs (tanggal, status, tasks, documents, publisher, reason, updated_at)
    VALUES (${date}, ${status}, ${JSON.stringify(tasks)}::jsonb, ${JSON.stringify(documents)}::jsonb, ${publisher ? JSON.stringify(publisher) : null}::jsonb, ${reason}, NOW())
    ON CONFLICT (tanggal) DO UPDATE SET
      status = EXCLUDED.status,
      tasks = EXCLUDED.tasks,
      documents = EXCLUDED.documents,
      publisher = EXCLUDED.publisher,
      reason = EXCLUDED.reason,
      updated_at = NOW()
  `;
}

async function call(origin, path, body) {
  const secret = env('CRON_SECRET');
  const headers = { 'content-type': 'application/json', 'cache-control': 'no-cache' };
  if (secret) headers.authorization = `Bearer ${secret}`;
  const response = await fetch(`${origin}${path}?cron=${Date.now()}`, {
    method: 'POST',
    headers,
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
  const sql = sqlDb();

  try {
    await ensureRunTable(sql);
    steps.scheduler = await call(origin, '/api/scheduler', { date });
    if (steps.scheduler?.status !== 'success' && steps.scheduler?.status !== 'no_schedule') {
      throw new Error(`Scheduler: ${steps.scheduler?.reason || 'gagal'}`);
    }

    if (steps.scheduler?.status === 'no_schedule') {
      await saveRun(sql, { date, status: 'no_schedule', tasks: [] });
      return NextResponse.json({
        agent: 'daily_pipeline', status: 'no_schedule', tanggal: date,
        ai_used: false, steps, duration_ms: Date.now() - startedAt,
      });
    }

    steps.progress = await call(origin, '/api/progress', { tanggal: date });
    if (steps.progress?.status !== 'success' && steps.progress?.status !== 'no_tasks') {
      throw new Error(`Progress Manager: ${steps.progress?.reason || 'gagal'}`);
    }

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

    await saveRun(sql, {
      date,
      status: steps.publisher?.status === 'success' ? 'success' : 'error',
      tasks: steps.scheduler.tasks || [],
      documents,
      publisher: steps.publisher,
      reason: steps.publisher?.status === 'success' ? null : (steps.publisher?.reason || 'Publisher gagal.'),
    });

    return NextResponse.json({
      agent: 'daily_pipeline', status: 'success', tanggal: date, timezone: 'Asia/Jakarta',
      ai_used: true, quality_review: 'skipped', steps,
      summary: {
        tasks: (steps.scheduler.tasks || []).length,
        documents_generated: documents.length,
        documents_sent: steps.publisher?.documents_sent || 0,
      },
      duration_ms: Date.now() - startedAt,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Daily pipeline gagal.';
    console.error('Daily pipeline error:', error);
    try {
      await saveRun(sql, {
        date,
        status: 'error',
        tasks: steps.scheduler?.tasks || [],
        documents: steps.content_generator?.documents || [],
        publisher: steps.publisher || null,
        reason,
      });
    } catch (persistError) {
      console.error('Pipeline run persistence error:', persistError);
    }
    return NextResponse.json({
      agent: 'daily_pipeline', status: 'error', tanggal: date,
      timezone: 'Asia/Jakarta', steps, reason,
      duration_ms: Date.now() - startedAt,
    }, { status: 500 });
  }
}
