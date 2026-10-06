# Product Spec / 产品说明

## 中文

`AI Short Video Factory` 的定位是“短视频配方提取 + 批量原创变体 + 本地视频渲染 + 自动包装输出”。它不复制参考视频，而是提取结构、节奏、字幕风格、镜头逻辑和原创性约束，再生成新的短视频内容，并用本地 FFmpeg 输出带分镜节奏、定时字幕和音频轨的可播放 MP4。

### Frontend / 前端

React Dashboard 提供一个实际可用的操作台：左侧项目导航，中间是 `VideoRecipe` 编辑与生成控制，下方是 episode 审核列表，右侧是竖屏预览与导出面板。

Concept / Hook、source mode、上传的 screenshot/reference video、episode count、provider mode、account verification、render count、duration override 和 video renderer 现在会进入真实生成请求；API 在线时写入后端项目状态，API 离线时使用同样输入生成浏览器本地草稿。本地生成器也会根据自定义 topic 生成对应的标题、世界观、hook、视觉提示词和 hashtags，而不是只返回默认 fruit-drama 素材；选择 Local LLM (Ollama) 时，后端会让本机模型生成结构化 `VideoRecipe` 和 episode 内容，再进入同一套 MP4 渲染流程。核心 web 操作是 `Create content + video`：一次请求生成内容、默认渲染整批 MP4、构建 publish bundle、写入 Image 2 handoff 文件，并在预览区播放后端产物；advanced render count 只用于操作员做部分 QA run。Preview export panel 现在可以直接上传 ChatGPT/Image 2 stills，后端会把图片附加到选中的 episode、重新渲染 MP4、刷新生产压缩包，并开放 Image 2 asset manifest。Generation panel 还会显示产品 readiness：参考素材、内容、MP4、发布包、Image 2 handoff、Image 2 assets、ChatGPT MCP app、批量 manifest、下载压缩包、可选 OpenAI live mode、本机 Ollama LLM 和 ChatGPT account mode 是否就绪。UI 现在区分 `Local production ready` 和 `Commercial ready`：本地生产可用不等于商用发布完成；商用发布还需要 public HTTPS MCP origin、托管 OAuth/OIDC JWKS、ChatGPT account verification 和 ChatGPT Developer Mode app registration。

操作员也可以通过 URL 预填生成参数，例如 `?topic=...&count=3&source=text`。

### UI Interface / UI界面

界面遵循深色操作台风格，信息密度高但可扫描。核心交互包括：

- Analyze reference：分析参考来源。
- Generate batch：生成批量 episode。
- Provider mode：选择 Local production、ChatGPT account 或 OpenAI API key。
- Save / Duplicate：Save 会把当前项目状态和 save receipt 写入本地文件；Duplicate 会创建可审计的 duplicate snapshot。
- Settings / Notifications：Settings 打开高级生产配置；Notifications 显示本地生产状态、launch blockers、MP4 与 Image 2 handoff 数量。
- Save account verification：保存或清除非 secret 的 ChatGPT 账号验证标记。
- ChatGPT app / OAuth metadata：打开本地 ChatGPT Apps MCP manifest、OAuth protected-resource metadata 与 authorization-server metadata。
- Review gate：审核通过或退回。
- Render MP4：标记当前 episode 进入打包输出。
- Create content + video：生成内容并渲染真实 MP4 文件。
- Attach Image 2 stills：上传 ChatGPT/Image 2 生成图，重新渲染当前 episode，并刷新生产包。
- Export captions / Copy hashtags：导出发布素材。

### Backend / 后端

后端当前是本地文件与脚本：

