import { lookup, resolve4, resolve6, resolveCname, resolveMx, resolveNs, resolveTxt } from 'node:dns/promises';

export type DnsRecordType = 'A' | 'AAAA' | 'CNAME' | 'MX' | 'NS' | 'TXT';

const DNS_RECORD_TYPES: DnsRecordType[] = ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT'];

export async function lookupIp(host: string): Promise<string[]> {
  const addresses = await lookup(host, { all: true });
  return addresses.map((entry) => `${entry.address} (IPv${entry.family})`);
}

export async function resolveDns(host: string, type: string): Promise<string[]> {
  const recordType = type.toUpperCase() as DnsRecordType;

  switch (recordType) {
    case 'A':
      return resolve4(host);
    case 'AAAA':
      return resolve6(host);
    case 'CNAME':
      return resolveCname(host);
    case 'MX': {
      const records = await resolveMx(host);
      return records.map((record) => `${record.exchange} (priority ${record.priority})`);
    }
    case 'NS':
      return resolveNs(host);
    case 'TXT': {
      const records = await resolveTxt(host);
      return records.map((record) => record.join(''));
    }
    default:
      return [];
  }
}

export function isDnsRecordType(type: string): type is DnsRecordType {
  return DNS_RECORD_TYPES.includes(type.toUpperCase() as DnsRecordType);
}

export function getDnsRecordTypes(): string {
  return DNS_RECORD_TYPES.join(', ');
}

export function normalizeHttpUrl(input: string): string | null {
  const value = input.trim();
  if (!value) return null;

  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    if (!['http:', 'https:'].includes(url.protocol)) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

export async function checkHttp(url: string): Promise<{
  finalUrl: string;
  status: number;
  statusText: string;
  contentType: string;
  elapsedMs: number;
}> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    let response = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
    });

    if (response.status === 405 || response.status === 403) {
      response = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
      });
    }

    return {
      finalUrl: response.url,
      status: response.status,
      statusText: response.statusText,
      contentType: response.headers.get('content-type') || 'unknown',
      elapsedMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timeout);
  }
}
