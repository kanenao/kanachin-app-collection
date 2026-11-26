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
    const u=new URL(value.startsWith("//")?"https:"+value:value);
    if(u.protocol!=="https:"||u.username||u.password||u.port||
       !(u.hostname==="nimg.jp"||u.hostname.endsWith(".nimg.jp")||u.hostname==="simg.jp"||u.hostname.endsWith(".simg.jp")))return "";
    return u.href;
  }catch{return "";}
}
function firstRankingImage(...values){
  for(const value of values){const url=rankingImageUrl(value);if(url)return url;}
  return "";
}
function points(v){
  if(typeof v==="string"&&/^\d{1,12}$/.test(v))v=Number(v);
  return Number.isSafeInteger(v)&&v>=0&&v<=999999999999?v:null;
}
function readContributionStatistics(data){
  const value=data?.statistics??data?.stats??data??{};
  const adPoints=points(value.adPoints??value.totalAdPoints??value.totalNicoadPoints??data?.totalNicoadPoints??data?.totalAdPoints??data?.adPoints);
  const giftPoints=points(value.giftPoints??value.totalGiftPoints??data?.totalGiftPoints??data?.giftPoints);
  return {adPoints,giftPoints};
}

function programThumbnailCandidates(p={},raw={}){
  const values=[];
  for(const obj of [p,raw]){
    if(!obj||typeof obj!=="object")continue;
    for(const item of [obj.screenshot?.urlSet,obj.screenshot?.urls,obj.screenshot,obj.thumbnail,obj.thumbnails,obj.thumbnailUrlSet,obj.thumbnailUrls]){
      if(typeof item==="string"){values.push(item);continue;}
      if(!item||typeof item!=="object")continue;
      for(const k of ["large","huge","middle","small","normal","url","uri","uri640x360","uri320x180","uri160x90"]){
        const v=item[k];values.push(typeof v==="object"&&v?v.url??v.uri:v);
      }
    }
    values.push(obj.thumbnailUrl,obj.screenshotUrl);
  }
  return [...new Set(values.map(rankingImageUrl).filter(url=>url&&!/\/(?:usericon|user-icon|icons?)\//i.test(new URL(url).pathname)))].slice(0,8);
}

function jsonRow(raw) {
  if(!raw||typeof raw!=="object"||Array.isArray(raw)) return null;
  const p=raw.program&&typeof raw.program==="object"?raw.program:raw;
  const id=liveId(p.liveId??p.programId??p.nicoliveProgramId??p.contentId??p.id?.value??p.id??p.watchPageUrl??p.watchUrl??raw.id?.value??raw.id);
  const title=clean(p.title??p.programTitle);
  if(!id||!title)return null;
  const status=String(p.schedule?.status??p.liveStatus??p.status??"").toUpperCase();
  if(status&&!["ON_AIR","ONAIR","LIVE","ON AIR"].includes(status))return null;
  if(p.isOnAir===false)return null;
  const provider=p.programProvider??p.provider??p.supplier??raw.programProvider??raw.provider??raw.supplier??{};
  const statistics=p.statistics??p.stats??raw.statistics??raw.stats??{};
  const providerType=String(provider.programProviderType??provider.supplierType??provider.type??"").trim().toLowerCase();
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
    thumbnailUrl:programThumbnailCandidates(p,raw)[0]||"",thumbnailCandidates:programThumbnailCandidates(p,raw),
    visitors:count(statistics.watchCount??statistics.visitorCount??p.watchCount??p.visitorCount??p.viewCounter),
    comments:count(statistics.commentCount??p.commentCount??p.commentCounter),
    advertising:readContributionStatistics({...raw,...p,statistics}).adPoints??count(statistics.advertisingPoint??statistics.advertisementPoint??statistics.nicoadPoint??p.advertisingPoint??p.nicoadPoint),
    gift:readContributionStatistics({...raw,...p,statistics}).giftPoints??count(statistics.giftPoint??statistics.totalGiftPoint??p.giftPoint??p.totalGiftPoint)};
}
function labeledNicoMetrics(block){
 const text=String(block).replace(/<a\b[^>]*>[\s\S]*?<\/a\s*>/gi," ").replace(/<[^>]*>/g," ").replace(/&nbsp;|&#160;/gi," ").replace(/\s+/g," ").trim();
 const metric=(label)=>{const re=new RegExp("(?:"+label+")\\s*[:：]?\\s*(\\d{1,3}(?:,\\d{3})+|\\d{1,12})(?![\\d,])","gu");const vals=[...text.matchAll(re)].map(m=>Number(m[1].replace(/,/g,"")));return vals.length===1&&Number.isSafeInteger(vals[0])?vals[0]:null;};
 const durations=[...text.matchAll(/(?:^|\s)((?:\d+日\s*)?(?:\d+時間\s*)?\d+分)(?=\s|$)/g)];
 return {visitors:metric("👨‍👨‍👦(?:‍👦)?|来場者(?:数)?"),comments:metric("💬|コメント(?:数)?"),gift:metric("🎁|ギフト(?:ポイント|pt)?"),advertising:metric("ニコニ広告(?:ポイント|pt)?|広告(?:ポイント|pt)"),duration:durations.length===1?durations[0][1].replace(/\s+/g,""):""};
}
function parseNicoRanCards(html){
 if(typeof html!=="string"||html.length>6*1024*1024)return [];
 const safe=html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>|<!--[\s\S]*?-->/gi,"");
 const anchors=[...safe.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)].map(a=>{const href=a[1].match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2]||"";return {id:/^(?:https:\/\/live\.nicovideo\.jp)?\/watch\/(lv\d{5,15})\/?(?:[?#][^\s]*)?$/i.exec(href)?.[1].toLowerCase(),viewer:/^(?:https:\/\/nico-ran\.stream)?\/?viewer\.html\?lv=(lv\d{5,15})(?:&[^"']*)?$/i.exec(href)?.[1].toLowerCase(),start:a.index,end:a.index+a[0].length,raw:a[2]};});
 const rows=[],seen=new Set();
 const plain=s=>s.replace(/<[^>]*>/g," ").replace(/&nbsp;|&#160;/gi," ").replace(/\s+/g," ").trim();
 for(let i=0;i<anchors.length&&rows.length<200;i++){
  const a=anchors[i];if(!a.viewer||seen.has(a.viewer))continue;
  // A card's viewer link must match its immediately preceding watch link.
  // Event and top-three cards have no comment-viewer link and cannot contribute.
  let title=null;for(let j=i-1;j>=0;j--){if(anchors[j].viewer)break;if(anchors[j].id){if(anchors[j].id===a.viewer)title=anchors[j];break;}}
  if(!title)continue;
  let next=safe.length;for(let j=i+1;j<anchors.length;j++)if(anchors[j].id||anchors[j].viewer){next=anchors[j].start;break;}
  if(next-a.end>16000)continue;
  const block=plain(safe.slice(a.end,next));
  const metric=(label,points=false)=>{const re=new RegExp("(?:^|\\s)"+label+"\\s*[:：]?\\s*(\\d{1,3}(?:,\\d{3})+|\\d{1,12})(?![\\d,])"+(points?"\\s*(?:pt|ポイント)(?=\\s|$)":"(?=\\s|$)"),"gi");const values=[...block.matchAll(re)].map(m=>Number(m[1].replace(/,/g,"")));return values.length===1&&Number.isSafeInteger(values[0])?values[0]:null;};
  const visitors=metric("来場者(?:数)?"),comments=metric("コメント(?:数)?");if(visitors===null||comments===null)continue;
  const name=plain(title.raw).slice(0,240);if(!name)continue;
  const active=[...block.matchAll(/(?:^|\s)アクティブ(?:人数)?\s*[:：]?\s*(\d{1,3}(?:,\d{3})+|\d{1,12})\s*人\s*\/\s*10分(?=\s|$)/g)];const active10m=active.length===1?count(active[0][1]):null;
  seen.add(a.viewer);rows.push({liveId:a.viewer,title:name,visitors,comments,active10m,advertising:metric("(?:ニコニ)?広告(?:pt|ポイント)?",true),gift:metric("ギフト(?:（累計pt）|ポイント|pt)?",true)});
 }
 return rows;
}
function supplementNicoHtml(html,rows){
 const safe=String(html).replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>/gi,"");
 const known=new Map(rows.map(r=>[r.liveId,r]));
 const anchors=[];
 for(const a of safe.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)){
  const href=a[1].match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2]||"";
  const id=/^(?:https:\/\/live\.nicovideo\.jp)?\/watch\/(lv\d{5,15})\/?(?:[?#][^\s]*)?$/i.exec(href)?.[1].toLowerCase();
  if(id)anchors.push({id,start:a.index,end:a.index+a[0].length});
 }
 for(let i=0;i<anchors.length;i++){
  const a=anchors[i],row=known.get(a.id);if(!row)continue;
  const next=anchors[i+1];if(!next||next.id===a.id||next.start-a.end>10000)continue;
  const block=safe.slice(a.end,next.start);
  // Require a source-specific pair of counters before attaching any data.
  const fields=labeledNicoMetrics(block);
  if(fields.visitors===null||fields.comments===null)continue;
  for(const key of ["visitors","comments","gift","advertising","duration"])if((row[key]==null||row[key]==="")&&fields[key]!=null&&fields[key]!=="")row[key]=fields[key];
 }
 return rows;
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
    old.thumbnailCandidates=[...new Set([...(old.thumbnailCandidates||[]),old.thumbnailUrl,...(row.thumbnailCandidates||[]),row.thumbnailUrl].filter(Boolean))].slice(0,8);
    for(const field of ["startedAt","thumbnailUrl","visitors","comments","advertising","gift","duration"]){
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
  const type=String(supplier.programProviderType??supplier.supplierType??supplier.type??"").trim().toLowerCase();
  // Do not treat a channel or an official program as an individual user.
  if(type&&type!=="user")return "";
  const raw=String(supplier.programProviderId??supplier.supplierId??supplier.id??"").trim();
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

function kickImage(value){
 if(typeof value!=="string"||value.length>2048)return "";
 return /^https:\/\/(?:[a-z0-9-]+\.)*kick\.com\/[^\s<>\\]+$/i.test(value)?value:"";
}
function kickPage(payload){
 if(!Array.isArray(payload?.data))throw Error("Kick応答形式が不正");
 const entries=[];let excluded=0;
 for(const r of payload.data){const slug=typeof r?.channel?.slug==="string"?r.channel.slug.toLowerCase():"";const viewers=r?.viewer_count;if(!/^[a-z0-9_-]{1,40}$/.test(slug)||!Number.isSafeInteger(viewers)||viewers<0){excluded++;continue;}const language=typeof r.language_code==="string"?r.language_code:"";if(!language){excluded++;continue;}if(!/^ja(?:-|$)/i.test(language))continue;entries.push({id:slug,name:String(r.broadcaster_user?.username||slug).slice(0,100),title:String(r.title||"タイトルなし").slice(0,250),viewers,thumbnail:kickImage(r.thumbnail),startedAt:typeof r.started_at==="string"?r.started_at:"",url:"https://kick.com/"+slug});}
 const cursor=payload.pagination?.next_cursor; if(cursor!=null&&(typeof cursor!=="string"||cursor.length>2048))throw Error("Kickページ情報が不正");
 return {entries,cursor:cursor||null,complete:cursor===null||cursor==="",excluded};
}
function rankKick(rows){const unique=new Map();for(const row of rows){if(!unique.has(row.id)||row.viewers>unique.get(row.id).viewers)unique.set(row.id,row);}return [...unique.values()].sort((a,b)=>b.viewers-a.viewers||a.id.localeCompare(b.id)).slice(0,10);}
let token=null;
async function fetchBounded(url,options={},max=MAX_BYTES){
 const signal=AbortSignal.timeout(9000);
 let target=new URL(url),response;
 for(let i=0;i<3;i++){
  response=await fetch(target,{...options,redirect:"manual",signal});
  if(![301,302,303,307,308].includes(response.status))break;
  const location=response.headers.get("location");if(!location)throw Error("HTTP "+response.status);
  const next=new URL(location,target);
  const publicHosts=["www.chikuwachan.com","chikuwachan.com","nico-ran.stream","www.nicoran.stream","live.nicovideo.jp","ikioi-ranking.com","www.ikioi-ranking.com"];
  if(options.method==="POST"||options.headers?.authorization||next.protocol!=="https:"||next.username||next.password||next.port||!publicHosts.includes(next.hostname)||!publicHosts.includes(target.hostname))throw Error("HTTP "+response.status);
  if(response.body)await response.body.cancel();target=next;
 }
 if([301,302,303,307,308].includes(response.status))throw Error("HTTP "+response.status);
 if(!response.ok)throw Error("HTTP "+response.status);
 if(Number(response.headers.get("content-length")||0)>max)throw Error("取得上限超過");
 const reader=response.body.getReader(),decoder=new TextDecoder();let total=0,out="";
 try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>max){await reader.cancel();throw Error("取得上限超過");}out+=decoder.decode(value,{stream:true});}out+=decoder.decode();return out;}finally{reader.releaseLock();}
}
async function kickToken(env){
 if(token&&token.expires>Date.now()+60000)return token.value;
 const data=JSON.parse(await fetchBounded("https://id.kick.com/oauth/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"client_credentials",client_id:env.KICK_CLIENT_ID,client_secret:env.KICK_CLIENT_SECRET})},65536));
 if(typeof data.access_token!=="string"||!Number.isFinite(data.expires_in))throw Error("Kick認証に失敗");
 token={value:data.access_token,expires:Date.now()+data.expires_in*1000};return token.value;
}
function parseKickPublic(html){
 const sanitized=String(html).replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>/gi,"");
 const anchors=[...sanitized.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)].filter(a=>/^https:\/\/(?:www\.)?kick\.com\/[a-z0-9_-]{1,40}\/?(?:[?#][^\s]*)?$/i.test(a[1].match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2]||""));
 const plain=s=>s.replace(/<[^>]*>/g," ").replace(/&amp;/g,"&").replace(/&nbsp;|&#160;/g," ").replace(/\s+/g," ").trim();
 const rows=[],seen=new Set();
 for(let i=0;i<anchors.length&&rows.length<100;i++){
  const a=anchors[i],href=a[1].match(/\bhref\s*=\s*(["'])(.*?)\1/i)[2],id=/^https:\/\/(?:www\.)?kick\.com\/([a-z0-9_-]{1,40})/i.exec(href)[1].toLowerCase();
  if(seen.has(id)||["categories","browse","login","signup","settings","search","about","terms","privacy"].includes(id))continue;
  const tail=sanitized.slice(a.index+a[0].length,Math.min(anchors[i+1]?.index??sanitized.length,a.index+a[0].length+5000));
  const block=a[2]+" "+tail;
  const imageIds=[...block.matchAll(/<img\b[^>]*\balt\s*=\s*(["'])KCK_([a-z0-9_-]{1,40})\1/gi)].map(m=>m[2].toLowerCase());
  if(!imageIds.includes(id)||imageIds.some(x=>x!==id))continue;
  const metrics=plain(block),values=[...metrics.matchAll(/(?:^|\s)(\d{1,3}(?:,\d{3})+|\d{1,10})\s*viewers\b/gi)];
  const viewers=values.length===1?Number(values[0][1].replace(/,/g,"")):null;
  const durations=[...metrics.matchAll(/(?:\d+日\s*)?(?:\d+時間\s*)?\d+分/g)];
  const title=plain(a[1].match(/\b(?:title|aria-label)\s*=\s*(["'])(.*?)\1/i)?.[2]||a[2]).slice(0,250);
  seen.add(id);rows.push({id,name:id,title:title||id,viewers,duration:durations.length===1?durations[0][0]:""});
 }
 return rows;
}
function diagnostic(error){const msg=String(error?.message||"");return /^HTTP \d{3}$/.test(msg)?msg:error?.name==="TimeoutError"||error?.name==="AbortError"?"タイムアウト":msg==="取得上限超過"?"応答サイズ上限":"通信・形式エラー";}
async function publicKickRanking(reason){
 try{const url="https://ikioi-ranking.com/v/kick";const rows=parseArchiveRanking(await fetchBounded(url,{headers:{accept:"text/html"}}),"kick");if(rows.length)return {source:"勢いランキング・Kick",sourceUrl:url,complete:false,metric:"公開データ・参考同時視聴者数順",fetchedAt:new Date().toISOString(),entries:rankKick(rows),notice:reason};}catch{}

 const url="https://www.chikuwachan.com/live/KCK/";
 try{const rows=parseKickPublic(await fetchBounded(url,{headers:{accept:"text/html"}}));if(rows.length)return {source:"ちくわちゃん・Kick",sourceUrl:url,complete:false,metric:"参考掲載順・日本語判定未確認",fetchedAt:new Date().toISOString(),entries:rows.slice(0,10),notice:reason};return {status:"unconfigured",message:reason+"／公開ページの番組リンクも取得できません。",entries:[]};}catch(e){return {status:"unconfigured",message:reason+"／予備取得先: "+diagnostic(e),entries:[]};}
}

// Read only public, matching program data. Do not connect to watch/chat sockets.
function publicNicoDetail(html,id){
 for(const tag of String(html||"").matchAll(/<[^>]+\bid\s*=\s*(["'])embedded-data\1[^>]*>/gi)){
  const attr=tag[0].match(/\bdata-props\s*=\s*(["'])([\s\S]*?)\1/i)?.[2];if(!attr)continue;
  try{const data=JSON.parse(attr.replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&"));
   const p=data?.program;if(!p||liveId(p.nicoliveProgramId??p.programId??p.liveId??p.id?.value??p.id)!==id)continue;
   const status=String(p.schedule?.status??p.liveStatus??p.status??"").toUpperCase();if(status&&!["ON_AIR","ONAIR","LIVE","ON AIR"].includes(status))continue;
   const stats=p.statistics??p.stats??{},v=readContributionStatistics(p),images=programThumbnailCandidates(p,data);
   return {advertising:v.adPoints,gift:v.giftPoints,visitors:count(stats.watchCount??stats.visitorCount??p.watchCount),comments:count(stats.commentCount??p.commentCount),startedAt:time(p.schedule?.beginTime??p.beginTime??p.beginAt),thumbnailUrl:images[0]||"",thumbnailCandidates:images};
  }catch{}
 }
 return null;
}
// Bounded lookups with per-program Cache API entries. No shared I/O promises.
async function enrichPublicNico(rows,origin){
 const candidates=rows.slice(0,10).filter(r=>!r.thumbnailUrl||r.advertising==null||r.gift==null||!r.startedAt);
 const missing=[];
 function apply(row,detail){if(!detail)return;for(const k of ["advertising","gift","visitors","comments","startedAt","thumbnailUrl"])if((row[k]==null||row[k]==="")&&detail[k]!=null&&detail[k]!=="")row[k]=detail[k];row.thumbnailCandidates=[...new Set([row.thumbnailUrl,...(row.thumbnailCandidates||[]),...(detail.thumbnailCandidates||[])].filter(Boolean))].slice(0,8);}
 for(const row of candidates){const key=new Request(origin+"/__cache/nico-detail/"+row.liveId+"?r16");try{const cached=await caches.default.match(key);if(cached){apply(row,await cached.json());continue;}}catch{}missing.push({row,key});}
 await Promise.all(missing.slice(0,3).map(async({row,key})=>{let detail=null;try{detail=publicNicoDetail(await fetchBounded("https://live.nicovideo.jp/watch/"+row.liveId,{headers:{accept:"text/html"}}),row.liveId);}catch{}apply(row,detail);try{await caches.default.put(key,json(detail,200,"public, max-age=120"));}catch{}}));
}

function parseArchiveRanking(html,service){
 // Adapted from worker/index.mjs: rankingEntries + rank in the supplied archive.
 const root={links:new Set()},entries=[];let node=root;
 const source=String(html).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,"");
 for(const [token] of source.matchAll(/<!--[^]*?-->|<(?:[^>"']|"[^"]*"|'[^']*')+>|[^<]+/g)){
  if(token.startsWith("<!--")||token.startsWith("<!"))continue;
  const tag=token.match(/^<(\/?)([a-z][\w-]*)/i);
  if(!tag){for(const part of token.split("\n")){const text=part.trim().replaceAll("&amp;","&").replaceAll("&quot;",'"').replaceAll("&#39;","'").replaceAll("&nbsp;"," ").trim();if(text)entries.push({text,node});}continue;}
  const name=tag[2].toLowerCase();
  if(tag[1]){let end=node;while(end.parent&&end.name!==name)end=end.parent;if(end.parent)node=end.parent;continue;}
  const child={name,parent:node,links:new Set()};
  const attrs=token.replace(/%2f/ig,"/").replace(/%3a/ig,":");
  const id=service==="nico"?attrs.match(/\blv(\d{5,15})\b/i)?.[1]:attrs.match(/(?:https?:)?\/\/(?:www\.)?kick\.com\/([a-z0-9_-]{1,40})(?=[/?#"'&\s]|$)/i)?.[1];
  if(id){const key=service==="nico"?"lv"+id:id.toLowerCase();for(let p=child;p;p=p.parent)p.links.add(key);}
  if(name==="img"){
   const image=(attrs.match(/\s(?:data-src|data-original)\s*=\s*["']([^"']+)["']/i)?.[1]||attrs.match(/\ssrc\s*=\s*["']([^"']+)["']/i)?.[1]||"").replaceAll("&amp;","&");
   const url=image.startsWith("//")?"https:"+image:image;
   const trusted=service==="nico"?/^https:\/\/(?:[a-z0-9-]+\.)*(?:nimg|simg)\.jp\/[^\s<>\\]+$/i.test(url):/^https:\/\/(?:images|files)\.kick\.com\/[^\s<>\\]+$/i.test(url);
   if(trusted&&!/profile|avatar|banner|usericon|channel-icon/i.test(url))for(let p=child;p&&!p.thumbnail;p=p.parent)p.thumbnail=url;
  }
  if(!/^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/.test(name)&&!token.endsWith("/>"))node=child;
 }
 const unit=service==="nico"?"ポイント":"人視聴中",pattern=new RegExp("^([0-9,]+)\\s*"+unit+"$"),seen=new Set(),rows=[];
 for(let i=2;i<entries.length&&rows.length<200;i++){
  const separate=entries[i].text===unit,m=pattern.exec(separate?entries[i-1].text+unit:entries[i].text);if(!m)continue;
  const at=separate?i-1:i,title=entries[at-2],channel=entries[at-1];if(!title||!channel)continue;
  const value=Number(m[1].replaceAll(",",""));if(!Number.isSafeInteger(value)||value<0)continue;
  let box=title.node;while(box&&!box.links.size)box=box.parent;
  if(!box||box.links.size!==1)continue;
  const id=[...box.links][0];if(seen.has(id)||service==="kick"&&["categories","browse","login","signup","settings","search","about","terms","privacy"].includes(id))continue;
  // Require title, channel and value to share a container with exactly one broadcast.
  let card=title.node;const includes=(outer,inner)=>{for(let p=inner;p;p=p.parent)if(p===outer)return true;return false;};
  while(card&&(!includes(card,channel.node)||!includes(card,entries[i].node)||!card.links.size))card=card.parent;
  if(!card||card===root||card.links.size!==1||!card.links.has(id))continue;
  seen.add(id);
  const image=card.thumbnail||box.thumbnail||"";
  rows.push(service==="nico"?{liveId:id,title:title.text.slice(0,240),name:channel.text.slice(0,80),momentum:value,thumbnailUrl:image}:{id,title:title.text.slice(0,250),name:channel.text.slice(0,100),viewers:value,thumbnail:image,url:"https://kick.com/"+id});
 }
 return rows;
}
function parseArchiveRss(xml){
 const images=new Map();
 for(const [item] of String(xml).matchAll(/<item\b[^>]*>[\s\S]*?<\/item>/gi)){
  const id=item.match(/<link>[^<]*?\b(lv\d{5,15})\b/i)?.[1];
  const url=item.match(/<media:thumbnail\b[^>]*?\burl=["'](https:\/\/[^"']+)["']/i)?.[1]?.replaceAll("&amp;","&");
  if(id&&url&&/^https:\/\/(?:[a-z0-9-]+\.)*(?:nimg|simg)\.jp\/[^\s<>\\]+$/i.test(url))images.set(id,url);
 }
 return images;
}
async function nicoRanking(origin){
 const rssRequest=fetchBounded("https://live.nicovideo.jp/recent/rss?tab=live",{headers:{accept:"application/rss+xml,application/xml"}},2*1024*1024).then(parseArchiveRss).catch(()=>new Map());
 const sources=[{name:"勢いランキング",url:"https://ikioi-ranking.com/v/nico"},{name:"ちくわちゃん",url:"https://www.chikuwachan.com/live/NCU/"},{name:"nico-ran.stream",url:"https://nico-ran.stream/"},{name:"ニコ生公式ランキング",url:"https://live.nicovideo.jp/ranking"}];
 const results=await Promise.all(sources.map(async source=>{try{const html=await fetchBounded(source.url,{headers:{accept:"text/html,application/json;q=0.9"}});let rows=[];if(source.name==="勢いランキング")rows=parseArchiveRanking(html,"nico");else{try{rows=unique(extractJsonRows(JSON.parse(html)));}catch{}if(!rows.length)rows=parseRankingPage(html);}if(source.name==="ちくわちゃん")supplementNicoHtml(html,rows);if(source.name==="nico-ran.stream"){const cards=parseNicoRanCards(html);if(cards.length){const map=new Map(rows.map(r=>[r.liveId,r]));rows=cards.map(card=>{const r=map.get(card.liveId)||{};return {...r,...card,advertising:card.advertising??r.advertising??null,gift:card.gift??r.gift??null};});}}return {source,rows,reason:rows.length?"":"番組データなし"};}catch(e){return {source,rows:[],reason:diagnostic(e)};}}));
 const best=results.find(r=>r.rows.length);if(best){const preferred=results.find(r=>r.source.name==="nico-ran.stream");if(preferred){const map=new Map(preferred.rows.map(r=>[r.liveId,r]));for(const row of best.rows){const other=map.get(row.liveId);if(other){for(const k of ["advertising","gift","active10m"])if(other[k]!=null)row[k]=other[k];}}}}if(best)for(const result of results){if(result!==best){const lookup=new Map(result.rows.map(r=>[r.liveId,r]));for(const row of best.rows){const other=lookup.get(row.liveId);if(!other)continue;for(const k of ["name","visitors","comments","gift","advertising","startedAt","duration","thumbnailUrl","active10m","momentum"])if((row[k]==null||row[k]==="")&&other[k]!=null&&other[k]!=="")row[k]=other[k];}}}
 const rss=await rssRequest;if(best){for(const row of best.rows.slice(0,10)){const image=rankingImageUrl(rss.get(row.liveId));if(image){row.thumbnailCandidates=[...new Set([row.thumbnailUrl,...(row.thumbnailCandidates||[]),image].filter(Boolean))].slice(0,8);if(!row.thumbnailUrl)row.thumbnailUrl=image;}}await enrichPublicNico(best.rows,origin);}
 if(best)return {source:best.source.name,sourceUrl:best.source.url,complete:false,metric:"掲載順（順位は参考）",fetchedAt:new Date().toISOString(),entries:best.rows.slice(0,10).map(r=>({id:r.liveId,name:r.name,title:r.title,url:"https://live.nicovideo.jp/watch/"+r.liveId,momentum:r.momentum??null,visitors:r.visitors??null,comments:r.comments??null,active10m:r.active10m??null,advertising:r.advertising??null,gift:r.gift??null,duration:r.duration||'',startedAt:r.startedAt,thumbnail:r.thumbnailUrl,thumbnailCandidates:r.thumbnailCandidates||[]}))};
 const diagnostics=results.map(r=>r.source.name+": "+r.reason);
 return {status:"error",message:"ニコ生取得失敗（"+diagnostics.join("／")+"）",entries:[]};
}
async function kickRanking(env){
 if(!env.KICK_CLIENT_ID||!env.KICK_CLIENT_SECRET)return publicKickRanking("Kick公式API認証未設定");
 const access=await kickToken(env);let cursor=null,complete=false,excluded=0;const seen=new Set(),rows=[];
 for(let page=0;page<3;page++){const url=new URL("https://api.kick.com/public/v2/livestreams");url.searchParams.set("limit","1000");url.searchParams.set("language_code","ja");if(cursor)url.searchParams.set("cursor",cursor);
 const result=kickPage(JSON.parse(await fetchBounded(url,{headers:{authorization:"Bearer "+access,accept:"application/json"}})));rows.push(...result.entries);excluded+=result.excluded;cursor=result.cursor;if(!cursor){complete=result.complete;break;}if(seen.has(cursor))break;seen.add(cursor);}
 return {source:"Kick公式API",sourceUrl:"https://kick.com/",complete:complete&&excluded===0,metric:"日本語配信・同時視聴者数順",fetchedAt:new Date().toISOString(),entries:rankKick(rows)};
}
function json(value,status=200,cache="no-store"){return new Response(JSON.stringify(value),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":cache,"x-content-type-options":"nosniff"}});}
export default {async fetch(request,env,ctx){
 const url=new URL(request.url),match=/^\/api\/rankings\/(nico|kick)$/.exec(url.pathname);
 if(url.pathname==="/api/health")return json({status:"ok",revision:"2026.11.26-r19",kickConfigured:!!(env.KICK_CLIENT_ID&&env.KICK_CLIENT_SECRET)});
 if(url.pathname==="/embed/rankings"||url.pathname==="/embed/rankings/"){const assetUrl=new URL("/",url);return env.ASSETS.fetch(new Request(assetUrl,request));}
 if(!match)return url.pathname.startsWith("/api/")?json({status:"error",message:"APIが見つかりません"},404):env.ASSETS.fetch(request);
 if(request.method!=="GET")return json({status:"error",message:"GETのみ対応"},405);
 const type=match[1],key=new Request(url.origin+url.pathname+"?revision=r19");
 try{const cached=await caches.default.match(key);if(cached)return cached;}catch{}
 try{
  const data=type==="nico"?await nicoRanking(url.origin):await kickRanking(env).catch(e=>publicKickRanking("Kick公式API: "+diagnostic(e)));
  const ok=!data.status||data.status==="ok";
  const response=json(ok?{status:"ok",...data}:data,data.status==="error"?502:200,ok?"public, max-age=10":"no-store");
  if(ok){try{await caches.default.put(key,response.clone());}catch{}}
  return response;
 }catch(e){return json({status:"error",message:(type==="nico"?"ニコ生":"Kick")+"取得失敗: "+diagnostic(e),entries:[]},502);}
}};
