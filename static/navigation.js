/* Persistent app frame. Page factories own their listeners, requests and timers.
   No eval, remote dependencies, HTML cache, or replay of document scripts. */
const routes=new Map([['/','zeitplan'],...['kosten','angebote','belege','finanzierung','energieplanung','stammdaten','dokumente','daten'].map(x=>['/'+x,x])]);
const nativeFetch=window.fetch.bind(window);
const globalIDs=new Set(['phbAIDialog','phbImportWait']);
const modules=new Map();
let initialReady=Promise.resolve();
let current=null,flight=null,navigationID=0,historyIndex=Number(history.state?.phbIndex||0),restoringHistory=false;
const signature=form=>JSON.stringify([...form.querySelectorAll('input,select,textarea')].filter(field=>field.name&&field.dataset.phbIgnoreDirty!=='true').map(field=>[field.name,
 field.type==='file'?[...field.files].map(file=>[file.name,file.size,file.lastModified]):
 field.type==='checkbox'||field.type==='radio'?[field.value,field.checked]:field.multiple?[...field.selectedOptions].map(option=>option.value):field.value]));

function extract(doc){
 const main=doc.getElementById('phbMain');
 if(!main||!doc.getElementById('phbSidebar'))throw Error('Die Zielseite konnte nicht als App-Ansicht geladen werden.');
 const host=doc.createElement('div');host.className='phb-page-host';
 main.replaceWith(host);host.append(main);
 for(const node of doc.querySelectorAll('dialog,#scheduleChatFab,#aiScheduleChatPanel,#toast')){
  if(!globalIDs.has(node.id)&&!host.contains(node))host.append(node);
 }
 // Scripts from server templates are never executed during content navigation.
 host.querySelectorAll('script').forEach(node=>node.remove());
 return host;
}

