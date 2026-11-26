import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseInput, triage } from "./triage.mjs";

const html = await readFile(new URL("./index.html", import.meta.url));

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function handleTriage(request, response, options) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const text = parseInput(Buffer.concat(chunks).toString("utf8"));
  if (text === null) return json(response, 400, { status: "invalid_input" });
  return json(response, 200, await triage(text, options));
}

// options пробрасываются в triage() — в тестах так подменяется модель
export function createApp(options = {}) {
  return createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(html);
      return;
    }
    if (request.method !== "POST" || request.url !== "/api/triage") {
      return json(response, 404, { status: "not_found" });
    }
    try {
      await handleTriage(request, response, options);
    } catch (error) {
      console.error("[server]", error);
      json(response, 500, { status: "server_error" });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  createApp().listen(port, "127.0.0.1", () => {
    console.log(`Listening on http://127.0.0.1:${port}`);
  });
}