- `backend-api.mjs` 提供本地 API：health、project、project save、project duplicate、providers、readiness、reference upload、generate、produce、render、Image 2 asset attach、OpenAI dry-run、ChatGPT account dry-run、ChatGPT account verification、ChatGPT app manifest、MCP JSON-RPC、OAuth protected-resource metadata、OAuth authorization/token/register 端点、artifact streaming。
- `chatgpt-app-mcp.mjs` 提供 ChatGPT Apps / MCP 合约：`/mcp`、`/api/chatgpt/app-manifest`、`/.well-known/oauth-protected-resource`、widget HTML、五个工具描述与 account-auth challenge。
- `chatgpt-oauth-dev.mjs` 提供两条账号认证路径：本地开发 OAuth 2.1 / PKCE issuer，以及通过配置 `CHATGPT_OAUTH_ISSUER` 和 `CHATGPT_OAUTH_JWKS_URI` 启用的生产 OAuth/OIDC JWT + JWKS 验证。
- `production-pipeline.mjs` 串联真实生产流程：创建内容、渲染 MP4、更新 episode 状态、构建发布包。
- `production-pipeline.mjs` 还会写入批量生产交付清单与完整压缩包：`outputs/<project>/production-manifest.json`、`outputs/<project>/production-package.tar.gz`。
- `product-readiness.mjs` 检查真实生产交付状态，不读取或输出 secret 明文。
- `launch-preflight.mjs` 生成商用发布 checklist：local production handoff、ChatGPT account auth、Image 2 account handoff、public HTTPS MCP、managed OAuth/JWKS、ChatGPT Developer Mode registration。
- `artifact-bundle.mjs` 为每个 episode 生成发布包：字幕、hashtags、旁白文案、shot prompts、Image 2 account-auth handoff 和 manifest。
- `openai-director.mjs` 提供真实 OpenAI director adapter 边界：Responses structured output、图片 payload、TTS payload、以及转换为 factory project 的逻辑。
- `generate-batch.mjs` 生成 recipe、episodes、shots、captions、hashtags、jobs。
- `provider-plan.mjs` 定义推荐的 provider pipeline：ChatGPT account-auth、OpenAI director、图片生成、image-to-video、TTS、FFmpeg package。
- `provider-status.mjs` 只输出安全状态，不输出任何 secret。
- `render-mock-video.mjs` 使用 FFmpeg 生成 9:16 MP4，包含按 shot 切换的画面卡、定时字幕、进度条、AAC 音频轨，以及已通过账号认证回传的 Image 2 stills。
- `start-production.mjs` 提供单 origin 生产服务器：同一服务同时托管 built dashboard、`/api/*`、`/mcp`、OAuth metadata、widget 和 artifact 下载，适合放到公网 HTTPS 反向代理或容器平台后面。
- `produce-video.mjs` 从 CLI 执行完整的内容 + 视频生产任务。
- `factory-core.mjs` 保持状态机与内容结构，可被测试和未来 API provider 复用。
- `factory-core.mjs` 的 mock 内容生成已经 topic-aware；例如 `AI robot bakery courtroom drama` 会生成 robot / bakery / courtroom 相关的 episode 草稿。

### Other Parts / 其他部分

