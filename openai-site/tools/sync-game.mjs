import { access, copyFile, cp, mkdir, rename, rm, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const gameDist = resolve(siteRoot, "..", "dist");
const publicRoot = resolve(siteRoot, "public");
const sourceVideo = resolve(
  gameDist,
  "assets",
  "cinematics",
  "paopao-opening-final-light-1080.mp4",
);
const cloudVideo = resolve(
  publicRoot,
  "assets",
  "cinematics",
  "paopao-opening-final-light-1080.mp4",
);
const maximumStaticFileBytes = 24_500_000;

await access(resolve(gameDist, "classic", "index.html"));
await access(sourceVideo);
await rm(publicRoot, { recursive: true, force: true });
await cp(gameDist, publicRoot, { recursive: true });

const sourceHash = createHash("sha256")
  .update(readFileSync(sourceVideo))
  .digest("hex")
  .slice(0, 16);
const cachedVideo = resolve(
  siteRoot,
  ".cache",
  `paopao-opening-final-light-1080-${sourceHash}.mp4`,
);
await mkdir(dirname(cachedVideo), { recursive: true });

let cacheReady = false;
try {
  cacheReady = (await stat(cachedVideo)).size < maximumStaticFileBytes;
} catch {
  cacheReady = false;
}

if (!cacheReady) {
  const temporaryVideo = `${cachedVideo}.tmp.mp4`;
  await rm(temporaryVideo, { force: true });
  const ffmpeg = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      sourceVideo,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "24",
      "-maxrate",
      "3000k",
      "-bufsize",
      "6000k",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      temporaryVideo,
    ],
    { stdio: "inherit" },
  );
  if (ffmpeg.status !== 0) {
    throw new Error(`Cloud video optimization failed with exit code ${ffmpeg.status ?? "unknown"}.`);
  }
  if ((await stat(temporaryVideo)).size >= maximumStaticFileBytes) {
    throw new Error("Cloud video optimization did not meet the static-file size limit.");
  }
  await rename(temporaryVideo, cachedVideo);
}

await copyFile(cachedVideo, cloudVideo);
const deployedVideoBytes = (await stat(cloudVideo)).size;
if (deployedVideoBytes >= maximumStaticFileBytes) {
  throw new Error("Cloud video exceeds the Sites static-file safety limit.");
}

process.stdout.write(
  `Synced PaoPao game (${deployedVideoBytes} byte cloud intro) into ${publicRoot}\n`,
);
