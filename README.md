# AI Short Video Factory / AI短视频工厂

这是一个本地可运行的 web 产品：把参考截图、参考视频或文字想法分析成 `VideoRecipe`，再批量生成原创短视频内容，并渲染可播放 MP4。当前版本在配置 `OPENAI_API_KEY` 后可用 OpenAI Responses API 生成配方、脚本、镜头提示词、字幕和旁白文本；也可以选择 Local LLM (Ollama)，用本机模型生成同样的结构化内容。本地 FFmpeg 是默认快速 MP4 打包器，高级渲染器可切换到 OpenAI Videos API。ChatGPT account mode 使用 ChatGPT Apps OAuth 2.1 / MCP 作为账号认证路线，不把消费版 ChatGPT 网页自动化当作后端。

This is a runnable local web product that turns a reference screenshot, reference video, or text idea into a reusable `VideoRecipe`, batch-generates original short-video content, and renders playable MP4 files. When `OPENAI_API_KEY` is configured, the web app can use the OpenAI Responses API for recipes, scripts, shot prompts, captions, and voiceover text; it can also use Local LLM (Ollama) to generate the same structured content with an on-machine model. Local FFmpeg remains the default fast MP4 packager, and the advanced renderer can switch to the OpenAI Videos API. ChatGPT account mode is represented as a ChatGPT Apps OAuth 2.1 / MCP account-auth route, not consumer ChatGPT web automation as a backend.

## Frontend / 前端

- React + Vite dashboard at `http://127.0.0.1:3024`.
- App shell includes reference upload, recipe analysis, originality rules, generation controls, job timeline, episode review, 9:16 preview, Image 2 still attachment, and export actions.
- Operators can upload a screenshot or reference video through the web UI. The backend stores the asset under `storage/projects/<project_id>/reference-assets/`, serves it through `/api/artifact/<project>/reference/<file>`, and carries the metadata into future generation runs, production manifests, and publish bundles.
- Controls are interactive: concept/hook, source mode, episode count, provider mode, account verification, render count, render duration, and renderer choice drive backend generation when the API is online; the `Create content + video` action generates content, renders MP4 files, builds publish bundles, writes an Image 2 handoff file, and returns playable artifacts to the web preview. The preview export panel can also attach ChatGPT/Image 2 stills, rerender the selected episode, refresh the package, and open the resulting asset manifest.
- Topbar project actions are wired: `Save` persists the current project and a save receipt, `Duplicate` writes a durable duplicate snapshot, `Settings` opens the advanced production controls, and `Notifications` surfaces launch blockers plus artifact counts.
- Product readiness is visible inside the generation panel: the app checks generated content, playable MP4s, publish bundles, Image 2 handoff files, attached Image 2 assets, the batch manifest, the downloadable package, and optional OpenAI/ChatGPT configuration.
- The readiness UI now separates local production readiness from commercial launch readiness. Local production can be ready with local FFmpeg and local OAuth. Commercial readiness additionally requires `PUBLIC_MCP_ORIGIN` as a public HTTPS origin plus managed OAuth/OIDC JWKS configuration.
- Launch preflight is visible in the dashboard and available through `GET /api/launch-preflight` or `npm run launch:check`. It verifies local production handoff, ChatGPT account auth, Image 2 account handoff, public HTTPS MCP, managed OAuth/JWKS, and ChatGPT Developer Mode registration.
- A launch smoke test is available in advanced settings and through `GET /api/launch-smoke-test`. It calls the local/public ChatGPT app manifest, OAuth resource metadata, MCP tools/list, widget resource, and managed OAuth metadata/JWKS so operators can confirm the app contract before testing in ChatGPT.
- Commercial launch metadata is editable from the dashboard advanced settings and through `GET/POST /api/launch-config`. It saves only non-secret public endpoints and readiness markers in `.env.local`; API keys, OAuth client secrets, and access tokens are never collected by this flow.

## UI Interface / UI界面

- The visual target is saved at `design/dashboard-concept.png`.
- Preview media uses `public/assets/fruit-drama-preview.png`.
- The interface is an internal operator dashboard, not a marketing landing page.

## Backend / 后端

