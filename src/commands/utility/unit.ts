import { convertUnit, getUnitHelp } from '../../services/unit-converter';
import { Command, CommandCategory } from '../../types';

export const UnitCommand: Command = {
  name: 'unit',
  aliases: ['convert', 'converter'],
  category: CommandCategory.EDUCATION,
  description: 'Convert length, weight, temperature, and data units',
  usage: 'unit <value> <from> <to>',
  async execute(ctx) {
    const value = Number(ctx.args[0]);
    const fromUnit = ctx.args[1];
    const toUnit = ctx.args[2];

    if (!Number.isFinite(value) || !fromUnit || !toUnit) {
      await ctx.reply(`Usage: .unit <value> <from> <to>\n\n${getUnitHelp()}`);
      return;
    }

    const result = convertUnit(value, fromUnit, toUnit);
    if (!result) {
      await ctx.reply(`Unsupported or mixed unit category.\n\n${getUnitHelp()}`);
      return;
    }

    await ctx.reply(result);
  },
};

export default UnitCommand;
