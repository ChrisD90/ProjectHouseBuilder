/* Same-origin migration boundary: no DOM proxies, no script re-execution. */
(()=>{
 'use strict';
 if(window.parent===window||!window.parent.PHBReactBridge)return;
 const bridge=window.parent.PHBReactBridge;
 const routes=new Set(['/','/kosten','/angebote','/belege','/finanzierung','/energieplanung','/stammdaten','/dokumente','/daten','/aufgaben']);
 const forms=new Map(),changed=new Set(),locked=new WeakMap();let jobs=[],refreshing=null,navigating=false;
 const signature=form=>JSON.stringify([...form.querySelectorAll('input,select,textarea')].filter(f=>f.name&&f.dataset.phbIgnoreDirty!=='true').map(f=>[f.name,f.type==='file'?[...f.files].map(x=>[x.name,x.size,x.lastModified]):f.type==='checkbox'||f.type==='radio'?[f.value,f.checked]:f.multiple?[...f.selectedOptions].map(x=>x.value):f.value]));
 const guarded=form=>{const dialog=form.closest('dialog');return !!(dialog&&window.PHBFlow?.get(dialog));};
 document.addEventListener('focusin',e=>{const form=e.target.form;if(form&&!guarded(form)&&!forms.has(form))forms.set(form,signature(form));},true);
 const mark=e=>{if(e.target.form&&!guarded(e.target.form))changed.add(e.target.form);};
 document.addEventListener('input',mark,true);document.addEventListener('change',mark,true);
 document.addEventListener('phb-write-complete',event=>{const form=event.detail.form;if(form){forms.set(form,signature(form));changed.delete(form);}bridge.changed?.();});
 document.addEventListener('click',event=>{
  const link=event.target.closest('a[href]');if(!link||event.defaultPrevented||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey||link.target||link.hasAttribute('download'))return;
  const url=new URL(link.href,location.href);url.pathname=url.pathname.replace(/^\/p\/[1-9]\d*(?=\/)/,'');if(url.origin!==location.origin||!routes.has(url.pathname))return;
  if(url.pathname===location.pathname&&url.search===location.search&&url.hash)return;
  url.searchParams.delete('_classic');url.searchParams.delete('_embedded');url.searchParams.delete('project_id');event.preventDefault();bridge.navigate(url.pathname+url.search+url.hash);
 });
 function prepareModes(){for(const form of document.querySelectorAll('form[data-import-kind],form[data-version-upload]')){
  if(form.querySelector('[name=processing_mode]'))continue;
  const label=document.createElement('label');label.className='phb-processing-control';label.append('Verarbeitung');const select=document.createElement('select');select.name='processing_mode';select.dataset.phbIgnoreDirty='true';select.add(new Option('Im Vordergrund – direkt prüfen','foreground'));select.add(new Option('Im Hintergrund – später prüfen','background'));label.append(select);form.querySelector('button[type=submit]')?.before(label);
 }}
 prepareModes();new MutationObserver(prepareModes).observe(document.body,{childList:true,subtree:true});
 function lockSources(){const active=new Set(jobs.filter(j=>['Wartend','Läuft'].includes(j.status)).map(j=>j.kind));for(const node of document.querySelectorAll('[data-import-kind],form[data-version-upload]')){const kind=node.dataset.importKind||(node.matches('form[data-version-upload]')?'versions':'');for(const control of node.matches('form')?node.querySelectorAll('input,select,textarea,button'):[node]){if(active.has(kind)){if(!locked.has(control))locked.set(control,control.disabled);control.disabled=true;control.dataset.importBusy='true';}else if(locked.has(control)){control.disabled=locked.get(control);locked.delete(control);delete control.dataset.importBusy;}}}}
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
