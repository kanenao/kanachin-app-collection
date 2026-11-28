const assert=require("node:assert/strict"),fs=require("node:fs");
const w=fs.readFileSync("worker.js","utf8"),h=fs.readFileSync("rankings/index.html","utf8");
const start=w.indexOf("function officialEventUrl120"),end=w.indexOf("async function enhancedHomeRanking",start);
assert.ok(start>=0&&end>start);
const f=new Function("clean","liveId","imageCandidates","nicoSupplierImageFields",w.slice(start,end)+";return {cfChannelId121,cfChannelIconUrl121,cfChannelIconCandidates121,cfChannelPageIcons125,cfWatchChannel121,cfCollectGiftEvents121,cfNicoEventLinks121,cfNicoEventRows121};")(v=>String(v??"").replace(/<[^>]+>/g,"").trim(),v=>String(v??""),(...v)=>v.flat(Infinity).filter(x=>typeof x==="string"),p=>[p.supplier?.thumbnailUrl]);
const url="https://secure-dcdn.cdn.nimg.jp/comch/channel-icon/128x128/ch123.jpg";
assert.equal(f.cfChannelId121({providerType:"channel",supplier:{programProviderId:{value:"ch123"}}}),"123");
assert.equal(f.cfChannelId121({providerType:"channel",supplier:{programProviderId:"ch123",pageUrl:"https://ch.nicovideo.jp/ch456"}}),"");
assert.equal(f.cfChannelId121({providerType:"user",supplier:{programProviderId:"123"}}),"");
assert.equal(f.cfChannelIconUrl121(url,"123"),url);
assert.equal(f.cfChannelIconUrl121(url,"456"),"");
assert.equal(f.cfChannelIconUrl121("https://evil.example/comch/channel-icon/128x128/ch123.jpg","123"),"");
assert.equal(f.cfChannelIconCandidates121("123")[0],url);
const program=JSON.stringify({program:{id:"lv123456789",providerType:"channel",supplier:{programProviderId:"ch123",thumbnailUrl:url}}});
assert.deepEqual(f.cfWatchChannel121(program,"lv123456789"),{channelId:"123",icons:[url]});
assert.deepEqual(f.cfWatchChannel121(program,"lv987654321"),{channelId:"",icons:[]});
const startH=h.indexOf("function enhancedChannelTarget121"),endH=h.indexOf("function enhancedThumbnail",startH);
const target=new Function(h.slice(startH,endH)+";return enhancedChannelTarget121")();
assert.deepEqual(target({id:"lv123456789",providerKind:"channel",channelId:"ch123"},"nico"),{only:true,url:"/api/nico-channel-icon?channel=123"});
assert.equal(target({id:"lv123456789",providerKind:"user",userId:"123"},"nico").url,"");
assert.equal(target({id:"test"},"kick").url,"");
assert.equal(target({id:"lv123456789",providerKind:"channel"},"nico").only,true);
assert.ok(h.includes('fetch("/api/nico-gift-events",'));
assert.ok(w.includes('ns.idFromName("nico-official-gift-events-v1")'));
assert.ok(w.includes('if(url.pathname==="/api/nico-channel-icon")'));
for(const m of h.matchAll(/<script[^>]*>([^]*?)<[/]script>/gi))new Function(m[1]);
(async()=>{
 const article="https://blog.nicovideo.jp/niconews/12345",ranking="https://audition.nicovideo.jp/embedded/ranking?key=giftevent-test&max_item_size=25&fixed_result=false",calls=[];
 const read=async u=>{calls.push(u);if(u==="https://live.nicovideo.jp/")return '<a href="'+article+'">ギフトイベント</a>';if(u==="https://blog.nicovideo.jp/niconews/")return "";if(u===article)return '<title>ギフトイベント</title><iframe src="'+ranking+'"></iframe>';if(u===ranking)return JSON.stringify({ranking:[{rank:1,user:{id:123,name:"A"},score:0},{rank:2,user:{id:456,name:"B"},score:500}]});throw Error("unexpected "+u);};
 const result=await f.cfCollectGiftEvents121(read,"",null,Date.now());assert.equal(result.status,"ok");assert.equal(result.events[0].rows.length,2);assert.equal(result.events[0].rows[0].points,0);assert.equal(result.events[0].rows[1].points,500);assert.ok(calls.every(u=>u.includes(".nicovideo.jp/")));
 const none=await f.cfCollectGiftEvents121(async()=>{throw Error("HTTP 403");},"",null,Date.now());assert.equal(none.events.length,0);assert.ok(none.diagnostics.length);
 const old=await f.cfCollectGiftEvents121(async()=>{throw Error("HTTP 429");},"",result,Date.now());assert.equal(old.events[0].rows.length,0);assert.equal(old.events[0].status,"link-only");
 console.log("r121 Cloudflare channel identity, source routing, event collection and failure checks passed");
})().catch(e=>{console.error(e);process.exitCode=1;});

