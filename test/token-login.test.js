import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { chromium } from 'playwright-core';

test('전환 전 토큰 관리자도 계정 차단·등록·응답 유실 복구·로그아웃 동작',async()=>{
 const app=express();app.use('/vibe',express.static(process.cwd()));const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  const page=await browser.newPage(),base=`http://127.0.0.1:${server.address().port}/vibe/`;
  let actor='someone-else',rows=[],sha='sha-0',damage=false;const files=new Map();
  await page.route(base+'content/config.json',r=>r.fulfill({json:{owner:'kalapui36',repo:'vibe',branch:'main'}}));
  await page.route('https://api.github.com/**',route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.pathname==='/user')return route.fulfill({json:{login:actor,id:1}});
   if(url.pathname==='/repos/kalapui36/vibe')return route.fulfill({json:{permissions:{push:true}}});
   if(url.pathname.startsWith('/repos/kalapui36/vibe/contents/content/webapps/')){
    const existing=files.get(url.pathname);
    if(request.method()==='GET')return existing?route.fulfill({json:{sha:'html-sha',encoding:'base64',content:existing}}):route.fulfill({status:404,json:{message:'Not Found'}});
    assert.equal(existing,undefined);files.set(url.pathname,request.postDataJSON().content);return route.fulfill({json:{content:{sha:'html-sha'}}});
   }
   assert.equal(url.pathname,'/repos/kalapui36/vibe/contents/content/apps.json');
   if(request.method()==='GET')return route.fulfill({json:{sha,content:Buffer.from(JSON.stringify(rows)).toString('base64')}});
   const payload=request.postDataJSON();if(payload.sha!==sha)return route.fulfill({status:409,json:{message:'conflict'}});
   rows=JSON.parse(Buffer.from(payload.content,'base64').toString('utf8'));sha='sha-'+Date.now();
   if(damage){damage=false;return route.fulfill({status:200,contentType:'application/json',body:'{'});}
   return route.fulfill({json:{content:{sha}}});
  });
  await page.goto(base+'manage.html');await page.locator('[name=token]').fill('not-a-real-token');await page.locator('#login-form button').click();await page.getByText('이 계정은 관리자 접근이 허용되지 않습니다.').waitFor();assert.equal(rows.length,0);
  actor='kalapui36';await page.locator('[name=token]').fill('not-a-real-token');await page.locator('#login-form button').click();await page.locator('#add-app').waitFor();
  await page.locator('#add-app').click();await page.locator('[name=name]').fill('토큰 방식 확인');await page.locator('[name=url]').fill('https://example.com/');damage=true;
  await page.locator('#save-app').click();await page.waitForFunction(()=>document.querySelector('#editor-error').textContent.length>0);assert.equal(rows.length,1);
  await page.locator('#save-app').click();await page.locator('#reload-editor:not([hidden])').waitFor();await page.locator('#reload-editor').click();
  await page.waitForFunction(()=>document.querySelector('#editor-title').textContent==='웹앱 수정');await page.locator('#save-app').click();await page.waitForFunction(()=>!document.querySelector('#editor').open);assert.equal(rows.length,1);
  await page.locator('#add-app').click();await page.getByText('HTML 업로드',{exact:true}).click();
  await page.locator('#html-file').setInputFiles({name:'파일등록.html',mimeType:'text/html',buffer:Buffer.from('<!doctype html><h1>한글 HTML</h1>')});
  await page.waitForFunction(()=>document.querySelector('#html-status').textContent.includes('저장하면 반영됩니다.'));await page.locator('#save-app').click();await page.waitForFunction(()=>!document.querySelector('#editor').open);assert.equal(rows.length,2);assert.equal(files.size,1);assert.equal(rows[1].html_filename,'파일등록.html');
  await page.locator('#logout').click();await page.locator('[name=token]').waitFor();assert.equal(await page.locator('#add-app').count(),0);
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
