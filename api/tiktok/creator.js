import { decrypt,json,parseCookies,refreshIfNeeded,COOKIE_NAME } from "./_lib.js";

export default async function handler(req,res){
  if(req.method!=="GET") return json(res,405,{ok:false,error:"Method not allowed."});
  try{
    const cookies=parseCookies(req);
    if(!cookies[COOKIE_NAME]) return json(res,401,{ok:false,error:"TikTok is not connected."});
    let session=decrypt(cookies[COOKIE_NAME]);
    session=await refreshIfNeeded(session,res);
    const response=await fetch("https://open.tiktokapis.com/v2/post/publish/creator_info/query/",{
      method:"POST",
      headers:{Authorization:`Bearer ${session.access_token}`,"Content-Type":"application/json; charset=UTF-8"},
      body:"{}"
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok || data?.error?.code!=="ok") return json(res,response.status||502,{ok:false,error:data?.error?.message||"TikTok creator info request failed.",details:data});
    return json(res,200,{ok:true,creator:data.data});
  }catch(e){ return json(res,401,{ok:false,error:e.message||"TikTok connection is unavailable."}); }
}
