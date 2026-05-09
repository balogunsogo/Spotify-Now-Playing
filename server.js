import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getListeningStatus } from "./lib/spotify.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");

async function loadEnvFile() {
  const envFiles = [".env.local", ".env"];

  for (const fileName of envFiles) {
    try {
      const env = await readFile(path.join(__dirname, fileName), "utf8");

      for (const line of env.split(/\r?\n/)) {
        const trimmed = line.trim();

        if (!trimmed || trimmed.startsWith("#")) {
          continue;
        }

        const separator = trimmed.indexOf("=");

        if (separator === -1) {
          continue;
        }

        const key = trimmed.slice(0, separator).trim();
        const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
        process.env[key] = value;
      }
    } catch {
      // Env files are optional; Vercel uses project environment variables instead.
    }
  }
}

await loadEnvFile();

const port = Number(process.env.PORT || 3000);
const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"]
]);

function sendJson(response, status, data) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(data));
}

async function serveStatic(request, response) {
  const requestPath = new URL(request.url, `http://${request.headers.host}`).pathname;
  const safePath = path.normalize(decodeURIComponent(requestPath)).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(publicDir, safePath === "/" ? "index.html" : safePath);

  if (!filePath.startsWith(publicDir)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const file = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": contentTypes.get(path.extname(filePath)) || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    response.end(file);
  } catch {
    const fallback = await readFile(path.join(publicDir, "index.html"));
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    });
    response.end(fallback);
  }
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.url?.startsWith("/api/spotify")) {
      sendJson(response, 200, await getListeningStatus());
      return;
    }

    await serveStatic(request, response);
  } catch (error) {
    console.error(error);
    sendJson(response, 500, {
      error: "Could not load Spotify status."
    });
  }
});

server.listen(port, () => {
  console.log(`Spotify page running at http://127.0.0.1:${port}`);
});
