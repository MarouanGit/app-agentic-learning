import { readFileSync } from 'fs';
import { resolve } from 'path';

export default function handler(req, res) {
  const appPath = resolve(process.cwd(), 'public', 'app', 'index.html');
  const html = readFileSync(appPath, 'utf-8');

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.status(200).send(html);
}
