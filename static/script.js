/* StoryPulse: all inference is performed by the local Python BiGRU server. */
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const LABELS = ["sadness", "joy", "love", "anger", "fear", "surprise"];
  const COLORS = {sadness:"#789bea",joy:"#e6c567",love:"#dc94af",anger:"#e38271",fear:"#b09cdb",surprise:"#7ac3b5"};
  const STORAGE = "storypulse.workspace.v1";
  const freshDraft = () => ({text:"",result:null,annotations:{},needsAnalysis:false});
  const state = {title:"Untitled story",active:"A",view:"analysis",read:false,granularity:"paragraphs",drafts:{A:freshDraft(),B:freshDraft()},selected:{A:{},B:{}},visible:new Set(LABELS),ready:false,health:null,busy:false,comparing:false,comparison:null};
  let toastTimer, saveTimer, storageWarned=false, restoring=false;
  const cap = value => value ? value[0].toUpperCase()+value.slice(1) : "Unscorable";
  const pct = value => `${((Number(value)||0)*100).toFixed(1)}%`;
  const wordCount = text => (text.trim().match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)||[]).length;
  const activeDraft = () => state.drafts[state.active];
  const isFresh = draft => !!draft.result && draft.result.text === draft.text;
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  function element(tag, cls, text) { const el=document.createElement(tag); if(cls)el.className=cls; if(text!==undefined)el.textContent=text; return el; }
  function svgEl(tag, attrs={}) { const el=document.createElementNS("http://www.w3.org/2000/svg",tag); for(const[k,v]of Object.entries(attrs))el.setAttribute(k,String(v)); return el; }
  function color(el,label) { el.style.setProperty("--emotion-color",COLORS[label]||"#cce6b0"); return el; }
  function pill(label, text) { return color(element("span","emotion-pill",text||cap(label)),label); }

  function toast(message) { clearTimeout(toastTimer); $("toast").textContent=message; $("toast").hidden=false; toastTimer=setTimeout(()=>$("toast").hidden=true,3800); }
  function showError(message) { $("errorText").textContent=message; $("errorBanner").hidden=false; }
  function clearError() { $("errorBanner").hidden=true; }
  async function api(path,options={}) {
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),120000);
    try {
      const response=await fetch(path,{...options,signal:controller.signal,cache:"no-store"});
      const data=await response.json().catch(()=>({}));
      if(!response.ok) {
        const detail=Array.isArray(data.detail)?data.detail.map(d=>d.msg).join("; "):data.detail;
        throw new Error(detail||`Request failed (${response.status}).`);
      }
      return data;
    } catch(error) {
      if(error.name==="AbortError")throw new Error("The request took too long. Try a shorter section or check the local server window.");
      if(error instanceof TypeError)throw new Error("Cannot reach the local server. Keep the StoryPulse launcher running, then try again.");
      throw error;
    } finally {clearTimeout(timeout);}
  }
  const post = (path,body) => api(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});

  function projectData() {
    const drafts={};
    for(const key of ["A","B"]){const d=state.drafts[key];drafts[key]={text:d.text,annotations:d.annotations,analyzed:isFresh(d)||d.needsAnalysis};}
    return {app:"StoryPulse",schema_version:1,title:state.title,active:state.active,granularity:state.granularity,drafts,saved_at:new Date().toISOString()};
  }
  function persist() {
    clearTimeout(saveTimer);
    $("saveStatus").innerHTML="<span></span>Saving in this browser…";
    saveTimer=setTimeout(()=>{
      try {localStorage.setItem(STORAGE,JSON.stringify(projectData()));$("saveStatus").innerHTML="<span></span>Saved in this browser";}
      catch {$("saveStatus").textContent="Browser storage unavailable";if(!storageWarned){toast("Use Save project to keep your work. Browser storage is unavailable.");storageWarned=true;}}
    },250);
  }
  function validatedProject(data) {
    if(!data||data.app!=="StoryPulse"||data.schema_version!==1||!data.drafts||typeof data.title!=="string")throw new Error("Choose a StoryPulse project saved as a .json file.");
    const drafts={};
    for(const key of ["A","B"]){
      const draft=data.drafts[key];
      if(!draft||typeof draft.text!=="string"||draft.text.length>60000)throw new Error(`Draft ${key} is missing or exceeds 60,000 characters.`);
      const annotations={};
      for(const[id,note]of Object.entries(draft.annotations||{})){
        if(!/^(paragraphs|sentences):[ps]\d+$/.test(id)||!note||typeof note!=="object")continue;
        if(!["",...LABELS,"uncertain"].includes(note.label))continue;
        annotations[id]={label:note.label,note:typeof note.note==="string"?note.note.slice(0,250):""};
      }
      drafts[key]={text:draft.text,result:null,annotations,needsAnalysis:!!draft.analyzed&&!!draft.text.trim()};
    }
    return {title:data.title.slice(0,100)||"Untitled story",drafts,active:data.active==="B"?"B":"A",granularity:data.granularity==="sentences"?"sentences":"paragraphs"};
  }
  function applyProject(data) {
    const incoming=validatedProject(data);
    Object.assign(state,incoming,{comparison:null,selected:{A:{},B:{}},read:false});
    $("projectTitle").value=state.title;$("granularity").value=state.granularity;
    setView("analysis");render();persist();
  }
  function restore() {
    try {const saved=localStorage.getItem(STORAGE);if(saved){const incoming=validatedProject(JSON.parse(saved));Object.assign(state,incoming);}}
    catch { /* A damaged browser cache never prevents opening the workspace. */ }
    $("projectTitle").value=state.title;$("granularity").value=state.granularity;
  }

  function setView(view) {
    if(state.view!==view)window.scrollTo(0,0);
    state.view=view;
    $("analysisView").hidden=view!=="analysis";$("compareView").hidden=view!=="compare";
    $("navAnalyze").classList.toggle("active",view==="analysis");$("navCompare").classList.toggle("active",view==="compare");
    $("navAnalyze").setAttribute("aria-current",view==="analysis"?"page":"false");$("navCompare").setAttribute("aria-current",view==="compare"?"page":"false");
    $("viewCrumb").textContent=view==="analysis"?"Story analysis":"Compare drafts";
    $("pageTitle").innerHTML=view==="analysis"?"Every story has a <em>pulse.</em>":"A new draft. A new <em>perspective.</em>";
    $("pageDescription").textContent=view==="analysis"?"See the emotion in your words. Follow the arc. Shape the next draft.":"Keep the intention. Explore the change. Read your revision with fresh eyes.";
    closeExport();if(view==="compare")renderCompare();
  }
  function setDraft(key) {
    state.active=key;state.read=false;$("storyText").value=activeDraft().text;setView("analysis");render();persist();
    if(activeDraft().needsAnalysis&&state.ready&&!state.busy)runAnalysis({preserve:true,quiet:true});
  }
  function setRead(read) {
    state.read=read&&!!activeDraft().result;
    $("editorHint").textContent=activeDraft().result&&!isFresh(activeDraft())?"Your last analysis is out of date.":state.read?"A closer look at every passage.":"Make room for your words.";
    $("storyText").hidden=state.read;$("passageReader").hidden=!state.read;
    $("writeMode").classList.toggle("selected",!state.read);$("readMode").classList.toggle("selected",state.read);
    $("writeMode").setAttribute("aria-pressed",String(!state.read));$("readMode").setAttribute("aria-pressed",String(state.read));
    if(state.read)renderReader();
  }
  function render() {
    const draft=activeDraft();
    if(document.activeElement!==$("storyText"))$("storyText").value=draft.text;
    if(document.activeElement!==$("projectTitle"))$("projectTitle").value=state.title;
    document.title=`${state.title} — StoryPulse`;
    document.querySelectorAll(".draft-link").forEach(el=>el.classList.toggle("selected",el.dataset.draft===state.active));
    for(const key of ["A","B"]){
      const d=state.drafts[key],n=wordCount(d.text);
      $("draftMeta"+key).textContent=n?`${n.toLocaleString()} words${isFresh(d)?" · analyzed":""}`:key==="A"?"Start writing":"Add a revision";
      $("draftIndicator"+key).className="draft-indicator"+(isFresh(d)?" analyzed":d.result?" stale":"");
      $("tab"+key).classList.toggle("active",key===state.active);$("tab"+key).setAttribute("aria-selected",String(key===state.active));
    }
    $("overviewVersion").textContent=`DRAFT ${state.active}`;
    $("wordCount").textContent=wordCount(draft.text).toLocaleString();$("charCount").textContent=`${draft.text.length.toLocaleString()} / 60,000 characters`;
    $("readMode").disabled=!draft.result;
    $("analyzeBtn").disabled=!state.ready||!draft.text.trim()||state.busy||state.comparing;
    $("analyzeBtn").classList.toggle("loading",state.busy);
    $("analyzeLabel").textContent=state.busy?"Reading the story…":draft.result&&!isFresh(draft)?"Reanalyze draft":"Analyze story";
    $("analysisState").className="analysis-state"+(state.busy?" busy":draft.result&&!isFresh(draft)?" stale":isFresh(draft)?" done":"");
    const statusText=state.busy?"Running your BiGRU…":!state.ready?"Waiting for the model":draft.result&&!isFresh(draft)?"Text changed · analyze again":isFresh(draft)?`${draft.result.sentences.length} sentences · ${draft.result.window_count} windows`:"Ready when you are";
    $("analysisState").replaceChildren(element("span","small-ring"),element("span","",statusText));
    $("editorHint").textContent=draft.result&&!isFresh(draft)?"Your last analysis is out of date.":state.read?"A closer look at every passage.":"Make room for your words.";
    $("editorHint").classList.toggle("stale-note",!!draft.result&&!isFresh(draft));
    $("csvBtn").disabled=!isFresh(draft);$("printBtn").disabled=!isFresh(draft);
    for(const id of ["sampleBtn","compareSampleBtn","uploadBtn","openBtn"])$(id).disabled=state.busy||state.comparing;
    setRead(state.read);renderOverview();renderTimeline();renderDetail();renderComparePreviews();
  }
  function renderOverview() {
    const draft=activeDraft(),r=draft.result;
    $("emptyInsight").hidden=!!r;$("insightContent").hidden=!r;
    if(!r)return;
    const data=r.overall;
    $("dominantEmotion").textContent=cap(data.predicted_emotion);color($("dominantEmotion"),data.predicted_emotion);
    $("dominantScore").textContent=pct(data.score);
    $("dominantNote").textContent=!isFresh(draft)?"Previous analysis. Your text has changed; analyze again to update these scores.":data.uncertain?"A less certain reading. Explore the passages before drawing conclusions.":"A token-weighted average of the model’s readings across the full draft.";
    $("dominantNote").classList.toggle("stale-note",!isFresh(draft));
    const container=$("emotionBars");container.replaceChildren();
    for(const label of [...LABELS].sort((a,b)=>data.probabilities[b]-data.probabilities[a])){
      const row=color(element("div","emotion-bar"),label),labelEl=element("span","emotion-bar-label");
      labelEl.append(element("i","color-dot"),document.createTextNode(label));
      const track=element("div","bar-track"),fill=element("div","bar-fill");fill.style.setProperty("--value",pct(data.probabilities[label]));track.append(fill);
      row.append(labelEl,track,element("span","emotion-bar-value",pct(data.probabilities[label])));container.append(row);
    }
    $("analysisSummary").textContent=`${r.uncertain_sentences} uncertain ${r.uncertain_sentences===1?"sentence":"sentences"} · ${r.elapsed_seconds.toFixed(2)}s${r.cached?" · cached":""}`;
  }
  function passages() {return activeDraft().result?.[state.granularity]||[];}
  function currentPassage() {const list=passages();return list.find(p=>p.id===state.selected[state.active][state.granularity])||null;}
  function annotationKey(p) {return `${state.granularity}:${p.id}`;}
  function renderReader() {
    const container=$("passageReader"),scroll=container.scrollTop;container.replaceChildren();
    for(const p of passages()){
      const card=element("button","passage-card"),selected=p.id===state.selected[state.active][state.granularity];
      card.type="button";card.dataset.passage=p.id;card.classList.toggle("selected",selected);card.setAttribute("aria-pressed",String(selected));
      card.append(element("span","passage-number",String(p.index+1).padStart(2,"0")));
      const body=element("span","passage-body"),meta=element("span","passage-meta");body.append(element("span","passage-text",p.text));
      meta.append(pill(p.predicted_emotion,`${cap(p.predicted_emotion)}${p.probabilities?" · "+pct(p.score):""}`));
      if(p.uncertain)meta.append(element("span","uncertain-pill","Uncertain"));
      const note=activeDraft().annotations[annotationKey(p)];if(note?.label)meta.append(element("span","manual-pill",`Your reading: ${cap(note.label)}`));
      body.append(meta);card.append(body);card.addEventListener("click",()=>selectPassage(p.id));container.append(card);
    }
    container.scrollTop=scroll;
  }
  function selectPassage(id,{reveal=false}={}) {
    state.selected[state.active][state.granularity]=id;
    if(reveal)setRead(true);else if(state.read)renderReader();
    renderTimeline();renderDetail();
    if(reveal){
      const selected=$("passageReader").querySelector(".selected");if(selected)selected.scrollIntoView({block:"nearest"});
      $("passageDetail").scrollIntoView({block:"nearest",behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"});
    }
  }
  function renderDetail() {
    const passage=currentPassage();$("passageDetail").hidden=!passage;if(!passage)return;
    const draft=activeDraft(),name=state.granularity==="paragraphs"?"Paragraph":"Sentence";
    $("selectedPassageLabel").textContent=`${name.toUpperCase()} ${passage.index+1} / ${passages().length}`;
    $("selectedQuote").textContent=passage.text;color($("selectedQuote"),passage.predicted_emotion);
    const meta=$("selectedModel");meta.replaceChildren(pill(passage.predicted_emotion,`Model: ${cap(passage.predicted_emotion)}`));
    if(passage.probabilities)meta.append(element("span","",`${pct(passage.score)} score`));
    if(passage.uncertain){const uncertainty=element("span","uncertain-pill","Uncertain reading");uncertainty.title=passage.uncertainty_reasons.join(" · ");meta.append(uncertainty);}
    const other=Object.entries(passage.probabilities||{}).sort((a,b)=>b[1]-a[1])[1];
    if(other)meta.append(element("span","",`Next: ${cap(other[0])} ${pct(other[1])}`));
    const note=draft.annotations[annotationKey(passage)]||{};
    $("annotationSelect").value=note.label||"";$("annotationNote").value=note.note||"";
    $("annotationSelect").disabled=!isFresh(draft);$("annotationNote").disabled=!isFresh(draft);
  }
  function saveAnnotation() {
    const p=currentPassage();if(!p||!isFresh(activeDraft()))return;
    const label=$("annotationSelect").value,note=$("annotationNote").value;
    if(!label&&!note)delete activeDraft().annotations[annotationKey(p)];else activeDraft().annotations[annotationKey(p)]={label,note};
    persist();if(state.read)renderReader();
  }

  function legend(container,interactive=true) {
    container.replaceChildren();
    for(const label of LABELS){
      const item=color(element(interactive?"button":"span","legend-item"),label);
      item.append(element("i"),document.createTextNode(label));
      if(interactive){item.classList.toggle("off",!state.visible.has(label));item.setAttribute("aria-pressed",String(state.visible.has(label)));item.title=`Show or hide ${label}`;item.addEventListener("click",()=>{if(state.visible.has(label))state.visible.delete(label);else state.visible.add(label);renderTimeline();});}
      container.append(item);
    }
  }
  function buildChart(list,{selected=null,compact=false,visible=LABELS,onSelect=null,print=false}={}) {
    const width=compact?480:950,height=182,left=35,right=18,top=12,bottom=27,pw=width-left-right,ph=height-top-bottom;
    const svg=svgEl("svg",{viewBox:`0 0 ${width} ${height}`,role:onSelect?"group":"img","aria-label":"Model emotion scores across the draft, from zero to one hundred percent."});
    const title=svgEl("title");title.textContent="Emotional timeline: model scores by passage";svg.append(title);
    const x=i=>list.length===1?left+pw/2:left+pw*i/Math.max(list.length-1,1),y=v=>top+(1-v)*ph;
    for(const value of [0,.25,.5,.75,1]){
      svg.append(svgEl("line",{x1:left,x2:width-right,y1:y(value),y2:y(value),class:"chart-grid"}));
      const label=svgEl("text",{x:left-7,y:y(value)+3,"text-anchor":"end",class:"chart-axis"});label.textContent=String(value*100);svg.append(label);
    }
    const selectedIndex=list.findIndex(p=>p.id===selected);
    if(selectedIndex>=0)svg.append(svgEl("line",{x1:x(selectedIndex),x2:x(selectedIndex),y1:top,y2:height-bottom,class:"chart-selection"}));
    for(const emotion of visible){
      const points=list.map((p,i)=>p.probabilities?`${x(i)},${y(p.probabilities[emotion])}`:null);
      // Break a line at unscorable passages rather than drawing invented zero scores.
      let segment=[];
      const drawSegment=()=>{if(segment.length){const line=svgEl("polyline",{points:segment.join(" "),class:"chart-line"});line.style.setProperty("--emotion-color",COLORS[emotion]);svg.append(line);segment=[];}};
      points.forEach(point=>{if(point)segment.push(point);else drawSegment();});drawSegment();
      list.forEach((p,i)=>{if(!p.probabilities||(list.length>80&&p.id!==selected))return;const circle=svgEl("circle",{cx:x(i),cy:y(p.probabilities[emotion]),r:p.id===selected?4.1:2.1,class:"chart-point"+(p.id===selected?" selected":"")});circle.style.setProperty("--emotion-color",COLORS[emotion]);svg.append(circle);});
    }
    const every=Math.max(1,Math.ceil(list.length/(compact?8:16)));
    list.forEach((p,i)=>{
      if(i%every===0||i===list.length-1){const label=svgEl("text",{x:x(i),y:height-7,"text-anchor":"middle",class:"chart-axis"});label.textContent=String(i+1);svg.append(label);}
      if(onSelect&&!print){
        const hitWidth=Math.max(1,pw/Math.max(list.length-1,1));
        const group=svgEl("g",{role:"button",tabindex:"0",class:"chart-focus","aria-label":`Passage ${i+1}: ${cap(p.predicted_emotion)}, ${pct(p.score)} model score${p.uncertain?", uncertain":""}`});
        const tooltip=svgEl("title");tooltip.textContent=`Passage ${i+1} · ${cap(p.predicted_emotion)} · ${pct(p.score)}${p.uncertain?" · uncertain":""}`;
        group.append(tooltip,svgEl("rect",{x:Math.max(left-8,x(i)-hitWidth/2),y:top-5,width:Math.min(hitWidth,width-right-Math.max(left-8,x(i)-hitWidth/2)),height:ph+10,class:"chart-hit"}));
        group.addEventListener("click",()=>onSelect(p.id));group.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();onSelect(p.id);}});svg.append(group);
      }
    });
    return svg;
  }
  function renderTimeline() {
    const list=passages(),has=!!activeDraft().result;
    $("timelineEmpty").hidden=has;$("timelineContent").hidden=!has;
    $("timelineCount").textContent=`${list.length} ${state.granularity==="paragraphs"?"paragraphs":"sentences"}`;
    if(!has)return;
    legend($("timelineLegend"));
    const chart=$("timelineChart");chart.replaceChildren(buildChart(list,{selected:state.selected[state.active][state.granularity],visible:[...state.visible],onSelect:id=>selectPassage(id,{reveal:true})}));
    $("timelineHint").textContent=!isFresh(activeDraft())?"Previous analysis — analyze your edited draft again.":"Click a passage to inspect its emotion. Scores are not intensity.";
    $("timelineHint").classList.toggle("stale-note",!isFresh(activeDraft()));
  }

  async function runAnalysis({preserve=false,quiet=false}={}) {
    if(state.busy||state.comparing)return;
    if(!state.ready){showError("The BiGRU is not ready. Wait for the model status to turn green, or check the local server window.");return;}
    const key=state.active,draft=state.drafts[key],text=draft.text;
    if(!text.trim()){showError("Add a story or script before analyzing.");return;}
    clearError();state.busy=true;render();
    try {
      const result=await post("/api/analyze",{text});
      if(draft.text!==text){toast("Analysis finished for the earlier text. Analyze again to include your edits.");draft.result=result;return;}
      draft.result=result;draft.needsAnalysis=false;if(!preserve)draft.annotations={};
      const list=result[state.granularity];state.selected[key][state.granularity]=list[0]?.id||null;
      if(state.active===key){state.read=true;}
      if(!quiet)toast(`Draft ${key} analyzed · ${result.sentences.length} sentences · ${result.elapsed_seconds.toFixed(2)}s`);
      persist();
    } catch(error){draft.needsAnalysis=false;showError(error.message);}
    finally{state.busy=false;render();}
  }

  async function loadSamples() {
    if(state.busy||state.comparing)return;
    clearError();
    try {
      const data=await api("/api/samples");
      state.title=data.title;state.drafts={A:{...freshDraft(),text:data.before},B:{...freshDraft(),text:data.after}};
      state.selected={A:{},B:{}};state.comparison=null;state.active="A";state.read=false;
      $("storyText").value=data.before;$("projectTitle").value=data.title;render();persist();
      toast("Two sample drafts loaded. Analyze Draft A or compare both versions.");
    } catch(error){showError(error.message);}
  }
  async function uploadDocument(file) {
    if(!file)return;
    if(!/\.(txt|docx)$/i.test(file.name)){showError("Choose a .txt or .docx document.");return;}
    if(file.size>2*1024*1024){showError("The document is larger than 2 MB. Choose a smaller file.");return;}
    if(state.busy||state.comparing)return;
    clearError();const key=state.active;state.busy=true;render();
    try {
      const body=new FormData();body.append("file",file);const data=await api("/api/extract",{method:"POST",body});
      state.drafts[key]={...freshDraft(),text:data.text};state.selected[key]={};state.comparison=null;
      if(state.title==="Untitled story"||!state.title.trim())state.title=data.title;
      if(state.active===key){state.read=false;$("storyText").value=data.text;}
      persist();toast(`${file.name} loaded into Draft ${key}. Ready to analyze.`);
    } catch(error){showError(error.message);}
    finally{state.busy=false;$("documentFile").value="";render();}
  }

  function renderComparePreviews() {
    for(const key of ["A","B"]){const draft=state.drafts[key];$("compareTitle"+key).textContent=draft.text.trim()?state.title+(key==="B"?" · revision":""):key==="A"?"Original draft":"Revised draft";$("comparePreview"+key).textContent=draft.text.trim()?draft.text.slice(0,260):key==="A"?"Add your first draft in the story editor.":"Add your revision in Draft B.";$("compareWords"+key).textContent=`${wordCount(draft.text).toLocaleString()} words${isFresh(draft)?" · analyzed":""}`;}
    $("compareBtn").disabled=state.busy||state.comparing||!state.ready||!state.drafts.A.text.trim()||!state.drafts.B.text.trim();
    $("compareBtn").classList.toggle("loading",state.comparing);$("compareBtn").querySelector("span").textContent=state.comparing?"Comparing both drafts…":"Compare drafts";
  }
  async function runComparison() {
    if(state.busy||state.comparing)return;
    if(!state.ready){showError("Wait for the model to load before comparing drafts.");return;}
    if(!state.drafts.A.text.trim()||!state.drafts.B.text.trim()){showError("Add text to both Draft A and Draft B before comparing.");return;}
    clearError();state.comparing=true;const before=state.drafts.A.text,after=state.drafts.B.text;render();renderCompare();
    try {
      const result=await post("/api/compare",{before,after});
      if(before!==state.drafts.A.text||after!==state.drafts.B.text){toast("The drafts changed while comparing. Run the comparison again.");return;}
      for(const[key,r]of [["A",result.before],["B",result.after]]){const d=state.drafts[key];if(d.result&&d.result.text!==r.text)d.annotations={};d.result=r;d.needsAnalysis=false;}
      state.comparison=result;persist();toast("Comparison complete. Explore the profiles, timelines, and text changes.");
    } catch(error){showError(error.message);}
    finally{state.comparing=false;render();renderCompare();}
  }
  function comparisonIsFresh() {return !!state.comparison&&state.comparison.before.text===state.drafts.A.text&&state.comparison.after.text===state.drafts.B.text;}
  function renderCompare() {
    renderComparePreviews();const has=comparisonIsFresh();$("compareResults").hidden=!has;$("compareEmpty").hidden=has;
    if(!has)return;
    const data=state.comparison,stats=$("compareSummary");stats.replaceChildren();
    for(const kind of ["modified","added","removed","unchanged"]){const card=element("div","comparison-stat");card.append(element("strong","",String(data.counts[kind])),element("span","",`${kind} ${data.counts[kind]===1?"passage":"passages"}`));stats.append(card);}
    const profiles=$("comparisonProfiles");profiles.replaceChildren();
    for(const label of LABELS){
      const cell=color(element("div","profile-cell"),label),heading=element("div","profile-heading"),name=element("span"),delta=data.score_changes[label]*100;
      name.append(element("i","color-dot"),document.createTextNode(label));heading.append(name,element("span","score-delta",`${delta>0?"+":""}${delta.toFixed(1)} pp`));cell.append(heading);
      for(const[letter,r]of [["A",data.before],["B",data.after]]){const row=element("div","profile-version"),track=element("div","bar-track"),fill=element("div","bar-fill");fill.style.setProperty("--value",pct(r.overall.probabilities[label]));track.append(fill);row.append(element("span","",letter),track,element("span","",pct(r.overall.probabilities[label])));cell.append(row);}
      profiles.append(cell);
    }
    legend($("compareLegend"),false);
    for(const[key,r]of [["A",data.before],["B",data.after]])$("compareChart"+key).replaceChildren(buildChart(r.paragraphs,{compact:true,onSelect:id=>{setDraft(key);state.granularity="paragraphs";$("granularity").value="paragraphs";selectPassage(id,{reveal:true});}}));
    renderDiff();
  }
  function renderDiff() {
    if(!comparisonIsFresh())return;
    const container=$("diffContent");container.replaceChildren();const changesOnly=$("changesOnly").checked;
    for(const block of state.comparison.blocks){
      if(changesOnly&&block.kind==="unchanged")continue;
      const row=element("div",`diff-row ${block.kind}`);
      for(const side of ["before","after"]){const cell=element("div","diff-cell"),part=block[side];
        cell.append(element("span","diff-type",`${part?"Paragraph "+part.id.slice(1):"—"} · ${block.kind}`));
        if(part){for(const segment of part.segments)cell.append(element(segment.changed?"mark":"span","",segment.text));}
        else cell.append(element("span","diff-missing",side==="before"?"New in the revision":"Removed in the revision"));
        row.append(cell);
      }
      container.append(row);
    }
    if(!container.childElementCount)container.append(element("p","compare-note","No changed passages. The two drafts have identical paragraph text."));
  }

  function closeExport() {$("exportMenu").hidden=true;$("exportBtn").setAttribute("aria-expanded","false");}
  function filename(suffix) {return (state.title.trim().replace(/[^\p{L}\p{N}._-]+/gu,"_").slice(0,70)||"StoryPulse")+suffix;}
  function download(content,name,type) {
    const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),link=element("a");link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
  }
  function exportProject() {download(JSON.stringify(projectData(),null,2),filename(".storypulse.json"),"application/json;charset=utf-8");closeExport();toast("Project saved. Open this JSON file in StoryPulse to continue.");}
  function csvCell(value) {let text=String(value??"");if(/^[=+@\-\t\r]/.test(text))text="'"+text;return '"'+text.replace(/"/g,'""')+'"';}
  function exportCSV() {
    const draft=activeDraft();if(!isFresh(draft)){showError("Analyze the current draft before exporting results.");return;}
    const headers=["draft","level","passage","start_character_0_based","end_character_exclusive","text","model_emotion","model_score","uncertain","uncertainty_reasons","manual_emotion","manual_note",...LABELS.map(l=>l+"_score")];
    const rows=[headers];
    for(const level of ["paragraphs","sentences"])for(const p of draft.result[level]){const note=draft.annotations[`${level}:${p.id}`]||{};rows.push([state.active,level,p.index+1,p.start,p.end,p.text,p.predicted_emotion,p.score.toFixed(6),p.uncertain,p.uncertainty_reasons.join("; "),note.label,note.note,...LABELS.map(l=>p.probabilities?.[l]?.toFixed(6)??"")]);}
    download("\ufeff"+rows.map(row=>row.map(csvCell).join(",")).join("\r\n"),filename(`_draft_${state.active}_results.csv`),"text/csv;charset=utf-8");closeExport();toast("CSV exported with original predictions and separate annotations.");
  }
  function printReport() {
    const draft=activeDraft();if(!isFresh(draft)){showError("Analyze this draft before creating the report.");return;}
    const r=draft.result,report=$("printReport");report.replaceChildren();
    report.append(element("p","report-kicker","STORYPULSE / EMOTION ANALYSIS REPORT"),element("h1","",state.title),element("p","report-meta",`Draft ${state.active} · ${new Date(r.analyzed_at).toLocaleString()} · ${r.word_count} words · ${r.sentences.length} sentences · ${r.window_count} model windows`));
    report.append(element("h2","","Overview"),element("p","",`Leading model emotion: ${cap(r.overall.predicted_emotion)} · ${pct(r.overall.score)} model score. ${r.uncertain_sentences} sentences were flagged as uncertain.`));
    const table=element("table"),head=element("tr");head.append(element("th","","Emotion"),element("th","","Average model score"));table.append(head);
    for(const label of LABELS){const row=element("tr");row.append(element("td","",cap(label)),element("td","",pct(r.overall.probabilities[label])));table.append(row);}report.append(table);
    report.append(element("h2","","Emotional timeline"));const chart=element("div","report-chart");chart.append(buildChart(r.paragraphs,{print:true}));report.append(chart,element("p","report-meta","Blue: sadness · gold: joy · pink: love · coral: anger · purple: fear · teal: surprise. Horizontal axis: paragraph order. Vertical axis: model score (%)."));
    report.append(element("h2","","Passage readings · by paragraph"));
    for(const p of r.paragraphs){const item=element("section","report-passage"),note=draft.annotations[`paragraphs:${p.id}`];item.append(element("h3","",`Paragraph ${p.index+1} · ${cap(p.predicted_emotion)} · ${pct(p.score)}${p.uncertain?" · uncertain":""}`),element("p","",p.text));if(note?.label||note?.note)item.append(element("p","report-meta",`Your annotation: ${note.label?cap(note.label):"Note only"}${note.note?" — "+note.note:""}`));report.append(item);}
    const sentenceNotes=Object.entries(draft.annotations).filter(([key,note])=>key.startsWith("sentences:")&&(note.label||note.note));
    if(sentenceNotes.length){report.append(element("h2","","Sentence annotations"));for(const[key,note]of sentenceNotes){const p=r.sentences.find(s=>s.id===key.split(":")[1]);if(p)report.append(element("p","",`Sentence ${p.index+1}: ${p.text}\nYour annotation: ${note.label?cap(note.label):"Note only"}${note.note?" — "+note.note:""}`));}}
    report.append(element("p","report-footnote",`Produced locally using the original six-emotion BiGRU. Scores are uncalibrated model outputs, not accuracy, emotional intensity, or readers’ feelings. The classifier has no trained neutral category. Uncertainty is a heuristic (top score <55%, leading margin <15 percentage points, or vocabulary coverage <30%). Paragraph and document scores are token-weighted averages. Manual annotations do not change model scores. Model SHA-256: ${r.model.artifact_sha256}`));
    closeExport();window.print();
  }
  async function importProject(file) {
    if(!file)return;
    if(file.size>4*1024*1024){showError("This project file exceeds 4 MB. Choose a StoryPulse JSON project.");return;}
    try {const data=JSON.parse(await file.text());applyProject(data);clearError();toast("Project opened. Saved analyses are recomputed with your actual model.");if(activeDraft().needsAnalysis&&state.ready)await runAnalysis({preserve:true,quiet:true});}
    catch(error){showError(error instanceof SyntaxError?"This file is not valid JSON. Choose an exported StoryPulse project.":error.message);}
    finally{$("projectFile").value="";}
  }

  function showInfo(section="help") {
    const meta=state.health?.model||{},body=$("dialogBody");
    const basics=`<h3>Read a story in three steps</h3><ol><li>Paste or upload your writing into Draft A, then select <strong>Analyze story</strong>.</li><li>Explore the six emotion scores. Select a timeline point or a passage to inspect it and add your interpretation.</li><li>Add a revision in Draft B and select <strong>Compare drafts</strong>. Save your project or export a report.</li></ol><p><strong>Try a sample story</strong> loads two complete drafts. Predictions are computed when you analyze or compare them.</p>`;
    const scores=`<h3>What the numbers mean</h3><p>Each 50-token window produces six scores that sum to 100%. Sentences, paragraphs, and the whole draft use token-weighted averages. A score expresses the model’s preference among its six categories; it is <strong>not measured accuracy or emotional intensity</strong>.</p><p>A reading is marked <strong>uncertain</strong> when its leading score is below 55%, its lead over the next emotion is below 15 percentage points, or fewer than 30% of its tokens are in the known vocabulary. These are transparent heuristics, not calibrated error probabilities.</p><p><strong>Neutral is not a trained category.</strong> The model may assign an emotion to matter-of-fact writing. Uncertainty does not mean neutral. Several passages can express different emotions even when the overall draft has one leading score.</p>`;
    const limits=`<h3>Model & limitations</h3><p>The original model was trained on English short social-media text using the DAIR.AI emotion dataset. Literature, scripts, sarcasm, indirect emotion, and unfamiliar vocabulary can produce mistakes. These are estimates of emotion expressed in text, not a diagnosis of a person or a prediction of how a reader will feel.</p><p>The notebook reports 92.1% on a split also used for training validation. That result is not an independent evaluation of StoryPulse or story-writing accuracy. The model has not been retrained for this webpage.</p><div class="model-facts"><div><small>Architecture</small><strong>Embedding → two stacked BiGRUs</strong></div><div><small>Parameters</small><strong>${meta.parameters?Number(meta.parameters).toLocaleString():"Loading…"}</strong></div><div><small>Input window</small><strong>50 tokens, post-padding</strong></div><div><small>Long documents</small><strong>All windows are processed</strong></div><div><small>Runtime</small><strong>TensorFlow ${esc(meta.tensorflow_version||"loading")}</strong></div><div><small>Storage</small><strong>This browser + JSON downloads</strong></div></div><p>Annotations preserve your interpretation separately. They do not retrain the network. Draft A and B are compared using text differences and model-score changes, not an automatic writing-quality grade.</p>`;
    const privacy=`<h3>Local by design</h3><p>The webpage sends text only to the Python server on <code>127.0.0.1</code>. No cloud inference, online fonts, or external analytics are used. Browser autosave keeps the current workspace; JSON downloads let you explicitly save and reopen it. Reopened analyses are recomputed by the model.</p><p>Use up to 60,000 characters per draft. Uploads accept UTF-8/UTF-16 text and Word documents up to 2 MB. Larger stories can be analyzed chapter by chapter.</p>`;
    body.innerHTML=section==="help"?basics+scores+privacy:section==="scores"?scores+limits:limits+scores+privacy;
    $("infoDialog").showModal();
  }
  async function checkHealth() {
    try {
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
      let response;try{response=await fetch("/health",{cache:"no-store",signal:controller.signal});}finally{clearTimeout(timer);}
      if(!response.ok)throw new Error("The server is unavailable.");
      const health=await response.json();state.health=health;state.ready=!!health.model_loaded;
      $("statusDot").className="status-dot"+(state.ready?" ready":health.error?" error":"");
      $("modelStatus").textContent=state.ready?"BiGRU model ready":health.error?"Model needs attention":"Starting the model…";
      if(health.error)showError("The model could not load. "+health.error);
    } catch {state.ready=false;$("statusDot").className="status-dot error";$("modelStatus").textContent="Local server offline";}
    render();
    if(state.ready&&activeDraft().needsAnalysis&&!state.busy&&!state.comparing&&!restoring){restoring=true;try{await runAnalysis({preserve:true,quiet:true});}finally{restoring=false;}}
    setTimeout(checkHealth,state.ready?20000:2500);
  }

  $("navAnalyze").addEventListener("click",()=>setView("analysis"));$("navCompare").addEventListener("click",()=>setView("compare"));
  document.querySelectorAll("[data-draft]").forEach(button=>button.addEventListener("click",()=>setDraft(button.dataset.draft)));
  $("writeMode").addEventListener("click",()=>setRead(false));$("readMode").addEventListener("click",()=>setRead(true));
  $("storyText").addEventListener("input",()=>{const d=activeDraft();d.text=$("storyText").value;d.needsAnalysis=false;if(d.result&&!isFresh(d))d.annotations={};state.comparison=null;render();persist();});
  $("projectTitle").addEventListener("input",()=>{state.title=$("projectTitle").value;document.title=`${state.title||"Untitled story"} — StoryPulse`;renderComparePreviews();persist();});
  $("projectTitle").addEventListener("blur",()=>{if(!state.title.trim()){state.title="Untitled story";$("projectTitle").value=state.title;persist();}});
  $("analyzeBtn").addEventListener("click",()=>runAnalysis());$("compareBtn").addEventListener("click",runComparison);
  $("sampleBtn").addEventListener("click",loadSamples);$("compareSampleBtn").addEventListener("click",loadSamples);
  $("uploadBtn").addEventListener("click",()=>$("documentFile").click());$("documentFile").addEventListener("change",()=>uploadDocument($("documentFile").files[0]));
  $("openBtn").addEventListener("click",()=>$("projectFile").click());$("projectFile").addEventListener("change",()=>importProject($("projectFile").files[0]));
  $("saveBtn").addEventListener("click",exportProject);$("exportProjectBtn").addEventListener("click",exportProject);
  $("exportBtn").addEventListener("click",()=>{const open=$("exportMenu").hidden;$("exportMenu").hidden=!open;$("exportBtn").setAttribute("aria-expanded",String(open));});
  document.addEventListener("click",event=>{if(!event.target.closest(".export-wrap"))closeExport();});
  $("csvBtn").addEventListener("click",exportCSV);$("printBtn").addEventListener("click",printReport);
  $("annotationSelect").addEventListener("change",saveAnnotation);$("annotationNote").addEventListener("input",saveAnnotation);
  $("granularity").addEventListener("change",()=>{state.granularity=$("granularity").value;render();persist();});
  $("changesOnly").addEventListener("change",renderDiff);
  for(const id of ["helpBtn","scoreHelp","modelBtn","limitationsBtn"])$(id).addEventListener("click",()=>showInfo(id==="helpBtn"?"help":id==="scoreHelp"?"scores":"model"));
  $("closeDialog").addEventListener("click",()=>$("infoDialog").close());$("dialogDone").addEventListener("click",()=>$("infoDialog").close());
  $("infoDialog").addEventListener("click",event=>{if(event.target===$("infoDialog")){const bounds=$("infoDialog").getBoundingClientRect();if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)$("infoDialog").close();}});
  $("dismissError").addEventListener("click",clearError);
  document.addEventListener("keydown",event=>{if((event.ctrlKey||event.metaKey)&&event.key==="Enter"&&!$("infoDialog").open){event.preventDefault();state.view==="compare"?runComparison():runAnalysis();}if(event.key==="Escape")closeExport();});
  window.addEventListener("beforeunload",()=>{try{localStorage.setItem(STORAGE,JSON.stringify(projectData()));}catch{}});
  restore();render();checkHealth();
})();
