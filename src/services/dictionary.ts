export interface DictionaryEntry {
  word: string;
  phonetic?: string;
  partOfSpeech?: string;
  definition: string;
  example?: string;
  source: 'local' | 'dictionaryapi.dev';
}

const LOCAL_DICTIONARY: Record<string, Omit<DictionaryEntry, 'word' | 'source'>> = {
  bot: {
    partOfSpeech: 'noun',
    definition: 'A software agent that performs automated tasks, often through chat commands.',
  },
  api: {
    partOfSpeech: 'noun',
    definition: 'A set of rules or endpoints that lets software communicate with other software.',
  },
  dns: {
    partOfSpeech: 'noun',
    definition: 'The Domain Name System, which resolves domain names into network addresses.',
  },
  http: {
    partOfSpeech: 'noun',
    definition: 'The Hypertext Transfer Protocol used to request and transfer resources on the web.',
  },
  metadata: {
    partOfSpeech: 'noun',
    definition: 'Data that describes another file or message, such as size, format, date, or dimensions.',
  },
  sticker: {
    partOfSpeech: 'noun',
    definition: 'A small image or animated media item used in chat conversations.',
  },
  typescript: {
    partOfSpeech: 'noun',
    definition: 'A typed superset of JavaScript that compiles to plain JavaScript.',
  },
  webhook: {
    partOfSpeech: 'noun',
    definition: 'An HTTP callback triggered by an event in another service.',
  },
  whatsapp: {
    partOfSpeech: 'noun',
    definition: 'A messaging platform for private chats, group conversations, voice, and media sharing.',
  },
};

export async function lookupDictionary(word: string): Promise<DictionaryEntry | null> {
  const normalized = word.trim().toLowerCase();
  if (!normalized || !/^[a-z][a-z'-]{1,48}$/i.test(normalized)) {
    return null;
  }

  const local = LOCAL_DICTIONARY[normalized];
  if (local) {
    return {
      word: normalized,
      source: 'local',
      ...local,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(normalized)}`, {
      signal: controller.signal,
    });

    if (!response.ok) return null;

    const data = await response.json() as Array<{
      word?: string;
      phonetic?: string;
      meanings?: Array<{
        partOfSpeech?: string;
        definitions?: Array<{ definition?: string; example?: string }>;
      }>;
    }>;

    const first = data[0];
    const meaning = first?.meanings?.find((item) => item.definitions?.[0]?.definition);
    const definition = meaning?.definitions?.[0];

    if (!first?.word || !definition?.definition) {
      return null;
    }

    return {
      word: first.word,
      phonetic: first.phonetic,
      partOfSpeech: meaning?.partOfSpeech,
      definition: definition.definition,
      example: definition.example,
      source: 'dictionaryapi.dev',
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
