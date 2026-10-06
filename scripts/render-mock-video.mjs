#!/usr/bin/env node
import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ffmpegPath from "ffmpeg-static";
import { readImage2AssetManifest } from "../lib/image2-assets.mjs";

function parseArgs(argv) {
  const args = {
    project: "demo-reference",
    episode: "episode-001",
    duration: 9
  };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === "--project" && value) {
      args.project = value;
      index += 1;
    } else if (key === "--episode" && value) {
      args.episode = value;
      index += 1;
    } else if (key === "--duration" && value) {
      args.duration = Number(value);
      index += 1;
    }
  }
  return args;
}

const font = [
  "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
  "/System/Library/Fonts/Supplemental/Arial.ttf",
  "/System/Library/Fonts/SFNS.ttf"
].find((candidate) => existsSync(candidate));

export async function renderMockVideo({ cwd = process.cwd(), project = "demo-reference", episode = "episode-001", duration = 9 } = {}) {
  const metadataPath = path.join(cwd, "outputs", project, episode, "metadata.json");
  const fallbackProjectPath = path.join(cwd, "public", "factory-state.json");
  const episodeData = await loadEpisode(metadataPath, fallbackProjectPath, episode);
  const outputPath = path.join(cwd, "outputs", project, episode, "final.mp4");
  await mkdir(path.dirname(outputPath), { recursive: true });
  const renderDuration = Math.max(3, Number(duration) || episodeData.duration_seconds || 9);
  const shotScenes = buildShotScenes(episodeData, renderDuration);
  const captions = normalizeCaptions(episodeData.captions, renderDuration);
  const image2SceneAssets = await resolveImage2SceneAssets({
    cwd,
    project,
    episode,
    shotScenes
  });

  const renderLabel = image2SceneAssets.length ? "IMAGE 2 ASSET RENDER" : "LOCAL PRODUCTION RENDER";
  const filters = [
    ...buildFrameFilters(),
    ...shotScenes.flatMap((scene, sceneIndex) => buildSceneFilters(scene, sceneIndex, episodeData, renderDuration)),
    ...buildForegroundFilters(episodeData, captions, renderDuration, renderLabel, episode)
  ].join(",");

  const commandArgs = image2SceneAssets.length
    ? buildImage2CommandArgs({
      image2SceneAssets,
      shotScenes,
      episodeData,
      captions,
      renderDuration,
      renderLabel,
      episode,
      outputPath
    })
    : buildFallbackCommandArgs({ filters, renderDuration, outputPath });

  await run(ffmpegPath, commandArgs);
  return {
    project,
    episode,
    output_path: outputPath,
    image2_asset_count: image2SceneAssets.length,
    image2_assets_used: image2SceneAssets.map((asset) => ({
      shot_id: asset.shotId,
      file_name: asset.fileName,
      storage_path: path.relative(cwd, asset.filePath)
    }))
  };
}

function buildShotScenes(episodeData, duration) {
  const shots = Array.isArray(episodeData.shots) && episodeData.shots.length
    ? episodeData.shots.slice(0, 6)
    : [{ shot_id: 1, visual: episodeData.hook ?? episodeData.title ?? "Generated short video scene", duration_seconds: duration }];
  const totalShotDuration = shots.reduce((sum, shot) => sum + Math.max(1, Number(shot.duration_seconds) || 1), 0);
  let cursor = 0;

  return shots.map((shot, index) => {
    const sceneDuration = index === shots.length - 1
      ? duration - cursor
      : Math.max(1.5, (Math.max(1, Number(shot.duration_seconds) || 1) / totalShotDuration) * duration);
    const start = cursor;
    const end = Math.min(duration, start + sceneDuration);
    cursor = end;
    return {
      ...shot,
      start,
      end: Math.max(start + 0.5, end)
    };
  });
}

function buildSceneFilters(scene, index, episodeData, duration) {
  return [
    ...buildSceneBackgroundFilters(scene, index),
    ...buildSceneTextFilters(scene, index, episodeData, duration)
  ];
}

