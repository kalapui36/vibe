import { api, escape, categories, thumbnail, bindImageErrors } from './shared.js';
import { relatedLinks } from './catalog.js';
import { matchesSearch, suggestions, highlightedName } from './search.js';
let apps = [], category = 'all', selectedId = '', transition, loadState='loading';
let options=[], activeOption=-1, composing=false, typing=false, restoring=false, scrollFrame;
const search = document.querySelector('#search'), results = document.querySelector('#results');
const list = document.querySelector('#search-suggestions');
const tabs = [...document.querySelectorAll('.tab')];
const indicator = document.querySelector('.tab-indicator');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const validCategories = ['all', ...Object.keys(categories)];
const boardOrder=tabs.map(tab=>tab.dataset.category).filter(key=>Object.hasOwn(categories,key));
if ('scrollRestoration' in history) history.scrollRestoration='manual';
function updateIndicator() {
  const tab = document.querySelector('.tab.active');
  indicator.style.width = `${tab.offsetWidth}px`;
  indicator.style.height = `${tab.offsetHeight}px`;
  indicator.style.transform = `translate(${tab.offsetLeft}px,${tab.offsetTop}px)`;
}
function applyCategory() {
  document.documentElement.dataset.category=category;
  tabs.forEach(button=>{const active=button.dataset.category===category;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
}
function readLocation() {
  const params=new URLSearchParams(location.search);
  category=validCategories.includes(params.get('category'))?params.get('category'):'all';
  search.value=params.get('q')||'';selectedId=params.get('app')||'';applyCategory();
}
function saveScroll() {
  if(loadState==='ready'&&!restoring) history.replaceState({...history.state,vibeScroll:scrollY,vibeBoardScroll:results.querySelector('.category-board')?.scrollLeft??history.state?.vibeBoardScroll??0},'');
}
function remember(replace=false) {
  saveScroll();const url=new URL(location.href);
  for(const [key,value] of [['q',search.value],['category',category==='all'?'':category],['app',selectedId]]) {
    if(value)url.searchParams.set(key,value);else url.searchParams.delete(key);
  }
  if(url.href!==location.href) history[replace?'replaceState':'pushState']({...history.state,vibeScroll:scrollY},'',url);
}
function restoreScroll(y,unchangedY) {
  const boardX=history.state?.vibeBoardScroll||0;
  restoring=true;
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    // A visitor may already have scrolled while the catalog or font loaded.
    if(unchangedY===undefined||scrollY===unchangedY){
      scrollTo(0,y||0);const board=results.querySelector('.category-board');if(board)board.scrollLeft=boardX;
    }
    restoring=false;saveScroll();
  }));
}
function closeSuggestions() {
  list.hidden=true;search.setAttribute('aria-expanded','false');search.removeAttribute('aria-activedescendant');activeOption=-1;
  document.querySelector('#suggestion-status').textContent='';
}
function showSuggestions() {
  options=suggestions(apps,search.value);activeOption=-1;
  if(!options.length){closeSuggestions();return;}
  list.innerHTML=options.map((app,index)=>`<li id="suggestion-${index}" role="option" aria-selected="false" data-index="${index}"><span class="suggestion-name">${highlightedName(app.name,search.value)}</span><span class="suggestion-category ${escape(app.category)}">${categories[app.category]}</span><span class="suggestion-arrow" aria-hidden="true">↖</span></li>`).join('');
  list.hidden=false;search.setAttribute('aria-expanded','true');search.removeAttribute('aria-activedescendant');
  document.querySelector('#suggestion-status').textContent=`추천 프로그램 ${options.length}개. 위아래 방향키로 선택할 수 있습니다.`;
}
function activateOption(index) {
  activeOption=index;list.querySelectorAll('[role=option]').forEach((option,i)=>option.setAttribute('aria-selected',String(i===index)));
  search.setAttribute('aria-activedescendant',`suggestion-${index}`);
  list.children[index]?.scrollIntoView({block:'nearest'});
}
function chooseOption(index) {
  const app=options[index];if(!app)return;
  typing=false;search.value=app.name;selectedId=app.id;
  if(category!=='all'&&category!==app.category)category=app.category;
  applyCategory();closeSuggestions();remember();render(true);
  results.scrollIntoView({block:'start',behavior:reducedMotion.matches?'instant':'smooth'});
  const board=results.querySelector('.category-board'),column=board?.querySelector(`[data-column="${app.category}"]`);
  if(column)board.scrollTo({left:column.offsetLeft,behavior:reducedMotion.matches?'instant':'smooth'});
}
function card(app,heading='h2') {
  let links=[];
  try { links=relatedLinks(app.links); } catch { /* Invalid legacy links are never rendered. */ }
  return `<article class="app-item"><a class="app-card" href="${escape(app.url)}" target="_blank" rel="noopener noreferrer" aria-label="${escape(app.name)} — 새 탭에서 열기"><div class="card-image">${thumbnail(app)}</div><div class="card-body"><span class="category-label ${escape(app.category)}"><i></i>${categories[app.category]}</span><div class="card-title-row"><${heading}>${escape(app.name)}</${heading}><span class="card-arrow" aria-hidden="true">↗</span></div><p class="card-description">${escape(app.description || '웹앱을 열어 확인하세요.')}</p></div></a><div class="card-footer"><span class="primary-label">${escape(app.primary_label || '프로그램')}</span><div class="related-links">${links.map(link=>`<a class="related-link" href="${escape(link.url)}" target="_blank" rel="noopener noreferrer" aria-label="${escape(app.name)} ${escape(link.label)} — 새 탭에서 열기">${escape(link.label)} ↗</a>`).join('')}</div></div></article>`;
}
function skeletonCard(){return '<div class="skeleton-card"><div class="skeleton-image skeleton"></div><div class="skeleton-body"><span class="skeleton skeleton-tag"></span><span class="skeleton skeleton-title"></span><span class="skeleton skeleton-line"></span><span class="skeleton skeleton-line short"></span></div></div>';}
function categoryBoard(filtered,loading=false){
  return `<p class="board-scroll-hint"${loading?' aria-hidden="true"':''}>옆으로 넘겨 다른 분류를 확인하세요 <span aria-hidden="true">↔</span></p><div class="category-board${loading?' skeleton-grid':''}" ${loading?'aria-hidden="true"':'role="region" aria-label="분류별 웹앱 목록" tabindex="0"'}>${boardOrder.map(key=>{
    const members=filtered.filter(app=>app.category===key);
    return `<section class="board-column" data-column="${key}" aria-labelledby="board-title-${key}"><header class="board-heading"><h2 id="board-title-${key}">${categories[key]}</h2><span class="board-count">${loading?'—':members.length}</span></header><div class="board-stack">${loading?skeletonCard():members.length?members.map(app=>card(app,'h3')).join(''):`<p class="board-empty">${search.value.trim()?'일치하는 웹앱이 없습니다.':'등록된 웹앱이 없습니다.'}</p>`}</div></section>`;
  }).join('')}</div>`;
}
function render(animate = false) {
  const boardX=results.querySelector('.category-board')?.scrollLeft??history.state?.vibeBoardScroll??0;
  transition?.cancel();results.setAttribute('aria-busy',String(loadState==='loading'));
  if(loadState!=='ready'){
    closeSuggestions();
    document.querySelector('#result-status').textContent=loadState==='loading'?'웹앱을 불러오는 중입니다.':'목록 연결을 확인해 주세요.';
    results.innerHTML=loadState==='loading'?`<h2 class="sr-only">웹앱을 불러오는 중입니다.</h2>${category==='all'?categoryBoard([],true):`<div class="app-grid skeleton-grid" aria-hidden="true">${Array.from({length:3},skeletonCard).join('')}</div>`}`:'<div class="empty-state"><h2>목록을 불러오지 못했습니다.</h2><p>연결을 확인한 뒤 다시 시도해 주세요.</p><button class="button" id="retry">다시 시도</button></div>';
    document.querySelector('#retry')?.addEventListener('click',load);updateIndicator();return;
  }
  const query=search.value.trim();
  const filtered=apps.filter(app=>(category==='all'||app.category===category)&&(!selectedId||app.id===selectedId)&&matchesSearch(app,query));
  for (const key of validCategories) document.querySelector(`#count-${key}`).textContent = key === 'all' ? apps.length : apps.filter(app=>app.category === key).length;
  document.querySelector('#result-status').textContent = `${category === 'all' ? '전체' : categories[category]} 프로그램 ${filtered.length}개${query ? `, 검색어 ${query}` : ''}`;
  if (!filtered.length) {
    results.innerHTML = `<div class="empty-state"><div class="empty-icon" aria-hidden="true">${apps.length ? '⌕' : '▦'}</div><h2>${apps.length ? '검색 결과가 없습니다.' : '아직 등록된 웹앱이 없습니다.'}</h2><p>${apps.length ? '다른 검색어나 분류로 찾아보세요.' : '웹앱이 등록되면 이곳에서 확인할 수 있습니다.'}</p>${apps.length ? '<button class="text-button" id="reset-filters">전체 보기 ↗</button>' : ''}</div>`;
    document.querySelector('#reset-filters')?.addEventListener('click',()=>{search.value='';selectedId='';category='all';typing=false;applyCategory();closeSuggestions();remember();render(true);});
  } else {
    results.innerHTML = category==='all'?categoryBoard(filtered):`<div class="app-grid" data-layout="${filtered.length===1?'single':filtered.length===2?'two':'many'}">${filtered.map(app=>card(app)).join('')}</div>`;
    bindImageErrors(results);
    const board=results.querySelector('.category-board');
    if(board){board.scrollLeft=boardX;board.addEventListener('scroll',saveScroll,{passive:true});}
  }
  updateIndicator();
  if (animate && !reducedMotion.matches) transition = results.animate([{ opacity:.25, transform:'translateY(8px)' },{ opacity:1, transform:'translateY(0)' }],{ duration:220, easing:'cubic-bezier(.2,.7,.2,1)' });
}
for (const tab of tabs) {
  tab.addEventListener('click',()=>{
    const changed=category!==tab.dataset.category;
    category=tab.dataset.category;selectedId='';typing=false;
    applyCategory();closeSuggestions();remember();render(changed);
  });
  tab.addEventListener('keydown',event=>{
    const index=tabs.indexOf(tab);
    const next=event.key==='ArrowRight'?(index+1)%tabs.length:event.key==='ArrowLeft'?(index+tabs.length-1)%tabs.length:event.key==='Home'?0:event.key==='End'?tabs.length-1:null;
    if(next!==null){event.preventDefault();tabs[next].focus();tabs[next].click();}
  });
}
function searchChanged() {
  selectedId='';remember(typing);typing=true;render();showSuggestions();
}
// Korean IMEs emit input events before compositionend. Show those values live;
// only recommendation keyboard selection waits for composition to finish.
search.addEventListener('input',searchChanged);
search.addEventListener('compositionstart',()=>{composing=true;});
search.addEventListener('compositionend',()=>{composing=false;searchChanged();});
search.addEventListener('focus',()=>{if(loadState==='ready')showSuggestions();});
search.addEventListener('blur',()=>{typing=false;closeSuggestions();});
search.addEventListener('keydown',event=>{
  if(composing||event.isComposing||event.keyCode===229)return;
  if(event.key==='Escape'){event.preventDefault();closeSuggestions();return;}
  if(['ArrowDown','ArrowUp'].includes(event.key)){
    if(list.hidden)showSuggestions();if(list.hidden)return;
    event.preventDefault();activateOption((activeOption+(event.key==='ArrowDown'?1:activeOption<0?0:-1)+options.length)%options.length);
  }else if(event.key==='Enter'){
    event.preventDefault();if(!list.hidden&&activeOption>=0)chooseOption(activeOption);else closeSuggestions();typing=false;
  }
});
list.addEventListener('pointerdown',event=>event.preventDefault());
list.addEventListener('click',event=>{const option=event.target.closest('[data-index]');if(option)chooseOption(Number(option.dataset.index));});
document.addEventListener('pointerdown',event=>{if(!event.target.closest('.search-box'))closeSuggestions();});
document.addEventListener('keydown',event=>{ if(event.key==='/'&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!document.activeElement.isContentEditable&&!['INPUT','TEXTAREA'].includes(document.activeElement.tagName)){ event.preventDefault(); search.focus(); } });
window.addEventListener('scroll',()=>{cancelAnimationFrame(scrollFrame);scrollFrame=requestAnimationFrame(saveScroll);},{passive:true});
window.addEventListener('pagehide',saveScroll);
window.addEventListener('popstate',()=>{
  cancelAnimationFrame(scrollFrame);const y=history.state?.vibeScroll||0;typing=false;closeSuggestions();readLocation();render();restoreScroll(y);
});
new ResizeObserver(updateIndicator).observe(document.querySelector('.tabs'));
document.fonts.ready.then(updateIndicator);
readLocation();
async function load() {
  const y=history.state?.vibeScroll||0,startingY=scrollY;
  loadState='loading';render();
  try { apps=await api('/api/apps');loadState='ready'; }
  catch { loadState='error'; }
  render();if(loadState==='ready'){
    if(document.activeElement===search)showSuggestions();
    await document.fonts.ready;restoreScroll(y,startingY);
  }
}
load();
