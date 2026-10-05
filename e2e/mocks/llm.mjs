// A fake OpenAI-compatible provider for end-to-end tests.
//   Key "good-key" is accepted; anything else gets a 401.
//   Model "missing" gets a 404, "broke" gets a 402, "slow" answers slowly,
//   "flaky" rate-limits every request's first attempt.
// Set CORS=0 to behave like a provider that refuses browser requests.
import { createServer } from "node:http";

const port = Number(process.env.PORT ?? 4011);
const cors = process.env.CORS !== "0";
const seen = new Set();

function send(res, status, body, extra = {}) {
  const headers = { "Content-Type": "application/json", ...extra };
  if (cors) {
    headers["Access-Control-Allow-Origin"] = "*";
    headers["Access-Control-Allow-Headers"] = "authorization, content-type, x-title, http-referer";
  }
  res.writeHead(status, headers).end(JSON.stringify(body));
}

function narration(user) {
  const file = user.match(/<file path="([^"]+)">/)?.[1];
  const wantsTitle = user.includes("TITLE:");
  if (!wantsTitle) {
    const kind = user.includes("closing part") ? "closing" : "overview";
    return kind === "overview"
      ? "This app is a small example project. It shows how the pieces fit together.\n\nYou'll hear about each part in turn, starting with where it begins."
      : "If you want to change the look, open the stylesheet. If you want to add a page, start with the routes.\n\nHave fun exploring.";
  }
  const name = file ? file.split("/").pop().replace(/\.[^.]+$/, "") : "group";
  return `TITLE: The ${name} file\n\nThis is the **${name}** file. It does one clear job, and the rest of the app leans on it.\n\n- It keeps things tidy.\n- It connects to the screens.\n\nIf you want to change how it behaves, this is where you'd look.\n\nSUMMARY: The ${name} file does one clear job for the app.`;
}

createServer((req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, {});
  if (req.url.endsWith("/models")) return send(res, 200, { data: [{ id: "mock/narrator" }, { id: "mock/fast" }] });
  if (!req.url.endsWith("/chat/completions")) return send(res, 404, { error: { message: "not found" } });
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const auth = req.headers.authorization ?? "";
    if (auth !== "Bearer good-key") return send(res, 401, { error: { message: "Invalid API key provided." } });
    const payload = JSON.parse(body);
    if (payload.model === "missing") return send(res, 404, { error: { message: "The model `missing` does not exist." } });
    if (payload.model === "broke") return send(res, 402, { error: { message: "Insufficient credits." } });
    const user = payload.messages.find((m) => m.role === "user")?.content ?? "";
    const fingerprint = user.slice(-400);
    if (payload.model === "flaky" && !seen.has(fingerprint)) {
      seen.add(fingerprint);
      return send(res, 429, { error: { message: "Rate limit exceeded" } }, { "retry-after": "1" });
    }
    const delay = payload.model === "slow" ? 1500 : 120 + Math.random() * 200;
    setTimeout(
      () =>
        send(res, 200, {
          id: "mock",
          choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: narration(user) } }],
        }),
      delay,
    );
  });
}).listen(port, () => console.log(`mock llm on :${port} (cors ${cors ? "on" : "off"})`));
