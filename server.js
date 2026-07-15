// Minimal proxy so the Anthropic API key never reaches the browser.
// Reads ANTHROPIC_API_KEY from the environment (see .env.example).
//
// The frontend calls POST /api/messages; this forwards to Anthropic with auth.
// Local providers (Ollama, LM Studio, vLLM, Unsloth, OpenRouter) do NOT go
// through here — the browser talks to them directly.

import express from "express";
import cors from "cors";

const PORT = process.env.PROXY_PORT || 8787;
const API_KEY = process.env.ANTHROPIC_API_KEY;

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, hasKey: Boolean(API_KEY) });
});

app.post("/api/messages", async (req, res) => {
  if (!API_KEY) {
    return res.status(500).json({
      error: { message: "ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key." },
    });
  }
  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(req.body),
    });
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (err) {
    res.status(502).json({ error: { message: `Proxy request failed: ${err.message}` } });
  }
});

app.listen(PORT, () => {
  console.log(`Anthropic proxy listening on http://localhost:${PORT}`);
  if (!API_KEY) {
    console.warn("⚠  ANTHROPIC_API_KEY is not set. Anthropic provider will return an error until you add it to .env.");
  }
});
