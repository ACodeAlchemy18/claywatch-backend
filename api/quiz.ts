// ═══════════════════════════════════════════════════
// SECTION 1: IMPORTS
// ═══════════════════════════════════════════════════
import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';
import {
  fetchTranscript,
  computeCheckpoints,
  splitTranscriptForCheckpoints,
  Checkpoint,
} from '../lib/transcript';

// ═══════════════════════════════════════════════════
// SECTION 2: TYPES — shape of quiz data returned to ClayWatch app
// ═══════════════════════════════════════════════════
type QuizQuestion = {
  question: string;
  options: string[];        // 4 options
  correctIndex: number;     // 0-3
  explanation: string;      // shown when wrong — Sparky explains why
};

type QuizCheckpoint = {
  timestampSeconds: number;
  questions: QuizQuestion[];
};

type QuizResult = {
  youtubeId: string;
  durationSeconds: number;
  checkpoints: QuizCheckpoint[];
};

// ═══════════════════════════════════════════════════
// SECTION 3: CORS
// ═══════════════════════════════════════════════════
function setCorsHeaders(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ═══════════════════════════════════════════════════
// SECTION 4: CLAUDE PROMPT — the heart of Sparky
// ═══════════════════════════════════════════════════
// Carefully written to:
//   - Force a strict JSON output (no preamble, no markdown)
//   - Match the kid's age range
//   - Be educational, not nitpicky
//   - Always have 4 options with exactly 1 correct
//   - Include a Sparky-style explanation for the correct answer
//////

function buildPrompt(transcriptSection: string, questionCount: number, ageGroup: string, checkpointIdx: number, totalCheckpoints: number): string {
  // Vary the question style per checkpoint so questions feel different
  const styleHints = [
    'Focus on the MAIN IDEA and key concepts.',
    'Focus on SPECIFIC DETAILS, names, or numbers mentioned.',
    'Focus on WHY things happen, cause-and-effect, or relationships.',
  ];
  const styleHint = styleHints[checkpointIdx % styleHints.length];

  return `You are Sparky, a friendly AI fox tutor for kids on a learning app called ClayWatch.

A kid (age group: ${ageGroup}) just watched part ${checkpointIdx + 1} of ${totalCheckpoints} of an educational video. Generate ${questionCount} multiple-choice quiz questions that test their understanding of the content below.

CONTENT THE KID WATCHED:
"""
${transcriptSection}
"""

REQUIREMENTS:
1. Each question must be based ONLY on the content above
2. Each question has exactly 4 answer options
3. Exactly 1 option is correct (others are plausible but clearly wrong distractors)
4. Use kid-friendly language appropriate for ${ageGroup} years old
5. For each correct answer, include a warm Sparky-style explanation (1-2 sentences) — like a fox tutor encouraging the kid
6. ${styleHint}
7. Make each question UNIQUELY different — no two questions should test the same fact or use similar phrasing
8. Avoid questions that are too obvious or too obscure
9. Questions should test UNDERSTANDING, not memorization of trivia

OUTPUT FORMAT: Reply with ONLY a JSON array, nothing else. No markdown, no preamble. Exactly this shape:

[
  {
    "question": "What did the video say about X?",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "correctIndex": 2,
    "explanation": "Great thinking! The video showed that... 🦊"
  }
]

Generate ${questionCount} questions now:`;
}
// ═══════════════════════════════════════════════════
// SECTION 5: CALL CLAUDE
// ═══════════════════════════════════════════════════
async function generateQuestionsForSection(
  anthropic: Anthropic,
  transcriptSection: string,
  questionCount: number,
  ageGroup: string,
  checkpointIdx: number,
  totalCheckpoints: number,
): Promise<QuizQuestion[]> {
  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: buildPrompt(transcriptSection, questionCount, ageGroup, checkpointIdx, totalCheckpoints),
      },
    ],
  });

  // Claude returns a content array — get the text block
  const textBlock = message.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Claude returned no text content.');
  }

  // Parse JSON — Claude sometimes wraps in ```json fences despite instructions
  let raw = textBlock.text.trim();
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');

  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('Claude did not return an array.');
  }

  // Light validation
  return parsed.map((q: any, idx: number) => {
    if (
      typeof q.question !== 'string' ||
      !Array.isArray(q.options) ||
      q.options.length !== 4 ||
      typeof q.correctIndex !== 'number' ||
      q.correctIndex < 0 ||
      q.correctIndex > 3 ||
      typeof q.explanation !== 'string'
    ) {
      throw new Error(`Question ${idx + 1} is malformed.`);
    }
    return q as QuizQuestion;
  });
}

// ═══════════════════════════════════════════════════
// SECTION 6: HANDLER
// ═══════════════════════════════════════════════════
// POST /api/quiz
// Body:    { youtubeId: string, ageGroup?: '3-5' | '6-8' | '9-12' }
// Returns: QuizResult
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed.' });
  }

  const { youtubeId, ageGroup = '6-8' } = req.body ?? {};

  if (!youtubeId || typeof youtubeId !== 'string') {
    return res.status(400).json({ success: false, error: 'Missing youtubeId.' });
  }

  // Check API key exists (helpful error message during dev)
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({
      success: false,
      error: 'ANTHROPIC_API_KEY not configured on server.',
    });
  }

  try {
    // 1. Fetch transcript
    const transcriptResult = await fetchTranscript(youtubeId);

    // 2. Compute checkpoints based on video length
    const checkpoints: Checkpoint[] = computeCheckpoints(
      transcriptResult.durationSeconds,
    );

    // 3. Split transcript so each checkpoint only sees content up to its timestamp
    const sections = splitTranscriptForCheckpoints(
      transcriptResult.transcript,
      checkpoints,
    );

    // 4. Generate quizzes for each section, in parallel for speed
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const questionLists = await Promise.all(
  sections.map((section, i) =>
    generateQuestionsForSection(
      anthropic,
      section,
      checkpoints[i].questionCount,
      ageGroup,
      i,
      checkpoints.length,
    ),
  ),
);

    // 5. Build the response
    const quizCheckpoints: QuizCheckpoint[] = checkpoints.map((cp, i) => ({
      timestampSeconds: cp.timestampSeconds,
      questions: questionLists[i],
    }));

    const result: QuizResult = {
      youtubeId,
      durationSeconds: transcriptResult.durationSeconds,
      checkpoints: quizCheckpoints,
    };

    return res.status(200).json({ success: true, ...result });
  } catch (err: any) {
    console.error('Quiz generation error:', err);
    return res.status(500).json({
      success: false,
      error: err?.message || 'Failed to generate quizzes.',
    });
  }
}