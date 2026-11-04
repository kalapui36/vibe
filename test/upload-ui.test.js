import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import express from 'express';
import {mkdir} from 'node:fs/promises';
import {oauthFixture} from './helpers/oauth-fixture.js';
const html='<!doctype html><html lang="ko"><meta charset="utf-8"><title>올린 앱</title><h1>HTML 활동</h1><button id="counter">0</button><script>window.uploadCodeExecuted=true;counter.onclick=()=>{counter.textContent=Number(counter.textContent)+1;localStorage.setItem("count",counter.textContent);};</script></html>';
test('HTML·썸네일 파일 선택과 드래그 앤 드롭',async t=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});await mkdir('test-results/uploads',{recursive:true});
 async function fixture({mobile=false,login=true}={}){
  const f=await oauthFixture(),context=await browser.newContext({viewport:{width:mobile?390:1280,height:mobile?844:900},isMobile:mobile,hasTouch:mobile});
  if(login){const {cookie}=await f.login();const [name,...value]=cookie.split('=');await context.addCookies([{name,value:value.join('='),url:f.base,httpOnly:true,sameSite:'Lax'}]);}
  await context.route('https://kalapui.com/**',route=>{
   const path=new URL(route.request().url()).pathname.slice('/vibe/'.length),file=f.state.htmlFiles.get(path);
   return file?route.fulfill({contentType:'text/html; charset=utf-8',body:Buffer.from(file.content,'base64')}):route.fulfill({status:404,body:''});
  });
  const page=await context.newPage();await page.goto(f.base+'/admin');if(login)await page.locator('#add-app').waitFor();else await page.locator('.oauth-button').waitFor();
  return {f,page,context,close:async()=>{await context.close();await f.close();}};
 }
 async function drop(page,selector,files){
  const transfer=await page.evaluateHandle(files=>{const dt=new DataTransfer();for(const file of files)dt.items.add(new File([file.text??new Uint8Array(file.bytes||[])],file.name,{type:file.type||''}));return dt;},files);
  try{await page.dispatchEvent(selector,'drop',{dataTransfer:transfer});}finally{await transfer.dispose();}
 }
 async function openHtml(page){await page.locator('#add-app').click();await page.getByText('HTML 업로드',{exact:true}).click();}
 async function htmlReady(page){await page.waitForFunction(()=>document.querySelector('#html-status').textContent.includes('저장하면 반영됩니다.'));}
 try{
  await t.test('로그인 제목과 버튼만 표시하고 계정·기기·권한 안내 문구 제거',async()=>{
   const {page,close}=await fixture({login:false});try{
    assert.equal(await page.locator('.login-panel h1').textContent(),'관리자 로그인');
    assert.equal(await page.title(),'관리자 · Vibe Connect');
    const text=await page.locator('.login-panel').textContent();assert.equal(text.includes('kalapui36'),false);assert.equal(text.includes('다른 기기'),false);assert.equal(text.includes('권한 승인'),false);
    assert.equal(await page.getByRole('heading',{name:'GitHub로 로그인'}).count(),0);
    await page.screenshot({path:'test-results/uploads/login.png'});
   }finally{await close();}
  });
  await t.test('HTML·썸네일을 드롭하고 등록, 공개 카드에서 스크립트가 동작하는 앱 실행',async()=>{
   const {f,page,context,close}=await fixture();let server;
   try{
    await openHtml(page);await drop(page,'#html-dropzone',[{name:'학급활동.html',type:'text/html',text:html}]);await htmlReady(page);
    await page.locator('.category-options label').filter({hasText:'기타'}).click();
    assert.equal(await page.locator('[name=name]').inputValue(),'학급활동');assert.equal(await page.locator('[name=url]').isDisabled(),true);assert.equal(await page.evaluate(()=>window.uploadCodeExecuted),undefined);
    await page.screenshot({path:'test-results/uploads/html-drop.png'});
    const image=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=12;c.height=12;const ctx=c.getContext('2d');ctx.fillStyle='#3564de';ctx.fillRect(0,0,12,12);return c.toDataURL('image/png');});
    await drop(page,'#image-dropzone',[{name:'대표.png',bytes:[...Buffer.from(image.split(',')[1],'base64')]}]);await page.locator('#image-preview img').waitFor();await page.waitForFunction(()=>!document.querySelector('#save-app').disabled);
    await page.locator('#save-app').click();await page.waitForFunction(()=>!document.querySelector('#editor').open);
    assert.equal(f.state.rows.length,1);assert.equal(f.state.rows[0].category,'other');assert.equal(f.state.htmlFiles.size,1);assert.equal(f.state.uploads.length,1);
    const site=express();site.get('/vibe/content/apps.json',(req,res)=>res.json(f.state.rows));site.use('/vibe',express.static(process.cwd()));server=await new Promise(resolve=>{const s=site.listen(0,'127.0.0.1',()=>resolve(s));});
    await page.goto(`http://127.0.0.1:${server.address().port}/vibe/`);await page.locator('.app-card').waitFor();
    assert.equal(await page.locator('.category-label.other').textContent(),'기타');
    const ready=page.waitForEvent('popup');await page.locator('.card-title-row').click();const popup=await ready;await popup.getByRole('heading',{name:'HTML 활동'}).waitFor();await popup.locator('#counter').click();assert.equal(await popup.locator('#counter').textContent(),'1');assert.equal(await popup.evaluate(()=>localStorage.getItem('count')),'1');assert.equal((await popup.evaluate(()=>document.cookie)).includes('vibe_session'),false);await popup.close();
   }finally{await close();if(server)await new Promise(resolve=>server.close(resolve));}
  });
  await t.test('모바일 파일 선택으로 등록한 HTML을 다시 열어 교체·설명 수정',async()=>{
   const {f,page,close}=await fixture({mobile:true});try{
    await openHtml(page);await page.locator('#html-file').setInputFiles({name:'모바일.htm',mimeType:'text/html',buffer:Buffer.from(html)});await htmlReady(page);await page.locator('#save-app').click();await page.waitForFunction(()=>!document.querySelector('#editor').open);
    const previous=f.state.rows[0].url;await page.locator('[data-action=edit]').click();assert.equal(await page.locator('[name=source_type][value=html]').isChecked(),true);assert.match(await page.locator('#html-status').textContent(),/모바일.htm/);
    await page.locator('[name=description]').fill('설명만 수정');await page.locator('#save-app').click();await page.waitForFunction(()=>!document.querySelector('#editor').open);assert.equal(f.state.rows[0].url,previous);assert.equal(f.state.htmlFiles.size,1);
    await page.locator('[data-action=edit]').click();await page.locator('#html-file').setInputFiles({name:'교체.html',mimeType:'text/html',buffer:Buffer.from(html+'<p>교체됨</p>')});await htmlReady(page);await page.locator('#save-app').click();await page.waitForFunction(()=>!document.querySelector('#editor').open);assert.notEqual(f.state.rows[0].url,previous);assert.equal(f.state.htmlFiles.size,2);
   }finally{await close();}
  });
  await t.test('형식·용량·여러 파일 오류는 해당 영역에 표시, 정상 파일·주소 모드로 복구',async()=>{
   const {f,page,close}=await fixture();try{
    await openHtml(page);await drop(page,'#html-dropzone',[{name:'bad.exe',text:html}]);await page.locator('#html-error:not([hidden])').waitFor();assert.equal(await page.locator('#save-app').isDisabled(),true);
    await page.locator('#html-file').setInputFiles({name:'large.html',mimeType:'text/html',buffer:Buffer.alloc(2*1024*1024+1)});assert.match(await page.locator('#html-error').textContent(),/2MB/);
    await drop(page,'#html-dropzone',[{name:'a.html',text:html},{name:'b.html',text:html}]);assert.match(await page.locator('#html-error').textContent(),/1개/);
    await drop(page,'#html-dropzone',[{name:'정상.html',text:html}]);await htmlReady(page);assert.equal(await page.locator('#html-error').isVisible(),false);assert.equal(await page.locator('#save-app').isEnabled(),true);
    await drop(page,'#image-dropzone',[{name:'bad.html',type:'text/html',text:html}]);assert.equal(await page.locator('#save-app').isDisabled(),true);await page.locator('#image-error:not([hidden])').waitFor();await page.locator('#reset-thumbnail').click();
    await page.getByText('주소 연결',{exact:true}).click();await page.locator('[name=url]').fill('https://example.org/');await page.locator('#save-app').click();await page.waitForFunction(()=>!document.querySelector('#editor').open);assert.equal(f.state.htmlFiles.size,0);assert.equal(f.state.rows[0].url,'https://example.org/');
   }finally{await close();}
  });
  await t.test('늦게 읽힌 HTML이 다음 편집창으로 넘어가지 않고 읽는 중 저장 차단',async()=>{
   const {f,page,close}=await fixture();try{
    await page.evaluate(()=>{window.resolveHtml=null;File.prototype.arrayBuffer=function(){return new Promise(resolve=>window.resolveHtml=resolve);};});
    await openHtml(page);await drop(page,'#html-dropzone',[{name:'느린파일.html',text:html}]);assert.equal(await page.locator('#save-app').isDisabled(),true);
    page.once('dialog',dialog=>dialog.accept());await page.locator('#cancel-editor').click();await page.locator('#add-app').click();await page.locator('[name=name]').fill('다음 앱');await page.locator('[name=url]').fill('https://example.org/');
    await page.evaluate(text=>window.resolveHtml(new TextEncoder().encode(text).buffer),html);assert.equal(await page.locator('[name=name]').inputValue(),'다음 앱');await page.locator('#save-app').click();await page.waitForFunction(()=>!document.querySelector('#editor').open);assert.equal(f.state.htmlFiles.size,0);assert.equal(f.state.rows[0].name,'다음 앱');
   }finally{await close();}
  });
  await t.test('HTML 등록 응답이 끊겨도 입력을 유지하고 재시도 시 중복 없이 복구',async()=>{
   const {f,page,close}=await fixture();let damaged=false;
   try{
    await page.route(f.base+'/api/admin/apps',async route=>{if(route.request().method()==='POST'&&!damaged){damaged=true;const response=await route.fetch();const headers={...response.headers()};delete headers['content-length'];return route.fulfill({status:response.status(),headers,body:'{'});}return route.continue();});
    await openHtml(page);await drop(page,'#html-dropzone',[{name:'재시도.html',text:html}]);await htmlReady(page);await page.locator('#save-app').click();await page.waitForFunction(()=>document.querySelector('#editor-error').textContent.length>0);assert.equal(f.state.rows.length,1);
    await page.locator('#save-app').click();await page.waitForFunction(()=>!document.querySelector('#editor').open);assert.equal(f.state.rows.length,1);assert.equal(f.state.htmlFiles.size,1);
   }finally{await close();}
  });
 }finally{await browser.close();}
});
