# 工作区包索引

基准提交：`2e0e963670e5435a2909149fff1f83b93f8ffd11`。

由当前工作目录生成，包含未提交的新文件，排除已删除文件和 Git 忽略文件。含 72 个具名包，不含仓库根包。
目录不一定都是可独立启动的应用。脚本和依赖以对应 package.json 为准。

| 目录 | 包名 | 上游说明 | 可用脚本 |
| --- | --- | --- | --- |
| [apps/component-calling](../airi/apps/component-calling/package.json) | @proj-airi/component-calling | Realtime audio | dev, build, preview, typecheck |
| [apps/stage-pocket](../airi/apps/stage-pocket/package.json) | @proj-airi/stage-pocket | LLM powered virtual character | build, lint, lint:swift, preview, typecheck, dev:web, dev:ios, dev:android |
| [apps/stage-tamagotchi](../airi/apps/stage-tamagotchi/package.json) | @proj-airi/stage-tamagotchi | LLM powered virtual character | lint, typecheck, app:dev, app:build, start, start:xwayland, dev, dev:xwayland, build, postinstall, build:unpack, build:flatpak, build:win, build:mac, build:linux, rename-artifacts, merge-latest-mac, regenerate-windows-latest, artifacts-metadata, smoke:desktop-overlay-live-window, update-test:generate, update-test:server, update-test:matrix |
| [apps/stage-web](../airi/apps/stage-web/package.json) | @proj-airi/stage-web | LLM powered virtual character | build, dev, dev:https, lint, preview, test, test:run, typecheck |
| [apps/ui-server-auth](../airi/apps/ui-server-auth/package.json) | @proj-airi/ui-server-auth | Auth UI for Project AIRI | build, dev, lint, preview, typecheck |
| [docs](../airi/docs/package.json) | @proj-airi/docs |  | build, build:base, dev, preview, typecheck, contributors |
| [engines/stage-tamagotchi-godot](../airi/engines/stage-tamagotchi-godot/package.json) | @proj-airi/stage-tamagotchi-godot | Godot-native desktop stage runtime workspace engine for stage-tamagotchi | build, typecheck, test, dump:render-stages, dump:render-stages:upper-body |
| [integrations/satori-bot](../airi/integrations/satori-bot/package.json) | @proj-airi/satori-bot | Satori protocol adapter for AIRI - Connect to multiple chat platforms via Satori | start, dev, typecheck, db:generate, db:push |
| [integrations/telegram-bot](../airi/integrations/telegram-bot/package.json) | @proj-airi/telegram-bot | Telegram bot for AIRI | start, db:generate, db:push, script:embed-chat, typecheck |
| [integrations/vscode/airi-plugin-vscode](../airi/integrations/vscode/airi-plugin-vscode/package.json) | @proj-airi/airi-plugin-vscode | AIRI host plugin that bridges VS Code context and UI | dev, build, typecheck |
| [integrations/vscode/vscode-airi](../airi/integrations/vscode/vscode-airi/package.json) | vscode-airi | Adapter that connects VSCode into Project AIRI | prepare, update, dev, build, publish, typecheck |
| [packages/audio](../airi/packages/audio/package.json) | @proj-airi/audio | Audio processing utilities for Project AIRI | dev, build, typecheck, test:run |
| [packages/better-ws](../airi/packages/better-ws/package.json) | @proj-airi/better-ws | Transport-agnostic reliable WebSocket runtime primitives | build, dev, test, typecheck |
| [packages/cap-vite](../airi/packages/cap-vite/package.json) | @proj-airi/cap-vite | CLI that starts a Vite dev server and runs Capacitor live reload | build, test, typecheck |
| [packages/ccc](../airi/packages/ccc/package.json) | @proj-airi/ccc |  | test, test:watch, lint, lint:fix, typecheck |
| [packages/core-agent](../airi/packages/core-agent/package.json) | @proj-airi/core-agent | Core agent runtime orchestration for AIRI | build, eval:run, typecheck |
| [packages/core-character](../airi/packages/core-character/package.json) | @proj-airi/core-character | Core character pipeline orchestration for AIRI (segmentation, emotion, delay, optional TTS) | build, typecheck |
| [packages/electron-eventa](../airi/packages/electron-eventa/package.json) | @proj-airi/electron-eventa | Shared Eventa contracts for Electron IPC | dev, build, typecheck |
| [packages/electron-screen-capture](../airi/packages/electron-screen-capture/package.json) | @proj-airi/electron-screen-capture | Screen capture | dev, build, typecheck |
| [packages/electron-vueuse](../airi/packages/electron-vueuse/package.json) | @proj-airi/electron-vueuse | VueUse-like composables and helpers for Electron apps | dev, build, typecheck |
| [packages/font-chillroundm](../airi/packages/font-chillroundm/package.json) | @proj-airi/font-chillroundm | Essential CSS for font, ChillRoundM (a.k.a. 寒蝉半圆体), used by Project AIRI | dev, build |
| [packages/font-cjkfonts-allseto](../airi/packages/font-cjkfonts-allseto/package.json) | @proj-airi/font-cjkfonts-allseto | Essential CSS for font, cjkfonts 全瀨體, used by Project AIRI | dev, build |
| [packages/font-departure-mono](../airi/packages/font-departure-mono/package.json) | @proj-airi/font-departure-mono | Essential CSS for font, Departure Mono, used by Project AIRI | dev, build |
| [packages/font-xiaolai](../airi/packages/font-xiaolai/package.json) | @proj-airi/font-xiaolai | Essential CSS for font, Xiaolai (小赖字体 / 小賴字體 / シャオライ / Xiaolai Font), used by Project AIRI | dev, build |
| [packages/i18n](../airi/packages/i18n/package.json) | @proj-airi/i18n | Internationalization (i18n) locales and utilities for Project AIRI | dev, build, glossary:build, test, test:watch, typecheck |
| [packages/input-gamepad](../airi/packages/input-gamepad/package.json) | @proj-airi/input-gamepad | Standard Gamepad API input for AIRI | build, test, typecheck |
| [packages/input-gamepad-vueuse](../airi/packages/input-gamepad-vueuse/package.json) | @proj-airi/input-gamepad-vueuse | Vue composables for AIRI gamepad input | build, test, typecheck |
| [packages/input-playstation-dualsense-5](../airi/packages/input-playstation-dualsense-5/package.json) | @proj-airi/input-playstation-dualsense-5 | WebHID input and output support for the PlayStation 5 DualSense controller | build, test, typecheck |
| [packages/local-vision](../airi/packages/local-vision/package.json) | @proj-airi/local-vision | Local camera service boundary and ephemeral vision policies | build, typecheck, test:run |
| [packages/memory-pgvector](../airi/packages/memory-pgvector/package.json) | @proj-airi/memory-pgvector |  | dev |
| [packages/model-driver-lipsync](../airi/packages/model-driver-lipsync/package.json) | @proj-airi/model-driver-lipsync |  | test, typecheck |
| [packages/model-driver-magic-live2d](../airi/packages/model-driver-magic-live2d/package.json) | @proj-airi/model-driver-magic-live2d | Live2D model driver for MAGIC motion | build, test, typecheck |
| [packages/model-driver-mediapipe](../airi/packages/model-driver-mediapipe/package.json) | @proj-airi/model-driver-mediapipe | MediaPipe motion capture workshop (experimental) for Project AIRI | typecheck, postinstall |
| [packages/motion-driver-magic](../airi/packages/motion-driver-magic/package.json) | @proj-airi/motion-driver-magic | Markovian Animation Generator with Illusory Conditioning for Project AIRI | build, test, typecheck |
| [packages/pipelines-audio](../airi/packages/pipelines-audio/package.json) | @proj-airi/pipelines-audio | Audio pipeline orchestration for AIRI (capture, VAD, encode, stream) | build, typecheck, test, test:run |
| [packages/plugin-protocol](../airi/packages/plugin-protocol/package.json) | @proj-airi/plugin-protocol | Plugin protocol event definitions and shared websocket types for Project AIRI | dev, build, typecheck |
| [packages/plugin-sdk](../airi/packages/plugin-sdk/package.json) | @proj-airi/plugin-sdk | Plugin SDK for Project AIRI | build, dev, test, typecheck |
| [packages/plugin-sdk-tamagotchi](../airi/packages/plugin-sdk-tamagotchi/package.json) | @proj-airi/plugin-sdk-tamagotchi | Tamagotchi-specific DX helpers for Project AIRI plugins | test, typecheck, build |
| [packages/provider-inference](../airi/packages/provider-inference/package.json) | @proj-airi/provider-inference | Runtime-neutral provider definitions for AIRI inference | dev, build, typecheck, test:run, test:node, test:browser |
| [packages/realtime-voice](../airi/packages/realtime-voice/package.json) | @proj-airi/realtime-voice | Local Doubao full duplex voice gateway and browser audio | build, typecheck, test:run |
| [packages/scenarios-stage-tamagotchi-browser](../airi/packages/scenarios-stage-tamagotchi-browser/package.json) | @proj-airi/scenarios-stage-tamagotchi-browser | Vite/Vue scene app for stage tamagotchi browser captures | capture, scenario:build, scenario:dev, typecheck |
| [packages/scenarios-stage-tamagotchi-electron](../airi/packages/scenarios-stage-tamagotchi-electron/package.json) | @proj-airi/scenarios-stage-tamagotchi-electron | Product-owned Electron scenarios for stage-tamagotchi raw screenshot capture | test:run, typecheck |
| [packages/server-runtime](../airi/packages/server-runtime/package.json) | @proj-airi/server-runtime | Server runtime implementation for AIRI running in different environments | dev, start, build, typecheck |
| [packages/server-sdk](../airi/packages/server-sdk/package.json) | @proj-airi/server-sdk | Client-side SDK implementation for connecting to AIRI server components and runtimes | dev, build, typecheck |
| [packages/server-shared](../airi/packages/server-shared/package.json) | @proj-airi/server-shared | Server shared types, utilities for AIRI server components and runtimes | dev, build, typecheck |
| [packages/stage-layouts](../airi/packages/stage-layouts/package.json) | @proj-airi/stage-layouts | Shared Layouts | typecheck |
| [packages/stage-pages](../airi/packages/stage-pages/package.json) | @proj-airi/stage-pages | Shared Pages | test:run, typecheck |
| [packages/stage-shared](../airi/packages/stage-shared/package.json) | @proj-airi/stage-shared | Shared | typecheck |
| [packages/stage-ui](../airi/packages/stage-ui/package.json) | @proj-airi/stage-ui | Shared core for stage | typecheck, story:dev, story:build, story:build-base, story:preview, build, test, test:run |
| [packages/stage-ui-live2d](../airi/packages/stage-ui-live2d/package.json) | @proj-airi/stage-ui-live2d | Live2D scene components and stores for Project AIRI | typecheck |
| [packages/stage-ui-mmd](../airi/packages/stage-ui-mmd/package.json) | @proj-airi/stage-ui-mmd | MMD (MikuMikuDance) scene components and stores for Project AIRI | typecheck |
| [packages/stage-ui-spine](../airi/packages/stage-ui-spine/package.json) | @proj-airi/stage-ui-spine | Spine 2D scene components and stores for Project AIRI | typecheck |
| [packages/stage-ui-tachie](../airi/packages/stage-ui-tachie/package.json) | @proj-airi/stage-ui-tachie | Tachie static image scene components and stores for Project AIRI | typecheck |
| [packages/stage-ui-three](../airi/packages/stage-ui-three/package.json) | @proj-airi/stage-ui-three | A collection of 3D scene components that used by Project AIRI | typecheck |
| [packages/stream-kit](../airi/packages/stream-kit/package.json) | @proj-airi/stream-kit | Stream utilities for AIRI (queues, streams) | build, typecheck |
| [packages/testing-audio](../airi/packages/testing-audio/package.json) | @proj-airi/testing-audio | AIRI Web and Electron audio pipeline tests | build:targets, test, test:run, test:existing-builds, typecheck |
| [packages/ui](../airi/packages/ui/package.json) | @proj-airi/ui | A collection of UI components that used by Project AIRI | typecheck |
| [packages/ui-loading-screens](../airi/packages/ui-loading-screens/package.json) | @proj-airi/ui-loading-screens | A collection of loading screens that used by Project AIRI | play:dev, play:build, play:preview, build, typecheck |
| [packages/ui-transitions](../airi/packages/ui-transitions/package.json) | @proj-airi/ui-transitions | A collection of transition animations that used by Project AIRI | play:dev, play:build, play:preview, build, typecheck |
| [packages/unocss-preset-fonts](../airi/packages/unocss-preset-fonts/package.json) | @proj-airi/unocss-preset-fonts | Fonts that are not included by Google Fonts, FontSource but open-source used by Project AIRI | dev, build |
| [packages/vite-plugin-sherpaw](../airi/packages/vite-plugin-sherpaw/package.json) | @proj-airi/vite-plugin-sherpaw | Expose remote and bundled Sherpaw speech models to Vite applications | build, test, typecheck |
| [packages/vitest-plugin-fakemic](../airi/packages/vitest-plugin-fakemic/package.json) | @proj-airi/vitest-plugin-fakemic | Fake microphone test runtime and Vitest integration | test, typecheck |
| [plugins/airi-plugin-bilibili-laplace](../airi/plugins/airi-plugin-bilibili-laplace/package.json) | @proj-airi/airi-plugin-bilibili-laplace | Live stream chat plugin, a bridge to forward Bilibili live chat via LAPLACE Event Bridge into AIRI server channel | build, typecheck |
| [plugins/airi-plugin-claude-code](../airi/plugins/airi-plugin-claude-code/package.json) | @proj-airi/airi-plugin-claude-code | manifest.json description | build, dev, typecheck |
| [plugins/airi-plugin-game-chess](../airi/plugins/airi-plugin-game-chess/package.json) | @proj-airi/airi-plugin-game-chess | Chess plugin for AIRI gamelet/widget runtime | dev:ui, test, eval:run, typecheck, build |
| [plugins/airi-plugin-homeassistant](../airi/plugins/airi-plugin-homeassistant/package.json) | @proj-airi/airi-plugin-homeassistant | Home Assistant integration plugin for AIRI server | build, typecheck |
| [plugins/airi-plugin-web-extension](../airi/plugins/airi-plugin-web-extension/package.json) | @proj-airi/airi-plugin-web-extension | manifest.json description | dev, dev:firefox, build, build:firefox, zip, zip:firefox, compile, postinstall |
| [server/apps/api](../airi/server/apps/api/package.json) | @proj-airi/api-server |  | apply:env, dev, start, build, typecheck, db:generate, db:push |
| [server/apps/auth](../airi/server/apps/auth/package.json) | @proj-airi/auth-server |  | apply:env, auth:generate, dev, start, build, typecheck |
| [server/packages/auth-shared](../airi/server/packages/auth-shared/package.json) | @proj-airi/auth-shared | Shared authentication schema and principal contracts for AIRI services | typecheck |
| [server/packages/server-sdk-shared](../airi/server/packages/server-sdk-shared/package.json) | @proj-airi/server-sdk-shared | Eventa contracts for the hosted chat WebSocket | dev, build, typecheck |
| [services/computer-use-mcp](../airi/services/computer-use-mcp/package.json) | @proj-airi/computer-use-mcp | AIRI-specific macOS desktop orchestration MCP service | dev, start, e2e:airi-chat, e2e:airi-chat-terminal-self-acquire, demo:terminal-self-acquire, e2e:developer-workflow, e2e:browser-reroute, e2e:terminal-exec, e2e:terminal-pty, e2e:terminal-self-acquire, bootstrap:remote, smoke:remote, smoke:stdio, smoke:macos, smoke:desktop-v3, smoke:workflow, mcp:inspector, build, typecheck, test |

完整脚本、包导出与内部依赖见 [workspace-index.json](workspace-index.json)。

重新生成：在工作区运行 `node scripts/generate-project-index.mjs`。
