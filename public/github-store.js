import { webAddress, relatedLinks, primaryLabel } from './catalog.js';
// Credentials stay in memory for this tab. No localStorage, public file, or URL tokens.
let token = '';
let config;
let snapshot;
const catalogPath = 'content/apps.json';
const baseUrl = new URL('../', import.meta.url);
const categories = new Set(['class', 'mind', 'work']);

async function settings() {
  if (!config) {
    const response = await fetch(new URL('content/config.json', baseUrl), { cache: 'no-cache' });
    if (!response.ok) throw new Error('저장소 설정을 불러오지 못했습니다.');
    config = await response.json();
    if (![config.owner, config.repo].every(part => /^[\w.-]+$/.test(part)) || typeof config.branch !== 'string') throw new Error('저장소 설정을 확인해 주세요.');
  }
  return config;
}
async function github(path, { method = 'GET', body } = {}) {
  const { owner, repo } = await settings();
  const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${path}`, {
    method, cache: 'no-store', headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    if (response.status === 401) { token = ''; snapshot = null; }
    const message = response.status === 401 ? '토큰이 만료되었거나 올바르지 않습니다.' : response.status === 403 ? '저장소의 Contents 읽기·쓰기 권한을 확인해 주세요.' : response.status === 404 ? '저장소를 찾을 수 없습니다. 토큰의 저장소 접근 권한을 확인해 주세요.' : [409,422].includes(response.status) ? '다른 곳에서 목록이 변경되었습니다. 새로 로그인한 뒤 다시 시도해 주세요.' : 'GitHub 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
    const error = new Error(message); error.status = response.status; throw error;
  }
  return response.status === 204 ? null : response.json();
}
function decode(value) { return new TextDecoder().decode(Uint8Array.from(atob(value.replace(/\s/g, '')), char => char.charCodeAt(0))); }
function encode(value) {
  const bytes = new TextEncoder().encode(value);
  let text = '';
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(text);
}
function decorate(row) {
  const image = row.thumbnail || row.capture || null;
  return { ...row, image: image ? new URL(image, baseUrl).href : null, preview:row.preview?new URL(row.preview,baseUrl).href:null };
}
async function load() {
  const { branch } = await settings();
  const file = await github(`/contents/${catalogPath}?ref=${encodeURIComponent(branch)}`);
  const rows = JSON.parse(decode(file.content));
  if (!Array.isArray(rows)) throw new Error('목록 파일 형식을 확인해 주세요.');
  snapshot = { sha: file.sha, rows };
  return rows.slice().sort((a,b) => a.position - b.position).map(decorate);
}
async function save(rows, message) {
  const { branch } = await settings();
  if (!snapshot) await load();
  const result = await github(`/contents/${catalogPath}`, { method:'PUT', body:{ message, content:encode(JSON.stringify(rows,null,2)+'\n'), sha:snapshot.sha, branch } });
  snapshot = { sha:result.content.sha, rows };
}
function validated(body) {
  const name = String(body.name || '').trim(), description = String(body.description || '').trim();
  let url;
  try { url = new URL(body.url); } catch { throw new Error('웹 주소를 확인해 주세요.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('HTTP 또는 HTTPS 주소를 입력해 주세요.');
  if (!name || name.length > 80 || description.length > 240 || !categories.has(body.category)) throw new Error('이름, 설명, 분류를 확인해 주세요.');
  return { name, description, url:webAddress(url.href), category:body.category, visible:body.visible !== false, primary_label:primaryLabel(body.primary_label), links:relatedLinks(body.links) };
}
export async function pagesApi(path, options = {}) {
  const method = options.method || 'GET', body = options.body;
  if (path === '/api/session') return { authenticated:!!token, configured:true, mode:'github' };
  if (path === '/api/login') {
    token = String(body?.token || '').trim();
    if (!token) throw new Error('GitHub 토큰을 입력해 주세요.');
    try {
      const repo = await github('');
      if (repo.permissions?.push !== true) throw new Error('이 저장소를 수정할 수 있는 GitHub 계정의 토큰이 필요합니다.');
      await load();
      return { ok:true };
    } catch (error) { token='';snapshot=null;throw error; }
  }
  if (path === '/api/logout') { token='';snapshot=null;return {ok:true}; }
  if (!token) { const error=new Error('GitHub 로그인이 필요합니다.');error.status=401;throw error; }
  if (path === '/api/admin/apps' && method === 'GET') return load();
  if (!snapshot) await load();
  const rows = structuredClone(snapshot.rows);
  if (path === '/api/admin/order') {
    if (!Array.isArray(body.ids) || new Set(body.ids).size !== rows.length || body.ids.length !== rows.length || rows.some(row=>!body.ids.includes(row.id))) throw new Error('목록이 변경되었습니다. 다시 불러와 주세요.');
    body.ids.forEach((id,index)=>rows.find(row=>row.id===id).position=index);
    await save(rows,'Update web app order');return {ok:true};
  }
  if (path === '/api/admin/apps' && method === 'POST') {
    const value=validated(body);
    const row={...value,id:crypto.randomUUID(),position:Math.max(-1,...rows.map(row=>row.position))+1,thumbnail:null,capture:null,capture_status:'pending',created_at:new Date().toISOString()};
    rows.push(row);await save(rows,'Add web app');return decorate(row);
  }
  const match=/^\/api\/admin\/apps\/([\w-]+)(?:\/(thumbnail|capture))?$/.exec(path);
  const row=match && rows.find(row=>row.id===match[1]);
  if (!row) throw new Error('웹앱을 찾을 수 없습니다.');
  if (!match[2] && method==='PUT') {
    const value=validated({...row,...body});
    if(row.url!==value.url){row.capture=null;row.capture_status='pending';row.capture_error=null;}
    Object.assign(row,value);await save(rows,'Update web app');return {ok:true};
  }
  if (!match[2] && method==='DELETE') {await save(rows.filter(item=>item.id!==row.id),'Delete web app');return {ok:true};}
  if (match[2]==='capture') {row.capture_status='pending';row.capture_error=null;await save(rows,'Refresh web app screenshot');return {ok:true};}
  if (match[2]==='thumbnail') {
    if(body.image===null)row.thumbnail=null;
    else {
      const match=/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(body.image||'');
      if(!match||match[2].length>5600000)throw new Error('4MB 이하의 PNG, JPG, WebP 이미지를 선택해 주세요.');
      const bytes=Uint8Array.from(atob(match[2]),char=>char.charCodeAt(0));
      const valid=match[1]==='png'?[137,80,78,71,13,10,26,10].every((byte,index)=>bytes[index]===byte):match[1]==='jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:String.fromCharCode(...bytes.subarray(0,4))==='RIFF'&&String.fromCharCode(...bytes.subarray(8,12))==='WEBP';
      if(!valid||bytes.length>4*1024*1024)throw new Error('유효한 이미지 파일을 선택해 주세요.');
      const file=`content/thumbnails/${crypto.randomUUID()}.${match[1]}`;
      const {branch}=await settings();
      await github(`/contents/${file}`,{method:'PUT',body:{message:'Upload web app thumbnail',content:match[2],branch}});
      row.thumbnail=file;
    }
    await save(rows,'Update web app thumbnail');return {ok:true};
  }
  throw new Error('지원하지 않는 요청입니다.');
}