function buildSceneBackgroundFilters(scene, index) {
  const palette = [
    ["0x18382f", "0x46e0b2"],
    ["0x221a32", "0x73b7ff"],
    ["0x352315", "0xffca4f"],
    ["0x351b1b", "0xff6b57"],
    ["0x12253c", "0x9af0d4"],
    ["0x263018", "0xd6f27a"]
  ];
  const [background, accent] = palette[index % palette.length];
  const enable = enableBetween(scene.start, scene.end);

  return [
    `drawbox=x=104:y=392:w=872:h=1018:color=${background}@0.92:t=fill:enable='${enable}'`,
    `drawbox=x=140:y=430:w=800:h=8:color=${accent}@0.98:t=fill:enable='${enable}'`,
    `drawbox=x=${146 + index * 118}:y=1370:w=72:h=8:color=${accent}@0.98:t=fill:enable='${enable}'`
  ];
}

function buildSceneTextFilters(scene, index, episodeData) {
  const accent = sceneAccent(index);
  const enable = enableBetween(scene.start, scene.end);
  const beatLabel = `SHOT ${String(index + 1).padStart(2, "0")}`;
  const voiceLine = episodeData.voiceover?.[index] ?? episodeData.hook ?? "";

  return [
    drawText(beatLabel, 140, 470, 34, accent, 20, enable),
    drawText(scene.visual ?? episodeData.hook ?? episodeData.title, 140, 560, 46, "0xf4ead8", 42, enable),
    drawText(scene.video_prompt ?? "Generated motion prompt", 140, 716, 30, "0x9af0d4", 54, enable),
    drawText(voiceLine, 140, 1254, 32, "0xffca4f", 52, enable)
  ];
}

function buildFrameFilters() {
  return [
    "drawbox=x=0:y=0:w=1080:h=1920:color=0x071011@1:t=fill",
    "drawbox=x=54:y=78:w=972:h=1764:color=0x15322d@0.92:t=fill",
    "drawbox=x=78:y=102:w=924:h=1716:color=0x0d1719@0.58:t=fill"
  ];
}

function buildForegroundFilters(episodeData, captions, renderDuration, renderLabel, episode) {
  return [
    "drawbox=x=88:y=126:w=904:h=96:color=0x071011@0.76:t=fill",
    drawText("AI SHORT VIDEO FACTORY", 112, 152, 34, "0x9af0d4"),
    drawText(renderLabel, 612, 152, 30, "0x20d6a2"),
    drawText(episodeData.title.toUpperCase(), 104, 262, 52, "0xf4ead8", 42),
    ...buildCaptionFilters(captions),
    "drawbox=x=104:y=1560:w=872:h=118:color=0x071011@0.72:t=fill",
    drawText(episodeData.hook, 132, 1592, 32, "0xffca4f", 54),
    "drawbox=x=104:y=1714:w=872:h=14:color=0xf4ead8@0.18:t=fill",
    `drawbox=x=104:y=1714:w='min(872,872*t/${renderDuration.toFixed(2)})':h=14:color=0x46e0b2@0.92:t=fill`,
    drawText(`Episode ${episodeData.id ?? episode}`, 104, 1754, 28, "0x9aa7a6"),
    drawText(`#${String(episodeData.genre ?? "short drama").replace(/[^a-z0-9]/gi, "").toLowerCase()}`, 676, 1754, 28, "0x9af0d4", 22)
  ];
}

function sceneAccent(index) {
  return ["0x46e0b2", "0x73b7ff", "0xffca4f", "0xff6b57", "0x9af0d4", "0xd6f27a"][index % 6];
}

function buildFallbackCommandArgs({ filters, renderDuration, outputPath }) {
  return [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=0x071011:s=1080x1920:r=30:d=${renderDuration}`,
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=174:sample_rate=44100:d=${renderDuration}`,
    "-vf",
    filters,
    "-af",
    "volume=0.055",
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    ...encodingArgs(outputPath)
  ];
}

