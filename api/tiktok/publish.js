import { decrypt,json,parseCookies,refreshIfNeeded,COOKIE_NAME } from "./_lib.js";

export default async function handler(req,res){
  if(req.method!=="POST") return json(res,405,{ok:false,error:"Method not allowed."});
  try{
    const cookies=parseCookies(req);
    if(!cookies[COOKIE_NAME]) return json(res,401,{ok:false,error:"TikTok is not connected."});
    let session=decrypt(cookies[COOKIE_NAME]);
    session=await refreshIfNeeded(session,res);
    const body=typeof req.body==="string"?JSON.parse(req.body):req.body||{};
    const size=Number(body.video_size);
    if(!Number.isFinite(size)||size<=0||size>4*1024*1024*1024) return json(res,400,{ok:false,error:"Invalid video size."});
    const chunkSize=size<5*1024*1024?size:Math.min(10*1024*1024,size);
    const totalChunkCount=Math.ceil(size/chunkSize);
    const creatorResponse=await fetch("https://open.tiktokapis.com/v2/post/publish/creator_info/query/",{
      method:"POST",
      headers:{Authorization:`Bearer ${session.access_token}`,"Content-Type":"application/json; charset=UTF-8"},
      body:"{}"
    });
    const creator=await creatorResponse.json().catch(()=>({}));
    const options=creator?.data?.privacy_level_options||[];
    if(!options.includes(body.privacy_level)) return json(res,400,{ok:false,error:"Selected privacy setting is not available for this TikTok creator."});
    const init=await fetch("https://open.tiktokapis.com/v2/post/publish/video/init/",{
      method:"POST",
      headers:{Authorization:`Bearer ${session.access_token}`,"Content-Type":"application/json; charset=UTF-8"},
      body:JSON.stringify({
        post_info:{
          title:String(body.title||"").slice(0,2200),
          privacy_level:body.privacy_level,
          disable_comment:Boolean(body.disable_comment),
          disable_duet:Boolean(body.disable_duet),
          disable_stitch:Boolean(body.disable_stitch)
        },
        source_info:{source:"FILE_UPLOAD",video_size:size,chunk_size:chunkSize,total_chunk_count:totalChunkCount}
      })
    });
    const data=await init.json().catch(()=>({}));
    if(!init.ok || data?.error?.code!=="ok") return json(res,init.status||502,{ok:false,error:data?.error?.message||"TikTok could not initialize the post.",details:data});
    return json(res,200,{ok:true,publish_id:data.data.publish_id,upload_url:data.data.upload_url});
  }catch(e){ return json(res,500,{ok:false,error:e.message||"TikTok publishing initialization failed."}); }
}
