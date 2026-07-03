import { Command, CommandCategory } from '../types';

type AladhanTimingData = {
  timings?: Record<string, string>;
  date?: {
    readable?: string;
    hijri?: {
      date?: string;
      month?: { en?: string };
      year?: string;
    };
  };
  meta?: {
    timezone?: string;
  };
};

type AladhanResponse = {
  code?: number;
  data?: AladhanTimingData;
};

const PRAYER_TIMES = [
  ['Imsak', 'Imsak'],
  ['Fajr', 'Subuh'],
  ['Sunrise', 'Sunrise'],
  ['Dhuhr', 'Dzuhur'],
  ['Asr', 'Ashar'],
  ['Maghrib', 'Maghrib'],
  ['Isha', 'Isya'],
] as const;

function cleanPlace(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function isPlaceName(value: string): boolean {
  return /^[\p{L}\p{M}0-9 .'-]{2,80}$/u.test(value);
}

function parsePlace(input: string): { city: string; country: string } | null {
  const [cityPart, countryPart] = input.split(',').map(cleanPlace);
  const city = cityPart || '';
  const country = countryPart || 'Indonesia';

  return isPlaceName(city) && isPlaceName(country) ? { city, country } : null;
}

function cleanTime(value: string | undefined): string {
  return value?.replace(/\s*\(.+\)\s*$/, '').trim() || '-';
}

function formatHijriDate(data: AladhanTimingData): string | null {
  const hijri = data.date?.hijri;
  if (!hijri) return null;

  const parts = [hijri.date, hijri.month?.en, hijri.year].filter(Boolean);
  return parts.length ? parts.join(' ') : null;
}

async function getPrayerTimes(city: string, country: string): Promise<AladhanTimingData> {
  const url = new URL('https://api.aladhan.com/v1/timingsByCity');
  url.searchParams.set('city', city);
  url.searchParams.set('country', country);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(url, { signal: controller.signal });
    const body = (await response.json()) as AladhanResponse;

    if (!response.ok || body.code !== 200 || !body.data?.timings) {
      throw new Error('Prayer time lookup failed');
    }

    return body.data;
  } finally {
    clearTimeout(timeout);
  }
}

function quranLookupUrl(query: string): string {
  if (/^\d{1,3}(:\d{1,3})?$/.test(query)) {
    return `https://quran.com/${query.replace(':', '/')}`;
  }

  return `https://quran.com/search?q=${encodeURIComponent(query)}`;
}

function parseGregorianDate(input: string): Date | null {
  if (!input) return new Date();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) return null;

  const [year, month, day] = input.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

export const PrayerTimesCommand: Command = {
  name: 'prayer',
  aliases: ['prayertime', 'jadwalsholat', 'sholat'],
  category: CommandCategory.ISLAMIC,
  description: 'Show daily prayer times for a city',
  usage: 'prayer <city>[, country]',
  async execute(ctx) {
    const place = parsePlace(ctx.rawArgs || ctx.args.join(' '));
    if (!place) {
      await ctx.reply('Usage: .prayer <city>[, country]\nExample: .prayer Jakarta\nExample: .prayer London, United Kingdom');
      return;
    }

    try {
      const data = await getPrayerTimes(place.city, place.country);
      const hijriDate = formatHijriDate(data);
      const lines = PRAYER_TIMES.map(([key, label]) => `${label}: ${cleanTime(data.timings?.[key])}`);

      await ctx.reply(
        `*Prayer Times*\n` +
          `${place.city}, ${place.country}\n` +
          `Date: ${data.date?.readable || '-'}${hijriDate ? ` / ${hijriDate}` : ''}\n` +
          `Timezone: ${data.meta?.timezone || '-'}\n\n` +
          lines.join('\n')
      );
    } catch {
      await ctx.reply(`Could not get prayer times for ${place.city}, ${place.country}.`);
    }
  },
};

export const QuranSearchCommand: Command = {
  name: 'quran',
  aliases: ['quransearch', 'ayat'],
  category: CommandCategory.ISLAMIC,
  description: 'Open a Quran verse or search query',
  usage: 'quran <surah:ayah|query>',
  async execute(ctx) {
    const query = ctx.args.join(' ').trim();
    if (!query) {
      await ctx.reply('Usage: .quran <surah:ayah|query>\nExample: .quran 36:1\nExample: .quran mercy');
      return;
    }

    await ctx.reply(`Quran lookup: ${quranLookupUrl(query)}`);
  },
};

export const HadithSearchCommand: Command = {
  name: 'hadith',
  aliases: ['hadis'],
  category: CommandCategory.ISLAMIC,
  description: 'Search hadith references',
  usage: 'hadith <query>',
  async execute(ctx) {
    const query = ctx.args.join(' ').trim();
    if (!query) {
      await ctx.reply('Usage: .hadith <query>');
      return;
    }

    await ctx.reply(`Hadith search: https://sunnah.com/search?q=${encodeURIComponent(query)}`);
  },
};

export const HijriDateCommand: Command = {
  name: 'hijri',
  aliases: ['islamicdate', 'kalenderislam'],
  category: CommandCategory.ISLAMIC,
  description: 'Convert today or a Gregorian date to the Islamic calendar',
  usage: 'hijri [YYYY-MM-DD]',
  async execute(ctx) {
    const date = parseGregorianDate(ctx.args[0] || '');
    if (!date) {
      await ctx.reply('Usage: .hijri [YYYY-MM-DD]');
      return;
    }

    const gregorian = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(date);
    const hijri = new Intl.DateTimeFormat('en-US-u-ca-islamic', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(date);

    await ctx.reply(`Islamic calendar\nGregorian: ${gregorian}\nHijri: ${hijri}\nNote: local moon sighting can differ by a day.`);
  },
};

export const IslamicCommands = [PrayerTimesCommand, QuranSearchCommand, HadithSearchCommand, HijriDateCommand];
