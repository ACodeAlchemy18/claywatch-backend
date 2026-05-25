// ═══════════════════════════════════════════════════
// SECTION 1: IMPORTS
// ═══════════════════════════════════════════════════
import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';

// ═══════════════════════════════════════════════════
// SECTION 2: TYPES
// ═══════════════════════════════════════════════════
type ChatMessage = {
  role: 'user' | 'assistant';
  text: string;
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
// SECTION 4: SYSTEM PROMPT
// ═══════════════════════════════════════════════════
// This defines Sparky's personality and rules.
// Sparky is warm, patient, encouraging, never condescending.
function buildSystemPrompt(
  ageGroup: string,
  videoTitle: string,
  questionText: string,
  options: string[],
  correctIndex: number,
  kidSelectedIndex: number,
): string {
  const correctAnswer = options[correctIndex];
  const wrongAnswer = options[kidSelectedIndex];

  return `You are Sparky, a warm and patient AI fox tutor on a kids' learning app called ClayWatch. You're talking to a kid in the ${ageGroup} age group.

The kid just watched a video called "${videoTitle}" and answered a quiz question wrong. Now they want to understand WHY.

THE QUIZ QUESTION WAS:
"${questionText}"

OPTIONS WERE:
${options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join('\n')}

CORRECT ANSWER: ${String.fromCharCode(65 + correctIndex)}. "${correctAnswer}"
THE KID PICKED: "${wrongAnswer}"

YOUR PERSONALITY:
- You are kind, patient, and encouraging — never condescending
- You use simple language a ${ageGroup} year old can easily understand
- You give short, focused answers (2-4 sentences max)
- You sometimes use 🦊 emoji and warm phrases like "great question!" "pawsome thinking!" "good catch!"
- You NEVER make the kid feel bad for being wrong — wrong answers are how we learn

YOUR JOB:
- Help the kid understand WHY the correct answer is right and theirs was wrong
- If they ask follow-up questions, answer them in the same warm tone
- Stay focused on the video topic — gently redirect if they go off-topic
- If they ask something you don't know from the video, say "Great curiosity! That wasn't in the video, but maybe you can ask your parent or teacher!"

Respond to the kid's messages in 2-4 short sentences. Use simple words. Be warm. 🦊`;
}

// ═══════════════════════════════════════════════════
// SECTION 5: HANDLER
// ═══════════════════════════════════════════════════
// POST /api/explain
// Body: {
//   ageGroup: '6-8',
//   videoTitle: 'Why is the sky blue?',
//   questionText: '...',
//   options: ['A', 'B', 'C', 'D'],
//   correctIndex: 2,
//   kidSelectedIndex: 0,
//   chatHistory: [{ role: 'user', text: '...' }, { role: 'assistant', text: '...' }]
// }
// Returns: { success: true, reply: '...' }
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed.' });
  }

  const {
    ageGroup = '6-8',
    videoTitle = 'the video',
    questionText,
    options,
    correctIndex,
    kidSelectedIndex,
    chatHistory = [],
  } = req.body ?? {};

  if (
    !questionText ||
    !Array.isArray(options) ||
    options.length !== 4 ||
    typeof correctIndex !== 'number' ||
    typeof kidSelectedIndex !== 'number'
  ) {
    return res.status(400).json({
      success: false,
      error: 'Missing or invalid quiz context.',
    });
  }

  if (!Array.isArray(chatHistory) || chatHistory.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'No chat messages to respond to.',
    });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({
      success: false,
      error: 'ANTHROPIC_API_KEY not configured on server.',
    });
  }

  try {
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    // Map our chat history to Claude's expected format
    const messages = chatHistory.map((m: ChatMessage) => ({
      role: m.role,
      content: m.text,
    }));

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 512,
      system: buildSystemPrompt(
        ageGroup,
        videoTitle,
        questionText,
        options,
        correctIndex,
        kidSelectedIndex,
      ),
      messages,
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('Sparky had no response.');
    }

    return res.status(200).json({
      success: true,
      reply: textBlock.text.trim(),
    });
  } catch (err: any) {
    console.error('Explain endpoint error:', err);
    return res.status(500).json({
      success: false,
      error: err?.message || "Sparky's having trouble explaining right now.",
    });
  }
}