- `lib/factory-core.mjs` implements the mock VideoRecipe engine, episode generator, caption formatter, and file writer.
- `lib/backend-api.mjs` exposes the local API used by the dashboard when the backend is running.
- `lib/artifact-bundle.mjs` creates per-episode publish bundles with captions, hashtags, voiceover copy, shot prompts, an Image 2 account-auth handoff, and a manifest.
- `lib/production-pipeline.mjs` orchestrates real local production: generate content, render MP4 files, approve rendered episodes, and build publish bundles.
- `lib/product-readiness.mjs` verifies the operator-facing production state without reading or printing secrets.
- `lib/launch-preflight.mjs` builds the commercial launch checklist and reports blockers without exposing secrets.
- `lib/launch-smoke-test.mjs` validates the ChatGPT app manifest, OAuth resource metadata, MCP tool descriptors, and widget resource against the current local/public origin.
- `lib/image2-assets.mjs` stores ChatGPT/Image 2 generated stills through account-auth MCP calls and writes per-episode asset manifests without using an Image API key.
- `POST /api/reference` accepts a web-uploaded image/video reference, validates type and size, persists it, and updates project state.
- `lib/chatgpt-app-mcp.mjs` exposes a ChatGPT Apps / MCP surface: JSON-RPC tools, widget resource metadata, OAuth protected-resource metadata, and Image 2 account-auth handoff access.
- `lib/chatgpt-oauth-dev.mjs` provides two account-auth paths: a local development OAuth 2.1 / PKCE issuer, plus production OAuth/OIDC JWT verification through a configured JWKS URI.
- `lib/openai-director.mjs` contains the live OpenAI director adapter boundary: Responses structured output, safe live-access diagnostics, image payloads, TTS payloads, and factory-project normalization.
- `lib/ollama-director.mjs` contains the local LLM adapter boundary: Ollama model readiness, structured JSON recipe generation, and normalization into the same production project shape.
- `lib/provider-plan.mjs` models the recommended provider pipeline and checks whether `OPENAI_API_KEY` or the non-secret `CHATGPT_ACCOUNT_VERIFIED` marker is configured without printing secret values.
- `scripts/generate-batch.mjs` writes project state to `storage/projects/<project_id>/` and dashboard state to `public/factory-state.json`.
- `scripts/api-server.mjs` serves backend endpoints at `http://127.0.0.1:3030/api`.
- `scripts/start-production.mjs` serves the built React dashboard plus API, MCP, OAuth, widget, and artifact routes from one production origin.
- `scripts/bundle-episode.mjs` builds a publish bundle for an episode.
- `scripts/produce-video.mjs` runs the full backend production job from the CLI.
- `scripts/openai-dry-run.mjs` validates the OpenAI request plan without sending a live API request.
- `scripts/provider-status.mjs` prints safe provider readiness metadata.
- `scripts/render-mock-video.mjs` uses local `ffmpeg-static` to render a packaged vertical MP4 with timed scene cards, timed captions, a progress bar, an AAC audio bed, and attached ChatGPT/Image 2 stills when an episode has `image2-assets/manifest.json`.

Local backend endpoints:

```text
GET  /api/health
GET  /api/project
GET  /api/providers
GET  /api/readiness
GET  /api/launch-preflight
GET  /api/launch-smoke-test
GET  /api/launch-config
GET  /api/chatgpt/app-manifest
GET  /.well-known/oauth-protected-resource
GET  /oauth-placeholder/.well-known/oauth-authorization-server
GET  /oauth-placeholder/authorize
GET  /chatgpt-app/widget.html
POST /mcp
POST /oauth-placeholder/token
POST /oauth-placeholder/register
POST /api/reference
POST /api/project/save
POST /api/project/duplicate
POST /api/episode
POST /api/generate
POST /api/chatgpt/account-dry-run
POST /api/chatgpt/account-verification
POST /api/launch-config
POST /api/openai/dry-run
POST /api/openai/live-check
POST /api/ollama/live-check
POST /api/produce
POST /api/render
POST /api/image2-assets
POST /api/bundle
GET  /api/artifact/:project/:episode/final.mp4
GET  /api/artifact/:project/:episode/publish-bundle/manifest.json
GET  /api/artifact/:project/:episode/publish-bundle/image2-handoff.json
GET  /api/artifact/:project/:episode/image2-assets/manifest.json
GET  /api/artifact/:project/:episode/image2-assets/:file
GET  /api/artifact/:project/reference/:file
GET  /api/artifact/:project/production-manifest.json
GET  /api/artifact/:project/production-package.tar.gz
```

## Production Deployment / 生产部署

