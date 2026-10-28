# Xhirlie beta 27

A liquid-glass, self-hosted AI chat interface using the supplied Xhirlie logo. It includes streaming responses, saved conversations, provider settings, and a small API adapter server. It has no third-party front-end dependencies.

## Run it

Requirements: Node.js 18 or newer.

```bash
node server.mjs
```

Open <http://localhost:4173>. To choose another port:

```bash
PORT=8080 node server.mjs
```

## Use a server-side key (recommended)

The key can live on the server instead of the browser, so it is never typed into the UI and
never committed to Git. Create a `.env` file next to `server.mjs` (already git-ignored):

```bash
GEMINI_API_KEY=your-gemini-key
XHIRLIE_PROVIDER=gemini
XHIRLIE_MODEL=gemini-2.5-flash
```

Then run `node server.mjs`. The app detects the server key automatically: the Settings key
field shows "Using the server-side key — leave empty" and chatting works without entering
anything. Environment variables always override the `.env` file.

Supported names: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` (or `GOOGLE_API_KEY`),
plus `XHIRLIE_API_KEY` as a fallback for any provider. Optional defaults:
`XHIRLIE_PROVIDER`, `XHIRLIE_MODEL`, `XHIRLIE_ENDPOINT`.

A key typed into Settings still works and takes priority over the server key when
**Remember API key on this device** is used.

## Connect a model

Open **Settings** and choose a protocol:

- **OpenAI-compatible API** — works with OpenAI Chat Completions-compatible services and gateways. Shortcuts are included for OpenAI, OpenRouter, Groq, DeepSeek, Together AI, Mistral, xAI, Ollama, and LM Studio. Enter the exact model ID enabled for your provider account. A custom compatible base URL is supported.
- **Anthropic Messages API** — native request and streaming adapter.
- **Google Gemini API** — native request and streaming adapter.

Paste the API key issued by that provider, enter a model ID, then use **Test connection**. For a local OpenAI-compatible server such as Ollama or LM Studio, the key can be left empty.

## Important compatibility note

There is no single API key or request format that works with every model in the world. Providers issue their own keys and may use different protocols. Xhirlie supports the OpenAI Chat Completions-compatible format plus native Anthropic and Gemini adapters. Other APIs need an adapter or an OpenAI-compatible gateway.

## Privacy and storage

- Conversation history and regular preferences are saved in this browser's `localStorage`.
- The API key is kept in page memory by default and is not written to browser storage. If **Remember API key on this device** is enabled, it is saved in this browser's `localStorage`.
- The app server does not write keys or prompts to disk or log them. It forwards requests to the endpoint you configure. The chosen model provider will receive your prompts and key as required by its API.
- Use trusted providers and HTTPS endpoints for hosted services. A self-hosted deployment should be protected before exposing it to the public internet.

## Features

- Streaming chat, cancel generation, retry, copy responses, prompt starters, and conversation search/delete
- Multiple saved conversations, responsive layout, light/dark appearance
- Editable system instructions, creativity, and response length
- Server-side API proxy so provider requests do not require browser CORS access
- No bundled model: API use depends on a valid provider key, model ID, endpoint, and any provider-side quota/billing
