// ═══════════════════════════════════════════════════
// SECTION 1: IMPORTS
// ═══════════════════════════════════════════════════
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { fetchTranscript } from '../lib/transcript';

// ═══════════════════════════════════════════════════
// SECTION 2: CORS HEADERS
// ═══════════════════════════════════════════════════
function setCorsHeaders(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ═══════════════════════════════════════════════════
// SECTION 3: HANDLER
// ═══════════════════════════════════════════════════
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed.' });
  }

  const { youtubeId } = req.body ?? {};

  try {
    const result = await fetchTranscript(youtubeId);
    return res.status(200).json({ success: true, ...result });
  } catch (err: any) {
    console.error('Transcript fetch error:', err);
    return res.status(500).json({
      success: false,
      error: err?.message || 'Failed to fetch transcript.',
    });
  }
}