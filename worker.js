// Public ranking adapter; Nico parser ported from the existing Nico recorder.
const LIMIT=200;
const MAX_BYTES=6*1024*1024;
const REFRESH_MS=10000;
const DETAIL_REFRESH_MS=30000;

function clean(v,max=240) {
  return String(v??"").replace(/&(?:amp|lt|gt|quot|apos|nbsp);|&#(?:x[0-9a-f]{1,6}|\d{1,7});/gi,entity=>{
    const named={"&amp;":"&","&lt;":"<","&gt;":">","&quot;":'"',"&apos;":"'","&nbsp;":" "};
    if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
    const n=entity[2].toLowerCase()==="x"?parseInt(entity.slice(3,-1),16):Number(entity.slice(2,-1));
    return n>=0&&n<=0x10ffff?String.fromCodePoint(n):"";
  }).replace(/<[^>]*>/g," ").replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim().slice(0,max);
}
function liveId(v) {
  const s=String(v??"").trim();
  if (/^lv\d{5,15}$/i.test(s)) return s.toLowerCase();
  try {
    const u=new URL(s,"https://live.nicovideo.jp");
    if(u.protocol!=="https:"||u.hostname!=="live.nicovideo.jp") return "";
    return /^\/watch\/(lv\d{5,15})\/?$/i.exec(u.pathname)?.[1].toLowerCase()||"";
  } catch {return "";}
}
function count(v) {
  if(typeof v!=="number"&&typeof v!=="string") return null;
  const s=String(v).replace(/,/g,"").trim();
  if(!/^\d{1,12}$/.test(s)) return null;
  return Number(s);
}
function time(v) {
  if(v==null||v==="")return "";
  const n=typeof v==="number"||/^\d{10,13}$/.test(String(v))?Number(v):Date.parse(v);
  const ms=n>0&&n<1e12?n*1000:n;
  return Number.isFinite(ms)&&ms>0&&ms<8.64e15?new Date(ms).toISOString():"";
}
function rankingImageUrl(value) {
  if(typeof value!=="string"||value.length>2048)return "";
  try{
    const u=new URL(value);
    if(u.protocol!=="https:"||u.username||u.password||u.port||
       !(u.hostname==="nimg.jp"||u.hostname.endsWith(".nimg.jp")))return "";
    return u.href;
  }catch{return "";}
}
function firstRankingImage(...values){
  for(const value of values){const url=rankingImageUrl(value);if(url)return url;}
  return "";
}
function jsonRow(raw) {
  if(!raw||typeof raw!=="object"||Array.isArray(raw)) return null;
  const p=raw.program&&typeof raw.program==="object"?raw.program:raw;
  const id=liveId(p.liveId??p.programId??p.nicoliveProgramId??p.contentId??p.id?.value??p.id??p.watchPageUrl??p.watchUrl);
  const title=clean(p.title??p.programTitle);
  if(!id||!title)return null;
  const status=String(p.schedule?.status??p.liveStatus??p.status??"").toUpperCase();
  if(status&&!["ON_AIR","ONAIR","LIVE","ON AIR"].includes(status))return null;
  if(p.isOnAir===false)return null;
  const provider=p.programProvider??p.provider??p.supplier??raw.programProvider??raw.provider??raw.supplier??{};
  const statistics=p.statistics??p.stats??raw.statistics??raw.stats??{};
  const providerType=String(provider.programProviderType??provider.type??"").trim().toLowerCase();
  const numeric=String(provider.id??p.userId??"").trim();
  // Official-format providers include programProviderId and a provider type.
  // Keep the legacy untyped numeric-ID format for ranking lists only.
  // A named channel must never be treated as a user.
  const hasIdentityLink=[provider.url,provider.pageUrl,provider.userPageUrl,provider.profileUrl].some(v=>typeof v==="string"&&v);
  const broadcasterId=providerType||hasIdentityLink?officialSupplierUserId(provider):
    /^\d{1,15}$/.test(numeric)?numeric:"";
  return {liveId:id,title,name:clean(provider.name??p.broadcasterName??p.providerName,80),
    broadcasterId,
    startedAt:time(p.schedule?.beginTime??p.beginTime??p.beginAt??p.startTime??p.startedAt),
    iconUrl:firstRankingImage(provider.icon,provider.iconUrl,provider.icons?.large,provider.icons?.small,provider.icon?.large,provider.icon?.small,provider.thumbnailUrl),
    thumbnailUrl:firstRankingImage(p.thumbnailUrl,p.thumbnail,p.thumbnail?.large,p.thumbnail?.small,p.thumbnail?.huge,p.thumbnail?.url,p.thumbnail?.middle,p.thumbnails?.large,p.thumbnails?.small),
    visitors:count(statistics.watchCount??statistics.visitorCount??p.watchCount??p.visitorCount??p.viewCounter),
    comments:count(statistics.commentCount??p.commentCount??p.commentCounter)};
}
function extractJsonRows(value) {
  const rows=[];let visited=0;
  function walk(x,depth) {
    if(depth>16||++visited>30000||rows.length>=LIMIT||!x||typeof x!=="object")return;
    if(Array.isArray(x)){for(const item of x)walk(item,depth+1);return;}
    const row=jsonRow(x);if(row){rows.push(row);return;}
    for(const key of Object.keys(x))if(!["__proto__","constructor","prototype"].includes(key))walk(x[key],depth+1);
  }
  walk(value,0);return rows;
}
function unique(rows) {
  const byId=new Map();
  for(const row of rows){
    if(!row?.liveId)continue;
    const old=byId.get(row.liveId);
    if(!old){
      if(byId.size<LIMIT)byId.set(row.liveId,{...row});
      continue;
    }
    // Keep the first listing position and existing values. Later duplicate
    // records may contain metadata omitted from the first listing.
    // Never combine user identity or artwork across conflicting identities.
    const conflict=old.broadcasterId&&row.broadcasterId&&old.broadcasterId!==row.broadcasterId;
    for(const field of ["startedAt","thumbnailUrl","visitors","comments"]){
      if((old[field]==null||old[field]==="")&&row[field]!=null&&row[field]!=="")old[field]=row[field];
    }
    if(!conflict){
      for(const field of ["name","broadcasterId","iconUrl"]){
        if(!old[field]&&row[field])old[field]=row[field];
      }
    }
  }
  return [...byId.values()];
}
function parseRankingPage(html) {
  if(typeof html!=="string"||html.length>MAX_BYTES)return [];
  const rows=[];
  for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)){
    if(/application\/(?:ld\+)?json|__NEXT_DATA__|__INITIAL_STATE__/i.test(match[1])){
      try{rows.push(...extractJsonRows(JSON.parse(match[2])));}catch{}
    }
  }
  for(const match of html.matchAll(/\bdata-props\s*=\s*(["'])([\s\S]*?)\1/gi)){
    // Decode attribute entities without stripping JSON strings or truncating.
    try{const json=match[2].replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&");rows.push(...extractJsonRows(JSON.parse(json)));}catch{}
  }
  // Structured rows define membership and rank when present. HTML may only
  // supplement images for those same IDs; navigation links cannot add rows.
  const structured=rows.length?unique(rows):null;
  const known=structured?new Map(structured.map(row=>[row.liveId,row])):null;
  // Only accept actual Nico Live watch links with a descriptive anchor title.
  // Never guess a program ID from a user ID, thumbnail or arbitrary text.
  const safeHtml=html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,"").replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi,"");
  for(const a of safeHtml.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)){
    const href=a[1].match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2];
    const id=liveId(href);
    if(!id)continue;
    const existing=known?.get(id);
    if(known&&!existing)continue;
    // A single non-icon Nico CDN image inside the exact watch link is a
    // conservative thumbnail candidate. Never attach neighboring card art.
    const images=[...a[2].matchAll(/<img\b([^>]*)>/gi)];
    const imageUrls=images.flatMap(img=>{
      const attrs=img[1];
      if(/(?:user[-_ ]?icon|avatar|profile|badge|logo|アイコン)/i.test(attrs))return [];
      const value=name=>attrs.match(new RegExp("(?:^|\\s)"+name+"\\s*=\\s*([\"'])(.*?)\\1","i"))?.[2]?.replace(/&amp;/g,"&");
      const url=firstRankingImage(value("data-src"),value("data-original"),value("src"));
      return url&&!/\/(?:usericon|user-icon|icons?)\//i.test(new URL(url).pathname)?[url]:[];
    });
    const thumbnailUrl=[...new Set(imageUrls)].length===1?imageUrls[0]:"";
    if(existing){if(!existing.thumbnailUrl&&thumbnailUrl)existing.thumbnailUrl=thumbnailUrl;continue;}
    const title=clean(a[1].match(/\b(?:title|aria-label)\s*=\s*(["'])(.*?)\1/i)?.[2]||a[2]);
    if(!title||/^(視聴|見る|開く|放送ページ|LIVE|lv\d+)$/i.test(title))continue;
    rows.push({liveId:id,title,name:"",broadcasterId:"",startedAt:"",iconUrl:"",thumbnailUrl,visitors:null,comments:null});
  }
  return structured||unique(rows);
}

function officialSupplierUserId(supplier) {
  const type=String(supplier.programProviderType??supplier.type??"").trim().toLowerCase();
  // Do not treat a channel or an official program as an individual user.
  if(type&&type!=="user")return "";
  const raw=String(supplier.programProviderId??supplier.id??"").trim();
  const numeric=/^\d{5,15}$/.test(raw)?raw:"";
  const urls=[supplier.url,supplier.pageUrl,supplier.userPageUrl,supplier.profileUrl];
  const ids=new Set();
  for(const value of urls){
    if(typeof value!=="string")continue;
    try{
      const u=new URL(value);
      if(u.protocol!=="https:"||u.username||u.password||u.port||
         !["www.nicovideo.jp","nicovideo.jp"].includes(u.hostname))continue;
      const match=/^\/user\/(\d{5,15})\/?$/.exec(u.pathname);
      if(match)ids.add(match[1]);
    }catch{}
  }
  if(ids.size>1)return "";
  const linked=ids.values().next().value||"";
  if(numeric&&linked&&numeric!==linked)return "";
  return type==="user"?(numeric||linked):linked;
}

function kickPage(payload){
 if(!Array.isArray(payload?.data))throw Error("Kick応答形式が不正");
 const entries=[];let excluded=0;
 for(const r of payload.data){const slug=typeof r?.channel?.slug==="string"?r.channel.slug.toLowerCase():"";const viewers=r?.viewer_count;if(!/^[a-z0-9_-]{1,40}$/.test(slug)||!Number.isSafeInteger(viewers)||viewers<0){excluded++;continue;}const language=typeof r.language_code==="string"?r.language_code:"";if(!language){excluded++;continue;}if(!/^ja(?:-|$)/i.test(language))continue;entries.push({id:slug,name:String(r.broadcaster_user?.username||slug).slice(0,100),title:String(r.title||"タイトルなし").slice(0,250),viewers,url:"https://kick.com/"+slug});}
 const cursor=payload.pagination?.next_cursor; if(cursor!=null&&(typeof cursor!=="string"||cursor.length>2048))throw Error("Kickページ情報が不正");
 return {entries,cursor:cursor||null,complete:cursor===null||cursor==="",excluded};
}
function rankKick(rows){const unique=new Map();for(const row of rows){if(!unique.has(row.id)||row.viewers>unique.get(row.id).viewers)unique.set(row.id,row);}return [...unique.values()].sort((a,b)=>b.viewers-a.viewers||a.id.localeCompare(b.id)).slice(0,100);}
let token=null,tokenFlight=null;
async function fetchBounded(url,options={},max=MAX_BYTES){
 const response=await fetch(url,{...options,redirect:"error",signal:AbortSignal.timeout(8000)});
 if(!response.ok)throw Error("HTTP "+response.status);
 if(Number(response.headers.get("content-length")||0)>max)throw Error("取得上限超過");
 const reader=response.body.getReader(),decoder=new TextDecoder();let total=0,out="";
 try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>max){await reader.cancel();throw Error("取得上限超過");}out+=decoder.decode(value,{stream:true});}out+=decoder.decode();return out;}finally{reader.releaseLock();}
}
async function kickToken(env){if(token&&token.expires>Date.now()+60000)return token.value;if(tokenFlight)return tokenFlight;tokenFlight=(async()=>{const data=JSON.parse(await fetchBounded("https://id.kick.com/oauth/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"client_credentials",client_id:env.KICK_CLIENT_ID,client_secret:env.KICK_CLIENT_SECRET})},65536));if(typeof data.access_token!=="string"||!Number.isFinite(data.expires_in))throw Error("Kick認証に失敗");token={value:data.access_token,expires:Date.now()+data.expires_in*1000};return token.value;})();try{return await tokenFlight;}finally{tokenFlight=null;}}
async function nicoRanking(){
 const sources=[{name:"ニコ生公式ランキング",url:"https://live.nicovideo.jp/ranking"},{name:"ちくわちゃん（掲載順）",url:"https://www.chikuwachan.com/live/NCU/"}];
 for(const source of sources){try{const html=await fetchBounded(source.url,{headers:{accept:"text/html,application/json;q=0.9"}});let rows=[];try{rows=unique(extractJsonRows(JSON.parse(html)));}catch{}if(!rows.length)rows=parseRankingPage(html);if(rows.length)return {source:source.name,sourceUrl:source.url,complete:false,metric:"掲載順（順位は参考）",fetchedAt:new Date().toISOString(),entries:rows.slice(0,100).map(r=>({id:r.liveId,name:r.name,title:r.title,url:"https://live.nicovideo.jp/watch/"+r.liveId,visitors:r.visitors,comments:r.comments}))};}catch{}}
 throw Error("ニコ生の公開ページから番組情報を取得できません");
}
async function kickRanking(env){
 if(!env.KICK_CLIENT_ID||!env.KICK_CLIENT_SECRET)return {status:"unconfigured",message:"Kick公式APIの認証設定が必要です。",entries:[]};
 const access=await kickToken(env);let cursor=null,complete=false,excluded=0;const seen=new Set(),rows=[];
 for(let page=0;page<3;page++){const url=new URL("https://api.kick.com/public/v2/livestreams");url.searchParams.set("limit","1000");url.searchParams.set("language_code","ja");if(cursor)url.searchParams.set("cursor",cursor);
 const result=kickPage(JSON.parse(await fetchBounded(url,{headers:{authorization:"Bearer "+access,accept:"application/json"}})));rows.push(...result.entries);excluded+=result.excluded;cursor=result.cursor;if(!cursor){complete=result.complete;break;}if(seen.has(cursor))break;seen.add(cursor);}
 return {source:"Kick公式API",sourceUrl:"https://kick.com/",complete:complete&&excluded===0,metric:"日本語配信・同時視聴者数順",fetchedAt:new Date().toISOString(),entries:rankKick(rows)};
}
function json(value,status=200,cache="no-store"){return new Response(JSON.stringify(value),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":cache,"x-content-type-options":"nosniff"}});}
const flights=new Map();
export default {async fetch(request,env,ctx){
 const url=new URL(request.url),match=/^\/api\/rankings\/(nico|kick)$/.exec(url.pathname);
 if(!match)return env.ASSETS.fetch(request);
 if(request.method!=="GET")return json({status:"error",message:"GETのみ対応"},405);
 const type=match[1],key=new Request(url.origin+url.pathname);
 try{const cached=await caches.default.match(key);if(cached)return cached;}catch{}
 if(!flights.has(type)){const promise=(async()=>{try{const data=type==="nico"?await nicoRanking():await kickRanking(env);if(data.status==="unconfigured")return json(data);const response=json({status:"ok",...data},200,"public, max-age=60");try{await caches.default.put(key,response.clone());}catch{}return response;}catch{return json({status:"error",message:type==="nico"?"ニコ生データ取得に失敗しました。":"Kickデータ取得に失敗しました。",entries:[]},502);}})();flights.set(type,promise);promise.finally(()=>flights.delete(type));}
 return (await flights.get(type)).clone();
}};
