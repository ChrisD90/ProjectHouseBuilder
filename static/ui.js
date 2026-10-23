/* Shared visual preferences and truthful async feedback. No external dependencies. */
(() => {
  'use strict';
  const key='phb-color-mode-v1';
  const root=document.documentElement;
  const system=window.matchMedia('(prefers-color-scheme: dark)');
  let mode='system';
  try {const stored=localStorage.getItem(key);if(['light','dark','system'].includes(stored))mode=stored;}catch(_){}
  const selectedTheme=()=>mode==='system'?(system.matches?'dark':'light'):mode;
  function applyTheme(){
    root.dataset.phbTheme=selectedTheme();
    root.style.colorScheme=selectedTheme();
    const chooser=document.getElementById('phbThemeMode');
    if(chooser)chooser.value=mode;
    const meta=document.querySelector('meta[name="theme-color"]');
    if(meta)meta.setAttribute('content',selectedTheme()==='dark'?'#111c29':'#f5f8fa');
  }
  applyTheme();
  if(typeof system.addEventListener==='function')system.addEventListener('change',()=>{if(mode==='system')applyTheme();});
  function setTheme(next){
    if(!['system','light','dark'].includes(next))return;
    mode=next;
    try{localStorage.setItem(key,next);}catch(_){}
    applyTheme();
  }
  const nativeFetch=window.fetch.bind(window);
  let lastAction=null,lastActionAt=0;
  let active=0,overlayActive=0;
  let seq=0,shown=false;
  const inflight=new Map();
  let topIndicator,overlay,titleNode,overlayText,screenStatus;
  const buttonCounts=new WeakMap();
  const labelFor=(path,method,form)=>{
    if(path.includes('/api/ai/schedule/chat'))return 'ChatGPT prüft deine Bauzeitenplanung …';
    if(path.includes('/api/ai/schedule'))return 'ChatGPT erstellt deinen Bauzeitenplan …';
    if(path.includes('/api/ai/offers/compare'))return 'ChatGPT vergleicht die Angebote …';
    if(path.includes('/api/ai/'))return 'ChatGPT verarbeitet deine Anfrage …';
    if(path.includes('/api/financing/loans/ai/extract'))return 'ChatGPT liest die Kreditunterlagen …';
    if(path.includes('/api/receipts')&&method==='POST'&&!/\/book|\/unbook/.test(path)){
      return form?.get?.('analysis_mode')==='ai'?'ChatGPT prüft deine Rechnung …':'Rechnung wird lokal analysiert …';
    }
    if(path.includes('/api/offers')&&method==='POST'&&form?.has?.('file')){
      return form.get('analysis_mode')==='ai'?'ChatGPT analysiert das Angebot …':'Angebots-PDF wird analysiert …';
    }
    if(path.includes('/api/backup'))return 'Projektsicherung wird geprüft und erstellt …';
    if(path.includes('/documents')&&method==='POST')return 'Dokument wird gespeichert …';
    if(path.includes('/api/tasks/initialize'))return 'Arbeitsschritte werden angelegt …';
    if(method!=='GET')return 'Änderungen werden verarbeitet …';
    return 'Projektinformationen werden geladen …';
  };
  function classify(url,method,form){
    const expensive=/\/api\/ai\/|\/api\/financing\/loans\/ai\/extract|\/api\/backup\/(manual|create)|\/api\/tasks\/initialize|\/api\/tasks\/clear/.test(url);
    const upload=method==='POST'&&form instanceof FormData&&form.has('file');
    return {long:expensive||upload,message:labelFor(url,method,form)};
  }
  function update(){
    if(!topIndicator)return;
    topIndicator.hidden=!shown;
    if(overlay){
      const entries=[...inflight.values()].filter(x=>x.visible&&x.long);
      overlay.hidden=!entries.length;
      if(entries.length){
        const mostRecent=entries[entries.length-1];
        overlayText.textContent=mostRecent.message;
        titleNode.textContent=entries.some(x=>/ChatGPT/.test(x.message))
          ?'ChatGPT arbeitet an deiner Anfrage':'Die Datei wird verarbeitet';
      }
    }
    if(screenStatus)screenStatus.textContent=active>0?
      (active===1?'Eine Anfrage wird bearbeitet.':active+' Anfragen werden bearbeitet.'):'Bereit';
    document.body?.classList.toggle('phb-network-busy',shown);
  }
  function markButton(button,yes){
    if(!button||!button.isConnected||!(button instanceof HTMLButtonElement))return;
    const count=buttonCounts.get(button)||0;
    const next=Math.max(0,count+(yes?1:-1));
    buttonCounts.set(button,next);
    if(next)button.setAttribute('data-phb-busy','true');
    else button.removeAttribute('data-phb-busy');
    if(next)button.setAttribute('aria-busy','true');
    else button.removeAttribute('aria-busy');
  }
  function start(info){
    const id=++seq;
    const btn=(Date.now()-lastActionAt<1200&&lastAction?.isConnected)?lastAction:null;
    const state={...info,visible:false,button:btn};
    inflight.set(id,state);active++;
    const delay=info.long?130:320;
    state.timer=setTimeout(()=>{
      if(!inflight.has(id))return;
      state.visible=true;shown=true;
      markButton(btn,true);
      update();
    },delay);
    return id;
  }
  function end(id){
    const state=inflight.get(id);
    if(!state)return;
    clearTimeout(state.timer);
    inflight.delete(id);active=Math.max(0,active-1);
    if(state.visible)markButton(state.button,false);
    shown=[...inflight.values()].some(x=>x.visible);
    update();
  }
  document.addEventListener('click',e=>{
    const button=e.target.closest?.('button');
    if(button&&!button.disabled){lastAction=button;lastActionAt=Date.now();}
  },true);
  document.addEventListener('submit',e=>{
    if(e.submitter){lastAction=e.submitter;lastActionAt=Date.now();}
  },true);
  window.fetch=(input,init)=> {
    let pathname='',method='GET',form;
    try{
      const request=input instanceof Request?input:null;
      const raw=request?request.url:String(input);
      const url=new URL(raw,location.href);
      if(url.origin!==location.origin||!url.pathname.startsWith('/api/'))
        return nativeFetch(input,init);
      pathname=url.pathname;
      method=(init?.method||request?.method||'GET').toUpperCase();
      form=init?.body;
    }catch(_){return nativeFetch(input,init);}
    const id=start(classify(pathname,method,form));
    try{
      const result=nativeFetch(input,init);
      return Promise.resolve(result).finally(()=>end(id));
    }catch(error){end(id);throw error;}
  };
  function setup(){
    const select=document.getElementById('phbThemeMode');
    if(select){select.value=mode;select.addEventListener('change',()=>setTheme(select.value));}
    topIndicator=document.getElementById('phbLoadTrack');
    overlay=document.getElementById('phbBusyOverlay');
    titleNode=document.getElementById('phbBusyTitle');
    overlayText=document.getElementById('phbBusyMessage');
    screenStatus=document.getElementById('phbBusyStatus');
    update();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup,{once:true});
  else setup();
  window.PHBUI={setTheme,currentTheme:selectedTheme};
})();