import config from '../../config';
import { Command, CommandCategory } from '../../types';

type Challenge = {
  type: string;
  answer: string;
  ownerJid: string;
};

const challenges = new Map<string, Challenge>();

const trivia = [
  { question: 'What planet is known as the Red Planet?', answer: 'mars' },
  { question: 'How many days are in a leap year?', answer: '366' },
  { question: 'What gas do plants absorb from the atmosphere?', answer: 'carbon dioxide' },
  { question: 'What is the capital of Japan?', answer: 'tokyo' },
  { question: 'What is 9 x 9?', answer: '81' },
];

const words = ['typescript', 'sticker', 'whatsapp', 'dashboard', 'banana', 'volcano'];

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

function scramble(word: string): string {
  return word
    .split('')
    .sort(() => Math.random() - 0.5)
    .join('');
}

export const MathQuizCommand: Command = {
  name: 'mathquiz',
  aliases: ['mathgame'],
  category: CommandCategory.FUN,
  description: 'Start a math quiz',
  usage: 'mathquiz',
  async execute(ctx) {
    const a = Math.floor(Math.random() * 20) + 1;
    const b = Math.floor(Math.random() * 20) + 1;
    setChallenge(ctx, { type: 'math', answer: String(a + b), ownerJid: senderJid(ctx) });
    await ctx.reply(`Math quiz: ${a} + ${b} = ?\nAnswer with .answer <answer>\nStop with .skipquiz`);
  },
};

export const TriviaCommand: Command = {
  name: 'trivia',
  aliases: ['quiz'],
  category: CommandCategory.FUN,
  description: 'Start a trivia question',
  usage: 'trivia',
  async execute(ctx) {
    const item = pick(trivia);
    setChallenge(ctx, { type: 'trivia', answer: item.answer, ownerJid: senderJid(ctx) });
    await ctx.reply(`${item.question}\nAnswer with .answer <answer>\nStop with .skipquiz`);
  },
};

export const GuessWordCommand: Command = {
  name: 'guessword',
  aliases: ['wordguess'],
  category: CommandCategory.FUN,
  description: 'Guess the scrambled word',
  usage: 'guessword',
  async execute(ctx) {
    const word = pick(words);
    setChallenge(ctx, { type: 'word', answer: word, ownerJid: senderJid(ctx) });
    await ctx.reply(`Guess the word: ${scramble(word)}\nAnswer with .answer <answer>\nStop with .skipquiz`);
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
    const answer = ctx.args.join(' ').trim().toLowerCase();

    if (!challenge) {
      await ctx.reply('No active quiz in this chat.');
      return;
    }

    if (!answer) {
      await ctx.reply('Usage: .answer <answer>');
      return;
    }

    if (answer === challenge.answer) {
      challenges.delete(chatId(ctx));
      await ctx.reply('Correct.');
      return;
    }

    await ctx.reply('Wrong. Try again.');
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
    await ctx.reply(`Quiz skipped. Answer was: ${challenge.answer}`);
  },
};
