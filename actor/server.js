import http from "node:http";
import { GoogleGenAI } from "@google/genai";

const PORT = Number(process.env.PORT || 8080);
const API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || "*";

const ai = API_KEY ? new GoogleGenAI({ apiKey: API_KEY }) : null;

function send(res, status, body, extra = {}) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": ALLOW_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    ...extra,
  };
  res.writeHead(status, headers);
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

function toGeminiContents(messages) {
  const systemParts = [];
  const contents = [];
  for (const m of messages || []) {
    if (!m || !m.content) continue;
    if (m.role === "system") {
      systemParts.push(String(m.content));
      continue;
    }
    contents.push({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: String(m.content) }],
    });
  }
  return {
    systemInstruction: systemParts.length
      ? { parts: [{ text: systemParts.join("\n\n") }] }
      : undefined,
    contents,
  };
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    send(res, 204, "");
    return;
  }

  if (req.method === "GET" && (req.url === "/" || req.url === "/health")) {
    send(res, 200, { ok: true, model: MODEL });
    return;
  }

  if (req.method !== "POST" || req.url !== "/actor") {
    send(res, 404, { error: "not found" });
    return;
  }

  if (!ai) {
    send(res, 500, { error: "GEMINI_API_KEY is not set on the server" });
    return;
  }

  let raw = "";
  for await (const chunk of req) raw += chunk;
  let payload;
  try {
    payload = JSON.parse(raw || "{}");
  } catch {
    send(res, 400, { error: "invalid json" });
    return;
  }

  const { systemInstruction, contents } = toGeminiContents(payload.messages);
  if (!contents.length) {
    send(res, 400, { error: "messages required" });
    return;
  }

  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents,
      config: {
        systemInstruction,
        temperature: payload.temperature ?? 0.85,
        maxOutputTokens: payload.max_tokens ?? 180,
        // Adult giantess RP will otherwise trip default filters.
        safetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
        ],
      },
    });
    const text = response.text || "";
    send(res, 200, { text });
  } catch (err) {
    console.error(err);
    send(res, 502, { error: String(err.message || err) });
  }
});

server.listen(PORT, () => {
  console.log(`dawn-actor listening on ${PORT} model=${MODEL}`);
});
