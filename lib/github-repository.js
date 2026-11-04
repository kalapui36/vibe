import { randomUUID } from 'node:crypto';
import { webAddress, relatedLinks, primaryLabel, creationId, sameEntryMetadata } from '../public/catalog.js';
import { validateHtml, htmlLocation } from '../public/html-file.js';

export function failure(status, message, code='request_failed') {
  return Object.assign(new Error(message), { status, code });
}
export async function githubRequest(fetcher, token, path, options={}) {
  const {allowMissing,...requestOptions}=options;
  let response;
  try {
    response=await fetcher(`https://api.github.com${path}`,{
      ...requestOptions, signal:AbortSignal.timeout(20000),
      headers:{ Accept:'application/vnd.github+json', 'X-GitHub-Api-Version':'2022-11-28', Authorization:`Bearer ${token}`, 'User-Agent':'vibe-admin', ...(options.body?{'Content-Type':'application/json'}:{}), ...options.headers }
    });
  } catch { throw failure(503,'GitHub에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.'); }
  if(response.status===404&&allowMissing)return null;
  if(!response.ok){
    if(response.status===429||(response.status===403&&(response.headers.get('x-ratelimit-remaining')==='0'||response.headers.get('retry-after'))))throw failure(429,'GitHub 요청 한도에 도달했습니다. 잠시 기다린 뒤 다시 시도해 주세요.','rate_limited');
    if(response.status===401)throw failure(401,'GitHub 로그인이 만료되었습니다. 다시 로그인해 주세요.','unauthenticated');
    if(response.status===403)throw failure(403,'저장소 수정 권한이 없습니다.','access_denied');
    if([409,422].includes(response.status))throw failure(409,'다른 곳에서 목록이 변경되었습니다. 목록을 다시 불러온 뒤 시도해 주세요.','conflict');
    if(response.status===404)throw failure(403,'저장소 접근 권한을 확인해 주세요.','access_denied');
    throw failure(503,'GitHub에서 일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
  }
  if(response.status===204)return null;
  try{return await response.json();}catch{throw failure(503,'GitHub 응답을 확인하지 못했습니다.');}
}
export class GitHubRepository {
  constructor({owner,repo,branch,publicBase,fetcher=fetch},token){
    this.options={owner,repo,branch,publicBase};this.fetcher=fetcher;this.token=token;
    this.root=`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  }
  request(path,options){return githubRequest(this.fetcher,this.token,this.root+path,options);}
  async file(path){
    const file=await this.request(`/contents/${path}?ref=${encodeURIComponent(this.options.branch)}`);
    if(file.encoding!=='base64'||typeof file.content!=='string'||!file.sha)throw failure(503,'저장소 파일을 읽지 못했습니다.');
    try{return {sha:file.sha,value:JSON.parse(Buffer.from(file.content,'base64').toString('utf8'))};}
    catch{throw failure(503,'저장소 파일 형식을 확인해 주세요.');}
  }
  async catalog(){const result=await this.file('content/apps.json');if(!Array.isArray(result.value))throw failure(503,'웹앱 목록 형식을 확인해 주세요.');return result;}
  decorate(row){
    const base=this.options.publicBase,image=row.thumbnail||row.capture||null;
    return {...row,image:image?new URL(image,base).href:null,preview:row.preview?new URL(row.preview,base).href:null};
  }
  async list(){const {sha,value}=await this.catalog();return {revision:sha,data:value.slice().sort((a,b)=>a.position-b.position).map(row=>this.decorate(row))};}
  validate(body){
    if(!body||typeof body!=='object')throw failure(400,'입력 내용을 확인해 주세요.');
    const name=String(body.name||'').trim(),description=String(body.description||'').trim();
    if(!name||name.length>80||description.length>240||!['class','mind','work'].includes(body.category))throw failure(400,'이름, 설명과 분류를 확인해 주세요.');
    return {name,description,url:webAddress(body.url),category:body.category,visible:body.visible!==false,primary_label:primaryLabel(body.primary_label),links:relatedLinks(body.links)};
  }
  async write(path,value,sha,message){
    const response=await this.request(`/contents/${path}`,{method:'PUT',body:JSON.stringify({message,content:Buffer.from(JSON.stringify(value,null,2)+'\n').toString('base64'),sha,branch:this.options.branch})});
    if(!response?.content?.sha)throw failure(503,'저장 결과를 확인하지 못했습니다. 목록을 다시 불러와 주세요.');
    return response.content.sha;
  }
  async mutate(method,id,body,expected){
    const current=await this.catalog();
    const requestId=method==='create'?creationId(body?.request_id):null;
    const targetId=method==='create'?(requestId||randomUUID()):id;
    const upload=['create','update'].includes(method)&&body?.html!==undefined?validateHtml(body.html):null;
    const html=upload?await htmlLocation(targetId,upload,this.options.publicBase):null;
    if(html)body={...body,url:html.url};
    if(requestId){
      const existing=current.value.find(row=>row.id===requestId);
      if(existing){
        if(!sameEntryMetadata(existing,this.validate(body)))throw failure(409,'이미 저장된 등록 요청입니다. 최신 내용을 불러와 확인해 주세요.','conflict');
        return {revision:current.sha,data:this.decorate(existing)};
      }
    }
    if(!expected)throw failure(428,'목록을 먼저 불러온 뒤 수정해 주세요.','conflict');
    if(expected!==current.sha)throw failure(409,'다른 곳에서 목록이 변경되었습니다. 목록을 다시 불러온 뒤 시도해 주세요.','conflict');
    const rows=structuredClone(current.value);
    let data={ok:true},message='Update web app';
    if(method==='create'){
      const row={...this.validate(body),...(html||{}),id:targetId,position:Math.max(-1,...rows.map(row=>row.position))+1,thumbnail:null,capture:null,capture_status:'pending',capture_error:null,capture_requested_at:new Date().toISOString(),created_at:new Date().toISOString()};
      rows.push(row);data=this.decorate(row);message='Add web app';
    }else if(method==='order'){
      if(!Array.isArray(body?.ids)||body.ids.length!==rows.length||new Set(body.ids).size!==rows.length||rows.some(row=>!body.ids.includes(row.id)))throw failure(400,'목록 순서를 확인해 주세요.');
      body.ids.forEach((id,index)=>rows.find(row=>row.id===id).position=index);message='Update web app order';
    }else{
      const index=rows.findIndex(row=>row.id===id),row=rows[index];
      if(!row)throw failure(404,'웹앱을 찾을 수 없습니다.');
      if(method==='update'){
        const value=this.validate({...row,...body});
        if(!html&&row.html_path&&row.url!==value.url)Object.assign(row,{html_path:null,html_filename:null,html_sha256:null});
        if(row.url!==value.url){row.capture=null;row.capture_status='pending';row.capture_error=null;row.capture_requested_at=new Date().toISOString();}
        Object.assign(row,value,html||{});
      }else if(method==='delete'){rows.splice(index,1);message='Delete web app';}
      else if(method==='capture'){row.capture_status='pending';row.capture_error=null;row.capture_requested_at=new Date().toISOString();message='Refresh web app screenshot';}
      else if(method==='thumbnail'){
        if(body?.image===null)row.thumbnail=null;
        else{
          const match=/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(body?.image||'');
          if(!match||match[2].length>5600000)throw failure(400,'4MB 이하 PNG, JPG, WebP 이미지를 선택해 주세요.');
          const buffer=Buffer.from(match[2],'base64'),type=match[1];
          const valid=type==='png'?buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):type==='jpeg'?buffer[0]===255&&buffer[1]===216&&buffer[2]===255:buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP';
          if(!valid||buffer.length>4*1024*1024)throw failure(400,'유효한 이미지 파일을 선택해 주세요.');
          const path=`content/thumbnails/${randomUUID()}.${type}`;
          await this.request(`/contents/${path}`,{method:'PUT',body:JSON.stringify({message:'Upload web app thumbnail',content:match[2],branch:this.options.branch})});
          row.thumbnail=path;
        }
        message='Update web app thumbnail';
      }else throw failure(400,'지원하지 않는 요청입니다.');
    }
    if(upload)await this.uploadHtml(html.html_path,upload);
    const revision=await this.write('content/apps.json',rows,current.sha,message);
    return {revision,data};
  }
  async uploadHtml(path,upload){
    // Immutable paths keep a rejected catalog update from changing a live app.
    // Retrying a lost response reuses the exact file instead of overwriting it.
    const existing=await this.request(`/contents/${path}?ref=${encodeURIComponent(this.options.branch)}`,{allowMissing:true});
    const content=Buffer.from(upload.text,'utf8').toString('base64');
    if(existing){
      if(existing.encoding==='base64'&&existing.content?.replace(/\s/g,'')===content)return;
      throw failure(409,'저장된 HTML 파일을 확인해 주세요.','conflict');
    }
    const result=await this.request(`/contents/${path}`,{method:'PUT',body:JSON.stringify({message:'Upload web app HTML',content,branch:this.options.branch})});
    if(!result?.content?.sha)throw failure(503,'HTML 저장 결과를 확인하지 못했습니다. 다시 저장해 주세요.');
  }
  async connect(authOrigin,replace=false){
    const {sha,value}=await this.file('content/config.json');
    if(value.owner!==this.options.owner||value.repo!==this.options.repo||value.branch!==this.options.branch)throw failure(409,'공개 페이지의 저장소 설정을 확인해 주세요.');
    if(value.auth_url===authOrigin)return true;
    if(value.auth_url&&!replace)return false;
    await this.write('content/config.json',{...value,auth_url:authOrigin},sha,'Connect GitHub administrator login');
    return true;
  }
}
