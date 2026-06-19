import { commandRegistry } from '../core/command-registry';
import PingCommand from './ping';
import HelpCommand from './help';
import MenuCommand from './menu';
import UptimeCommand from './uptime';
import AboutCommand from './about';
import StickerCommand from './sticker';
import Base64Command from './base64';
import { CoreExtraCommands } from './core-extra';
import {
  reverse,
  fancy,
  morse,
  binary,
  urlencode,
  urldecode,
  password,
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
  useragent,
  iplookup,
  dns,
  httpcheck,
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
} from './media';
import { BlackAndWhiteStickerCommand as bwsticker } from './sticker/bwsticker';
import { SepiaStickerCommand as sepiasticker } from './sticker/sepiasticker';
import { VintageStickerCommand as vintagesticker } from './sticker/vintagesticker';
import { CartoonStickerCommand as cartoonsticker } from './sticker/cartoonsticker';
import { GlitchStickerCommand as glitchsticker } from './sticker/glitchsticker';

export function loadCommands(): void {
  commandRegistry.register(PingCommand);
  commandRegistry.register(HelpCommand);
  commandRegistry.register(MenuCommand);
  commandRegistry.register(UptimeCommand);
  commandRegistry.register(AboutCommand);
  for (const command of CoreExtraCommands) {
    commandRegistry.register(command);
  }
  commandRegistry.register(StickerCommand);
  commandRegistry.register(Base64Command);
  commandRegistry.register(reverse);
  commandRegistry.register(fancy);
  commandRegistry.register(morse);
  commandRegistry.register(binary);
  commandRegistry.register(urlencode);
  commandRegistry.register(urldecode);
  commandRegistry.register(password);
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
  commandRegistry.register(useragent);
  commandRegistry.register(iplookup);
  commandRegistry.register(dns);
  commandRegistry.register(httpcheck);
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
  commandRegistry.register(bwsticker);
  commandRegistry.register(sepiasticker);
  commandRegistry.register(vintagesticker);
  commandRegistry.register(cartoonsticker);
  commandRegistry.register(glitchsticker);
}

export default loadCommands;
