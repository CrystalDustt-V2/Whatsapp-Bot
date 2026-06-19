import { randomData } from '../../services/random-data';
import { Command, CommandCategory } from '../../types';

export const NicknameCommand: Command = {
  name: 'nickname',
  aliases: ['nick', 'randomnick'],
  category: CommandCategory.UTILITY,
  description: 'Generate a random nickname',
  usage: 'nickname',
  async execute(ctx) {
    await ctx.reply(`Nickname: ${randomData.getNickname()}`);
  },
};

export const FakeIdentityCommand: Command = {
  name: 'fakeid',
  aliases: ['fakeidentity', 'fakeperson'],
  category: CommandCategory.UTILITY,
  description: 'Generate a fake identity for testing',
  usage: 'fakeid',
  async execute(ctx) {
    const identity = randomData.getFakeIdentity();
    await ctx.reply(
      `*Fake Identity*\n` +
        `Name: ${identity.name}\n` +
        `Age: ${identity.age}\n` +
        `City: ${identity.city}\n` +
        `Job: ${identity.job}\n` +
        `Email: ${identity.email}`
    );
  },
};

export const ColorCommand: Command = {
  name: 'color',
  aliases: ['hex', 'randomcolor'],
  category: CommandCategory.UTILITY,
  description: 'Generate a random hex color',
  usage: 'color',
  async execute(ctx) {
    const color = randomData.getHexColor();
    await ctx.reply(`Color: ${color.hex}\n${color.rgb}`);
  },
};
