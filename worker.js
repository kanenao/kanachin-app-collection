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
    for(const item of [obj.thumbnail?.screenshot?.urlSet,obj.thumbnail?.screenshot?.urls,obj.thumbnail?.screenshot,obj.screenshot?.urlSet,obj.screenshot?.urls,obj.screenshot,obj.thumbnail,obj.thumbnails,obj.thumbnailUrlSet,obj.thumbnailUrls]){
      if(typeof item==="string"){values.push(item);continue;}
      if(!item||typeof item!=="object")continue;
      for(const k of ["large","huge","middle","small","normal","url","uri","src","uri640x360","uri320x180","uri160x90"]){
        const v=item[k];values.push(typeof v==="object"&&v?v.url??v.uri??v.src:v);
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
    broadcasterId,profileUrl:nicoProfile({...p,supplier:provider}),
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
function parseNicoPublicMetrics(text){
 const s=String(text).replace(/<[^>]*>/g," ").replace(/&nbsp;|&#160;|&#xA0;/gi," ").replace(/[\s\u3000]+/g," ").trim();
 const value=(label,unit)=>{const re=new RegExp("(?:^|\\s)"+label+"\\s*[:：]?\\s*([0-9][0-9,]{0,15})\\s*"+unit+"(?=\\s|$)","gi");const a=[...s.matchAll(re)].map(m=>Number(m[1].replace(/,/g,"")));return a.length===1&&Number.isSafeInteger(a[0])&&a[0]>=0&&a[0]<=999999999999?a[0]:null;};
 return {advertising:value("(?:ニコニ)?広告(?:\\s*(?:累計|ポイント|pt))?","(?:pt|ポイント)"),gift:value("ギフト(?:\\s*(?:累計|ポイント|pt)|（累計pt）)?","(?:pt|ポイント)"),active10m:value("アクティブ(?:人数)?(?:\\s*[（(]10分[）)])?","人\\s*[/／]\\s*10\\s*分")??value("アクティブ(?:人数)?\\s*[（(](?:直近)?10分[）)]","人")};
}
function nicoProfilePath(url){
 if(typeof url!=="string")return "";
 const m=/^https:\/\/(?:www\.)?nicovideo\.jp\/user\/([1-9]\d{0,14})\/?(?:[?#][^\s]*)?$/i.exec(url.trim());
 return m?"https://www.nicovideo.jp/user/"+m[1]:"";
}
function nicoProfile(p){
 const s=p?.supplier??p?.programProvider??p?.provider??{};
 const type=String(s.programProviderType??s.supplierType??s.type??p?.providerType??"").toLowerCase();
 if(type&&type!=="user")return "";
 const paths=[...new Set([s.pageUrl,s.url,s.userPageUrl,s.profileUrl].map(nicoProfilePath).filter(Boolean))];
 const id=String(s.programProviderId??s.supplierId??s.id??"");
 const numeric=/^[1-9]\d{0,14}$/.test(id)?"https://www.nicovideo.jp/user/"+id:"";
 if(paths.length>1||(paths.length===1&&numeric&&paths[0]!==numeric))return "";
 return paths[0]||(type==="user"?numeric:"");
}
function parseNicoRanCards(html){
 if(typeof html!=="string"||html.length>6*1024*1024)return [];
 const safe=html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>|<!--[\s\S]*?-->/gi,"");
 const anchors=[...safe.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)].map(a=>{const href=a[1].match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2]||"";return {id:/^(?:https:\/\/live\.nicovideo\.jp)?\/watch\/(lv\d{5,15})\/?(?:[?#][^\s]*)?$/i.exec(href)?.[1].toLowerCase(),viewer:/^(?:https:\/\/nico-ran\.stream)?\/?viewer\.html\?lv=(lv\d{5,15})(?:&[^"']*)?$/i.exec(href)?.[1].toLowerCase(),start:a.index,end:a.index+a[0].length,raw:a[2],href};});
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
  const visitors=metric("来場者(?:数)?"),comments=metric("コメント(?:数)?");
  const name=plain(title.raw).slice(0,240);if(!name)continue;
  const active=[...block.matchAll(/(?:^|\s)アクティブ(?:人数)?\s*[:：]?\s*(\d{1,3}(?:,\d{3})+|\d{1,12})\s*人\s*\/\s*10分(?=\s|$)/g)];const active10m=active.length===1?count(active[0][1]):null;
  const values=parseNicoPublicMetrics(block);const profileLinks=anchors.filter(x=>x.start>=title.end&&x.end<=a.start&&nicoProfilePath(x.href));const profiles=[...new Set(profileLinks.map(x=>nicoProfilePath(x.href)))];const broadcaster=profiles.length===1?plain(profileLinks[0].raw).slice(0,80):"";
  if(visitors==null&&comments==null&&values.advertising==null&&values.gift==null&&values.active10m==null)continue;
  seen.add(a.viewer);rows.push({liveId:a.viewer,title:name,name:broadcaster,visitors,comments,active10m:values.active10m??active10m,advertising:values.advertising,gift:values.gift,profileUrl:profiles.length===1?profiles[0]:""});
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
 for(const r of payload.data){const slug=typeof r?.channel?.slug==="string"?r.channel.slug.toLowerCase():"";const viewers=r?.viewer_count;if(!/^[a-z0-9_-]{1,40}$/.test(slug)||!Number.isSafeInteger(viewers)||viewers<0){excluded++;continue;}const language=typeof r.language_code==="string"?r.language_code:"";if(!language){excluded++;continue;}if(!/^ja(?:-|$)/i.test(language))continue;entries.push({id:slug,name:String(r.broadcaster_user?.username||slug).slice(0,100),title:String(r.title||"タイトルなし").slice(0,250),viewers,thumbnail:imageCandidates(r.thumbnail,r.thumbnail_url).map(x=>validatedThumb(x,"kick")).find(Boolean)||"",startedAt:typeof r.started_at==="string"?r.started_at:"",url:"https://kick.com/"+slug});}
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
function kickDuration(value){
 const text=String(value??"").replace(/\s+/g,"").trim();
 const m=/^(?:(\d{1,3})日)?(?:(\d{1,4})時間)?(?:(\d{1,5})分)?$/.exec(text);
 if(!m||!text||(!m[1]&&!m[2]&&!m[3]))return "";
 const minutes=Number(m[1]||0)*1440+Number(m[2]||0)*60+Number(m[3]||0);
 if(!Number.isSafeInteger(minutes)||minutes>525600)return "";
 return (minutes>=1440?Math.floor(minutes/1440)+"日":"")+(minutes%1440>=60?Math.floor(minutes%1440/60)+"時間":"")+minutes%60+"分";
}
function mergeKickDurations(rows,details){
 const byId=new Map();
 for(const d of details){const id=String(d.id??"").toLowerCase();if(!/^[a-z0-9_-]{1,40}$/.test(id))continue;const duration=kickDuration(d.duration);if(duration){if(byId.has(id)&&byId.get(id)!==duration)byId.set(id,"");else if(!byId.has(id))byId.set(id,duration);}}
 return rows.map(row=>{const duration=kickDuration(row.duration)||byId.get(row.id)||"";return {...row,duration};});
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
  const tailText=plain(tail);const durations=[...tailText.matchAll(/(?:^|\s)((?:\d+日\s*)?(?:\d+時間\s*)?\d+分|\d+日\s*\d+時間|\d+時間|\d+日)(?=\s|$)/g)].map(m=>kickDuration(m[1])).filter(Boolean);
  const title=plain(a[1].match(/\b(?:title|aria-label)\s*=\s*(["'])(.*?)\1/i)?.[2]||a[2]).slice(0,250);
  const imageTag=[...block.matchAll(/<img\b[^>]*>/gi)].find(m=>new RegExp("\\balt\\s*=\\s*[\\\"\']KCK_"+id+"[\\\"\']","i").test(m[0]));
  const thumb=imageTag?.[0].match(/\s(?:data-src|data-original|src)\s*=\s*(["'])(.*?)\1/i)?.[2]||"";
  seen.add(id);rows.push({id,name:id,title:title||id,viewers,thumbnail:validatedThumb(thumb.replaceAll("&amp;","&"),"kick"),duration:durations.length===1?durations[0]:""});
 }
 return rows;
}
function diagnostic(error){const msg=String(error?.message||"");return /^HTTP \d{3}$/.test(msg)?msg:error?.name==="TimeoutError"||error?.name==="AbortError"?"タイムアウト":msg==="取得上限超過"?"応答サイズ上限":"通信・形式エラー";}
async function publicKickRanking(reason){
 const primaryUrl="https://ikioi-ranking.com/v/kick",detailUrl="https://www.chikuwachan.com/live/KCK/";
 const [primary,detail]=await Promise.all([
  fetchBounded(primaryUrl,{headers:{accept:"text/html"}}).then(html=>parseArchiveRanking(html,"kick")).catch(()=>[]),
  fetchBounded(detailUrl,{headers:{accept:"text/html"}}).then(parseKickPublic).catch(()=>[])
 ]);
 if(primary.length)return {source:"勢いランキング・Kick",sourceUrl:primaryUrl,complete:false,metric:"公開データ・参考同時視聴者数順",fetchedAt:new Date().toISOString(),entries:mergeKickDurations(rankKick(primary),detail),notice:reason};
 if(detail.length)return {source:"ちくわちゃん・Kick",sourceUrl:detailUrl,complete:false,metric:"参考掲載順・日本語判定未確認",fetchedAt:new Date().toISOString(),entries:detail.slice(0,10),notice:reason};
 return {status:"unconfigured",message:reason+"／公開ランキングからも取得できません。",entries:[]};
}

// Read only public, matching program data. Do not connect to watch/chat sockets.
function parseStatsMessage(raw){
 if(typeof raw!=="string"||raw.length>65536)return null;
 try{
  const event=JSON.parse(raw);if(event.type!=="statistics"||!event.data||typeof event.data!=="object")return null;
  const p=v=>typeof v==="number"&&Number.isSafeInteger(v)&&v>=0&&v<=999999999999?v:null;
  const advertising=p(event.data.adPoints),gift=p(event.data.giftPoints),visitors=p(event.data.viewers),comments=p(event.data.comments);
  if(advertising===null&&gift===null&&visitors===null&&comments===null)return null;
  return {advertising,gift,visitors,comments};
 }catch{return null;}
}
function statisticsEndpoint(data,id){
 if(!/^lv\d{5,15}$/.test(id)||liveId(data?.program?.nicoliveProgramId??data?.program?.programId??data?.program?.liveId??data?.program?.id?.value??data?.program?.id)!==id)return null;
 if(data?.program?.isOnAir===false)return null;
 const status=String(data.program.schedule?.status??data.program.liveStatus??data.program.status??"").toUpperCase();
 if(status&&!["ON_AIR","ONAIR","LIVE","ON AIR"].includes(status))return null;
 try{
  const u=new URL(data.site.relive.webSocketUrl);
  if(u.protocol!=="wss:"||u.username||u.password||u.port||u.hash||!/^([a-z0-9-]+\.)*live2\.nicovideo\.jp$/i.test(u.hostname)||!/^\/unama\/wsapi\/v2\/watch\/\d+\/?$/.test(u.pathname))return null;
  if(Number.isSafeInteger(data.site.frontendId)&&data.site.frontendId>0)u.searchParams.set("frontend_id",String(data.site.frontendId));
  u.protocol="https:";return u.href;
 }catch{return null;}
}
// One bounded read of public program statistics. Never open the comment
// server or fetch a media playlist; no account credentials or tokens are stored.
function activityVarint(bytes,cursor){
 let value=0n;
 for(let shift=0n;shift<70n&&cursor.pos<bytes.length;shift+=7n){const b=bytes[cursor.pos++];value|=BigInt(b&127)<<shift;if(b<128)return value;}
 throw Error("incomplete varint");
}
function activityFields(bytes,repeated,collect){
 if(!(bytes instanceof Uint8Array))throw Error("invalid message");
 const result=new Map(),cursor={pos:0};
 while(cursor.pos<bytes.length){
  const tag=Number(activityVarint(bytes,cursor)),kind=tag%8;let value;
  if(kind===0)value=activityVarint(bytes,cursor);
  else{const size=kind===2?Number(activityVarint(bytes,cursor)):kind===5?4:kind===1?8:-1;if(!Number.isSafeInteger(size)||size<0||size>bytes.length-cursor.pos)throw Error("invalid field");value=bytes.subarray(cursor.pos,cursor.pos+size);cursor.pos+=size;}
  const key=Math.floor(tag/8);if(key===repeated)collect(value);result.set(key,value);
 }
 return result;
}
function activityAggregate(events,end,coveredSince){
 if(!Number.isSafeInteger(end)||!Number.isSafeInteger(coveredSince)||coveredSince>end)return {active10m:null,active60s:null};
 const count=seconds=>{if(coveredSince>end-seconds)return null;const users=new Set();for(const e of events){if(e.at>end-seconds&&e.at<=end){if(!e.sender)return null;users.add(e.sender);}}return users.size;};
 return {active10m:count(600),active60s:count(60)};
}
function activityFeedUrl(raw){
 try{const u=new URL(raw);if(u.protocol!=="https:"||u.username||u.password||u.port||u.hash||!u.hostname.endsWith(".nicovideo.jp")||!/^\/api\/(?:view|segment|backward|packed)\//.test(u.pathname))return null;return u;}catch{return null;}
}
async function activityBytes(url,signal){
 const res=await fetch(url,{signal,redirect:"error"});if(!res.ok||!res.body)throw Error("feed unavailable");
 const reader=res.body.getReader();const chunks=[];let total=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>2097152)throw Error("feed too large");chunks.push(value);}}finally{try{await reader.cancel();}catch{}}
 const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
async function* activityFrames(url,signal){
 const res=await fetch(url,{signal,redirect:"error"});if(!res.ok||!res.body)throw Error("feed unavailable");
 const reader=res.body.getReader();let pending=new Uint8Array(),total=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>2097152)throw Error("feed too large");const bytes=new Uint8Array(pending.length+value.length);bytes.set(pending);bytes.set(value,pending.length);let offset=0;
 while(offset<bytes.length){const c={pos:offset};let length;try{length=Number(activityVarint(bytes,c));}catch{break;}if(!Number.isSafeInteger(length)||length>1048576)throw Error("invalid frame");if(bytes.length-c.pos<length)break;yield activityFields(bytes.subarray(c.pos,c.pos+length));offset=c.pos+length;}pending=bytes.slice(offset);}
 if(pending.length)throw Error("truncated feed");
 }finally{try{await reader.cancel();}catch{}}
}
// Adapted from the uploaded worker/activity.mjs. One closed history snapshot,
// no continuous listener, no persisted comment contents or sender identifiers.
async function sampleNicoActivity(raw){
 const view=activityFeedUrl(raw);if(!view)return null;
 const signal=AbortSignal.timeout(9500),now=Math.floor(Date.now()/1000),decode=b=>activityFeedUrl(new TextDecoder().decode(b));
 view.searchParams.set("at","now");let segment=null;
 try{
  for await(const e of activityFrames(view,signal)){
   if(e.has(2)){
    const back=activityFields(e.get(2)),end=Number(activityFields(back.get(1)).get(1));
    if(end<=now+2&&end>=now-180&&back.has(2)){const url=decode(activityFields(back.get(2)).get(1));if(url){segment={end,url,packed:true};break;}}
   }
   const raw=e.get(3)||e.get(1);if(!raw)continue;
   const info=activityFields(raw),start=Number(activityFields(info.get(1)).get(1)),end=Number(activityFields(info.get(2)).get(1)),url=decode(info.get(3));
   if(url&&start<end&&end<=now&&end>=now-180){segment={start,end,url,packed:false};break;}
  }
  if(!segment)return null;
  const events=[];let covered=segment.end,unknownTime=false;
  function record(chunk){
   if(!chunk.has(2))return;
   const message=activityFields(chunk.get(2)),raw=message.get(1)||message.get(20);if(!raw)return;
   const at=Number(activityFields(activityFields(chunk.get(1)).get(2)).get(1));if(!Number.isSafeInteger(at)){unknownTime=true;return;}
   if(at<segment.end-600||at>segment.end)return;
   const chat=activityFields(raw),sender=chat.has(5)?"u"+String(chat.get(5)):chat.get(6)?.length?"h"+new TextDecoder().decode(chat.get(6)):null;
   if(events.length>=20000)throw Error("too many comments");events.push({at,sender});
  }
  if(segment.packed){
   let url=segment.url,oldest=segment.end,seen=new Set();
   for(let i=0;url&&i<4;i++){
    if(seen.has(url.href))throw Error("repeated history");seen.add(url.href);
    const packet=activityFields(await activityBytes(url,signal),1,b=>{const chunk=activityFields(b),at=Number(activityFields(activityFields(chunk.get(1)).get(2)).get(1));if(!Number.isSafeInteger(at)){unknownTime=true;return;}oldest=Math.min(oldest,at);record(chunk);});
    covered=oldest;if(covered<=segment.end-600)break;
    url=packet.has(2)?decode(activityFields(packet.get(2)).get(1)):null;
   }
  }else{for await(const chunk of activityFrames(segment.url,signal))record(chunk);covered=segment.start;}
  if(unknownTime)return null;
  return {...activityAggregate(events,segment.end,covered),activitySampleEnd:segment.end};
 }catch{return null;}
}

async function fetchNicoStatistics(endpoint,wantActivity=false){
 if(!endpoint)return null;
 let ws;
 try{
  const response=await fetch(endpoint,{headers:{Upgrade:"websocket",Origin:"https://live.nicovideo.jp"},redirect:"error",signal:AbortSignal.timeout(4000)});
  ws=response.webSocket;if(!ws)return null;
  return await new Promise(resolve=>{
   let done=false,latest=null,timer,viewUri=null;
   function finish(){if(done)return;done=true;clearTimeout(timer);try{ws.close(1000,"statistics complete");}catch{}resolve(latest||viewUri?{...latest,viewUri}:null);}
   function send(value){try{ws.send(JSON.stringify(value));}catch{finish();}}
   timer=setTimeout(finish,6500);
   ws.addEventListener("close",finish);ws.addEventListener("error",finish);
   ws.addEventListener("message",event=>{
    const stat=parseStatsMessage(event.data);
    if(stat){latest={advertising:stat.advertising??latest?.advertising??null,gift:stat.gift??latest?.gift??null,visitors:stat.visitors??latest?.visitors??null,comments:stat.comments??latest?.comments??null};if(latest.advertising!==null&&latest.gift!==null&&(!wantActivity||viewUri))finish();return;}
    if(typeof event.data!=="string"||event.data.length>65536)return;
    try{const message=JSON.parse(event.data);if(message.type==="ping"){send({type:"pong"});send({type:"keepSeat"});}else if(message.type==="messageServer"&&wantActivity){const view=activityFeedUrl(message.data?.viewUri);if(view){viewUri=view.href;if(latest?.advertising!=null&&latest?.gift!=null)finish();}}else if(message.type==="disconnect"||message.type==="error")finish();}catch{}
   });
   try{ws.accept();send({type:"startWatching",data:{reconnect:false}});}catch{finish();}
  });
 }catch{try{ws?.close(1000,"statistics unavailable");}catch{}return null;}
}

function publicNicoDetail(html,id){
 for(const tag of String(html||"").matchAll(/<[^>]+\bid\s*=\s*(["'])embedded-data\1[^>]*>/gi)){
  const attr=tag[0].match(/\bdata-props\s*=\s*(["'])([\s\S]*?)\1/i)?.[2];if(!attr)continue;
  try{const data=JSON.parse(attr.replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&"));
   const p=data?.program;if(!p||liveId(p.nicoliveProgramId??p.programId??p.liveId??p.id?.value??p.id)!==id)continue;
   const status=String(p.schedule?.status??p.liveStatus??p.status??"").toUpperCase();if(status&&!["ON_AIR","ONAIR","LIVE","ON AIR"].includes(status))continue;
   const stats=p.statistics??p.stats??data.statistics??{},v=readContributionStatistics({...p,statistics:stats}),images=programThumbnailCandidates(p,data);
   return {profileUrl:nicoProfile(p),name:clean(p.supplier?.name??p.programProvider?.name,80),advertising:v.adPoints,gift:v.giftPoints,visitors:count(stats.watchCount??stats.visitorCount??stats.viewers??stats.viewCount??p.watchCount),comments:count(stats.commentCount??stats.comments??p.commentCount),startedAt:time(p.schedule?.beginTime??p.beginTime??p.beginAt),thumbnailUrl:images[0]||"",thumbnailCandidates:images,statisticsEndpoint:statisticsEndpoint(data,id)};
  }catch{}
 }
 return null;
}
// Bounded lookups with per-program Cache API entries. No shared I/O promises.
async function enrichPublicNico(rows,origin){
 const candidates=rows.slice(0,10).filter(r=>!r.profileUrl||!r.thumbnailUrl||r.advertising==null||r.gift==null||r.active10m==null||!r.startedAt||r.visitors==null||r.comments==null);
 const missing=[];
 function apply(row,detail){if(!detail)return;for(const k of ["name","profileUrl","advertising","gift","visitors","comments","startedAt","thumbnailUrl","active10m","active60s","activitySampleEnd"])if((row[k]==null||row[k]==="")&&detail[k]!=null&&detail[k]!=="")row[k]=detail[k];row.thumbnailCandidates=[...new Set([row.thumbnailUrl,...(row.thumbnailCandidates||[]),...(detail.thumbnailCandidates||[])].filter(Boolean))].slice(0,8);}
 for(const row of candidates){const key=new Request(origin+"/__cache/nico-detail/"+row.liveId+"?r29");try{const cached=await caches.default.match(key);if(cached){apply(row,await cached.json());continue;}}catch{}missing.push({row,key});}
 await Promise.all(missing.slice(0,2).map(async({row,key})=>{let detail=null;try{detail=publicNicoDetail(await fetchBounded("https://live.nicovideo.jp/watch/"+row.liveId,{headers:{accept:"text/html"}}),row.liveId);if(detail){const endpoint=detail.statisticsEndpoint;delete detail.statisticsEndpoint;const wantActivity=row.active10m==null;if((row.advertising==null&&detail.advertising==null)||(row.gift==null&&detail.gift==null)||wantActivity){const stats=await fetchNicoStatistics(endpoint,wantActivity);if(stats){for(const k of ["advertising","gift","visitors","comments"])if(stats[k]!=null)detail[k]=stats[k];if(wantActivity&&stats.viewUri){const activity=await sampleNicoActivity(stats.viewUri);if(activity)Object.assign(detail,activity);}}}}}catch{}apply(row,detail);try{await caches.default.put(key,json(detail,200,"public, max-age="+(detail&&detail.advertising!=null&&detail.gift!=null&&detail.active10m!=null?60:30)));}catch{}}));
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
function selectRankingSource(results){
 const usable=results.filter(x=>x.rows.length>0);
 return usable.find(x=>x.rows.length>=10)||usable.sort((a,b)=>b.rows.length-a.rows.length)[0]||null;
}
function selectNicoReference(results){
 const reference=results.find(r=>r.source.name==="nico-ran.stream");
 const hasValue=v=>Number.isSafeInteger(v)&&v>=0;
 // Prefer this source only when a full list with actual program-level data is available.
 if(reference?.rows.length>=10&&reference.rows.slice(0,10).some(r=>hasValue(r.active10m))&&reference.rows.slice(0,10).some(r=>hasValue(r.advertising)||hasValue(r.gift)))return reference;
 return null;
}
function nicoReferenceCoverage(rows,reference){
 const ids=new Set((reference?.rows||[]).map(x=>x.liveId));
 const values=k=>rows.filter(x=>Number.isSafeInteger(x[k])&&x[k]>=0).length;
 return {referenceStatus:reference?.reason||"取得済み",matched:rows.filter(x=>ids.has(x.liveId)).length,total:rows.length,advertising:values("advertising"),gift:values("gift"),active10m:values("active10m")};
}
async function fetchNicoReferencePage(origin,source){
 const key=new Request(origin+"/__cache/nico-ran-public-r28");
 try{const hit=await caches.default.match(key);if(hit)return await hit.json();}catch{}
 let result;
 try{
  const html=await fetchBounded(source.url,{headers:{accept:"text/html,application/json;q=0.9"}});
  const cards=parseNicoRanCards(html);
  // Do not treat watch links alone or event points as program statistics.
  let structured=[];try{structured=unique(extractJsonRows(JSON.parse(html)));}catch{}
  if(!structured.length)structured=parseRankingPage(html);
  const lookup=new Map(structured.map(row=>[row.liveId,row]));
  const rows=cards.map(card=>{const old=lookup.get(card.liveId)||{};const out={...old};for(const [k,v] of Object.entries(card))if(v!=null&&v!=="")out[k]=v;return out;});
  result={source,rows,reason:rows.length?"取得済み":"番組別の公開統計がHTMLにありません"};
 }catch(e){result={source,rows:[],reason:"接続失敗: "+diagnostic(e)};}
 try{await caches.default.put(key,json(result,200,"public, max-age=60"));}catch{}
 return result;
}
async function nicoRanking(origin){
 const rssRequest=fetchBounded("https://live.nicovideo.jp/recent/rss?tab=live",{headers:{accept:"application/rss+xml,application/xml"}},2*1024*1024).then(parseArchiveRss).catch(()=>new Map());
 const sources=[{name:"勢いランキング",url:"https://ikioi-ranking.com/v/nico"},{name:"ちくわちゃん",url:"https://www.chikuwachan.com/live/NCU/"},{name:"nico-ran.stream",url:"https://nico-ran.stream/"},{name:"ニコ生公式ランキング",url:"https://live.nicovideo.jp/ranking"}];
 const results=await Promise.all(sources.map(async source=>{if(source.name==="nico-ran.stream")return fetchNicoReferencePage(origin,source);try{const html=await fetchBounded(source.url,{headers:{accept:"text/html,application/json;q=0.9"}});let rows=[];if(source.name==="勢いランキング")rows=parseArchiveRanking(html,"nico");else{try{rows=unique(extractJsonRows(JSON.parse(html)));}catch{}if(!rows.length)rows=parseRankingPage(html);}if(source.name==="ちくわちゃん")supplementNicoHtml(html,rows);if(source.name==="nico-ran.stream"){const cards=parseNicoRanCards(html);if(cards.length){const map=new Map(rows.map(r=>[r.liveId,r]));rows=cards.map(card=>{const r=map.get(card.liveId)||{};return {...r,...card,name:card.name||r.name||"",profileUrl:card.profileUrl||r.profileUrl||"",visitors:card.visitors??r.visitors??null,comments:card.comments??r.comments??null,active10m:card.active10m??r.active10m??null,advertising:card.advertising??r.advertising??null,gift:card.gift??r.gift??null};});}}return {source,rows,reason:rows.length?"":"番組データなし"};}catch(e){return {source,rows:[],reason:diagnostic(e)};}}));
 const best=selectNicoReference(results)||selectRankingSource(results.filter(r=>r.source.name!=="nico-ran.stream"))||selectRankingSource(results);if(best){const preferred=results.find(r=>r.source.name==="nico-ran.stream");if(preferred){const map=new Map(preferred.rows.map(r=>[r.liveId,r]));for(const row of best.rows){const other=map.get(row.liveId);if(other){for(const k of ["advertising","gift","active10m"])if(other[k]!=null)row[k]=other[k];}}}}if(best)for(const result of results){if(result!==best){const lookup=new Map(result.rows.map(r=>[r.liveId,r]));for(const row of best.rows){const other=lookup.get(row.liveId);if(!other)continue;for(const k of ["name","profileUrl","visitors","comments","gift","advertising","startedAt","duration","thumbnailUrl","active10m","momentum"])if((row[k]==null||row[k]==="")&&other[k]!=null&&other[k]!=="")row[k]=other[k];}}}
 const rss=await rssRequest;if(best){for(const row of best.rows.slice(0,10)){const image=rankingImageUrl(rss.get(row.liveId));if(image){row.thumbnailCandidates=[...new Set([row.thumbnailUrl,...(row.thumbnailCandidates||[]),image].filter(Boolean))].slice(0,8);if(!row.thumbnailUrl)row.thumbnailUrl=image;}}await enrichPublicNico(best.rows,origin);}
 if(best)return {source:best.source.name,sourceUrl:best.source.url,complete:false,metric:best.source.name==="勢いランキング"?"公開勢いポイント順":best.source.name==="nico-ran.stream"?"nico-ran.stream掲載順（参考順位）":"公開掲載順（参考順位）",coverage:nicoReferenceCoverage(best.rows.slice(0,10),results.find(r=>r.source.name==="nico-ran.stream")),fetchedAt:new Date().toISOString(),entries:best.rows.slice(0,10).map(r=>({id:r.liveId,name:r.name,profileUrl:r.profileUrl||"",title:r.title,url:"https://live.nicovideo.jp/watch/"+r.liveId,momentum:r.momentum??null,visitors:r.visitors??null,comments:r.comments??null,active10m:r.active10m??null,active60s:r.active60s??null,activitySampleEnd:r.activitySampleEnd??null,advertising:r.advertising??null,gift:r.gift??null,duration:r.duration||'',startedAt:r.startedAt,thumbnail:r.thumbnailUrl,thumbnailCandidates:r.thumbnailCandidates||[]}))};
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
function recentKickSample(payload,roomId,startedAt,now){
 const messages=payload?.data?.messages;
 if(!Array.isArray(messages)||!Number.isFinite(startedAt)||startedAt>now||messages.length>1000)return null;
 const ids=new Set(),senders=new Set();let missingSender=false;
 for(const msg of messages){
  if(!msg||String(msg.chatroom_id)!==String(roomId))continue;
  const t=Date.parse(msg.created_at);if(!Number.isFinite(t)||t<Math.max(startedAt,now-600000)||t>now)continue;
  if(!["message","reply"].includes(msg.type)||typeof msg.id!=="string"||!msg.id||ids.has(msg.id))continue;
  ids.add(msg.id);if(Number.isSafeInteger(msg.sender?.id)&&msg.sender.id>0)senders.add(msg.sender.id);else missingSender=true;
 }
 return {receivedComments:ids.size,activeUsers:missingSender?null:senders.size,sampledAt:new Date(now).toISOString()};
}
function kickGiftedSubs(payload,slug){
 const rows=payload?.data;if(!Array.isArray(rows))return null;
 const row=rows.find(x=>typeof x?.slug==="string"&&x.slug.toLowerCase()===slug&&x.stream?.is_live===true);
 const n=row?.active_gifted_subscribers_count;return Number.isSafeInteger(n)&&n>=0?n:null;
}
async function enrichKickPublicMetrics(data,origin,env){
 if(!Array.isArray(data.entries)||!data.entries.length)return data;
 const rows=data.entries.slice(0,10);
 for(const row of rows){row.receivedComments=null;row.activeUsers=null;row.kicksGift=null;row.giftedSubscriptions=null;}
 // Official channel-level active gifted subscriptions are not gifts during this stream.
 // Batch top ten only; cache channel totals for two minutes.
 if(env.KICK_CLIENT_ID&&env.KICK_CLIENT_SECRET){
  try{
   const key=new Request(origin+"/__cache/kick-channels-r23/"+rows.map(r=>r.id).sort().join(","));
   const cached=await caches.default.match(key);let payload;
   if(cached)payload=await cached.json();
   else{
    const access=await kickToken(env),url=new URL("https://api.kick.com/public/v1/channels");
    for(const row of rows)if(/^[a-z0-9_-]{1,40}$/.test(row.id))url.searchParams.append("slug",row.id);
    const response=JSON.parse(await fetchBounded(url,{headers:{authorization:"Bearer "+access,accept:"application/json"}},1024*1024));
    // Cache only the public aggregate fields, never account tokens or other metadata.
    payload={data:(Array.isArray(response.data)?response.data:[]).map(x=>({slug:x.slug,stream:{is_live:x.stream?.is_live},active_gifted_subscribers_count:x.active_gifted_subscribers_count}))};
    try{await caches.default.put(key,json(payload,200,"public, max-age=120"));}catch{}
   }
   for(const row of rows)row.giftedSubscriptions=kickGiftedSubs(payload,row.id);
  }catch{}
 }
 // Recent public chat snapshots only: no WebSocket, webhook, user records, or chat archive.
 const missing=[];
 for(const row of rows){
  if(!/^[a-z0-9_-]{1,40}$/.test(row.id))continue;
  const key=new Request(origin+"/__cache/kick-sample-r23/"+row.id);
  try{const saved=await caches.default.match(key);if(saved){const s=await saved.json();if(s&&s.startedAt&&(!row.startedAt||Date.parse(row.startedAt)===Date.parse(s.startedAt))){Object.assign(row,s);continue;}if(s===null)continue;}}catch{}
  missing.push({row,key});
 }
 // Bound each refresh to two channels; reuse aggregates for 120 seconds.
 await Promise.all(missing.slice(0,2).map(async({row,key})=>{
  let result=null;
  try{
   const channel=JSON.parse(await fetchBounded("https://kick.com/api/v2/channels/"+encodeURIComponent(row.id),{headers:{accept:"application/json"}},1024*1024));
   const channelId=channel?.id,room=channel?.chatroom?.id,live=channel?.livestream;
   if(typeof channel.slug!=="string"||channel.slug.toLowerCase()!==row.id||!Number.isSafeInteger(channelId)||channelId<=0||!Number.isSafeInteger(room)||room<=0||!live||live.is_live!==true)throw Error("channel not verified live");
   const start=time(live.start_time??live.created_at??live.started_at),ts=Date.parse(start);
   if(!Number.isFinite(ts)||(row.startedAt&&Date.parse(row.startedAt)!==ts))throw Error("stream identity mismatch");
   const payload=JSON.parse(await fetchBounded("https://kick.com/api/v2/channels/"+channelId+"/messages",{headers:{accept:"application/json"}},1024*1024));
   const sample=recentKickSample(payload,room,ts,Date.now());
   if(sample)result={...sample,startedAt:start};
   if(result)Object.assign(row,result);
  }catch{}
  try{await caches.default.put(key,json(result,200,"public, max-age=120"));}catch{}
 }));
 return {...data,entries:rows};
}

function json(value,status=200,cache="no-store"){return new Response(JSON.stringify(value),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":cache,"x-content-type-options":"nosniff"}});}
async function resolveNicoProfile(request){
 const id=new URL(request.url).searchParams.get("id");
 if(!/^lv\d{5,15}$/.test(id||""))return json({status:"error",message:"番組IDが不正です"},400);
 try{const detail=publicNicoDetail(await fetchBounded("https://live.nicovideo.jp/watch/"+id,{headers:{accept:"text/html"}}),id);if(detail?.profileUrl)return Response.redirect(detail.profileUrl,302);}catch{}
 return new Response("配信者のユーザーページを確認できませんでした。",{status:404,headers:{"content-type":"text/plain; charset=utf-8","cache-control":"no-store"}});
}

function imageCandidates(...items){
 const out=[];const walk=(v,depth)=>{if(typeof v==="string"){out.push(v.replaceAll("&amp;","&"));return;}if(!v||typeof v!=="object"||depth>3)return;for(const k of ["screenshot","urlSet","urls","large","huge","middle","small","normal","url","uri","src","uri640x360","uri320x180","uri160x90"])if(Object.prototype.hasOwnProperty.call(v,k))walk(v[k],depth+1);};
 for(const item of items)walk(item,0);return [...new Set(out)].slice(0,24);
}
function validatedThumb(value,type){
 if(typeof value!=="string"||value.length>2048)return "";
 try{const u=new URL(value.startsWith("//")?"https:"+value:value);const host=u.hostname.toLowerCase();
  if(u.protocol!=="https:"||u.username||u.password||u.port||u.hash||/profile|avatar|usericon|user-icon|channel-icon|\/icons?\//i.test(u.pathname))return "";
  const ok=type==="nico"?["nimg.jp","simg.jp"].some(x=>host===x||host.endsWith("."+x)):["images.kick.com","files.kick.com","stream.kick.com"].some(x=>host===x);
  return ok?u.href:"";
 }catch{return "";}
}
function ogImage(html){
 for(const m of String(html).matchAll(/<meta\b[^>]*>/gi)){
  const tag=m[0];if(!/\b(?:property|name)\s*=\s*["']og:image["']/i.test(tag))continue;
  const content=tag.match(/\bcontent\s*=\s*(["'])(.*?)\1/i)?.[2];if(content)return content.replaceAll("&amp;","&");
 }
 return "";
}
async function resolveThumbnailCandidates(type,id,rows){
 const known=rows.find(row=>row.id===id),fromRank=imageCandidates(known?.thumbnail,...(known?.thumbnailCandidates||[]));
 if(type==="nico"){
  try{const html=await fetchBounded("https://live.nicovideo.jp/watch/"+id,{headers:{accept:"text/html"}},3*1024*1024);
   const detail=publicNicoDetail(html,id);
   if(detail){
    const candidates=imageCandidates(...(detail.thumbnailCandidates||[]),detail.thumbnailUrl);
    if(!candidates.length&&/^https:\/\/www\.nicovideo\.jp\/user\/[1-9]\d{0,14}$/.test(detail.profileUrl||"")){
     try{const owner=detail.profileUrl.split("/").pop(),history=JSON.parse(await fetchBounded("https://live.nicovideo.jp/front/api/v1/user-broadcast-history?providerType=user&isIncludeNonPublic=false&offset=0&limit=5&providerId="+owner,{headers:{accept:"application/json"}},1024*1024));
      const entry=history.data?.programsList?.find(x=>liveId(x.id?.value??x.id)===id);if(entry)candidates.push(...imageCandidates(entry.thumbnail?.screenshot,entry.thumbnail));
     }catch{}
    }
    return [...new Set([...candidates,...fromRank,ogImage(html)])];
   }
  }catch{}
 }else{
  for(const suffix of ["/livestream",""]){
   try{const payload=JSON.parse(await fetchBounded("https://kick.com/api/v2/channels/"+encodeURIComponent(id)+suffix,{headers:{accept:"application/json"}},1024*1024));
    if(payload.slug&&String(payload.slug).toLowerCase()!==id)continue;
    const live=payload.livestream??payload.data?.livestream??payload.data??(suffix?payload:null);
    if(!live||live.is_live===false)continue;
    if(live.slug&&live.slug!==id&&live.channel?.slug&&live.channel.slug!==id)continue;
    const candidates=imageCandidates(live.thumbnail,live.thumbnail_url,live.thumbnailUrl);
    if(candidates.some(v=>validatedThumb(v,type)))return [...new Set([...candidates,...fromRank])];
   }catch{}
  }
 }
 return fromRank;
}
async function thumbnailResponse(raw,type){
 let url=validatedThumb(raw,type);if(!url)return null;
 const signal=AbortSignal.timeout(6000);
 try{
  let response;
  for(let i=0;i<3;i++){
   response=await fetch(url,{signal,redirect:"manual",headers:{Accept:"image/avif,image/webp,image/png,image/jpeg,image/gif",Referer:type==="nico"?"https://live.nicovideo.jp/":"https://kick.com/"}});
   if(![301,302,303,307,308].includes(response.status))break;
   const location=response.headers.get("location");if(response.body)await response.body.cancel();if(!location)return null;
   url=validatedThumb(new URL(location,url).href,type);if(!url)return null;
  }
  const contentType=(response.headers.get("content-type")||"").split(";")[0].toLowerCase();
  if(!response.ok||!/^image\/(jpeg|png|webp|gif|avif)$/.test(contentType)||Number(response.headers.get("content-length")||0)>2097152||!response.body){if(response.body)await response.body.cancel();return null;}
  const reader=response.body.getReader(),chunks=[];let total=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>2097152){await reader.cancel();return null;}chunks.push(value);}}finally{reader.releaseLock();}
  if(!total)return null;
  const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return new Response(bytes,{headers:{"content-type":contentType,"cache-control":"public, max-age=60","x-content-type-options":"nosniff"}});
 }catch{return null;}
}
async function liveThumbnail(request){
 const url=new URL(request.url),type=url.searchParams.get("service"),id=url.searchParams.get("id")||"";
 if(request.method!=="GET")return new Response(null,{status:405});
 if(!(type==="nico"?/^lv\d{5,15}$/.test(id):type==="kick"&&/^[a-z0-9_-]{1,40}$/.test(id)))return new Response(null,{status:400});
 const key=new Request(url.origin+"/__cache/live-thumbnail-r30/"+type+"/"+id);
 try{const cached=await caches.default.match(key);if(cached)return cached;}catch{}
 let rows=[];
 // Restrict public requests to programs currently present in a cached ranking.
 for(const suffix of ["?revision=r30","?last-good=r30"]){
  try{const response=await caches.default.match(new Request(url.origin+"/api/rankings/"+type+suffix));const data=response&&await response.json();if(Array.isArray(data?.entries)&&data.entries.some(x=>x.id===id)){rows=data.entries;break;}}catch{}
 }
 if(!rows.length)return new Response(null,{status:404,headers:{"cache-control":"no-store"}});
 const known=rows.find(x=>x.id===id),rankImages=imageCandidates(known.thumbnail,...(known.thumbnailCandidates||[]));
 // Prefer already observed program images; resolve from fixed public endpoints if unavailable.
 let attempted=new Set();
 async function tryImages(images){
  for(const raw of images){const candidate=validatedThumb(raw,type);if(!candidate||attempted.has(candidate)||attempted.size>=4)continue;attempted.add(candidate);const response=await thumbnailResponse(candidate,type);if(response)return response;}return null;
 }
 let result=await tryImages(rankImages.slice(0,2));
 if(!result)result=await tryImages(await resolveThumbnailCandidates(type,id,rows));
 if(!result)result=new Response(null,{status:404,headers:{"cache-control":"public, max-age=25"}});
 try{await caches.default.put(key,result.clone());}catch{}
 return result;
}

export default {async fetch(request,env,ctx){
 const url=new URL(request.url),match=/^\/api\/rankings\/(nico|kick)$/.exec(url.pathname);
 if(url.pathname==="/api/live-thumbnail")return liveThumbnail(request);
 if(url.pathname==="/api/live-profile"&&request.method==="GET")return resolveNicoProfile(request);
 if(url.pathname==="/api/health")return json({status:"ok",revision:"2026.11.26-r30",kickConfigured:!!(env.KICK_CLIENT_ID&&env.KICK_CLIENT_SECRET)});
 if(url.pathname==="/embed/rankings"||url.pathname==="/embed/rankings/"){const assetUrl=new URL("/",url);return env.ASSETS.fetch(new Request(assetUrl,request));}
 if(!match)return url.pathname.startsWith("/api/")?json({status:"error",message:"APIが見つかりません"},404):env.ASSETS.fetch(request);
 if(request.method!=="GET")return json({status:"error",message:"GETのみ対応"},405);
 const type=match[1],key=new Request(url.origin+url.pathname+"?revision=r30"),backup=new Request(url.origin+url.pathname+"?last-good=r30");
 async function previousRanking(){try{const saved=await caches.default.match(backup);if(saved){const data=await saved.json();const age=Date.now()-Date.parse(data.fetchedAt);if(data.entries?.length&&age>=0&&age<=300000)return json({...data,stale:true},200);}}catch{}return null;}
 try{const cached=await caches.default.match(key);if(cached)return cached;}catch{}
 try{
  let data=type==="nico"?await nicoRanking(url.origin):await kickRanking(env).catch(e=>publicKickRanking("Kick公式API: "+diagnostic(e)));
  if(type==="kick"&&(!data.status||data.status==="ok"))data=await enrichKickPublicMetrics(data,url.origin,env);
  const ok=!data.status||data.status==="ok";
  if(!ok){const previous=await previousRanking();if(previous)return previous;}
  const response=json(ok?{status:"ok",...data}:data,data.status==="error"?502:200,ok?"public, max-age=10":"no-store");
  if(ok){try{await caches.default.put(key,response.clone());if(data.entries?.length)await caches.default.put(backup,json({status:"ok",...data},200,"public, max-age=300"));}catch{}}
  return response;
 }catch(e){const previous=await previousRanking();if(previous)return previous;return json({status:"error",message:(type==="nico"?"ニコ生":"Kick")+"取得失敗: "+diagnostic(e),entries:[]},502);}
}};
