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
function nicoListingThumbnail(value,id){
 if(typeof value!=="string"||!/^lv\d{5,15}$/.test(id))return "";
 try{const u=new URL(value.replaceAll("&amp;","&"),"https://www.chikuwachan.com/live/NCU/");if(u.origin!=="https://www.chikuwachan.com"||u.username||u.password||u.hash||!u.pathname.startsWith("/live/")||!/\.(?:jpe?g|png|webp)$/i.test(u.pathname)||/(?:usericon|user-icon|avatar|profile|badge|logo|\/icons?\/)/i.test(u.pathname))return "";const match=u.pathname.match(/(?:^|[^a-z0-9])(lv\d{5,15})(?![a-z0-9])/i);return match?.[1].toLowerCase()===id?u.href:"";}catch{return "";}
}
function exactWatchImageGroups(html){
 const result=new Map(),safe=String(html||"").replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>|<!--[\s\S]*?-->/gi,"");
 const attr=(tag,key)=>tag.match(new RegExp("(?:^|\\s)"+key+"\\s*=\\s*([\"'])([\\s\\S]*?)\\1","i"))?.[2]?.replace(/&amp;/g,"&")||"";
 for(const a of safe.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)){
  const id=/^(?:https:\/\/live\.nicovideo\.jp)?\/watch\/(lv\d{5,15})\/?(?:[?#][^\s]*)?$/i.exec(attr(a[1],"href"))?.[1]?.toLowerCase();if(!id)continue;
  const found=[];
  for(const [tag] of a[2].matchAll(/<img\b[^>]*>/gi)){
   if(/(?:user[-_ ]?icon|channel[-_ ]?icon|avatar|profile|badge|logo|アイコン|site_NC[UF]|cross\.png)/i.test(tag))continue;
   const images=["data-src","data-original","data-lazy-src","src"].map(k=>attr(tag,k)).filter(Boolean);
   if(images.length)found.push(images);
  }
  // A single image element in a matching watch link, not neighboring card art.
  if(found.length!==1)continue;
  const list=result.get(id)||[];
  for(const raw of found[0])if(raw.length<=2048&&!list.includes(raw)&&list.length<6)list.push(raw);
  if(list.length)result.set(id,list);
 }
 return result;
}
function nicoWatchLinkImages(html,id,groups=null){
 const values=(groups||exactWatchImageGroups(html)).get(id)||[];
 return [...new Set(values.map(raw=>{
  const listing=nicoListingThumbnail(raw,id);if(listing)return listing;
  const value=rankingImageUrl(raw);
  if(!value||nicoBrandImage(value))return "";
  const u=new URL(value);
  // CDN artwork attached to the exact program link can have an opaque URL.
  if(!(/(?:^|\.)(?:nimg|simg)\.jp$/i.test(u.hostname)||u.hostname.endsWith(".nicovideo.jp")))return "";
  if(!/(?:^|\.)(?:nimg|simg)\.jp$/i.test(u.hostname)&&!/(?:screenshot|thumbnail|liveimg|live[-_]thumb|\.(?:jpe?g|png|webp|gif|avif)$)/i.test(u.pathname))return "";
  return validatedThumb(value,"nico");
 }).filter(Boolean))].slice(0,6);
}
function nicoListingImageMap(html){
 const images=new Map();
 const groups=exactWatchImageGroups(html);
 for(const id of groups.keys()){const list=nicoWatchLinkImages(html,id,groups);if(list.length)images.set(id,list);}
 for(const [tag] of String(html).matchAll(/<img\b[^>]*>/gi)){
  if(/(?:user[-_ ]?icon|avatar|profile|badge|logo|アイコン)/i.test(tag))continue;
  for(const key of ["data-src","data-original","data-lazy-src","src"]){
   const raw=tag.match(new RegExp("(?:^|\\s)"+key+"\\s*=\\s*([\"'])(.*?)\\1","i"))?.[2];if(!raw)continue;
   const id=raw.match(/(?:^|[^a-z0-9])(lv\d{5,15})(?![a-z0-9])/i)?.[1]?.toLowerCase();if(!id)continue;
   const url=nicoListingThumbnail(raw,id);if(!url)continue;
   if(!images.has(id))images.set(id,[]);const list=images.get(id);if(list.length<4&&!list.includes(url))list.push(url);
  }
 }
 return images;
}
function nicoImageHost(host,path){
 return (host==="www.chikuwachan.com"&&path.startsWith("/live/")&&/(?:^|[^a-z0-9])lv\d{5,15}(?![a-z0-9])/i.test(path)&&/\.(?:jpe?g|png|webp)$/i.test(path))||host==="nimg.jp"||host.endsWith(".nimg.jp")||host==="simg.jp"||host.endsWith(".simg.jp")||((host==="nicovideo.jp"||host.endsWith(".nicovideo.jp"))&&(/(?:screenshot|thumbnail|liveimg|live[-_]thumb)/i.test(path)||/\.(?:jpe?g|png|webp|gif|avif)$/i.test(path)));
}
function nicoChannelOwner(p={},raw={}){
 const s=p.supplier??p.programProvider??p.provider??raw.supplier??raw.programProvider??raw.provider??{};
 const kind=String(p.providerType??s.programProviderType??s.supplierType??s.type??"").toLowerCase();
 if(kind==="user")return "";
 const ids=new Set();
 for(const v of [s.pageUrl,s.url,s.channelPageUrl]){
  if(typeof v!=="string")continue;
  const m=/^https:\/\/ch\.nicovideo\.jp\/ch([1-9]\d{0,14})(?:[/?#]|$)/i.exec(v);
  if(m)ids.add(m[1]);
 }
 const declared=String(s.programProviderId??s.supplierId??s.id??"");
 if(kind==="channel"||ids.size){const m=/^(?:ch)?([1-9]\d{0,14})$/i.exec(declared);if(m)ids.add(m[1]);}
 return ids.size===1?[...ids][0]:"";
}
function exactProgramImage(value,id){
 if(typeof value!=="string"||!/^lv\d{5,15}$/.test(id))return false;
 const path=/^https:\/\/[^/?#]+(\/[^?#]*)/i.exec(value)?.[1]||"";
 return [...path.matchAll(/(?:^|[^a-z0-9])(lv\d{5,15})(?![a-z0-9])/gi)].some(m=>m[1].toLowerCase()===id);
}
function nicoOwnerForHistory(p){
 const s=p?.supplier??p?.programProvider??p?.provider??{};
 const types=[p?.providerType,s.programProviderType,s.supplierType,s.type].filter(v=>typeof v==="string"&&v.trim()).map(v=>v.toLowerCase().trim());
 if(types.some(t=>t==="channel"||t==="official"))return "";
 const id=String(s.programProviderId??s.supplierId??s.id??p?.userId??"");
 if(types.includes("user")&&/^[1-9]\d{0,14}$/.test(id))return id;
 const url=[s.pageUrl,s.url,s.userPageUrl,s.profileUrl].find(v=>typeof v==="string"&&/^https:\/\/(?:www\.)?nicovideo\.jp\/user\/[1-9]\d{0,14}\/?$/.test(v));
 const linked=url?.match(/\/user\/(\d+)/)?.[1]||"";
 return linked&&(!id||linked===id)?linked:"";
}
function nicoHistoryImageItems(payload,id){
 const rows=payload?.data?.programsList;
 if(!Array.isArray(rows))return [];
 const item=rows.find(row=>String(row?.id?.value??row?.id??row?.program?.nicoliveProgramId??row?.program?.id?.value??row?.program?.id??"")===id);
 if(!item)return [];
 const p=item.program??item;
 return [p.thumbnail?.screenshot,item.thumbnail?.screenshot,p.screenshot,item.screenshot,p.thumbnail,item.thumbnail,p.thumbnailUrl,item.thumbnailUrl].filter(Boolean);
}
function rankingImageUrl(value) {
  if(typeof value!=="string"||value.length>2048)return "";
  try{
    const u=new URL(value.startsWith("//")?"https:"+value:value.replaceAll("&amp;","&"),"https://live.nicovideo.jp");
    if(u.protocol!=="https:"||u.username||u.password||u.port||
       !nicoImageHost(u.hostname,u.pathname))return "";
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

function nicoProviderKind(p={},raw={}){
 const s=p.programProvider??p.provider??p.supplier??raw.programProvider??raw.provider??raw.supplier??{};
 const kinds=[p.providerType,s.programProviderType,s.supplierType,s.type].filter(v=>typeof v==="string").map(v=>v.toLowerCase().trim());
 if(kinds.some(v=>v==="channel"||v==="official"))return "channel";
 if([s.pageUrl,s.url,s.channelPageUrl].some(v=>typeof v==="string"&&/^https:\/\/ch\.nicovideo\.jp\//i.test(v)))return "channel";
 if(kinds.includes("user")||[s.pageUrl,s.url,s.userPageUrl].some(v=>typeof v==="string"&&/^https:\/\/(?:www\.)?nicovideo\.jp\/user\/\d+(?:[/?#]|$)/i.test(v)))return "user";
 return "";
}
function nicoDefaultArtwork(value){
 return typeof value==="string"&&/(?:^|[\/_-])(?:default|no[-_]?image|no[-_]?thumbnail|placeholder|dummy|fallback|initial|blank)(?:[\/_.?-]|$)|\/(?:usericon|user-icon|channelicon|channel-icon|profile|avatar|icons?)\/|\/nicochannel\/material\/design\/|\/channel\/(?:icon|logo)\/|\/comch\/channel-icon\//i.test(value);
}
function nicoBrandImage(value){return nicoDefaultArtwork(value);}
function nicoPageMeta(html,key){
 for(const [tag] of String(html).matchAll(/<meta\b[^>]*>/gi)){
  const name=tag.match(/\s(?:property|name)\s*=\s*(["'])(.*?)\1/i)?.[2];
  if(name?.toLowerCase()!==key)continue;
  const value=tag.match(/\scontent\s*=\s*(["'])(.*?)\1/i)?.[2];
  if(value)return value.replaceAll("&amp;","&");
 }
 return "";
}
function nicoMetaImageValues(html,id,matched){
 const page=nicoPageMeta(html,"og:url");
 const exact=/^https:\/\/live\.nicovideo\.jp\/watch\/(lv\d{5,15})\/?(?:[?#][^\s]*)?$/i.exec(page)?.[1]?.toLowerCase();
 if((page&&exact!==id)||(!matched&&exact!==id))return [];
 return ["og:image:secure_url","og:image","twitter:image"].map(key=>nicoPageMeta(html,key)).filter(Boolean);
}
function nicoPosterForProgram(html,id,matched){
 const page=nicoPageMeta(html,"og:url");
 const exact=/^https:\/\/live\.nicovideo\.jp\/watch\/(lv\d{5,15})\/?(?:[?#][^\s]*)?$/i.exec(page)?.[1]?.toLowerCase();
 if((page&&exact!==id)||(!matched&&exact!==id))return "";
 return nicoPageMeta(html,"og:image");
}
function nicoProgramImageFields(p={}){
 return [p.thumbnail?.screenshot,p.screenshot,p.programThumbnail,p.programThumbnailUrl,p.thumbnail,p.thumbnailUrl,p.thumbnailUrlSet,p.thumbnailUrls,p.thumbnails,p.screenshotUrl,p.thumbnail?.url,p.thumbnail?.uri,p.thumbnail?.src,p.thumbnail?.urlSet,p.thumbnail?.urls,p.programIcon,p.programIconUrl,p.icon,p.iconUrl].filter(Boolean);
}
function nicoSupplierImageFields(p={},raw={}){
 const out=[];
 for(const s of [p.supplier,p.programProvider,p.provider,raw.supplier,raw.programProvider,raw.provider]){
  if(s&&typeof s==="object")out.push(s.icon,s.iconUrl,s.icons,s.thumbnail,s.thumbnailUrl,s.profileImage,s.profileImageUrl,s.logo,s.logoUrl);
 }
 return out.filter(Boolean);
}
function nicoProgramThumbnails(p={},raw={}){
 const brand=new Set(imageCandidates(...nicoSupplierImageFields(p,raw)).map(rankingImageUrl).filter(Boolean));
 return [...new Set(imageCandidates(...nicoProgramImageFields(p),...programThumbnailCandidates(p,{})).map(rankingImageUrl).filter(url=>url&&!brand.has(url)&&!nicoBrandImage(url)))].slice(0,8);
}

function contributionFromRecords(...records){
 const result={advertising:null,gift:null};
 for(const r of records){
  if(!r||typeof r!=="object")continue;
  for(const s of [r.statistics,r.stats,r]){
   if(!s||typeof s!=="object")continue;
   for(const [key,aliases] of [["advertising",["adPoints","totalAdPoints","totalNicoadPoints","advertisingPoint","advertisementPoint","nicoadPoint"]],["gift",["giftPoints","totalGiftPoints","giftPoint","totalGiftPoint"]]]){
    if(result[key]!==null)continue;
    for(const field of aliases){
     let v=s[field];if(typeof v==="string"&&/^\d{1,12}$/.test(v))v=Number(v);
     if(Number.isSafeInteger(v)&&v>=0&&v<=999999999999){result[key]=v;break;}
    }
   }
  }
 }
 return result;
}
function officialRankingSupplement(rows,source){
 const lookup=new Map((source?.rows||[]).map(r=>[r.liveId,r]));
 const coverage={status:source?.reason||"取得済み",matched:0,advertising:0,gift:0};
 for(const row of rows){
  const official=lookup.get(row.liveId);if(!official)continue;
  coverage.matched++;
  for(const key of ["advertising","gift"]){
   const v=official[key];if(!Number.isSafeInteger(v)||v<0)continue;
   coverage[key]++;
   if(row[key]==null){row[key]=v;row[key+"Source"]="ニコ生公式ランキング";}
  }
 }
 return coverage;
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
    broadcasterId,channelOwner:nicoChannelOwner(p,raw),providerKind:nicoProviderKind(p,raw),programThumbnails:nicoProgramThumbnails(p,raw),historyOwner:nicoOwnerForHistory({...p,supplier:provider}),profileUrl:nicoProfile({...p,supplier:provider}),
    startedAt:time(p.schedule?.beginTime??p.beginTime??p.beginAt??p.startTime??p.startedAt),
    iconUrl:firstRankingImage(provider.icon,provider.iconUrl,provider.icons?.large,provider.icons?.small,provider.icon?.large,provider.icon?.small,provider.thumbnailUrl),
    thumbnailUrl:programThumbnailCandidates(p,raw)[0]||"",thumbnailCandidates:programThumbnailCandidates(p,raw),
    visitors:count(statistics.watchCount??statistics.visitorCount??p.watchCount??p.visitorCount??p.viewCounter),
    comments:count(statistics.commentCount??p.commentCount??p.commentCounter),
    ...contributionFromRecords(p,raw)};
}
function labeledNicoMetrics(block){
 const text=String(block).replace(/<a\b[^>]*>[\s\S]*?<\/a\s*>/gi," ").replace(/<[^>]*>/g," ").replace(/&nbsp;|&#160;/gi," ").replace(/\s+/g," ").trim();
 const metric=(label)=>{const re=new RegExp("(?:"+label+")\\s*[:：]?\\s*(\\d{1,3}(?:,\\d{3})+|\\d{1,12})(?![\\d,])","gu");const vals=[...text.matchAll(re)].map(m=>Number(m[1].replace(/,/g,"")));return vals.length===1&&Number.isSafeInteger(vals[0])?vals[0]:null;};
 const durations=[...text.matchAll(/(?:^|\s)((?:\d+日\s*)?(?:\d+時間\s*)?\d+分)(?=\s|$)/g)];
 return {visitors:metric("👨‍👨‍👦(?:‍👦)?|来場者(?:数)?"),comments:metric("💬|コメント(?:数)?"),gift:metric("🎁|ギフト(?:ポイント|pt)?"),advertising:metric("ニコニ広告(?:ポイント|pt)?|広告(?:ポイント|pt)"),duration:durations.length===1?durations[0][1].replace(/\s+/g,""):""};
}
function publicActive10m(raw){
 const s=String(raw||"").replace(/<[^>]*>/g," ").replace(/&nbsp;|&#160;|&#xA0;/gi," ").replace(/[\s\u3000]+/g," ").trim();
 const m=[...s.matchAll(/(?:^|\s)アクティブ(?:人数)?\s*(?:[（(](?:直近)?10分[）)])?\s*[:：]?\s*(\d{1,3}(?:,\d{3})+|\d{1,12})\s*人\s*(?:[/／]\s*10\s*分)(?=\s|$)/g)];
 return m.length===1?Number(m[0][1].replace(/,/g,"")):null;
}
function parseNicoPublicMetrics(text){
 const s=String(text).replace(/<[^>]*>/g," ").replace(/&nbsp;|&#160;|&#xA0;/gi," ").replace(/[\s\u3000]+/g," ").trim();
 const value=(label,unit)=>{const re=new RegExp("(?:^|\\s)"+label+"\\s*[:：]?\\s*([0-9][0-9,]{0,15})\\s*"+unit+"(?=\\s|$)","gi");const a=[...s.matchAll(re)].map(m=>Number(m[1].replace(/,/g,"")));return a.length===1&&Number.isSafeInteger(a[0])&&a[0]>=0&&a[0]<=999999999999?a[0]:null;};
 return {advertising:value("(?:ニコニ)?広告(?:\\s*(?:累計|ポイント|pt))?","(?:pt|ポイント)"),gift:value("ギフト(?:\\s*(?:累計|ポイント|pt)|（累計pt）)?","(?:pt|ポイント)"),active10m:publicActive10m(s)??value("アクティブ(?:人数)?(?:\\s*[（(]10分[）)])?","人\\s*[/／]\\s*10\\s*分")??value("アクティブ(?:人数)?\\s*[（(](?:直近)?10分[）)]","人")};
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
    old.programThumbnails=[...new Set([...(old.programThumbnails||[]),...(row.programThumbnails||[])])].slice(0,8);
    for(const field of ["startedAt","thumbnailUrl","visitors","comments","advertising","gift","active10m","duration"]){
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
    if(existing){if(!existing.thumbnailUrl&&thumbnailUrl)existing.thumbnailUrl=thumbnailUrl;const verified=nicoWatchLinkImages(a[0],id);if(verified.length)existing.programThumbnails=[...new Set([...(existing.programThumbnails||[]),...verified])].slice(0,8);continue;}
    const title=clean(a[1].match(/\b(?:title|aria-label)\s*=\s*(["'])(.*?)\1/i)?.[2]||a[2]);
    if(!title||/^(視聴|見る|開く|放送ページ|LIVE|lv\d+)$/i.test(title))continue;
    rows.push({liveId:id,title,name:"",broadcasterId:"",startedAt:"",iconUrl:"",thumbnailUrl,programThumbnails:nicoWatchLinkImages(a[0],id),visitors:null,comments:null});
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
 for(const r of payload.data){const slug=typeof (r?.channel?.slug??r?.slug)==="string"?(r.channel?.slug??r.slug).toLowerCase():"";const viewers=r?.viewer_count;if(!/^[a-z0-9_-]{1,40}$/.test(slug)||!Number.isSafeInteger(viewers)||viewers<0){excluded++;continue;}const language=typeof (r.language_code??r.language)==="string"?(r.language_code??r.language):"";if(!language){excluded++;continue;}if(!/^ja(?:-|$)/i.test(language))continue;entries.push({id:slug,name:String(r.broadcaster_user?.username||slug).slice(0,100),title:String(r.title||r.stream_title||"タイトルなし").slice(0,250),viewers,thumbnail:kickFrameCandidates(r).map(kickExplicitImage).find(Boolean)||"",thumbnailCandidates:kickFrameCandidates(r).map(kickExplicitImage).filter(Boolean),thumbnailVerified:true,startedAt:typeof r.started_at==="string"?r.started_at:"",url:"https://kick.com/"+slug});}
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
 const imageMap=new Map(details.map(d=>[d.id,d.thumbnailCandidates||[]]));
 return rows.map(row=>{const duration=kickDuration(row.duration)||byId.get(row.id)||"";const images=[...new Set([...(imageMap.get(row.id)||[]),row.thumbnail,...(row.thumbnailCandidates||[])].filter(Boolean))].slice(0,8);return {...row,duration,thumbnail:images[0]||"",thumbnailCandidates:images,thumbnailVerified:row.thumbnailVerified===true||!!imageMap.get(row.id)?.length};});
}
function parseKickChikuwa(html){
 const safe=String(html||"").replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>/gi,"");
 const attr=(tag,key)=>tag.match(new RegExp("(?:^|\\s)"+key+"\\s*=\\s*([\"'])([\\s\\S]*?)\\1","i"))?.[2]?.replace(/&amp;/g,"&")||"";
 const plain=s=>s.replace(/<[^>]*>/g," ").replace(/&amp;/g,"&").replace(/&nbsp;|&#160;/g," ").replace(/\s+/g," ").trim();
 const anchors=[...safe.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)].map(a=>({a,id:/^https:\/\/(?:www\.)?kick\.com\/([a-z0-9_-]{1,40})\/?(?:[?#][^\s]*)?$/i.exec(attr(a[1],"href"))?.[1]?.toLowerCase()})).filter(x=>x.id);
 const rows=[],seen=new Set();
 for(let i=0;i<anchors.length&&rows.length<200;){
  const first=anchors[i],id=first.id;let j=i+1;
  while(j<anchors.length&&anchors[j].id===id)j++;
  const group=anchors.slice(i,j),end=Math.min(anchors[j]?.a.index??safe.length,group.at(-1).a.index+group.at(-1).a[0].length+6000),start=first.a.index;
  const block=safe.slice(start,end),tail=safe.slice(group.at(-1).a.index+group.at(-1).a[0].length,end);
  i=j;
  if(seen.has(id))continue;
  const markers=[...block.matchAll(/<img\b[^>]*>/gi)].map(m=>attr(m[0],"alt")).filter(v=>/^KCK_[a-z0-9_-]+$/i.test(v)).map(v=>v.slice(4).toLowerCase());
  if(!markers.includes(id)||markers.some(v=>v!==id))continue;
  const images=[];
  for(const {a} of group)for(const [tag] of a[2].matchAll(/<img\b[^>]*>/gi)){
   if(/(?:avatar|profile|logo|usericon)/i.test(tag))continue;
   for(const key of ["data-src","data-original","data-lazy-src","src"]){
    let value=attr(tag,key);
    if(value.startsWith("//"))value="https:"+value;
    if(/^https:\/\/[^/?#]+\/[^?#]*\/thumbnail\.jpe?g(?:\?[^#]*)?$/i.test(value)&&!images.includes(value)&&images.length<4)images.push(value);
   }
  }
  const values=[...plain(tail).matchAll(/(?:^|\s)(\d{1,3}(?:,\d{3})+|\d{1,10})\s*viewers\b/gi)];
  const duration=plain(tail).match(/(?:^|\s)((?:\d+日\s*)?(?:\d+時間\s*)?\d+分|\d+日\s*\d+時間|\d+時間|\d+日)(?=\s|$)/)?.[1]||"";
  const title=group.map(({a})=>plain(attr(a[1],"title")||attr(a[1],"aria-label")||a[2])).sort((a,b)=>b.length-a.length)[0]||id;
  seen.add(id);rows.push({id,name:id,title:title.slice(0,250),viewers:values.length===1?Number(values[0][1].replace(/,/g,"")):null,duration,images});
 }
 return rows;
}
function parseKickPublic(html){
 return parseKickChikuwa(html).map(({images,...row})=>{
  const candidates=images.map(v=>kickProxyImage(v)||validatedThumb(v,"kick")).filter(Boolean);
  return {...row,duration:kickDuration(row.duration),thumbnail:candidates[0]||"",thumbnailCandidates:candidates,thumbnailVerified:true};
 });
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
function nicoStatNumber(v){
 if(typeof v==="string"&&/^\d{1,12}$/.test(v))v=Number(v);
 return Number.isSafeInteger(v)&&v>=0&&v<=999999999999?v:null;
}
function parseStatsMessage(raw){
 if(typeof raw!=="string"||raw.length>65536)return null;
 try{
  const event=JSON.parse(raw);if(event.type!=="statistics"||!event.data||typeof event.data!=="object")return null;
  const contributions=contributionFromRecords(event.data);
  const advertising=contributions.advertising,gift=contributions.gift,visitors=nicoStatNumber(event.data.viewers??event.data.watchCount),comments=nicoStatNumber(event.data.comments??event.data.commentCount);
  if(advertising===null&&gift===null&&visitors===null&&comments===null)return null;
  return {advertising,gift,visitors,comments};
 }catch{return null;}
}
const RANK_CACHE_REVISION="r58";
function rankingCacheKeys(origin,type){return ["revision","last-good"].map(key=>new Request(origin+"/api/rankings/"+type+"?"+key+"="+(type==="kick"?"r70":RANK_CACHE_REVISION)));}
function statisticsEndpoint(data,id){
 if(!/^lv\d{5,15}$/.test(id)||liveId(data?.program?.nicoliveProgramId??data?.program?.programId??data?.program?.liveId??data?.program?.id?.value??data?.program?.id)!==id)return null;
 if(data?.program?.isOnAir===false)return null;
 const status=String(data.program.schedule?.status??data.program.liveStatus??data.program.status??"").toUpperCase();
 if(status&&!["ON_AIR","ONAIR","LIVE","ON AIR"].includes(status))return null;
 try{
  const u=new URL(data.site.relive.webSocketUrl);
  if(u.protocol!=="wss:"||u.username||u.password||u.port||u.hash||!/^([a-z0-9-]+\.)*live2\.nicovideo\.jp$/i.test(u.hostname)||!/^\/(?:unama\/)?wsapi\/v2\/watch\/\d+\/?$/.test(u.pathname))return null;
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
function contiguousRecentWindow(intervals,now,minSeconds=60){
 const valid=intervals.filter(x=>Number.isSafeInteger(x.start)&&Number.isSafeInteger(x.end)&&x.start<x.end&&x.end<=now&&x.end>=now-180).sort((a,b)=>b.end-a.end||a.start-b.start);
 // Include older intervals connected to the latest completed interval, even if
 // their end lies outside the recent-end tolerance.
 if(!valid.length)return null;
 const end=valid[0].end;
 let start=valid[0].start;
 const all=intervals.filter(x=>Number.isSafeInteger(x.start)&&Number.isSafeInteger(x.end)&&x.start<x.end&&x.end<=now).sort((a,b)=>b.end-a.end);
 for(const x of all){if(x.end<start)break;if(x.end>=start&&x.start<start)start=x.start;}
 return end-start>=minSeconds?{start,end}:null;
}
function activityIntervalsCover(intervals,from,to){
 let covered=from;
 for(const x of [...intervals].sort((a,b)=>a.start-b.start||b.end-a.end)){
  if(!Number.isSafeInteger(x.start)||!Number.isSafeInteger(x.end)||x.end<=x.start)continue;
  if(x.end<=covered)continue;
  if(x.start>covered)return false;
  covered=x.end;if(covered>=to)return true;
 }
 return covered>=to;
}
function historyReady(hasBackward,hasPrevious,hasNext,ended){return !!(hasBackward&&(hasPrevious||hasNext||ended)||hasPrevious&&(hasNext||ended));}
function activityAggregate(events,end,coveredSince,startedAt=null,exhausted=false){
 if(!Number.isSafeInteger(end)||!Number.isSafeInteger(coveredSince)||coveredSince>end)return {active10m:null,active60s:null};
 const count=seconds=>{
  const from=end-seconds;
  if(coveredSince>from&&!(exhausted&&Number.isSafeInteger(startedAt)&&startedAt<=end&&coveredSince>=startedAt))return null;
  const users=new Set();for(const e of events){if(e.at>from&&e.at<=end){if(!e.sender)return null;users.add(e.sender);}}return users.size;
 };
 return {active10m:count(600),active60s:count(60)};
}
function activityFeedUrl(raw){
 try{const u=new URL(raw);if(u.protocol!=="https:"||u.username||u.password||u.port||u.hash||u.hostname!=="mpn.live.nicovideo.jp"||!/^\/(?:api\/view|data\/[a-z0-9_-]+|api\/(?:segment|backward|packed))\//i.test(u.pathname))return null;return u;}catch{return null;}
}
async function nicoFetchNoRedirect(url,options={},fetcher=fetch){
 const response=await fetcher(url,{...options,redirect:"manual"});
 if(response.status>=300&&response.status<400){
  try{await response.body?.cancel();}catch{}
  throw Error("HTTP "+response.status);
 }
 return response;
}
async function activityBytes(url,signal){
 const res=await nicoFetchNoRedirect(url,{signal});if(!res.ok||!res.body)throw Error("HTTP "+res.status);
 const reader=res.body.getReader();const chunks=[];let total=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>2097152)throw Error("feed too large");chunks.push(value);}}finally{try{await reader.cancel();}catch{}}
 const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
async function* activityFrames(url,signal){
 const res=await nicoFetchNoRedirect(url,{signal});if(!res.ok||!res.body)throw Error("HTTP "+res.status);
 const reader=res.body.getReader();let pending=new Uint8Array(),total=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>2097152)throw Error("feed too large");const bytes=new Uint8Array(pending.length+value.length);bytes.set(pending);bytes.set(value,pending.length);let offset=0;
 while(offset<bytes.length){const c={pos:offset};let length;try{length=Number(activityVarint(bytes,c));}catch{break;}if(!Number.isSafeInteger(length)||length>1048576)throw Error("invalid frame");if(bytes.length-c.pos<length)break;yield activityFields(bytes.subarray(c.pos,c.pos+length));offset=c.pos+length;}pending=bytes.slice(offset);}
 if(pending.length)throw Error("truncated feed");
 }finally{try{await reader.cancel();}catch{}}
}
// Adapted from the uploaded worker/activity.mjs. One closed history snapshot,
// no continuous listener, no persisted comment contents or sender identifiers.

function recentActivityCount(events,start,end){
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=end||end-start>600)return {};
 const ids=new Set();
 for(const event of events){
  if(event.at<=start||event.at>end)continue;
  if(!event.sender)return {};
  ids.add(event.sender);
 }
 return {activeRecent:ids.size,activityRecentSeconds:end-start,activityRecentEnd:end};
}
async function sampleNicoActivity(raw,startedAt){
 const view=activityFeedUrl(raw);if(!view)return {activityStage:"履歴URL未対応"};
 const signal=AbortSignal.timeout(19000),now=Math.floor(Date.now()/1000);
 const decode=b=>b instanceof Uint8Array?activityFeedUrl(new TextDecoder().decode(b)):null;
 const stamp=b=>b instanceof Uint8Array?Number(activityFields(b).get(1)):NaN;
 view.searchParams.set("at","now");
 let back=null,previous=null,events=[],unknownTime=false,historyStage="履歴接続中",exhausted=false,partial=null;
 function record(chunk){
  if(!chunk.has(2))return;
  const message=activityFields(chunk.get(2)),raw=message.get(1)||message.get(20);if(!raw)return;
  const meta=chunk.get(1);const at=meta instanceof Uint8Array?stamp(activityFields(meta).get(2)):NaN;
  if(!Number.isSafeInteger(at)){unknownTime=true;return;}
  if(at<now-900||at>now+2)return;
  const chat=activityFields(raw),sender=typeof chat.get(5)==="bigint"&&chat.get(5)>0n?"u"+String(chat.get(5)):chat.get(6) instanceof Uint8Array&&chat.get(6).length?"h"+new TextDecoder().decode(chat.get(6)):null;
  if(events.length>=20000)throw Error("too many comments");events.push({at,sender});
 }
 try{
  const readHistory=async()=>{
   if(!back&&!previous)return {activityStage:"過去履歴接続先未受信"};
   const joined=back&&previous&&previous.start<=back.end&&previous.end>=back.end;
   const sampleEnd=joined?previous.end:back?back.end:previous.end;
   let covered=sampleEnd;
   if(joined||!back){historyStage="直前セグメント";for await(const chunk of activityFrames(previous.url,signal))record(chunk);covered=previous.start;}
   if(back){
    historyStage="過去セグメント";
    let url=back.url,oldest=back.end;const seen=new Set();
    for(let i=0;url&&i<16;i++){
     if(seen.has(url.href))throw Error("repeated history");seen.add(url.href);
     const packet=activityFields(await activityBytes(url,signal),1,b=>{
      const chunk=activityFields(b);if(!chunk.has(1))return;
      const at=stamp(activityFields(chunk.get(1)).get(2));if(!Number.isSafeInteger(at)){if(chunk.has(2))unknownTime=true;return;}
      oldest=Math.min(oldest,at);record(chunk);
     });
     covered=Math.min(covered,oldest);
     if(covered<=sampleEnd-600)break;
     if(!packet.has(2)){exhausted=true;break;}
     url=decode(activityFields(packet.get(2)).get(1));if(!url)return {activityStage:"過去履歴URL形式未対応"};
    }
   }
   if(unknownTime)return {activityStage:"履歴時刻未取得"};
   const start=Math.floor(Date.parse(startedAt)/1000),result=activityAggregate(events,sampleEnd,covered,Number.isSafeInteger(start)?start:null,exhausted);
   return {...result,activitySampleEnd:sampleEnd,activityStage:result.active10m!=null?"10分履歴取得済み":events.some(e=>e.at>sampleEnd-600&&e.at<=sampleEnd&&!e.sender)?"投稿者ID欠落":"10分履歴不足"};
  };
  // MessageStream supports both segment (field 1) and previous (field 3).
  // When now supplies only a cursor/forward entries, request a bounded
  // historical view using the same public view URI and numeric at.
  const readView=async(at,firstClosed=false)=>{
   const u=new URL(view.href);u.searchParams.set("at",String(at));
   const segments=[];let next=null;
   for await(const e of activityFrames(u,signal)){
    if(e.has(2)){const entry=activityFields(e.get(2)),end=stamp(entry.get(1)),url=entry.has(2)?decode(activityFields(entry.get(2)).get(1)):null;
     if(url&&end<=now+2&&end>=now-180){back={end,url};if(firstClosed)break;}}
    for(const field of [1,3])if(e.has(field)){
     const info=activityFields(e.get(field)),start=stamp(info.get(1)),end=stamp(info.get(2)),url=decode(info.get(3));
     if(url&&Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start<end&&end<=now&&end>=now-900){
      segments.push({start,end,url});if(field===3&&end>=now-180)previous={start,end,url};
     }
    }
    if(firstClosed&&segments.some(x=>x.end>=now-180))break;
    if(e.has(4)){next=Number(activityFields(e.get(4)).get(1));break;}
    if(segments.length>=64)break;
   }
   return {segments,next};
  };
  const initial=await readView("now",true);
  // Original Sites behavior: immediately read one recently completed
  // segment instead of waiting for the full ten-minute view chain.
  const recent=initial.segments.filter(x=>x.end>=now-180).sort((a,b)=>b.end-a.end)[0];
  if(recent&&!back){
   historyStage="直近コメント区間";
   for await(const chunk of activityFrames(recent.url,signal))record(chunk);
   if(!unknownTime){
    const start=Math.max(recent.start,recent.end-600);
    const measured=recentActivityCount(events,start,recent.end);
    const exact=activityAggregate(events,recent.end,start);
    if(measured.activeRecent!=null){
     partial={...exact,...measured,activitySampleEnd:recent.end,activityStage:exact.active10m!=null?"10分履歴取得済み":"直近完了区間の実測取得済み"};
     if(exact.active10m!=null)return partial;
    }
   }
  }
  if(back){
   const result=await readHistory();
   if(result.active10m!=null)return result;
   if(result.active60s!=null)partial={...result,activeRecent:result.active60s,activityRecentSeconds:60,activityRecentEnd:result.activitySampleEnd};
  }
  // Discard partial backward samples before trying the ordinary segment route.
  events=[];unknownTime=false;
  historyStage="時刻指定履歴";
  const targetEnd=now-10,targetStart=targetEnd-600,all=new Map(),cursors=new Set();
  for(const seg of initial.segments)if(seg.end>now-900&&seg.end<=now)all.set(seg.url.href,seg);
  let cursor=targetStart;
  for(let page=0;page<8;page++){
   if(cursors.has(cursor))break;cursors.add(cursor);
   const response=await readView(cursor);
   for(const seg of response.segments)if(seg.end>targetStart&&seg.start<targetEnd)all.set(seg.url.href,seg);
   if(activityIntervalsCover([...all.values()],targetStart,targetEnd))break;
   const discovered=Math.max(cursor,...response.segments.map(x=>x.end));
   const next=Number.isSafeInteger(response.next)&&response.next>cursor&&response.next<=now?response.next:discovered;
   if(next<=cursor||next>now)break;cursor=next;
  }
  const window=contiguousRecentWindow([...all.values()],now);
  if(!window)return partial||{activityStage:all.size?"時刻指定履歴不足（連続1分未満）":"過去履歴接続先未受信"};
  const end=window.end,from=Math.max(window.start,end-600);
  const intervals=[...all.values()].filter(x=>x.end>from&&x.start<end).sort((a,b)=>a.start-b.start);
  if(intervals.length>32)return partial||{activityStage:"履歴セグメント上限"};
  // Only count completed segments, never claim continuous coverage of missing intervals.
  const completed=[];
  for(let i=0;i<intervals.length;i+=3){
   await Promise.all(intervals.slice(i,i+3).map(async seg=>{
    for await(const chunk of activityFrames(seg.url,signal))record(chunk);
    completed.push(seg);
   }));
  }
  if(unknownTime||!activityIntervalsCover(completed,from,end))return partial||{activityStage:"履歴時刻または範囲不足"};
  const result=activityAggregate(events,end,from),measured=recentActivityCount(events,from,end);
  if(result.active10m==null&&result.active60s==null&&partial)return partial;
  return {...result,...measured,activitySampleEnd:end,activityStage:result.active10m!=null?"10分履歴取得済み":result.active60s!=null?"10分履歴不足・1分実測取得済み":"投稿者ID欠落"};
 }catch(e){return partial||{activityStage:historyStage+"："+diagnostic(e)};}
}
function watchStartRequest(){return {type:"startWatching",data:{stream:{quality:"abr",protocol:"hls",latency:"low",chasePlay:false},room:{protocol:"webSocket",commentable:false},reconnect:false}};}
function watchErrorLabel(message){
 const code=String(message?.data?.code??message?.data?.reason??"");
 return /^[A-Z][A-Z0-9_]{1,60}$/.test(code)?code:"詳細なし";
}
async function fetchNicoStatistics(endpoint,wantActivity=false,startedAt=""){
 if(!endpoint)return {watchStage:"視聴接続先未取得"};
 let ws;
 try{
  // A single deadline covers the handshake and short read. Do not abort
  // a successful upgraded connection at the old four-second deadline.
  const signal=AbortSignal.timeout(34000);
  const response=await nicoFetchNoRedirect(endpoint,{headers:{Upgrade:"websocket",Origin:"https://live.nicovideo.jp"},signal});
  ws=response.webSocket;
  if(!ws){const status=response.status;try{await response.body?.cancel();}catch{}return {watchStage:"視聴接続 HTTP "+status};}
  return await new Promise(resolve=>{
   let done=false,latest=null,timer,seatTimer,viewReceived=false,activityRunning=false,activity=null,activityStage="",watchStage="接続成功・statistics未受信";
   function finish(reason){if(done)return;done=true;clearTimeout(timer);clearInterval(seatTimer);signal.removeEventListener("abort",onAbort);try{ws.close(1000,"statistics complete");}catch{}resolve({...latest,...activity,watchStage:latest?(latest.advertising!=null&&latest.gift!=null?"広告・ギフト受信済み":"statistics受信・広告またはギフトなし"):reason||watchStage,activityStage:activityStage||"コメント履歴接続先未取得"});}
   function onAbort(){finish("視聴通信タイムアウト");}
   function maybeFinish(){if(latest?.advertising!=null&&latest?.gift!=null&&(!wantActivity||(viewReceived&&!activityRunning)))finish();}
   function send(value){if(done)return;try{ws.send(JSON.stringify(value));}catch{finish("視聴メッセージ送信失敗");}}
   timer=setTimeout(()=>finish(),wantActivity?29000:12000);
   signal.addEventListener("abort",onAbort,{once:true});
   ws.addEventListener("close",event=>{if(activityRunning){watchStage="視聴接続終了・履歴取得中";return;}finish("視聴接続切断 "+(Number.isInteger(event.code)?event.code:"詳細なし"));});
   ws.addEventListener("error",()=>{if(activityRunning){watchStage="視聴接続エラー・履歴取得中";return;}finish("視聴接続エラー");});
   ws.addEventListener("message",event=>{
    if(done)return;
    let raw=event.data;
    if(raw instanceof ArrayBuffer){if(raw.byteLength>65536)return;raw=new TextDecoder().decode(raw);}
    if(typeof raw!=="string"||raw.length>65536)return;
    const stat=parseStatsMessage(raw);
    if(stat){latest={advertising:stat.advertising??latest?.advertising??null,gift:stat.gift??latest?.gift??null,visitors:stat.visitors??latest?.visitors??null,comments:stat.comments??latest?.comments??null};maybeFinish();return;}
    try{
     const message=JSON.parse(raw);
     if(message.type==="ping")send({type:"pong"});
     else if(message.type==="seat"){clearInterval(seatTimer);const seconds=Math.max(10,Math.min(300,Number(message.data?.keepIntervalSec)||30));seatTimer=setInterval(()=>send({type:"keepSeat"}),seconds*1000);}
     else if(message.type==="messageServer"&&wantActivity&&!viewReceived){
      const view=activityFeedUrl(message.data?.viewUri);
      if(view){viewReceived=true;activityRunning=true;activityStage="コメント履歴取得中";
       sampleNicoActivity(view.href,startedAt).then(result=>{if(done)return;activity=result;activityRunning=false;activityStage=result?.activityStage||"コメント履歴取得失敗";maybeFinish();}).catch(()=>{if(done)return;activityRunning=false;activityStage="コメント履歴取得失敗";maybeFinish();});
      }else activityStage="コメント履歴URL形式未対応";
     }else if(message.type==="disconnect"||message.type==="error"){if(activityRunning)watchStage="視聴サーバー "+watchErrorLabel(message);else finish("視聴サーバー "+watchErrorLabel(message));}
    }catch{}
   });
   try{ws.accept();send(watchStartRequest());}catch{finish("視聴接続初期化失敗");}
  });
 }catch(e){try{ws?.close(1000,"statistics unavailable");}catch{}return {watchStage:"視聴接続: "+diagnostic(e)};}
}

function publicNicoDetail(html,id){
 for(const tag of String(html||"").matchAll(/<[^>]+\bid\s*=\s*(["'])embedded-data\1[^>]*>/gi)){
  const attr=tag[0].match(/\bdata-props\s*=\s*(["'])([\s\S]*?)\1/i)?.[2];if(!attr)continue;
  try{const data=JSON.parse(attr.replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&"));
   const p=data?.program;if(!p||liveId(p.nicoliveProgramId??p.programId??p.liveId??p.id?.value??p.id)!==id)continue;
   const status=String(p.schedule?.status??p.liveStatus??p.status??"").toUpperCase();if(status&&!["ON_AIR","ONAIR","LIVE","ON AIR"].includes(status))continue;
   const stats=p.statistics??p.stats??data.statistics??{},v=contributionFromRecords(p,data),images=programThumbnailCandidates(p,data);
   const brand=new Set(imageCandidates(...nicoSupplierImageFields(p,data)).map(rankingImageUrl).filter(Boolean));
   const posters=nicoMetaImageValues(html,id,true).map(rankingImageUrl).filter(url=>url&&!brand.has(url)&&!nicoBrandImage(url));
   const screenshotThumbnails=imageCandidates(p.screenshot?.urlSet,p.screenshot?.urls,p.screenshot,p.thumbnail?.screenshot).map(rankingImageUrl).filter(url=>url&&!brand.has(url)&&!nicoBrandImage(url));
   const programThumbnails=[...new Set([...screenshotThumbnails,...posters,...nicoProgramThumbnails(p,data),...imageCandidates(p.thumbnail?.large,p.thumbnail?.middle,p.thumbnail?.small).map(rankingImageUrl).filter(v=>v&&!brand.has(v)&&!nicoBrandImage(v))])].slice(0,12);
   return {channelOwner:nicoChannelOwner(p,data),providerKind:nicoProviderKind(p,data),programThumbnails,profileUrl:nicoProfile(p),historyOwner:nicoOwnerForHistory(p),name:clean(p.supplier?.name??p.programProvider?.name,80),advertising:v.advertising,gift:v.gift,visitors:count(stats.watchCount??stats.visitorCount??stats.viewers??stats.viewCount??p.watchCount),comments:count(stats.commentCount??stats.comments??p.commentCount),startedAt:time(p.schedule?.beginTime??p.beginTime??p.beginAt),thumbnailUrl:images[0]||"",thumbnailCandidates:images,statisticsEndpoint:statisticsEndpoint(data,id)};
  }catch{}
 }
 return null;
}
// Bounded lookups with per-program Cache API entries. No shared I/O promises.
async function enrichPublicNico(rows,origin){
 const candidates=rows.slice(0,10).filter(r=>!r.profileUrl||!r.thumbnailUrl||r.advertising==null||r.gift==null||r.active10m==null||!r.startedAt||r.visitors==null||r.comments==null);
 const missing=[];
 function apply(row,detail){if(!detail)return;for(const k of ["name","profileUrl","historyOwner","channelOwner","providerKind","advertising","gift","visitors","comments","startedAt","thumbnailUrl","active10m","active60s","activitySampleEnd"])if((row[k]==null||row[k]==="")&&detail[k]!=null&&detail[k]!=="")row[k]=detail[k];row.thumbnailCandidates=[...new Set([row.thumbnailUrl,...(row.thumbnailCandidates||[]),...(detail.thumbnailCandidates||[])].filter(Boolean))].slice(0,8);row.programThumbnails=[...new Set([...(detail.programThumbnails||[]),...(row.programThumbnails||[])])].slice(0,8);}
 const rotation=Math.floor(Date.now()/10000)%10;const ordered=[...candidates].sort((a,b)=>((rows.indexOf(a)-rotation+10)%10)-((rows.indexOf(b)-rotation+10)%10));
 for(const row of ordered){const key=new Request(origin+"/__cache/nico-detail/"+row.liveId+"?r58");try{const cached=await caches.default.match(key);if(cached){apply(row,await cached.json());continue;}}catch{}missing.push({row,key});}
 await Promise.all(missing.slice(0,3).map(async({row,key})=>{
  let detail=null;
  try{detail=publicNicoDetail(await fetchBounded("https://live.nicovideo.jp/watch/"+row.liveId,{headers:{accept:"text/html"}}),row.liveId);if(detail)delete detail.statisticsEndpoint;}catch{}
  apply(row,detail);
  try{await caches.default.put(key,json(detail,200,"public, max-age="+(detail?120:60)));}catch{}
 }));

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
 const key=new Request(origin+"/__cache/nico-ran-public-r41");
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
  const known=new Set(rows.map(row=>row.liveId));for(const row of structured){if(!known.has(row.liveId)&&[row.advertising,row.gift,row.active10m].some(v=>Number.isSafeInteger(v)&&v>=0)){rows.push(row);known.add(row.liveId);}}
  result={source,rows,reason:rows.length?"取得済み":"番組別の公開統計がHTMLにありません"};
 }catch(e){result={source,rows:[],reason:"接続失敗: "+diagnostic(e)};}
 try{await caches.default.put(key,json(result,200,"public, max-age=60"));}catch{}
 return result;
}
async function nicoRanking(origin){
 const rssRequest=fetchBounded("https://live.nicovideo.jp/recent/rss?tab=live",{headers:{accept:"application/rss+xml,application/xml"}},2*1024*1024).then(parseArchiveRss).catch(()=>new Map());
 const sources=[{name:"勢いランキング",url:"https://ikioi-ranking.com/v/nico"},{name:"ちくわちゃん",url:"https://www.chikuwachan.com/live/NCU/"},{name:"nico-ran.stream",url:"https://nico-ran.stream/"},{name:"ニコ生公式ランキング",url:"https://live.nicovideo.jp/ranking"}];
 const results=await Promise.all(sources.map(async source=>{if(source.name==="nico-ran.stream")return fetchNicoReferencePage(origin,source);try{const html=await fetchBounded(source.url,{headers:{accept:"text/html,application/json;q=0.9"}});let rows=[];if(source.name==="勢いランキング")rows=parseArchiveRanking(html,"nico");else{try{rows=unique(extractJsonRows(JSON.parse(html)));}catch{}if(!rows.length)rows=parseRankingPage(html);}if(source.name==="ちくわちゃん"){supplementNicoHtml(html,rows);const images=nicoListingImageMap(html);for(const row of rows){const found=images.get(row.liveId)||[];row.programThumbnails=[...new Set([...(row.programThumbnails||[]),...found])].slice(0,9);}}if(source.name==="nico-ran.stream"){const cards=parseNicoRanCards(html);if(cards.length){const map=new Map(rows.map(r=>[r.liveId,r]));rows=cards.map(card=>{const r=map.get(card.liveId)||{};return {...r,...card,name:card.name||r.name||"",profileUrl:card.profileUrl||r.profileUrl||"",visitors:card.visitors??r.visitors??null,comments:card.comments??r.comments??null,active10m:card.active10m??r.active10m??null,advertising:card.advertising??r.advertising??null,gift:card.gift??r.gift??null};});}}return {source,rows,reason:rows.length?"":"番組データなし"};}catch(e){return {source,rows:[],reason:diagnostic(e)};}}));
 const best=selectNicoReference(results)||selectRankingSource(results.filter(r=>r.source.name!=="nico-ran.stream"))||selectRankingSource(results);if(best){const preferred=results.find(r=>r.source.name==="nico-ran.stream");if(preferred){const map=new Map(preferred.rows.map(r=>[r.liveId,r]));for(const row of best.rows){const other=map.get(row.liveId);if(other){for(const k of ["advertising","gift","active10m"])if(other[k]!=null)row[k]=other[k];}}}}if(best)for(const result of results){if(result!==best){const lookup=new Map(result.rows.map(r=>[r.liveId,r]));for(const row of best.rows){const other=lookup.get(row.liveId);if(!other)continue;row.programThumbnails=[...new Set([...(row.programThumbnails||[]),...(other.programThumbnails||[])])].slice(0,8);for(const k of ["name","profileUrl","historyOwner","channelOwner","providerKind","visitors","comments","gift","advertising","startedAt","duration","thumbnailUrl","active10m","momentum"])if((row[k]==null||row[k]==="")&&other[k]!=null&&other[k]!==""){row[k]=other[k];if((k==="advertising"||k==="gift")&&result.source.name==="ニコ生公式ランキング")row[k+"Source"]="ニコ生公式ランキング";}}}}
 const officialCoverage=best?officialRankingSupplement(best.rows.slice(0,10),results.find(r=>r.source.name==="ニコ生公式ランキング")):null;
 const rss=await rssRequest;if(best){for(const row of best.rows.slice(0,10)){const image=rankingImageUrl(rss.get(row.liveId));if(image&&!nicoBrandImage(image)){row.rssThumbnail=image;row.programThumbnails=[...new Set([...(row.programThumbnails||[]),image])].slice(0,9);row.thumbnailCandidates=[...new Set([row.thumbnailUrl,...(row.thumbnailCandidates||[]),image].filter(Boolean))].slice(0,8);if(!row.thumbnailUrl)row.thumbnailUrl=image;}}await enrichPublicNico(best.rows,origin);}
 if(best)return {source:best.source.name,sourceUrl:best.source.url,complete:false,metric:best.source.name==="勢いランキング"?"公開勢いポイント順":best.source.name==="nico-ran.stream"?"nico-ran.stream掲載順（参考順位）":"公開掲載順（参考順位）",coverage:nicoReferenceCoverage(best.rows.slice(0,10),results.find(r=>r.source.name==="nico-ran.stream")),officialCoverage,fetchedAt:new Date().toISOString(),entries:best.rows.slice(0,10).map(r=>({id:r.liveId,name:r.name,profileUrl:r.profileUrl||"",historyOwner:r.historyOwner||"",channelOwner:r.channelOwner||"",providerKind:r.providerKind||"",programThumbnails:r.programThumbnails||[],rssThumbnail:r.rssThumbnail||"",title:r.title,url:"https://live.nicovideo.jp/watch/"+r.liveId,momentum:r.momentum??null,visitors:r.visitors??null,comments:r.comments??null,active10m:r.active10m??null,active60s:r.active60s??null,activitySampleEnd:r.activitySampleEnd??null,advertising:r.advertising??null,gift:r.gift??null,advertisingSource:r.advertisingSource||"",giftSource:r.giftSource||"",duration:r.duration||'',startedAt:r.startedAt,thumbnail:r.providerKind==="channel"?(r.programThumbnails?.[0]||""):r.thumbnailUrl,thumbnailCandidates:r.providerKind==="channel"?(r.programThumbnails||[]):(r.thumbnailCandidates||[])}))};
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
function kickChatTime(value){
 if(typeof value!=="string")return NaN;
 // Kick's older public endpoint uses timezone-less UTC timestamps.
 return Date.parse(/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(?:\.\d+)?$/.test(value)?value.replace(" ","T")+"Z":value);
}
function kickChatId(value){
 if(typeof value==="number")return Number.isSafeInteger(value)&&value>0?String(value):"";
 return typeof value==="string"&&value.length<=128&&/^[a-zA-Z0-9_-]+$/.test(value)?value:"";
}
function recentKickSample(payload,roomId,startedAt,now){
 const messages=payload?.data?.messages;
 if(!Array.isArray(messages)||!messages.length||messages.length>1000||!Number.isFinite(startedAt)||startedAt>now)return null;
 const cutoff=Math.max(startedAt,now-60000),ids=new Set(),senders=new Set();
 let covered=false,missingSender=false,valid=0,uncertain=false;
 for(const msg of messages){
  if(!msg||typeof msg!=="object"){uncertain=true;continue;}
  // The fixed channel endpoint is already scoped to the verified channel.
  // Reject explicit room mismatches; older responses may omit chatroom_id.
  if(msg.chatroom_id!=null&&(!roomId||String(msg.chatroom_id)!==String(roomId))){uncertain=true;continue;}
  const at=kickChatTime(msg.created_at),id=kickChatId(msg.id);
  if(!id||!Number.isFinite(at)||at>now){uncertain=true;continue;}
  valid++;
  if(at<=cutoff){covered=true;continue;}
  if(msg.type!=null&&!["message","reply"].includes(msg.type)){uncertain=true;continue;}
  if(ids.has(id))continue;
  ids.add(id);
  const sender=kickChatId(msg.sender?.id);
  if(sender&&/^[1-9]\d*$/.test(sender))senders.add(sender);else missingSender=true;
 }
 if(!valid)return null;
 const complete=covered&&!uncertain;
 // Never report zero from an empty/unrecognized/truncated snapshot.
 if(!ids.size&&!complete)return null;
 return {receivedComments:ids.size,activeUsers:missingSender?null:senders.size,chatPartial:!complete,chatWindowSeconds:Math.max(1,Math.ceil((now-cutoff)/1000)),sampledAt:new Date(now).toISOString()};
}
function officialGiftCount(value){if(typeof value==="string"&&/^\d{1,12}$/.test(value))value=Number(value);return Number.isSafeInteger(value)&&value>=0&&value<=999999999999?value:null;}
function officialGiftEvent(type,payload,now){
 const broadcaster=officialGiftCount(payload?.broadcaster?.user_id),at=Date.parse(payload?.created_at);
 if(!broadcaster||!Number.isFinite(at)||at>now+60000||at<now-86400000)return null;
 let amount=null;
 if(type==="kicks.gifted")amount=officialGiftCount(payload.gift?.amount);
 else if(type==="channel.subscription.gifts"&&Array.isArray(payload.giftees)&&payload.giftees.length<=1000)amount=payload.giftees.length;
 return amount>0?{broadcaster,at,amount,type}:null;
}
function kickGiftedSubs(payload,slug){
 const rows=payload?.data;if(!Array.isArray(rows))return null;
 const matches=rows.filter(x=>typeof x?.slug==="string"&&x.slug.toLowerCase()===slug);
 return matches.length===1?officialGiftCount(matches[0].active_gifted_subscribers_count):null;
}
async function kickGiftKey(){
 const raw=await fetchBounded("https://api.kick.com/public/v1/public-key",{headers:{accept:"application/json,text/plain"}},16384);
 let pem=raw;
 try{const p=JSON.parse(raw);pem=p?.data?.public_key??p?.public_key??p?.data;}catch{}
 if(typeof pem!=="string"||!/^-----BEGIN PUBLIC KEY-----[\s\S]+-----END PUBLIC KEY-----\s*$/.test(pem.trim()))throw Error("invalid key");
 const der=Uint8Array.from(atob(pem.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g,"")),c=>c.charCodeAt(0));
 return crypto.subtle.importKey("spki",der,{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["verify"]);
}
function giftAllowedIds(env){return String(env.KICK_GIFT_SUBSCRIPTION_IDS||"").split(/[,\s]+/).map(x=>x.trim().toUpperCase()).filter(x=>/^[0-9A-HJKMNP-TV-Z]{26}$/.test(x));}
function giftSubscriptionRows(payload){if(!Array.isArray(payload?.data))throw Error("invalid subscriptions");return payload.data.filter(x=>x?.method==="webhook"&&Number(x.version)===1&&["kicks.gifted","channel.subscription.gifts"].includes(x.event)&&/^[0-9A-HJKMNP-TV-Z]{26}$/i.test(x.id||"")&&officialGiftCount(x.broadcaster_user_id)>0);}
function giftSubscriptionMatch(rows,id,event){return rows.some(x=>x.id.toUpperCase()===id.toUpperCase()&&x.event===event.type&&officialGiftCount(x.broadcaster_user_id)===event.broadcaster);}
async function verifyGiftSubscription(env,id,event){
 const configured=String(env.KICK_GIFT_SUBSCRIPTION_IDS||"").trim();
 if(configured)return giftAllowedIds(env).includes(id.toUpperCase());
 if(!env.KICK_CLIENT_ID||!env.KICK_CLIENT_SECRET)throw Error("missing API credentials");
 const token=await kickToken(env),url="https://api.kick.com/public/v1/events/subscriptions?broadcaster_user_id="+event.broadcaster;
 const payload=JSON.parse(await fetchBounded(url,{headers:{authorization:"Bearer "+token,accept:"application/json"}},1024*1024));
 return giftSubscriptionMatch(giftSubscriptionRows(payload),id,event);
}
function giftWebhookResult(status,stage){console.log("kick-gift-webhook",status,stage);return new Response(null,{status});}
async function kickGiftWebhook(request,env){
 if(request.method!=="POST")return new Response(null,{status:405});
 if(!env.KICK_GIFT_DB)return giftWebhookResult(503,"db_binding_missing");
 const type=request.headers.get("Kick-Event-Type"),version=request.headers.get("Kick-Event-Version");
 if(!["kicks.gifted","channel.subscription.gifts"].includes(type)||version!=="1")return new Response(null,{status:400});
 const id=request.headers.get("Kick-Event-Message-Id")||"",subscription=request.headers.get("Kick-Event-Subscription-Id")||"",stamp=request.headers.get("Kick-Event-Message-Timestamp")||"",signature=request.headers.get("Kick-Event-Signature")||"";
 const configured=String(env.KICK_GIFT_SUBSCRIPTION_IDS||"").trim();
 const now=Date.now(),sent=Date.parse(stamp);
 if(!/^[0-9A-HJKMNP-TV-Z]{26}$/i.test(id)||!/^[0-9A-HJKMNP-TV-Z]{26}$/i.test(subscription)||(configured&&!giftAllowedIds(env).includes(subscription.toUpperCase()))||!Number.isFinite(sent)||sent>now+60000||sent<now-86400000||!signature||signature.length>2048)return new Response(null,{status:403});
 if(!request.body||Number(request.headers.get("content-length")||0)>262144)return new Response(null,{status:413});
 let raw;try{
  const reader=request.body.getReader(),chunks=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>262144){await reader.cancel();return new Response(null,{status:413});}chunks.push(value);}}finally{reader.releaseLock();}
  raw=new Uint8Array(size);let offset=0;for(const chunk of chunks){raw.set(chunk,offset);offset+=chunk.length;}
 }catch{return new Response(null,{status:400});}
 try{
  const key=await kickGiftKey(),prefix=new TextEncoder().encode(id+"."+stamp+"."),signed=new Uint8Array(prefix.length+raw.length);
  signed.set(prefix);signed.set(raw,prefix.length);
  if(!await crypto.subtle.verify("RSASSA-PKCS1-v1_5",key,Uint8Array.from(atob(signature),c=>c.charCodeAt(0)),signed))return new Response(null,{status:403});
 }catch{return new Response(null,{status:503});}
 let event;try{event=officialGiftEvent(type,JSON.parse(new TextDecoder().decode(raw)),now);}catch{return new Response(null,{status:400});}
 if(!event)return giftWebhookResult(400,"payload_invalid");
 try{if(!await verifyGiftSubscription(env,subscription,event))return giftWebhookResult(403,"subscription_not_matched");}catch{return giftWebhookResult(503,"subscription_api_unavailable");}
 try{
  // Store only the verified event ID, public channel ID, time, and aggregate amount.
  // INSERT OR IGNORE makes repeated delivery idempotent.
  await env.KICK_GIFT_DB.batch([
   env.KICK_GIFT_DB.prepare("INSERT OR IGNORE INTO kick_gift_events (event_id,broadcaster_id,kind,occurred_at,amount) VALUES (?,?,?,?,?)").bind(id,event.broadcaster,event.type,event.at,event.amount),
   env.KICK_GIFT_DB.prepare("DELETE FROM kick_gift_events WHERE occurred_at < ?").bind(now-86400000)
  ]);
  return giftWebhookResult(204,"stored_or_duplicate");
 }catch{return giftWebhookResult(503,"db_write_failed");}
}
async function enrichOfficialKickGiftEvents(rows,env){
 for(const row of rows){row.kicksGiftStage=!env.KICK_GIFT_DB?"ギフト受信DB未設定":!env.KICK_GIFT_SUBSCRIPTION_IDS&&!(env.KICK_CLIENT_ID&&env.KICK_CLIENT_SECRET)?"Webhook購読認証未設定":!row.kickOfficialId?"公式配信者ID未取得":"公式ギフトイベント受信待ち";}
 if(!env.KICK_GIFT_DB)return;
 const ids=[...new Set(rows.map(r=>r.kickOfficialId).filter(v=>Number.isSafeInteger(v)&&v>0))];
 if(!ids.length)return;
 try{
  const now=Date.now();
  const query="SELECT broadcaster_id, kind, SUM(amount) AS total FROM kick_gift_events WHERE occurred_at >= ? AND occurred_at <= ? AND broadcaster_id IN ("+ids.map(()=>"?").join(",")+") GROUP BY broadcaster_id,kind";
  const result=await env.KICK_GIFT_DB.prepare(query).bind(now-86400000,now,...ids).all();
  for(const item of result.results||[]){
   const row=rows.find(r=>r.kickOfficialId===officialGiftCount(item.broadcaster_id)),total=officialGiftCount(item.total);
   if(!row||total==null)continue;
   if(item.kind==="kicks.gifted"){row.kicksGift=total;row.kicksGiftStage="公式Webhook・直近24時間受信分";}
   if(item.kind==="channel.subscription.gifts")row.giftedSubscriptionsReceived=total;
  }
 }catch{for(const row of rows)row.kicksGiftStage="公式ギフト集計DB取得失敗";}
}
function mergeShobonThumbnails(rows,reference){
 return rows.map(row=>{
  if(row.thumbnail||row.thumbnailCandidates?.length)return row;
  const candidates=reference[row.id];
  if(!Array.isArray(candidates)||!candidates.length)return row;
  return {...row,thumbnail:candidates[0],thumbnailCandidates:candidates.slice(0,3),thumbnailVerified:true,thumbnailSource:"しょぼんランキング"};
 });
}
async function shobonThumbnailSnapshot(origin){
 // The reference publishes data approximately every ten minutes. Fetch only
 // the public page, not an undocumented endpoint, and cache negative results.
 const key=new Request(origin+"/__cache/kick-shobon-images-r53");
 try{
  const cached=await caches.default.match(key);
  if(cached)return await cached.json();
  // Best-effort per-edge request guard; no per-channel requests to this site.
  await caches.default.put(key,json({},200,"public, max-age=600"));
 }catch{return {};}
 const rows=Object.create(null);
 try{
  const html=await fetchBounded("https://shobon-ranking.com/jp/rank/realtime",{headers:{accept:"text/html"}},3*1024*1024);
  for(const [slug,images] of parseKickReferenceImages(html)){
   // Only established Kick live-frame CDN paths, never third-party images.
   const checked=images.map(v=>validatedThumb(v,"kick")).filter(Boolean).slice(0,3);
   if(checked.length)rows[slug]=checked;
  }
  await caches.default.put(key,json(rows,200,"public, max-age=600"));
 }catch{}
 return rows;
}
async function enrichKickPublicMetrics(data,origin,env){
 if(!Array.isArray(data.entries)||!data.entries.length)return data;
 const rows=data.entries.slice(0,10);
 for(const row of rows){row.receivedComments=null;row.activeUsers=null;row.kicksGift=null;row.giftedSubscriptions=null;row.giftedSubscriptionsReceived=null;row.giftedSubscriptionsStage="公式API認証未設定";}
 // Official channel-level active gifted subscriptions are not gifts during this stream.
 // Batch top ten only; cache channel totals for two minutes.
 if(env.KICK_CLIENT_ID&&env.KICK_CLIENT_SECRET){
  for(const row of rows)row.giftedSubscriptionsStage="公式API取得待ち";
  try{
   const key=new Request(origin+"/__cache/kick-channels-r62/"+rows.map(r=>r.id).sort().join(","));
   const cached=await caches.default.match(key);let payload;
   if(cached)payload=await cached.json();
   else{
    const access=await kickToken(env),url=new URL("https://api.kick.com/public/v1/channels");
    for(const row of rows)if(/^[a-z0-9_-]{1,40}$/.test(row.id))url.searchParams.append("slug",row.id);
    const response=JSON.parse(await fetchBounded(url,{headers:{authorization:"Bearer "+access,accept:"application/json"}},1024*1024));
    // Cache only the public aggregate fields, never account tokens or other metadata.
    if(!Array.isArray(response.data))throw Error("Kick channel format");
    payload={data:response.data.map(x=>({slug:x.slug,broadcaster_user_id:officialGiftCount(x.broadcaster_user_id),stream:{is_live:x.stream?.is_live,start_time:x.stream?.start_time,thumbnail:kickFrameCandidates(x.stream).map(kickExplicitImage).filter(Boolean)[0]||""},active_gifted_subscribers_count:x.active_gifted_subscribers_count}))};
    try{await caches.default.put(key,json(payload,200,"public, max-age=30"));}catch{}
   }
   for(const row of rows){const channel=payload.data?.find(x=>typeof x?.slug==="string"&&x.slug.toLowerCase()===row.id);row.kickOfficialId=officialGiftCount(channel?.broadcaster_user_id);row.giftedSubscriptions=kickGiftedSubs(payload,row.id);row.giftedSubscriptionsStage=row.giftedSubscriptions!=null?"Kick公式API取得済み":channel?"公式APIに有効ギフト数なし":"公式APIに対象チャンネルなし";const stream=kickChannelLiveRow(payload,row.id);if(!stream)continue;const started=time(stream.start_time),known=time(row.startedAt);if(started&&known&&Math.abs(Date.parse(started)-Date.parse(known))>60000)continue;const images=kickFrameCandidates(stream).map(kickExplicitImage).filter(Boolean);if(images.length){row.thumbnail=images[0];row.thumbnailCandidates=images;row.thumbnailVerified=true;}if(!row.startedAt&&started)row.startedAt=started;}
  }catch(e){for(const row of rows)row.giftedSubscriptionsStage="公式API: "+diagnostic(e);}
 }
 await enrichOfficialKickGiftEvents(rows,env);
 // Recent public chat snapshots only: no WebSocket, webhook, user records, or chat archive.
 const missing=[];
 for(const row of rows){
  if(!/^[a-z0-9_-]{1,40}$/.test(row.id))continue;
  const key=new Request(origin+"/__cache/kick-sample-r61/"+row.id);
  try{const saved=await caches.default.match(key);if(saved){const s=await saved.json();if(s&&s.startedAt&&(!row.startedAt||Math.abs(Date.parse(row.startedAt)-Date.parse(s.startedAt))<=60000)){Object.assign(row,s);continue;}if(s===null)continue;}}catch{}
  missing.push({row,key});
 }
 // Bound each refresh to two channels; reuse aggregates for 60 seconds.
 await Promise.all(missing.slice(0,2).map(async({row,key})=>{
  let result=null;
  try{
   const channel=JSON.parse(await fetchBounded("https://kick.com/api/v2/channels/"+encodeURIComponent(row.id),{headers:{accept:"application/json"}},1024*1024));
   const channelId=channel?.id,room=kickChatId(channel?.chatroom?.id),live=channel?.livestream;
   if(typeof channel.slug!=="string"||channel.slug.toLowerCase()!==row.id||!kickChatId(channelId)||!/^\d+$/.test(String(channelId))||!live||live.is_live===false)throw Error("channel not verified live");
   const rawStart=live.start_time??live.created_at??live.started_at;
   const start=typeof rawStart==="string"&&Number.isFinite(kickChatTime(rawStart))?new Date(kickChatTime(rawStart)).toISOString():time(rawStart),ts=Date.parse(start);
   if(!Number.isFinite(ts)||(row.startedAt&&Math.abs(Date.parse(row.startedAt)-ts)>60000))throw Error("stream identity mismatch");
   const payload=JSON.parse(await fetchBounded("https://kick.com/api/v2/channels/"+channelId+"/messages",{headers:{accept:"application/json"}},1024*1024));
   const sample=recentKickSample(payload,room,ts,Date.now());
   if(sample)result={...sample,startedAt:start};
   if(result)Object.assign(row,result);
  }catch{}
  try{await caches.default.put(key,json(result,200,"public, max-age="+(result?60:30)));}catch{}
 }));
 const enriched=rows.some(row=>!row.thumbnail&&!row.thumbnailCandidates?.length)?mergeShobonThumbnails(rows,await shobonThumbnailSnapshot(origin)):rows;
 return {...data,entries:enriched};
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
function kickExplicitImage(raw){
 if(typeof raw!=="string"||raw.length>2048)return "";
 try{const u=new URL(raw.trim().replaceAll("&amp;","&"));if(u.protocol!=="https:"||u.username||u.password||u.port||u.hash||/profile|avatar|usericon|channel-icon|category|banner|\/icons?\//i.test(u.pathname))return "";return u.hostname==="kick.com"||u.hostname.endsWith(".kick.com")?u.href:"";}catch{return "";}
}
function kickProxyImage(raw){
 const value=kickExplicitImage(raw);
 if(!value)return "";
 const u=new URL(value);
 return ["images.kick.com","files.kick.com","stream.kick.com"].includes(u.hostname)&&(/\.(?:webp|jpe?g|png|gif|avif)$/i.test(u.pathname)||/\/(?:video_thumbnails|thumbnails|thumbnail)\//i.test(u.pathname))?value:"";
}
function kickFramePath(host,path){
 return (host==="images.kick.com"&&/^\/video_thumbnails\/[a-z0-9_-]+\/[a-z0-9_-]+\/[^/]+\.(?:webp|jpe?g|png)$/i.test(path))||
 (["stream.kick.com","files.kick.com","kick-prod-videos-30-day.s3.us-west-2.amazonaws.com"].includes(host)&&/^\/thumbnails\/livestream\/[^/]+\/[^/]+\/video_thumbnail\/.+\.(?:webp|jpe?g|png)$/i.test(path));
}
function kickLivePayload(payload,id,livestreamRoute){
 if(!payload||typeof payload!=="object"||Array.isArray(payload))return null;
 const root=payload.data&&typeof payload.data==="object"&&!Array.isArray(payload.data)?payload.data:payload;
 const candidates=[payload.slug,root.slug,payload.channel?.slug,root.channel?.slug].filter(v=>typeof v==="string");
 if(candidates.some(v=>v.toLowerCase()!==id)||root.is_live===false||payload.is_live===false)return null;
 let live=root.livestream??root.stream??payload.livestream??payload.stream;
 if(!live&&livestreamRoute&&!("livestream" in root)&&!("stream" in root)&&!("livestream" in payload)&&!("stream" in payload))live=root;
 if(!live||typeof live!=="object"||Array.isArray(live)||live.is_live===false)return null;
 if([live.slug,live.channel?.slug].some(v=>typeof v==="string"&&v.toLowerCase()!==id))return null;
 return live;
}
function kickOrderedThumbnailFields(live){
 if(!live||typeof live!=="object"||live.is_live===false)return [];
 const thumb=live.thumbnail;
 return [...new Set([thumb?.url,thumb?.src,live.thumbnail_url,typeof thumb==="string"?thumb:null,live.thumbnailUrl,thumb?.link].filter(v=>typeof v==="string"&&v.trim()).map(v=>v.trim().replaceAll("&amp;","&")))];
}
function kickFrameCandidates(live){
 if(!live||typeof live!=="object"||live.is_live===false)return [];
 const values=kickOrderedThumbnailFields(live);
 for(const v of [live.thumbnail,live.thumbnail_url,live.thumbnailUrl]){
  if(typeof v==="string")values.push(v);
  else if(v&&typeof v==="object"){
   for(const k of ["url","src","link"])if(typeof v[k]==="string")values.push(v[k]);
   for(const src of [v.srcset,v.srcSet,v.responsive])if(typeof src==="string"){
    const parts=[...src.matchAll(/(https:\/\/[^\s,]+)\s+(\d+)w(?:\s*,|$)/g)].map(m=>({url:m[1],width:Number(m[2])}));
    parts.sort((a,b)=>Math.abs(a.width-480)-Math.abs(b.width-480));values.push(...parts.slice(0,3).map(x=>x.url));
   }
  }
 }
 return [...new Set(values.map(v=>v.replaceAll("&amp;","&")))].slice(0,8);
}
function kickChannelLiveRow(payload,id){
 const channel=payload?.data?.find?.(x=>typeof x?.slug==="string"&&x.slug.toLowerCase()===id);
 return channel?.stream?.is_live===true?channel.stream:null;
}
function validatedThumb(value,type){
 if(typeof value!=="string"||value.length>2048)return "";
 try{const u=new URL(value.startsWith("//")?"https:"+value:value);const host=u.hostname.toLowerCase();
  if(u.protocol!=="https:"||u.username||u.password||u.port||u.hash||/profile|avatar|usericon|user-icon|channel-icon|\/icons?\//i.test(u.pathname))return "";
  const ok=type==="nico"?nicoImageHost(host,u.pathname):kickFramePath(host,u.pathname);
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
  let detail=null,poster="";let metadataImages=[];
  try{const html=await fetchBounded("https://live.nicovideo.jp/watch/"+id,{headers:{accept:"text/html"}},6*1024*1024);detail=publicNicoDetail(html,id);if(!detail)metadataImages=nicoMetaImageValues(html,id,false).map(rankingImageUrl).filter(Boolean);}catch{}
  const programImages=[...new Set([...(detail?.programThumbnails||[]),...(known?.programThumbnails||[]),...metadataImages,poster,known?.rssThumbnail].filter(Boolean))].filter(v=>!nicoBrandImage(v));
  const kind=detail?.providerKind||known?.providerKind||"";
  if(kind==="channel"||known?.channelOwner||(!kind&&!known?.historyOwner&&!known?.profileUrl)){
   const owner=detail?.channelOwner||known?.channelOwner||"";
   const historyPromise=/^[1-9]\d{0,14}$/.test(owner)?(async()=>{
    // Best-effort extension of the existing public history endpoint. Channel support is not guaranteed.
    const query="https://live.nicovideo.jp/front/api/v1/user-broadcast-history?providerType=channel&isIncludeNonPublic=false&offset=0&limit=10&providerId="+owner;
    try{const payload=JSON.parse(await fetchBounded(query,{headers:{accept:"application/json"}},2*1024*1024));return imageCandidates(...nicoHistoryImageItems(payload,id));}catch{return [];}
   })():Promise.resolve([]);
   const listingPromise=Promise.all(["NCF","NCU"].map(async section=>{try{const listing=await fetchBounded("https://www.chikuwachan.com/live/"+section+"/",{headers:{accept:"text/html"}},6*1024*1024);return nicoListingImageMap(listing).get(id)||[];}catch{return [];}})).then(values=>[...new Set(values.flat())]);
   const [history,listing]=await Promise.all([historyPromise,listingPromise]);
   return [...new Set([...listing,...programImages,...history,...fromRank.filter(v=>exactProgramImage(v,id))].filter(v=>!nicoBrandImage(v)).map(v=>validatedThumb(v,"nico")).filter(Boolean))];
  }
  const detailImages=imageCandidates(...(detail?.thumbnailCandidates||[]),detail?.thumbnailUrl);
  const profileOwner=String(known?.profileUrl||"").match(/^https:\/\/www\.nicovideo\.jp\/user\/([1-9]\d{0,14})$/)?.[1];
  const owner=detail?.historyOwner||known?.historyOwner||profileOwner||"";
  const historyImages=[];
  if(/^[1-9]\d{0,14}$/.test(owner)){
   for(const version of ["v2","v1"]){
    try{
     const query="https://live.nicovideo.jp/front/api/"+version+"/user-broadcast-history?providerType=user&isIncludeNonPublic=false&offset=0&limit=5&withTotalCount=true&providerId="+owner;
     const history=JSON.parse(await fetchBounded(query,{headers:{accept:"application/json","X-Frontend-Id":"9"}},2*1024*1024));
     const images=imageCandidates(...nicoHistoryImageItems(history,id)).map(v=>validatedThumb(v,"nico")).filter(Boolean);
     if(images.length){historyImages.push(...images);break;}
    }catch{}
   }
  }
  return [...new Set([...historyImages,...programImages,...detailImages,...fromRank,poster].filter(v=>!nicoBrandImage(v)).map(v=>validatedThumb(v,"nico")).filter(Boolean))];
 }

 return type==="kick"?fromRank.map(v=>validatedThumb(v,"kick")).filter(Boolean):fromRank;
}
function parseKickReferenceImages(html){
 const rows=new Map(),safe=String(html||"").replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>/gi,"");
 const attr=(tag,key)=>tag.match(new RegExp("(?:^|\\s)"+key+"\\s*=\\s*([\"'])([\\s\\S]*?)\\1","i"))?.[2]?.replace(/&amp;/g,"&")||"";
 for(const match of safe.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)){
  const id=/^https:\/\/(?:www\.)?kick\.com\/([a-z0-9_-]{1,40})\/?(?:[?#][^\s]*)?$/i.exec(attr(match[1],"href"))?.[1]?.toLowerCase();
  if(!id)continue;
  for(const [tag] of match[2].matchAll(/<img\b[^>]*>/gi)){
   if(/(?:avatar|profile|logo|usericon)/i.test(tag))continue;
   for(const key of ["data-src","data-original","data-lazy-src","src"]){
    const value=attr(tag,key);
    // Never infer a CDN path from the basename alone, or reuse the profile icon.
    if(!/^https:\/\/[^/?#]+\/[^?#]*\/thumbnail\.jpe?g(?:[?#].*)?$/i.test(value))continue;
    if(!rows.has(id))rows.set(id,[]);
    if(!rows.get(id).includes(value)&&rows.get(id).length<3)rows.get(id).push(value);
   }
  }
 }
 return rows;
}
async function kickChikuwaImages(origin,id){
 const key=new Request(origin+"/__cache/kick-chikuwa-images-r51");
 try{const cached=await caches.default.match(key);if(cached){const rows=await cached.json();return Array.isArray(rows[id])?rows[id]:[];}}catch{}
 try{const html=await fetchBounded("https://www.chikuwachan.com/live/KCK/",{headers:{accept:"text/html"}},6*1024*1024);const rows=Object.create(null);
 for(const row of parseKickPublic(html)){if(row.thumbnailCandidates.length)rows[row.id]=row.thumbnailCandidates;}
 try{await caches.default.put(key,json(rows,200,"public, max-age=60"));}catch{}return rows[id]||[];
 }catch{return [];}
}
async function kickReferenceImages(origin,id){
 const key=new Request(origin+"/__cache/kick-reference-images-r50");
 try{
  const saved=await caches.default.match(key);
  if(saved){const rows=await saved.json();return Array.isArray(rows[id])?rows[id]:[];}
 }catch{}
 try{
  const html=await fetchBounded("https://cf383735.cloudfree.jp/kick-ar/",{headers:{accept:"text/html"}},3*1024*1024);
  const parsed=parseKickReferenceImages(html),rows=Object.create(null);
  for(const [slug,images] of parsed){
   const checked=images.map(v=>kickProxyImage(v)||validatedThumb(v,"kick")).filter(Boolean);
   if(checked.length)rows[slug]=checked;
  }
  try{await caches.default.put(key,json(rows,200,"public, max-age=60"));}catch{}
  return rows[id]||[];
 }catch{return [];}
}
async function kickEndpointImages(id,known,suffix){
 try{
  const payload=JSON.parse(await fetchBounded("https://kick.com/api/v2/channels/"+encodeURIComponent(id)+suffix,{headers:{accept:"application/json"}},1024*1024));
  const live=kickLivePayload(payload,id,suffix==="/livestream");
  if(!live)return [];
  const started=time(live.start_time??live.started_at??live.created_at),expected=time(known?.startedAt);
  if(started&&expected&&Math.abs(Date.parse(started)-Date.parse(expected))>60000)return [];
  return kickFrameCandidates(live).map(v=>kickProxyImage(v)||validatedThumb(v,"kick")).filter(Boolean);
 }catch{return [];}
}
function oldNicoPageImages(html,id){
 const tag=String(html||"").match(/<script\b[^>]*\bid=["']embedded-data["'][^>]*>/i)?.[0];
 const raw=tag?.match(/\bdata-props\s*=\s*(["'])([\s\S]*?)\1/i)?.[2];
 let p=null;
 if(raw){try{p=JSON.parse(raw.replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&")).program;}catch{}}
 const meta=(name)=>{
  for(const [t] of String(html||"").matchAll(/<meta\b[^>]*>/gi)){
   if(t.match(/\s(?:property|name)\s*=\s*(["'])(.*?)\1/i)?.[2]?.toLowerCase()===name)return t.match(/\scontent\s*=\s*(["'])(.*?)\1/i)?.[2]?.replaceAll("&amp;","&")||"";
  }return "";
 };
 const declared=p?.nicoliveProgramId??p?.programId??p?.liveId??p?.id?.value??p?.id;
 const page=meta("og:url");
 const pageId=/^https:\/\/live\.nicovideo\.jp\/watch\/(lv\d{5,15})\/?(?:[?#].*)?$/i.exec(page)?.[1]?.toLowerCase();
 if(declared!=null&&String(declared)!==id&&"lv"+String(declared)!==id)return [];
 if(page&&pageId!==id)return [];
 // The caller uses a fixed watch URL, and refuses all redirects.
 const shot=p?.thumbnail?.screenshot;
 const values=typeof shot==="string"?[shot]:[shot?.large,shot?.middle,shot?.small,shot?.url];
 const poster=meta("og:image");
 const screen=p?.screenshot?.urlSet;
 return [...new Set([...values,screen?.large,screen?.middle,screen?.small,poster,meta("og:image:secure_url"),meta("twitter:image")].filter(v=>typeof v==="string"&&v))].slice(0,8);
}
function oldNicoImageUrl(raw){
 if(typeof raw!=="string"||raw.length>2048||nicoBrandImage(raw))return "";
 try{
  const u=new URL(raw.replaceAll("&amp;","&"),"https://live.nicovideo.jp");
  const host=u.hostname.toLowerCase();
  if(u.protocol!=="https:"||u.username||u.password||u.port||u.hash||!(host==="nimg.jp"||host.endsWith(".nimg.jp")||host==="simg.jp"||host.endsWith(".simg.jp")||host==="nicovideo.jp"||host.endsWith(".nicovideo.jp")))return "";
  return u.href;
 }catch{return "";}
}
async function oldNicoWatchImages(id){
 try{
  // Source implementation from live-ranking-source.zip: direct watch page,
  // thumbnail.screenshot then program poster. No speculative channel API.
  const res=await nicoFetchNoRedirect("https://live.nicovideo.jp/watch/"+id,{signal:AbortSignal.timeout(7000),headers:{accept:"text/html"},cf:{cacheEverything:true,cacheTtl:2}});
  if(!res.ok||!res.body||Number(res.headers.get("content-length")||0)>6291456){try{await res.body?.cancel();}catch{}return [];}
  const reader=res.body.getReader(),decoder=new TextDecoder();let size=0,html="";
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>6291456){await reader.cancel();return [];}html+=decoder.decode(value,{stream:true});}html+=decoder.decode();}finally{reader.releaseLock();}
  return oldNicoPageImages(html,id).map(oldNicoImageUrl).filter(Boolean);
 }catch{return [];}
}
async function thumbnailResponse(raw,type,preview=false,verified=false){
 const validate=value=>validatedThumb(value,type)||(type==="nico"&&verified?oldNicoImageUrl(value):type==="kick"&&verified?kickProxyImage(value):"");
 let url=validate(raw);if(!url)return null;
 const signal=AbortSignal.timeout(type==="nico"?7000:6000);
 const maxBytes=type==="nico"?4194304:2097152;
 try{
  let response;
  for(let i=0;i<3;i++){
   response=await fetch(url,{signal,redirect:"manual",...(type==="nico"?{cf:{cacheEverything:true,cacheTtl:2}}:preview?{cache:"no-store"}:{}),headers:{Accept:"image/avif,image/webp,image/png,image/jpeg,image/gif",Referer:type==="nico"?(new URL(url).hostname==="www.chikuwachan.com"?"https://www.chikuwachan.com/live/":"https://live.nicovideo.jp/"):"https://kick.com/"}});
   if(![301,302,303,307,308].includes(response.status))break;
   const location=response.headers.get("location");if(response.body)await response.body.cancel();if(!location)return null;
   url=validate(new URL(location,url).href);if(!url)return null;
  }
  const contentType=(response.headers.get("content-type")||"").split(";")[0].toLowerCase();
  if(!response.ok||!/^image\/(jpeg|png|webp|gif|avif)$/.test(contentType)||Number(response.headers.get("content-length")||0)>maxBytes||!response.body){if(response.body)await response.body.cancel();return null;}
  const reader=response.body.getReader(),chunks=[];let total=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>maxBytes){await reader.cancel();return null;}chunks.push(value);}}finally{reader.releaseLock();}
  if(!total)return null;
  const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return new Response(bytes,{headers:{"content-type":contentType,"cache-control":preview?"public, max-age=3":type==="kick"?"public, max-age=60":"public, max-age=30","x-content-type-options":"nosniff"}});
 }catch{return null;}
}
async function liveThumbnail(request){
 const url=new URL(request.url),type=url.searchParams.get("service"),id=url.searchParams.get("id")||"";
 if(request.method!=="GET")return new Response(null,{status:405});
 if(!(type==="nico"?/^lv\d{5,15}$/.test(id):type==="kick"&&/^[a-z0-9_-]{1,40}$/.test(id)))return new Response(null,{status:400});
 const preview=type==="nico"&&url.searchParams.get("preview")==="1";
 const key=new Request(url.origin+"/__cache/live-thumbnail-"+(type==="nico"?"r59":"r51")+"/"+type+"/"+id+(preview?"/preview":""));
 const sourceKey=new Request(url.origin+"/__cache/nico-preview-source-r59/"+id);
 try{const cached=await caches.default.match(key);if(cached)return cached;}catch{}
 let rows=[];
 // Restrict public requests to programs currently present in a cached ranking.
 for(const cacheKey of rankingCacheKeys(url.origin,type)){
  try{const response=await caches.default.match(cacheKey);const data=response&&await response.json();if(Array.isArray(data?.entries)&&data.entries.some(x=>x.id===id)){rows=data.entries;break;}}catch{}
 }
 if(!rows.length&&type!=="nico")return new Response(null,{status:404,headers:{"cache-control":"no-store"}});
 // Cache API is local to an edge location. A valid public Nico watch ID may
 // use the bounded legacy source even if this edge has no ranking cache.
 const known=rows.find(x=>x.id===id)||{id},rankImages=imageCandidates(known.thumbnail,...(known.thumbnailCandidates||[]));
 if(preview){
  // Only use a previously successful public image URL; never repeat expensive program detail lookups.
  let source="";
  try{const saved=await caches.default.match(sourceKey);if(saved){const value=(await saved.json())?.url;source=oldNicoImageUrl(value)||validatedThumb(value,"nico");}}catch{}
  const response=source?await thumbnailResponse(source,"nico",true,true):null;
  const result=response||new Response(null,{status:404,headers:{"cache-control":"public, max-age=3"}});
  try{await caches.default.put(key,result.clone());}catch{}
  return result;
 }
 // Prefer already observed program images; resolve from fixed public endpoints if unavailable.
 let attempted=new Set(),workingSource="";
 async function tryImages(images,verified=false){
  for(const raw of images){const candidate=validatedThumb(raw,type)||(type==="nico"&&verified?oldNicoImageUrl(raw):type==="kick"&&verified?kickProxyImage(raw):"");if(!candidate||(type==="nico"&&nicoBrandImage(candidate))||attempted.has(candidate)||attempted.size>=(type==="nico"?6:9))continue;attempted.add(candidate);const response=await thumbnailResponse(candidate,type,false,verified);if(response){workingSource=candidate;return response;}}return null;
 }
 const isNicoUser=type==="nico"&&(known.providerKind==="user"||(!known.providerKind&&!known.channelOwner&&!!known.profileUrl));
 const initial=type==="nico"&&!isNicoUser?(known.programThumbnails||[]).filter(v=>!nicoBrandImage(v)):rankImages;
 let result=null;
 if(type==="nico"){
  const direct=await oldNicoWatchImages(id);
  result=await tryImages(direct.slice(0,3),true);
  if(!result&&rows.length){try{const saved=await caches.default.match(sourceKey);if(saved)result=await tryImages([(await saved.json())?.url],true);}catch{}}
 }else result=await tryImages(initial.slice(0,2),known.thumbnailVerified===true);
 if(!result&&type==="nico"&&rows.length)result=await tryImages(initial.slice(0,2));
 if(!result&&type==="kick")result=await tryImages((await kickChikuwaImages(url.origin,id)).slice(0,2),true);
 if(!result&&type==="kick")result=await tryImages((await kickReferenceImages(url.origin,id)).slice(0,1),true);
 if(!result&&type==="kick"){
  for(const suffix of ["/livestream",""]){
   result=await tryImages((await kickEndpointImages(id,known,suffix)).slice(0,2),true);
   if(result)break;
  }
  if(!result)result=await tryImages(rankImages,type==="kick"&&known.thumbnailVerified===true);
 }else if(!result&&rows.length)result=await tryImages(await resolveThumbnailCandidates(type,id,rows),false);
 if(!result)result=new Response(null,{status:404,headers:{"cache-control":"public, max-age=25"}});
 if(type==="nico"&&workingSource){try{await caches.default.put(sourceKey,json({url:workingSource},200,"public, max-age=120"));}catch{}}
 try{await caches.default.put(key,result.clone());}catch{}
 return result;
}

function statisticsFields(result){
 const out={};
 for(const k of ["advertising","gift","active10m","active60s","activitySampleEnd","activeRecent","activityRecentSeconds","activityRecentEnd"])if(Number.isSafeInteger(result?.[k])&&result[k]>=0)out[k]=result[k];
 return out;
}
async function nicoSupplementalStatistics(request){
 if(request.method!=="GET")return json({status:"error",message:"GETのみ対応"},405);
 const url=new URL(request.url),origin=url.origin;
 let rank=null;
 for(const cacheKey of rankingCacheKeys(origin,"nico")){try{const hit=await caches.default.match(cacheKey);if(hit){rank=await hit.json();if(Array.isArray(rank.entries)&&rank.entries.length)break;}}catch{}}
 if(!Array.isArray(rank?.entries)||!rank.entries.length)return json({status:"pending",message:"ランキングキャッシュ待ち",entries:[]},200,"no-store");
 const rows=rank.entries.slice(0,10).filter(row=>/^lv\d{5,15}$/.test(row.id)),results=[],pending=[];
 for(const row of rows){
  const key=new Request(origin+"/__cache/nico-stats-r60/"+row.id);
  let saved;try{const hit=await caches.default.match(key);if(hit)saved=await hit.json();}catch{}
  if(saved){results.push({...saved,...statisticsFields(row),...statisticsFields(saved)});continue;}
  const fields=statisticsFields(row);
  if(fields.advertising!=null&&fields.gift!=null&&fields.active10m!=null){results.push({id:row.id,...fields,stage:"公開統計取得済み",checkedAt:Date.now()});continue;}
  pending.push({row,key});
 }
 const rotation=Math.floor(Date.now()/10000)%10;
 pending.sort((a,b)=>((rows.indexOf(a.row)-rotation+10)%10)-((rows.indexOf(b.row)-rotation+10)%10));
 await Promise.all(pending.slice(0,2).map(async({row,key})=>{
  const result={id:row.id,...statisticsFields(row),stage:"番組情報取得失敗",checkedAt:Date.now()};
  try{
   const page=await fetchBounded("https://live.nicovideo.jp/watch/"+row.id,{headers:{accept:"text/html"}},6*1024*1024);
   const detail=publicNicoDetail(page,row.id);
   if(detail){
    for(const [k,v] of Object.entries(statisticsFields(detail)))if(result[k]==null)result[k]=v;
    result.stage="公式統計接続先未取得";
    if(detail.statisticsEndpoint){
     const wantActivity=result.active10m==null;
     const stat=await fetchNicoStatistics(detail.statisticsEndpoint,wantActivity,detail.startedAt||row.startedAt);
     result.stage=stat?.watchStage||"公式統計通信失敗";
     if(stat){
      Object.assign(result,statisticsFields(stat));
      if(wantActivity&&result.advertising!=null&&result.gift!=null)result.stage=stat.activityStage||"コメント履歴接続先未取得";
     }
    }
   }
  }catch(e){result.stage="番組情報: "+diagnostic(e);}
  if(result.advertising!=null&&result.gift!=null&&result.active10m!=null)result.stage="3項目取得済み";
  else if(result.advertising!=null&&result.gift!=null)result.stage="広告・ギフト取得済み／"+result.stage;
  result.checkedAt=Date.now();results.push(result);
  try{await caches.default.put(key,json(result,200,"public, max-age="+(result.advertising!=null&&result.gift!=null?60:30)));}catch{}
 }));
 return json({status:"ok",entries:results,pending:Math.max(0,pending.length-2)},200,"no-store");
}

function connectionError(e){const message=String(e?.message||"");return /^HTTP \d{3}$/.test(message)?message:e?.name==="TimeoutError"||e?.name==="AbortError"?"タイムアウト":"接続失敗・応答確認";}
async function kickConnectionProbe(env,getToken,readApi,clock){
 const out={configured:!!(env.KICK_CLIENT_ID&&env.KICK_CLIENT_SECRET),clientIdConfigured:!!env.KICK_CLIENT_ID,clientSecretConfigured:!!env.KICK_CLIENT_SECRET,tokenStatus:"未設定",livestreamStatus:"未確認",giftApiStatus:"未確認",giftDbConfigured:!!env.KICK_GIFT_DB,giftSubscriptionsConfigured:!!env.KICK_GIFT_SUBSCRIPTION_IDS,giftDbStatus:"未設定",checkedAt:clock()};
 if(out.configured){
  try{
   const token=await getToken(env);
   if(typeof token!=="string"||!token)throw Error("認証失敗");
   out.tokenStatus="接続成功";
   try{const subscriptions=giftSubscriptionRows(await readApi("https://api.kick.com/public/v1/events/subscriptions",token));const ids=giftAllowedIds(env),matched=String(env.KICK_GIFT_SUBSCRIPTION_IDS||"").trim()?subscriptions.filter(x=>ids.includes(x.id.toUpperCase())):subscriptions;out.giftSubscriptionStatus="公式API確認: KICKs "+subscriptions.filter(x=>x.event==="kicks.gifted").length+"件 / ギフトサブ "+subscriptions.filter(x=>x.event==="channel.subscription.gifts").length+"件 ／ 受信対象 "+matched.length+"件"+(String(env.KICK_GIFT_SUBSCRIPTION_IDS||"").trim()?"（手動ID照合）":"（公式API自動照合）");}catch(e){out.giftSubscriptionStatus="公式購読確認失敗: "+connectionError(e);}
   try{const data=await readApi("https://api.kick.com/public/v2/livestreams?limit=1",token);if(!Array.isArray(data?.data))throw Error("応答形式不正");out.livestreamStatus="接続成功";
    const slug=data.data.find(x=>typeof x?.channel?.slug==="string"&&/^[a-z0-9_-]{1,40}$/i.test(x.channel.slug))?.channel.slug;
    if(slug){
     try{const channel=await readApi("https://api.kick.com/public/v1/channels?slug="+encodeURIComponent(slug),token);if(!Array.isArray(channel?.data))throw Error("応答形式不正");const match=channel.data.find(x=>x.slug?.toLowerCase()===slug.toLowerCase());out.giftApiStatus=match&&Number.isSafeInteger(match.active_gifted_subscribers_count)&&match.active_gifted_subscribers_count>=0?"接続成功・有効数取得可":"接続成功・項目未確認";}catch(e){out.giftApiStatus=connectionError(e);}
    }else out.giftApiStatus="確認用配信なし";
   }catch(e){out.livestreamStatus=connectionError(e);}
  }catch(e){out.tokenStatus=connectionError(e);}
 }
 out.giftReceiveStatus="受信DB未設定";out.kicksEventCount=null;out.giftSubEventCount=null;out.lastGiftReceivedAt=null;
 if(out.giftDbConfigured){try{const now=clock(),r=await env.KICK_GIFT_DB.prepare("SELECT COUNT(CASE WHEN kind = 'kicks.gifted' THEN 1 END) AS kicks, COUNT(CASE WHEN kind = 'channel.subscription.gifts' THEN 1 END) AS subs, MAX(occurred_at) AS latest FROM kick_gift_events WHERE occurred_at >= ? AND occurred_at <= ?").bind(now-86400000,now).first();out.giftDbStatus="接続成功";out.kicksEventCount=Number(r?.kicks)||0;out.giftSubEventCount=Number(r?.subs)||0;out.lastGiftReceivedAt=Number(r?.latest)||null;out.giftReceiveStatus=out.kicksEventCount+out.giftSubEventCount>0?"直近24時間の受信記録あり":"直近24時間の受信記録なし";}catch{out.giftDbStatus="接続失敗・テーブル確認";out.giftReceiveStatus="DB確認失敗";}}
 out.checkedAt=clock();
 return out;
}
function adminSessionParts(value,now){
 if(typeof value!=="string"||value.length>150)return null;
 const m=/^(\d{10})\.([a-f0-9]{32})\.([a-f0-9]{64})$/.exec(value);
 if(!m)return null;
 const expiry=Number(m[1]);
 if(expiry<=now||expiry>now+3600)return null;
 return {message:m[1]+"."+m[2],signature:m[3]};
}
function adminCookieValue(raw){
 if(typeof raw!=="string"||raw.length>8192)return "";
 const values=raw.split(";").map(s=>s.trim()).filter(s=>s.startsWith("__Host-kick_admin="));
 return values.length===1?values[0].slice("__Host-kick_admin=".length):"";
}
function adminSecretReady(value){return typeof value==="string"&&value.length>=12&&value.length<=256&&/^[!-~]+$/.test(value);}
function equalDigest(a,b){if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];return diff===0;}
const ADMIN_COOKIE="__Host-kick_admin";
const ADMIN_COOKIE_FLAGS="; Path=/; Secure; HttpOnly; SameSite=Strict";
function adminHex(bytes){return Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,"0")).join("");}
async function adminSign(message,secret){
 const encoder=new TextEncoder();
 const key=await crypto.subtle.importKey("raw",encoder.encode("kick-admin-session-v1:"+secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 return adminHex(await crypto.subtle.sign("HMAC",key,encoder.encode(message)));
}
async function kickAdminAuthorized(request,env){
 if(!adminSecretReady(env.KICK_ADMIN_PASSWORD)||new URL(request.url).protocol!=="https:")return false;
 const session=adminSessionParts(adminCookieValue(request.headers.get("cookie")),Math.floor(Date.now()/1000));
 if(!session)return false;
 const expected=await adminSign(session.message,env.KICK_ADMIN_PASSWORD);
 const encoder=new TextEncoder();
 return equalDigest(encoder.encode(expected),encoder.encode(session.signature));
}
async function adminPasswordMatches(password,secret){
 if(!password)return false;
 const encoder=new TextEncoder();
 const a=new Uint8Array(await crypto.subtle.digest("SHA-256",encoder.encode(password)));
 const b=new Uint8Array(await crypto.subtle.digest("SHA-256",encoder.encode(secret)));
 return equalDigest(a,b);
}
async function adminReadForm(request){
 if(!/^application\/x-www-form-urlencoded(?:;|$)/i.test(request.headers.get("content-type")||"")||Number(request.headers.get("content-length")||0)>2048||!request.body)return null;
 const reader=request.body.getReader(),decoder=new TextDecoder();let n=0,text="";
 try{while(true){const {done,value}=await reader.read();if(done)break;n+=value.length;if(n>2048){await reader.cancel();return null;}text+=decoder.decode(value,{stream:true});}
 const p=new URLSearchParams(text+decoder.decode()),name=p.getAll("username"),password=p.getAll("password");
 return name.length===1&&password.length===1&&name[0]==="admin"&&adminSecretReady(password[0])?password[0]:null;
 }catch{return null;}finally{reader.releaseLock();}
}
function adminResponse(body,status,headers={}){
 return new Response(body,{status,headers:{"cache-control":"no-store, private","x-content-type-options":"nosniff","x-frame-options":"DENY","referrer-policy":"same-origin",...headers}});
}
const KICK_ADMIN_PAGE="<!doctype html><html lang=\"ja\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><title>管理者専用 | Kick API接続</title><style>:root{--paper:#fff;--line:#dce4ee;--ink:#182236;--muted:#53657a;--bg:#f1f5fa}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 system-ui,\"Meiryo\",sans-serif}main{width:min(950px,calc(100% - 32px));margin:24px auto}.heading{display:flex;justify-content:space-between;align-items:center;gap:12px}h2{margin:0;font-size:22px}.rank-eyebrow,.hint,.status{color:var(--muted);font-size:13px}button{cursor:pointer}button:disabled{opacity:.6}a{color:#1859b8}.kick-api-settings{background:var(--paper);border:1px solid var(--line);border-radius:14px;padding:18px;margin:24px 0}.kick-check{padding:8px 14px;border:1px solid #b7c5d6;border-radius:8px;background:white;color:var(--ink);font-weight:700}.kick-api-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px}.kick-api-grid div{padding:10px;background:var(--bg);border-radius:8px}.kick-api-grid dt{font-size:12px;color:var(--muted)}.kick-api-grid dd{margin:0;font-weight:700;font-size:14px;overflow-wrap:anywhere}.kick-api-settings summary{cursor:pointer;font-weight:700}.kick-api-settings code{overflow-wrap:anywhere}.kick-api-settings ol{padding-left:1.4em}</style></head><body><main><p><a href=\"/\">← ホームページ</a> ／ 管理者専用</p><section class=\"kick-api-settings\" id=\"kick-api\" aria-labelledby=\"kick-api-title\">\n <div class=\"heading\"><div><span class=\"rank-eyebrow\">KICK / OFFICIAL API</span><h2 id=\"kick-api-title\">Kick API接続</h2></div><button class=\"kick-check\" id=\"kick-api-check\" type=\"button\">接続確認</button></div>\n <p class=\"hint\">公式ランキング・ギフト情報のサーバー接続設定です。認証情報は公開ページに入力せず、CloudflareのSecretに登録してください。</p>\n <dl class=\"kick-api-grid\">\n <div><dt>Client ID</dt><dd id=\"kick-id-status\">未確認</dd></div><div><dt>Client Secret</dt><dd id=\"kick-secret-status\">未確認</dd></div><div><dt>公式API認証</dt><dd id=\"kick-token-status\">未確認</dd></div><div><dt>配信一覧API</dt><dd id=\"kick-live-status\">未確認</dd></div><div><dt>ギフトサブスクAPI</dt><dd id=\"kick-sub-status\">未確認</dd></div><div><dt>ギフト受信DB</dt><dd id=\"kick-db-status\">未確認</dd></div><div><dt>Webhook購読ID設定</dt><dd id=\"kick-hook-status\">未確認</dd></div><div><dt>Webhook受信記録</dt><dd id=\"kick-receive-status\">未確認</dd></div><div><dt>KICKsイベント件数 / 24時間</dt><dd id=\"kick-event-count\">未確認</dd></div><div><dt>ギフトサブイベント件数 / 24時間</dt><dd id=\"kick-sub-event-count\">未確認</dd></div><div><dt>最新イベント時刻</dt><dd id=\"kick-last-event\">未確認</dd></div></dl>\n <p id=\"kick-api-result\" class=\"status\" role=\"status\" aria-live=\"polite\">設定後に接続確認を押してください。確認結果は最大60秒キャッシュされます。</p>\n <details><summary>接続設定方法（管理者用）</summary><ol><li><a href=\"https://docs.kick.com/\" target=\"_blank\" rel=\"noopener noreferrer\">Kick公式開発者ドキュメント</a>を参照し、KickのDeveloper設定でアプリを作成してClient IDとClient Secretを取得。</li><li><a href=\"https://dash.cloudflare.com/\" target=\"_blank\" rel=\"noopener noreferrer\">Cloudflare管理画面</a>の Workers &amp; Pages → kanachin-app-collection → Settings → Variables and Secrets で <code>KICK_CLIENT_ID</code> と <code>KICK_CLIENT_SECRET</code> をSecretとして登録し、反映。</li><li>このページに戻り、接続確認を実行。</li></ol><p class=\"hint\">KICKsギフトの受信には別途D1と公式Webhook購読が必要です。<br>① CloudflareでD1を作成し kick-gifts.sql を実行。Workerのバインディング名は KICK_GIFT_DB。<br>② Kick Developerのアプリ編集で Enable Webhooks をONにし、下記URLを登録。<br>③ 公式イベント購読APIで対象配信者の kicks.gifted と channel.subscription.gifts (version 1) を登録。既存の公式購読はAPIで自動照合。KICK_GIFT_SUBSCRIPTION_IDS を設定済みの場合はそのIDだけ許可します。<br>④ 再度接続確認。設定前のギフトは取得できません。購読ID設定済みは実際の受信成功を示すものではありません。</p><p>Webhook URL：<code id=\"kick-hook-url\">/api/kick-gift-events</code></p><p><a href=\"https://github.com/kanenao/kanachin-app-collection#readme\" target=\"_blank\" rel=\"noopener noreferrer\">ギフト受信設定の詳細</a></p></details>\n </section><p class=\"hint\">共有端末では利用後にブラウザーを閉じてください。ブラウザーのHTTP認証情報が保持される場合があります。</p></main><script>async function checkKickApi(){\n const button=document.getElementById(\"kick-api-check\"),status=document.getElementById(\"kick-api-result\");\n button.disabled=true;status.textContent=\"Kick公式APIに接続中…\";\n try{\n  const response=await fetch(\"/admin/kick-api/status\",{cache:\"no-store\",signal:AbortSignal.timeout(35000)});if(!response.ok)throw Error(\"HTTP \"+response.status);\n  const d=await response.json();if(typeof d.configured!==\"boolean\")throw Error(\"応答形式不正\");\n  const values={\"kick-id-status\":d.clientIdConfigured?\"設定済み\":\"未設定\",\"kick-secret-status\":d.clientSecretConfigured?\"設定済み\":\"未設定\",\"kick-token-status\":d.tokenStatus,\"kick-live-status\":d.livestreamStatus,\"kick-sub-status\":d.giftApiStatus,\"kick-db-status\":d.giftDbStatus,\"kick-hook-status\":d.giftSubscriptionStatus||(d.giftSubscriptionsConfigured?\"手動ID設定済み・公式確認不可\":\"公式API自動照合・未確認\"),\"kick-receive-status\":d.giftReceiveStatus,\"kick-event-count\":Number.isSafeInteger(d.kicksEventCount)?String(d.kicksEventCount)+\"件\":\"未確認\",\"kick-sub-event-count\":Number.isSafeInteger(d.giftSubEventCount)?String(d.giftSubEventCount)+\"件\":\"未確認\",\"kick-last-event\":d.lastGiftReceivedAt?new Date(d.lastGiftReceivedAt).toLocaleString(\"ja-JP\",{timeZone:\"Asia/Tokyo\"}):\"記録なし\"};\n  for(const [id,value] of Object.entries(values))document.getElementById(id).textContent=typeof value===\"string\"?value:\"未確認\";\n  status.textContent=(d.livestreamStatus===\"接続成功\"?\"公式API接続確認成功\":d.configured?\"接続結果を確認してください\":\"管理者のAPI認証設定が必要です\")+\" ／ 確認時刻 \"+new Date(d.checkedAt).toLocaleTimeString(\"ja-JP\",{timeZone:\"Asia/Tokyo\"});\n }catch{status.textContent=\"接続確認APIに通信できませんでした。再試行してください。\";}finally{button.disabled=false;}\n}\ndocument.getElementById(\"kick-api-check\").addEventListener(\"click\",checkKickApi);\ndocument.getElementById(\"kick-hook-url\").textContent=location.origin+\"/api/kick-gift-events\";\n</script></body></html>";

const ADMIN_CSP="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
function adminLoginPage(message="",disabled=false,status=200){
 const body='<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>管理者ログイン</title><style>*{box-sizing:border-box}body{background:#f1f5fa;color:#182236;font:15px/1.6 system-ui,Meiryo,sans-serif;margin:0}main{width:min(460px,calc(100% - 32px));margin:64px auto;padding:26px;background:white;border:1px solid #dce4ee;border-radius:14px}h1{font-size:24px;margin:0 0 14px}label{display:block;margin:12px 0 5px;font-weight:bold}input,button{font:inherit;width:100%;padding:12px;border:1px solid #b7c5d6;border-radius:8px}button{background:#1859b8;color:white;border:0;margin-top:18px;font-weight:bold;cursor:pointer}button:disabled{opacity:.5;cursor:default}.note{color:#53657a;font-size:13px}.error{color:#a02727}a{color:#1859b8}</style></head><body><main><p class="note">管理者専用 / 更新番号 2026.11.27-r70</p><h1>管理者ログイン</h1><p class="note">Kick API接続を管理するための認証です。</p><p class="error" role="status">'+message+'</p><form method="post" action="/admin/kick-api/login"><label for="username">ユーザー名</label><input id="username" name="username" value="admin" autocomplete="username" required><label for="password">管理者パスワード</label><input type="password" id="password" name="password" autocomplete="current-password" required minlength="12" maxlength="256"><button type="submit"'+(disabled?' disabled':'')+'>ログイン</button></form><p class="note">Cloudflareに登録した KICK_ADMIN_PASSWORD を入力してください。</p><a href="/">ホームページに戻る</a></main></body></html>';
 return adminResponse(body,status,{"content-type":"text/html; charset=utf-8","content-security-policy":ADMIN_CSP});
}
function adminSameOriginPost(origin,site,mode,dest,expected){
 if(origin===expected)return true;
 // Legacy r66 used no-referrer on the form: browsers can serialize Origin as null.
 // Only accept legacy form navigations positively identified by Fetch Metadata as same-origin.
 return (origin===null||origin==="null")&&site==="same-origin"&&mode==="navigate"&&dest==="document";
}
async function kickAdminRoute(request,env,path){
 const url=new URL(request.url),isStatus=path==="/admin/kick-api/status"||path==="/api/kick-connection";
 if(url.protocol!=="https:")return adminResponse("HTTPS required",403);
 if(!adminSecretReady(env.KICK_ADMIN_PASSWORD))return isStatus?adminResponse("管理者認証未設定",503):adminLoginPage("管理者認証の設定が無効です。Cloudflareのランタイム変数 KICK_ADMIN_PASSWORD に半角12〜256文字（空白なし）のパスワードを設定してください。",true,503);
 if(path==="/admin/kick-api/login"||path==="/admin/kick-api/logout"){
  if(request.method!=="POST")return adminResponse("Method not allowed",405,{"allow":"POST"});
  if(!adminSameOriginPost(request.headers.get("origin"),request.headers.get("sec-fetch-site"),request.headers.get("sec-fetch-mode"),request.headers.get("sec-fetch-dest"),url.origin))return adminLoginPage("ログイン画面を開き直してください。安全確認に失敗したため送信を拒否しました。",false,403);
  if(path.endsWith("/logout"))return adminResponse(null,303,{"location":"/admin/kick-api","set-cookie":ADMIN_COOKIE+"="+ADMIN_COOKIE_FLAGS+"; Max-Age=0"});
  let key,failures=0;
  try{
   const ip=request.headers.get("CF-Connecting-IP");
   if(ip){const hash=await adminSign("login-limit:"+ip,env.KICK_ADMIN_PASSWORD);key=new Request(url.origin+"/__cache/admin-login-r66/"+hash);const hit=await caches.default.match(key);if(hit)failures=Number(await hit.text())||0;}
  }catch{}
  if(failures>=8)return adminLoginPage("試行回数が多すぎます。15分後に再試行してください。",true,429);
  const password=await adminReadForm(request);
  if(!await adminPasswordMatches(password,env.KICK_ADMIN_PASSWORD)){
   if(key)try{await caches.default.put(key,new Response(String(failures+1),{headers:{"cache-control":"public, max-age=900"}}));}catch{}
   return adminLoginPage("ユーザー名またはパスワードが違います。",false,401);
  }
  if(key)try{await caches.default.delete(key);}catch{}
  const expiry=Math.floor(Date.now()/1000)+3600,nonce=adminHex(crypto.getRandomValues(new Uint8Array(16))),message=expiry+"."+nonce;
  const value=message+"."+await adminSign(message,env.KICK_ADMIN_PASSWORD);
  return adminResponse(null,303,{"location":"/admin/kick-api","set-cookie":ADMIN_COOKIE+"="+value+ADMIN_COOKIE_FLAGS+"; Max-Age=3600"});
 }
 if(request.method!=="GET")return adminResponse("Method not allowed",405,{"allow":"GET"});
 if(!await kickAdminAuthorized(request,env))return isStatus?adminResponse("管理者ログインが必要です。",401):adminLoginPage();
 if(isStatus)return kickConnectionStatus(request,env);
 const page=KICK_ADMIN_PAGE.replace("共有端末では利用後にブラウザーを閉じてください。ブラウザーのHTTP認証情報が保持される場合があります。","セッションの有効期限は1時間です。利用後はログアウトしてください。").replace("</main>",'<form method="post" action="/admin/kick-api/logout"><button class="kick-check" type="submit">ログアウト</button></form></main>');
 return adminResponse(page,200,{"content-type":"text/html; charset=utf-8","content-security-policy":ADMIN_CSP});
}
async function kickConnectionStatus(request,env){
 if(request.method!=="GET")return json({status:"error",message:"GETのみ対応"},405,"no-store");
 const origin=new URL(request.url).origin;
 const key=new Request(origin+"/__cache/kick-connection-r70");
 const flags=[!!env.KICK_CLIENT_ID,!!env.KICK_CLIENT_SECRET,!!env.KICK_GIFT_DB,!!env.KICK_GIFT_SUBSCRIPTION_IDS].join(",");
 try{const hit=await caches.default.match(key);if(hit){const saved=await hit.json();if(saved.flags===flags)return json(saved.result,200,"no-store");}}catch{}
 // Per-edge short cache reduces repeated public probe requests. Never expose secrets or upstream payloads.
 const result=await kickConnectionProbe(env,kickToken,async(url,token)=>JSON.parse(await fetchBounded(url,{headers:{authorization:"Bearer "+token,accept:"application/json"}},1024*1024)),Date.now);
 try{await caches.default.put(key,json({flags,result},200,"public, max-age=60"));}catch{}
 return json(result,200,"no-store");
}
export default {async fetch(request,env,ctx){
 const url=new URL(request.url),match=/^\/api\/rankings\/(nico|kick)$/.exec(url.pathname);
 if(["/admin/kick-api","/admin/kick-api/","/admin/kick-api/status","/admin/kick-api/login","/admin/kick-api/logout","/api/kick-connection"].includes(url.pathname))return kickAdminRoute(request,env,url.pathname);
 if(url.pathname==="/api/kick-gift-events")return kickGiftWebhook(request,env);
 if(url.pathname==="/api/nico-statistics")return nicoSupplementalStatistics(request);
 if(url.pathname==="/api/live-thumbnail")return liveThumbnail(request);
 if(url.pathname==="/api/live-profile"&&request.method==="GET")return resolveNicoProfile(request);
 if(url.pathname==="/api/health")return json({status:"ok",revision:"2026.11.27-r70"});
 if(url.pathname==="/embed/rankings"||url.pathname==="/embed/rankings/"){const assetUrl=new URL("/",url);return env.ASSETS.fetch(new Request(assetUrl,request));}
 if(!match)return url.pathname.startsWith("/api/")?json({status:"error",message:"APIが見つかりません"},404):env.ASSETS.fetch(request);
 if(request.method!=="GET")return json({status:"error",message:"GETのみ対応"},405);
 const type=match[1],[key,backup]=rankingCacheKeys(url.origin,type);
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