function createScope(host,url){
 const events=new AbortController(),requests=new Set(),timers=new Set(),intervals=new Set(),observers=new Set(),pending=new Set();
 const state=new Map(),touched=new Set(),locals=new Map(),objectURLs=new Set();let active=false,disposed=false,writes=0,submitted=null;
 const find=id=>host.querySelector('#'+CSS.escape(id));
 const resolve=value=>typeof value==='string'?find(value):value;
 const listen=(target,type,callback,options)=>{
  target.addEventListener(type,event=>{if(!disposed&&(active||event.type.startsWith('phb-')))callback.call(target,event);},
   {...(typeof options==='boolean'?{capture:options}:options),signal:events.signal});
 };
 const doc=new Proxy(document,{get(target,key){
  if(key==='getElementById')return id=>find(id)||(String(id).startsWith('phb')?document.getElementById(id):null);
  if(key==='querySelector')return selector=>host.querySelector(selector);
  if(key==='querySelectorAll')return selector=>host.querySelectorAll(selector);
  if(key==='body')return host;
  if(key==='readyState')return 'complete';
  if(key==='addEventListener')return (type,callback,options)=>listen(document,type,callback,options);
  if(key==='removeEventListener')return ()=>{}; // all page document listeners are released together
  const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
 }});
 let pageURL=new URL(url,location.href);
 const pageHistory={replaceState(data,title,value){
  if(value)pageURL=new URL(value,pageURL);
  if(active)history.replaceState({...history.state,...data,phb:true},title,pageURL);
 },pushState(data,title,value){if(active)history.pushState({...data,phb:true},title,value);}};
 const pageLocation=new Proxy({}, {get(_,key){
  if(key==='assign'||key==='replace')return value=>{if(!disposed)void visit(new URL(value,pageURL).href,{replace:key==='replace'});};
  if(key==='reload')return ()=>{if(!disposed)void visit(pageURL.href,{replace:true});};
  if(key==='toString')return ()=>pageURL.href;
  return pageURL[key];
 },set(_,key,value){if(key==='href'){if(!disposed)void visit(new URL(value,pageURL).href);return true;}return false;}});
 const win=new Proxy(window,{get(target,key){
  if(key==='location')return pageLocation;
  if(key==='history')return pageHistory;
  if(key==='addEventListener')return (type,callback,options)=>listen(window,type,callback,options);
  if(key==='removeEventListener')return ()=>{};
  if(locals.has(key))return locals.get(key);
  const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
 },set(_,key,value){locals.set(key,value);return true;}});
 const trackedFetch=(input,init={})=>{
  if(disposed)return Promise.reject(new DOMException('Ansicht geschlossen','AbortError'));
  const method=(init.method||(input instanceof Request?input.method:'GET')).toUpperCase(),read=['GET','HEAD'].includes(method);
  const controller=new AbortController();requests.add(controller);
  const signal=init.signal||(input instanceof Request?input.signal:null);
  if(signal){if(signal.aborted)controller.abort();else signal.addEventListener('abort',()=>controller.abort(),{once:true,signal:controller.signal});}
  const form=submitted;if(!read){writes++;submitted=null;}
  const promise=fetch(input,{...init,signal:controller.signal}).then(async response=>{
   // Initial readiness includes the response body, not just its headers.
   if(read&&response.headers.get('Content-Type')?.includes('application/json'))await response.clone().text();
   if(!read&&response.ok&&form){state.set(form,signature(form));touched.delete(form);}
   if(response.status===401)document.dispatchEvent(new CustomEvent('phb-session-expired'));
   return response;
  }).finally(()=>{requests.delete(controller);pending.delete(promise);if(!read)writes--;});
  pending.add(promise);return promise;
 };
 const timeout=(fn,ms,...args)=>{const id=setTimeout(()=>{timers.delete(id);if(!disposed)fn(...args);},ms);timers.add(id);return id;};
 class PageObserver extends MutationObserver{constructor(callback){super((...args)=>{if(!disposed)callback(...args);});observers.add(this);}}
 const flow={...window.PHBFlow,manage(config){
  const forms=(config.forms||[]).map(resolve),controller=window.PHBFlow.manage({...config,
   dialog:resolve(config.dialog),forms,dismiss:(config.dismiss||[]).map(resolve)});
  const clean=()=>{for(const form of forms){state.set(form,signature(form));touched.delete(form);}};
  return {...controller,snapshot(){controller.snapshot();clean();},finish(value){controller.finish(value);clean();},open(options){const result=controller.open(options);clean();return result;}};
 }};
 // Only user-touched forms can block navigation. Filters and programmatic fills do not.
 const touch=event=>{const form=event.target.form;if(form)touched.add(form);};
 host.addEventListener('input',touch);host.addEventListener('change',touch);
 host.addEventListener('submit',event=>{submitted=event.target;},true);
 function baseline(){for(const form of host.querySelectorAll('form')){const value=signature(form);form.dataset.phbInitial=value;state.set(form,value);}}
 class PageURL extends URL{static createObjectURL(blob){const value=URL.createObjectURL(blob);objectURLs.add(value);return value;}static revokeObjectURL(value){objectURLs.delete(value);URL.revokeObjectURL(value);}}
 const scope={URL:PageURL,document:doc,window:win,location:pageLocation,history:pageHistory,fetch:trackedFetch,
  PHBFlow:flow,PHBUI:window.PHBUI,MutationObserver:PageObserver,setTimeout:timeout,
  clearTimeout:id=>{timers.delete(id);clearTimeout(id);},
  setInterval:(fn,ms,...args)=>{const id=setInterval(()=>{if(!disposed)fn(...args);},ms);intervals.add(id);return id;},
  clearInterval:id=>{intervals.delete(id);clearInterval(id);}};
 return {host,scope,get url(){return pageURL;},get writes(){return writes;},
  activate(){active=true;baseline();document.dispatchEvent(new CustomEvent('phb-ai-status',{detail:window.PHBAI?.status?.()||{}}));},
  dirty(){return window.PHBFlow.dirty(host)||[...state].some(([form,value])=>touched.has(form)&&form.isConnected&&(!form.closest('dialog')||form.closest('dialog').open)&&signature(form)!==value);},
  async ready(){// Include chained API reads and rendering microtasks, without waiting for background polling.
   for(let i=0;i<20;i++){await Promise.allSettled([...pending]);await new Promise(resolve=>setTimeout(resolve,0));if(!pending.size){await new Promise(resolve=>setTimeout(resolve,0));if(!pending.size)return;}}
  },
  dispose(){disposed=true;active=false;events.abort();requests.forEach(c=>c.abort());timers.forEach(clearTimeout);intervals.forEach(clearInterval);observers.forEach(o=>o.disconnect());objectURLs.forEach(value=>URL.revokeObjectURL(value));objectURLs.clear();window.PHBFlow.dispose(host);locals.clear();state.clear();touched.clear();}
 };
}

