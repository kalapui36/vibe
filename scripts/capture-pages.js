import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { capturePage } from '../screenshot.js';
import { setTimeout as delay } from 'node:timers/promises';

const path = new URL('../content/apps.json', import.meta.url);
const rows = JSON.parse(await readFile(path, 'utf8'));
await mkdir(new URL('../content/thumbnails/', import.meta.url), { recursive: true });
for (const row of rows) {
  if (row.capture_status !== 'pending') continue;
  if (!/^[a-zA-Z0-9-]+$/.test(row.id)) throw new Error('Invalid app id');
  const file = `content/thumbnails/${row.id}-${Date.now()}.jpg`;
  try {
    for(let attempt=0;;attempt++){
      try{await capturePage(row.url, fileURLToPath(new URL(`../${file}`, import.meta.url)));break;}
      catch(error){
        // A newly uploaded file may be waiting for the Pages deployment.
        if(!row.html_path||error.httpStatus!==404||attempt>=3)throw error;
        await delay(15000);
      }
    }
    row.capture = file;
    row.capture_status = 'ready';
    row.capture_source = 'live';
    row.capture_error = null;
  } catch (error) {
    row.capture_status = 'failed';
    row.capture_error = ['dns','browser','navigation','http','screenshot'].includes(error.captureStage) ? error.captureStage : 'unknown';
    console.log(`Capture failed (${row.capture_error}) for ${row.id}; manual thumbnail upload is available.`);
  }
}
await writeFile(path, JSON.stringify(rows, null, 2) + '\n');
