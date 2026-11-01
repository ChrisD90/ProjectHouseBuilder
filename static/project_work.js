/* Compact source buttons open the shared editor in the persistent React shell. */
(()=>{
 'use strict';
 const icon='<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 6 2 2 3-4M11 6h10M3 13l2 2 3-4M11 13h10M3 20l2 2 3-4M11 20h10"/></svg>';
 function button(type,id,extra=''){return `<button type="button" class="linked-work-button ${extra}" data-work-open="${type}" data-work-id="${Number(id)}" title="To-dos & Notizen" aria-label="To-dos & Notizen anzeigen">${icon}<span data-work-count class="linked-work-count" hidden></span></button>`;}
 window.PHBWorkUI={button};
 let fallback=[];
 function controller(){try{return window.parent.PHBWork;}catch{return null;}}
 function update(){const items=controller()?.items()||fallback;for(const node of document.querySelectorAll('[data-work-open]')){
  const count=items.filter(x=>x.source_type===node.dataset.workOpen&&x.source_id===Number(node.dataset.workId)&&x.kind==='todo'&&!x.archived).length;
  const label='To-dos & Notizen anzeigen'+(count?' · '+count+' To-do'+(count===1?'':'s'):'');
  if(node.title!==label){node.title=label;node.setAttribute('aria-label',label);}
  const badge=node.querySelector('[data-work-count]');if(badge){badge.hidden=!count;if(badge.textContent!==String(count))badge.textContent=String(count);}
 }}
 document.addEventListener('click',event=>{const node=event.target.closest('[data-work-open]');if(!node||node.disabled)return;
  event.preventDefault();event.stopImmediatePropagation();
  const type=node.dataset.workOpen,id=Number(node.dataset.workId),work=controller();
  if(work)work.open(type,id);
  else location.assign((window.PHBProject?.id?'/p/'+window.PHBProject.id:'')+'/aufgaben?source_type='+encodeURIComponent(type)+'&source_id='+id+'&list=1');
 },true);
 document.addEventListener('phb-work-changed',update);
 function start(){update();new MutationObserver(update).observe(document.body,{childList:true,subtree:true});
  if(!controller())fetch('/api/project-work').then(r=>r.ok?r.json():Promise.reject()).then(data=>{fallback=data.items||[];update();}).catch(()=>{});
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