;(async()=>{
 const root="https://koken.nicovideo.jp/campaign",event="https://koken.nicovideo.jp/campaign/event/202611-kohaku-shiro",rank="https://audition.nicovideo.jp/embedded/ranking?key=fixture-gift&max_item_size=25&fixed_result=false",calls=[];
 const read=async u=>{calls.push(u);if(u===root)return '<a href="/campaign/event/202611-kohaku-shiro"><img alt="白組ギフトイベント"></a><a href="/campaign/event/other-campaign">通常キャンペーン</a><a href="https://example.com/campaign/event/gift">ギフト</a>';if(u===event)return '<title>白組ギフトイベント</title><iframe src="'+rank+'"></iframe>';if(u===rank)return JSON.stringify({ranking:[{rank:1,user:{id:123,name:"fixture"},score:0}]});return "";};
 const data=await f.cfCollectGiftEvents121(read,"",null,Date.now());
 assert.equal(data.status,"ok");assert.equal(data.events[0].rows[0].points,0);assert.ok(calls.includes(root)&&calls.includes(event)&&calls.includes(rank));assert.ok(!calls.some(u=>u.includes("other-campaign")||u.includes("example.com")));
 assert.ok(h.includes('href="https://koken.nicovideo.jp/campaign"'));assert.ok(!h.includes("Cloudflareで公式"));
 console.log("r123 official campaign catalog fixture and public wording passed");
})().catch(e=>{console.error(e);process.exitCode=1;});

;(async()=>{
 const root="https://koken.nicovideo.jp/campaign",ad=root+"/event/202611-nicoadevent-christmasbanner",free=root+"/play/free_202611-kohaku-shiro",calls=[];
 const state=await f.cfCollectGiftEvents121(async u=>{calls.push(u);return u===root?'<a href="'+ad+'?conductorId=29386&frameMasterId=54">広告イベント</a><a href="'+free+'?conductorId=29124&frameMasterId=57">無料ギフト</a>':'';},"",null,Date.now());
 assert.ok(state.events.some(x=>x.category==="ad-campaign"&&x.url===ad+"?conductorId=29386&frameMasterId=54"));
 assert.ok(state.events.some(x=>x.category==="free-gift"&&x.url===free+"?conductorId=29124&frameMasterId=57"));
 assert.ok(!calls.includes(free)&&!calls.includes(ad));
 assert.ok(state.events.every(x=>x.status==="link-only"&&!x.rows.length));
 assert.ok(h.includes("conductorId=29386&amp;frameMasterId=54"));
 assert.ok(h.includes("conductorId=29174&amp;frameMasterId=57"));
 console.log("r124 official ad/free gift links separate from ranking; no automated claim passed");
})().catch(e=>{console.error(e);process.exitCode=1;});

;{
const numeric="https://secure-dcdn.cdn.nimg.jp/comch/channel-icon/128x128/123.jpg",other="https://secure-dcdn.cdn.nimg.jp/comch/channel-icon/128x128/456.jpg",opaque="https://img.cdn.nimg.jp/channel/unique.jpg";
assert.ok(f.cfChannelIconCandidates121("123").includes(numeric));
assert.deepEqual(f.cfChannelPageIcons125('<meta property="og:image" content="'+numeric+'">',"123"),[numeric]);
assert.deepEqual(f.cfChannelPageIcons125('<link rel="canonical" href="https://ch.nicovideo.jp/ch123"><meta property="og:image" content="'+opaque+'">',"123"),[opaque]);
assert.deepEqual(f.cfChannelPageIcons125('<link rel="canonical" href="https://ch.nicovideo.jp/ch456"><meta property="og:image" content="'+opaque+'">',"123"),[]);
assert.deepEqual(f.cfChannelPageIcons125('<link rel="canonical" href="https://ch.nicovideo.jp/ch123"><meta property="og:image" content="'+other+'">',"123"),[]);
assert.deepEqual(f.cfChannelPageIcons125('<meta property="og:image" content="https://evil.example/unique.jpg">',"123"),[]);
console.log("r125 numeric CDN and official channel identity tests passed");
}

;(async()=>{const article="https://blog.nicovideo.jp/niconews/15111",rank="https://audition.nicovideo.jp/embedded/ranking?key=fixture-gift&max_item_size=25&fixed_result=false",calls=[];const state=await f.cfCollectGiftEvents121(async u=>{calls.push(u);return u===article?'<script>const link="//audition.nicovideo.jp/embedded/ranking?key=fixture-gift"</script>':u===rank?JSON.stringify({ranking:[{rank:1,user:{id:123,name:"fixture"},score:42}]}):"";},"",null,Date.parse("2026-11-28T12:00:00Z"));assert.equal(state.events[0].rows[0].points,42);assert.ok(calls.includes(article));assert.ok(!calls.some(u=>u.includes("/campaign/play/")));console.log("r128 direct official article discovery passed");})().catch(e=>{console.error(e);process.exitCode=1;});
