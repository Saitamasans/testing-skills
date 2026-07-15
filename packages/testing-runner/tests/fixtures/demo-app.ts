import http from "node:http";

export interface DemoApp {
  baseUrl: string;
  close(): Promise<void>;
  lastCreatedItemId(): string;
}

interface Item {
  id: string;
  name: string;
}

async function readJsonBody(request: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim() === "") return {};
  return JSON.parse(text) as unknown;
}

function writeHtml(response: http.ServerResponse, html: string): void {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(html);
}

function writeJson(response: http.ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

export async function startDemoApp(): Promise<DemoApp> {
  const items = new Map<string, Item>();
  let counter = 0;
  let lastId = "";

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "POST" && url.pathname === "/api/items") {
        const body = await readJsonBody(request);
        const name = typeof body === "object" && body !== null && "name" in body
          ? String((body as { name?: unknown }).name)
          : "Untitled item";
        const id = `item-${++counter}`;
        lastId = id;
        const item = { id, name };
        items.set(id, item);
        writeJson(response, 201, item);
        return;
      }

      const itemMatch = url.pathname.match(/^\/api\/items\/([^/]+)$/);
      if (request.method === "GET" && itemMatch) {
        const item = items.get(itemMatch[1]!);
        if (!item) {
          writeJson(response, 404, { error: "not found" });
          return;
        }
        writeJson(response, 200, item);
        return;
      }

      if (request.method === "GET" && url.pathname === "/login") {
        writeHtml(response, `
          <!doctype html>
          <title>Login</title>
          <form method="GET" action="/items">
            <label>Username <input name="username" /></label>
            <label>Password <input name="password" type="password" /></label>
            <button data-testid="login-submit" type="submit">Login</button>
          </form>
        `);
        return;
      }

      if (request.method === "GET" && url.pathname === "/items") {
        const links = [...items.values()]
          .map((item) => `<li><a href="/items/${item.id}">${item.name}</a></li>`)
          .join("");
        writeHtml(response, `
          <!doctype html>
          <title>Items</title>
          <h1>Items for ${url.searchParams.get("username") ?? "guest"}</h1>
          <ul>${links}</ul>
        `);
        return;
      }

      const webItemMatch = url.pathname.match(/^\/items\/([^/]+)$/);
      if (request.method === "GET" && webItemMatch) {
        const item = items.get(webItemMatch[1]!);
        if (!item) {
          response.writeHead(404);
          response.end("not found");
          return;
        }
        writeHtml(response, `
          <!doctype html>
          <title>${item.name}</title>
          <h1>${item.name}</h1>
          <p data-testid="item-id">${item.id}</p>
        `);
        return;
      }

      if (request.method === "GET" && url.pathname === "/sso") {
        writeHtml(response, `
          <!doctype html>
          <title>SSO</title>
          <h1>MFA verification required</h1>
          <p>Use Authenticator or QR scan to continue.</p>
        `);
        return;
      }

      response.writeHead(404);
      response.end("not found");
    } catch (error) {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end(error instanceof Error ? error.message : String(error));
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Demo app failed to bind a TCP port");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
    lastCreatedItemId: () => lastId,
  };
}
