import { decrypt,json,parseCookies,refreshIfNeeded,COOKIE_NAME } from "./_lib.js";

export default async function handler(req,res){
  if(req.method!=="POST") return json(res,405,{ok:false,error:"Method not allowed."});
  try{
    const cookies=parseCookies(req);
    if(!cookies[COOKIE_NAME]) return json(res,401,{ok:false,error:"TikTok is not connected."});
    let session=decrypt(cookies[COOKIE_NAME]);
    session=await refreshIfNeeded(session,res);
    const body=typeof req.body==="string"?JSON.parse(req.body):req.body||{};
    if(!body.publish_id) return json(res,400,{ok:false,error:"publish_id is required."});
    const response=await fetch("https://open.tiktokapis.com/v2/post/publish/status/fetch/",{
      method:"POST",
      headers:{Authorization:`Bearer ${session.access_token}`,"Content-Type":"application/json"},
      body:JSON.stringify({publish_id:body.publish_id})
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok || data?.error?.code!=="ok") return json(res,response.status||502,{ok:false,error:data?.error?.message||"TikTok status request failed.",details:data});
    return json(res,200,{ok:true,status:data.data?.status,fail_reason:data.data?.fail_reason||null,data:data.data});
  }catch(e){ return json(res,500,{ok:false,error:e.message||"TikTok status request failed."}); }
}
