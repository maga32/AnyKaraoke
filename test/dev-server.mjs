import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, sep } from "node:path";

const root = join(process.cwd(), "web");
const host = process.env.ANYKARAOKE_HOST || "0.0.0.0";
const port = Number(process.env.PORT || 5500);
const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".webp": "image/webp"
};

const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, `http://${request.headers.host || "localhost"}`).pathname);
    const relative = normalize(pathname).replace(/^[/\\]+/, "");
    let file = join(root, relative);
    if (file !== root && !file.startsWith(`${root}${sep}`)) throw new Error("Invalid path");
    const info = await stat(file);
    if (info.isDirectory()) file = join(file, "index.html");
    response.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream" });
    createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not Found");
  }
});

server.on("error", error => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use. Stop the previous server and run npm run dev again.`);
  } else {
    console.error(`Could not start AnyKaraoke: ${error.message}`);
  }
  process.exitCode = 1;
});

server.listen({ port, host, ipv6Only:false }, () => {
  console.log(`AnyKaraoke: http://127.0.0.1:${port}/`);
  if (host === "0.0.0.0") {
    console.log(`AnyKaraoke LAN: http://<this-device-LAN-IP>:${port}/`);
    console.log("Listening on all IPv4 network interfaces.");
  }
});