async function loadModule(page){
 if(!modules.has(page))modules.set(page,import('/page-modules/'+page+'.js').catch(error=>{modules.delete(page);throw error;}));
 return modules.get(page);
}
async function stylesFor(doc){
 const wanted=[...doc.querySelectorAll('link[rel=stylesheet]')].map(x=>new URL(x.getAttribute('href'),location.origin).href);
 const enabled=[];
 for(const href of wanted){
  let link=[...document.querySelectorAll('link[rel=stylesheet]')].find(x=>x.href===href);
  if(!link){link=document.createElement('link');link.rel='stylesheet';link.href=href;link.media='not all';
   const loaded=new Promise((resolve,reject)=>{link.onload=resolve;link.onerror=()=>reject(Error('Darstellung konnte nicht geladen werden.'));});
   document.head.append(link);await loaded;
  }
  enabled.push(link);
 }
 return ()=>{for(const link of document.querySelectorAll('link[rel=stylesheet]'))link.media=enabled.includes(link)?'all':'not all';enabled.forEach(link=>document.head.append(link));};
}
function selectNavigation(url,title){
 const path=new URL(url,location.href).pathname;
 for(const link of document.querySelectorAll('.phb-nav-link[data-section]')){
  const selected=new URL(link.href).pathname===path;link.classList.toggle('is-current',selected);
  if(selected)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
 }
 const heading=document.querySelector('.phb-breadcrumb strong');if(heading)heading.textContent=title;
 document.body.classList.remove('phb-nav-open');
 document.getElementById('phbMenu')?.setAttribute('aria-expanded','false');
 if(matchMedia('(max-width:900px)').matches)document.getElementById('phbSidebar').inert=true;
}
async function canLeave(){
 if(current?.writes||window.PHBFlow.blocked(current.host)||window.PHBUI.pendingWrites()||document.getElementById('phbImportWait')?.open){
  await PHBUI.alert('Ein Vorgang wird noch verarbeitet. Bitte warte auf die Rückmeldung.');return false;
 }
 if(current?.dirty())return PHBUI.confirm('Es gibt ungespeicherte Änderungen. Möchtest du die Ansicht trotzdem wechseln?');
 return true;
}
async function visit(value,{replace=false,pop=false,popIndex=historyIndex}={}){
 await initialReady;
 const target=new URL(value,location.href),page=routes.get(target.pathname);
 if(target.origin!==location.origin||!page){location.assign(target.href);return false;}
 const oldURL=current?.url.href||location.href;
 if(!await canLeave()){if(pop){const delta=historyIndex-popIndex;if(delta){restoringHistory=true;history.go(delta);}else history.replaceState({...history.state,phb:true,phbIndex:historyIndex},'',oldURL);}return false;}
 const id=++navigationID;flight?.abort();const controller=new AbortController();flight=controller;
 document.body.classList.add('phb-navigating');current.host.inert=true;let candidate=null;
 controller.signal.addEventListener('abort',()=>candidate?.dispose(),{once:true});
 try{
  const response=await nativeFetch(target.href,{signal:controller.signal,headers:{'X-PHB-Navigation':'1'},cache:'no-store'});
  if(response.redirected&&!routes.has(new URL(response.url).pathname)){location.assign(response.url);return false;}
  if(!response.ok)throw Error('Ansicht konnte nicht geladen werden ('+response.status+').');
  const doc=new DOMParser().parseFromString(await response.text(),'text/html');
  const host=extract(doc);host.hidden=true;document.querySelector('.phb-workspace').append(host);
  candidate=createScope(host,target.href);
  const [entry,applyStyles]=await Promise.all([loadModule(page),stylesFor(doc)]);
  if(controller.signal.aborted||id!==navigationID)return false;
  entry.mount(candidate.scope);await candidate.ready();
  if(controller.signal.aborted||id!==navigationID)return false;
  // Never leave an old dialog in the browser's top layer after changing views.
  const previous=current;previous.dispose();
  previous.host.replaceWith(host);host.hidden=false;current=candidate;candidate=null;
  applyStyles();
  for(const cls of [...document.body.classList])if(cls.startsWith('phb-page-'))document.body.classList.remove(cls);
  for(const cls of doc.body.classList)if(cls.startsWith('phb-page-'))document.body.classList.add(cls);
  document.title=doc.title;
  if(pop)historyIndex=popIndex;else if(!replace)historyIndex++;
  history[pop||replace?'replaceState':'pushState']({phb:true,phbIndex:historyIndex},'',current.url.href);
  selectNavigation(current.url.href,doc.querySelector('.phb-breadcrumb strong')?.textContent||doc.title);
  current.activate();window.PHBImports?.refresh?.();
  const main=current.host.querySelector('#phbMain');main.tabIndex=-1;main.focus({preventScroll:true});
  if(current.url.hash)current.host.querySelector('#'+CSS.escape(decodeURIComponent(current.url.hash.slice(1))))?.scrollIntoView();else window.scrollTo(0,0);
  document.dispatchEvent(new CustomEvent('phb:navigated',{detail:{url:current.url.href,page}}));return true;
 }catch(error){
  if(error.name!=='AbortError'&&id===navigationID){
   if(pop){const delta=historyIndex-popIndex;if(delta){restoringHistory=true;history.go(delta);}else history.replaceState({...history.state,phbIndex:historyIndex},'',oldURL);}
   await PHBUI.alert(error.message+' Die bisherige Ansicht bleibt geöffnet.');
  }return false;
 }finally{
  if(candidate){candidate.dispose();candidate.host.remove();}
  if(id===navigationID){flight=null;current.host.inert=false;document.body.classList.remove('phb-navigating');}
 }
}

