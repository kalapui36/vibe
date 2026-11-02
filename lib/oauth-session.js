import { createHash, randomBytes, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto';
export class EncryptedCookies {
  constructor(secret,secure=true){this.key=createHash('sha256').update(secret).digest();this.secure=secure;}
  name(kind){return `${this.secure?'__Host-':''}vibe_${kind}`;}
  seal(payload,kind){
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,iv);
    cipher.setAAD(Buffer.from(`vibe/${kind}/v1`));
    const body=Buffer.concat([cipher.update(JSON.stringify(payload)),cipher.final()]);
    return ['v1',iv.toString('base64url'),body.toString('base64url'),cipher.getAuthTag().toString('base64url')].join('.');
  }
  open(value,kind){
    if(typeof value!=='string'||value.length>8192)return null;
    try{
      const [version,iv,body,tag,...rest]=value.split('.');if(version!=='v1'||rest.length)return null;
      const decipher=createDecipheriv('aes-256-gcm',this.key,Buffer.from(iv,'base64url'));
      decipher.setAAD(Buffer.from(`vibe/${kind}/v1`));decipher.setAuthTag(Buffer.from(tag,'base64url'));
      const result=JSON.parse(Buffer.concat([decipher.update(Buffer.from(body,'base64url')),decipher.final()]).toString('utf8'));
      if(!Number.isFinite(result.expires)||result.expires<=Date.now())return null;
      return result;
    }catch{return null;}
  }
  read(req,kind){
    const key=this.name(kind)+'=';
    const value=(req.headers.cookie||'').split(';').map(part=>part.trim()).find(part=>part.startsWith(key))?.slice(key.length);
    return this.open(value,kind);
  }
  set(res,kind,payload,seconds){res.cookie(this.name(kind),this.seal(payload,kind),{httpOnly:true,secure:this.secure,sameSite:'lax',path:'/',maxAge:seconds*1000});}
  clear(res,kind){res.clearCookie(this.name(kind),{httpOnly:true,secure:this.secure,sameSite:'lax',path:'/'});}
}
export function matchesState(a,b){
  if(typeof a!=='string'||typeof b!=='string')return false;
  const left=Buffer.from(a),right=Buffer.from(b);
  return left.length===right.length&&timingSafeEqual(left,right);
}