Build and run the commercial single-origin server:

```bash
npm ci
npm run build
HOST=0.0.0.0 PORT=3030 npm start
```

`npm start` serves `dist/` and all backend routes from the same origin: `/api/*`, `/mcp`, `/.well-known/oauth-protected-resource`, `/oauth-placeholder/*`, `/chatgpt-app/widget.html`, and artifact downloads. This is the deployment shape to put behind a public HTTPS reverse proxy or a managed container platform. Set `PUBLIC_MCP_ORIGIN` to that final HTTPS origin, not to a localhost URL.

Docker deployment:

```bash
docker build -t ai-short-video-factory .
docker run --rm -p 3030:3030 \
  -e PUBLIC_MCP_ORIGIN=https://your-public-mcp-origin.example \
  -e CHATGPT_ACCOUNT_VERIFIED=true \
  -e CHATGPT_OAUTH_ISSUER=https://your-auth-provider.example/issuer \
  -e CHATGPT_OAUTH_JWKS_URI=https://your-auth-provider.example/.well-known/jwks.json \
  ai-short-video-factory
```

Do not bake `.env.local`, API keys, OAuth client secrets, or access tokens into the image. `.dockerignore` excludes local env files and generated output; mount durable storage for `outputs/`, `storage/`, and `public/factory-state.json` if the deployment platform resets container filesystems.

## Content System / 内容系统

- Core schema: `VideoRecipe`, episodes, shots, assets, generation jobs, review gates, captions, hashtags, and originality rules.
- Default web provider mode prefers OpenAI prompt generation when `OPENAI_API_KEY` is configured; local content generation remains available as a fallback and explicit operator mode.
- Custom operator topics now shape local titles, worlds, hooks, visual prompts, and hashtags, so the product creates topic-specific drafts even before live OpenAI credentials are approved.
- OpenAI director readiness and ChatGPT account-auth readiness are visible in the UI and generated JSON. The live key workflow remains gated by secure approval before any secret is created or written.
- ChatGPT MCP app readiness is now a required product check. The app exposes five tools: `get_product_readiness`, `create_short_video_project`, `produce_short_video`, `get_image2_handoff`, and `attach_image2_assets`.

## Provider Setup / Provider设置

```bash
npm run providers
npm run openai:dry-run
```

Safe local secret target:

```text
.env.local
OPENAI_API_KEY=<created through the secure Codex/OpenAI Platform flow>
CHATGPT_ACCOUNT_VERIFIED=true
CHATGPT_APP_REGISTERED=true
```

`OPENAI_API_KEY` must be approved through the local-save prompt before the backend can switch from mock director status to OpenAI-ready status. `CHATGPT_ACCOUNT_VERIFIED=true` is a non-secret local readiness marker that allows the local OAuth issuer to complete a PKCE authorization flow. MCP account-auth tools still require a valid Bearer token from that flow. The app never prints keys or secrets.

Commercial ChatGPT Apps / MCP deployment should use a managed OAuth/OIDC issuer instead of the local development issuer:

```text
CHATGPT_OAUTH_ISSUER=https://your-auth-provider.example/issuer
CHATGPT_OAUTH_JWKS_URI=https://your-auth-provider.example/.well-known/jwks.json
CHATGPT_OAUTH_AUTHORIZE_URL=https://your-auth-provider.example/authorize
CHATGPT_OAUTH_TOKEN_URL=https://your-auth-provider.example/token
CHATGPT_OAUTH_REGISTER_URL=https://your-auth-provider.example/register
CHATGPT_OAUTH_METADATA_URL=https://your-auth-provider.example/.well-known/oauth-authorization-server
CHATGPT_OAUTH_AUDIENCE=https://your-public-mcp-origin.example/mcp
PUBLIC_MCP_ORIGIN=https://your-public-mcp-origin.example
```

When `CHATGPT_OAUTH_ISSUER` and `CHATGPT_OAUTH_JWKS_URI` are configured, `/mcp` verifies RS256 account-auth access tokens against the managed provider JWKS. Image 2 handoff remains account-auth based and does not use an OpenAI API key.

Set `CHATGPT_APP_REGISTERED=true` only after the public MCP server has been registered and tested in ChatGPT Developer Mode. It is a non-secret readiness marker, not a credential.

The provider adapters are wired for:

