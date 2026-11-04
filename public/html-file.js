export const MAX_HTML_BYTES=2*1024*1024;
const invalid=message=>Object.assign(new Error(message),{status:400,code:'invalid_html'});
export function validateHtml(value){
  if(!value||typeof value.filename!=='string'||!/^([^/\\\x00-\x1f]{1,120})\.html?$/i.test(value.filename))throw invalid('HTML 또는 HTM 파일을 선택해 주세요.');
  if(typeof value.text!=='string')throw invalid('올바른 HTML 파일을 선택해 주세요.');
  if(new TextEncoder().encode(value.text).length>MAX_HTML_BYTES)throw invalid('HTML 파일은 2MB 이하로 올려 주세요.');
  if(!value.text.trim()||value.text.includes('\0')||!value.text.includes('>')||!/(?:<!doctype\s+html\b|<[a-z][a-z0-9:-]{0,40}(?:\s|\/?>))/i.test(value.text))throw invalid('올바른 HTML 파일을 선택해 주세요.');
  return {filename:value.filename,text:value.text};
}
async function digest(text){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
export async function htmlBlobSha(text){
  const bytes=new TextEncoder().encode(text),header=new TextEncoder().encode(`blob ${bytes.length}\0`),blob=new Uint8Array(header.length+bytes.length);
  blob.set(header);blob.set(bytes,header.length);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-1',blob))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
export async function htmlLocation(id,upload,base,prefix='content/webapps'){
  const hash=await digest(upload.text),folder=(await digest(String(id))).slice(0,24);
  const path=`${prefix}/${folder}/${hash}.html`;
  return {url:new URL(path,base).href,html_path:path,html_filename:upload.filename,html_sha256:hash};
}