- Local providers 默认可用，不需要 API key。
- OpenAI API key 只能通过安全审批流程写入 `.env.local`；审批未通过时，产品保持 mock 模式但会显示 provider readiness。
- ChatGPT account mode 走 ChatGPT Apps OAuth 2.1 / MCP 的账号认证路线；本地用非 secret 的 `CHATGPT_ACCOUNT_VERIFIED=true` 标记允许本地 OAuth issuer 完成 PKCE 授权，不把 ChatGPT 网页自动点击当作后端。
- 商业部署需要配置托管 OAuth/OIDC provider：`CHATGPT_OAUTH_ISSUER`、`CHATGPT_OAUTH_JWKS_URI`，以及可选的 authorize/token/register/metadata URL；还需要 `PUBLIC_MCP_ORIGIN=https://...` 形式的公网 HTTPS MCP origin。配置后，MCP 会验证 provider 签发的 RS256 JWT，而不是接受本地开发 token。
- ChatGPT MCP app 已经暴露五个工具：`get_product_readiness`、`create_short_video_project`、`produce_short_video`、`get_image2_handoff`、`attach_image2_assets`。未认证调用会返回 `mcp/www_authenticate` challenge；MCP 工具调用必须带有 scoped Bearer token；认证后可以通过 account-auth 路线生成内容、渲染本地 MP4、读取 `gpt-image-2` handoff，并把 ChatGPT/Image 2 生成的 stills 回传到生产包，Image 2 不使用 OpenAI API key。
- UI 选择 OpenAI director 但没有 key 时，只会执行 dry-run validation，不会发送真实 OpenAI 请求。
- UI 选择 ChatGPT account 时会执行 `/api/chatgpt/account-dry-run`；账号认证未完成时仍继续使用本地内容生成和 FFmpeg 输出真实 MP4。
- UI 可以通过 `/api/chatgpt/account-verification` 保存或清除非 secret 的账号验证标记。
- `npm run api` 启动本地开发后端后，前端会调用后端写入项目文件并触发 MP4 render；后端不在线时，前端自动回退到静态本地状态。`npm run build && npm start` 启动商用部署形态的单 origin 生产服务器。
- Review gate 与 render 状态会通过后端 API 持久化，避免只停留在浏览器状态。
- `/api/project/save` 会重新写入 project state、dashboard state 和 `save-receipt.json`；`/api/project/duplicate` 会在 `storage/projects/<project>/duplicates/` 下写入 duplicate snapshot 与 manifest。
- `outputs/` 保存每条视频的 metadata、字幕和 MP4。
- `outputs/<project>/<episode>/publish-bundle/` 保存发布包，方便直接交给运营或发布流程。
- `/api/artifact/<project>/<episode>/final.mp4` 让 web 预览区播放已经渲染的本地 MP4。
- `/api/artifact/<project>/<episode>/publish-bundle/manifest.json` 和 `/api/artifact/<project>/production-manifest.json` 让 web 界面直接打开发布清单与批量交付清单。
- `/api/artifact/<project>/production-package.tar.gz` 让 web 界面直接下载完整生产包。
- `/api/reference` 保存 web 上传的截图或参考视频到 `storage/projects/<project_id>/reference-assets/`，并把 `source_asset` 元数据写入 project state、production manifest 和 publish bundle。
- `/api/readiness` 返回产品交付检查结果：参考素材、内容、MP4、publish bundle、Image 2 handoff、ChatGPT MCP app、OAuth PKCE issuer、public HTTPS MCP、production OAuth verifier、production manifest、production package、可选 OpenAI live mode 和 ChatGPT account mode。`ready` 表示本地生产交付可用；`commercial_ready` 只有在公网 HTTPS MCP、托管 OAuth/OIDC JWKS、ChatGPT account verification、ChatGPT app registration 都满足后才会为 true。
- `/api/launch-preflight` 和 `npm run launch:check` 返回商用发布 checklist，不输出 secret，只返回 env 名称、阶段状态、blockers、ChatGPT app endpoint、OAuth metadata 和 Image 2 handoff 状态。`/api/launch-smoke-test` 进一步验证本地/公网 MCP 合约、OAuth provider metadata、scopes 和 RS256 JWKS。
- `storage/` 保存项目状态，方便以后接数据库或队列。
- `public/factory-state.json` 给前端加载最新本地生成结果。

## English

`AI Short Video Factory` is a reference-to-video production engine: extract the content formula, generate original variations, render local video, and package vertical short-video outputs. It does not copy a reference video. It extracts structure, pacing, caption style, shot logic, and originality constraints, then creates new content plus playable MP4 files with timed scenes, timed captions, and an audio track.

### Frontend

The React dashboard is the real operator surface: project navigation, `VideoRecipe` editor, generation controls, episode review list, and a vertical preview/export inspector.

Concept / Hook, source mode, uploaded screenshot/reference video, episode count, provider mode, account verification, render count, duration override, and video renderer now feed the generation request. When the API is online, they write backend project state; when offline, the same inputs produce local browser drafts. The local generator also uses custom topics to shape titles, worlds, hooks, visual prompts, and hashtags instead of returning only the default fruit-drama material; when Local LLM (Ollama) is selected, the backend asks the on-machine model for structured `VideoRecipe` and episode content before using the same MP4 renderer. The core web action is `Create content + video`: one request generates content, renders the full requested MP4 batch by default, builds publish bundles, writes an Image 2 handoff file, and plays the backend artifact in the preview area; advanced render count is only an operator override for partial QA runs. The preview export panel can now upload ChatGPT/Image 2 stills, attach them to the selected episode, rerender the MP4, refresh the production archive, and expose the Image 2 asset manifest. The generation panel also shows product readiness for reference assets, content, MP4 output, publish bundles, Image 2 handoff, Image 2 assets, the ChatGPT MCP app, the batch manifest, the downloadable archive, optional OpenAI live mode, local Ollama LLM, and ChatGPT account mode. The UI now separates `Local production ready` from `Commercial ready`: working local production does not mean launch is complete; launch also needs a public HTTPS MCP origin, managed OAuth/OIDC JWKS, ChatGPT account verification, and ChatGPT Developer Mode app registration.

