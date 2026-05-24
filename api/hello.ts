// ═══════════════════════════════════════════════════
// SECTION 1: IMPORTS
// ═══════════════════════════════════════════════════
import type { VercelRequest, VercelResponse } from '@vercel/node';

// ═══════════════════════════════════════════════════
// SECTION 2: HANDLER
// ═══════════════════════════════════════════════════
// Vercel serverless function signature:
//   - req: incoming HTTP request
//   - res: outgoing HTTP response
// File location:  api/hello.ts  →  endpoint:  /api/hello
export default function handler(req: VercelRequest, res: VercelResponse) {
  // CORS — allow our React Native app (web + mobile) to call this
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Reply
  return res.status(200).json({
    success: true,
    message: 'Sparky is awake! 🦊',
    timestamp: new Date().toISOString(),
  });
}