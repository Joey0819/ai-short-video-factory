import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createProviderReadiness } from "./provider-plan.mjs";

export const DEFAULT_PROJECT_ID = "demo-reference";
const DEFAULT_TOPIC = "AI cartoon fruit drama";

const VARIATION_BANK = [
  {
    world: "fruit hospital",
    title: "The Baby Was Not an Orange",
    hook: "Unfortunately, the doctor found something impossible.",
    genre: "AI cartoon drama",
    visual: "glossy anthropomorphic fruit characters in a cinematic hospital"
  },
  {
    world: "animal courtroom",
    title: "The Kitten Witness Changed Everything",
    hook: "The judge paused when the smallest witness raised its paw.",
    genre: "animal courtroom drama",
    visual: "expressive cartoon animals in a dramatic court chamber"
  },
  {
    world: "toy orphanage",
    title: "The Teddy Bear Had No Shadow",
    hook: "Every toy had a shadow except the new child.",
    genre: "toy mystery drama",
    visual: "soft 3D toys in a moody orphanage hallway"
  },
  {
    world: "robot family repair shop",
    title: "The New Robot Remembered His Mother",
    hook: "A factory reset should erase everything, but he remembered one face.",
    genre: "robot family drama",
    visual: "warm cinematic robots inside a compact repair shop"
  },
  {
    world: "candy kingdom",
    title: "The Prince Was Secretly Salty",
    hook: "The candy crown accepted everyone except the heir.",
    genre: "absurd royal reveal",
    visual: "glossy candy characters in a royal throne room"
  },
  {
    world: "vegetable trial",
    title: "The Potato Was Accused of Being Fruit",
    hook: "The courtroom gasped when the peel sample came back.",
    genre: "vegetable legal drama",
    visual: "anthropomorphic vegetables under bright courtroom lights"
  },
  {
    world: "school of dinosaurs",
    title: "The Tiny Dinosaur Could Not Roar",
    hook: "The entire class laughed until the fire alarm answered for him.",
    genre: "school cliffhanger",
    visual: "small dinosaurs in a colorful classroom with emotional close-ups"
  }
];

export function createVideoRecipe({ topic = DEFAULT_TOPIC, sourceType = "text idea" } = {}) {
  const topicLabel = buildTopicLabel(topic);
  const defaultTopic = isDefaultTopic(topic);

  return {
    recipe_name: "Reference-to-Video Factory",
    source_type: sourceType,
    source_summary: topic,
    platform: "tiktok",
    aspect_ratio: "9:16",
    duration_range_seconds: { min: 20, max: 35 },
    genre: defaultTopic ? "vertical AI short drama" : `vertical ${topicLabel} short drama`,
    visual_style: defaultTopic
      ? "cinematic 3D cartoon characters, high emotion, readable expressions, no watermarks, no in-image text"
      : `cinematic 3D ${topicLabel} characters, high emotion, readable expressions, no watermarks, no in-image text`,
    character_rules: [
      "Create new characters for every batch.",
      "Keep role archetypes, not exact identities.",
      "Use reference only for pacing, structure, and visual grammar."
    ],
    story_structure: [
      { beat_name: "hook", purpose: "open with the impossible reveal", duration_seconds: 3 },
      { beat_name: "setup", purpose: "show the normal expectation", duration_seconds: 6 },
      { beat_name: "detail", purpose: "reveal one strange clue", duration_seconds: 7 },
      { beat_name: "reaction", purpose: "let characters react emotionally", duration_seconds: 6 },
      { beat_name: "cliffhanger", purpose: "end before the answer", duration_seconds: 5 }
    ],
    shot_style: {
      camera_movements: ["slow push-in", "reaction close-up", "dramatic zoom", "subtle handheld drift"],
      shot_types: ["establishing shot", "two-shot", "object close-up", "reaction shot", "freeze cliffhanger"]
    },
    caption_style: {
      font_style: "bold white text with black stroke",
      position: "lower center",
      words_per_caption: "2-5",
      emphasis_rules: ["uppercase shock words", "one key phrase per beat", "never bake text into generated images"]
    },
    audio_style: {
      voice: "energetic narrator",
      music_mood: "suspenseful short-drama bed",
      sound_effects: ["heartbeat", "whoosh", "dramatic hit"]
    },
    originality_rules: [
      "Do not copy watermarks, usernames, exact frames, or original captions.",
      "Change characters, setting, relationship, conflict, and ending hook.",
      "Keep reference similarity below an operator-reviewed threshold.",
      "Store prompt versions for later A/B testing."
    ]
  };
}

export function generateEpisodes(recipe, { topic = DEFAULT_TOPIC, count = 5 } = {}) {
  const safeCount = Math.max(1, Math.min(Number(count) || 5, 50));
  return Array.from({ length: safeCount }, (_, index) => createEpisode(recipe, topic, index));
}

