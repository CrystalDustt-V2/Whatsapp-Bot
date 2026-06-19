import {
  checkHttp,
  getDnsRecordTypes,
  isDnsRecordType,
  lookupIp,
  normalizeHttpUrl,
  resolveDns,
} from '../../services/network-tools';
import { Command, CommandCategory } from '../../types';

function formatList(values: string[], maxItems = 10): string {
  if (!values.length) return 'No records found.';

  const shown = values.slice(0, maxItems).map((value) => `- ${value}`);
  const remaining = values.length - shown.length;
  return `${shown.join('\n')}${remaining > 0 ? `\n...and ${remaining} more` : ''}`;
}

export const IpLookupCommand: Command = {
  name: 'iplookup',
  aliases: ['ip', 'hostip'],
  category: CommandCategory.NETWORK,
  description: 'Resolve a domain to IP addresses',
  usage: 'iplookup <domain>',
  async execute(ctx) {
    const host = ctx.args[0];
    if (!host) {
      await ctx.reply('Usage: .iplookup <domain>');
      return;
    }

    try {
      const addresses = await lookupIp(host);
      await ctx.reply(`IP lookup for ${host}\n${formatList(addresses)}`);
    } catch (err) {
      await ctx.reply(`Could not resolve ${host}.`);
    }
  },
};

export const DnsLookupCommand: Command = {
  name: 'dns',
  aliases: ['dnslookup'],
  category: CommandCategory.NETWORK,
  description: 'Resolve DNS records',
  usage: 'dns <domain> [A|AAAA|CNAME|MX|NS|TXT]',
  async execute(ctx) {
    const host = ctx.args[0];
    const type = (ctx.args[1] || 'A').toUpperCase();

    if (!host || !isDnsRecordType(type)) {
      await ctx.reply(`Usage: .dns <domain> [record]\nRecords: ${getDnsRecordTypes()}`);
      return;
    }

    try {
      const records = await resolveDns(host, type);
      await ctx.reply(`DNS ${type} records for ${host}\n${formatList(records)}`);
    } catch (err) {
      await ctx.reply(`No ${type} records found for ${host}.`);
    }
  },
};

export const HttpCheckCommand: Command = {
  name: 'httpcheck',
  aliases: ['http', 'sitecheck', 'uptimecheck'],
  category: CommandCategory.NETWORK,
  description: 'Check HTTP status and response time',
  usage: 'httpcheck <url>',
  async execute(ctx) {
    const url = normalizeHttpUrl(ctx.args[0] || '');
    if (!url) {
      await ctx.reply('Usage: .httpcheck <url>');
      return;
    }

    try {
      const result = await checkHttp(url);
      await ctx.reply(
        `HTTP check\n` +
          `URL: ${result.finalUrl}\n` +
          `Status: ${result.status} ${result.statusText}\n` +
          `Type: ${result.contentType}\n` +
          `Time: ${result.elapsedMs}ms`
      );
    } catch (err) {
      await ctx.reply(`HTTP check failed for ${url}.`);
    }
  },
};
