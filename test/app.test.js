import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { chromium } from 'playwright-core';

const base='http://127.0.0.1:3147';
const password=randomBytes(24).toString('hex');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let server;
async function start(dir) {
  server=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:'3147',HOST:'127.0.0.1',DATA_DIR:dir,ADMIN_PASSWORD:password},stdio:['ignore','pipe','pipe']});
  let logs='';server.stderr.on('data',chunk=>logs+=chunk);
  for(let i=0;i<100;i++){try{if((await fetch(`${base}/api/session`)).ok)return;}catch{}if(server.exitCode!==null)throw new Error(logs);await sleep(100);}
  throw new Error(`Server did not start: ${logs}`);
}
async function stop() { if(!server||server.exitCode!==null)return;await new Promise(resolve=>{server.once('exit',resolve);server.kill();}); }
async function request(path,{method='GET',body,cookie,origin,header=true}={}){
  const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(header?{'X-Vibe-Request':'1'}:{}),...(cookie?{Cookie:cookie}:{}),...(origin?{Origin:origin}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  return {response,data:await response.json()};
}
test('관리자 인증, CRUD, 공개 분리, 정렬, 저장 유지 및 브라우저 동작', {timeout:120000}, async t=>{
  const dir=await mkdtemp(join(tmpdir(),'vibe-test-'));
  let browser;
  try {
    await start(dir);
    await t.test('비인증 접근, CSRF와 잘못된 로그인 차단',async()=>{
      assert.equal((await request('/api/admin/apps')).response.status,401);
      assert.equal((await request('/api/login',{method:'POST',body:{password},header:false})).response.status,403);
      assert.equal((await request('/api/login',{method:'POST',body:{password},origin:'https://evil.example'})).response.status,403);
      assert.equal((await request('/api/login',{method:'POST',body:{password:'wrong'}})).response.status,401);
    });
    const login=await request('/api/login',{method:'POST',body:{password}});
    assert.equal(login.response.status,200);
    const cookie=login.response.headers.get('set-cookie').split(';')[0];
    assert.match(login.response.headers.get('set-cookie'),/HttpOnly/);
    assert.match(login.response.headers.get('set-cookie'),/SameSite=Strict/);
    let first,second;
    await t.test('웹앱 등록 및 내부 주소 차단',async()=>{
      assert.equal((await request('/api/admin/apps',{method:'POST',cookie,body:{name:'내부',url:'http://127.0.0.1',category:'class'}})).response.status,400);
      first=(await request('/api/admin/apps',{method:'POST',cookie,body:{name:'수업 자료 정리',url:'https://github.com/kalapui36/vibe',description:'수업 자료를 모아 확인하는 웹앱',category:'class'}})).data;
      assert.ok(first.id);
      second=(await request('/api/admin/apps',{method:'POST',cookie,body:{name:'업무 일정',url:'https://github.com',description:'일정을 확인합니다.',category:'work',visible:false}})).data;
      assert.ok(second.id);
      assert.equal((await request('/api/apps')).data.length,1);
      assert.equal((await request('/api/admin/apps',{cookie})).data.length,2);
    });
    await t.test('썸네일 업로드, 자동 이미지 복원, 순서 변경',async()=>{
      const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=';
      assert.equal((await request(`/api/admin/apps/${first.id}/thumbnail`,{method:'PUT',cookie,body:{image:png}})).response.status,200);
      assert.ok((await request('/api/apps')).data[0].thumbnail);
      assert.equal((await request(`/api/admin/apps/${first.id}/thumbnail`,{method:'PUT',cookie,body:{image:'data:image/png;base64,YmFk'}})).response.status,400);
      await request(`/api/admin/apps/${first.id}/thumbnail`,{method:'PUT',cookie,body:{image:null}});
      assert.equal((await request('/api/apps')).data[0].thumbnail,null);
      assert.equal((await request('/api/admin/order',{method:'PUT',cookie,body:{ids:[first.id,first.id]}})).response.status,400);
      assert.equal((await request('/api/admin/order',{method:'PUT',cookie,body:{ids:[second.id,first.id]}})).response.status,200);
      assert.equal((await request('/api/admin/apps',{cookie})).data[0].id,second.id);
    });
    await t.test('공개 화면·검색·관리자 편집·모바일',async()=>{
      browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
      const page=await browser.newPage({viewport:{width:1440,height:1050}});
      const errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.goto(base);await page.locator('.app-card').waitFor();
      assert.equal(await page.locator('.app-card').count(),1);
      assert.equal(await page.locator('.app-card').getAttribute('target'),'_blank');
      await page.locator('#search').fill('없는 검색어');await page.getByText('검색 결과가 없습니다.').waitFor();
      await page.locator('#reset-filters').click();await page.locator('.app-card').waitFor();
      await mkdir('test-results',{recursive:true});
      await page.screenshot({path:'test-results/public-desktop.png',fullPage:true});
      await page.setViewportSize({width:390,height:844});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await page.screenshot({path:'test-results/public-mobile.png',fullPage:true});
      await page.goto(base+'/admin');await page.locator('#login-form').waitFor();
      await page.locator('[name=password]').fill(password);await page.locator('#login-form button').click();await page.locator('.admin-row').first().waitFor();
      assert.equal(await page.locator('.admin-row').count(),2);
      await page.locator(`[data-id="${first.id}"] [data-action=edit]`).click();
      await page.locator('#app-form [name=name]').fill('수업 자료 모음');
      await page.locator('#save-app').click();await page.waitForFunction(()=>!document.querySelector('#editor').open);
      assert.equal((await request('/api/apps')).data[0].name,'수업 자료 모음');
      await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:'test-results/admin-desktop.png',fullPage:true});
      await page.setViewportSize({width:390,height:844});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await page.screenshot({path:'test-results/admin-mobile.png',fullPage:true});
      assert.deepEqual(errors,[]);
      await browser.close();browser=null;
    });
    await t.test('실제 원격 첫 화면 자동 캡처',async()=>{
      let item;
      for(let i=0;i<160;i++) {item=(await request('/api/admin/apps',{cookie})).data.find(a=>a.id===first.id);if(item.capture_status!=='pending')break;await sleep(250);}
      assert.equal(item.capture_status,'ready','외부 첫 화면 캡처가 성공해야 합니다.');
      const response=await fetch(base+item.capture);
      assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/image\/jpeg/);
      assert.ok((await response.arrayBuffer()).byteLength>5000);
    });
    await t.test('서버 재시작 후 데이터와 세션 유지 및 삭제',async()=>{
      await stop();await start(dir);
      assert.equal((await request('/api/admin/apps',{cookie})).data.length,2);
      await request(`/api/admin/apps/${second.id}`,{method:'DELETE',cookie});
      assert.equal((await request('/api/admin/apps',{cookie})).data.length,1);
      await request('/api/logout',{method:'POST',cookie});
      assert.equal((await request('/api/admin/apps',{cookie})).response.status,401);
    });
  } finally {await browser?.close();await stop();await rm(dir,{recursive:true,force:true});}
});
