import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { chromium } from 'playwright-core';
const sample=[
 {id:'class',name:'지구촌 문제 자료 탐색',description:'자료를 탐색합니다.',url:'https://example.com/student',category:'class',visible:true,position:0,primary_label:'학생용',links:[{label:'교사용 설정',url:'https://example.com/teacher'}]},
 {id:'mind',name:'나무 길 보드게임',description:'모둠 활동',url:'https://example.org/game',category:'mind',visible:true,position:1},
 {id:'work',name:'업무포털 활용 안내',description:'업무 안내',url:'https://example.net/work',category:'work',visible:true,position:2}
];
test('방문자 이용 상황 시뮬레이션',async t=>{
 const app=express();app.use('/vibe',express.static(process.cwd()));const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
 const base=`http://127.0.0.1:${server.address().port}/vibe/`;
 async function pageWith(rows=sample,{width=1280,response}={}){
  const page=await browser.newPage({viewport:{width,height:900}});
  await page.context().route('https://example.com/**',route=>route.fulfill({contentType:'text/html',body:'<h1>연결된 프로그램</h1>'}));
  await page.route(base+'content/apps.json',response||((route)=>route.fulfill({json:rows})));
  await page.goto(base,{waitUntil:'domcontentloaded'});return page;
 }
 try{
  await t.test('처음 방문·정렬·세 분야와 전체 복귀',async()=>{
   const page=await pageWith();try{
    await page.locator('.app-card').first().waitFor();assert.equal(await page.locator('.app-card').count(),3);
    assert.equal(await page.locator('.app-card').first().getAttribute('href'),sample[0].url);
    for(const category of ['class','mind','work']){await page.locator(`[data-category=${category}].tab`).click();assert.equal(await page.locator('.app-card').count(),1);assert.equal(await page.locator('.app-grid').getAttribute('data-layout'),'single');}
    await page.locator('.tab[data-category=all]').click();assert.equal(await page.locator('.app-card').count(),3);
   }finally{await page.close();}
  });
  await t.test('검색·검색 결과 없음·필터 초기화',async()=>{
   const page=await pageWith();try{await page.locator('.app-card').first().waitFor();await page.locator('#search').fill('지구촌');assert.equal(await page.locator('.app-card').count(),1);await page.locator('#search').fill('없는 프로그램');await page.getByText('검색 결과가 없습니다.').waitFor();await page.locator('#reset-filters').click();assert.equal(await page.locator('.app-card').count(),3);}finally{await page.close();}
  });
  await t.test('전체 보기는 탭과 같은 수업·사회정서·업무·기타 열과 분류 안의 순서를 유지',async()=>{
   const data=[{...sample[2],position:0},{...sample[0],position:1},{...sample[1],position:2},{...sample[0],id:'class-2',name:'두 번째 수업',position:3}];
   const page=await pageWith(data);try{
    await page.locator('.app-card').first().waitFor();const order=await page.locator('.board-column').evaluateAll(columns=>columns.map(column=>column.dataset.column));assert.deepEqual(order,['class','mind','work','other']);assert.deepEqual(order,await page.locator('.tab:not([data-category=all])').evaluateAll(tabs=>tabs.map(tab=>tab.dataset.category)));
    assert.deepEqual(await page.locator('[data-column=class] .card-title-row h3').allTextContents(),[sample[0].name,'두 번째 수업']);assert.equal(await page.locator('[data-column=work] .app-card').count(),1);assert.equal(await page.locator('[data-column=mind] .app-card').count(),1);assert.equal(await page.locator('[data-column=other] .board-empty').count(),1);
    const positions=await page.locator('.board-column').evaluateAll(columns=>columns.map(column=>({x:column.getBoundingClientRect().x,y:column.getBoundingClientRect().y})));
    assert.ok(positions.every((p,i)=>!i||p.x>positions[i-1].x));assert.ok(positions.every(p=>Math.abs(p.y-positions[0].y)<1));
    const cards=page.locator('[data-column=class] .app-item'),first=await cards.nth(0).boundingBox(),next=await cards.nth(1).boundingBox();assert.equal(first.x,next.x);assert.ok(next.y>=first.y+first.height);
    await page.locator('.tab[data-category=work]').click();assert.equal(await page.locator('.category-board').count(),0);assert.equal(await page.locator('.app-grid').getAttribute('data-layout'),'single');
    await page.locator('.tab[data-category=all]').click();assert.equal(await page.locator('.board-column').count(),4);assert.equal(await page.locator('.app-card').count(),4);
   }finally{await page.close();}
  });
  await t.test('전체 검색 결과도 분류별 열에서 표시하고 빈 분류는 명확하게 안내',async()=>{
   const page=await pageWith();try{
    await page.locator('.app-card').first().waitFor();await page.locator('#search').fill('지구촌');assert.equal(await page.locator('.board-column').count(),4);assert.equal(await page.locator('[data-column=class] .board-count').textContent(),'1');assert.equal(await page.locator('[data-column=work] .board-count').textContent(),'0');assert.equal(await page.locator('[data-column=work] .board-empty').textContent(),'일치하는 웹앱이 없습니다.');
    await page.locator('#search').fill('없는 프로그램');await page.getByText('검색 결과가 없습니다.').waitFor();await page.locator('#reset-filters').click();assert.equal(await page.locator('.board-column').count(),4);assert.equal(await page.locator('.app-card').count(),3);
   }finally{await page.close();}
  });
  await t.test('모바일 열을 옆으로 넘기고 위치 복원·검색 추천 선택 시 해당 열 표시',async()=>{
   const page=await pageWith(Array.from({length:9},(_,i)=>({...sample[i%3],id:`app-${i}`,position:i})),{width:390});try{
    await page.locator('.app-card').first().waitFor();const board=page.locator('.category-board');await board.hover({position:{x:100,y:20}});await page.mouse.wheel(640,0);await page.waitForFunction(()=>history.state?.vibeBoardScroll>400);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.reload();await page.waitForFunction(()=>document.querySelector('.category-board')?.scrollLeft>400);
    await page.locator('#search').fill('업무');await page.locator('#search').press('ArrowDown');await page.locator('#search').press('Enter');assert.equal(await page.locator('.app-card').count(),1);assert.equal(await page.locator('[data-column=work] .app-card').count(),1);
    await page.waitForFunction(()=>Math.abs(document.querySelector('[data-column=work]').getBoundingClientRect().left-document.querySelector('.category-board').getBoundingClientRect().left)<3);
    await page.locator('#search').fill('');await page.locator('.tab[data-category=class]').click();await page.goBack();await page.waitForFunction(()=>document.querySelector('.category-board')?.scrollLeft>300);assert.equal(await page.locator('.app-card').count(),9);
   }finally{await page.close();}
  });
  await t.test('기타 탭·검색·주소 상태 복원과 작은 모바일 탐색',async()=>{
   const other={id:'other',name:'기타 도구',description:'다른 용도의 앱',url:'https://example.org/other',category:'other',visible:true,position:3};
   const page=await pageWith([...sample,other],{width:320});try{
    await page.locator('.app-card').first().waitFor();assert.equal(await page.locator('.app-card').count(),4);assert.equal(await page.locator('#count-other').textContent(),'1');
    await page.locator('.tab[data-category=other]').click();assert.equal(await page.locator('.app-card').count(),1);assert.equal(await page.locator('.category-label.other').textContent(),'기타');assert.equal(await page.locator('.thumbnail-fallback.other svg').count(),1);
    await page.locator('#search').fill('기타');assert.match(await page.getByRole('option').textContent(),/기타 도구.*기타/);await page.locator('#search').press('Escape');
    await page.reload();await page.locator('.app-card').waitFor();assert.equal(await page.locator('.tab.active').getAttribute('data-category'),'other');assert.equal(await page.locator('#search').inputValue(),'기타');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.locator('#search').fill('');await page.locator('.tab[data-category=mind]').click();assert.equal(await page.locator('.app-card').count(),1);assert.match(await page.locator('.app-card').textContent(),/나무 길/);
   }finally{await page.close();}
  });
  await t.test('숨김·위험한 주소·부분 손상 자료가 나머지 목록을 막지 않음',async()=>{
   const page=await pageWith([...sample,null,{},[],{...sample[0],visible:false},{...sample[0],url:'javascript:alert(1)'},{...sample[0],url:'https://user:password@example.com'},{...sample[0],category:'__proto__'}]);
   try{await page.waitForFunction(()=>document.querySelector('.app-card')||document.querySelector('#retry'));assert.equal(await page.locator('.app-card').count(),3);}finally{await page.close();}
  });
  await t.test('프로그램 이름·설명의 HTML이 실행되지 않음',async()=>{
   const page=await pageWith([{...sample[0],name:'<img src=x onerror="window.injected=1">',description:'<script>window.injected=1</script>'}]);
   try{await page.locator('.app-card').waitFor();assert.equal(await page.evaluate(()=>window.injected),undefined);assert.equal(await page.locator('.card-title-row img').count(),0);assert.match(await page.locator('.card-title-row').textContent(),/<img/);}finally{await page.close();}
  });
  await t.test('카드·교사용 링크는 서로 다른 주소를 새 탭으로 열기',async()=>{
   const page=await pageWith([sample[0]]);try{
    await page.locator('.app-card').waitFor();let next=page.waitForEvent('popup');await page.locator('.related-link').click();let popup=await next;await popup.waitForURL(sample[0].links[0].url);await popup.close();
    next=page.waitForEvent('popup');await page.locator('.card-description').click();popup=await next;await popup.waitForURL(sample[0].url);await popup.close();assert.equal(page.url(),base);
   }finally{await page.close();}
  });
  await t.test('연결 오류 후 분류를 눌러도 재시도 경로 유지',async()=>{
   let fails=true;const page=await pageWith(sample,{response:route=>fails?route.fulfill({status:503,json:{error:'offline'}}):route.fulfill({json:sample})});
   try{await page.locator('#retry').waitFor();await page.locator('.tab[data-category=class]').click();assert.equal(await page.locator('#retry').count(),1);fails=false;await page.locator('#retry').click();await page.locator('.app-card').waitFor();assert.equal(await page.locator('.app-card').count(),1);}finally{await page.close();}
  });
  await t.test('응답이 끝없이 지연되면 시간 제한 후 재시도 가능',async()=>{
   const page=await browser.newPage();let slow=true;
   try{
    await page.clock.install();
    await page.route(base+'content/apps.json',route=>slow?undefined:route.fulfill({json:sample}));
    await page.goto(base,{waitUntil:'domcontentloaded'});await page.locator('.skeleton-grid').waitFor();
    await page.clock.runFor(16000);await page.locator('#retry').waitFor();slow=false;await page.locator('#retry').click();await page.locator('.app-card').first().waitFor();assert.equal(await page.locator('.app-card').count(),3);
   }finally{await page.close();}
  });
  await t.test('응답 헤더 뒤 본문 전송이 멈춰도 시간 제한으로 복구',async()=>{
   const stream=express();let stalled=true;
   stream.get('/vibe/content/apps.json',(req,res)=>{if(stalled){res.type('json');res.write('[');}else res.json(sample);});
   stream.use('/vibe',express.static(process.cwd()));const host=await new Promise(resolve=>{const s=stream.listen(0,'127.0.0.1',()=>resolve(s));});
   const url=`http://127.0.0.1:${host.address().port}/vibe/`,page=await browser.newPage();
   try{
    await page.clock.install();const headersReady=page.waitForResponse(response=>response.url()===url+'content/apps.json');
    await page.goto(url,{waitUntil:'domcontentloaded'});await headersReady;await page.clock.runFor(16000);await page.locator('#retry').waitFor();
    stalled=false;await page.locator('#retry').click();await page.locator('.app-card').first().waitFor();assert.equal(await page.locator('.app-card').count(),3);
   }finally{await page.close();host.closeAllConnections();await new Promise(resolve=>host.close(resolve));}
  });
  await t.test('느린 연결 중 분류 변경이 빈 목록으로 오인되지 않음',async()=>{
   let pending;const page=await pageWith(sample,{response:route=>{pending=route;}});
   try{await page.locator('.category-board').waitFor();assert.equal(await page.locator('.board-column').count(),4);assert.equal(await page.locator('.skeleton-card').count(),4);await page.locator('.tab[data-category=class]').click();assert.equal(await page.getByRole('heading',{name:'웹앱을 불러오는 중입니다.'}).count(),1);await pending.fulfill({json:sample});await page.locator('.app-card').waitFor();assert.equal(await page.locator('.app-card').count(),1);}finally{await page.close();}
  });
  await t.test('깨진 썸네일은 대체 화면을 표시하고 프로그램 클릭 유지',async()=>{
   const page=await pageWith([{...sample[0],thumbnail:'missing-image.png'}]);try{await page.locator('.image-unavailable, .thumbnail-fallback').waitFor();assert.equal(await page.locator('.app-card').getAttribute('href'),sample[0].url);}finally{await page.close();}
  });
  await t.test('빈 목록·잘못된 목록 응답은 명확한 상태와 재시도 표시',async()=>{
   let page=await pageWith([]);try{await page.getByText('아직 등록된 웹앱이 없습니다.').waitFor();}finally{await page.close();}
   page=await pageWith({not:'an array'});try{await page.locator('#retry').waitFor();}finally{await page.close();}
  });
  await t.test('작은 휴대폰·긴 이름과 관련 주소가 잘리지 않음',async()=>{
   const page=await pageWith([{...sample[0],name:'긴프로그램이름'.repeat(7),links:[{label:'W'.repeat(40),url:'https://example.com/teacher'}]}],{width:320});
   try{await page.locator('.related-link').waitFor();const bounds=await page.locator('.related-link').boundingBox();const card=await page.locator('.app-item').boundingBox();assert.ok(bounds.x+bounds.width<=card.x+card.width+1,'Related link must fit inside card');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}finally{await page.close();}
  });
  await t.test('키보드 탐색과 빠른 탭 변경·움직임 줄이기',async()=>{
   const page=await pageWith();try{await page.locator('.app-card').first().waitFor();await page.emulateMedia({reducedMotion:'reduce'});await page.locator('.tab[data-category=all]').focus();await page.keyboard.press('End');assert.equal(await page.locator('.tab.active').getAttribute('data-category'),'other');await page.keyboard.press('Home');assert.equal(await page.locator('.tab.active').getAttribute('data-category'),'all');for(const category of ['class','mind','work','class'])await page.locator(`.tab[data-category=${category}]`).click();assert.match(await page.locator('.app-card').textContent(),/지구촌/);assert.equal(await page.locator('#results').evaluate(el=>el.getAnimations().length),0);}finally{await page.close();}
  });
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
