# Chat - Private, on-device AI

A private chat app powered by Chrome's built-in Prompt API and Gemini Nano. Every prompt and response is processed locally by the model shipped inside Chrome. Nothing ever leaves your device, no API keys, no server.

Live at [chat.milind.app](https://chat.milind.app).

## Pages

### `/` — Chat

A full chat experience on top of the on-device model:

- Streaming responses rendered as Markdown
- Conversation history persisted in `localStorage`, with an animated sidebar (conversations only appear once you actually send a message)
- Context window meter and automatic compaction: when the context fills up, older turns are summarized on-device so the conversation can continue
- Settings for system prompt, temperature, and topK
- Model download progress and availability status surfaced in the UI

### `/structured-output` — Structured Output Playground

An interactive playground for the Prompt API's `responseConstraint` option. Pass a JSON Schema and the model is forced to reply with valid, parseable JSON. Includes editable presets (boolean, enum, array, object, nested), client-side schema validation, and a side-by-side comparison against the model's unconstrained free-form reply.

### `/translate` — Translate Playground

On-device translation built on two stable (Chrome 138+) built-in AI APIs:

- The Language Detector API auto-detects the source language as you type, with a confidence score
- The Translator API streams the translation via `translateStreaming`, per-pair language packs are downloaded on demand (with progress) and then work offline
- Sample texts in five languages, swap-and-translate-back, and copy-to-clipboard

## Requirements

The app needs Chrome 137+ with the built-in AI flags enabled:

1. `chrome://flags/#prompt-api-for-gemini-nano` → **Enabled**
2. `chrome://flags/#optimization-guide-on-device-model` → **Enabled BypassPrefRequirement**
3. `chrome://components` → **Check for Update** on _Optimization Guide On Device Model_ to download Gemini Nano

The app walks you through these steps when the model is unavailable.

## Stack

- [Astro](https://astro.build) with [React](https://react.dev) islands
- [Tailwind CSS 4](https://tailwindcss.com) with a monochrome design system
- [Motion](https://motion.dev) for layout animations
- [astro-og-canvas](https://github.com/delucis/astro-og-canvas) for build-time Open Graph images (`/og.png`, `/og/structured-output.png`)
- Sitemap, robots.txt, and JSON-LD structured data generated at build

The agent loop lives in `src/lib/chat/agent.ts` (session management, streaming, compaction) with conversation state in `src/lib/chat/store.ts`; React components only mirror that state.

## Development

```sh
pnpm install
pnpm dev        # dev server at localhost:4321
pnpm check      # typecheck (astro check)
pnpm build      # production build to ./dist/
pnpm preview    # preview the production build
```