function buildImage2CommandArgs({ image2SceneAssets, shotScenes, episodeData, captions, renderDuration, renderLabel, episode, outputPath }) {
  const imageInputArgs = image2SceneAssets.flatMap((asset) => [
    "-loop",
    "1",
    "-framerate",
    "30",
    "-t",
    renderDuration.toFixed(2),
    "-i",
    asset.filePath
  ]);
  const filterComplex = buildImage2FilterComplex({
    image2SceneAssets,
    shotScenes,
    episodeData,
    captions,
    renderDuration,
    renderLabel,
    episode
  });

  return [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=0x071011:s=1080x1920:r=30:d=${renderDuration}`,
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=174:sample_rate=44100:d=${renderDuration}`,
    ...imageInputArgs,
    "-filter_complex",
    filterComplex,
    "-af",
    "volume=0.055",
    "-map",
    "[vout]",
    "-map",
    "1:a:0",
    ...encodingArgs(outputPath)
  ];
}

function buildImage2FilterComplex({ image2SceneAssets, shotScenes, episodeData, captions, renderDuration, renderLabel, episode }) {
  const graph = [];
  const backgroundFilters = [
    ...buildFrameFilters(),
    ...shotScenes.flatMap((scene, sceneIndex) => buildSceneBackgroundFilters(scene, sceneIndex))
  ];
  graph.push(`[0:v]${backgroundFilters.join(",")}[scene_base_0]`);

  let currentLabel = "scene_base_0";
  for (const [index, asset] of image2SceneAssets.entries()) {
    const inputIndex = index + 2;
    const imageLabel = `image2_asset_${index}`;
    const outputLabel = `scene_base_${index + 1}`;
    const scene = shotScenes[asset.sceneIndex] ?? shotScenes[index] ?? { start: 0, end: renderDuration };
    const enable = enableBetween(scene.start, scene.end);
    graph.push(
      `[${inputIndex}:v]scale=800:420:force_original_aspect_ratio=increase,crop=800:420,setsar=1,format=rgba,colorchannelmixer=aa=0.94[${imageLabel}]`
    );
    graph.push(
      `[${currentLabel}][${imageLabel}]overlay=x=140:y=820:enable='${enable}'[${outputLabel}]`
    );
    currentLabel = outputLabel;
  }

  const foregroundFilters = [
    ...image2SceneAssets.flatMap((asset) => buildImage2AssetFrameFilters(asset, shotScenes)),
    ...shotScenes.flatMap((scene, sceneIndex) => buildSceneTextFilters(scene, sceneIndex, episodeData)),
    ...buildForegroundFilters(episodeData, captions, renderDuration, renderLabel, episode)
  ];
  graph.push(`[${currentLabel}]${foregroundFilters.join(",")}[vout]`);
  return graph.join(";");
}

function buildImage2AssetFrameFilters(asset, shotScenes) {
  const scene = shotScenes[asset.sceneIndex];
  if (!scene) return [];
  const enable = enableBetween(scene.start, scene.end);
  return [
    `drawbox=x=132:y=812:w=816:h=436:color=0xf4ead8@0.22:t=2:enable='${enable}'`,
    `drawbox=x=140:y=820:w=800:h=420:color=0x000000@0.16:t=fill:enable='${enable}'`
  ];
}

function encodingArgs(outputPath) {
  return [
    "-c:v",
    "libx264",
    "-c:a",
    "aac",
    "-b:a",
    "96k",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    outputPath
  ];
}

function normalizeCaptions(captions = [], duration) {
  if (!Array.isArray(captions) || captions.length === 0) {
    return [{ start: 0, end: duration, text: "GENERATED VIDEO" }];
  }

  return captions.map((caption, index) => ({
    start: clamp(Number(caption.start) || index * 3, 0, duration),
    end: clamp(Number(caption.end) || index * 3 + 2.5, 0.5, duration),
    text: caption.text
  }));
}

