import mega = require('megajs');
import config from '../config';

type MegaUploadResult = {
  id: string;
  name: string;
  size: number;
};

let storagePromise: Promise<mega.Storage> | null = null;

function folderParts(): string[] {
  return (config.MEGA_FOLDER_PATH || '')
    .split(/[\\/]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

async function megaStorage(): Promise<mega.Storage> {
  if (!config.MEGA_EMAIL || !config.MEGA_PASSWORD) {
    throw new Error('MEGA_EMAIL and MEGA_PASSWORD are required for MEGA media storage');
  }

  storagePromise ||= new mega.Storage({
    email: config.MEGA_EMAIL,
    password: config.MEGA_PASSWORD,
    secondFactorCode: config.MEGA_2FA_CODE,
    keepalive: false,
  }).ready;

  return storagePromise;
}

async function targetFolder(): Promise<mega.MutableFile> {
  const storage = await megaStorage();
  let folder = storage.root;

  for (const name of folderParts()) {
    const existing = folder.children?.find((file) => file.directory && file.name === name) as mega.MutableFile | undefined;
    folder = existing || await folder.mkdir(name);
  }

  return folder;
}

async function findMegaFile(nodeId: string): Promise<mega.MutableFile> {
  const storage = await megaStorage();
  let file = storage.files[nodeId];
  if (!file) {
    await storage.reload(true);
    file = storage.files[nodeId];
  }
  if (!file) throw new Error('MEGA file was not found');
  return file;
}

export async function uploadMegaFile(fileName: string, buffer: Buffer): Promise<MegaUploadResult> {
  const folder = await targetFolder();
  const upload = folder.upload({ name: fileName, size: buffer.length }, Buffer.from(buffer)) as any;
  const file = await upload.complete as mega.MutableFile;
  if (!file.nodeId) throw new Error('MEGA upload did not return a file id');

  return {
    id: file.nodeId,
    name: file.name || fileName,
    size: file.size || buffer.length,
  };
}

export async function downloadMegaFile(nodeId: string): Promise<Buffer> {
  return findMegaFile(nodeId).then((file) => file.downloadBuffer({}));
}

export async function deleteMegaFile(nodeId: string): Promise<void> {
  const file = await findMegaFile(nodeId);
  await file.delete(true);
}
