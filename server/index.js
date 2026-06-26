import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT || 8788;
const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.MODEL || "claude-sonnet-4-6";

if (!API_KEY) {
  console.error("\n  No ANTHROPIC_API_KEY found. Copy .env.example to .env and paste your key in it.\n");
}

async function callAnthropic({ prompt, useSearch, maxTokens }) {
  if (!API_KEY) throw new Error("No API key set on the server. Add ANTHROPIC_API_KEY to .env and restart.");
  const body = {
    model: MODEL,
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
  };
  if (useSearch) body.tools = [{ type: "web_search_20250305", name: "web_search" }];

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (data.error) throw new Error(data.error.message || "Anthropic API error");
  return (data.content || []).map((i) => (i.type === "text" ? i.text : "")).join("\n");
}

app.post("/api/ask", async (req, res) => {
  const { prompt, useSearch = false, maxTokens = 2000 } = req.body || {};
  if (!prompt) return res.status(400).json({ error: "Missing prompt." });
  try {
    const text = await callAnthropic({ prompt, useSearch, maxTokens });
    res.json({ text });
  } catch (e) {
    res.status(502).json({ error: e.message || "Request failed" });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({ hasKey: !!API_KEY, model: MODEL });
});

app.listen(PORT, () => {
  console.log(`\n  Resume Evaluator backend on http://localhost:${PORT}`);
  console.log(`  API key: ${API_KEY ? "found" : "MISSING — add to .env"}\n`);
});
