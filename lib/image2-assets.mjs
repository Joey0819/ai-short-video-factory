import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_PROJECT_ID } from "./factory-core.mjs";

const MAX_IMAGE2_ASSET_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE2_ASSET_COUNT = 12;
const ALLOWED_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function attachImage2Assets({
  rootDir = process.cwd(),
  projectId = DEFAULT_PROJECT_ID,
  episodeId = "episode-001",
  assets = [],
  source = "chatgpt-account"
} = {}) {
  const safeProjectId = assertSafeSegment(projectId, "projectId");
  const safeEpisodeId = assertSafeSegment(episodeId, "episodeId");
  if (!Array.isArray(assets) || assets.length === 0) {
    throw new Error("Provide at least one Image 2 asset.");
  }
  if (assets.length > MAX_IMAGE2_ASSET_COUNT) {
    throw new Error(`Image 2 asset upload is limited to ${MAX_IMAGE2_ASSET_COUNT} files per call.`);
  }

  const generatedAt = new Date().toISOString();
  const assetDir = path.join(rootDir, "outputs", safeProjectId, safeEpisodeId, "image2-assets");
  await mkdir(assetDir, { recursive: true });

  const storedAssets = [];
  for (const [index, asset] of assets.entries()) {
    const normalized = decodeImage2Asset(asset, index + 1);
    const shotId = normalizeShotId(normalized.shotId, index + 1);
    const extension = extensionForMime(normalized.mimeType, normalized.fileName);
    const fileName = `shot-${String(shotId).padStart(3, "0")}${extension}`;
    const filePath = path.join(assetDir, fileName);
    await writeFile(filePath, normalized.bytes);
    storedAssets.push({
      shot_id: shotId,
      file_name: fileName,
      original_file_name: normalized.fileName,
      mime_type: normalized.mimeType,
      size_bytes: normalized.bytes.byteLength,
      sha256: createHash("sha256").update(normalized.bytes).digest("hex"),
      storage_path: path.relative(rootDir, filePath),
      artifact_path: `/api/artifact/${safeProjectId}/${safeEpisodeId}/image2-assets/${fileName}`,
      source,
      model: "gpt-image-2",
      uses_api_key: false,
      attached_at: generatedAt
    });
  }

  const manifest = {
    project_id: safeProjectId,
    episode_id: safeEpisodeId,
    model: "gpt-image-2",
    auth_method: "ChatGPT Apps OAuth 2.1 / MCP",
    uses_api_key: false,
    source,
    generated_at: generatedAt,
    asset_count: storedAssets.length,
    assets: storedAssets
  };
  const manifestPath = path.join(assetDir, "manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return {
    ...manifest,
    manifest_path: path.relative(rootDir, manifestPath)
  };
}

export async function readImage2AssetManifest({
  rootDir = process.cwd(),
  projectId = DEFAULT_PROJECT_ID,
  episodeId = "episode-001"
} = {}) {
  const safeProjectId = assertSafeSegment(projectId, "projectId");
  const safeEpisodeId = assertSafeSegment(episodeId, "episodeId");
  const manifestPath = path.join(rootDir, "outputs", safeProjectId, safeEpisodeId, "image2-assets", "manifest.json");
  try {
    return {
      ...(JSON.parse(await readFile(manifestPath, "utf8"))),
      manifest_path: path.relative(rootDir, manifestPath)
    };
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function decodeImage2Asset(asset, fallbackShotId) {
  if (!asset || typeof asset !== "object") {
    throw new Error("Image 2 asset entries must be objects.");
  }
  const mimeType = String(asset.mimeType ?? asset.mime_type ?? "").trim().toLowerCase();
  if (!ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) {
    throw new Error("Image 2 assets must be PNG, JPEG, or WEBP images.");
  }

  const fileName = sanitizeFileName(asset.fileName ?? asset.file_name ?? `shot-${fallbackShotId}`);
  const data = String(asset.data ?? asset.base64 ?? "").trim();
  const base64 = data.includes(",") ? data.slice(data.indexOf(",") + 1) : data;
  if (!base64 || !/^[a-zA-Z0-9+/=\r\n_-]+$/.test(base64)) {
    throw new Error("Image 2 asset data must be base64 encoded.");
  }
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.byteLength) {
    throw new Error("Image 2 asset data decoded to an empty file.");
  }
  if (bytes.byteLength > MAX_IMAGE2_ASSET_BYTES) {
    throw new Error(`Each Image 2 asset must be under ${Math.round(MAX_IMAGE2_ASSET_BYTES / (1024 * 1024))} MB.`);
  }

  return {
    shotId: asset.shotId ?? asset.shot_id ?? fallbackShotId,
    fileName,
    mimeType,
    bytes
  };
}

function normalizeShotId(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(1, Math.min(Math.floor(numeric), 999));
}

function sanitizeFileName(value) {
  const basename = path.basename(String(value || "image2-asset")).trim();
  return basename.replace(/[^\w.\- ()]+/g, "-").slice(0, 120) || "image2-asset";
}

function extensionForMime(mimeType, fileName) {
  const current = path.extname(fileName).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".webp"].includes(current)) return current === ".jpeg" ? ".jpg" : current;
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/webp") return ".webp";
  return ".png";
}

function assertSafeSegment(value, label) {
  const segment = String(value ?? "").trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(segment)) {
    throw new Error(`${label} must be a safe path segment.`);
  }
  return segment;
}
