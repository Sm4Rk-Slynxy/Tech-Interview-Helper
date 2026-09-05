# Interview Prep Generator

Paste a job description, get a targeted technical interview prep guide. An AI acting as a Principal Engineer reads the posting, works out the real tech stack and responsibilities, and produces:

- **5 conceptual deep-dive questions** — with senior-level answers (mechanics, trade-offs, best practices), hidden behind a reveal toggle so you can quiz yourself.
- **3 troubleshooting scenarios** — a concrete failure, a step-by-step debug path, and a professional "what to say in the interview" script.
- **2 system-design exercises** — the problem, a component-by-component architecture, and trade-off analysis.

Everything exports as Markdown with one click.

You bring the model. It runs against **Anthropic**, **OpenRouter**, or a **local model** (Ollama, LM Studio, vLLM, or an Unsloth-trained model served through an OpenAI-compatible endpoint).

---

## Quick start

**Requirements:** Node.js 20.12+ (uses the built-in `--env-file-if-exists` flag).

```bash
git clone <your-repo-url>
cd interview-prep-generator
npm install
```

To use the built-in **Anthropic** provider, add your key:

```bash
cp .env.example .env
# edit .env and set ANTHROPIC_API_KEY=sk-ant-...
```

Then start everything (proxy + web app together):

```bash
npm run dev
```

Open the URL Vite prints (default http://localhost:5173).

> If you only plan to use a local model or OpenRouter, you can skip the `.env` step — just run `npm run dev` and pick your provider in the ⚙ settings panel.

---

## Providers

Open the **⚙ settings** panel (top-right) to switch providers. Each has editable model and endpoint fields. API keys live only in browser memory for the session — they're never stored.

| Provider | Key needed | Default endpoint | Notes |
|---|---|---|---|
| **Anthropic (built-in)** | via `.env` | `/api/messages` (proxied) | Key stays server-side in `server.js`. |
| **OpenRouter** | yes (in panel) | `https://openrouter.ai/api/v1/chat/completions` | Any catalog model slug works. |
| **Ollama** | no | `http://localhost:11434/v1/chat/completions` | Start with `OLLAMA_ORIGINS=*`. |
| **LM Studio** | no | `http://localhost:1234/v1/chat/completions` | Start the local server + enable CORS. |
| **vLLM** | no | `http://localhost:8000/v1/chat/completions` | `vllm serve <model> --port 8000 --allowed-origins '["*"]'`. |
| **Unsloth** | no | `http://localhost:8000/v1/chat/completions` | Serve the trained model via vLLM or a GGUF export through llama.cpp. |

### The CORS gotcha (local providers)

A browser calling a local server on a different port gets blocked unless that server explicitly allows the origin. Each local provider has its own switch:

- **Ollama** — launch with `OLLAMA_ORIGINS=*` (e.g. `OLLAMA_ORIGINS=* ollama serve`).
- **LM Studio** — enable CORS in the server settings (Developer → Start Server).
- **vLLM** — pass `--allowed-origins '["*"]'`, or run behind a CORS-enabled proxy.
- **Unsloth** — same as whatever server you use to host the model (usually vLLM).

### Local model tip

Smaller models sometimes wrap responses in prose. The app already extracts the first `{...}` JSON block to compensate, but instruction-tuned models that follow "return only JSON" reliably (7B+ generally) give the best results.

---

## How it works

- The React frontend (Vite) sends the same Principal-Engineer prompt for each of the four sections, filled with your job description.
- **Anthropic** requests go to `/api/messages`, which Vite forwards to the bundled Express proxy (`server.js`). The proxy injects `ANTHROPIC_API_KEY` and forwards to Anthropic — so the key never touches the browser.
- **OpenRouter and all local providers** are OpenAI-compatible (`/chat/completions`) and are called directly from the browser.
- Each section generates independently with an automatic retry, so a single hiccup doesn't sink the whole guide, and you can retry one section on its own.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Runs the proxy and the Vite dev server together. |
| `npm run web` | Vite dev server only (for local/OpenRouter providers). |
| `npm run proxy` | Anthropic proxy only. |
| `npm run build` | Production build to `dist/`. |
| `npm run preview` | Preview the production build. |

> A production build (`npm run build`) contains only the frontend. To use the Anthropic provider in production you'll still need to run `server.js` (or an equivalent proxy) and route `/api` to it. Local providers and OpenRouter work from the static build directly.

## Project structure

```
interview-prep-generator/
├── server.js                  # Anthropic proxy (keeps the key server-side)
├── vite.config.js             # Vite + /api proxy to server.js
├── index.html
├── .env.example
├── src/
│   ├── main.jsx
│   ├── App.jsx
│   └── InterviewPrepGenerator.jsx   # the whole app
└── README.md
```

## License

MIT — see [LICENSE](./LICENSE).
