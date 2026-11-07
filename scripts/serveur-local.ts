// Serveur local pour essayer l'API comme sur Vercel (mêmes gestionnaires Web GET/POST de api/).
//   tsx --env-file=.env.local scripts/serveur-local.ts     puis   curl localhost:3210/api/sante
import { createServer } from "node:http";
import { POST as ask } from "../api/ask.js";
import { POST as complete } from "../api/complete.js";
import { GET as sante } from "../api/sante.js";

const routes: Record<string, (r: Request) => Promise<Response>> = { "POST /api/ask": ask, "POST /api/complete": complete, "GET /api/sante": () => sante() };
const PORT = Number(process.env.PORT ?? 3210);

createServer(async (req, res) => {
  const f = routes[`${req.method} ${req.url?.split("?")[0]}`];
  if (!f) return void res.writeHead(404, { "content-type": "application/json" }).end('{"erreur":{"code":"introuvable"}}');
  const morceaux: Buffer[] = [];
  for await (const m of req) morceaux.push(m as Buffer);
  const corps = Buffer.concat(morceaux);
  const r = await f(new Request(`http://localhost:${PORT}${req.url}`, { method: req.method, headers: req.headers as Record<string, string>, body: req.method === "GET" ? undefined : corps }));
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(PORT, () => console.log(`Agentic Learning en local : http://localhost:${PORT}/api/sante`));
