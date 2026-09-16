import http from "node:http";

const PORT = Number(process.env.PORT || 8080);
const LOCATION = process.env.GOOGLE_CLOUD_LOCATION || "global";
const MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || "*";
const META = "http://metadata.google.internal/computeMetadata/v1";

function send(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": ALLOW_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

async function meta(path) {
  const r = await fetch(`${META}/${path}`, {
    headers: { "Metadata-Flavor": "Google" },
  });
  if (!r.ok) throw new Error(`metadata ${path} ${r.status}`);
  return r.text();
}

async function projectId() {
  return (
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    process.env.PROJECT_ID ||
    (await meta("project/project-id"))
  );
}

let tokenCache = { token: "", exp: 0 };
async function accessToken() {
  const now = Date.now();
  if (tokenCache.token && now < tokenCache.exp) return tokenCache.token;
  const raw = await meta("instance/service-accounts/default/token");
  const data = JSON.parse(raw);
  tokenCache = {
    token: data.access_token,
    exp: now + Math.max(30, (data.expires_in || 300) - 60) * 1000,
  };
  return tokenCache.token;
}

function toVertexBody(messages) {
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
  const body = {
    contents,
    generationConfig: {
      temperature: 0.85,
      maxOutputTokens: 4096,
      thinkingConfig: { thinkingBudget: 0 },
    },
  };
  if (systemParts.length) {
    body.systemInstruction = { parts: [{ text: systemParts.join("\n\n") }] };
  }
  return body;
}

function extractText(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts.map((p) => p.text || "").join("").trim();
}

http
  .createServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") {
        send(res, 204, "");
        return;
      }
      if (req.method === "GET" && (req.url === "/" || req.url === "/health")) {
        send(res, 200, {
          ok: true,
          mode: "vertex-rest",
          location: LOCATION,
          model: MODEL,
        });
        return;
      }
      if (req.method !== "POST" || req.url !== "/actor") {
        send(res, 404, { error: "not found" });
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
      const body = toVertexBody(payload.messages);
      if (!body.contents.length) {
        send(res, 400, { error: "messages required" });
        return;
      }
      if (payload.temperature != null) body.generationConfig.temperature = payload.temperature;
      if (payload.max_tokens != null) body.generationConfig.maxOutputTokens = payload.max_tokens;
      if (payload.think_budget != null) {
        body.generationConfig.thinkingConfig = { thinkingBudget: Number(payload.think_budget) || 0 };
      }

      const project = await projectId();
      const token = await accessToken();
      const host =
        LOCATION === "global"
          ? "https://aiplatform.googleapis.com"
          : `https://${LOCATION}-aiplatform.googleapis.com`;
      const url = `${host}/v1/projects/${project}/locations/${LOCATION}/publishers/google/models/${MODEL}:generateContent`;
      const vr = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const data = await vr.json().catch(() => ({}));
      if (!vr.ok) {
        send(res, 502, { error: data.error?.message || JSON.stringify(data) });
        return;
      }
      send(res, 200, { text: extractText(data) });
    } catch (err) {
      console.error(err);
      send(res, 502, { error: String(err.message || err) });
    }
  })
  .listen(PORT, "0.0.0.0", () => {
    console.log("dawn-actor listening", PORT);
  });
