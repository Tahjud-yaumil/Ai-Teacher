import { neon } from '@neondatabase/serverless';
import SchedulerPanel from './scheduler-panel';

async function getDatabaseStatus() {
  if (!process.env.DATABASE_URL) {
    return { connected: false, reason: 'DATABASE_URL belum tersedia di environment aplikasi.' };
  }

  try {
    const sql = neon(process.env.DATABASE_URL);
    const rows = await sql`
      SELECT
        (SELECT COUNT(*)::int FROM jadwal) AS jadwal,
        (SELECT COUNT(*)::int FROM progress) AS progress,
        (SELECT COUNT(*)::int FROM tasks) AS tasks,
        (SELECT COUNT(*)::int FROM documents) AS documents,
        (SELECT COUNT(*)::int FROM output_log) AS output_log
    `;
    return { connected: true, ...rows[0] };
  } catch (error) {
    return {
      connected: false,
      reason: error instanceof Error ? error.message : 'Database error',
    };
  }
}

export default async function Home() {
  const db = await getDatabaseStatus();

  return (
    <main style={{ minHeight: '100vh', background: '#0a0a0a', color: '#f5f5f5', padding: '48px 24px', fontFamily: 'Arial, sans-serif' }}>
      <section style={{ maxWidth: 980, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 20, marginBottom: 40 }}>
          <div>
            <p style={{ margin: 0, color: '#8b8b8b', fontSize: 14 }}>AI TEACHER</p>
            <h1 style={{ margin: '8px 0 0', fontSize: 40 }}>YaumiTeach</h1>
            <p style={{ color: '#a3a3a3', marginTop: 10 }}>Teaching workflow engine untuk guru MTs.</p>
          </div>
          <div style={{ border: '1px solid #262626', borderRadius: 999, padding: '10px 14px', fontSize: 13 }}>
            {db.connected ? 'Database: Connected' : 'Database: Not Connected'}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
          {[
            ['Jadwal', db.jadwal ?? 0],
            ['Progress', db.progress ?? 0],
            ['Tasks', db.tasks ?? 0],
            ['Documents', db.documents ?? 0],
            ['Output Log', db.output_log ?? 0],
          ].map(([label, value]) => (
            <div key={label} style={{ border: '1px solid #262626', background: '#111', borderRadius: 16, padding: 20 }}>
              <div style={{ color: '#8b8b8b', fontSize: 13 }}>{label}</div>
              <div style={{ fontSize: 32, marginTop: 8, fontWeight: 700 }}>{value}</div>
            </div>
          ))}
        </div>

        {!db.connected && (
          <div style={{ marginTop: 20, padding: 18, borderRadius: 14, border: '1px solid #3a2020', background: '#160c0c', color: '#ffb4b4' }}>
            {db.reason}
          </div>
        )}

        <div style={{ marginTop: 32, border: '1px solid #262626', background: '#111', borderRadius: 16, padding: 24 }}>
          <h2 style={{ marginTop: 0 }}>Workflow</h2>
          <p style={{ color: '#a3a3a3', lineHeight: 1.7 }}>
            Scheduler → Progress Manager → Book Reader → Content Generator → Quality Reviewer → Publisher → Telegram.
          </p>
        </div>

        <SchedulerPanel />
      </section>
    </main>
  );
}
