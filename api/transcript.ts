// ═══════════════════════════════════════════════════
// SECTION 1: IMPORTS
// ═══════════════════════════════════════════════════
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { YoutubeTranscript } from 'youtube-transcript';

// ═══════════════════════════════════════════════════
// SECTION 2: TYPES
// ═══════════════════════════════════════════════════
// Shape of one transcript line returned by youtube-transcript.
// We re-export a cleaner shape for our app.
type TranscriptLine = {
  text: string;        // "Hello, today we'll learn about strings"
  offset: number;      // milliseconds from start (when this line begins)
  duration: number;    // milliseconds (how long this line is shown)
};

// ═══════════════════════════════════════════════════
// SECTION 3: CORS HEADERS
// ═══════════════════════════════════════════════════
// Reusable helper — applied to every response
function setCorsHeaders(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ═══════════════════════════════════════════════════
// SECTION 4: HANDLER
// ═══════════════════════════════════════════════════
// Endpoint:  POST /api/transcript
// Body:      { youtubeId: "dQw4w9WgXcQ" }
// Returns:   { success: true, transcript: TranscriptLine[], duration: number }
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);

  // Handle preflight (browsers send OPTIONS before POST for CORS)
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only accept POST
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed. Use POST.',
    });
  }

  // ── Parse body ──
  const { youtubeId } = req.body ?? {};

  if (!youtubeId || typeof youtubeId !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'Missing or invalid youtubeId in request body.',
    });
  }

  // ── Fetch transcript ──
  try {
    const rawTranscript = await YoutubeTranscript.fetchTranscript(youtubeId);

    if (!rawTranscript || rawTranscript.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No transcript available for this video.',
      });
    }

    // Normalize shape (youtube-transcript uses slightly different field names)
    const transcript: TranscriptLine[] = rawTranscript.map((line: any) => ({
      text: line.text,
      offset: line.offset,
      duration: line.duration,
    }));

    // Total duration of the video (last line's offset + duration, in ms → seconds)
    const lastLine = transcript[transcript.length - 1];
    const totalDurationSeconds = Math.round((lastLine.offset + lastLine.duration) / 1000);

    return res.status(200).json({
      success: true,
      youtubeId,
      transcript,
      lineCount: transcript.length,
      durationSeconds: totalDurationSeconds,
    });
  } catch (err: any) {
    // Common reasons: video is private, transcripts disabled, video doesn't exist
    console.error('Transcript fetch error:', err);
    return res.status(500).json({
      success: false,
      error: err?.message || 'Failed to fetch transcript. Video may not have captions.',
    });
  }
}