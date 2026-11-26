/* Same-origin migration boundary: no DOM proxies, no script re-execution. */
(()=>{
 'use strict';
 if(window.parent===window||!window.parent.PHBReactBridge)return;
 const bridge=window.parent.PHBReactBridge;
 document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();window.parent.dispatchEvent(new Event('phb-command-open'));}});
 const routes=new Set(['/system','/uebersicht','/projektwerkstatt','/','/kosten','/angebote','/belege','/finanzierung','/energieplanung','/stammdaten','/dokumente','/daten','/aufgaben']);
 const forms=new Map(),changed=new Set(),locked=new WeakMap();let jobs=[],refreshing=null,navigating=false;
 const signature=form=>JSON.stringify([...form.querySelectorAll('input,select,textarea')].filter(f=>f.name&&f.dataset.phbIgnoreDirty!=='true').map(f=>[f.name,f.type==='file'?[...f.files].map(x=>[x.name,x.size,x.lastModified]):f.type==='checkbox'||f.type==='radio'?[f.value,f.checked]:f.multiple?[...f.selectedOptions].map(x=>x.value):f.value]));
 const guarded=form=>{const dialog=form.closest('dialog');return !!(dialog&&window.PHBFlow?.get(dialog));};
 document.addEventListener('focusin',e=>{const form=e.target.form;if(form&&!guarded(form)&&!forms.has(form))forms.set(form,signature(form));},true);
 const mark=e=>{if(e.target.form&&!guarded(e.target.form))changed.add(e.target.form);};
 document.addEventListener('input',mark,true);document.addEventListener('change',mark,true);
 document.addEventListener('phb-write-complete',event=>{const form=event.detail.form;if(form){forms.set(form,signature(form));changed.delete(form);}bridge.changed?.();});
 document.addEventListener('click',event=>{
  const link=event.target.closest('a[href]');if(!link||event.defaultPrevented||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey||link.target||link.hasAttribute('download'))return;
  const url=new URL(link.href,location.href);url.pathname=url.pathname.replace(/^\/p\/[1-9]\d*(?=\/)/,'');if(url.origin!==location.origin||!(routes.has(url.pathname)||/^\/(angebote|belege)\/[1-9]\d*$/.test(url.pathname)))return;
  if(url.pathname===location.pathname&&url.search===location.search&&url.hash)return;
  url.searchParams.delete('_classic');url.searchParams.delete('_embedded');url.searchParams.delete('project_id');event.preventDefault();bridge.navigate(url.pathname+url.search+url.hash);
 });
 function prepareModes(){for(const form of document.querySelectorAll('form[data-import-kind],form[data-version-upload]')){
  if(form.querySelector('[name=processing_mode]'))continue;
  const label=document.createElement('label');label.className='phb-processing-control';label.append('Verarbeitung');const select=document.createElement('select');select.name='processing_mode';select.dataset.phbIgnoreDirty='true';select.add(new Option('Im Vordergrund – direkt prüfen','foreground'));select.add(new Option('Im Hintergrund – später prüfen','background'));label.append(select);form.querySelector('button[type=submit]')?.before(label);
 }}
 prepareModes();new MutationObserver(prepareModes).observe(document.body,{childList:true,subtree:true});
 function lockSources(){
  // Server-side jobs may queue independently. Only the submitting workflow owns
  // its transient controls; completed background handoffs must not freeze pages.
  for(const node of document.querySelectorAll('[data-import-busy]')){
   if(locked.has(node)){node.disabled=locked.get(node);locked.delete(node);}delete node.dataset.importBusy;
  }
 }
 window.PHBEmbed={
  setJobs(value){jobs=value;lockSources();},
  release(control){if(locked.has(control))locked.set(control,false);control.disabled=false;lockSources();},
  prompting:()=>!!document.querySelector('dialog.phb-messagebox[open]'),
  busy:()=>window.PHBFlow?.inspect().busy||window.PHBUI?.pendingWrites()||!!document.querySelector('dialog.phb-messagebox[open]'),
  dirty:()=>window.PHBFlow?.inspect().dirty||[...changed].some(form=>(!form.closest('dialog')||form.closest('dialog').open)&&forms.has(form)&&signature(form)!==forms.get(form)),
  activate(){if(!window.PHBEmbed.dirty()&&!window.PHBEmbed.busy())return window.PHBPageActivate?.();},
  async navigate(value){
   // The shell already checked the dirty/busy guard before accepting this navigation.
   navigating=true;
   try{
    window.PHBEmbed.discard();
    // Native close events must finish before installing the next dialog's URL.
    await new Promise(resolve=>setTimeout(resolve,0));
    const url=new URL(value,location.href);
    for(const key of ['_classic','_embedded','project_id']){const current=new URL(location.href).searchParams.get(key);if(current!==null)url.searchParams.set(key,current);}
    history.replaceState(history.state,'',url);
   }finally{navigating=false;}
  },
  discard(){document.querySelectorAll('dialog[open]').forEach(dialog=>{dialog.querySelectorAll('form').forEach(form=>form.reset());const flow=window.PHBFlow?.get(dialog);if(flow)flow.finish();else dialog.close();});changed.forEach(form=>form.reset());changed.clear();forms.clear();},
  syncURL(){if(navigating)return;const url=new URL(location.href);url.searchParams.delete('_classic');url.searchParams.delete('_embedded');url.searchParams.delete('_react_retry');url.searchParams.delete('project_id');bridge.sync?.(url.pathname+url.search+url.hash);},
  refresh(){if(refreshing)return refreshing;if(window.PHBEmbed.dirty()||window.PHBEmbed.busy()||!window.PHBPageRefresh)return;refreshing=Promise.resolve(window.PHBPageRefresh()).finally(()=>{refreshing=null;});return refreshing;},
 };
 window.PHBEmbed.setJobs(bridge.jobs?.()||[]);
 window.PHBUI?.setTheme(bridge.theme?.()==='auto'?'system':bridge.theme?.()||'system');
 document.dispatchEvent(new CustomEvent('phb-ai-status',{detail:bridge.ai.status()}));
 let attempts=0;const ready=()=>{if(window.PHBUI?.activeRequests()>0&&attempts++<300){setTimeout(ready,50);return;}bridge.ready?.(window,location.pathname);};setTimeout(ready,0);
})();