async function resolveImage2SceneAssets({ cwd, project, episode, shotScenes }) {
  const manifest = await readImage2AssetManifest({
    rootDir: cwd,
    projectId: project,
    episodeId: episode
  });
  if (!manifest?.assets?.length) return [];

  const assetsByShot = new Map();
  for (const asset of manifest.assets) {
    const shotId = normalizeShotId(asset.shot_id);
    if (!assetsByShot.has(shotId)) assetsByShot.set(shotId, asset);
  }

  const usedPaths = new Set();
  return shotScenes
    .map((scene, sceneIndex) => {
      const shotId = normalizeShotId(scene.shot_id ?? sceneIndex + 1);
      const manifestAsset = assetsByShot.get(shotId) ?? manifest.assets[sceneIndex];
      if (!manifestAsset || !isSupportedImageAsset(manifestAsset)) return null;

      const filePath = resolveImage2AssetFilePath({
        cwd,
        project,
        episode,
        asset: manifestAsset
      });
      if (!filePath || usedPaths.has(filePath)) return null;
      usedPaths.add(filePath);

      return {
        sceneIndex,
        shotId,
        fileName: path.basename(manifestAsset.file_name),
        filePath
      };
    })
    .filter(Boolean);
}

function resolveImage2AssetFilePath({ cwd, project, episode, asset }) {
  const assetDir = path.resolve(cwd, "outputs", project, episode, "image2-assets");
  const fileName = path.basename(String(asset.file_name ?? ""));
  if (!/^[\w.\- ()]+\.(png|jpg|jpeg|webp)$/i.test(fileName)) return null;

  const directPath = path.join(assetDir, fileName);
  if (existsSync(directPath)) return directPath;

  if (typeof asset.storage_path === "string" && asset.storage_path.trim()) {
    const resolved = path.resolve(cwd, asset.storage_path);
    if (resolved.startsWith(`${assetDir}${path.sep}`) && existsSync(resolved)) {
      return resolved;
    }
  }
  return null;
}

function isSupportedImageAsset(asset) {
  const mimeType = String(asset.mime_type ?? "").trim().toLowerCase();
  return ["image/png", "image/jpeg", "image/webp"].includes(mimeType);
}

function normalizeShotId(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(1, Math.min(Math.floor(numeric), 999));
}

function buildCaptionFilters(captions) {
  return captions.flatMap((caption) => {
    const enable = enableBetween(caption.start, Math.max(caption.start + 0.2, caption.end));
    return [
      `drawbox=x=112:y=1418:w=856:h=112:color=0x000000@0.70:t=fill:enable='${enable}'`,
      drawText(caption.text, 144, 1446, 54, "0xf4ead8", 30, enable)
    ];
  });
}

function enableBetween(start, end) {
  return `between(t,${start.toFixed(2)},${end.toFixed(2)})`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  const result = await renderMockVideo(args);
  const image2Summary = result.image2_asset_count
    ? ` with ${result.image2_asset_count} Image 2 still${result.image2_asset_count === 1 ? "" : "s"}`
    : "";
  console.log(`Rendered packaged MP4${image2Summary}: ${result.output_path}`);
}

async function loadEpisode(primaryPath, projectPath, episodeId) {
  if (existsSync(primaryPath)) {
    return JSON.parse(await readFile(primaryPath, "utf8"));
  }
  if (existsSync(projectPath)) {
    const project = JSON.parse(await readFile(projectPath, "utf8"));
    const episode = project.episodes.find((candidate) => candidate.id === episodeId);
    if (episode) return episode;
  }
  throw new Error(`Cannot find episode metadata for ${episodeId}. Run npm run generate first.`);
}

function drawText(text, x, y, size, color, maxChars = 34, enable) {
  const content = String(text || "").slice(0, maxChars);
  const fontPart = font ? `fontfile='${font.replace(/'/g, "'\\\\''")}'` : "font=Arial";
  const enablePart = enable ? `:enable='${enable}'` : "";
  return `drawtext=${fontPart}:text='${escapeFilterText(content)}':x=${x}:y=${y}:fontsize=${size}:fontcolor=${color}:line_spacing=12${enablePart}`;
}

function escapeFilterText(value) {
  return String(value ?? "")
    .replace(/[^\w .?!\-\u4e00-\u9fff]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(value, max));
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    if (!command) {
      reject(new Error("ffmpeg-static did not provide an ffmpeg binary."));
      return;
    }
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with ${code}\n${stderr}`));
      }
    });
  });
}
