import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('단독 서버 HTML 업로드·교체·재시작 후 보존과 관리자 원본 격리',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'vibe-html-')),base='http://127.0.0.1:3155';let server;
 async function start(){
  server=spawn(process.execPath,['server.js'],{env:{...process.env,DATA_DIR:dir,HOST:'127.0.0.1',PORT:'3155',ADMIN_PASSWORD:'html-test-password'},stdio:'ignore'});
  for(let i=0;i<100;i++){try{if((await fetch(base+'/api/session')).ok)return;}catch{}await new Promise(resolve=>setTimeout(resolve,50));}throw new Error('Server did not start');
 }
 async function stop(){if(server&&server.exitCode===null)await new Promise(resolve=>{server.once('exit',resolve);server.kill();});}
 try{
  await start();const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json','X-Vibe-Request':'1'},body:JSON.stringify({password:'html-test-password'})});const cookie=login.headers.get('set-cookie').split(';')[0];
  const request=(path,body,method='POST')=>fetch(base+path,{method,headers:{'Content-Type':'application/json','X-Vibe-Request':'1',Cookie:cookie},body:JSON.stringify(body)});
  const html='<!doctype html><meta charset="utf-8"><h1>한글 테스트</h1><script>window.example=1;</script>',draft={request_id:'77777777-1111-4222-8333-444444444444',name:'파일 앱',category:'class',html:{filename:'한글.html',text:html}};
  const response=await request('/api/admin/apps',draft);assert.equal(response.status,201);const app=await response.json();assert.match(app.url,/\/uploaded\//);const file=await fetch(app.url);assert.equal(file.status,200);assert.equal(await file.text(),html);assert.match(file.headers.get('content-security-policy'),/sandbox allow-scripts/);assert.equal(file.headers.get('content-security-policy').includes('allow-same-origin'),false);
  assert.equal((await request('/api/admin/apps',draft)).status,200);assert.equal((await(await fetch(base+'/api/apps')).json()).length,1);
  assert.equal((await request('/api/admin/apps/'+app.id,{name:'새 이름'},'PUT')).status,200);let rows=await(await fetch(base+'/api/apps')).json();assert.equal(rows[0].url,app.url);
  assert.equal((await request('/api/admin/apps/'+app.id,{html:{filename:'교체.html',text:html+'<p>교체</p>'}},'PUT')).status,200);rows=await(await fetch(base+'/api/apps')).json();assert.notEqual(rows[0].url,app.url);const updated=rows[0].url;
  await stop();await start();assert.equal((await fetch(updated)).status,200);rows=await(await fetch(base+'/api/apps')).json();assert.equal(rows[0].url,updated);assert.equal(rows[0].html_filename,'교체.html');
 }finally{await stop();await rm(dir,{recursive:true,force:true});}
});
