import config from '../../config';
import { Command, CommandCategory } from '../../types';
import aiService from '../../services/ai-service';

type Challenge = {
  type: string;
  answer: string;
  acceptedAnswers: string[];
  ownerJid: string;
};

const challenges = new Map<string, Challenge>();

const fallbackTrivia = [
  { question: 'What planet is known as the Red Planet?', answer: 'mars', choices: ['Mars', 'Venus', 'Jupiter', 'Mercury'] },
  { question: 'How many days are in a leap year?', answer: '366', choices: ['366', '365', '364', '367'] },
  { question: 'What gas do plants absorb from the atmosphere?', answer: 'carbon dioxide', choices: ['Carbon dioxide', 'Oxygen', 'Nitrogen', 'Helium'] },
  { question: 'What is the capital of Japan?', answer: 'tokyo', choices: ['Tokyo', 'Kyoto', 'Osaka', 'Nagoya'] },
  { question: 'Which ocean is the largest on Earth?', answer: 'pacific ocean', choices: ['Pacific Ocean', 'Atlantic Ocean', 'Indian Ocean', 'Arctic Ocean'] },
  { question: 'What is the chemical symbol for Gold?', answer: 'au', choices: ['Au', 'Ag', 'Fe', 'Cu'] },
  { question: 'Who painted the Mona Lisa?', answer: 'leonardo da vinci', choices: ['Leonardo da Vinci', 'Vincent van Gogh', 'Pablo Picasso', 'Michelangelo'] },
];

const fallbackWords = [
  'typescript', 'javascript', 'whatsapp', 'dashboard', 'developer',
  'astronomy', 'chocolate', 'adventure', 'algorithm', 'cybersecurity',
  'galaxy', 'pyramid', 'volcano', 'orchestra', 'butterfly', 'dinosaur',
];

function decodeHtml(html: string): string {
  const map: Record<string, string> = {
    '&quot;': '"',
    '&#039;': "'",
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&eacute;': 'é',
    '&uuml;': 'ü',
    '&ntilde;': 'ñ',
    '&ouml;': 'ö',
    '&aacute;': 'á',
    '&iacute;': 'í',
    '&oacute;': 'ó',
    '&uacute;': 'ú',
  };
  return html.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match) => map[match.toLowerCase()] || match);
}

function chatId(ctx: Parameters<Command['execute']>[0]): string {
  return ctx.message.key.remoteJid || 'unknown';
}

function senderJid(ctx: Parameters<Command['execute']>[0]): string {
  return ctx.message.key.participant || ctx.sender.jid || ctx.message.key.remoteJid || 'unknown';
}

function setChallenge(ctx: Parameters<Command['execute']>[0], challenge: Challenge): void {
  challenges.set(chatId(ctx), challenge);
}

