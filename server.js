import { webAddress, relatedLinks, primaryLabel, creationId, sameEntryMetadata } from './public/catalog.js';
import { validateHtml, htmlLocation } from './public/html-file.js';
import express from 'express';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, dataDir, getPassword, setPassword, verifyPassword } from './store.js';
import { normalizeUrl, scheduleCapture } from './capture.js';

const app = express();
const root = dirname(fileURLToPath(import.meta.url));
if (!getPassword()) {
  const initialPassword = process.env.ADMIN_PASSWORD || '4021';
  if (initialPassword.length < 4) throw new Error('ADMIN_PASSWORD must contain at least 4 characters');
  setPassword(initialPassword);
}
const tokenHash = token => createHash('sha256').update(token).digest('hex');
app.disable('x-powered-by');
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" });
  if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    if (req.get('X-Vibe-Request') !== '1') return res.status(403).json({ error: '허용되지 않은 요청입니다.' });
    const origin = req.get('origin');
    if (origin && origin !== (process.env.APP_ORIGIN || `${req.protocol}://${req.get('host')}`)) return res.status(403).json({ error: '허용되지 않은 출처입니다.' });
  }
  next();
});
app.use(express.json({ limit: '7mb' }));
const attempts = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of attempts) if (value.until < now) attempts.delete(key);
  db.prepare('DELETE FROM sessions WHERE expires < ?').run(now);
}, 60000).unref();
function authenticated(req) {
  const token = /(?:^|;\s*)vibe_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
  return token && db.prepare('SELECT token FROM sessions WHERE token=? AND expires>?').get(tokenHash(token), Date.now());
}
function admin(req, res, next) {
  if (!authenticated(req)) return res.status(401).json({ error: '관리자 로그인이 필요합니다.' });
  next();
}
app.get('/api/session', (req, res) => res.json({ authenticated: !!authenticated(req), configured: !!getPassword() }));
app.post('/api/login', (req, res) => {
  if (!getPassword()) return res.status(503).json({ error: '서버에서 관리자 비밀번호를 먼저 설정해 주세요.' });
  const key = req.ip;
  const attempt = attempts.get(key) || { count: 0, until: Date.now() + 15 * 60000 };
  if (attempt.count >= 10) return res.status(429).json({ error: '로그인 시도가 많습니다. 15분 뒤 다시 시도해 주세요.' });
  if (!verifyPassword(req.body?.password, getPassword())) {
    attempt.count++; attempts.set(key, attempt);
    return res.status(401).json({ error: '비밀번호를 확인해 주세요.' });
  }
  attempts.delete(key);
  const token = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions VALUES (?,?)').run(tokenHash(token), Date.now() + 12 * 3600000);
  res.cookie('vibe_session', token, { httpOnly: true, sameSite: 'strict', secure: req.secure || process.env.COOKIE_SECURE === '1', maxAge: 12 * 3600000, path: '/' });
  res.json({ ok: true });
});
app.post('/api/logout', (req, res) => {
  const token = /(?:^|;\s*)vibe_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
  if (token) db.prepare('DELETE FROM sessions WHERE token=?').run(tokenHash(token));
  res.clearCookie('vibe_session', { path: '/' }); res.json({ ok: true });
});
function serialize(row) { return { ...row, visible: !!row.visible, links: JSON.parse(row.links || '[]'), image: row.thumbnail || row.capture || null }; }
app.get('/api/apps', (req, res) => res.json(db.prepare('SELECT * FROM apps WHERE visible=1 ORDER BY position, created_at').all().map(serialize)));
app.get('/api/admin/apps', admin, (req, res) => res.json(db.prepare('SELECT * FROM apps ORDER BY position, created_at').all().map(serialize)));
async function htmlSource(req,id){
  if(req.body?.html===undefined)return null;
  const upload=validateHtml(req.body.html),base=(process.env.APP_ORIGIN||`${req.protocol}://${req.get('host')}`)+'/';
  return {upload,metadata:await htmlLocation(id,upload,base,'uploaded')};
}
async function saveHtml(source){
  if(!source)return;
  const path=resolve(dataDir,source.metadata.html_path);await mkdir(dirname(path),{recursive:true});
  try{await writeFile(path,source.upload.text,{encoding:'utf8',flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;}
}
async function validate(body,{hosted=false}={}) {
  const name = String(body.name || '').trim();
  const description = String(body.description || '').trim();
  if (!name || name.length > 80 || description.length > 240) throw new Error('이름은 1~80자, 설명은 240자 이내로 입력해 주세요.');
  if (!['class', 'mind', 'work'].includes(body.category)) throw new Error('분류를 선택해 주세요.');
  return { name, description, url: hosted?webAddress(body.url):normalizeUrl(body.url), category: body.category, visible: body.visible === false ? 0 : 1, primary_label: primaryLabel(body.primary_label), links:relatedLinks(body.links).map(link=>({...link,url:normalizeUrl(link.url)})) };
}
app.post('/api/admin/apps', admin, async (req, res) => {
  const id = creationId(req.body.request_id)||randomUUID();
  const source=await htmlSource(req,id),html=source?.metadata;
  const value = await validate({...req.body,...(html||{})},{hosted:!!source});
  const existing=db.prepare('SELECT * FROM apps WHERE id=?').get(id);
  if(existing){
    if(!sameEntryMetadata(serialize(existing),value))return res.status(409).json({error:'이미 저장된 등록 요청입니다. 최신 내용을 불러와 확인해 주세요.',code:'conflict'});
    return res.json(serialize(existing));
  }
  const position = db.prepare('SELECT COALESCE(MAX(position),-1)+1 AS position FROM apps').get().position;
  await saveHtml(source);
  db.prepare('INSERT INTO apps (id,name,url,description,category,visible,position,primary_label,links,html_path,html_filename,html_sha256) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(id,value.name,value.url,value.description,value.category,value.visible,position,value.primary_label,JSON.stringify(value.links),html?.html_path||null,html?.html_filename||null,html?.html_sha256||null);
  scheduleCapture(id); res.status(201).json(serialize(db.prepare('SELECT * FROM apps WHERE id=?').get(id)));
});
app.put('/api/admin/order', admin, (req, res) => {
  const ids = req.body?.ids;
  const rows = db.prepare('SELECT id FROM apps').all();
  if (!Array.isArray(ids) || ids.length !== rows.length || new Set(ids).size !== rows.length || rows.some(row => !ids.includes(row.id))) return res.status(400).json({ error: '목록이 변경되었습니다. 새로고침 후 다시 시도해 주세요.' });
  db.exec('BEGIN');
  try { ids.forEach((id, index) => db.prepare('UPDATE apps SET position=? WHERE id=?').run(index,id)); db.exec('COMMIT'); }
  catch (error) { db.exec('ROLLBACK'); throw error; }
  res.json({ ok: true });
});
app.put('/api/admin/apps/:id', admin, async (req, res) => {
  const old = db.prepare('SELECT * FROM apps WHERE id=?').get(req.params.id);
  if (!old) return res.status(404).json({ error: '웹앱을 찾을 수 없습니다.' });
  const source=await htmlSource(req,old.id),html=source?.metadata;
  const v = await validate({...serialize(old),...req.body,...(html||{})},{hosted:!!source||!!old.html_path&&(req.body.url===undefined||req.body.url===old.url)});
  const keep=html||old.url===v.url&&old;
  await saveHtml(source);
  db.prepare('UPDATE apps SET name=?,url=?,description=?,category=?,visible=?,primary_label=?,links=?,html_path=?,html_filename=?,html_sha256=? WHERE id=?').run(v.name,v.url,v.description,v.category,v.visible,v.primary_label,JSON.stringify(v.links),keep?.html_path||null,keep?.html_filename||null,keep?.html_sha256||null,old.id);
  if (old.url !== v.url) { db.prepare('UPDATE apps SET capture=NULL WHERE id=?').run(old.id); scheduleCapture(old.id); }
  res.json({ ok: true });
});
app.delete('/api/admin/apps/:id', admin, (req,res) => { db.prepare('DELETE FROM apps WHERE id=?').run(req.params.id); res.json({ ok:true }); });
app.post('/api/admin/apps/:id/capture', admin, (req,res) => {
  if (!db.prepare('SELECT id FROM apps WHERE id=?').get(req.params.id)) return res.status(404).json({ error: '웹앱을 찾을 수 없습니다.' });
  scheduleCapture(req.params.id); res.json({ ok:true });
});
app.put('/api/admin/apps/:id/thumbnail', admin, async (req,res) => {
  if (!db.prepare('SELECT id FROM apps WHERE id=?').get(req.params.id)) return res.status(404).json({ error:'웹앱을 찾을 수 없습니다.' });
  let path = null;
  if (req.body.image !== null) {
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(req.body.image || '');
    if (!match) throw new Error('PNG, JPG, WebP 이미지만 업로드할 수 있습니다.');
    const buffer = Buffer.from(match[2], 'base64');
    const type = match[1];
    const valid = type === 'png' ? buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : type === 'jpeg' ? buffer[0]===255 && buffer[1]===216 && buffer[2]===255 : buffer.toString('ascii',0,4)==='RIFF' && buffer.toString('ascii',8,12)==='WEBP';
    if (!valid || buffer.length > 4 * 1024 * 1024) throw new Error('유효한 이미지 파일(최대 4MB)을 선택해 주세요.');
    const file = `${randomUUID()}.${type}`;
    await writeFile(resolve(dataDir, 'thumbnails', file),buffer);
    path = `/thumbnails/${file}`;
  }
  db.prepare('UPDATE apps SET thumbnail=? WHERE id=?').run(path,req.params.id); res.json({ ok:true });
});
app.use('/thumbnails', express.static(resolve(dataDir,'thumbnails'), { immutable: true, maxAge:'1y', dotfiles:'deny' }));
// Uploaded programs run without the administrator origin in standalone mode.
app.use('/uploaded',express.static(resolve(dataDir,'uploaded'),{immutable:true,maxAge:'1y',dotfiles:'deny',setHeaders:res=>res.setHeader('Content-Security-Policy',"sandbox allow-scripts allow-forms allow-modals allow-downloads; frame-ancestors 'none'")}));
app.get('/admin', (req,res) => res.sendFile(resolve(root,'public/admin.html')));
app.use(express.static(resolve(root,'public')));
app.use((err,req,res,next) => {
  const known = err.message && !['SQLITE','ENOENT','ENOTFOUND','EAI_AGAIN'].some(code=>err.message.includes(code));
  res.status(err.status || 400).json({ error: known ? err.message : '요청을 처리하지 못했습니다. 주소와 서버 상태를 확인해 주세요.' });
});
const port = Number(process.env.PORT || 3000);
app.listen(port, process.env.HOST || '0.0.0.0', () => {
  console.log(`Vibe server listening on port ${port}`);
  if (!getPassword()) console.log('관리자 설정 필요: npm run admin:password');
  for (const row of db.prepare("SELECT id FROM apps WHERE capture_status='pending'").all()) scheduleCapture(row.id);
});
