import { lookup, resolve4, resolve6, resolveCname, resolveMx, resolveNs, resolveTxt } from 'node:dns/promises';
import { isIP, Socket } from 'node:net';

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

export function normalizeHost(input: string): string | null {
  const value = input.trim();
  if (!value) return null;

  try {
    if (/^https?:\/\//i.test(value)) {
      return new URL(value).hostname;
    }
  } catch {
    return null;
  }

  if (value.length > 253 || /[\s/?#]/.test(value)) return null;
  return value.replace(/^\[|\]$/g, '');
}

export function parsePort(input: string): number | null {
  const port = Number(input);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

export function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 6) {
    const lower = address.toLowerCase();
    return lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80:');
  }

  return (
    /^127\./.test(address) ||
    /^10\./.test(address) ||
    /^192\.168\./.test(address) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(address) ||
    /^169\.254\./.test(address) ||
    address === '0.0.0.0'
  );
}

async function resolvePublicAddress(host: string): Promise<string> {
  const addresses = await lookup(host, { all: true });
  const publicAddress = addresses.find((entry) => !isPrivateAddress(entry.address));

  if (!publicAddress || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new Error('Only public hosts are allowed.');
  }

  return publicAddress.address;
}

async function assertPublicHttpUrl(url: string): Promise<void> {
  const parsed = new URL(url);
  const host = normalizeHost(parsed.hostname);
  if (!host || !['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only HTTP(S) URLs are allowed.');
  }

  await resolvePublicAddress(host);
}

function connectPort(address: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    let settled = false;

    const finish = (open: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(open);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, address);
  });
}

export async function checkPort(
  host: string,
  port: number,
  timeoutMs = 3000
): Promise<{ host: string; address: string; port: number; open: boolean; elapsedMs: number }> {
  const startedAt = Date.now();
  const address = await resolvePublicAddress(host);

  const open = await connectPort(address, port, timeoutMs);
  return {
    host,
    address,
    port,
    open,
    elapsedMs: Date.now() - startedAt,
  };
}

async function fetchPublic(url: string, init: RequestInit, maxRedirects = 5): Promise<Response> {
  let currentUrl = url;

  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    await assertPublicHttpUrl(currentUrl);
    const response = await fetch(currentUrl, { ...init, redirect: 'manual' });
    const location = response.headers.get('location');

    if (location && response.status >= 300 && response.status < 400) {
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    return response;
  }

  throw new Error('Too many redirects.');
}

export async function fetchHttpHeaders(url: string): Promise<{
  finalUrl: string;
  status: number;
  statusText: string;
  contentType: string;
  elapsedMs: number;
  headers: [string, string][];
}> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    let response = await fetchPublic(url, {
      method: 'HEAD',
      signal: controller.signal,
    });

    if (response.status === 405 || response.status === 403) {
      response = await fetchPublic(url, {
        method: 'GET',
        signal: controller.signal,
      });
    }

    return {
      finalUrl: response.url,
      status: response.status,
      statusText: response.statusText,
      contentType: response.headers.get('content-type') || 'unknown',
      elapsedMs: Date.now() - startedAt,
      headers: Array.from(response.headers.entries()),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function checkHttp(url: string): Promise<{
  finalUrl: string;
  status: number;
  statusText: string;
  contentType: string;
  elapsedMs: number;
}> {
  const result = await fetchHttpHeaders(url);
  return {
    finalUrl: result.finalUrl,
    status: result.status,
    statusText: result.statusText,
    contentType: result.contentType,
    elapsedMs: result.elapsedMs,
  };
}
