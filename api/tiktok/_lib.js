import crypto from "node:crypto";

const COOKIE_NAME = "the_inner_edge_tiktok";
const STATE_COOKIE = "the_inner_edge_tiktok_state";
const APP_URL = process.env.APP_URL || "https://the-inner-edge.vercel.app";
const REDIRECT_URI = process.env.TIKTOK_REDIRECT_URI || `${APP_URL}/api/tiktok/callback`;

function secretKey(){
  const raw = process.env.TIKTOK_SESSION_SECRET || process.env.APP_SECRET;
  if(!raw) throw new Error("TIKTOK_SESSION_SECRET is not configured.");
  return crypto.createHash("sha256").update(raw).digest();
}

export function redirectUri(){ return REDIRECT_URI; }

export function cookieOptions(maxAge){
  return `Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function appendCookie(res,name,value,maxAge){
  const current=res.getHeader("Set-Cookie");
  const next=`${name}=${encodeURIComponent(value)}; ${cookieOptions(maxAge)}`;
  res.setHeader("Set-Cookie",[...(Array.isArray(current)?current:current?[current]:[]),next]);
}

export function clearCookie(res,name){
  appendCookie(res,name,"",0);
}

export function parseCookies(req){
  const raw=req.headers.cookie||"";
  return Object.fromEntries(raw.split(";").map(x=>x.trim()).filter(Boolean).map(x=>{
    const i=x.indexOf("=");
    return [x.slice(0,i),decodeURIComponent(x.slice(i+1))];
  }));
}

export function encrypt(value){
  const iv=crypto.randomBytes(12);
  const cipher=crypto.createCipheriv("aes-256-gcm",secretKey(),iv);
  const encrypted=Buffer.concat([cipher.update(JSON.stringify(value),"utf8"),cipher.final()]);
  const tag=cipher.getAuthTag();
  return Buffer.concat([iv,tag,encrypted]).toString("base64url");
}

export function decrypt(value){
  const b=Buffer.from(value,"base64url");
  const iv=b.subarray(0,12), tag=b.subarray(12,28), data=b.subarray(28);
  const decipher=crypto.createDecipheriv("aes-256-gcm",secretKey(),iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(data),decipher.final()]).toString("utf8"));
}

export function newState(){
  return crypto.randomBytes(32).toString("base64url");
}

export function json(res,status,body){
  res.status(status).setHeader("Content-Type","application/json").json(body);
}

export async function refreshIfNeeded(session,res){
  if(!session) throw new Error("TikTok is not connected.");
  if(Number(session.expires_at||0) > Date.now()+120000) return session;

  const body=new URLSearchParams({
    client_key:process.env.TIKTOK_CLIENT_KEY||"",
    client_secret:process.env.TIKTOK_CLIENT_SECRET||"",
    grant_type:"refresh_token",
    refresh_token:session.refresh_token||""
  });

  const response=await fetch("https://open.tiktokapis.com/v2/oauth/token/",{
    method:"POST",
    headers:{"Content-Type":"application/x-www-form-urlencoded","Cache-Control":"no-cache"},
    body
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok || !data.access_token) throw new Error(data.error_description||data.error||"TikTok token refresh failed.");

  session={
    ...session,
    access_token:data.access_token,
    refresh_token:data.refresh_token||session.refresh_token,
    expires_at:Date.now()+Number(data.expires_in||86400)*1000,
    refresh_expires_at:Date.now()+Number(data.refresh_expires_in||31536000)*1000,
    scope:data.scope||session.scope
  };
  appendCookie(res,COOKIE_NAME,encrypt(session),Math.max(60,Math.floor((session.refresh_expires_at-Date.now())/1000)));
  return session;
}

export { COOKIE_NAME, STATE_COOKIE };
