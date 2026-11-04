import { categoryKeys } from './categories.js';
export function webAddress(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('올바른 웹 주소를 입력해 주세요.'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.href.length > 2048) throw new Error('HTTP 또는 HTTPS 주소를 입력해 주세요.');
  return url.href;
}
export function relatedLinks(value = []) {
  if (!Array.isArray(value) || value.length > 6) throw new Error('관련 주소는 최대 6개까지 등록할 수 있습니다.');
  return value.map(link => {
    const label = String(link?.label || '').trim();
    if (!label || label.length > 40) throw new Error('관련 주소 이름을 1~40자로 입력해 주세요.');
    return { label, url: webAddress(link.url) };
  });
}
export function primaryLabel(value = '') {
  const label=String(value).trim();
  if(label.length>40)throw new Error('기본 주소 이름은 40자 이내로 입력해 주세요.');
  return label;
}

export function publicCatalog(rows,base){
  if(!Array.isArray(rows))throw new Error('웹앱 목록 형식을 확인해 주세요.');
  const allowed=new Set(categoryKeys);
  const asset=value=>{
    if(typeof value!=='string'||!value)return null;
    try{const url=new URL(value,base);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?url.href:null;}catch{return null;}
  };
  return rows.flatMap(row=>{
    if(!row||typeof row!=='object'||Array.isArray(row)||row.visible===false||row.visible===0||!allowed.has(row.category)||typeof row.name!=='string'||!row.name.trim())return [];
    if(row.visible!==undefined&&![true,1].includes(row.visible))return [];
    let url;try{url=webAddress(row.url);}catch{return [];}
    const links=[];
    for(const link of Array.isArray(row.links)?row.links.slice(0,6):[]){try{links.push(...relatedLinks([link]));}catch{/* A broken related link must not hide the other links. */}}
    return [{...row,url,name:row.name.trim(),description:typeof row.description==='string'?row.description:'',primary_label:typeof row.primary_label==='string'?row.primary_label:'',links,position:Number.isFinite(row.position)?row.position:0,image:asset(row.thumbnail||row.capture||row.image),preview:asset(row.preview)}];
  }).sort((a,b)=>a.position-b.position);
}

export function creationId(value){
  if(value===undefined||value===null)return null;
  if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))throw new Error('등록 요청을 확인해 주세요.');
  return value.toLowerCase();
}
export function sameEntryMetadata(left,right){
  const fields=row=>({name:String(row.name||'').trim(),url:webAddress(row.url),description:String(row.description||'').trim(),category:row.category,visible:row.visible!==false&&row.visible!==0,primary_label:primaryLabel(row.primary_label),links:relatedLinks(row.links)});
  return JSON.stringify(fields(left))===JSON.stringify(fields(right));
}