export function createEpisode(recipe, topic, index) {
  const variation = selectVariation(topic, index);
  const id = `episode-${String(index + 1).padStart(3, "0")}`;
  const statusCycle = ["rendered", "rendered", "generated", "rendering", "script", "queued"];
  const status = statusCycle[index % statusCycle.length];
  const durationSeconds = 24 + (index % 5);
  const captions = [
    "EVERYONE WAS SILENT",
    "UNFORTUNATELY",
    "ONE DETAIL",
    "CHANGED THE STORY",
    "PART 2?"
  ];

  return {
    id,
    title: variation.title,
    source_topic: topic,
    hook: variation.hook,
    world: variation.world,
    genre: variation.genre,
    visual_style: variation.visual,
    duration_seconds: durationSeconds,
    status,
    review_gate: index < 3 ? "approved" : "pending",
    created_at: new Date(Date.UTC(2026, 5, 13, 8, 20 + index, 0)).toISOString(),
    output_path: `outputs/${DEFAULT_PROJECT_ID}/${id}/final.mp4`,
    metadata_path: `outputs/${DEFAULT_PROJECT_ID}/${id}/metadata.json`,
    captions_path: `outputs/${DEFAULT_PROJECT_ID}/${id}/captions.srt`,
    poster_path: "/assets/fruit-drama-preview.png",
    hashtags: buildHashtags(recipe, variation),
    captions: captions.map((text, captionIndex) => ({
      start: captionIndex * 4.5,
      end: captionIndex * 4.5 + 3.2,
      text
    })),
    voiceover: [
      `In the ${variation.world}, nobody expected this.`,
      variation.hook,
      "The room went quiet.",
      "Then one small clue changed everything.",
      "The answer is in part two."
    ],
    shots: buildShots(variation),
    ai_disclosure: "This draft contains AI-generated visuals, voice, and captions.",
    recipe_snapshot: recipe.recipe_name
  };
}

function selectVariation(topic, index) {
  if (isDefaultTopic(topic)) return VARIATION_BANK[index % VARIATION_BANK.length];
  const topicLabel = buildTopicLabel(topic);
  const world = buildTopicWorld(topic);
  const subject = toTitleCase(world);
  const genre = `${topicLabel} short drama`;
  const visual = `cinematic 3D ${topicLabel}, expressive characters, dramatic vertical short-video lighting`;
  const templates = [
    {
      title: `The ${subject} Hid the First Clue`,
      hook: `Nobody expected the ${world} to reveal the missing detail.`
    },
    {
      title: `A ${subject} Witness Changed Everything`,
      hook: `The room froze when the ${world} told a different story.`
    },
    {
      title: `The ${subject} Had No Alibi`,
      hook: `Every answer made sense until the smallest clue disappeared.`
    },
    {
      title: `The ${subject} Secret Arrived Too Late`,
      hook: `The final warning came after everyone had already chosen sides.`
    },
    {
      title: `The ${subject} Confession Was Impossible`,
      hook: `The voice sounded familiar, but the suspect was not in the room.`
    }
  ];
  const template = templates[index % templates.length];

  return {
    ...template,
    world,
    genre,
    visual
  };
}

function isDefaultTopic(topic) {
  return stripLeadingAi(normalizeTopic(topic)) === stripLeadingAi(normalizeTopic(DEFAULT_TOPIC));
}

function buildTopicWorld(topic) {
  const words = normalizeTopic(topic)
    .split(" ")
    .filter((word) => !["ai", "short", "video", "vertical", "drama", "story"].includes(word));
  return words.slice(0, 4).join(" ") || stripLeadingAi(normalizeTopic(topic)) || "original remix world";
}

function buildTopicLabel(topic) {
  return stripLeadingAi(normalizeTopic(topic)) || "original remix drama";
}