- Responses API structured output: `VideoRecipe`, episode scripts, shot prompts, captions, hashtags.
- OpenAI Videos API: optional advanced renderer that creates a `/v1/videos` job, polls it, downloads `/v1/videos/{video_id}/content`, and writes the standard `final.mp4` artifact.
- Image 2 account-auth handoff: per-shot `gpt-image-2` prompt manifest using ChatGPT Apps OAuth/MCP readiness, not an API key.
- Image 2 asset intake: authenticated ChatGPT can attach generated stills back to the backend through `attach_image2_assets`; stored asset manifests travel with the publish bundle and package, and the local MP4 renderer composites valid stills into the matching shot windows.
- Image generation payloads: 9:16 shot stills when an API provider is explicitly used.
- TTS payloads: narrator voiceover.
- Local FFmpeg packaging: final MP4 output.

如果 UI 选择 OpenAI director mode，`Validate OpenAI fallback plan` 会调用 `POST /api/openai/live-check`。没有配置 key 时它只返回缺少 key 的诊断，不发送真实请求；有 key 时它只发送一次很小的 Responses API 检查，并把 quota、rate-limit、auth、model-access、network 或 API failure 分类返回，同时不暴露 secret。真实生产流程在 live provider 不可用时仍会回退到本地 FFmpeg MP4 渲染。

If OpenAI director mode is selected in the UI, `Validate OpenAI fallback plan` calls `POST /api/openai/live-check`. Without a configured key it returns a missing-key diagnostic and sends no live request; with a key it sends one tiny Responses API check and classifies quota, rate-limit, auth, model-access, network, or API failures without exposing the secret. Full production still falls back to local FFmpeg MP4 rendering when the live provider is unavailable.

如果 UI 选择 Local LLM (Ollama)，`Validate Local LLM plan` 会调用 `POST /api/ollama/live-check` 检查本机 Ollama 服务和 `OLLAMA_MODEL` 是否可用。通过后，`Create content + video` 会让本机 LLM 生成 `VideoRecipe`、episode、caption、shot prompt 和 voiceover，再由本地 FFmpeg 渲染 MP4。

If Local LLM (Ollama) is selected in the UI, `Validate Local LLM plan` calls `POST /api/ollama/live-check` to check the local Ollama service and configured `OLLAMA_MODEL`. When it passes, `Create content + video` asks the local LLM to generate the `VideoRecipe`, episodes, captions, shot prompts, and voiceover, then local FFmpeg renders the MP4 files.

If ChatGPT account mode is selected, the app validates `/api/chatgpt/account-dry-run`. Operators can save or clear the non-secret account verification marker through `/api/chatgpt/account-verification`. The backend also exposes a ChatGPT Apps / MCP contract at `/mcp`; unauthenticated account-auth tools return an `mcp/www_authenticate` challenge that points ChatGPT to `/.well-known/oauth-protected-resource`. In development, ChatGPT can use the local OAuth 2.1 / PKCE issuer to obtain a scoped Bearer token. In production, ChatGPT should use the configured managed OAuth/OIDC provider and the backend verifies the JWT with JWKS. With a valid token, the MCP tools can create content, render local MP4 output, return the `gpt-image-2` handoff, and attach ChatGPT/Image 2 generated stills back into the production package without using an OpenAI API key for Image 2.

ChatGPT app discovery and local developer mode endpoints:

```text
GET  /api/chatgpt/app-manifest
GET  /.well-known/oauth-protected-resource
GET  /oauth-placeholder/.well-known/oauth-authorization-server
GET  /oauth-placeholder/authorize
GET  /chatgpt-app/widget.html
POST /mcp
POST /oauth-placeholder/token
POST /oauth-placeholder/register
```

For local ChatGPT Developer Mode testing, run `npm run api`, expose `http://127.0.0.1:3030/mcp` through an HTTPS tunnel, then add the tunneled `/mcp` URL as the app server in ChatGPT. For commercial deployment, run `npm run build && npm start` and register the public HTTPS `/mcp` endpoint from the single-origin production server. Refresh the app in ChatGPT after changing tool descriptors or widget metadata.

## Run Locally / 本地运行

Terminal 1:

```bash
npm run api
```

Terminal 2:

```bash
npm run dev
```

Open:

```text
http://127.0.0.1:3024/
```

When the API is running, the dashboard uses the backend to generate project files and trigger the mock MP4 render. When the API is offline, the dashboard keeps working in static local-state mode.

