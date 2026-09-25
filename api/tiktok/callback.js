import { appendCookie,clearCookie,decrypt,encrypt,json,COOKIE_NAME,redirectUri,STATE_COOKIE } from "./_lib.js";

export default async function handler(req,res){
  if(req.method!=="GET") return res.status(405).send("Method not allowed.");
  try{
    const {code,state,error,error_description}=req.query||{};
    if(error) return res.redirect(302,"/?tiktok_error="+encodeURIComponent(error_description||error));
    const cookies=(req.headers.cookie||"").split(";").map(x=>x.trim()).filter(Boolean);
    const raw=Object.fromEntries(cookies.map(x=>{const i=x.indexOf("=");return[x.slice(0,i),decodeURIComponent(x.slice(i+1))]}));
    const stored=raw[STATE_COOKIE]?decrypt(raw[STATE_COOKIE]):null;
    if(!stored || stored.state!==state || Date.now()-Number(stored.created_at)>600000) return res.status(400).send("Invalid or expired TikTok authorization state.");
    clearCookie(res,STATE_COOKIE);

    const body=new URLSearchParams({
      client_key:process.env.TIKTOK_CLIENT_KEY||"",
      client_secret:process.env.TIKTOK_CLIENT_SECRET||"",
      code:String(code||""),
      grant_type:"authorization_code",
      redirect_uri:redirectUri()
    });
    const response=await fetch("https://open.tiktokapis.com/v2/oauth/token/",{
      method:"POST",
      headers:{"Content-Type":"application/x-www-form-urlencoded","Cache-Control":"no-cache"},
      body
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok || !data.access_token) return res.status(400).send(data.error_description||data.error||"TikTok authorization failed.");

    const session={
      open_id:data.open_id,
      access_token:data.access_token,
      refresh_token:data.refresh_token,
      scope:data.scope||"",
      expires_at:Date.now()+Number(data.expires_in||86400)*1000,
      refresh_expires_at:Date.now()+Number(data.refresh_expires_in||31536000)*1000
    };
    appendCookie(res,COOKIE_NAME,encrypt(session),Math.max(60,Math.floor((session.refresh_expires_at-Date.now())/1000)));
    res.redirect(302,"/?tiktok=connected");
  }catch(e){ res.status(500).send(e.message||"TikTok callback failed."); }
}