async function canStopChallenge(ctx: Parameters<Command['execute']>[0], challenge: Challenge): Promise<boolean> {
  const sender = senderJid(ctx);
  const owner = config.OWNER_NUMBER?.replace(/\D/g, '');
  if (sender === challenge.ownerJid || ctx.sender.fromMe || (owner && sender.startsWith(owner))) return true;

  const jid = ctx.message.key.remoteJid;
  if (!jid?.endsWith('@g.us')) return false;

  const group = await ctx.socket.groupMetadata(jid);
  const participant = group.participants.find((member) => member.id === sender);
  return Boolean(participant?.admin || participant?.isAdmin || participant?.isSuperAdmin);
}

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function shuffle<T>(array: T[]): T[] {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function scramble(word: string): string {
  return word
    .split('')
    .sort(() => Math.random() - 0.5)
    .join('')
    .toUpperCase();
}

export const MathQuizCommand: Command = {
  name: 'mathquiz',
  aliases: ['mathgame'],
  category: CommandCategory.FUN,
  description: 'Start a fast math calculation quiz',
  usage: 'mathquiz',
  async execute(ctx) {
    const ops = ['+', '-', '*'];
    const op = pick(ops);
    let a = Math.floor(Math.random() * 25) + 1;
    let b = Math.floor(Math.random() * 25) + 1;

    let ans = a + b;
    if (op === '-') {
      if (a < b) [a, b] = [b, a];
      ans = a - b;
    } else if (op === '*') {
      a = Math.floor(Math.random() * 12) + 2;
      b = Math.floor(Math.random() * 12) + 2;
      ans = a * b;
    }

    setChallenge(ctx, {
      type: 'math',
      answer: String(ans),
      acceptedAnswers: [String(ans)],
      ownerJid: senderJid(ctx),
    });

    await ctx.reply(`🔢 *MATH QUIZ*\n\n*${a} ${op} ${b} = ?*\n\n👉 Answer with: *.answer <number>*\n⏭️ Stop with: *.skipquiz*`);
  },
};

export const TriviaCommand: Command = {
  name: 'trivia',
  aliases: ['quiz'],
  category: CommandCategory.FUN,
  description: 'Start a live trivia quiz with multiple choice options',
  usage: 'trivia',
  async execute(ctx) {
    // 1. Try Open Trivia Database API
    try {
      const response = await fetch('https://opentdb.com/api.php?amount=1&type=multiple', {
        headers: { 'User-Agent': 'WhatsAppHybridBot/1.0' },
      });

      if (response.ok) {
        const data = (await response.json()) as {
          results?: Array<{
            category: string;
            type: string;
            difficulty: string;
            question: string;
            correct_answer: string;
            incorrect_answers: string[];
          }>;
        };

        const item = data.results?.[0];
        if (item) {
          const question = decodeHtml(item.question);
          const correctAnswer = decodeHtml(item.correct_answer);
          const allOptions = shuffle([correctAnswer, ...item.incorrect_answers.map(decodeHtml)]);

          const letters = ['A', 'B', 'C', 'D'];
          const correctIndex = allOptions.indexOf(correctAnswer);
          const correctLetter = letters[correctIndex].toLowerCase();

          const optionsText = allOptions.map((opt, i) => `${letters[i]}) ${opt}`).join('\n');
          const accepted = [correctLetter, letters[correctIndex], correctAnswer.toLowerCase()];

          setChallenge(ctx, {
            type: 'trivia',
            answer: `${letters[correctIndex]}) ${correctAnswer}`,
            acceptedAnswers: accepted,
            ownerJid: senderJid(ctx),
          });

          await ctx.reply(
            `🧠 *TRIVIA QUIZ* [${decodeHtml(item.category)} • ${item.difficulty.toUpperCase()}]\n\n` +
            `*${question}*\n\n` +
            `${optionsText}\n\n` +
            `👉 Answer with: *.answer <A/B/C/D or answer>*\n` +
            `⏭️ Stop with: *.skipquiz*`
          );
          return;
        }
      }
    } catch {
      // Fallback
    }

    // 2. Fallback to curated trivia questions
    const item = pick(fallbackTrivia);
    const options = shuffle(item.choices);
    const letters = ['A', 'B', 'C', 'D'];
    const correctIndex = options.findIndex((o) => o.toLowerCase() === item.answer.toLowerCase());
    const correctLetter = letters[correctIndex].toLowerCase();

    setChallenge(ctx, {
      type: 'trivia',
      answer: `${letters[correctIndex]}) ${options[correctIndex]}`,
      acceptedAnswers: [correctLetter, letters[correctIndex], item.answer.toLowerCase()],
      ownerJid: senderJid(ctx),
    });

    const optionsText = options.map((opt, i) => `${letters[i]}) ${opt}`).join('\n');
    await ctx.reply(
      `🧠 *TRIVIA QUIZ*\n\n` +
      `*${item.question}*\n\n` +
      `${optionsText}\n\n` +
      `👉 Answer with: *.answer <A/B/C/D or answer>*\n` +
      `⏭️ Stop with: *.skipquiz*`
    );
  },
};

export const GuessWordCommand: Command = {
  name: 'guessword',
  aliases: ['wordguess', 'scramble'],
  category: CommandCategory.FUN,
  description: 'Guess the scrambled word',
  usage: 'guessword',
  async execute(ctx) {
    let word = '';

    // 1. Try Random Word API
    try {
      const length = pick([5, 6, 7, 8]);
      const response = await fetch(`https://random-word-api.herokuapp.com/word?length=${length}`, {
        headers: { 'User-Agent': 'WhatsAppHybridBot/1.0' },
      });
      if (response.ok) {
        const words = (await response.json()) as string[];
        if (words?.[0] && /^[a-z]+$/i.test(words[0])) {
          word = words[0].toLowerCase();
        }
      }
    } catch {
      // Fallback
    }

    if (!word) {
      word = pick(fallbackWords);
    }

    setChallenge(ctx, {
      type: 'word',
      answer: word,
      acceptedAnswers: [word.toLowerCase()],
      ownerJid: senderJid(ctx),
    });

    await ctx.reply(
      `🔤 *WORD SCRAMBLE*\n\n` +
      `Unscramble the letters:\n` +
      `👉 *${scramble(word)}* (${word.length} letters)\n\n` +
      `👉 Answer with: *.answer <word>*\n` +
      `⏭️ Stop with: *.skipquiz*`
    );
  },
};

export const AnswerCommand: Command = {
  name: 'answer',
  aliases: ['ans'],
  category: CommandCategory.FUN,
  description: 'Answer the active quiz',
  usage: 'answer <answer>',
  async execute(ctx) {
    const challenge = challenges.get(chatId(ctx));
    const rawAnswer = ctx.args.join(' ').trim().toLowerCase();

    if (!challenge) {
      await ctx.reply('No active quiz in this chat. Start one with .trivia, .mathquiz, or .guessword');
      return;
    }

    if (!rawAnswer) {
      await ctx.reply('Usage: .answer <your answer>');
      return;
    }

    const isCorrect = challenge.acceptedAnswers.some(
      (expected) => expected.toLowerCase() === rawAnswer || rawAnswer === expected.toLowerCase().replace(/[^a-z0-9]/g, '')
    );

    if (isCorrect) {
      challenges.delete(chatId(ctx));
      await ctx.reply(`🎉 *CORRECT!* Great job!\nAnswer was: *${challenge.answer}*`);
      return;
    }

    await ctx.reply('❌ Wrong answer. Try again or skip with *.skipquiz*');
  },
};

export const SkipQuizCommand: Command = {
  name: 'skipquiz',
  aliases: ['stopquiz', 'cancelquiz'],
  category: CommandCategory.FUN,
  description: 'Stop the active quiz in this chat',
  usage: 'skipquiz',
  async execute(ctx) {
    const id = chatId(ctx);
    const challenge = challenges.get(id);
    if (!challenge) {
      await ctx.reply('No active quiz in this chat.');
      return;
    }

    if (!(await canStopChallenge(ctx, challenge))) {
      await ctx.reply('Only the quiz starter, group admin, or owner can stop this quiz.');
      return;
    }

    challenges.delete(id);
    await ctx.reply(`⏹️ *Quiz Stopped.*\nThe answer was: *${challenge.answer}*`);
  },
};
