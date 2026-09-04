export { ReverseCommand as reverse } from './reverse';
export { FancyCommand as fancy } from './fancy';
export { MorseCommand as morse } from './morse';
export { BinaryCommand as binary } from './binary';
export { UrlEncodeCommand as urlencode } from './urlencode';
export { UrlDecodeCommand as urldecode } from './urldecode';
export { PasswordCommand as password } from './password';
export { DeletedMessageCommand as deleted } from './deleted';
export { ViewOnceCommand as viewonce } from './viewonce';
export { QRCommand as qr } from './qr';
export { UpsideDownCommand as upside } from './upside';
export { NicknameCommand as nickname, FakeIdentityCommand as fakeid, ColorCommand as color } from './random';
export { CountdownCommand as countdown } from './countdown';
export { ReminderCommand as remind } from './reminder';
export { UnitCommand as unit } from './unit';
export { CalculatorCommand as calc } from './calc';
export {
  DictionaryCommand as dictionary,
  ElementCommand as element,
  FormulaCommand as formula,
  PhysicsCommand as physics,
  CurrencyCommand as currency,
} from './education';
export { UserAgentCommand as useragent } from './useragent';
export { ShortUrlCommand as shorturl } from './shorturl';
export { RenameFileCommand as renamefile, DownloadFileCommand as download } from './file';
export { TextToSpeechCommand as tts } from './tts';
export {
  TextCaseCommand as textcase,
  WordCountCommand as wordcount,
  CodeSnippetCommand as codesnippet,
  UuidCommand as uuid,
  HashCommand as hash,
  JsonCommand as json,
  TimestampCommand as timestamp,
  SortLinesCommand as sortlines,
  DedupeLinesCommand as dedupe,
  ExtractUrlsCommand as extracturls,
  Rot13Command as rot13,
  HtmlEscapeCommand as htmlescape,
  HtmlUnescapeCommand as htmlunescape,
  LoremCommand as lorem,
  CharInfoCommand as charinfo,
} from './text-extra';
export {
  IpLookupCommand as iplookup,
  DnsLookupCommand as dns,
  HttpCheckCommand as httpcheck,
  PortCheckCommand as portcheck,
  HeadersCommand as headers,
  WhoisCommand as whois,
} from './network';
