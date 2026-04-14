import { runClustering } from '../../backend/engine/clusterer.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify CRON_SECRET — Vercel sends: Authorization: Bearer <CRON_SECRET>
  const authHeader = req.headers.authorization ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token || token !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const stats = await runClustering();
    return res.json({ ok: true, ...stats, date: new Date().toISOString().slice(0, 10) });
  } catch (err) {
    console.error('[cron/cluster]', err.message);
    return res.status(500).json({ error: 'Clustering failed', message: err.message });
  }
}
