import http from 'node:http';
import { createHash } from 'node:crypto';
import { createOAuthApp, readConfig } from '../../lib/oauth-app.js';
export async function oauthFixture({secure=false,configured=true}={}){
  const state={rows:[],revision:'catalog-0',configRevision:'config-0',publicConfig:{owner:'kalapui36',repo:'vibe',branch:'main'},permission:true,apiDown:false,revoked:new Set(),calls:[],uploads:[],exchange:[],exchanges:0};
  const server=http.createServer();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const config=readConfig({AUTH_ORIGIN:secure?'https://auth.example.test':base,PUBLIC_BASE_URL:'https://kalapui.com/vibe/',GITHUB_OAUTH_CLIENT_ID:configured?'test-client':'',GITHUB_OAUTH_CLIENT_SECRET:configured?'test-client-secret-not-real':'',AUTH_SESSION_SECRET:'test-session-secret-not-real-32-characters'});
  const reply=(data,status=200)=>new Response(status===204?null:JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
  const fetcher=async(url,options={})=>{
    const address=new URL(url),method=options.method||'GET';
    state.calls.push({host:address.host,path:address.pathname,method});
    if(address.host==='github.com'&&address.pathname==='/login/oauth/access_token'){
      const payload=new URLSearchParams(options.body);state.exchange.push(payload);
      if(payload.get('client_secret')!=='test-client-secret-not-real'||!payload.get('code_verifier'))return reply({error:'incorrect_client_credentials'},401);
      const code=payload.get('code');
      if(code==='bad')return reply({error:'bad_verification_code'});
      return reply({access_token:`gho-test-${code}-${++state.exchanges}`,token_type:'bearer',scope:'repo'});
    }
    if(address.host!=='api.github.com')throw new Error('Unexpected external destination');
    if(state.apiDown)return new Response('<html>Unavailable</html>',{status:503});
    const authorization=options.headers?.Authorization||'';
    const token=authorization.replace('Bearer ','');
    if(address.pathname.startsWith('/applications/test-client/token')&&method==='DELETE'){
      if(authorization!==`Basic ${Buffer.from('test-client:test-client-secret-not-real').toString('base64')}`)return reply({},401);
      state.revoked.add(JSON.parse(options.body).access_token);return reply(null,204);
    }
    if(!authorization.startsWith('Bearer ')||state.revoked.has(token))return reply({},401);
    if(address.pathname==='/user')return reply({login:state.userOverride||(token.includes('outsider')?'another-user':'kalapui36'),id:token.includes('outsider')?99:123});
    if(address.pathname==='/repos/kalapui36/vibe')return reply({private:true,permissions:{push:state.permission}});
    const prefix='/repos/kalapui36/vibe/contents/';
    if(!address.pathname.startsWith(prefix))throw new Error('Unexpected repository endpoint');
    const path=address.pathname.slice(prefix.length),payload=options.body?JSON.parse(options.body):null;
    if(path==='content/apps.json'){
      if(method==='GET')return reply({sha:state.revision,encoding:'base64',content:Buffer.from(JSON.stringify(state.rows)).toString('base64')});
      if(method==='PUT'){
        if(payload.sha!==state.revision)return reply({},409);
        state.rows=JSON.parse(Buffer.from(payload.content,'base64').toString('utf8'));state.revision=`catalog-${Number(state.revision.split('-')[1])+1}`;
        return reply({content:{sha:state.revision}});
      }
    }
    if(path==='content/config.json'){
      if(method==='GET')return reply({sha:state.configRevision,encoding:'base64',content:Buffer.from(JSON.stringify(state.publicConfig)).toString('base64')});
      if(payload.sha!==state.configRevision)return reply({},409);
      state.publicConfig=JSON.parse(Buffer.from(payload.content,'base64').toString('utf8'));state.configRevision='config-'+Date.now();return reply({content:{sha:state.configRevision}});
    }
    if(path.startsWith('content/thumbnails/')&&method==='PUT'){state.uploads.push(payload);return reply({content:{sha:'image-1'}});}
    throw new Error('Unexpected method');
  };
  server.on('request',createOAuthApp(config,{fetcher}));
  const cookiesFrom=response=>response.headers.getSetCookie();
  const cookieFor=(response,kind)=>cookiesFrom(response).find(value=>value.startsWith(`${secure?'__Host-':''}vibe_${kind}=`)&&!value.startsWith(`${secure?'__Host-':''}vibe_${kind}=;`))?.split(';')[0];
  async function startLogin(){const response=await fetch(base+'/auth/login',{redirect:'manual'});return {response,url:new URL(response.headers.get('location'),base),cookie:cookieFor(response,'oauth')};}
  async function callback(start,code='owner',overrides={}){
    const url=new URL(base+'/auth/callback');url.searchParams.set('state',overrides.state||start.url.searchParams.get('state'));url.searchParams.set('code',code);
    const response=await fetch(url,{redirect:'manual',headers:{Cookie:overrides.cookie||start.cookie}});
    return {response,cookie:cookieFor(response,'session')};
  }
  async function login(code='owner'){return callback(await startLogin(),code);}
  async function request(path,{cookie,method='GET',body,revision,origin=config.origin,header=true}={}){
    return fetch(base+path,{method,redirect:'manual',headers:{'Content-Type':'application/json',...(header?{'X-Vibe-Request':'1'}:{}),...(cookie?{Cookie:cookie}:{}),...(origin?{Origin:origin}:{}),...(revision?{'If-Match':revision}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  }
  return {base,config,state,server,login,startLogin,callback,request,cookieFor,close:()=>new Promise(resolve=>server.close(resolve)),challenge:verifier=>createHash('sha256').update(verifier).digest('base64url')};
}
