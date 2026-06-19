import packageJson from '../../package.json';
import { commandRegistry } from '../core/command-registry';
import config from '../config';

export function formatDuration(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);

  return [
    days ? `${days}d` : '',
    hours ? `${hours}h` : '',
    minutes ? `${minutes}m` : '',
    `${seconds}s`,
  ]
    .filter(Boolean)
    .join(' ');
}

export function getBotInfo() {
  return {
    name: packageJson.name,
    version: packageJson.version,
    description: packageJson.description,
    prefix: config.BOT_PREFIX,
    commandCount: commandRegistry.getAll().length,
    uptime: formatDuration(process.uptime()),
    dashboardUrl: config.DASHBOARD_URL,
  };
}
