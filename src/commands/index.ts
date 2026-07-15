import { commandRegistry } from '../core/command-registry';
import type { Command } from '../types';
import PingCommand from './ping';
import HelpCommand from './help';
import MenuCommand from './menu';
import CommandSearchCommand from './command-search';
import AiCommand from './ai';
import UptimeCommand from './uptime';
import AboutCommand from './about';
import StickerCommand from './sticker';
import Base64Command from './base64';
import { CoreExtraCommands } from './core-extra';
import {
  AdminListCommand,
  GroupInfoCommand,
  GroupStatsCommand,
  MemberListCommand,
  TagAllCommand,
} from './group';
import { SearchCommands } from './search';
import { SocialCommands } from './social';
import { IslamicCommands } from './islamic';
import { EconomyCommands } from './economy';
import { MarketplaceCommands } from './marketplace';
import { AnonymousCommands } from './anonymous';
import { TikTokCommand, TikTokAudioCommand } from './tiktok';
import {
  PlayCommand,
  YouTubeCommand,
  SpotifyCommand,
  SoundCloudCommand,
  NewgroundsCommand,
} from './music';
import {
  reverse,
  fancy,
  morse,
  binary,
  urlencode,
  urldecode,
  password,
  deleted,
  qr,
  upside,
  nickname,
  fakeid,
  color,
  countdown,
  remind,
  unit,
  calc,
  dictionary,
  element,
  formula,
  physics,
  currency,
  useragent,
  shorturl,
  renamefile,
  download,
  tts,
  textcase,
  wordcount,
  codesnippet,
  uuid,
  hash,
  json,
  timestamp,
  sortlines,
  dedupe,
  extracturls,
  rot13,
  iplookup,
  dns,
  httpcheck,
  portcheck,
  headers,
  whois,
} from './utility';
import {
  joke,
  quote,
  meme,
  pickupline,
  fact,
  truth,
  dare,
  wouldyourather,
  ship,
  compatibility,
  roast,
  spin,
  coinflip,
  dice,
  mathquiz,
  trivia,
  guessword,
  answer,
  skipquiz,
} from './fun';
import {
  blur,
  sharpen,
  grayscale,
  sepia,
  metadata,
  removemeta,
  resize,
  rotate,
  flip,
  compressimage,
  brightness,
  saturation,
  contrast,
  pixelate,
  enhance,
  denoise,
  toimage,
  tojpg,
  topng,
  towebp,
  bassboost,
  nightcore,
  reverb,
  echo,
  compressaudio,
  vocalremover,
  toaudio,
  tomp3,
  towav,
  toogg,
  trimvideo,
  videospeed,
  extractaudio,
  videogif,
} from './media';
import { BlackAndWhiteStickerCommand as bwsticker } from './sticker/bwsticker';
import { SepiaStickerCommand as sepiasticker } from './sticker/sepiasticker';
import { VintageStickerCommand as vintagesticker } from './sticker/vintagesticker';
import { CartoonStickerCommand as cartoonsticker } from './sticker/cartoonsticker';
import { GlitchStickerCommand as glitchsticker } from './sticker/glitchsticker';
import {
  MemeStickerCommand as memesticker,
  QuoteStickerCommand as quotesticker,
  StickerTextCommand as stext,
} from './sticker/meme';
import { StickerRevertCommand as srevert } from './sticker/convert';
import {
  BorderStickerCommand as bordersticker,
  CircleStickerCommand as circlesticker,
  RoundedStickerCommand as roundedsticker,
} from './sticker/shape';
import { UrlStickerCommand as urlsticker } from './sticker/url';
import { SbratStickerCommand as sbrat } from './sticker/sbrat';

function hidden(command: Command): Command {
  return { ...command, hidden: true };
}