Operators can also prefill generation parameters through the URL, such as `?topic=...&count=3&source=text`.

### UI Interface

The UI is a restrained dark operations dashboard with dense but scannable sections. Core interactions:

- Analyze reference.
- Generate batch.
- Provider mode: Local production, ChatGPT account, or OpenAI API key.
- Save / Duplicate: Save writes the current project state plus a save receipt; Duplicate writes an auditable duplicate snapshot.
- Settings / Notifications: Settings opens advanced production controls; Notifications shows local production status, launch blockers, MP4 counts, and Image 2 handoff counts.
- Save account verification: save or clear the non-secret ChatGPT account verification marker.
- ChatGPT app / OAuth metadata: open the local ChatGPT Apps MCP manifest, OAuth protected-resource metadata, and authorization-server metadata.
- Approve or return review gates.
- Render MP4.
- Create content + video.
- Attach Image 2 stills: upload ChatGPT/Image 2 generated stills, rerender the current episode, and refresh the production package.
- Export captions and hashtags.

### Backend

The current backend is local and file-backed:

- `backend-api.mjs` provides local API endpoints: health, project, project save, project duplicate, providers, readiness, reference upload, generate, produce, render, Image 2 asset attach, OpenAI dry-run, ChatGPT account dry-run, ChatGPT account verification, ChatGPT app manifest, MCP JSON-RPC, OAuth protected-resource metadata, OAuth authorization/token/register endpoints, and artifact streaming.
- `chatgpt-app-mcp.mjs` provides the ChatGPT Apps / MCP contract: `/mcp`, `/api/chatgpt/app-manifest`, `/.well-known/oauth-protected-resource`, widget HTML, five tool descriptors, and account-auth challenges.
- `chatgpt-oauth-dev.mjs` provides two account-auth paths: the local development OAuth 2.1 / PKCE issuer and production OAuth/OIDC JWT + JWKS verification enabled by `CHATGPT_OAUTH_ISSUER` and `CHATGPT_OAUTH_JWKS_URI`.
- `production-pipeline.mjs` orchestrates the real production workflow: create content, render MP4, update episode state, and build publish bundles.
- `production-pipeline.mjs` also writes the batch production handoff manifest and full archive: `outputs/<project>/production-manifest.json`, `outputs/<project>/production-package.tar.gz`.
- `product-readiness.mjs` checks the real production handoff state without reading or printing plaintext secrets.
- `launch-preflight.mjs` builds the commercial launch checklist: local production handoff, ChatGPT account auth, Image 2 account handoff, public HTTPS MCP, managed OAuth/JWKS, and ChatGPT Developer Mode registration.
- `artifact-bundle.mjs` creates per-episode publish bundles: captions, hashtags, voiceover copy, shot prompts, an Image 2 account-auth handoff, and a manifest.
- `openai-director.mjs` provides the live OpenAI director adapter boundary: Responses structured output, image payloads, TTS payloads, and normalization into factory projects.
- `generate-batch.mjs` creates recipes, episodes, shots, captions, hashtags, and jobs.
- `provider-plan.mjs` defines the recommended provider pipeline: ChatGPT account-auth, OpenAI director, image generation, image-to-video, TTS, and FFmpeg packaging.
- `provider-status.mjs` prints safe status only and never prints secrets.
- `render-mock-video.mjs` renders a 9:16 MP4 through FFmpeg with shot-timed scene cards, timed captions, a progress bar, an AAC audio bed, and Image 2 stills returned through account-auth asset intake.
- `start-production.mjs` provides the single-origin production server: one service hosts the built dashboard, `/api/*`, `/mcp`, OAuth metadata, widget resources, and artifact downloads for use behind public HTTPS reverse proxies or container platforms.
- `produce-video.mjs` runs the complete content + video production job from the CLI.
- `factory-core.mjs` keeps the state machine and content structures reusable for tests and future providers.
- `factory-core.mjs` now has topic-aware mock content generation; for example, `AI robot bakery courtroom drama` creates robot / bakery / courtroom episode drafts.

