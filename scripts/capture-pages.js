import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { capturePage } from '../screenshot.js';

const path = new URL('../content/apps.json', import.meta.url);
const rows = JSON.parse(await readFile(path, 'utf8'));
await mkdir(new URL('../content/thumbnails/', import.meta.url), { recursive: true });
for (const row of rows) {
  if (row.capture_status !== 'pending') continue;
  if (!/^[a-zA-Z0-9-]+$/.test(row.id)) throw new Error('Invalid app id');
  const file = `content/thumbnails/${row.id}-${Date.now()}.jpg`;
  try {
    await capturePage(row.url, fileURLToPath(new URL(`../${file}`, import.meta.url)));
    row.capture = file;
    row.capture_status = 'ready';
  } catch {
    row.capture_status = 'failed';
    console.log(`Capture failed for ${row.id}; manual thumbnail upload is available.`);
  }
}
await writeFile(path, JSON.stringify(rows, null, 2) + '\n');
