// ═══════════════════════════════════════════════════
// SECTION 1: TYPES
// ═══════════════════════════════════════════════════
export type TranscriptLine = {
  text: string;
  offset: number;     // milliseconds from start
  duration: number;   // milliseconds
};

export type TranscriptResult = {
  youtubeId: string;
  transcript: TranscriptLine[];
  lineCount: number;
  durationSeconds: number;
  fullText: string;
};

// ═══════════════════════════════════════════════════
// SECTION 2: FETCH TRANSCRIPT VIA SUPADATA
// ═══════════════════════════════════════════════════
// Supadata is a paid service that handles YouTube transcript fetching
// reliably from cloud servers (where direct YouTube scraping is blocked).
//
// Free tier: 100 credits/month. Each transcript fetch = 1 credit.
// We CACHE results in Firebase so each unique video uses only 1 credit ever.
//
// Docs: https://docs.supadata.ai/youtube/transcript
export async function fetchTranscript(youtubeId: string): Promise<TranscriptResult> {
  if (!youtubeId || typeof youtubeId !== 'string') {
    throw new Error('Invalid youtubeId');
  }

  const apiKey = process.env.SUPADATA_API_KEY;
  if (!apiKey) {
    throw new Error('SUPADATA_API_KEY not configured on server.');
  }

  // Call Supadata's transcript endpoint
  // Query params:
  //   - videoId: the YouTube video ID
  //   - text=true: returns parsed segments with timestamps
  const url = `https://api.supadata.ai/v1/youtube/transcript?videoId=${encodeURIComponent(youtubeId)}&text=false`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'x-api-key': apiKey,
    },
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    if (response.status === 404) {
      throw new Error(
        "This video doesn't have captions available. Try another video!",
      );
    }
    if (response.status === 429) {
      throw new Error(
        'Quiz service is busy right now. Try again in a moment.',
      );
    }
    throw new Error(
      `Transcript service error (${response.status}): ${errBody.slice(0, 200)}`,
    );
  }

  const data = await response.json();

  // Supadata returns: { content: [{ text, offset, duration, lang }], lang, availableLangs }
  const segments = data.content;
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error("This video doesn't have captions available.");
  }

  // Normalize to our shape
  // Supadata returns offset/duration already in milliseconds
  const transcript: TranscriptLine[] = segments
    .filter((seg: any) => seg && seg.text && String(seg.text).trim().length > 0)
    .map((seg: any) => ({
      text: String(seg.text).trim(),
      offset: Math.round(Number(seg.offset) || 0),
      duration: Math.round(Number(seg.duration) || 0),
    }));

  if (transcript.length === 0) {
    throw new Error('Captions exist but appear empty for this video.');
  }

  const lastLine = transcript[transcript.length - 1];
  const durationSeconds = Math.round(
    (lastLine.offset + lastLine.duration) / 1000,
  );

  // Vercel free tier 10-sec function timeout — bail for very long videos
  if (durationSeconds > 1800) {
    throw new Error(
      'This video is too long for quizzes right now. Try a video under 30 minutes!',
    );
  }

  const fullText = transcript.map((l) => l.text).join(' ');

  return {
    youtubeId,
    transcript,
    lineCount: transcript.length,
    durationSeconds,
    fullText,
  };
}

// ═══════════════════════════════════════════════════
// SECTION 3: COMPUTE CHECKPOINTS BY VIDEO LENGTH
// ═══════════════════════════════════════════════════
export type Checkpoint = {
  timestampSeconds: number;
  questionCount: number;
};

export function computeCheckpoints(durationSeconds: number): Checkpoint[] {
  if (durationSeconds < 300) {
    return [
      { timestampSeconds: Math.floor(durationSeconds * 0.6), questionCount: 3 },
    ];
  }

  if (durationSeconds < 900) {
    return [
      { timestampSeconds: Math.floor(durationSeconds * 0.33), questionCount: 4 },
      { timestampSeconds: Math.floor(durationSeconds * 0.66), questionCount: 4 },
    ];
  }

  return [
    { timestampSeconds: Math.floor(durationSeconds * 0.25), questionCount: 3 },
    { timestampSeconds: Math.floor(durationSeconds * 0.50), questionCount: 3 },
    { timestampSeconds: Math.floor(durationSeconds * 0.75), questionCount: 3 },
  ];
}

// ═══════════════════════════════════════════════════
// SECTION 4: SPLIT TRANSCRIPT BY CHECKPOINT
// ═══════════════════════════════════════════════════
export function splitTranscriptForCheckpoints(
  transcript: TranscriptLine[],
  checkpoints: Checkpoint[],
): string[] {
  return checkpoints.map((cp) => {
    const cutoffMs = cp.timestampSeconds * 1000;
    const linesBeforeCheckpoint = transcript.filter(
      (line) => line.offset <= cutoffMs,
    );
    return linesBeforeCheckpoint.map((l) => l.text).join(' ');
  });
}