Review gate changes and render completion persist through the backend API when `npm run api` is online, so the dashboard, `storage/`, `outputs/`, and publish bundles stay in sync.

The generation form sends the edited concept/hook, selected source mode, uploaded source asset metadata, and requested episode count to the backend. Static fallback mode uses the same inputs in browser state, but source file upload requires the backend API.

Local generation is topic-aware in both backend and browser fallback mode. For example, `AI robot bakery courtroom drama` produces robot/bakery/courtroom episode titles and shot prompts instead of the default fruit-drama bank.

The dashboard also supports URL-prefilled generation inputs:

```text
http://127.0.0.1:3024/?topic=AI%20robot%20bakery%20courtroom%20drama&count=3&source=text
```

## Production Output / 生产输出

Create content and rendered MP4 videos in one command:

```bash
npm run produce -- --topic "AI robot bakery courtroom drama" --count 3
```

The web app exposes the same workflow through `Create content + video`. By default it renders the whole requested batch; advanced render count is only an operator override for partial QA runs.

Every production run writes a batch handoff manifest:

```text
outputs/demo-reference/production-manifest.json
```

Every production run also writes one downloadable batch archive:

```text
outputs/demo-reference/production-package.tar.gz
```

The preview panel can open/download the rendered MP4, open the episode publish manifest, open the Image 2 handoff, attach ChatGPT/Image 2 stills, rerender the selected MP4, and open the attached asset manifest. The generation panel can open the batch production manifest and download the full production package.

The readiness API and UI card check the production handoff before delivery, including optional uploaded reference assets when present:

```text
GET /api/readiness
```

The readiness response also reports the ChatGPT MCP app endpoint, OAuth protected-resource path, OAuth authorization-server path, production OAuth verifier status, public MCP origin status, scopes, and tool names so the web product can distinguish local production readiness from commercial launch readiness. `ready` means the local production pipeline is deliverable; `commercial_ready` means the public HTTPS ChatGPT app connector and managed OAuth gates are also satisfied.

After ChatGPT/Image 2 creates shot stills from the handoff prompts, the account-auth MCP tool can attach them to an episode:

```text
POST /mcp
tool: attach_image2_assets
```

The same intake is available to operators in the web app through `Attach Image 2 stills` in the preview export panel. It calls:

```text
POST /api/image2-assets
```

Stored files appear under:

```text
outputs/demo-reference/episode-001/image2-assets/manifest.json
outputs/demo-reference/episode-001/image2-assets/shot-001.png
```

Run the contract smoke test after changing ChatGPT app or launch metadata:

```text
GET /api/launch-smoke-test
```

The smoke test checks the local MCP contract immediately. If `PUBLIC_MCP_ORIGIN` is configured, it also checks the public HTTPS contract. If managed OAuth is configured, it loads the authorization-server metadata and JWKS, checks the authorization-code endpoints, verifies `shortvideo:write` and `image2:handoff` scopes, and requires at least one RS256-capable RSA signing key.

## Packaged Output / 打包输出

```bash
npm run packaged
npm run bundle -- --episode episode-001
```

Rendered MP4 output:

```text
outputs/demo-reference/episode-001/final.mp4
```

Publish bundle output:

```text
outputs/demo-reference/episode-001/publish-bundle/manifest.json
outputs/demo-reference/episode-001/publish-bundle/image2-handoff.json
```

## Verification / 验证

```bash
npm test
npm run build
npm start
npm run providers
npm run launch:check
npm run openai:dry-run
npm run api
npm run produce -- --topic "AI cartoon fruit drama" --count 5
npm run bundle -- --episode episode-001
```

## Next API Integrations / 后续真实API接入

- OpenAI Responses API: recipe and script generation.
- ChatGPT Apps OAuth 2.1 / MCP account-auth: account-verified ChatGPT route with scoped Bearer tokens from local PKCE in development or managed OAuth/OIDC JWKS verification in production.
- Image 2 account-auth handoff: `gpt-image-2` prompt manifests through the ChatGPT app account route, not an OpenAI API key.
- Image 2 account-auth asset intake: `attach_image2_assets` stores ChatGPT-generated stills in the backend package without an OpenAI Image API key; local FFmpeg production uses those stills in the final MP4 when present.
- OpenAI TTS or another voice provider: voiceover.
- Kling, Runway, Luma, Pika, ComfyUI, or other provider adapters: additional image-to-video clips.
- FFmpeg: final local MP4 package.
