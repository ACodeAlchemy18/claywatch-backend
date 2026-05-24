// ═══════════════════════════════════════════════════
// SECTION 1: IMPORTS
// ═══════════════════════════════════════════════════
import { YoutubeTranscript } from 'youtube-transcript';

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
  fullText: string;   // entire transcript as one string (for Claude prompts)
};

// ═══════════════════════════════════════════════════
// SECTION 3: FETCH + NORMALIZE TRANSCRIPT
// ═══════════════════════════════════════════════════
// Wraps the youtube-transcript library with consistent error handling
// and shape. Used by both /api/transcript and /api/quiz.
export async function fetchTranscript(youtubeId: string): Promise<TranscriptResult> {
  if (!youtubeId || typeof youtubeId !== 'string') {
    throw new Error('Invalid youtubeId');
  }

  const raw = await YoutubeTranscript.fetchTranscript(youtubeId);

  if (!raw || raw.length === 0) {
    throw new Error('No transcript available for this video.');
  }

  const transcript: TranscriptLine[] = raw.map((line: any) => ({
    text: line.text,
    offset: line.offset,
    duration: line.duration,
  }));

  const lastLine = transcript[transcript.length - 1];
  const durationSeconds = Math.round(
    (lastLine.offset + lastLine.duration) / 1000,
  );

  // Concatenate all text — Claude gets this as the "video content"
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
// Smart logic from your earlier choice:
//   < 5 min   → 1 checkpoint with 3 questions
//   5-15 min  → 2 checkpoints with 4 questions each
//   > 15 min  → 3 checkpoints with 3 questions each
//
// Returns the timestamps (in seconds) where the video should pause for quizzes,
// PLUS the number of questions to ask at each checkpoint.
export type Checkpoint = {
  timestampSeconds: number;   // when to pause
  questionCount: number;      // how many Qs to ask here
};

export function computeCheckpoints(durationSeconds: number): Checkpoint[] {
  if (durationSeconds < 300) {
    // Short: 1 checkpoint at 60% through, 3 questions
    return [
      { timestampSeconds: Math.floor(durationSeconds * 0.6), questionCount: 3 },
    ];
  }

  if (durationSeconds < 900) {
    // Medium: checkpoints at 33% and 66%, 4 questions each
    return [
      { timestampSeconds: Math.floor(durationSeconds * 0.33), questionCount: 4 },
      { timestampSeconds: Math.floor(durationSeconds * 0.66), questionCount: 4 },
    ];
  }

  // Long: checkpoints at 25%, 50%, 75%, 3 questions each
  return [
    { timestampSeconds: Math.floor(durationSeconds * 0.25), questionCount: 3 },
    { timestampSeconds: Math.floor(durationSeconds * 0.50), questionCount: 3 },
    { timestampSeconds: Math.floor(durationSeconds * 0.75), questionCount: 3 },
  ];
}

// ═══════════════════════════════════════════════════
// SECTION 5: SPLIT TRANSCRIPT BY CHECKPOINT
// ═══════════════════════════════════════════════════
// For each checkpoint, return the transcript text that comes BEFORE it.
// This way quiz questions only test content the kid has already watched.
//
// Returns:  array of strings (one per checkpoint, in order)
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