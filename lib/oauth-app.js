import express from 'express';
import { randomBytes, createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GitHubRepository, githubRequest, failure } from './github-repository.js';
import { EncryptedCookies, matchesState } from './oauth-session.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const text=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export function readConfig(env=process.env){
  const raw=env.AUTH_ORIGIN||env.RENDER_EXTERNAL_URL||'http://127.0.0.1:3100';
  const origin=new URL(raw);
  if(origin.protocol!=='https:'&&!(origin.protocol==='http:'&&['127.0.0.1','localhost'].includes(origin.hostname)))throw new Error('AUTH_ORIGIN must use HTTPS');
  if(origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw new Error('AUTH_ORIGIN must be an origin without a path');
  const publicBase=new URL(env.PUBLIC_BASE_URL||'https://kalapui.com/vibe/');
  if(publicBase.protocol!=='https:'&&!(publicBase.protocol==='http:'&&['127.0.0.1','localhost'].includes(publicBase.hostname)))throw new Error('PUBLIC_BASE_URL must use HTTPS');
  if(!publicBase.pathname.endsWith('/'))publicBase.pathname+='/';
  if(publicBase.username||publicBase.password||publicBase.search||publicBase.hash)throw new Error('Invalid PUBLIC_BASE_URL');
  const config={origin:origin.origin,publicBase:publicBase.href,allowedUser:env.GITHUB_ALLOWED_USER||'kalapui36',allowedId:env.GITHUB_ALLOWED_USER_ID||'',owner:env.GITHUB_OWNER||'kalapui36',repo:env.GITHUB_REPO||'vibe',branch:env.GITHUB_BRANCH||'main',clientId:env.GITHUB_OAUTH_CLIENT_ID||'',clientSecret:env.GITHUB_OAUTH_CLIENT_SECRET||'',sessionSecret:env.AUTH_SESSION_SECRET||''};
  for(const key of ['allowedUser','owner','repo'])if(!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(config[key]))throw new Error(`Invalid ${key}`);
  config.configured=!!(config.clientId&&config.clientSecret&&config.sessionSecret.length>=32);
  return config;
}
export function createOAuthApp(config=readConfig(),{fetcher=fetch}={}){
  const app=express(),cookies=new EncryptedCookies(config.sessionSecret||randomBytes(32).toString('hex'),config.origin.startsWith('https:'));
  const revoked=new Map(),usedStates=new Map(),attempts=new Map();
  const loginUrl='/auth/login';
  app.disable('x-powered-by');
  app.use((req,res,next)=>{
    res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Content-Security-Policy':`default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: ${new URL(config.publicBase).origin}; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`});
    if(config.origin.startsWith('https:'))res.set('Strict-Transport-Security','max-age=31536000');
    if(['POST','PUT','PATCH','DELETE'].includes(req.method)&&(req.get('Origin')!==config.origin||req.get('X-Vibe-Request')!=='1'))return res.status(403).json({error:'허용되지 않은 요청입니다.',code:'csrf'});
    next();
  });
  app.use(express.json({limit:'7mb'}));
  function repository(token){return new GitHubRepository({...config,fetcher},token);}
  async function identity(token,expectedId){
    const user=await githubRequest(fetcher,token,'/user');
    if(typeof user.login!=='string'||!Number.isSafeInteger(user.id)||user.login.toLowerCase()!==config.allowedUser.toLowerCase()||(config.allowedId&&String(user.id)!==config.allowedId)||(expectedId&&user.id!==expectedId))throw failure(403,'이 계정은 관리자 접근이 허용되지 않습니다.','access_denied');
    const repo=await githubRequest(fetcher,token,`/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`);
    if(repo.permissions?.push!==true)throw failure(403,'저장소 수정 권한이 없습니다.','access_denied');
    return {user,repo};
  }
  async function authorized(req,res,next){
    if(!config.configured)return res.status(503).json({error:'GitHub 로그인 초기 연결이 필요합니다.',code:'not_configured'});
    const session=cookies.read(req,'session');
    if(!session?.token||!session.userId||revoked.has(session.id)){cookies.clear(res,'session');return res.status(401).json({error:'GitHub 로그인이 필요합니다.',code:'unauthenticated'});}
    try{
      const {user}=await identity(session.token,session.userId);
      req.auth={...session,user};next();
    }catch(error){if([401,403].includes(error.status))cookies.clear(res,'session');next(error);}
  }
  app.get('/healthz',(req,res)=>res.json({ok:true,configured:config.configured}));
  app.get('/',(req,res)=>res.redirect(302,config.publicBase));
  app.get('/setup',(req,res)=>{
    const callback=config.origin+'/auth/callback';
    res.type('html').send(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GitHub 로그인 연결</title><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/admin.css"><body class="admin-page"><main class="login-main"><section class="login-panel"><h1>GitHub 로그인 연결</h1><p>처음 한 번만 설정합니다.</p><div class="setup-notice"><ol><li><a href="https://github.com/settings/applications/new" rel="noreferrer">GitHub OAuth App 등록</a><br>Application name: <code>3색 바이브코딩 관리자</code>Homepage URL: <code>${text(config.publicBase)}</code>Authorization callback URL: <code>${text(callback)}</code></li><li>발급된 Client ID와 Client secret을 Render 환경 변수 <b>GITHUB_OAUTH_CLIENT_ID</b>, <b>GITHUB_OAUTH_CLIENT_SECRET</b>에 각각 저장합니다. 비밀키는 채팅이나 저장소 파일에 넣지 마세요.</li><li>설정 적용 후 아래 버튼으로 로그인합니다. 첫 본인 로그인에 성공하면 공개 페이지의 관리자 연결 주소가 자동 등록됩니다.</li></ol><p>관리자 계정: <b>${text(config.allowedUser)}</b></p><p>Client ID: ${config.clientId?'설정됨':'미설정'} · Client secret: ${config.clientSecret?'설정됨':'미설정'} · 세션 키: ${config.sessionSecret.length>=32?'설정됨':'미설정'}</p></div><a class="button primary oauth-button" href="${config.configured?'/auth/login':'/setup'}">${config.configured?'GitHub로 로그인':'환경 변수 적용 후 새로고침'}</a></section></main></body></html>`);
  });
  app.get('/auth/login',async(req,res,next)=>{
    if(!config.configured)return res.redirect(302,'/setup');
    const now=Date.now();
    for(const [key,value] of usedStates)if(value<now)usedStates.delete(key);
    for(const [key,value] of revoked)if(value<now)revoked.delete(key);
    for(const [key,value] of attempts)if(value.expires<now)attempts.delete(key);
    const key=req.ip,rate=attempts.get(key)||{count:0,expires:now+600000};
    if(++rate.count>30)return res.status(429).send('잠시 후 다시 로그인해 주세요.');attempts.set(key,rate);
    const previous=cookies.read(req,'session');
    if(previous?.token&&!revoked.has(previous.id)){
      try{await identity(previous.token,previous.userId);return res.redirect(302,'/admin');}
      catch(error){if(![401,403].includes(error.status))return next(error);cookies.clear(res,'session');}
    }
    const state=randomBytes(32).toString('base64url'),verifier=randomBytes(48).toString('base64url');
    cookies.set(res,'oauth',{state,verifier,expires:now+600000},600);
    const url=new URL('https://github.com/login/oauth/authorize');
    for(const [key,value] of Object.entries({client_id:config.clientId,redirect_uri:config.origin+'/auth/callback',scope:'repo',state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',login:config.allowedUser,allow_signup:'false'}))url.searchParams.set(key,value);
    res.redirect(302,url.href);
  });
  app.get('/auth/callback',async(req,res)=>{
    const state=cookies.read(req,'oauth');cookies.clear(res,'oauth');
    if(!config.configured||!state||!matchesState(req.query.state,state.state)||usedStates.has(state.state))return res.redirect(302,'/admin?auth_error=state');
    usedStates.set(state.state,state.expires);
    if(req.query.error)return res.redirect(302,'/admin?auth_error=cancelled');
    if(typeof req.query.code!=='string'||!req.query.code||req.query.code.length>1024)return res.redirect(302,'/admin?auth_error=state');
    try{
      let tokenResponse;
      try{tokenResponse=await fetcher('https://github.com/login/oauth/access_token',{method:'POST',signal:AbortSignal.timeout(20000),headers:{Accept:'application/json','Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:config.clientId,client_secret:config.clientSecret,code:req.query.code,redirect_uri:config.origin+'/auth/callback',code_verifier:state.verifier}).toString()});}
      catch{throw failure(503,'GitHub에 연결하지 못했습니다.');}
      if(!tokenResponse.ok)throw failure(503,'GitHub 인증 응답에 오류가 있습니다.');
      const result=await tokenResponse.json();
      if(!result.access_token||result.error)throw failure(401,'GitHub 인증을 완료하지 못했습니다.');
      const {user,repo}=await identity(result.access_token);
      const scopes=String(result.scope||'').split(/[ ,]+/);
      if(!scopes.includes('repo')&&!(repo.private===false&&scopes.includes('public_repo')))throw failure(403,'저장소 권한 승인이 필요합니다.','access_denied');
      // Only the allowed owner can publish the non-secret endpoint to the site.
      // Existing connections are preserved unless explicitly changed by that owner.
      let connected=false;
      try{connected=await repository(result.access_token).connect(config.origin);}catch{ /* Can retry through the authenticated connect action. */ }
      const expires=Date.now()+7*86400000;
      cookies.set(res,'session',{id:randomBytes(24).toString('hex'),token:result.access_token,userId:user.id,login:user.login,expires},7*86400);
      res.redirect(302,connected?'/admin':'/admin?connection=pending');
    }catch(error){cookies.clear(res,'session');res.redirect(302,`/admin?auth_error=${error.code==='access_denied'?'account':error.status===401?'expired':'provider'}`);}
  });
  app.get('/api/session',async(req,res,next)=>{
    if(!cookies.read(req,'session'))return res.json({authenticated:false,configured:config.configured,mode:'oauth',login_url:loginUrl,setup_url:'/setup'});
    return authorized(req,res,error=>{
      if(error)return next(error);
      res.json({authenticated:true,configured:true,mode:'oauth',login_url:loginUrl,user:{login:req.auth.user.login}});
    });
  });
  app.post('/api/logout',async(req,res)=>{
    const session=cookies.read(req,'session');cookies.clear(res,'session');cookies.clear(res,'oauth');
    if(session?.token){
      revoked.set(session.id,session.expires);
      try{
        const response=await fetcher(`https://api.github.com/applications/${encodeURIComponent(config.clientId)}/token`,{method:'DELETE',signal:AbortSignal.timeout(15000),headers:{Accept:'application/vnd.github+json',Authorization:`Basic ${Buffer.from(config.clientId+':'+config.clientSecret).toString('base64')}`,'Content-Type':'application/json','User-Agent':'vibe-admin'},body:JSON.stringify({access_token:session.token})});
        if(!response.ok&&response.status!==404)return res.status(503).json({error:'이 기기에서 로그아웃했습니다. GitHub 연결 해제 확인은 잠시 후 다시 시도해 주세요.',logged_out:true});
      }catch{return res.status(503).json({error:'이 기기에서 로그아웃했습니다. GitHub 연결 해제 확인은 잠시 후 다시 시도해 주세요.',logged_out:true});}
    }
    res.json({ok:true});
  });
  app.use('/api/admin',authorized);
  app.get('/api/admin/apps',async(req,res,next)=>{
    try{const result=await repository(req.auth.token).list();res.set('X-Catalog-Revision',result.revision).json(result.data);}catch(error){next(error);}
  });
  app.post('/api/admin/connect',async(req,res,next)=>{
    try{await repository(req.auth.token).connect(config.origin,true);res.json({ok:true});}catch(error){next(error);}
  });
  for(const [method,path,action] of [['post','/api/admin/apps','create'],['put','/api/admin/order','order'],['put','/api/admin/apps/:id','update'],['delete','/api/admin/apps/:id','delete'],['post','/api/admin/apps/:id/capture','capture'],['put','/api/admin/apps/:id/thumbnail','thumbnail']]){
    app[method](path,async(req,res,next)=>{
      try{const result=await repository(req.auth.token).mutate(action,req.params.id,req.body,req.get('If-Match'));res.set('X-Catalog-Revision',result.revision).status(action==='create'?201:200).json(result.data);}catch(error){next(error);}
    });
  }
  app.get(['/admin','/manage.html'],(req,res)=>res.sendFile(resolve(root,'public/admin.html')));
  app.use(express.static(resolve(root,'public'),{dotfiles:'deny'}));
  app.use((error,req,res,next)=>{
    if([401,403].includes(error.status)&&error.code!=='csrf')cookies.clear(res,'session');
    const status=Number.isInteger(error.status)&&error.status>=400&&error.status<=599?error.status:400;
    const message=['request_failed','unauthenticated','access_denied','conflict','rate_limited','invalid_html'].includes(error.code)?error.message:status===413?'업로드 파일의 용량을 확인해 주세요.':'요청 내용을 확인해 주세요.';
    res.status(status).json({error:message,code:error.code||'invalid_input'});
  });
  return app;
}
