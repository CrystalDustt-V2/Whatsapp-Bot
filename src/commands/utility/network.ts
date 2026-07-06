import {
  checkHttp,
  checkPort,
  fetchHttpHeaders,
  getDnsRecordTypes,
  isDnsRecordType,
  lookupIp,
  normalizeHost,
  normalizeHttpUrl,
  parsePort,
  resolveDns,
} from '../../services/network-tools';
import { Command, CommandCategory } from '../../types';

function formatList(values: string[], maxItems = 10): string {
  if (!values.length) return 'No records found.';

  const shown = values.slice(0, maxItems).map((value) => `- ${value}`);
  const remaining = values.length - shown.length;
  return `${shown.join('\n')}${remaining > 0 ? `\n...and ${remaining} more` : ''}`;
}

type RdapResponse = {
  ldhName?: string;
  unicodeName?: string;
  status?: string[];
  events?: { eventAction?: string; eventDate?: string }[];
  nameservers?: { ldhName?: string; unicodeName?: string }[];
  entities?: { roles?: string[]; vcardArray?: unknown[] }[];
};

function normalizeDomain(input: string): string | null {
  const host = normalizeHost(input);
  if (!host || host.includes(':') || !/^[a-z0-9][a-z0-9.-]{0,252}\.[a-z]{2,}$/i.test(host)) return null;
  return host.toLowerCase();
}

function eventDate(data: RdapResponse, action: string): string {
  return data.events?.find((event) => event.eventAction === action)?.eventDate?.slice(0, 10) || 'unknown';
}

function registrarName(data: RdapResponse): string {
  const entity = data.entities?.find((item) => item.roles?.includes('registrar'));
  const cards = Array.isArray(entity?.vcardArray?.[1]) ? entity.vcardArray[1] : [];
  const fn = cards.find((row): row is unknown[] => Array.isArray(row) && (row[0] === 'fn' || row[0] === 'org'));
  return typeof fn?.[3] === 'string' ? fn[3] : 'unknown';
}

async function lookupRdap(domain: string): Promise<RdapResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
      signal: controller.signal,
      headers: { accept: 'application/rdap+json, application/json' },
    });
    if (!response.ok) throw new Error(`RDAP ${response.status}`);
    return (await response.json()) as RdapResponse;
  } finally {
    clearTimeout(timeout);
  }
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
  aliases: ['http', 'sitecheck', 'uptimecheck', 'siteup', 'websiteup'],
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

export const PortCheckCommand: Command = {
  name: 'portcheck',
  aliases: ['port', 'tcpcheck', 'portscan'],
  category: CommandCategory.NETWORK,
  description: 'Check if one public TCP port is open',
  usage: 'portcheck <host> <port>',
  async execute(ctx) {
    const host = normalizeHost(ctx.args[0] || '');
    const port = parsePort(ctx.args[1] || '');
    if (!host || !port) {
      await ctx.reply('Usage: .portcheck <host> <port>\nExample: .portcheck example.com 443');
      return;
    }

    try {
      const result = await checkPort(host, port);
      await ctx.reply(
        `Port check\n` +
          `Host: ${result.host}\n` +
          `Address: ${result.address}\n` +
          `Port: ${result.port}\n` +
          `Status: ${result.open ? 'open' : 'closed or filtered'}\n` +
          `Time: ${result.elapsedMs}ms`
      );
    } catch {
      await ctx.reply('Port check failed. Only public hosts are allowed.');
    }
  },
};

export const HeadersCommand: Command = {
  name: 'headers',
  aliases: ['httpheaders', 'head'],
  category: CommandCategory.NETWORK,
  description: 'Show public HTTP response headers',
  usage: 'headers <url>',
  async execute(ctx) {
    const url = normalizeHttpUrl(ctx.args[0] || '');
    if (!url) {
      await ctx.reply('Usage: .headers <url>');
      return;
    }

    try {
      const result = await fetchHttpHeaders(url);
      const headers = result.headers
        .slice(0, 12)
        .map(([key, value]) => `- ${key}: ${value.slice(0, 120)}`);
      await ctx.reply(
        `HTTP headers\n` +
          `URL: ${result.finalUrl}\n` +
          `Status: ${result.status} ${result.statusText}\n` +
          `Time: ${result.elapsedMs}ms\n` +
          `${headers.join('\n') || 'No headers found.'}`
      );
    } catch {
      await ctx.reply('Header check failed. Only public HTTP(S) URLs are allowed.');
    }
  },
};

export const WhoisCommand: Command = {
  name: 'whois',
  aliases: ['domaininfo', 'rdap'],
  category: CommandCategory.NETWORK,
  description: 'Look up public domain registration info',
  usage: 'whois <domain>',
  async execute(ctx) {
    const domain = normalizeDomain(ctx.args[0] || '');
    if (!domain) {
      await ctx.reply('Usage: .whois <domain>');
      return;
    }

    try {
      const data = await lookupRdap(domain);
      const nameservers = data.nameservers?.map((server) => server.ldhName || server.unicodeName).filter(Boolean) || [];
      await ctx.reply(
        `WHOIS/RDAP for ${data.ldhName || data.unicodeName || domain}\n` +
          `Registrar: ${registrarName(data)}\n` +
          `Created: ${eventDate(data, 'registration')}\n` +
          `Expires: ${eventDate(data, 'expiration')}\n` +
          `Status: ${(data.status || ['unknown']).slice(0, 4).join(', ')}\n` +
          `Nameservers:\n${formatList(nameservers as string[], 6)}`
      );
    } catch {
      await ctx.reply(`Could not look up WHOIS/RDAP info for ${domain}.`);
    }
  },
};
