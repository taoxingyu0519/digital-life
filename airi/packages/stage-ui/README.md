# Stage UI

Shared core for stage

## Camera attention

The Web stage uses `useFaceGaze` to consume permitted, fresh local face locations.
`Stage.gazePosition` forwards normalized stage coordinates to Live2D and VRM, ahead of pointer input.
Live2D's universal driver keeps a stationary face active. VRM adds bounded head rotation after animation.
Permission loss and passive mode release the target. Other renderers retain their existing behavior.
This path adds no camera owner, model download, remote image request, or synchronized state.

## Chat sampling

In **Settings → Modules → Consciousness**, custom temperature and Top P are off
by default. Enable each parameter only when the selected model supports it.
Some models accept only one sampling parameter at a time.

Disabling a parameter keeps its slider value but omits it from chat requests.
Previously saved values remain disabled until the user enables them. Explicit
per-request overrides still take precedence over these settings.

## Chat images

Web and Electron composers share image drafts and previews. They accept PNG,
JPEG, WebP, and GIF files up to 20 MB each, through file selection or paste.
Previews own their Object URLs. Session changes discard pending image reads.
Failed sends restore the draft through the shared composer.

Choose a provider and model in **Settings → Modules → Vision** and enable
**Use the vision model for chat images** for a text-only chat model.
The vision model describes images before the selected chat model replies.
Local history keeps the images. Provider prompts replace images with descriptions,
including images from earlier turns and retries. Earlier images can require another
vision request on later turns. Cloud history currently stores only message text.

Disable this option to send images directly to a chat model that supports them.
Without a configured vision model, images also go directly to the chat model.
Use this flow for chat attachments, not periodic screen capture.

## Character-card module settings

The card store owns three distinct states:

- `moduleDefaults` stores global provider, model, voice, and display selections.
- Each card stores explicit overrides. An empty string means inherit.
- Module stores expose the resolved runtime selections used by the application.

Use `configureForAuthentication` for login and logout. It updates global
defaults, then reapplies the active card without saving defaults into that card.
Use card commands for activation and explicit edits. Settings pages must not
save cards from watchers: authentication and remote snapshots also trigger them.
The synchronization leader owns these commands; followers receive snapshots.

Models inherit only within the same provider. Voices also require the same
model. A different provider without a model stays unconfigured rather than
receiving an unrelated model id. The editor requires a model for an explicit
chat or vision provider unless that model can be inherited safely.

Defaults are seeded once from the current runtime on upgrade. This cannot
recover historical global values that an older card already overwrote.
Existing `speech-noop` selections are preserved because they may represent
intentional silence. Users can explicitly choose **Inherit global settings**
in the editor; importing or saving an unrelated card field does not change it.

## Button analytics

Register the shared plugin once in each Vue application:

```ts
import { trackButtonPlugin } from '@proj-airi/stage-ui/directives/track-button'

createApp(App)
  .use(trackButtonPlugin)
  .mount('#app')
```

Buttons that represent a product-analysis click intent can then declare a
typed event without wrapping their business handler:

```vue
<Button
  v-track-button="{ name: 'update_check_clicked', channel: selectedChannel }"
  @click="checkForUpdates()"
/>
```

Keep async outcomes, confirmed state changes, impressions, and lifecycle events
in their owning business flows instead of attaching them to the initial click.

## Histoire (UI storyboard)

https://histoire.dev/

```shell
pnpm -F @proj-airi/stage-ui run story:dev
```

The **Misc → Swipe Actions** story renders one row with two start actions and three end actions. Its **Show labels** control switches between
text labels and surfaces that fill the available height. Use this story to
compare gesture presentation, not conversation storage behavior.

### Project structure

1. If a story is bound to a specific component, it can be placed beside the component in the `src` folder. e.g., `MyComponent.story.vue`
2. If a story is not bound to a specific component, then it should be placed in the `stories` folder. e.g., `MyStory.story.vue`

## Local Hearing with Sherpaw

Select **Sherpaw** in Hearing settings. Choose a language to see models that support it, then choose a model.
For a new Sherpaw configuration, the interface language sets the filter and selects a compatible model.
Chinese and English start with X-ASR on desktop and Paraformer on mobile Web or Stage Pocket.
An existing model selection stays in place. Choosing a language switches to a compatible model when needed.
The model detects one of its supported languages. Changing the model saves
the Provider configuration and replaces its runtime.
Each speech session currently owns a Worker, released when the session ends or is cancelled.

Hosts must enable `@proj-airi/vite-plugin-sherpaw` to expose model assets.
`provider-inference` owns recognition and Worker cleanup. `stage-ui` supplies model URLs, cached fetching, the Worker URL, and the Hearing view.
The Provider is unavailable when the host does not include models.
Use this Provider for local streaming recognition without API credentials.
It requires Workers and WebAssembly. Web and Pocket load the selected model from its pinned remote URL.
Desktop development uses cached local files. Desktop releases bundle all three models.
Use a remote Provider when model download size or local memory makes that unsuitable.
The existing VAD pipeline has separate model and runtime downloads.

## Local fast and slow brains

The shared desktop and mobile chat composers use `use-chat-input.ts`. With a
selected Consciousness model and the text preference enabled, plain text goes
to a background worker without microphone permission or a voice connection. Images
retain the ordinary configured chat model path. Missing configuration produces
an actionable localized error and preserves the input draft.

`realtime-voice.ts` owns one session's facts, tasks and result delivery. Its task
panel shows model selection, versions, progress, result summaries and evidence
sources, with cancel and revise actions. `slow-brain.ts` uses the existing Consciousness
provider, `core-agent.streamFrom`, and already authorized tools. The built-in
`read_conversation_records` tool reads only this conversation's local records.
Private reasoning and raw tool output do not enter fast-brain context or chat.
New background work is unavailable when no slow model is selected.

Confirmed text and fully played voice output enter shared facts. Navigation,
hidden pages, identity, character or session changes cancel runtime tasks and
reject late output. Tasks are local to the owning browser, not persistent jobs
or cross-device synchronized workers. See the realtime-voice package README
for protocol limits and verification.

## 本机记忆与数据库管理

`developer-access` 是不广播、不持久化权限的当前窗口状态，服务端会话才是授权依据。
`developer-gate.vue` 只在有效会话时挂载维护内容，`memory-manager.vue` 复用已有 SQLite 和会话能力。
支持行为规则、原人物改名、角色交流正文编辑/删除、已加载聊天历史及表统计。
当前本机管理网关只覆盖 Web/preview 和既有 LAN 代理。长期事实与向量检索尚未实现。


## 快慢脑提示词编辑

brain-prompts store提供完整配置校验、本机浏览器保存及revision。
brain-prompt-editor业务组件提供中文编辑、草稿恢复和系统规则预览。
realtime-voice与slow-brain消费保存配置，旧续聊不能跨版本发声。人物卡身份继续共享。
[接口与数据流](../../docs/ai/adr/2026-10-08-brain-prompt-editor.md)。
