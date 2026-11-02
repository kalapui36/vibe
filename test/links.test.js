import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { capturePage, publicUrl } from '../screenshot.js';

test('기존 SQLite 데이터는 보존하고 관련 주소 저장 구조로 이전한다',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'vibe-links-'));
  const legacy=new DatabaseSync(join(dir,'vibe.sqlite'));
  legacy.exec(`CREATE TABLE apps (id TEXT PRIMARY KEY,name TEXT,url TEXT,description TEXT,category TEXT,visible INTEGER,position INTEGER,thumbnail TEXT,capture TEXT,capture_status TEXT,created_at TEXT);INSERT INTO apps VALUES ('legacy','기존 앱','https://example.com/','설명','class',1,0,NULL,NULL,'failed','2026-01-01');`);legacy.close();
  const server=spawn(process.execPath,['server.js'],{env:{...process.env,DATA_DIR:dir,PORT:'3152',HOST:'127.0.0.1',ADMIN_PASSWORD:'test-password-4021'},stdio:'ignore'});
  const base='http://127.0.0.1:3152';
  try{
    let ready=false;
    for(let i=0;i<100;i++){try{if((await fetch(base+'/api/session')).ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,50));}
    assert.ok(ready,'Server should start');
    const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json','X-Vibe-Request':'1'},body:JSON.stringify({password:'test-password-4021'})});
    assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
    const headers={'Content-Type':'application/json','X-Vibe-Request':'1',Cookie:cookie};
    const original=await(await fetch(base+'/api/apps')).json();assert.equal(original[0].name,'기존 앱');assert.deepEqual(original[0].links,[]);
    const payload={name:'기존 앱',url:'https://example.com/',description:'설명',category:'class',primary_label:'학생용',links:[{label:'교사용',url:'https://example.com/teacher'}]};
    assert.equal((await fetch(base+'/api/admin/apps/legacy',{method:'PUT',headers,body:JSON.stringify(payload)})).status,200);
    assert.equal((await fetch(base+'/api/admin/apps/legacy',{method:'PUT',headers,body:JSON.stringify({name:'수정한 이름'})})).status,200);
    let rows=await(await fetch(base+'/api/apps')).json();assert.equal(rows[0].primary_label,'학생용');assert.deepEqual(rows[0].links,payload.links);
    assert.equal((await fetch(base+'/api/admin/apps/legacy',{method:'PUT',headers,body:JSON.stringify({...payload,links:[{label:'잘못된 링크',url:'javascript:alert(1)'}]})})).status,400);
    rows=await(await fetch(base+'/api/apps')).json();assert.deepEqual(rows[0].links,payload.links);
    const draft={...payload,name:'중복 등록 방지',request_id:'22222222-2222-4222-8222-222222222222'};
    assert.equal((await fetch(base+'/api/admin/apps',{method:'POST',headers,body:JSON.stringify(draft)})).status,201);
    assert.equal((await fetch(base+'/api/admin/apps',{method:'POST',headers,body:JSON.stringify(draft)})).status,200);
    rows=await(await fetch(base+'/api/apps')).json();assert.equal(rows.length,2);
  }finally{if(server.exitCode===null)await new Promise(resolve=>{server.once('exit',resolve);server.kill();});await rm(dir,{recursive:true,force:true});}
});
test('자동 캡처 실패 단계를 구분하며 내부 주소를 차단한다',async()=>{
  for(const url of ['http://127.0.0.1/','http://10.0.0.1/','http://172.16.0.1/','http://192.168.0.1/','http://169.254.169.254/','http://[::1]/','http://[::ffff:127.0.0.1]/']) {
    await assert.rejects(capturePage(url,'/tmp/not-created.jpg'),error=>error.captureStage==='dns');
  }
  assert.equal(await publicUrl('https://185.199.108.153/'),'https://185.199.108.153/');
  assert.equal(await publicUrl('https://[2606:50c0:8000::153]/'),'https://[2606:50c0:8000::153]/');
  const previous=process.env.CHROMIUM_PATH;process.env.CHROMIUM_PATH='/tmp/nonexistent-vibe-browser';
  try{await assert.rejects(capturePage('https://185.199.108.153/','/tmp/not-created.jpg'),error=>error.captureStage==='browser');}
  finally{if(previous===undefined)delete process.env.CHROMIUM_PATH;else process.env.CHROMIUM_PATH=previous;}
});
