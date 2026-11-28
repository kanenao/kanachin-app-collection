const assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const w=fs.readFileSync("worker.js","utf8"),h=fs.readFileSync("rankings/index.html","utf8");
const f=new Function("rankingPageHtml",w.slice(w.indexOf("const sharedDashboardShell127="),w.indexOf("function adminRouteTarget("))+";return rankingPageResponse")(h);
const origin="https://kanachin-app-collection.kanenao0224.workers.dev",home="https://kane-nao.tail7d733c.ts.net";
(async()=>{
 const r=f(new Request(origin+"/api/ranking-page"));const html=await r.text();assert.equal(r.status,200);assert.ok(r.headers.get("content-security-policy").includes("frame-src 'self' "+home));assert.ok(html.includes("/dashboard?embed=1"));assert.ok((await f(new Request(origin+"/api/ranking-page?view=standby")).text()).includes("ranking-title"));assert.ok((await f(new Request(origin+"/embed/rankings")).text()).includes("ranking-title"));assert.equal((await f(new Request(origin+"/api/ranking-page",{method:"HEAD"})).text()),"");assert.equal(f(new Request(origin+"/api/ranking-page",{method:"POST"})).status,405);
 let now=100000,handler,tick,frames=[];const status={hidden:false,className:""},message={textContent:""},screen={append(x){frames.push(x);}},document={hidden:false,getElementById(id){return {status,message,screen}[id];},createElement(){return {style:{},contentWindow:{},setAttribute(k,v){this[k]=v;},remove(){frames=frames.filter(x=>x!==this);}};},addEventListener(){}};
 vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],{document,window:{addEventListener:(k,fn)=>{handler=fn;}},Date:{now:()=>now},setInterval:fn=>{tick=fn;},fetch:async()=>({ok:true,json:async()=>({status:"online"})}),AbortSignal});
 assert.equal(frames.length,1);const first=frames[0];assert.equal(first.src,home+"/dashboard?embed=1");assert.equal(first.style.visibility,"hidden");assert.ok(first.sandbox.includes("allow-same-origin"));
 handler({origin:"https://example.com",source:first.contentWindow,data:{type:"kanachin-ranking-ready"}});assert.equal(first.style.visibility,"hidden");
 handler({origin:home,source:{},data:{type:"kanachin-ranking-ready"}});assert.equal(first.style.visibility,"hidden");
 handler({origin:home,source:first.contentWindow,data:{type:"kanachin-ranking-ready"}});assert.equal(first.style.visibility,"visible");assert.equal(status.hidden,true);
 now+=35001;await tick();assert.equal(frames.length,1);assert.equal(frames[0].src,"/api/ranking-page?view=standby");assert.equal(status.hidden,false);
 now+=60001;await tick();assert.equal(frames.length,2);const second=frames[1];handler({origin:home,source:second.contentWindow,data:{type:"kanachin-ranking-ready"}});assert.equal(frames.length,1);assert.equal(frames[0],second);assert.equal(status.hidden,true);
 now+=35001;await tick();now+=60001;await tick();now+=18001;await tick();assert.equal(frames.length,1);assert.equal(frames[0].src,"/api/ranking-page?view=standby");
 console.log("r127 shared page routing, authenticated message origin, timeout and recovery passed");
})().catch(e=>{console.error(e);process.exitCode=1;});
