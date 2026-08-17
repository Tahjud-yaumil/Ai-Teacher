export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const env=(n)=>typeof process.env[n]==='string'?process.env[n].trim():'';
export async function GET(request){
  try{
    const token=env('TELEGRAM_BOT_TOKEN');
    if(!token) return Response.json({ok:false,reason:'TELEGRAM_BOT_TOKEN belum tersedia.'},{status:500});
    const url=new URL(request.url); const webhookUrl=`${url.protocol}//${url.host}/api/telegram/webhook`;
    const r=await fetch(`https://api.telegram.org/bot${token}/setWebhook`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url:webhookUrl,drop_pending_updates:true}),cache:'no-store'});
    const d=await r.json().catch(()=>({}));
    if(!r.ok||d?.ok!==true) return Response.json({ok:false,telegram:d},{status:500});
    const c=await fetch(`https://api.telegram.org/bot${token}/setMyCommands`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({commands:[{command:'jadwal',description:'Tampilkan jadwal hari ini'}]}),cache:'no-store'});
    const cd=await c.json().catch(()=>({}));
    return Response.json({ok:c.ok&&cd?.ok===true,webhook_url:webhookUrl,command:'/jadwal',telegram:{setWebhook:d,setMyCommands:cd}});
  }catch(e){return Response.json({ok:false,reason:e instanceof Error?e.message:'Setup webhook gagal.'},{status:500});}
}
