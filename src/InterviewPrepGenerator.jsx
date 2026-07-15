import { useState, useRef } from "react";

// ---------- design tokens ----------
const T = {
  paper: "#FAFAF7",
  ink: "#16181D",
  inkSoft: "#3B3F48",
  gray: "#767C88",
  line: "#E3E2DC",
  cobalt: "#2B4BF2",
  cobaltDark: "#1E36B8",
  highlight: "#FFE04D",
  cardBg: "#FFFFFF",
  danger: "#C43D2E",
};
const mono = "'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace";
const display = "'Archivo', 'Helvetica Neue', Arial, sans-serif";
const body = "'Public Sans', -apple-system, 'Segoe UI', sans-serif";

const fieldLabel = { display: "grid", gap: 5 };
const fieldCaption = {
  fontFamily: mono,
  fontSize: 11,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "#767C88",
};

// ---------- api helpers ----------
// Default endpoints/models per provider. Users can override in Settings.
const PROVIDERS = {
  anthropic: {
    label: "Anthropic (built-in)",
    defaultModel: "claude-sonnet-4-6",
    // Requests are proxied to Anthropic by the bundled Express server (server.js),
    // which injects your ANTHROPIC_API_KEY. Vite forwards /api to that server in dev.
    defaultBaseUrl: "/api/messages",
    needsKey: false,
    kind: "anthropic",
  },
  ollama: {
    label: "Local (Ollama)",
    defaultModel: "llama3.1",
    defaultBaseUrl: "http://localhost:11434/v1/chat/completions",
    needsKey: false,
    kind: "openai",
  },
  lmstudio: {
    label: "Local (LM Studio)",
    defaultModel: "local-model",
    defaultBaseUrl: "http://localhost:1234/v1/chat/completions",
    needsKey: false,
    kind: "openai",
  },
  vllm: {
    label: "Local (vLLM)",
    defaultModel: "meta-llama/Llama-3.1-8B-Instruct",
    defaultBaseUrl: "http://localhost:8000/v1/chat/completions",
    needsKey: false,
    kind: "openai",
  },
  unsloth: {
    label: "Local (Unsloth)",
    defaultModel: "unsloth/Meta-Llama-3.1-8B-Instruct",
    defaultBaseUrl: "http://localhost:8000/v1/chat/completions",
    needsKey: false,
    kind: "openai",
  },
  openrouter: {
    label: "OpenRouter",
    defaultModel: "anthropic/claude-3.5-sonnet",
    defaultBaseUrl: "https://openrouter.ai/api/v1/chat/completions",
    needsKey: true,
    kind: "openai",
  },
};

// Pull the first {...} JSON object out of a text blob, tolerating fences/preamble.
function extractJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found in the model's response");
  }
  return JSON.parse(text.slice(start, end + 1));
}

async function callAnthropic(prompt, cfg) {
  const headers = { "Content-Type": "application/json" };
  // If a key is supplied (e.g. via a local proxy that forwards it), send it.
  if (cfg.apiKey) {
    headers["x-api-key"] = cfg.apiKey;
    headers["anthropic-version"] = "2023-06-01";
    headers["anthropic-dangerous-direct-browser-access"] = "true";
  }
  const response = await fetch(cfg.baseUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || "API request failed");
  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  return extractJson(text);
}

