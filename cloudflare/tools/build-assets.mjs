import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = path.join(root, 'dist');
const target = path.join(root, 'dist-cloudflare');
const cinematic = 'assets/cinematics/paopao-opening-final-light-1080.mp4';
const maximumAssetBytes = 25 * 1024 * 1024;

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });

const sourceVideo = path.join(source, cinematic);
const targetVideo = path.join(target, cinematic);
if ((await stat(sourceVideo)).size >= maximumAssetBytes) {
  const temporary = `${targetVideo}.optimized.mp4`;
  await new Promise((resolve, reject) => {
    const process = spawn('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', sourceVideo,
      '-vf', "scale='min(1280,iw)':-2", '-c:v', 'libx264', '-preset', 'medium',
      '-b:v', '3000k', '-maxrate', '3400k', '-bufsize', '6800k',
      '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', temporary,
    ], { stdio: 'inherit' });
    process.once('error', reject);
    process.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)));
  });
  await rm(targetVideo);
  await cp(temporary, targetVideo);
  await rm(temporary);
}

const finalSize = (await stat(targetVideo)).size;
if (finalSize >= maximumAssetBytes) throw new Error(`Cloudflare cinematic is still too large: ${finalSize} bytes`);
console.log(`Cloudflare assets ready; cinematic ${(finalSize / 1024 / 1024).toFixed(1)} MiB.`);
