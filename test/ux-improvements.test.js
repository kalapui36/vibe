import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import { oauthFixture } from './helpers/oauth-fixture.js';

const rows=[
 {id:'tree',name:'나무 길 보드게임',description:'학급 활동',category:'mind',url:'https://example.org/tree',visible:true,position:0},
 {id:'class',name:'지구촌 문제 자료 탐색',description:'수업 자료',category:'class',url:'https://example.org/class',visible:true,position:1},
 {id:'work',name:'업무 안내',description:'업무 자료',category:'work',url:'https://example.org/work',visible:true,position:2}
];
test('검색·탐색·편집 UX 시뮬레이션',async t=>{
 const server=await new Promise(resolve=>{const app=express();app.use('/vibe',express.static(process.cwd()));const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const base=`http://127.0.0.1:${server.address().port}/vibe/`;
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
 await mkdir('test-results/ux',{recursive:true});
 async function visitor(data=rows,mobile=false){
  const context=await browser.newContext({viewport:{width:mobile?390:1280,height:mobile?844:900},hasTouch:mobile,isMobile:mobile});
  const page=await context.newPage();await page.route(base+'content/apps.json',route=>route.fulfill({json:data}));
  await page.goto(base);await page.locator('.app-card').first().waitFor();return {page,close:()=>context.close()};
 }
 async function admin(mobile=false){
  const f=await oauthFixture();const {cookie}=await f.login();const [name,...parts]=cookie.split('=');
  const context=await browser.newContext({viewport:{width:mobile?390:1280,height:mobile?844:900},isMobile:mobile,hasTouch:mobile});
  await context.addCookies([{name,value:parts.join('='),url:f.base,httpOnly:true,sameSite:'Lax'}]);
  await context.route('https://kalapui.com/**',route=>route.fulfill({status:404,body:''}));
  const page=await context.newPage();await page.goto(f.base+'/admin');await page.locator('#add-app').click();
  return {f,page,close:async()=>{await context.close();await f.close();}};
 }
 try{
  await t.test('한 글자·띄어쓰기 없는 검색과 키보드 추천 선택, 새 창을 열지 않음',async()=>{
   const {page,close}=await visitor();try{
    let popups=0;page.on('popup',()=>popups++);
    await page.locator('.tab[data-category=class]').click();await page.locator('#search').fill('나');
    assert.equal(await page.getByRole('option').count(),1);
    assert.match(await page.getByRole('option').textContent(),/나무 길 보드게임.*사회정서교육/);
    assert.equal(await page.locator('.suggestion-name mark').textContent(),'나');
    await page.locator('#search').press('ArrowDown');assert.equal(await page.locator('#search').getAttribute('aria-activedescendant'),'suggestion-0');
    await page.locator('#search').press('Enter');assert.equal(await page.locator('.app-card').count(),1);
    assert.match(await page.locator('.app-card').textContent(),/나무 길/);assert.equal(popups,0);
    assert.equal(await page.locator('#search').getAttribute('aria-expanded'),'false');
    await page.locator('#search').fill('나무길');assert.equal(await page.getByRole('option').count(),1);assert.equal(await page.locator('.app-card').count(),1);
    await page.locator('#search').press('Escape');assert.equal(await page.getByRole('option').count(),0);assert.equal(await page.locator('#search').inputValue(),'나무길');
    await page.locator('#search').press('ArrowUp');assert.equal(await page.locator('#search').getAttribute('aria-activedescendant'),'suggestion-0');
    await page.screenshot({animations:'disabled',path:'test-results/ux/search-desktop.png'});
   }finally{await close();}
  });
  await t.test('추천의 HTML은 텍스트로만 표시·숨김 항목 제외·한글 조합 중 Enter 보호',async()=>{
   const {page,close}=await visitor([...rows,{...rows[0],id:'hidden',name:'나무 비공개',visible:false},{...rows[0],id:'xss',name:'나무 <img src=x onerror="window.injected=1">'}]);
   try{
    await page.locator('#search').fill('나');assert.equal(await page.getByRole('option').count(),2);assert.equal(await page.locator('#search-suggestions img').count(),0);assert.equal(await page.evaluate(()=>window.injected),undefined);
    await page.locator('#search').dispatchEvent('compositionstart');await page.locator('#search').fill('나무길');await page.locator('#search').press('Enter');assert.equal(await page.getByRole('option').count(),0);
    await page.locator('#search').dispatchEvent('compositionend');assert.equal(await page.getByRole('option').count(),1);
   }finally{await close();}
  });
  await t.test('검색·분류·추천 선택은 새로고침과 뒤로/앞으로 가기에서 복원',async()=>{
   const {page,close}=await visitor();try{
    await page.locator('.tab[data-category=mind]').click();await page.locator('#search').fill('나');await page.getByRole('option').click();
    const selected=page.url();assert.equal(new URL(selected).searchParams.get('app'),'tree');
    await page.reload();await page.locator('.app-card').waitFor();assert.equal(await page.locator('#search').inputValue(),rows[0].name);assert.equal(await page.locator('.tab.active').getAttribute('data-category'),'mind');
    await page.goBack();await page.waitForFunction(()=>document.querySelector('#search').value==='나');
    await page.goBack();await page.waitForFunction(()=>document.querySelector('#search').value==='');assert.equal(await page.locator('.tab.active').getAttribute('data-category'),'mind');
    await page.goForward();await page.waitForFunction(()=>document.querySelector('#search').value==='나');
    await page.goForward();await page.waitForFunction(()=>new URL(location).searchParams.get('app')==='tree');assert.equal(page.url(),selected);
   }finally{await close();}
  });
  await t.test('모바일 스크롤 중 검색·분류 고정, 위치 복원과 터치 추천 선택',async()=>{
   const many=Array.from({length:15},(_,i)=>({...rows[i%3],id:`app-${i}`,position:i}));
   const {page,close}=await visitor(many,true);try{
    await page.evaluate(()=>scrollTo(0,650));await page.waitForFunction(()=>history.state?.vibeScroll>600);
    const controls=await page.locator('.browse-controls').boundingBox();assert.ok(controls.y>=-1&&controls.y<2);assert.ok(controls.y+controls.height<160);
    await page.reload();await page.waitForFunction(()=>scrollY>600);assert.ok(Math.abs(await page.evaluate(()=>scrollY)-650)<3);
    await page.locator('#search').fill('な');assert.equal(await page.getByRole('option').count(),0);
    await page.locator('#search').fill('나');await page.getByRole('option').first().tap();assert.equal(await page.locator('.app-card').count(),1);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({animations:'disabled',path:'test-results/ux/mobile-results.png'});
   }finally{await close();}
  });
  await t.test('잘못된 입력은 해당 칸에 오류 표시·첫 오류로 이동·수정하면 해제',async()=>{
   const {page,f,close}=await admin();try{
    await page.locator('#save-app').click();assert.equal(await page.locator('[name=name]').getAttribute('aria-invalid'),'true');assert.equal(await page.locator('[name=url]').getAttribute('aria-invalid'),'true');assert.equal(await page.locator('[name=name]').evaluate(el=>document.activeElement===el),true);assert.equal(f.state.rows.length,0);
    await page.locator('[name=name]').fill('테스트');assert.equal(await page.locator('[name=name]').getAttribute('aria-invalid'),null);
    await page.locator('[name=url]').fill('javascript:alert(1)');await page.locator('#save-app').click();assert.equal(f.state.rows.length,0);assert.match(await page.locator('[name=url] + .inline-error').textContent(),/https/);
    await page.locator('[name=url]').fill('https://example.org/');await page.locator('#add-link').click();await page.locator('#save-app').click();assert.equal(await page.locator('.link-label').getAttribute('aria-invalid'),'true');assert.equal(await page.locator('.link-label').evaluate(el=>document.activeElement===el),true);
    await page.locator('.link-label').fill('교사용');await page.locator('.link-url').fill('https://example.org/teacher');await page.locator('#save-app').click();await page.waitForFunction(()=>!document.querySelector('#editor').open);assert.equal(f.state.rows.length,1);assert.equal(f.state.rows[0].links.length,1);
   }finally{await close();}
  });
  await t.test('미저장 입력은 취소·Esc·다른 페이지 이동에서 확인하고 유지 가능',async()=>{
   const {page,f,close}=await admin();try{
    await page.locator('[name=name]').fill('아직 저장하지 않음');
    for(const action of [()=>page.locator('#cancel-editor').click(),()=>page.keyboard.press('Escape'),()=>page.locator('#close-editor').click()]){
     page.once('dialog',dialog=>{assert.equal(dialog.type(),'confirm');dialog.dismiss();});await action();assert.equal(await page.locator('#editor').evaluate(el=>el.open),true);assert.equal(await page.locator('[name=name]').inputValue(),'아직 저장하지 않음');
    }
    page.once('dialog',dialog=>{assert.equal(dialog.type(),'beforeunload');dialog.dismiss();});await page.goto(f.base+'/setup').catch(error=>assert.match(error.message,/ERR_ABORTED|interrupted/));assert.equal(await page.locator('#editor').evaluate(el=>el.open),true);
    page.once('dialog',dialog=>dialog.accept());await page.locator('#cancel-editor').click();assert.equal(await page.locator('#editor').evaluate(el=>el.open),false);
    await page.locator('#add-app').click();await page.locator('#cancel-editor').click();assert.equal(await page.locator('#editor').evaluate(el=>el.open),false,'Unchanged form closes without a prompt');
   }finally{await close();}
  });
  await t.test('모바일 편집창은 하단에 붙고 내용 스크롤 중에도 닫기·저장 유지',async()=>{
   const {page,close}=await admin(true);try{
    await page.locator('[name=name]').fill('모바일 등록');await page.locator('[name=url]').fill('https://example.org/');await page.locator('#add-link').click();
    await page.locator('.editor-content').evaluate(el=>el.scrollTop=el.scrollHeight);
    const dialog=await page.locator('#editor').boundingBox(),save=await page.locator('#save-app').boundingBox(),closeButton=await page.locator('#close-editor').boundingBox();
    assert.ok(Math.abs(dialog.y+dialog.height-844)<2);assert.ok(save.y>=dialog.y&&save.y+save.height<=844);assert.ok(closeButton.y>=dialog.y&&closeButton.y+closeButton.height<844);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({animations:'disabled',path:'test-results/ux/admin-mobile.png'});
    await page.setViewportSize({width:390,height:460});
    await page.waitForFunction(()=>parseFloat(document.querySelector('#editor').style.getPropertyValue('--editor-viewport-height'))<=460);
    const footer=await page.locator('.dialog-actions').first().boundingBox();assert.ok(footer.y+footer.height<=461,'Footer fits a shortened viewport');
    page.once('dialog',dialog=>dialog.accept());await page.locator('#close-editor').click();
   }finally{await close();}
  });
  await t.test('저장 지연 중 버튼에 진행 표시·중복 요청 차단·성공 후 미저장 경고 해제',async()=>{
   const {page,f,close}=await admin();let pending;
   try{
    await page.route(f.base+'/api/admin/apps',route=>route.request().method()==='POST'?(pending=route):route.continue());
    await page.locator('[name=name]').fill('저장 대기');await page.locator('[name=url]').fill('https://example.org/');await page.locator('#save-app').click();
    assert.equal(await page.locator('#save-app').textContent(),'저장 중…');assert.equal(await page.locator('#save-app').isDisabled(),true);await page.keyboard.press('Escape');assert.equal(await page.locator('#editor').evaluate(el=>el.open),true);
    await pending.continue();await page.waitForFunction(()=>!document.querySelector('#editor').open);assert.equal(f.state.rows.length,1);await page.goto(f.base+'/setup');
   }finally{await close();}
  });
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