// Shared path for OpenAI-compatible APIs: Ollama and OpenRouter.
async function callOpenAICompatible(prompt, cfg) {
  const headers = { "Content-Type": "application/json" };
  if (cfg.apiKey) headers["Authorization"] = `Bearer ${cfg.apiKey}`;
  const response = await fetch(cfg.baseUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await response.json();
  if (data.error) {
    throw new Error(data.error.message || data.error.toString() || "API request failed");
  }
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("Empty response from the model");
  return extractJson(text);
}

// Dispatch to the right transport based on the selected provider config.
async function callModel(prompt, cfg) {
  const kind = PROVIDERS[cfg.provider]?.kind;
  if (kind === "anthropic") return callAnthropic(prompt, cfg);
  return callOpenAICompatible(prompt, cfg);
}

const baseRole = (jd) => `You are an expert technical interviewer and Principal Engineer. Analyze the job description below to identify the core tech stack, architectural patterns, methodologies, and specific responsibilities. Ground every question in THIS specific role — name the actual technologies from the description.

JOB DESCRIPTION:
"""
${jd}
"""

`;

function analysisPrompt(jd) {
  return (
    baseRole(jd) +
    `Return ONLY valid JSON, no preamble, no markdown fences, exactly this shape:
{"role_title":"short inferred role title","seniority":"e.g. Senior / Staff / Mid-level","stack":["6-10 core technologies"],"patterns":["3-5 architectural patterns or methodologies"],"focus":"one sentence: what this role is really about"}`
  );
}

function conceptualPrompt(jd) {
  return (
    baseRole(jd) +
    `Generate exactly 5 conceptual deep-dive questions focused on the "why" and "how it works under the hood" for the core technologies in this job description. For each, write a Senior-level answer explaining mechanics, trade-offs, and best practices (150-250 words each, plain text, paragraphs separated by \\n\\n).

Return ONLY valid JSON, no preamble, no markdown fences:
{"questions":[{"question":"...","answer":"..."}]}`
  );
}

function scenarioPrompt(jd) {
  return (
    baseRole(jd) +
    `Generate exactly 3 realistic on-the-job failure modes or optimization problems based on this role's responsibilities. For each provide:
- title: short name of the incident
- scenario: concrete system failure, bottleneck, or bug (2-4 sentences)
- debug: array of 4-7 step-by-step resolution steps (each one sentence)
- interview_response: a structured, professional first-person answer showing ownership and technical depth (100-180 words)

Return ONLY valid JSON, no preamble, no markdown fences:
{"scenarios":[{"title":"...","scenario":"...","debug":["..."],"interview_response":"..."}]}`
  );
}

function designPrompt(jd) {
  return (
    baseRole(jd) +
    `Generate exactly 2 architecture & system design questions relevant to the scale and infrastructure implied by this job description. For each provide:
- title: short name of the design exercise
- problem: the design requirement and constraints (2-4 sentences)
- architecture: array of 4-7 components, each {"component":"name e.g. API Gateway","detail":"one-sentence role in the design"}
- tradeoffs: why this design over an alternative (80-150 words)

Return ONLY valid JSON, no preamble, no markdown fences:
{"designs":[{"title":"...","problem":"...","architecture":[{"component":"...","detail":"..."}],"tradeoffs":"..."}]}`
  );
}

// ---------- input validation ----------
// True when the input is essentially just a link, not a pasted description.
function looksLikeUrl(text) {
  const t = text.trim();
  if (!t) return false;
  // Whole thing is one URL, or very short with a URL and almost no other prose
  const urlRe = /^https?:\/\/\S+$/i;
  if (urlRe.test(t)) return true;
  const words = t.split(/\s+/);
  const hasUrl = /https?:\/\/\S+/i.test(t);
  return hasUrl && words.length <= 8;
}

// ---------- small components ----------
function Eyebrow({ children }) {
  return (
    <div
      style={{
        fontFamily: mono,
        fontSize: 11,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color: T.cobalt,
        fontWeight: 600,
      }}
    >
      {children}
    </div>
  );
}

function Mark({ children }) {
  return (
    <span
      style={{
        background: `linear-gradient(transparent 55%, ${T.highlight} 55%)`,
        padding: "0 2px",
      }}
    >
      {children}
    </span>
  );
}

function Paragraphs({ text, style }) {
  return (
    <div style={style}>
      {String(text)
        .split(/\n\n+/)
        .map((p, i) => (
          <p key={i} style={{ margin: i === 0 ? 0 : "12px 0 0" }}>
            {p}
          </p>
        ))}
    </div>
  );
}

function SectionShell({ number, title, sub, state, message, onRetry, children }) {
  return (
    <section style={{ marginTop: 56 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 16, borderBottom: `2px solid ${T.ink}`, paddingBottom: 10 }}>
        <span style={{ fontFamily: mono, fontSize: 13, color: T.gray }}>{number}</span>
        <h2 style={{ fontFamily: display, fontWeight: 800, fontSize: 26, margin: 0, color: T.ink, letterSpacing: "-0.01em" }}>
          {title}
        </h2>
        <span style={{ fontFamily: mono, fontSize: 12, color: T.gray, marginLeft: "auto" }}>{sub}</span>
      </div>
      {state === "loading" && (
        <div style={{ padding: "28px 0", display: "flex", alignItems: "center", gap: 12 }}>
          <span className="pulse-dot" />
          <span style={{ fontFamily: mono, fontSize: 13, color: T.gray }}>Drafting this section…</span>
        </div>
      )}
      {state === "error" && (
        <div style={{ padding: "24px 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <span style={{ fontFamily: mono, fontSize: 13, color: T.danger }}>
              This section didn't come back cleanly.
            </span>
            <button className="ghost-btn" onClick={onRetry}>
              Retry section
            </button>
          </div>
          {message && (
            <div style={{ marginTop: 8, fontFamily: mono, fontSize: 12, color: T.gray }}>
              Detail: {message}
            </div>
          )}
        </div>
      )}
      {state === "done" && children}
    </section>
  );
}

function QuestionCard({ index, question, answer }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      style={{
        background: T.cardBg,
        border: `1px solid ${T.line}`,
        borderRadius: 10,
        padding: "20px 22px",
        marginTop: 16,
      }}
    >
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
        <span style={{ fontFamily: mono, fontSize: 13, color: T.cobalt, fontWeight: 600, paddingTop: 3 }}>
          Q{index + 1}
        </span>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: display, fontWeight: 700, fontSize: 17, color: T.ink, lineHeight: 1.4 }}>
            {question}
          </div>
          {open ? (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px dashed ${T.line}` }}>
              <Eyebrow>Senior-level answer</Eyebrow>
              <Paragraphs
                text={answer}
                style={{ marginTop: 8, fontFamily: body, fontSize: 15, lineHeight: 1.65, color: T.inkSoft }}
              />
            </div>
          ) : null}
          <button className="ghost-btn" style={{ marginTop: 12 }} onClick={() => setOpen(!open)}>
            {open ? "Hide answer" : "Reveal answer"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- main app ----------
export default function InterviewPrepGenerator() {
  const [jd, setJd] = useState("");
  const [phase, setPhase] = useState("input"); // input | working
  const [profile, setProfile] = useState({ state: "idle", data: null });
  const [conceptual, setConceptual] = useState({ state: "idle", data: null });
  const [scenarios, setScenarios] = useState({ state: "idle", data: null });
  const [designs, setDesigns] = useState({ state: "idle", data: null });
  const [copied, setCopied] = useState(false);
  const jdRef = useRef("");

  // ---- provider configuration ----
  const [showSettings, setShowSettings] = useState(false);
  const [provider, setProvider] = useState("anthropic");
  const [model, setModel] = useState(PROVIDERS.anthropic.defaultModel);
  const [baseUrl, setBaseUrl] = useState(PROVIDERS.anthropic.defaultBaseUrl);
  const [apiKey, setApiKey] = useState("");
  const cfgRef = useRef({});

  const switchProvider = (p) => {
    setProvider(p);
    setModel(PROVIDERS[p].defaultModel);
    setBaseUrl(PROVIDERS[p].defaultBaseUrl);
    setApiKey("");
  };

  const runSection = async (setter, promptFn) => {
    setter({ state: "loading", data: null });
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const data = await callModel(promptFn(jdRef.current), cfgRef.current);
        setter({ state: "done", data });
        return;
      } catch (err) {
        console.error(`Model call error (attempt ${attempt}):`, err);
        if (attempt === 2) {
          setter({ state: "error", data: null, message: err?.message || "Unknown error" });
        }
      }
    }
  };

  const generate = async () => {
    if (looksLikeUrl(jd) || jd.trim().length < 60) return;
    if (PROVIDERS[provider].needsKey && !apiKey.trim()) {
      setShowSettings(true);
      return;
    }
    cfgRef.current = { provider, model: model.trim(), baseUrl: baseUrl.trim(), apiKey: apiKey.trim() };
    jdRef.current = jd.trim();
    setPhase("working");
    setCopied(false);
    // sequential so sections stream in progressively
    await runSection(setProfile, analysisPrompt);
    await runSection(setConceptual, conceptualPrompt);
    await runSection(setScenarios, scenarioPrompt);
    await runSection(setDesigns, designPrompt);
  };

  const reset = () => {
    setPhase("input");
    setProfile({ state: "idle", data: null });
    setConceptual({ state: "idle", data: null });
    setScenarios({ state: "idle", data: null });
    setDesigns({ state: "idle", data: null });
  };

  const copyAll = async () => {
    const lines = [];
    if (profile.data) {
      lines.push(`# Interview Prep Dossier — ${profile.data.role_title}`, "");
      lines.push(`Focus: ${profile.data.focus}`, `Stack: ${(profile.data.stack || []).join(", ")}`, "");
    }
    if (conceptual.data) {
      lines.push("## 1. Conceptual & Deep-Dive Questions", "");
      conceptual.data.questions.forEach((q, i) => {
        lines.push(`### Q${i + 1}. ${q.question}`, "", q.answer, "");
      });
    }
    if (scenarios.data) {
      lines.push("## 2. Practical & Troubleshooting Scenarios", "");
      scenarios.data.scenarios.forEach((s, i) => {
        lines.push(`### Scenario ${i + 1}: ${s.title}`, "", `**Scenario:** ${s.scenario}`, "", "**How to debug/resolve:**");
        (s.debug || []).forEach((d, j) => lines.push(`${j + 1}. ${d}`));
        lines.push("", `**What to say in the interview:** ${s.interview_response}`, "");
      });
    }
    if (designs.data) {
      lines.push("## 3. Architecture & System Design", "");
      designs.data.designs.forEach((d, i) => {
        lines.push(`### Design ${i + 1}: ${d.title}`, "", `**The Problem:** ${d.problem}`, "", "**Recommended Architecture:**");
        (d.architecture || []).forEach((c) => lines.push(`- **${c.component}** — ${c.detail}`));
        lines.push("", `**Trade-off Analysis:** ${d.tradeoffs}`, "");
      });
    }
    const md = lines.join("\n");
    try {
      await navigator.clipboard.writeText(md);
      setCopied(true);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = md;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
    }
    setTimeout(() => setCopied(false), 2000);
  };

  const allDone =
    conceptual.state === "done" && scenarios.state === "done" && designs.state === "done";
  const isUrl = looksLikeUrl(jd);

  return (
    <div style={{ minHeight: "100vh", background: T.paper, color: T.ink, fontFamily: body }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Archivo:wght@600;700;800&family=IBM+Plex+Mono:wght@400;500;600&family=Public+Sans:wght@400;500;600&display=swap');
        * { box-sizing: border-box; }
        .primary-btn {
          font-family: ${mono}; font-size: 14px; font-weight: 600; letter-spacing: 0.04em;
          background: ${T.cobalt}; color: #fff; border: none; border-radius: 8px;
          padding: 14px 26px; cursor: pointer; transition: background .15s ease, transform .1s ease;
        }
        .primary-btn:hover:not(:disabled) { background: ${T.cobaltDark}; }
        .primary-btn:active:not(:disabled) { transform: translateY(1px); }
        .primary-btn:disabled { opacity: .45; cursor: not-allowed; }
        .primary-btn:focus-visible, .ghost-btn:focus-visible, textarea:focus-visible {
          outline: 2px solid ${T.cobalt}; outline-offset: 2px;
        }
        .ghost-btn {
          font-family: ${mono}; font-size: 12.5px; font-weight: 500;
          background: transparent; color: ${T.cobalt}; border: 1px solid ${T.cobalt};
          border-radius: 6px; padding: 6px 14px; cursor: pointer; transition: background .15s ease;
        }
        .ghost-btn:hover { background: rgba(43, 75, 242, 0.07); }
        textarea {
          width: 100%; min-height: 300px; resize: vertical;
          background: ${T.cardBg}; border: 1px solid ${T.line}; border-radius: 10px;
          padding: 18px; font-family: ${mono}; font-size: 13.5px; line-height: 1.6; color: ${T.ink};
        }
        textarea::placeholder { color: #A6AAB4; }
        .cfg-input {
          width: 100%; font-family: ${mono}; font-size: 13px; color: ${T.ink};
          background: #FCFCFA; border: 1px solid ${T.line}; border-radius: 7px;
          padding: 9px 11px;
        }
        .cfg-input:focus-visible { outline: 2px solid ${T.cobalt}; outline-offset: 1px; }
        .pulse-dot {
          width: 9px; height: 9px; border-radius: 50%; background: ${T.cobalt};
          animation: pulse 1.1s ease-in-out infinite;
        }
        @keyframes pulse { 0%,100% { opacity:.25 } 50% { opacity:1 } }
        @media (prefers-reduced-motion: reduce) { .pulse-dot { animation: none; opacity: .8; } }
        .chip {
          font-family: ${mono}; font-size: 12px; padding: 5px 11px; border-radius: 999px;
          border: 1px solid ${T.line}; background: ${T.cardBg}; color: ${T.inkSoft};
        }
        .chip--pattern { border-color: ${T.cobalt}; color: ${T.cobalt}; background: rgba(43,75,242,0.05); }
      `}</style>

      <div style={{ maxWidth: 880, margin: "0 auto", padding: "48px 24px 96px" }}>
        {/* header */}
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
          <div>
            <Eyebrow>Interview prep dossier · generated by a principal-engineer AI</Eyebrow>
            <h1
              style={{
                fontFamily: display,
                fontWeight: 800,
                fontSize: "clamp(30px, 5vw, 44px)",
                lineHeight: 1.08,
                letterSpacing: "-0.02em",
                margin: "10px 0 0",
              }}
            >
              Paste the job description.
              <br />
              Walk in <Mark>already ready</Mark>.
            </h1>
          </div>
          <button
            className="ghost-btn"
            style={{ flexShrink: 0, marginTop: 4 }}
            onClick={() => setShowSettings((s) => !s)}
            aria-expanded={showSettings}
          >
            ⚙ {PROVIDERS[provider].label}
          </button>
        </header>

        {/* settings panel */}
        {showSettings && (
          <div
            style={{
              marginTop: 24,
              background: T.cardBg,
              border: `1px solid ${T.line}`,
              borderRadius: 12,
              padding: "22px 24px",
            }}
          >
            <div style={{ fontFamily: display, fontWeight: 700, fontSize: 17, marginBottom: 4 }}>
              Model provider
            </div>
            <p style={{ fontFamily: body, fontSize: 13.5, lineHeight: 1.55, color: T.gray, margin: "0 0 16px", maxWidth: 620 }}>
              Choose where generation runs. Keys stay in your browser for this session and are sent only to
              the endpoint you pick — nothing is stored.
            </p>

            {/* provider tabs */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 18 }}>
              {Object.entries(PROVIDERS).map(([key, p]) => (
                <button
                  key={key}
                  className="ghost-btn"
                  onClick={() => switchProvider(key)}
                  style={
                    provider === key
                      ? { background: T.cobalt, color: "#fff", borderColor: T.cobalt }
                      : undefined
                  }
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* provider help text */}
            <div
              style={{
                fontFamily: mono,
                fontSize: 12,
                lineHeight: 1.6,
                color: T.inkSoft,
                background: "#FCFCFA",
                border: `1px solid ${T.line}`,
                borderRadius: 8,
                padding: "12px 14px",
                marginBottom: 18,
              }}
            >
              {provider === "anthropic" && (
                <>Requests are proxied through the bundled server, which adds your key from
                  {" "}<b>.env</b> (<b>ANTHROPIC_API_KEY</b>). Start it with <b>npm run dev</b> — no key needed
                  in this panel.</>
              )}
              {provider === "ollama" && (
                <>Run <b>ollama serve</b>, then <b>ollama pull {model || "llama3.1"}</b>. Start Ollama with
                  {" "}<b>OLLAMA_ORIGINS=*</b> so the browser can reach it. No API key needed.</>
              )}
              {provider === "lmstudio" && (
                <>In LM Studio, load a model and start the local server (Developer → Start Server).
                  Enable <b>CORS</b> in the server settings so the browser can connect. The model name
                  here should match the loaded model's identifier. No API key needed.</>
              )}
              {provider === "vllm" && (
                <>Serve with <b>vllm serve {model || "<model>"} --port 8000</b>. Add
                  {" "}<b>--allowed-origins '["*"]'</b> (or run behind a CORS-enabled proxy) so the browser
                  can reach it. The model field must match the served model ID exactly.</>
              )}
              {provider === "unsloth" && (
                <>Unsloth trains/exports models; serve the result with an OpenAI-compatible endpoint —
                  usually <b>vLLM</b> (<b>vllm serve your-unsloth-model --port 8000</b>) or a GGUF export via
                  {" "}<b>llama.cpp</b>. Point the endpoint and model at whatever you launched, and enable CORS.</>
              )}
              {provider === "openrouter" && (
                <>Get a key at <b>openrouter.ai/keys</b>. Any model slug from their catalog works
                  (e.g. <b>anthropic/claude-3.5-sonnet</b>, <b>meta-llama/llama-3.1-70b-instruct</b>).</>
              )}
            </div>

            {/* fields */}
            <div style={{ display: "grid", gap: 14 }}>
              <label style={fieldLabel}>
                <span style={fieldCaption}>Model</span>
                <input
                  className="cfg-input"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={PROVIDERS[provider].defaultModel}
                  spellCheck={false}
                />
              </label>
              <label style={fieldLabel}>
                <span style={fieldCaption}>Endpoint URL</span>
                <input
                  className="cfg-input"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder={PROVIDERS[provider].defaultBaseUrl}
                  spellCheck={false}
                />
              </label>
              {(PROVIDERS[provider].needsKey || provider === "anthropic") && (
                <label style={fieldLabel}>
                  <span style={fieldCaption}>
                    API key {PROVIDERS[provider].needsKey ? "(required)" : "(optional — for local proxy)"}
                  </span>
                  <input
                    className="cfg-input"
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="sk-..."
                    spellCheck={false}
                    autoComplete="off"
                  />
                </label>
              )}
            </div>
            <button className="ghost-btn" style={{ marginTop: 16 }} onClick={() => setShowSettings(false)}>
              Done
            </button>
          </div>
        )}

        {/* input phase */}
        {phase === "input" && (
          <div style={{ marginTop: 36 }}>
            <p style={{ fontSize: 15.5, lineHeight: 1.6, color: T.inkSoft, maxWidth: 620, margin: "0 0 20px" }}>
              This tool reads a real job description, works out the actual stack and responsibilities,
              and builds a targeted guide: 5 deep-dive questions with senior-level answers, 3 troubleshooting
              scenarios, and 2 system-design exercises.
            </p>
            <textarea
              value={jd}
              onChange={(e) => setJd(e.target.value)}
              placeholder={`Paste the full job description text here — responsibilities, requirements, tech stack, everything.\n\nA link won't work: open the posting, select all the text, and paste it in.`}
              aria-label="Job description"
              style={isUrl ? { borderColor: T.danger } : undefined}
            />
            {isUrl && (
              <div
                role="alert"
                style={{
                  marginTop: 12,
                  background: "rgba(196,61,46,0.06)",
                  border: `1px solid ${T.danger}`,
                  borderRadius: 8,
                  padding: "12px 14px",
                  display: "flex",
                  gap: 10,
                  alignItems: "flex-start",
                }}
              >
                <span style={{ fontFamily: mono, fontSize: 14, color: T.danger, fontWeight: 600 }}>!</span>
                <span style={{ fontFamily: body, fontSize: 14, lineHeight: 1.55, color: T.ink }}>
                  That's a link, not a job description. This app can't open URLs — open the posting
                  in your browser, select the whole description, and paste the <strong>text</strong> here.
                </span>
              </div>
            )}
            <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 16 }}>
              <button
                className="primary-btn"
                onClick={generate}
                disabled={isUrl || jd.trim().length < 60}
              >
                Build my prep guide →
              </button>
              {!isUrl && jd.trim().length > 0 && jd.trim().length < 60 && (
                <span style={{ fontFamily: mono, fontSize: 12.5, color: T.gray }}>
                  Paste a bit more — at least a few sentences.
                </span>
              )}
              {PROVIDERS[provider].needsKey && !apiKey.trim() && (
                <span style={{ fontFamily: mono, fontSize: 12.5, color: T.danger }}>
                  Add your {PROVIDERS[provider].label} key in ⚙ settings.
                </span>
              )}
            </div>
          </div>
        )}

        {/* working / results phase */}
        {phase === "working" && (
          <div style={{ marginTop: 36 }}>
            {/* role profile */}
            {profile.state === "loading" && (
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0" }}>
                <span className="pulse-dot" />
                <span style={{ fontFamily: mono, fontSize: 13, color: T.gray }}>
                  Reading the job description and mapping the stack…
                </span>
              </div>
            )}
            {profile.state === "error" && (
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <span style={{ fontFamily: mono, fontSize: 13, color: T.danger }}>
                  Couldn't analyze the description.
                </span>
                <button className="ghost-btn" onClick={() => runSection(setProfile, analysisPrompt)}>
                  Retry
                </button>
              </div>
            )}
            {profile.state === "done" && profile.data && (
              <div
                style={{
                  background: T.ink,
                  color: T.paper,
                  borderRadius: 12,
                  padding: "24px 26px",
                }}
              >
                <div style={{ fontFamily: mono, fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: T.highlight }}>
                  Role profile — {profile.data.seniority}
                </div>
                <div style={{ fontFamily: display, fontWeight: 800, fontSize: 24, margin: "6px 0 4px" }}>
                  {profile.data.role_title}
                </div>
                <div style={{ fontSize: 14.5, lineHeight: 1.55, color: "#C9CBD3", maxWidth: 640 }}>
                  {profile.data.focus}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 16 }}>
                  {(profile.data.stack || []).map((s, i) => (
                    <span key={i} className="chip" style={{ background: "transparent", borderColor: "#3A3E47", color: "#E7E8EC" }}>
                      {s}
                    </span>
                  ))}
                  {(profile.data.patterns || []).map((p, i) => (
                    <span key={"p" + i} className="chip" style={{ background: "rgba(255,224,77,0.12)", borderColor: T.highlight, color: T.highlight }}>
                      {p}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* section 1 */}
            {conceptual.state !== "idle" && (
              <SectionShell
                number="§1"
                title="Conceptual & Deep-Dive"
                sub="5 questions"
                state={conceptual.state}
                message={conceptual.message}
                onRetry={() => runSection(setConceptual, conceptualPrompt)}
              >
                {conceptual.data?.questions?.map((q, i) => (
                  <QuestionCard key={i} index={i} question={q.question} answer={q.answer} />
                ))}
              </SectionShell>
            )}

            {/* section 2 */}
            {scenarios.state !== "idle" && (
              <SectionShell
                number="§2"
                title="Practical & Troubleshooting"
                sub="3 scenarios"
                state={scenarios.state}
                message={scenarios.message}
                onRetry={() => runSection(setScenarios, scenarioPrompt)}
              >
                {scenarios.data?.scenarios?.map((s, i) => (
                  <div
                    key={i}
                    style={{
                      background: T.cardBg,
                      border: `1px solid ${T.line}`,
                      borderRadius: 10,
                      padding: "22px 24px",
                      marginTop: 16,
                    }}
                  >
                    <div style={{ fontFamily: mono, fontSize: 12, color: T.gray }}>Incident {i + 1}</div>
                    <div style={{ fontFamily: display, fontWeight: 700, fontSize: 18, margin: "4px 0 12px" }}>
                      {s.title}
                    </div>
                    <Eyebrow>Scenario</Eyebrow>
                    <Paragraphs text={s.scenario} style={{ margin: "6px 0 16px", fontSize: 15, lineHeight: 1.6, color: T.inkSoft }} />
                    <Eyebrow>How to debug / resolve</Eyebrow>
                    <ol style={{ margin: "8px 0 16px", paddingLeft: 20 }}>
                      {(s.debug || []).map((step, j) => (
                        <li key={j} style={{ fontSize: 14.5, lineHeight: 1.6, color: T.inkSoft, marginTop: j === 0 ? 0 : 6 }}>
                          {step}
                        </li>
                      ))}
                    </ol>
                    <div style={{ background: "rgba(255,224,77,0.18)", borderLeft: `3px solid ${T.highlight}`, borderRadius: 6, padding: "14px 16px" }}>
                      <Eyebrow>What to say in the interview</Eyebrow>
                      <Paragraphs text={s.interview_response} style={{ marginTop: 6, fontSize: 14.5, lineHeight: 1.65, color: T.ink }} />
                    </div>
                  </div>
                ))}
              </SectionShell>
            )}

            {/* section 3 */}
            {designs.state !== "idle" && (
              <SectionShell
                number="§3"
                title="Architecture & System Design"
                sub="2 exercises"
                state={designs.state}
                message={designs.message}
                onRetry={() => runSection(setDesigns, designPrompt)}
              >
                {designs.data?.designs?.map((d, i) => (
                  <div
                    key={i}
                    style={{
                      background: T.cardBg,
                      border: `1px solid ${T.line}`,
                      borderRadius: 10,
                      padding: "22px 24px",
                      marginTop: 16,
                    }}
                  >
                    <div style={{ fontFamily: mono, fontSize: 12, color: T.gray }}>Design exercise {i + 1}</div>
                    <div style={{ fontFamily: display, fontWeight: 700, fontSize: 18, margin: "4px 0 12px" }}>
                      {d.title}
                    </div>
                    <Eyebrow>The problem</Eyebrow>
                    <Paragraphs text={d.problem} style={{ margin: "6px 0 16px", fontSize: 15, lineHeight: 1.6, color: T.inkSoft }} />
                    <Eyebrow>Recommended architecture</Eyebrow>
                    <div style={{ margin: "10px 0 16px", border: `1px solid ${T.line}`, borderRadius: 8, overflow: "hidden" }}>
                      {(d.architecture || []).map((c, j) => (
                        <div
                          key={j}
                          style={{
                            display: "flex",
                            gap: 14,
                            padding: "11px 14px",
                            borderTop: j === 0 ? "none" : `1px solid ${T.line}`,
                            background: j % 2 ? "#FCFCFA" : T.cardBg,
                          }}
                        >
                          <span style={{ fontFamily: mono, fontSize: 12.5, fontWeight: 600, color: T.cobalt, minWidth: 150 }}>
                            {c.component}
                          </span>
                          <span style={{ fontSize: 14, lineHeight: 1.55, color: T.inkSoft }}>{c.detail}</span>
                        </div>
                      ))}
                    </div>
                    <Eyebrow>Trade-off analysis</Eyebrow>
                    <Paragraphs text={d.tradeoffs} style={{ marginTop: 6, fontSize: 14.5, lineHeight: 1.65, color: T.inkSoft }} />
                  </div>
                ))}
              </SectionShell>
            )}

            {/* footer actions */}
            <div style={{ marginTop: 48, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
              {allDone && (
                <button className="primary-btn" onClick={copyAll}>
                  {copied ? "Copied ✓" : "Copy full guide as Markdown"}
                </button>
              )}
              <button className="ghost-btn" onClick={reset}>
                Start over with a new job description
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
