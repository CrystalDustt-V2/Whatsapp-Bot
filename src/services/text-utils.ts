import QRCode from 'qrcode';

export enum FontStyle {
  CIRCLED = 'circled',
  NEGATIVE_CIRCLED = 'negative_circled',
  SQUARED = 'squared',
  DOUBLE_STRUCK = 'double_struck',
  BOLD = 'bold',
  ITALIC = 'italic',
  BOLD_ITALIC = 'bold_italic',
  SCRIPT = 'script',
  BOLD_SCRIPT = 'bold_script',
  FRAKTUR = 'fraktur',
  BOLD_FRAKTUR = 'bold_fraktur',
  MONOSPACE = 'monospace',
}

const FONT_MAPS: Partial<Record<FontStyle, Record<string, string>>> = {
  [FontStyle.CIRCLED]: {
    'a': 'ⓐ', 'b': 'ⓑ', 'c': 'ⓒ', 'd': 'ⓓ', 'e': 'ⓔ',
    'f': 'ⓕ', 'g': 'ⓖ', 'h': 'ⓗ', 'i': 'ⓘ', 'j': 'ⓙ',
    'k': 'ⓚ', 'l': 'ⓛ', 'm': 'ⓜ', 'n': 'ⓝ', 'o': 'ⓞ',
    'p': 'ⓟ', 'q': 'ⓠ', 'r': 'ⓡ', 's': 'ⓢ', 't': 'ⓣ',
    'u': 'ⓤ', 'v': 'ⓥ', 'w': 'ⓦ', 'x': 'ⓧ', 'y': 'ⓨ', 'z': 'ⓩ',
    'A': 'Ⓐ', 'B': 'Ⓑ', 'C': 'Ⓒ', 'D': 'Ⓓ', 'E': 'Ⓔ',
    'F': 'Ⓕ', 'G': 'Ⓖ', 'H': 'Ⓗ', 'I': 'Ⓘ', 'J': 'Ⓙ',
    'K': 'Ⓚ', 'L': 'Ⓛ', 'M': 'Ⓜ', 'N': 'Ⓝ', 'O': 'Ⓞ',
    'P': 'Ⓟ', 'Q': 'Ⓠ', 'R': 'Ⓡ', 'S': 'Ⓢ', 'T': 'Ⓣ',
    'U': 'Ⓤ', 'V': 'Ⓥ', 'W': 'Ⓦ', 'X': 'Ⓧ', 'Y': 'Ⓨ', 'Z': 'Ⓩ',
    '0': '⓪', '1': '①', '2': '②', '3': '③', '4': '④',
    '5': '⑤', '6': '⑥', '7': '⑦', '8': '⑧', '9': '⑨',
  },
};

const MORSE_CODE: Record<string, string> = {
  'A': '.-', 'B': '-...', 'C': '-.-.', 'D': '-..', 'E': '.',
  'F': '..-.', 'G': '--.', 'H': '....', 'I': '..', 'J': '.---',
  'K': '-.-', 'L': '.-..', 'M': '--', 'N': '-.', 'O': '---',
  'P': '.--.', 'Q': '--.-', 'R': '.-.', 'S': '...', 'T': '-',
  'U': '..-', 'V': '...-', 'W': '.--', 'X': '-..-', 'Y': '-.--',
  'Z': '--..', '0': '-----', '1': '.----', '2': '..---', '3': '...--',
  '4': '....-', '5': '.....', '6': '-....', '7': '--...', '8': '---..',
  '9': '----.', ' ': '/',
};

const REVERSE_MORSE_CODE: Record<string, string> = Object.entries(MORSE_CODE)
  .reduce((acc, [key, value]) => ({ ...acc, [value]: key }), {});

const UPSIDE_DOWN_MAP: Record<string, string> = {
  a: 'ɐ',
  b: 'q',
  c: 'ɔ',
  d: 'p',
  e: 'ǝ',
  f: 'ɟ',
  g: 'ƃ',
  h: 'ɥ',
  i: 'ᴉ',
  j: 'ɾ',
  k: 'ʞ',
  l: 'l',
  m: 'ɯ',
  n: 'u',
  o: 'o',
  p: 'd',
  q: 'b',
  r: 'ɹ',
  s: 's',
  t: 'ʇ',
  u: 'n',
  v: 'ʌ',
  w: 'ʍ',
  x: 'x',
  y: 'ʎ',
  z: 'z',
  A: '∀',
  B: '𐐒',
  C: 'Ɔ',
  D: 'ᗡ',
  E: 'Ǝ',
  F: 'Ⅎ',
  G: '⅁',
  H: 'H',
  I: 'I',
  J: 'ſ',
  K: '⋊',
  L: '˥',
  M: 'W',
  N: 'N',
  O: 'O',
  P: 'Ԁ',
  Q: 'Ό',
  R: 'ᴚ',
  S: 'S',
  T: '⊥',
  U: '∩',
  V: 'Λ',
  W: 'M',
  X: 'X',
  Y: '⅄',
  Z: 'Z',
  '0': '0',
  '1': 'Ɩ',
  '2': 'ᄅ',
  '3': 'Ɛ',
  '4': 'ㄣ',
  '5': 'ϛ',
  '6': '9',
  '7': 'ㄥ',
  '8': '8',
  '9': '6',
  '.': '˙',
  ',': "'",
  "'": ',',
  '"': ',,',
  '`': ',',
  '?': '¿',
  '!': '¡',
  '[': ']',
  ']': '[',
  '(': ')',
  ')': '(',
  '{': '}',
  '}': '{',
  '<': '>',
  '>': '<',
  '&': '⅋',
  _: '‾',
};

export class TextUtils {
  reverse(text: string): string {
    return text.split('').reverse().join('');
  }

  upsideDown(text: string): string {
    return text
      .split('')
      .reverse()
      .map((char) => UPSIDE_DOWN_MAP[char] || char)
      .join('');
  }

  applyFont(text: string, style: FontStyle): string {
    const map = FONT_MAPS[style];
    if (!map) return text;
    return text.split('').map(char => map[char] || char).join('');
  }

  morseEncode(text: string): string {
    return text.toUpperCase().split('').map(char => MORSE_CODE[char] || char).join(' ');
  }

  morseDecode(morse: string): string {
    return morse.split(' ').map(code => REVERSE_MORSE_CODE[code] || code).join('');
  }

  binaryEncode(text: string): string {
    return text.split('').map(char => char.charCodeAt(0).toString(2).padStart(8, '0')).join(' ');
  }

  binaryDecode(binary: string): string {
    return binary.split(' ').map(bin => String.fromCharCode(parseInt(bin, 2))).join('');
  }

  urlEncode(text: string): string {
    return encodeURIComponent(text);
  }

  urlDecode(text: string): string {
    return decodeURIComponent(text);
  }

  generatePassword(length: number = 16): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let password = '';
    for (let i = 0; i < length; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
  }

  async generateQRCode(text: string): Promise<Buffer> {
    return QRCode.toBuffer(text, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 512,
    });
  }
}

export const textUtils = new TextUtils();
export default textUtils;
