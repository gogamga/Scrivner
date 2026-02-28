import editor from "./editor.html";

const WORKFLOWS_PATH = import.meta.dir + "/workflow-defs.json";
const ANNOTATIONS_PATH = import.meta.dir + "/annotations.json";

const server = Bun.serve({
  port: 8091,
  hostname: "127.0.0.1",
  routes: {
    "/": editor,
  },

  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/api/workflows") {
      if (req.method === "GET") {
        const file = Bun.file(WORKFLOWS_PATH);
        if (await file.exists()) {
          return new Response(await file.text(), {
            headers: { "Content-Type": "application/json" },
          });
        }
        return Response.json({ version: "1.0.0", journeys: [] });
      }
      if (req.method === "PUT") {
        const body = await req.json();
        await Bun.write(WORKFLOWS_PATH, JSON.stringify(body, null, 2));
        return Response.json({ ok: true });
      }
    }

    if (url.pathname === "/api/annotations") {
      if (req.method === "GET") {
        const file = Bun.file(ANNOTATIONS_PATH);
        if (await file.exists()) {
          return new Response(await file.text(), {
            headers: { "Content-Type": "application/json" },
          });
        }
        return Response.json({ annotations: [] });
      }
      if (req.method === "POST") {
        const body = await req.json();
        await Bun.write(ANNOTATIONS_PATH, JSON.stringify(body, null, 2));
        return Response.json({ ok: true });
      }
    }

    return new Response("Not Found", { status: 404 });
  },

  development: {
    hmr: true,
    console: true,
  },
});

console.log(`Workflow Editor running at http://localhost:${server.port}`);
