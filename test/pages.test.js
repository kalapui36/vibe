import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { chromium } from 'playwright-core';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

// Emulate GitHub Pages: files only, mounted below a repository path; no API.
test('GitHub Pages /vibe/ 경로에서 화면·목록·필터·관리자 안내가 동작한다', async () => {
  assert.equal(spawnSync(process.execPath, ['scripts/build-pages.js']).status, 0);
  const original = await readFile('content/apps.json', 'utf8');
  assert.ok(Array.isArray(JSON.parse(original)));
  const app = express();
  app.use('/vibe', express.static(process.cwd(), { dotfiles: 'deny' }));
  const server = await new Promise(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
  let browser;
  try {
    browser = await chromium.launch({ executablePath:'/usr/bin/chromium', args:['--no-sandbox','--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport:{ width:1280, height:900 } });
    const errors=[], responses=[];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) responses.push(`${response.status()} ${response.url()}`); });
    const url=`http://127.0.0.1:${server.address().port}/vibe/`;
    await page.route('**/content/apps.json', route => route.fulfill({json:[]}));
    await page.goto(url);
    await page.getByText('아직 등록된 웹앱이 없습니다.').waitFor();
    assert.equal(await page.title(), '3색 바이브코딩');
    assert.match(await page.locator('link[rel=stylesheet]').getAttribute('href'), /^\.\/public\//);
    await page.locator('.admin-link').click();
    assert.equal(page.url(),url+'admin/');
    await page.locator('[name=token]').waitFor();
    assert.equal(await page.locator('[name=password]').count(),0);
    await page.getByRole('link',{name:'← 공개 페이지로 돌아가기'}).click();
    await page.route('**/content/apps.json', route => route.fulfill({json:[
      {id:'fixture-1',name:'수업 도구',description:'학습 자료',category:'class',url:'https://example.com/',visible:true,position:1,primary_label:'학생용',links:[{label:'교사용 설정',url:'https://example.com/teacher'}]},
      {id:'fixture-2',name:'업무 도구',description:'일정',category:'work',url:'https://example.org/',visible:true,position:0},
      {id:'fixture-3',name:'숨김',category:'mind',url:'https://example.net/',visible:false},
      {id:'fixture-4',name:'잘못된 주소',category:'class',url:'javascript:alert(1)',visible:true}
    ]}));
    await page.reload();
    await page.locator('.app-card').first().waitFor();
    assert.equal(await page.locator('.app-card').count(),2);
    assert.equal(await page.locator('.app-card').first().getAttribute('href'),'https://example.org/');
    await page.locator('[data-category=class]').click();
    assert.equal(await page.locator('.app-card').count(),1);
    assert.equal(await page.locator('.app-card').getAttribute('href'),'https://example.com/');
    assert.equal(await page.locator('.app-grid').getAttribute('data-layout'),'single');
    assert.equal(await page.locator('.app-item').evaluate(el=>getComputedStyle(el).display),'grid');
    assert.equal(await page.locator('.app-card a').count(),0);
    assert.equal(await page.locator('.related-link').getAttribute('href'),'https://example.com/teacher');
    await page.context().route('https://example.com/**',route=>route.fulfill({contentType:'text/html',body:'<title>fixture</title>'}));
    let popupReady=page.waitForEvent('popup');
    await page.locator('.related-link').click();
    let popup=await popupReady;await popup.waitForURL('https://example.com/teacher');await popup.close();
    popupReady=page.waitForEvent('popup');await page.locator('.card-description').click();
    popup=await popupReady;await popup.waitForURL('https://example.com/');await popup.close();
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.locator('[data-category=work]').click();
    assert.equal(await page.locator('#results').evaluate(el=>el.getAnimations().length),0);
    await page.locator('[data-category=class]').focus();await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('.tab.active').getAttribute('data-category'),'mind');
    await page.locator('[data-category=class]').click();
    await page.locator('#search').fill('없는 검색어');
    await page.getByText('검색 결과가 없습니다.').waitFor();
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.locator('#reset-filters').click();await page.locator('[data-category=class]').click();
    assert.equal(await page.locator('.app-item').evaluate(el=>getComputedStyle(el).display),'flex');
    assert.deepEqual(errors,[]);
    assert.deepEqual(responses,[]);
  } finally { await browser?.close(); await new Promise(resolve=>server.close(resolve)); }
});