async function start(){
 if(!routes.has(location.pathname)||!document.getElementById('phbMain'))return;
 const host=extract(document);current=createScope(host,location.href);
 window.PHBNav={visit,diagnostics:()=>({page:routes.get(new URL(current.url).pathname),modules:modules.size,navigating:!!flight})};
 let initialized;initialReady=new Promise(resolve=>{initialized=resolve;});
 document.addEventListener('click',event=>{
  const link=event.target.closest('a[href]');
  if(!link||event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||link.target||link.hasAttribute('download'))return;
  const url=new URL(link.href,location.href);
  if(url.origin!==location.origin||!routes.has(url.pathname))return;
  if(url.pathname===location.pathname&&url.search===location.search&&url.hash)return;
  event.preventDefault();void visit(url.href);
 });
 window.addEventListener('popstate',event=>{if(restoringHistory){restoringHistory=false;return;}void visit(location.href,{pop:true,replace:true,popIndex:Number(event.state?.phbIndex||0)});});
 window.addEventListener('beforeunload',event=>{if(current?.dirty()||current?.writes){event.preventDefault();event.returnValue='';}});
 document.addEventListener('phb-session-expired',()=>{location.assign('/login');});
 try{const entry=await loadModule(routes.get(location.pathname));entry.mount(current.scope);await current.ready();current.activate();}
 catch(error){await PHBUI.alert('Ansicht konnte nicht initialisiert werden: '+error.message);}
 finally{initialized();}
 history.replaceState({...history.state,phb:true,phbIndex:historyIndex},'',current.url.href);

}
void start();