function normalizeTopic(topic) {
  return String(topic ?? DEFAULT_TOPIC)
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripLeadingAi(topic) {
  return topic.replace(/^ai\s+/, "").trim();
}

function toTitleCase(text) {
  return text
    .split(" ")
    .filter(Boolean)
    .map((word) => (word === "ai" ? "AI" : `${word.charAt(0).toUpperCase()}${word.slice(1)}`))
    .join(" ");
}

export function buildShots(variation) {
  return [
    {
      shot_id: 1,
      duration_seconds: 4,
      visual: `Establish ${variation.world} with the main characters already tense.`,
      image_prompt: `Vertical 9:16 ${variation.visual}, establishing shot, emotional lighting, no text, no watermark.`,
      video_prompt: "Slow push-in, subtle breathing, characters glance at each other."
    },
    {
      shot_id: 2,
      duration_seconds: 5,
      visual: "Authority figure discovers a strange detail.",
      image_prompt: `Vertical 9:16 ${variation.visual}, authority figure notices a shocking clue, no text.`,
      video_prompt: "Close-up reaction, blinking, slow dramatic zoom."
    },
    {
      shot_id: 3,
      duration_seconds: 4,
      visual: "One innocent character looks confused.",
      image_prompt: `Vertical 9:16 ${variation.visual}, innocent character close-up, expressive eyes, no text.`,
      video_prompt: "Tiny movement, soft handheld drift, eyes widen."
    },
    {
      shot_id: 4,
      duration_seconds: 5,
      visual: "Family or group reacts in disbelief.",
      image_prompt: `Vertical 9:16 ${variation.visual}, group shock reaction, cinematic lighting, no text.`,
      video_prompt: "Fast reaction cut, subtle camera shake, dramatic hold."
    },
    {
      shot_id: 5,
      duration_seconds: 4,
      visual: "A document, monitor, or clue confirms the twist.",
      image_prompt: `Vertical 9:16 ${variation.visual}, clue close-up, readable shapes but no text, no watermark.`,
      video_prompt: "Slow zoom toward the clue, lights flicker softly."
    },
    {
      shot_id: 6,
      duration_seconds: 4,
      visual: "Freeze on the cliffhanger.",
      image_prompt: `Vertical 9:16 ${variation.visual}, final cliffhanger freeze frame, no text.`,
      video_prompt: "Dramatic pause, slight parallax, end on suspended reaction."
    }
  ];
}

export function createFactoryProject(options = {}) {
  const recipe = createVideoRecipe(options);
  const episodes = generateEpisodes(recipe, options);
  const providerStatus = createProviderReadiness({
    openAiConfigured: Boolean(options.openAiConfigured),
    openAiSource: options.openAiSource ?? (options.openAiConfigured ? "environment" : "missing"),
    chatGptAccountVerified: Boolean(options.chatGptAccountVerified),
    chatGptAccountSource: options.chatGptAccountSource ?? (options.chatGptAccountVerified ? "environment" : "missing"),
    localLlmConfigured: Boolean(options.localLlmConfigured),
    localLlmSource: options.localLlmSource ?? (options.localLlmConfigured ? "runtime" : "missing"),
    localLlmModel: options.localLlmModel,
    videoProvider: options.videoProvider ?? "local-ffmpeg"
  });
  const providerMode = options.providerMode ?? (options.chatGptAccountVerified ? "chatgpt-account" : options.openAiConfigured ? "live" : "local");
  return {
    id: DEFAULT_PROJECT_ID,
    name: "Reference Batch 001",
    generated_at: new Date().toISOString(),
    provider_mode: providerMode,
    video_provider: options.videoProvider ?? "local-ffmpeg",
    providers: providerStatus.steps.map((step) => step.provider),
    source_asset: options.sourceAsset ?? null,
    provider_status: providerStatus,
    recipe,
    jobs: buildJobs(episodes),
    episodes
  };
}

export function buildJobs(episodes) {
  const total = episodes.length;
  return [
    { id: "queued", label: "Queued", status: "complete", count: total },
    { id: "analyzing", label: "Analyzing", status: "complete", count: 1 },
    { id: "generating", label: "Generating", status: "active", count: episodes.filter((episode) => episode.status === "generated").length },
    { id: "rendering", label: "Rendering", status: "active", count: episodes.filter((episode) => episode.status === "rendering").length },
    { id: "review", label: "Review gate", status: "pending", count: episodes.filter((episode) => episode.review_gate === "pending").length },
    { id: "completed", label: "Completed", status: "pending", count: episodes.filter((episode) => episode.status === "rendered").length }
  ];
}

export function buildHashtags(recipe, variation) {
  const normalizedGenre = variation.genre.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const normalizedWorld = variation.world.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return Array.from(new Set(["#aistory", "#shorts", "#verticalvideo", `#${normalizedWorld}`, `#${normalizedGenre}`, `#${recipe.platform}`])).slice(0, 6);
}

export function captionsToSrt(captions) {
  return captions
    .map((caption, index) => {
      return `${index + 1}\n${formatSrtTime(caption.start)} --> ${formatSrtTime(caption.end)}\n${caption.text}\n`;
    })
    .join("\n");
}

export function formatSrtTime(seconds) {
  const ms = Math.round((seconds % 1) * 1000);
  const whole = Math.floor(seconds);
  const s = whole % 60;
  const m = Math.floor(whole / 60) % 60;
  const h = Math.floor(whole / 3600);
  return `${pad(h)}:${pad(m)}:${pad(s)},${String(ms).padStart(3, "0")}`;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

export async function writeFactoryProject(project, baseDir = process.cwd()) {
  const storageDir = path.join(baseDir, "storage", "projects", project.id);
  const publicStatePath = path.join(baseDir, "public", "factory-state.json");
  await mkdir(storageDir, { recursive: true });
  await mkdir(path.dirname(publicStatePath), { recursive: true });
  await writeJson(path.join(storageDir, "recipe.json"), project.recipe);
  await writeJson(path.join(storageDir, "episodes.json"), project.episodes);
  await writeJson(path.join(storageDir, "jobs.json"), project.jobs);
  await writeJson(path.join(storageDir, "project.json"), project);
  await writeJson(publicStatePath, project);

  for (const episode of project.episodes) {
    const episodeDir = path.join(baseDir, "outputs", project.id, episode.id);
    await mkdir(episodeDir, { recursive: true });
    await writeJson(path.join(episodeDir, "metadata.json"), episode);
    await writeFile(path.join(episodeDir, "captions.srt"), captionsToSrt(episode.captions), "utf8");
    await writeJson(path.join(episodeDir, "shot-prompts.json"), episode.shots);
  }
}

async function writeJson(filePath, data) {
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}
