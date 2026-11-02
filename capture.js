import { resolve } from 'node:path';
import { db, dataDir } from './store.js';
import { capturePage } from './screenshot.js';
export { normalizeUrl } from './screenshot.js';

const queue = [];
let running = false;
export function scheduleCapture(id) {
  if (!queue.includes(id)) queue.push(id);
  db.prepare("UPDATE apps SET capture_status='pending',capture_error=NULL WHERE id=?").run(id);
  void drain();
}
async function drain() {
  if (running) return;
  running = true;
  while (queue.length) {
    const id = queue.shift();
    const app = db.prepare('SELECT * FROM apps WHERE id=?').get(id);
    if (!app) continue;
    try {
      const file = `${id}-${Date.now()}.jpg`;
      await capturePage(app.url, resolve(dataDir, 'thumbnails', file));
      db.prepare("UPDATE apps SET capture=?, capture_status='ready',capture_error=NULL WHERE id=? AND url=?").run(`/thumbnails/${file}`, id, app.url);
    } catch (error) {
      const stage=['dns','browser','navigation','http','screenshot'].includes(error.captureStage)?error.captureStage:'unknown';
      db.prepare("UPDATE apps SET capture_status='failed',capture_error=? WHERE id=? AND url=?").run(stage,id,app.url);
    }
  }
  running = false;
}
