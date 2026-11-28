
const {readFileSync}=require("node:fs"),assert=require("node:assert/strict");
const w=readFileSync("worker.js","utf8"),h=readFileSync("rankings/index.html","utf8");
const gift=new Function(w.slice(w.indexOf("function officialEventUrl120"),w.indexOf("function cfNicoEventLink121"))+";return safeHomeGiftEvents120")();
const images=new Function(h.slice(h.indexOf("function enhancedNicoImages120"),h.indexOf("let homeGiftNext120"))+";return enhancedNicoImages120")();
const url="https://audition.nicovideo.jp/embedded/ranking?key=giftevent-test";
assert.equal(gift({events:[{url,status:"ok",rows:[{rank:1,userId:123,name:"test",points:0}]}]}).events[0].rows[0].points,0);
assert.equal(gift({events:[{url:"https://example.com/"}]}).events.length,0);
assert.equal(gift(null).status,"unavailable");
const pic="https://img.cdn.nimg.jp/live/abcd.jpg",icon="https://secure-dcdn.cdn.nimg.jp/comch/channel-icon/128x128/123.jpg";
assert.deepEqual(images({id:"lv123456789",providerKind:"channel",channelId:"123",thumbnailCandidates:[icon,pic,"https://img.cdn.nimg.jp/live/lv987654321.jpg","https://example.com/abc.jpg"]}),[pic,icon]);
assert.deepEqual(images({id:"lv123456789",providerKind:"channel",channelId:"456",thumbnailCandidates:[icon]}),[]);
assert.ok(h.includes('id="home-nico-gift-events"'));
assert.ok(h.includes('"/api/live-thumbnail?service=nico&id="'));
for(const m of h.matchAll(/<script[^>]*>([^]*?)<[/]script>/gi))new Function(m[1]);
console.log("r120 gift and enhanced thumbnails assertions passed");
