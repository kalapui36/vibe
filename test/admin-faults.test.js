import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { oauthFixture } from './helpers/oauth-fixture.js';

test('관리자 실패·복구 상황 시뮬레이션',async t=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
 async function loggedIn({open=true}={}){
  const f=await oauthFixture();const {cookie}=await f.login();const [name,...parts]=cookie.split('=');
  const context=await browser.newContext();await context.addCookies([{name,value:parts.join('='),url:f.base,httpOnly:true,sameSite:'Lax'}]);
  await context.route('https://kalapui.com/**',route=>route.fulfill({status:404,body:''}));
  const page=await context.newPage();if(open){await page.goto(f.base+'/admin');await page.locator('#add-app').waitFor();}return {f,page,close:async()=>{await context.close();await f.close();}};
 }
 async function newForm(page,name='새 프로그램'){
  await page.locator('#add-app').click();await page.locator('[name=name]').fill(name);await page.locator('[name=url]').fill('https://example.com/');
 }
 try{
  await t.test('저장은 됐지만 응답이 끊긴 뒤 재시도해도 중복 등록되지 않음',async()=>{
   const {f,page,close}=await loggedIn();let damaged=false;
   try{
    await page.route(f.base+'/api/admin/apps',async route=>{
     if(route.request().method()==='POST'&&!damaged){damaged=true;const response=await route.fetch();const headers={...response.headers()};delete headers['content-length'];return route.fulfill({status:response.status(),headers,body:'{'});}
     return route.continue();
    });
    await newForm(page);await page.locator('#save-app').click();await page.waitForFunction(()=>document.querySelector('#editor-error').textContent.length>0);
    assert.equal(f.state.rows.length,1);await page.locator('#save-app').click();
    await page.waitForFunction(()=>!document.querySelector('#editor').open||/다른 곳/.test(document.querySelector('#editor-error').textContent));
    assert.equal(await page.locator('#editor').evaluate(el=>el.open),false,'Retry should recover a committed create without making a second row');assert.equal(f.state.rows.length,1);
   }finally{await close();}
  });
  await t.test('다른 기기 수정과 충돌하면 입력을 보존하고 최신 내용을 다시 열 수 있음',async()=>{
   const {f,page,close}=await loggedIn();
   try{
    await newForm(page);await page.locator('#save-app').click();await page.waitForFunction(()=>!document.querySelector('#editor').open);
    await page.locator('[data-action=edit]').click();await page.locator('[name=name]').fill('내가 편집 중인 이름');
    f.state.rows[0].name='다른 기기에서 저장한 이름';f.state.revision='catalog-external';
    await page.locator('#save-app').click();await page.waitForFunction(()=>document.querySelector('#editor-error').textContent.length>0);
    assert.equal(await page.locator('[name=name]').inputValue(),'내가 편집 중인 이름');
    assert.equal(await page.locator('#reload-editor:not([hidden])').count(),1);
    page.once('dialog',dialog=>dialog.accept());await page.locator('#reload-editor').click();
    await page.waitForFunction(()=>document.querySelector('[name=name]').value==='다른 기기에서 저장한 이름');
    await page.locator('[name=name]').fill('검토 후 다시 저장');await page.locator('#save-app').click();await page.waitForFunction(()=>!document.querySelector('#editor').open);assert.equal(f.state.rows[0].name,'검토 후 다시 저장');
   }finally{await close();}
  });
  await t.test('늦게 읽은 이미지가 다음 프로그램에 섞이지 않고 읽는 중 저장을 막음',async()=>{
   const {f,page,close}=await loggedIn();
   try{
    await page.evaluate(()=>{
     window.readers=[];window.FileReader=class{readAsDataURL(){window.readers.push(this);}abort(){}};
    });
    await newForm(page,'첫 번째');
    await page.locator('#thumbnail-file').setInputFiles({name:'sample.png',mimeType:'image/png',buffer:Buffer.from([137,80,78,71,13,10,26,10])});
    assert.equal(await page.locator('#save-app').isDisabled(),true);
    await page.locator('#cancel-editor').click();await newForm(page,'다음 프로그램');
    await page.evaluate(()=>{const r=window.readers[0];r.result='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=';r.onload?.();});
    assert.equal(await page.locator('#image-preview img').count(),0);
    await page.locator('#save-app').click();await page.waitForFunction(()=>!document.querySelector('#editor').open);assert.equal(f.state.uploads.length,0);assert.equal(f.state.rows[0].name,'다음 프로그램');
   }finally{await close();}
  });
  await t.test('관리자 초기 연결 실패 후 로그인 정보를 잃지 않고 재시도',async()=>{
   const {f,page,close}=await loggedIn({open:false});
   try{f.state.apiDown=true;await page.goto(f.base+'/admin');await page.locator('#retry-admin').waitFor();const exchanges=f.state.exchanges;f.state.apiDown=false;await page.locator('#retry-admin').click();await page.locator('#add-app').waitFor();assert.equal(f.state.exchanges,exchanges);}finally{await close();}
  });
  await t.test('이전에 로그인했어도 계정이 거부되면 로그인 버튼으로 복구',async()=>{
   const {f,page,close}=await loggedIn({open:false});
   try{f.state.userOverride='another-user';await page.goto(f.base+'/admin');await page.locator('.oauth-button').waitFor();assert.equal(await page.locator('#add-app').count(),0);assert.match(await page.locator('#admin-main .form-error').textContent(),/허용되지/);}finally{await close();}
  });
  await t.test('손상된 이미지 저장 차단·취소 후 정상 이미지 업로드',async()=>{
   const {f,page,close}=await loggedIn();
   try{
    await newForm(page);
    await page.locator('#thumbnail-file').setInputFiles({name:'broken.png',mimeType:'image/png',buffer:Buffer.from([137,80,78,71,13,10,26,10])});
    await page.waitForFunction(()=>document.querySelector('#editor-error').textContent.length>0);assert.equal(await page.locator('#save-app').isDisabled(),true);
    await page.locator('#reset-thumbnail').click();assert.equal(await page.locator('#save-app').isDisabled(),false);
    const image=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=10;c.height=10;const ctx=c.getContext('2d');ctx.fillStyle='#3564de';ctx.fillRect(0,0,10,10);return c.toDataURL('image/png');});
    await page.locator('#thumbnail-file').setInputFiles({name:'valid.png',mimeType:'image/png',buffer:Buffer.from(image.split(',')[1],'base64')});
    await page.waitForFunction(()=>!document.querySelector('#save-app').disabled);await page.locator('#image-preview img').waitFor();
    await page.locator('#save-app').click();await page.waitForFunction(()=>!document.querySelector('#editor').open);assert.equal(f.state.uploads.length,1);
   }finally{await close();}
  });
  await t.test('오래 대기하는 자동 캡처를 관리자에서 다시 요청 가능',async()=>{
   const {f,page,close}=await loggedIn();try{
    await newForm(page);await page.locator('#save-app').click();await page.waitForFunction(()=>!document.querySelector('#editor').open);
    const previous=f.state.rows[0].capture_requested_at;
    const button=page.locator('[data-action=capture]');assert.equal(await button.isEnabled(),true);
    await button.click();await page.waitForFunction(()=>!document.querySelector('[data-action=capture]').disabled);
    assert.notEqual(f.state.rows[0].capture_requested_at,previous);assert.equal(f.state.rows[0].capture_status,'pending');
   }finally{await close();}
  });
  await t.test('GitHub 장애 중 로그아웃은 쿠키 제거 후 로그인 화면으로 돌아옴',async()=>{
   const {f,page,close}=await loggedIn();
   try{
    f.state.apiDown=true;await page.locator('#logout').click();
    await page.waitForFunction(()=>document.querySelector('.oauth-button')||!document.querySelector('#toast').hidden);
    assert.equal(await page.locator('.oauth-button').count(),1);assert.equal(await page.locator('#add-app').count(),0);
    assert.equal((await page.context().request.get(f.base+'/api/session')).status(),200);
    assert.equal((await(await page.context().request.get(f.base+'/api/session')).json()).authenticated,false);
   }finally{await close();}
  });
 }finally{await browser.close();}
});