export function loadCommands(): void {
  commandRegistry.register(PingCommand);
  commandRegistry.register(HelpCommand);
  commandRegistry.register(MenuCommand);
  commandRegistry.register(CommandSearchCommand);
  commandRegistry.register(AiCommand);
  commandRegistry.register(UptimeCommand);
  commandRegistry.register(AboutCommand);
  for (const command of CoreExtraCommands) {
    commandRegistry.register(command);
  }
  commandRegistry.register(StickerCommand);
  commandRegistry.register(Base64Command);
  commandRegistry.register(GroupInfoCommand);
  commandRegistry.register(AdminListCommand);
  commandRegistry.register(MemberListCommand);
  commandRegistry.register(GroupStatsCommand);
  commandRegistry.register(TagAllCommand);
  for (const command of SearchCommands) {
    commandRegistry.register(command);
  }
  for (const command of SocialCommands) {
    commandRegistry.register(command);
  }
  for (const command of IslamicCommands) {
    commandRegistry.register(command);
  }
  for (const command of EconomyCommands) {
    commandRegistry.register(command);
  }
  for (const command of MarketplaceCommands) {
    commandRegistry.register(command);
  }
  for (const command of AnonymousCommands) {
    commandRegistry.register(command);
  }
  commandRegistry.register(TikTokCommand);
  commandRegistry.register(TikTokAudioCommand);
  commandRegistry.register(PlayCommand);
  commandRegistry.register(YouTubeCommand);
  commandRegistry.register(SpotifyCommand);
  commandRegistry.register(SoundCloudCommand);
  commandRegistry.register(NewgroundsCommand);
  commandRegistry.register(reverse);
  commandRegistry.register(fancy);
  commandRegistry.register(morse);
  commandRegistry.register(binary);
  commandRegistry.register(urlencode);
  commandRegistry.register(urldecode);
  commandRegistry.register(password);
  commandRegistry.register(deleted);
  commandRegistry.register(qr);
  commandRegistry.register(upside);
  commandRegistry.register(nickname);
  commandRegistry.register(fakeid);
  commandRegistry.register(color);
  commandRegistry.register(countdown);
  commandRegistry.register(remind);
  commandRegistry.register(unit);
  commandRegistry.register(calc);
  commandRegistry.register(dictionary);
  commandRegistry.register(element);
  commandRegistry.register(formula);
  commandRegistry.register(physics);
  commandRegistry.register(currency);
  commandRegistry.register(useragent);
  commandRegistry.register(shorturl);
  commandRegistry.register(renamefile);
  commandRegistry.register(download);
  commandRegistry.register(tts);
  commandRegistry.register(textcase);
  commandRegistry.register(wordcount);
  commandRegistry.register(codesnippet);
  commandRegistry.register(uuid);
  commandRegistry.register(hash);
  commandRegistry.register(json);
  commandRegistry.register(timestamp);
  commandRegistry.register(sortlines);
  commandRegistry.register(dedupe);
  commandRegistry.register(extracturls);
  commandRegistry.register(rot13);
  commandRegistry.register(iplookup);
  commandRegistry.register(dns);
  commandRegistry.register(httpcheck);
  commandRegistry.register(portcheck);
  commandRegistry.register(headers);
  commandRegistry.register(whois);
  commandRegistry.register(joke);
  commandRegistry.register(quote);
  commandRegistry.register(meme);
  commandRegistry.register(pickupline);
  commandRegistry.register(fact);
  commandRegistry.register(truth);
  commandRegistry.register(dare);
  commandRegistry.register(wouldyourather);
  commandRegistry.register(ship);
  commandRegistry.register(compatibility);
  commandRegistry.register(roast);
  commandRegistry.register(spin);
  commandRegistry.register(coinflip);
  commandRegistry.register(dice);
  commandRegistry.register(mathquiz);
  commandRegistry.register(trivia);
  commandRegistry.register(guessword);
  commandRegistry.register(answer);
  commandRegistry.register(skipquiz);
  commandRegistry.register(blur);
  commandRegistry.register(sharpen);
  commandRegistry.register(grayscale);
  commandRegistry.register(sepia);
  commandRegistry.register(metadata);
  commandRegistry.register(removemeta);
  commandRegistry.register(resize);
  commandRegistry.register(rotate);
  commandRegistry.register(flip);
  commandRegistry.register(compressimage);
  commandRegistry.register(brightness);
  commandRegistry.register(saturation);
  commandRegistry.register(contrast);
  commandRegistry.register(pixelate);
  commandRegistry.register(enhance);
  commandRegistry.register(denoise);
  commandRegistry.register(toimage);
  commandRegistry.register(tojpg);
  commandRegistry.register(topng);
  commandRegistry.register(towebp);
  commandRegistry.register(bassboost);
  commandRegistry.register(nightcore);
  commandRegistry.register(reverb);
  commandRegistry.register(echo);
  commandRegistry.register(compressaudio);
  commandRegistry.register(vocalremover);
  commandRegistry.register(toaudio);
  commandRegistry.register(tomp3);
  commandRegistry.register(towav);
  commandRegistry.register(toogg);
  commandRegistry.register(trimvideo);
  commandRegistry.register(videospeed);
  commandRegistry.register(extractaudio);
  commandRegistry.register(videogif);
  commandRegistry.register(hidden(bwsticker));
  commandRegistry.register(hidden(sepiasticker));
  commandRegistry.register(hidden(vintagesticker));
  commandRegistry.register(hidden(cartoonsticker));
  commandRegistry.register(hidden(glitchsticker));
  commandRegistry.register(hidden(memesticker));
  commandRegistry.register(hidden(quotesticker));
  commandRegistry.register(hidden(stext));
  commandRegistry.register(hidden(srevert));
  commandRegistry.register(hidden(circlesticker));
  commandRegistry.register(hidden(roundedsticker));
  commandRegistry.register(hidden(bordersticker));
  commandRegistry.register(hidden(urlsticker));
  commandRegistry.register(hidden(sbrat));
}

export default loadCommands;