/* A single photo action bridges classic editors to the shared native gallery. */
(()=>{
 const bridge=window.parent!==window&&window.parent.PHBReactBridge;
 if(!bridge?.photos)return;
 const style=document.createElement('style');style.textContent='.phb-photo-button{display:inline-flex;align-items:center;justify-content:center;gap:3px;min-width:30px;height:30px;padding:4px 6px;border:1px solid var(--bs-border-color,#60786855);border-radius:6px;background:transparent;color:inherit;flex-shrink:0}.phb-photo-button small{font-size:10px}';document.head.append(style);
 let queued=false;
 function prepare(force=false){for(const host of document.querySelectorAll('[data-photo-type]')){
  const type=host.dataset.photoType,id=Number(host.dataset.photoId);let button=host.querySelector('.phb-photo-button');
  if(!id){if(button)button.hidden=true;continue;}
  if(!button){button=document.createElement('button');button.type='button';button.className='phb-photo-button';button.innerHTML='<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 7h4l2-3h4l2 3h4v13H4z"/><circle cx="12" cy="13" r="4"/></svg><small></small>';host.insertBefore(button,[...host.children].find(n=>n.tagName==='BUTTON'&&n.id.startsWith('close')&&!n.classList.contains('page-back-arrow'))||null);button.onclick=()=>bridge.photos.open(host.dataset.photoType,Number(host.dataset.photoId));}
  button.hidden=false;const key=type+':'+id;
  if(!force&&button.dataset.photoLoaded===key)continue;
  button.dataset.photoLoaded=key;button.title='Fotos';button.setAttribute('aria-label','Fotos anzeigen');
  const path='/api/photos?source_type='+encodeURIComponent(type)+'&source_id='+id;
  fetch(window.PHBProject?.url(path)||path).then(r=>r.ok?r.json():null).then(data=>{if(!data||button.dataset.photoLoaded!==key)return;const count=data.photos.length;button.querySelector('small').textContent=count||'';button.setAttribute('aria-label','Fotos anzeigen · '+count);button.title='Fotos · '+count;}).catch(()=>{});
 }}
 new MutationObserver(()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;prepare();});}).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['data-photo-type','data-photo-id']});
 window.parent.addEventListener('phb-photos-changed',()=>prepare(true));prepare();
})();
