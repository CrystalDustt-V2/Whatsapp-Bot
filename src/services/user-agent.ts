export interface UserAgentInfo {
  browser: string;
  os: string;
  device: string;
  engine: string;
}

function matchVersion(source: string, pattern: RegExp): string | undefined {
  return source.match(pattern)?.[1]?.replace(/_/g, '.');
}

export function parseUserAgent(userAgent: string): UserAgentInfo {
  const ua = userAgent.trim();
  const lower = ua.toLowerCase();

  let browser = 'Unknown';
  if (lower.includes('edg/')) {
    browser = `Microsoft Edge ${matchVersion(ua, /Edg\/([\d.]+)/) || ''}`.trim();
  } else if (lower.includes('opr/') || lower.includes('opera')) {
    browser = `Opera ${matchVersion(ua, /OPR\/([\d.]+)/) || ''}`.trim();
  } else if (lower.includes('firefox/')) {
    browser = `Firefox ${matchVersion(ua, /Firefox\/([\d.]+)/) || ''}`.trim();
  } else if (lower.includes('chrome/')) {
    browser = `Chrome ${matchVersion(ua, /Chrome\/([\d.]+)/) || ''}`.trim();
  } else if (lower.includes('safari/') && lower.includes('version/')) {
    browser = `Safari ${matchVersion(ua, /Version\/([\d.]+)/) || ''}`.trim();
  }

  let os = 'Unknown';
  if (lower.includes('windows nt')) {
    os = `Windows ${matchVersion(ua, /Windows NT ([\d.]+)/) || ''}`.trim();
  } else if (lower.includes('android')) {
    os = `Android ${matchVersion(ua, /Android ([\d.]+)/) || ''}`.trim();
  } else if (lower.includes('iphone') || lower.includes('ipad')) {
    os = `iOS ${matchVersion(ua, /OS ([\d_]+)/) || ''}`.trim();
  } else if (lower.includes('mac os x')) {
    os = `macOS ${matchVersion(ua, /Mac OS X ([\d_]+)/) || ''}`.trim();
  } else if (lower.includes('linux')) {
    os = 'Linux';
  }

  const device = lower.includes('mobile')
    ? 'Mobile'
    : lower.includes('tablet') || lower.includes('ipad')
      ? 'Tablet'
      : 'Desktop';

  const engine = lower.includes('applewebkit')
    ? 'WebKit/Blink'
    : lower.includes('gecko/')
      ? 'Gecko'
      : 'Unknown';

  return { browser, os, device, engine };
}
