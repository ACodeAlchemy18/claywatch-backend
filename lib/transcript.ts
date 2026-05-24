// ═══════════════════════════════════════════════════
// SECTION 1: IMPORTS
// ═══════════════════════════════════════════════════
import { getSubtitles } from 'youtube-captions-scraper';

// ═══════════════════════════════════════════════════
// SECTION 2: TYPES
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
// SECTION 3: FETCH + NORMALIZE TRANSCRIPT
// ═══════════════════════════════════════════════════
// youtube-captions-scraper tries multiple lang codes to find captions.
// It handles auto-generated captions better than youtube-transcript.
export async function fetchTranscript(youtubeId: string): Promise<TranscriptResult> {
  if (!youtubeId || typeof youtubeId !== 'string') {
    throw new Error('Invalid youtubeId');
  }

  // Try English first, then other common langs as fallbacks
  const langsToTry = ['en', 'en-US', 'en-GB', 'a.en']; // 'a.en' = auto-generated English

  let raw: any[] | null = null;
  let lastError: any = null;

  for (const lang of langsToTry) {
    try {
      raw = await getSubtitles({ videoID: youtubeId, lang });
      if (raw && raw.length > 0) break;
    } catch (err) {
      lastError = err;
      // Try next lang
    }
  }

  if (!raw || raw.length === 0) {
    throw new Error(
      lastError?.message ||
        "This video doesn't have captions. Sparky needs captions to make quizzes!",
    );
  }

  // youtube-captions-scraper shape:
  //   { start: '0.16', dur: '4.32', text: 'hello world' }
  // Convert to our shape (milliseconds, normalized)
  const transcript: TranscriptLine[] = raw.map((line: any) => ({
    text: String(line.text || '').trim(),
    offset: Math.round(parseFloat(line.start || '0') * 1000),
    duration: Math.round(parseFloat(line.dur || '0') * 1000),
  }));

  const lastLine = transcript[transcript.length - 1];
  const durationSeconds = Math.round(
    (lastLine.offset + lastLine.duration) / 1000,
  );

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
// SECTION 4: COMPUTE CHECKPOINTS BY VIDEO LENGTH
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
// SECTION 5: SPLIT TRANSCRIPT BY CHECKPOINT
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