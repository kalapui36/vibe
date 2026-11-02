import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { chromium } from 'playwright-core';
import { oauthFixture } from './helpers/oauth-fixture.js';

const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=';
test('Pages 로그인 버튼 → GitHub 인증 → 관리자 편집·세션 유지·다른 계정 거부',async()=>{
  const f=await oauthFixture();
  const pages=express();pages.use('/vibe',express.static(process.cwd()));
  const server=await new Promise(resolve=>{const s=pages.listen(0,'127.0.0.1',()=>resolve(s));});
  const base=`http://127.0.0.1:${server.address().port}/vibe/`;
  let browser;
  try{
    browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
    const page=await browser.newPage(),errors=[],apiRequests=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('request',request=>{if(request.url().startsWith('https://api.github.com/'))apiRequests.push(request.url());});
    await page.context().route('https://github.com/**',route=>route.abort());
    await page.context().route(f.base+'/auth/login',async route=>{
      const response=await route.fetch({maxRedirects:0});
      const destination=response.headers().location;
      if(destination?.startsWith('https://github.com/login/oauth/authorize')){
        const state=new URL(destination).searchParams.get('state');
        return route.fulfill({response,headers:{...response.headers(),location:`${f.base}/auth/callback?code=owner-browser&state=${state}`}});
      }
      return route.fulfill({response});
    });
    await page.route(base+'content/config.json',route=>route.fulfill({json:{...f.state.publicConfig,auth_url:f.base}}));
    await page.context().route('https://kalapui.com/vibe/content/thumbnails/**',route=>route.fulfill({contentType:'image/png',body:Buffer.from(png.split(',')[1],'base64')}));
    await page.goto(base+'manage.html');
    await page.locator('.oauth-button').waitFor();
    assert.equal(await page.locator('[name=token]').count(),0);assert.equal(await page.locator('[name=password]').count(),0);
    await page.locator('.oauth-button').click();
    try{await page.locator('#add-app').waitFor({timeout:6000});}catch{throw new Error(JSON.stringify({url:page.url(),main:await page.locator('main').textContent(),errors,calls:f.state.calls}));}
    assert.equal(page.url(),f.base+'/admin');
    assert.equal(f.state.publicConfig.auth_url,f.base);
    await page.locator('#add-app').click();
    await page.locator('#app-form [name=name]').fill('학급 활동');
    await page.locator('#app-form [name=url]').fill('https://example.com/');
    await page.locator('#app-form [name=description]').fill('한글 설명을 저장합니다.');
    await page.locator('#app-form [name=primary_label]').fill('학생용');
    await page.locator('#add-link').click();await page.locator('.link-label').fill('교사용 설정');await page.locator('.link-url').fill('https://example.com/teacher');
    await page.locator('#add-link').click();await page.locator('.link-label').nth(1).fill('활동지');await page.locator('.link-url').nth(1).fill('https://example.com/worksheet');
    await page.locator('.link-up').nth(1).click();
    await page.locator('#save-app').click();
    await page.waitForFunction(()=>!document.querySelector('#editor').open||document.querySelector('#editor-error').textContent);
    assert.equal(await page.locator('#editor').evaluate(el=>el.open),false,await page.locator('#editor-error').textContent());
    assert.equal(f.state.rows.length,1);assert.deepEqual(f.state.rows[0].links.map(link=>link.label),['활동지','교사용 설정']);
    const first=f.state.rows[0].id,module=f.base+'/shared.js';
    await page.evaluate(async module=>{
      const {api}=await import(module);
      await api('/api/admin/apps',{method:'POST',body:{name:'두 번째 앱',url:'https://example.org/',category:'work',visible:true}});
      const rows=await api('/api/admin/apps');
      await api('/api/admin/order',{method:'PUT',body:{ids:[rows[1].id,rows[0].id]}});
    },module);
    assert.equal(f.state.rows.find(row=>row.id===first).position,1);
    await page.evaluate(async({module,first,png})=>{
      const {api}=await import(module);
      await api(`/api/admin/apps/${first}`,{method:'PUT',body:{name:'수정된 이름',visible:false}});
      await api(`/api/admin/apps/${first}/thumbnail`,{method:'PUT',body:{image:png}});
    },{module,first,png});
    assert.equal(f.state.rows.find(row=>row.id===first).visible,false);assert.equal(f.state.uploads.length,1);
    const exchanges=f.state.exchanges;
    await page.reload();await page.locator('#add-app').waitFor();assert.equal(f.state.exchanges,exchanges);
    assert.deepEqual(await page.evaluate(()=>[localStorage.length,sessionStorage.length]),[0,0]);
    assert.equal((await page.evaluate(()=>document.cookie)).includes('vibe_session'),false);
    await page.evaluate(async({module,first})=>{const {api}=await import(module);await api(`/api/admin/apps/${first}`,{method:'DELETE'});},{module,first});
    assert.equal(f.state.rows.length,1);
    assert.deepEqual(apiRequests,[]);
    await page.locator('#logout').click();await page.locator('.oauth-button').waitFor();
    await page.reload();await page.locator('.oauth-button').waitFor();
    const outsider=await browser.newContext();
    await outsider.route('https://github.com/**',route=>route.abort());
    await outsider.route(f.base+'/auth/login',async route=>{
      const response=await route.fetch({maxRedirects:0});
      const state=new URL(response.headers().location).searchParams.get('state');
      return route.fulfill({response,headers:{...response.headers(),location:`${f.base}/auth/callback?code=outsider-browser&state=${state}`}});
    });
    const otherPage=await outsider.newPage();await otherPage.goto(f.base+'/admin');await otherPage.locator('.oauth-button').click();
    await otherPage.getByText('이 GitHub 계정은 관리자로 허용되지 않습니다. kalapui36 계정으로 로그인해 주세요.').waitFor();
    assert.equal(await otherPage.locator('#add-app').count(),0);
    const response=await outsider.request.get(f.base+'/api/admin/apps');assert.equal(response.status(),401);
    await outsider.close();assert.deepEqual(errors,[]);
  }finally{await browser?.close();await f.close();await new Promise(resolve=>server.close(resolve));}
});
