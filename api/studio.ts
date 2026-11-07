import { readFileSync } from 'fs';
import { resolve } from 'path';

export default function handler(req, res) {
  const studioPath = resolve(process.cwd(), 'public', 'studio', 'index.html');
  const html = readFileSync(studioPath, 'utf-8');

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.status(200).send(html);
}
