import { calculateExpression } from '../../services/calculator';
import { Command, CommandCategory } from '../../types';

function formatResult(value: number): string {
  return Number(value.toPrecision(12)).toString();
}

export const CalculatorCommand: Command = {
  name: 'calc',
  aliases: ['calculator', 'math'],
  category: CommandCategory.EDUCATION,
  description: 'Calculate a math expression',
  usage: 'calc <expression>',
  async execute(ctx) {
    const expression = ctx.args.join(' ').trim();

    if (!expression) {
      await ctx.reply('Usage: .calc <expression>\nExample: .calc (12 + 8) / 4');
      return;
    }

    try {
      const result = calculateExpression(expression);
      await ctx.reply(`${expression} = ${formatResult(result)}`);
    } catch (err) {
      await ctx.reply('Invalid expression. Supported operators: + - * / % ^ and parentheses.');
    }
  },
};

export default CalculatorCommand;
