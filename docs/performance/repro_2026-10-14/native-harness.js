(() => {
if (!window.__chronoscope || window.__perfRunning) return;
window.__perfRunning = true;
(async () => {
const C = window.__chronoscope, v = C.view;
const emit = payload => window.__TAURI_INTERNALS__.invoke('perf_emit', {payload});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const raf = () => new Promise(r => requestAnimationFrame(r));
const settle = async () => {await raf(); await raf(); await sleep(100);};
const wait = async (fn, timeout=30000) => {const start=performance.now(); while(!fn()){if(performance.now()-start>timeout)throw Error('readiness timeout');await sleep(25);}};
const stats = a => {a=[...a].sort((x,y)=>x-y);const q=p=>a[Math.min(a.length-1,Math.floor(p*a.length))]??null;return {n:a.length,mean:a.length?a.reduce((x,y)=>x+y,0)/a.length:null,p50:q(.5),p95:q(.95),p99:q(.99),max:a[a.length-1]??null,over33:a.filter(x=>x>33.333).length,over50:a.filter(x=>x>50).length};};
try {
await v.ready; if(window.__perfExpanded){document.querySelector('#fullscreen').click();await sleep(300);} await wait(()=>C.snapshot?.count===192 && v.points.length===192 && !C.busy); await settle();
const gl=v.renderer.backend.gl;
if (!gl) throw Error('Expected native WebGL2 fallback; WebGPU requires a separate harness');
const ext=gl.getExtension('WEBGL_debug_renderer_info');
const renderer=ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
const proof={renderer,vendor:ext?gl.getParameter(ext.UNMASKED_VENDOR_WEBGL):gl.getParameter(gl.VENDOR),version:gl.getParameter(gl.VERSION),shading:gl.getParameter(gl.SHADING_LANGUAGE_VERSION),backend:document.querySelector('#backend').textContent,webgpu:!!navigator.gpu,viewport:[innerWidth,innerHeight],canvas:[gl.drawingBufferWidth,gl.drawingBufferHeight],dpr:devicePixelRatio,navigationReadyMs:performance.now(),glExtensions:gl.getSupportedExtensions()};
await emit({event:'ready',proof});
if(!window.__perfAllowIntegrated && (!/AMD|Radeon|POLARIS/i.test(renderer)||/llvmpipe|lavapipe|swiftshader|software/i.test(renderer)))throw Error('Discrete hardware gate failed: '+renderer);
let active=null, gpuPending=[];
const timer=gl.getExtension('EXT_disjoint_timer_query_webgl2');
const original=v.renderer.render.bind(v.renderer);
v.renderer.render=(...args)=>{const start=performance.now();let query;
 if(active && timer){query=gl.createQuery();gl.beginQuery(timer.TIME_ELAPSED_EXT,query);}
 const result=original(...args);
 if(query){gl.endQuery(timer.TIME_ELAPSED_EXT);gpuPending.push({query,target:active.gpu});}
 if(active){active.starts.push(start);active.cpu.push(performance.now()-start);}
 return result;
};
const pollGPU=()=>{const disjoint=timer&&gl.getParameter(timer.GPU_DISJOINT_EXT);gpuPending=gpuPending.filter(({query,target})=>{if(!gl.getQueryParameter(query,gl.QUERY_RESULT_AVAILABLE))return true;if(!disjoint)target.push(gl.getQueryParameter(query,gl.QUERY_RESULT)/1e6);gl.deleteQuery(query);return false;});};
const capture=async label=>{const png=await v.screenshot();await emit({event:'capture',label,png,instances:v.pointMesh?.count,points:v.points.length,mode:v.mode,canvas:[gl.drawingBufferWidth,gl.drawingBufferHeight]});};
await capture('native-demo');if(window.__perfQuick){await emit({event:'complete'});return;}
if(window.__perfWorkflowOnly){
 for(let repeat=1;repeat<=3;repeat++){
  await C.call('demo');await C.refresh();await sleep(500);
  const [a,b]=C.snapshot.time_bounds,expected=f=>Math.floor(Math.round(a+(b-a)*f)/60)*60,slider=document.querySelector('#window-start');
  slider.value='200';slider.dispatchEvent(new Event('input',{bubbles:true}));await wait(()=>C.snapshot.filter.start===expected(.2)&&v.points.length===C.snapshot.visible);await raf();await raf();
  slider.value='400';slider.dispatchEvent(new Event('input',{bubbles:true}));await sleep(1000);
  await emit({event:'rapid-timeline',repeat,expectedStart:expected(.4),actualStart:C.snapshot.filter.start,actualSliderValue:slider.value,expectedVisible:(await C.call('query',{filter:{start:expected(.4)},limit:1})).count,actualVisible:C.snapshot.visible,lost:C.snapshot.filter.start!==expected(.4)});
 }
}

await emit({event:'phase',label:'idle'});const idle={starts:[],cpu:[],gpu:[]};active=idle;await sleep(5000);active=null;pollGPU();await emit({event:'idle',draws:idle.starts.length,durationMs:5000});
const sample=async(label,kind='orbit',duration=5000)=>{
 await settle(); await emit({event:'phase',label});const record={starts:[],cpu:[],gpu:[]}, rafTimes=[];
 active=record;const start=performance.now();let index=0;const base=v.camera.position.clone(), target=v.controls.target.clone();
 while(performance.now()-start<duration){const t=await raf();rafTimes.push(t);index++;
 if(kind==='orbit') {const angle=index*.008, x=base.x-target.x,z=base.z-target.z;v.camera.position.set(target.x+x*Math.cos(angle)+z*Math.sin(angle),base.y,target.z+z*Math.cos(angle)-x*Math.sin(angle));v.controls.update();}
 else if(kind==='panzoom'){v.camera.zoom=1+.1*Math.sin(index*.035);v.camera.position.x=base.x+.1*Math.sin(index*.02);v.camera.updateProjectionMatrix();v.controls.update();v.draw();}
 else v.draw();
 pollGPU();
 }
 await raf();active=null;await sleep(150);pollGPU();const elapsed=performance.now()-start-150;
 const intervals=record.starts.slice(1).map((t,i)=>t-record.starts[i]);
 await emit({event:'sample',label,kind,durationMs:elapsed,renderCalls:record.starts.length,submissionFPS:record.starts.length*1000/elapsed,renderIntervalMs:stats(intervals),rafIntervalMs:stats(rafTimes.slice(1).map((t,i)=>t-rafTimes[i])),renderSubmitCpuMs:stats(record.cpu),gpuElapsedMs:stats(record.gpu),instances:v.pointMesh?.count,points:v.points.length,mode:v.mode,canvas:[gl.drawingBufferWidth,gl.drawingBufferHeight],info:{memory:v.renderer.info.memory,trailsLimited:v.trailsLimited}});
 v.camera.position.copy(base);v.controls.target.copy(target);v.controls.update();
};
if(!window.__perfWorkflowOnly){
for(let repeat=1;repeat<=3;repeat++) await sample('demo-orbit-r'+repeat);
// Geometry-only stress is deliberately separate from exact engine-backed data.
const p=v.points[0], lo=v.lo, hi=lo+48*900;
const names=Array.from({length:20},(_,i)=>'Synthetic track '+i);
const points=n=>Array.from({length:n},(_,i)=>({...p,id:String(i+1),lat:43.1+(i%1000)*.0008,lon:-79.9+Math.floor(i/1000)*.008,time:lo+(i%48)*900,entity:Math.floor(i/(n/20))}));
for(const n of [20000,100000]){
 const ps=points(n);
 for(let repeat=1;repeat<=3;repeat++){
  v.setMode('space-time');await settle();const start=performance.now();await v.setData(ps.map(p=>({...p,value:repeat})),names,[-80,43,-79,44],[lo,hi]);await settle();await emit({event:'construction',label:'space-time-'+n+'-r'+repeat,milliseconds:performance.now()-start,instances:v.pointMesh?.count});
  await sample('space-time-'+n+'-r'+repeat);
 }
 await capture('space-time-'+n);
 for(const mode of window.__perfExpanded?[]:(n===20000?['map','calendar','globe']:['globe'])){
  for(let repeat=1;repeat<=3;repeat++){
   const start=performance.now();v.setMode(mode);if(mode==='globe')await v.earthLoading;await settle();await emit({event:'construction',label:mode+'-'+n+'-r'+repeat,milliseconds:performance.now()-start,instances:v.pointMesh?.count});
   await sample(mode+'-'+n+'-r'+repeat,mode==='map'?'panzoom':'orbit');
  }
  await capture(mode+'-'+n);
 }
}
}
if(window.__perfExpanded){await emit({event:'complete'});return;}
// Reset to real engine data; UI timeline changes include debounce/backend/rebuild.
await C.call('demo');v.setMode('space-time');await C.refresh();await settle();
for(let repeat=1;repeat<=3;repeat++){
 const timings=[];
 for(const fraction of [.2,.4,.6,.1,.0]){
  await sleep(400);const slider=document.querySelector('#window-start');const [a,b]=C.snapshot.time_bounds;const expected=fraction===0?null:Math.floor(Math.round(a+(b-a)*fraction)/60)*60;slider.value=String(fraction*1000);const start=performance.now();slider.dispatchEvent(new Event('input',{bubbles:true}));
  await wait(()=>!C.busy&&C.snapshot.filter.start===expected&&v.points.length===C.snapshot.visible);await raf();await raf();timings.push(performance.now()-start);
 }
 await emit({event:'timeline',repeat,latencyMs:timings,stats:stats(timings),measurement:'input-to-snapshot/filter and geometry ready plus two rAF; includes 150ms debounce; polling <=25ms'});
}
const preview=await C.call('import_preview',{path:window.__perfRepo+'/tests/fixtures/terrain/terrain-study.csv'});await C.call('import_commit',{import_id:preview.import_id});
const terrainInfo=await C.call('terrain_load',{path:window.__perfRepo+'/tests/fixtures/terrain/n43.dt0'});C.setTerrainInfo(terrainInfo);C.setBounds(terrainInfo.bounds);await C.refresh();await C.rebuildTerrain();v.fit();
await settle();await emit({event:'terrain',width:v.terrain?.width,height:v.terrain?.height,points:v.points.length});
for(let repeat=1;repeat<=3;repeat++)await sample('terrain-demo-r'+repeat);
await capture('terrain-demo');
await emit({event:'complete'});
} catch(error) {await emit({event:'error',message:String(error),stack:error.stack,state:{filter:C.snapshot?.filter,points:v.points.length,visible:C.snapshot?.visible,busy:C.busy}});}
})();
})();
