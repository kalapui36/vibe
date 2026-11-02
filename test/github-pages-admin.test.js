import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { chromium } from 'playwright-core';

test('Pages 관리자가 GitHub Contents API로 등록·수정·정렬·썸네일·삭제를 저장한다', async () => {
  const app=express();app.use('/vibe',express.static(process.cwd()));
  const server=await new Promise(resolve=>{const instance=app.listen(0,'127.0.0.1',()=>resolve(instance));});
  let browser;
  try {
    browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
    const page=await browser.newPage();
    let rows=[],sha='initial',writes=0,conflict=false;
    const uploaded=[];
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('https://api.github.com/**',async route=>{
      const request=route.request(),url=new URL(request.url());
      assert.equal(request.headers().authorization,'Bearer test-token-not-a-real-credential');
      assert.equal(url.pathname.startsWith('/repos/kalapui36/vibe'),true);
      if(url.pathname==='/repos/kalapui36/vibe')return route.fulfill({json:{permissions:{push:true}}});
      if(url.pathname.endsWith('/content/apps.json')){
        if(request.method()==='GET')return route.fulfill({json:{sha,content:Buffer.from(JSON.stringify(rows)).toString('base64')}});
        const payload=request.postDataJSON();
        if(conflict||payload.sha!==sha)return route.fulfill({status:409,json:{message:'Conflict'}});
        rows=JSON.parse(Buffer.from(payload.content,'base64').toString('utf8'));sha=`revision-${++writes}`;
        return route.fulfill({json:{content:{sha}}});
      }
      if(request.method()==='PUT'&&url.pathname.includes('/content/thumbnails/')){
        uploaded.push(request.postDataJSON());return route.fulfill({json:{content:{sha:'image'}}});
      }
      throw new Error('Unexpected API request');
    });
    const base=`http://127.0.0.1:${server.address().port}/vibe/`;
    await page.route(base+'content/apps.json',route=>route.fulfill({json:rows}));
    await page.route(base+'content/thumbnails/*',route=>route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=','base64')}));
    await page.goto(base+'admin/');
    await page.locator('[name=token]').fill('test-token-not-a-real-credential');
    await page.locator('#login-form button').click();await page.locator('#add-app').waitFor();
    await page.locator('#add-app').click();
    await page.locator('#app-form [name=name]').fill('학급 활동');
    await page.locator('#app-form [name=url]').fill('https://example.com/');
    await page.locator('#app-form [name=description]').fill('한글 설명을 저장합니다.');
    await page.locator('#save-app').click();await page.waitForFunction(()=>!document.querySelector('#editor').open || document.querySelector('#editor-error').textContent);
    assert.equal(await page.locator('#editor').evaluate(dialog=>dialog.open),false,await page.locator('#editor-error').textContent());
    assert.equal(rows.length,1);assert.equal(rows[0].name,'학급 활동');assert.equal(rows[0].capture_status,'pending');
    const first=rows[0].id;
    const module=base+'public/shared.js';
    await page.evaluate(async module=>{
      const {api}=await import(module);
      await api('/api/admin/apps',{method:'POST',body:{name:'두 번째 앱',url:'https://example.org/',category:'work',visible:true}});
      const items=await api('/api/admin/apps');
      await api('/api/admin/order',{method:'PUT',body:{ids:[items[1].id,items[0].id]}});
    },module);
    assert.equal(rows.find(row=>row.id===first).position,1);
    const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=';
    await page.evaluate(async({module,first,png})=>{
      const {api}=await import(module);
      await api(`/api/admin/apps/${first}`,{method:'PUT',body:{name:'수정된 이름',url:'https://example.com/',description:'수정',category:'mind',visible:false}});
      await api(`/api/admin/apps/${first}/thumbnail`,{method:'PUT',body:{image:png}});
    },{module,first,png});
    assert.equal(rows.find(row=>row.id===first).visible,false);
    assert.equal(uploaded.length,1);
    assert.match(rows.find(row=>row.id===first).thumbnail,/^content\/thumbnails\//);
    await page.evaluate(async({module,first})=>{
      const {api}=await import(module);
      await api(`/api/admin/apps/${first}/thumbnail`,{method:'PUT',body:{image:null}});
      await api(`/api/admin/apps/${first}/capture`,{method:'POST'});
    },{module,first});
    assert.equal(rows.find(row=>row.id===first).thumbnail,null);
    conflict=true;
    const conflictMessage=await page.evaluate(async({module,first})=>{
      const {api}=await import(module);
      try {await api(`/api/admin/apps/${first}`,{method:'DELETE'});}catch(error){return error.message;}
    },{module,first});
    assert.match(conflictMessage,/다른 곳에서 목록이 변경/);
    assert.equal(rows.length,2);
    conflict=false;
    await page.evaluate(async({module,first})=>{const {api}=await import(module);await api(`/api/admin/apps/${first}`,{method:'DELETE'});},{module,first});
    assert.equal(rows.length,1);
    assert.deepEqual(await page.evaluate(()=>[localStorage.length,sessionStorage.length]),[0,0]);
    await page.reload();await page.locator('[name=token]').waitFor();
    assert.equal(await page.locator('[name=token]').inputValue(),'');
    await page.goto(base);await page.locator('.app-card').waitFor();assert.equal(await page.locator('.app-card').count(),1);
    assert.deepEqual(errors,[]);
  } finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
});
