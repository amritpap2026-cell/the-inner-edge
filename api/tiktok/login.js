import { appendCookie,encrypt,newState,redirectUri,STATE_COOKIE } from "./_lib.js";

export default async function handler(req,res){
  if(req.method!=="GET") return res.status(405).send("Method not allowed.");
  try{
    const key=process.env.TIKTOK_CLIENT_KEY;
    if(!key || !process.env.TIKTOK_CLIENT_SECRET) return res.status(500).send("TikTok credentials are not configured.");
    const state=newState();
    appendCookie(res,STATE_COOKIE,encrypt({state,created_at:Date.now()}),600);
    const url=new URL("https://www.tiktok.com/v2/auth/authorize/");
    url.searchParams.set("client_key",key);
    url.searchParams.set("scope","video.publish");
    url.searchParams.set("response_type","code");
    url.searchParams.set("redirect_uri",redirectUri());
    url.searchParams.set("state",state);
    res.redirect(302,url.toString());
  }catch(e){ res.status(500).send(e.message||"TikTok authorization failed."); }
}
