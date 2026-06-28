import * as path from "path";
import { ROOT } from "./domain";
import type { Model } from "./build";

export function renderHtml(model: Model, echartsSrc: string): string {
    const byName = new Map(model.scenarios.map((s) => [s.name, s]));
    const linkFor = (name: string) => {
        const s = byName.get(name);
        if (!s) return { name, file: "", line: 0, href: "" };
        const abs = path.join(ROOT, s.file);
        return {
            name,
            file: s.file,
            line: s.line,
            href: `vscode://file/${abs}:${s.line}`
        };
    };
    const structRows = model.structRows.map((sr) => ({
        ...sr,
        fields: sr.fields.map((f) => ({
            ...f,
            classes: f.classes.map((c) => ({
                ...c,
                links: c.scenarios.map(linkFor)
            }))
        }))
    }));

    const data = JSON.stringify({
        proofRows: model.proofRows.map((r) => ({
            ...r,
            links: r.mapped.map(linkFor)
        })),
        structRows,
        scenarios: model.scenarios,
        gaps: model.gaps,
        summary: model.summary,
        errors: model.errors
    }).replace(/</g, "\\u003c");

    return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Dispute coverage grid</title>
<script src="${echartsSrc}"></script>
<style>
:root{--ok:#3f9168;--okdim:#2a4d3c;--gap:#ff7043;--gaphot:#ff5722;--untagged:#d69e2e;--na:#4a525c;--bg:#0f1419;--panel:#1a2129;--ink:#e6edf3;--mut:#8b98a5;--line:#2d3742}
*{box-sizing:border-box}body{margin:0;font:14px/1.5 ui-sans-serif,system-ui,sans-serif;background:var(--bg);color:var(--ink)}
header{padding:14px 20px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--bg);z-index:5}
h1{font-size:16px;margin:0 0 6px}.sub{color:var(--mut);font-size:12px}
.bar{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;align-items:center}
.tab{padding:6px 12px;border:1px solid var(--line);border-radius:7px;cursor:pointer;color:var(--mut);background:var(--panel)}
.tab.on{color:var(--ink);border-color:#3b82f6}
.tab .cnt{display:inline-block;margin-left:6px;font-size:11px;padding:0 6px;border-radius:9px;background:var(--line);color:var(--ink)}
.tab.gaptab .cnt{background:var(--gaphot);color:#fff}
.legend{margin-left:auto;font-size:12px;color:var(--mut)}
.dot{display:inline-block;width:9px;height:9px;border-radius:2px;margin:0 4px 0 10px;vertical-align:middle}
.dot.na{background:var(--na);background-image:repeating-linear-gradient(45deg,transparent,transparent 2px,#0f1419 2px,#0f1419 3px)}
main{padding:14px 20px}.view{display:none}.view.on{display:block}
.chart{width:100%;height:760px}
.note{color:var(--mut);font-size:12px;margin:2px 0 12px;max-width:980px}
input#gq{background:var(--panel);border:1px solid var(--line);color:var(--ink);padding:7px 10px;border-radius:7px;width:320px;margin-bottom:12px}
.glist{list-style:none;padding:0;margin:0;columns:2;column-gap:28px}.glist li{margin:3px 0;font-size:13px;break-inside:avoid}
.grp{break-inside:avoid;margin:0 0 14px;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--panel)}
.grp h3{margin:0 0 6px;font-size:13px;display:flex;align-items:center;gap:8px}
.grp h3 .badge{font-size:11px;padding:1px 8px;border-radius:9px;background:var(--gaphot);color:#fff}
.grp ul{list-style:none;padding:0;margin:0}.grp li{font-size:12px;margin:2px 0;color:#ffb59e}
.grpwrap{columns:2;column-gap:20px}
.pstrip{display:flex;flex-wrap:wrap;gap:8px;max-width:1100px}
.pchip{display:flex;flex-direction:column;gap:2px;padding:8px 11px;border-radius:8px;border:1px solid var(--line);background:var(--panel);min-width:210px;font-size:12px}
.pchip.covered{border-color:var(--okdim)}.pchip.untagged{border-color:var(--untagged)}.pchip.none{border-color:var(--gaphot);background:#241814}
.pchip .pn{font-weight:600}.pchip .ps{font-size:11px;color:var(--mut)}
.pchip a{color:#9ecb8a;text-decoration:none}.pchip a:hover{text-decoration:underline}
.pchip.none .pn{color:#ff8a65}
.hide{display:none}
a.tlink{color:#9ecb8a;text-decoration:none}a.tlink:hover{text-decoration:underline}
#det{position:fixed;right:18px;bottom:18px;max-width:420px;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px 14px;box-shadow:0 6px 24px rgba(0,0,0,.5);display:none;z-index:9}
#det h4{margin:0 0 6px;font-size:13px}#det .x{position:absolute;top:8px;right:11px;cursor:pointer;color:var(--mut)}
#det .gapmsg{color:#ff8a65}#det .namsg{color:var(--mut)}#det ul{margin:6px 0 0;padding-left:16px}#det li{font-size:12px;margin:2px 0}
</style></head><body>
<header>
  <h1>Dispute coverage grid <span class="sub">— axes parsed from contracts/V1, not from the tests</span></h1>
  <div class="sub" id="summary"></div>
  <div class="bar">
    <div class="tab on gaptab" data-v="gaps">Gaps<span class="cnt" id="gapcnt"></span></div>
    <div class="tab" data-v="tree">Classification tree</div>
    <div class="tab" data-v="proofs">Proof types</div>
    <span class="legend"><span class="dot" style="background:#3f9168"></span>covered<span class="dot" style="background:#d69e2e"></span>untagged<span class="dot" style="background:#ff5722"></span>gap<span class="dot na"></span>N/A</span>
  </div>
</header>
<main>
  <section class="view on" id="gaps">
    <p class="note">Everything <b>not covered yet</b>, grouped by where it lives. A group's badge is its gap count. Covered paths live in the other tabs (and recede there); here the to-do list is the headline.</p>
    <input id="gq" placeholder="filter gaps…">
    <div class="grpwrap" id="gapgroups"></div>
  </section>
  <section class="view" id="tree">
    <p class="note">Hierarchy <b>struct → field → value-class</b>. <span style="color:#ff8a65">Orange</span> = a gap (no scenario). Muted green = covered — <b>click it to open the test</b> in VS Code. Striped/dim = N/A (a constraint, not a gap). Click any wedge to zoom; click an empty arc to see the nearest covered sibling.</p>
    <div class="chart" id="c-tree"></div>
  </section>
  <section class="view" id="proofs">
    <p class="note">Every <b>fraud-proof type</b> from the contract enums. <span style="color:#ff8a65">Orange border</span> = no test exercises it. Covered chips link straight to the mapped <code>@scenario</code>.</p>
    <div class="pstrip" id="proofstrip"></div>
  </section>
</main>
<div id="det"><span class="x" id="detx">✕</span><h4 id="deth"></h4><div id="detb"></div></div>
<script id="data" type="application/json">${data}</script>
<script>
var D=JSON.parse(document.getElementById("data").textContent);
var esc=function(s){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");};

// summary line - distinct scenarios, not test counts. gaps + N/A called out.
var S=D.summary;
document.getElementById("summary").innerHTML=
 "<b>"+S.scenarios+"</b> scenarios · proof types <b>"+S.proofsCovered+"/"+S.proofsTotal+"</b> · "+
 "value-class cells <b>"+S.cellsCovered+"/"+S.cellsTotal+"</b> covered ("+S.naCells+" N/A) · "+
 "<span style='color:#ff5722;font-weight:600'>"+D.gaps.length+" gaps</span>"+
 (D.errors.length?" · <span style='color:#ff5722'>"+D.errors.length+" DSL errors</span>":"");
document.getElementById("gapcnt").textContent=D.gaps.length;

// ---- detail popover (used by sunburst clicks) ----
var det=document.getElementById("det");
function linkLine(l){return "<a class='tlink' href='"+esc(l.href)+"'>"+esc(l.name)+"</a> <span class='ps' style='color:#8b98a5'>"+esc(l.file)+":"+l.line+"</span>";}
function showDet(title,bodyHtml){document.getElementById("deth").innerHTML=title;document.getElementById("detb").innerHTML=bodyHtml;det.style.display="block";}
document.getElementById("detx").onclick=function(){det.style.display="none";};

// ---- sunburst: struct -> field -> class (its own roomy tab) ----
// muted-green covered recedes, orange gaps jump out, N/A is dim+desaturated.
function sunData(){
 return D.structRows.map(function(sr){return {
   name:sr.name, itemStyle:{color:"#39485a"},
   children: sr.fields.filter(function(f){return f.modeled;}).map(function(f){
     var covN=f.classes.filter(function(c){return c.scenarios.length;}).length;
     var gapN=f.classes.filter(function(c){return c.reachable&&!c.scenarios.length;}).length;
     return { name:f.name, field:f.name, struct:sr.name, gapN:gapN,
       itemStyle:{color:gapN?"#5a3325":(covN?"#2a4d3c":"#3a4450")},
       children: f.classes.map(function(c){
         var col=!c.reachable?"#3a3f47":(c.scenarios.length?"#3f9168":"#ff5722");
         return {name:c.cls, value:1, leaf:true, links:c.links, na:!c.reachable, naReason:c.naReason, struct:sr.name, field:f.name,
           label:{show:c.scenarios.length>0||!c.reachable?true:true},
           itemStyle:{color:col,opacity:!c.reachable?0.4:1,borderColor:c.reachable&&!c.scenarios.length?"#ff8a65":"#0f1419"}};
       }) };
   }) };});
}
function nearestCovered(struct,field){
 var sr=D.structRows.filter(function(r){return r.name===struct;})[0]; if(!sr)return null;
 var f=sr.fields.filter(function(x){return x.name===field;})[0]; if(!f)return null;
 for(var i=0;i<f.classes.length;i++){var c=f.classes[i]; if(c.links&&c.links.length)return {cls:c.cls,link:c.links[0]};}
 return null;
}
function optTree(){return {
  tooltip:{formatter:function(p){var d=p.data;if(!d.leaf)return "<b>"+esc(d.name)+"</b>"+(d.gapN?"<br/>"+d.gapN+" gap class(es)":"");
    if(d.na)return "<b>"+esc(d.name)+"</b><br/><i>N/A — "+esc(d.naReason||"not independently reachable")+"</i>";
    if(d.links&&d.links.length)return "<b>"+esc(d.name)+"</b><br/>"+d.links.length+" scenario(s) — click to open";
    return "<b>"+esc(d.name)+"</b><br/><i>GAP — no test yet</i>";}},
  series:[{type:"sunburst",radius:[0,"96%"],center:["50%","52%"],sort:null,nodeClick:false,emphasis:{focus:"ancestor"},data:sunData(),
    label:{minAngle:8,color:"#dbe4ee",fontSize:11},
    levels:[{},
      {r0:"0%",r:"26%",label:{rotate:"tangential",fontSize:12}},
      {r0:"26%",r:"56%",label:{rotate:"radial",fontSize:11,minAngle:8}},
      {r0:"57%",r:"96%",label:{align:"right",fontSize:10,minAngle:6}}]}]
};}
function onTreeClick(p){
 var d=p.data; if(!d||!d.leaf)return;
 if(d.na){showDet("🚫 "+esc(d.struct)+"."+esc(d.field)+":"+esc(d.name),"<div class='namsg'>N/A — "+esc(d.naReason||"not independently reachable")+". A constraint, not a gap.</div>");return;}
 if(d.links&&d.links.length){
   if(d.links.length===1){window.location.href=d.links[0].href;return;}
   var items=d.links.map(function(l){return "<li>"+linkLine(l)+"</li>";}).join("");
   showDet("✅ "+esc(d.struct)+"."+esc(d.field)+":"+esc(d.name),"<ul>"+items+"</ul>");return;
 }
 var near=nearestCovered(d.struct,d.field);
 var msg="<div class='gapmsg'>No test yet for this value-class.</div>";
 if(near)msg+="<div class='ps' style='color:#8b98a5;margin-top:6px'>nearest covered sibling: <b>"+esc(near.cls)+"</b><br/>"+linkLine(near.link)+"</div>";
 showDet("❌ "+esc(d.struct)+"."+esc(d.field)+":"+esc(d.name),msg);
}

// ---- proof-type strip ----
(function(){var box=document.getElementById("proofstrip");
 D.proofRows.forEach(function(r){var c=document.createElement("div");c.className="pchip "+r.status;
   var label=r.status==="covered"?"covered":r.status==="untagged"?"untagged":"GAP — no test";
   var links=(r.links||[]).map(function(l){return "<a href='"+esc(l.href)+"'>"+esc(l.name)+"</a>";}).join(", ");
   c.innerHTML="<span class='pn'>"+esc(r.member)+"</span><span class='ps'>"+label+"</span>"+(links?"<span class='ps'>"+links+"</span>":"");
   box.appendChild(c);});
})();

// ---- gaps grouped by source (struct / proof / DSL) ----
(function(){var wrap=document.getElementById("gapgroups");
 function groupOf(g){var m=g.match(/^\\[([^\\]]+)\\]/);return m?m[1]:"other";}
 var groups={};
 D.gaps.forEach(function(g){var k=groupOf(g);(groups[k]=groups[k]||[]).push(g);});
 D.errors.forEach(function(e){(groups["DSL errors"]=groups["DSL errors"]||[]).push("DSL! "+e);});
 var order=Object.keys(groups).sort(function(a,b){return groups[b].length-groups[a].length;});
 order.forEach(function(k){var div=document.createElement("div");div.className="grp";div.dataset.k=k.toLowerCase();
   var items=groups[k].map(function(g){return "<li>"+esc(g.replace(/^\\[[^\\]]+\\]\\s*/,""))+"</li>";}).join("");
   div.innerHTML="<h3>"+esc(k)+" <span class='badge'>"+groups[k].length+"</span></h3><ul>"+items+"</ul>";
   div.dataset.all=groups[k].join(" \\u0001 ").toLowerCase();
   wrap.appendChild(div);});
 document.getElementById("gq").addEventListener("input",function(e){var q=e.target.value.toLowerCase();
   wrap.querySelectorAll(".grp").forEach(function(d){
     var hit=!q||d.dataset.all.indexOf(q)>=0;d.classList.toggle("hide",!hit);
     if(hit&&q){d.querySelectorAll("li").forEach(function(li){li.classList.toggle("hide",li.textContent.toLowerCase().indexOf(q)<0);});}
     else{d.querySelectorAll("li").forEach(function(li){li.classList.remove("hide");});}
   });});
})();

// ---- tabs + lazy chart init ----
var charts={};
var BUILD={"c-tree":optTree};
function ensure(id){
  var dom=document.getElementById(id); if(!dom)return;
  if(charts[id]){charts[id].resize();return;}
  if(!window.echarts){dom.innerHTML="<p class='note'>ECharts couldn't load (offline?). Open <code>COVERAGE_GRID.generated.md</code> — it has all the tables.</p>";return;}
  charts[id]=echarts.init(dom,"dark"); charts[id].setOption(BUILD[id]());
  if(id==="c-tree")charts[id].on("click",onTreeClick);
}
function show(v){
  document.querySelectorAll(".tab").forEach(function(t){t.classList.toggle("on",t.dataset.v===v);});
  document.querySelectorAll(".view").forEach(function(s){s.classList.toggle("on",s.id===v);});
  if(v==="tree")ensure("c-tree");
}
document.querySelectorAll(".tab").forEach(function(t){t.onclick=function(){show(t.dataset.v);};});
window.addEventListener("resize",function(){Object.keys(charts).forEach(function(k){charts[k].resize();});});
show("gaps");
</script></body></html>`;
}