### Other Parts

- Local providers work without API keys.
- The OpenAI API key can only be written to `.env.local` after secure approval. Until that approval succeeds, the product stays in mock mode while showing provider readiness.
- ChatGPT account mode follows the ChatGPT Apps OAuth 2.1 / MCP account-auth route. Local readiness uses the non-secret `CHATGPT_ACCOUNT_VERIFIED=true` marker to let the local OAuth issuer complete PKCE authorization; the backend does not automate the consumer ChatGPT web UI.
- Commercial deployment requires a managed OAuth/OIDC provider with `CHATGPT_OAUTH_ISSUER`, `CHATGPT_OAUTH_JWKS_URI`, optional authorize/token/register/metadata URLs, and `PUBLIC_MCP_ORIGIN=https://...` for the public HTTPS MCP origin. When configured, MCP verifies RS256 JWTs from that provider instead of accepting local development tokens.
- The ChatGPT MCP app now exposes five tools: `get_product_readiness`, `create_short_video_project`, `produce_short_video`, `get_image2_handoff`, and `attach_image2_assets`. Unauthenticated calls return an `mcp/www_authenticate` challenge; MCP tool calls must include a scoped Bearer token; authenticated calls can create content, render local MP4 output, read the `gpt-image-2` handoff, and attach ChatGPT/Image 2 generated stills back into the production package through the account-auth route without using an OpenAI API key for Image 2.
- When OpenAI director is selected in the UI without a key, the app only runs dry-run validation and does not send a live OpenAI request.
- When ChatGPT account is selected in the UI, the app runs `/api/chatgpt/account-dry-run`; until account auth is complete, it still uses local generation and FFmpeg to create real MP4 output.
- The UI can save or clear the non-secret account verification marker through `/api/chatgpt/account-verification`.
- When `npm run api` is running, the frontend calls the backend to write project files and trigger MP4 renders. When the backend is offline, the frontend falls back to static local state. `npm run build && npm start` runs the commercial single-origin server.
- Review gate and render status changes persist through the backend API instead of staying only in browser state.
- `/api/project/save` rewrites project state, dashboard state, and `save-receipt.json`; `/api/project/duplicate` writes a duplicate snapshot plus manifest under `storage/projects/<project>/duplicates/`.
- `outputs/` stores metadata, captions, and MP4 files.
- `outputs/<project>/<episode>/publish-bundle/` stores the publishing package for operator handoff.
- `/api/artifact/<project>/<episode>/final.mp4` lets the web preview play rendered local MP4 files.
- `/api/artifact/<project>/<episode>/publish-bundle/manifest.json` and `/api/artifact/<project>/production-manifest.json` let the web UI open the episode publish manifest and batch handoff manifest directly.
- `/api/artifact/<project>/production-package.tar.gz` lets the web UI download the complete production package.
- `/api/reference` stores web-uploaded screenshots or reference videos under `storage/projects/<project_id>/reference-assets/` and writes `source_asset` metadata into project state, the production manifest, and publish bundles.
- `/api/readiness` returns delivery checks for reference assets, content, MP4 files, publish bundles, Image 2 handoff, the ChatGPT MCP app, the OAuth PKCE issuer, public HTTPS MCP, the production OAuth verifier, the production manifest, the production package, optional OpenAI live mode, and ChatGPT account mode. `ready` means the local production handoff is usable; `commercial_ready` only becomes true when public HTTPS MCP, managed OAuth/OIDC JWKS, ChatGPT account verification, and ChatGPT app registration are all satisfied.
- `/api/launch-preflight` and `npm run launch:check` return the commercial launch checklist without printing secrets: env names, stage status, blockers, ChatGPT app endpoint, OAuth metadata, and Image 2 handoff state. `/api/launch-smoke-test` further verifies the local/public MCP contract, OAuth provider metadata, scopes, and RS256 JWKS.
- `storage/` stores project state so it can later move to a database or queue.
- `public/factory-state.json` lets the frontend load the latest generated local state.
