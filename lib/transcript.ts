// ═══════════════════════════════════════════════════
// SECTION 1: IMPORTS
// ═══════════════════════════════════════════════════
import { getSubtitles } from 'youtube-caption-extractor';

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
// youtube-caption-extractor is actively maintained and handles
// auto-generated captions properly (unlike older libraries).
export async function fetchTranscript(youtubeId: string): Promise<TranscriptResult> {
  if (!youtubeId || typeof youtubeId !== 'string') {
    throw new Error('Invalid youtubeId');
  }

  let raw: any[] | null = null;
  let lastError: any = null;

  // Try English (manual first, auto-generated fallback is automatic in this lib)
  try {
    raw = await getSubtitles({ videoID: youtubeId, lang: 'en' });
  } catch (err) {
    lastError = err;
  }

  // If nothing came back, try without specifying lang (gets video's primary lang)
  if (!raw || raw.length === 0) {
    try {
      raw = await getSubtitles({ videoID: youtubeId, lang: '' });
    } catch (err) {
      lastError = err;
    }
  }

  if (!raw || raw.length === 0) {
    throw new Error(
      "This video doesn't have captions available. Sparky needs captions to make quizzes! Try another video.",
    );
  }

  // Library shape: { start: string, dur: string, text: string }
  const transcript: TranscriptLine[] = raw
    .filter((line: any) => line && line.text && String(line.text).trim().length > 0)
    .map((line: any) => ({
      text: String(line.text).trim(),
      offset: Math.round(parseFloat(line.start || '0') * 1000),
      duration: Math.round(parseFloat(line.dur || '0') * 1000),
    }));

  if (transcript.length === 0) {
    throw new Error('Captions exist but appear empty for this video.');
  }

  const lastLine = transcript[transcript.length - 1];
  const durationSeconds = Math.round(
    (lastLine.offset + lastLine.duration) / 1000,
  );

  // Bail out for very long videos (Vercel 10s function timeout)
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