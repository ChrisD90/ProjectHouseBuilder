/* Move whole work packages by calendar days; dependencies are validated server-side. */
(()=>{
 'use strict';
 const host=document.getElementById('gantt'),status=document.getElementById('ganttStatus');
 let gesture=null,suppressClickUntil=0;
 async function move(task,start){
  if(ganttBusy||taskBusy||task.status==='Erledigt')return;
  ganttBusy=true;host.setAttribute('aria-busy','true');
  status.textContent=task.code+' wird auf '+fmt(start)+' verschoben …';
  try{
   const result=await api('/api/tasks/'+task.id+'/move',{method:'POST',body:JSON.stringify({start,plan_digest:project.plan_digest})});
   await reload();status.textContent=task.code+': '+fmt(result.start)+' bis '+fmt(result.end)+'. Nachfolger wurden neu berechnet.';
  }catch(error){await reload();status.textContent=error.message;}
  finally{ganttBusy=false;host.removeAttribute('aria-busy');}
 }
 function reset(){
  if(!gesture)return null;
  const previous=gesture;gesture=null;
  previous.bar.style.transform='';previous.bar.classList.remove('is-dragging');
  if(previous.bar.hasPointerCapture?.(previous.pointer))previous.bar.releasePointerCapture(previous.pointer);
  return previous;
 }
 host.addEventListener('pointerdown',e=>{
  const bar=e.target.closest('.bar[data-id]');
  if(!bar||e.button!==0)return;
  const task=project.tasks.find(t=>t.id===Number(bar.dataset.id));
  if(!task||task.status==='Erledigt'||ganttBusy||taskBusy)return;
  gesture={bar,task,x:e.clientX,scroll:host.parentElement.scrollLeft,pointer:e.pointerId,days:0,moved:false};
  bar.setPointerCapture(e.pointerId);
 });
 host.addEventListener('pointermove',e=>{
  if(!gesture||e.pointerId!==gesture.pointer)return;
  const pixels=e.clientX-gesture.x+host.parentElement.scrollLeft-gesture.scroll;
  if(!gesture.moved&&Math.abs(pixels)<6)return;
  gesture.moved=true;e.preventDefault();
  const size=Number(host.dataset.daySize);
  gesture.days=Math.round(pixels/size);
  gesture.bar.style.transform='translateX('+gesture.days*size+'px)';gesture.bar.classList.add('is-dragging');
  status.textContent=gesture.task.code+' → '+fmt(addDays(gesture.task.start,gesture.days))+' (Loslassen zum Speichern, Escape zum Abbrechen)';
 });
 host.addEventListener('pointerup',e=>{
  if(!gesture||e.pointerId!==gesture.pointer)return;
  const finished=reset();if(!finished.moved)return;
  suppressClickUntil=Date.now()+500;e.preventDefault();
  if(finished.days)void move(finished.task,addDays(finished.task.start,finished.days));
  else status.textContent='Termin unverändert.';
 });
 host.addEventListener('pointercancel',()=>{if(reset())status.textContent='Verschieben abgebrochen.';});
 host.addEventListener('click',e=>{if((e.target.closest('.bar')&&Date.now()<suppressClickUntil)||ganttBusy){e.preventDefault();e.stopImmediatePropagation();}},true);
 host.addEventListener('keydown',e=>{
  const bar=e.target.closest('.bar[data-id]');if(!bar)return;
  if(e.key==='Escape'&&gesture){reset();suppressClickUntil=Date.now()+500;status.textContent='Verschieben abgebrochen.';return;}
  if((e.key==='Enter'||e.key===' ')&&!e.altKey){e.preventDefault();openTask(Number(bar.dataset.id));return;}
  if(!e.altKey||!['ArrowLeft','ArrowRight'].includes(e.key))return;
  e.preventDefault();const task=project.tasks.find(t=>t.id===Number(bar.dataset.id));
  if(task)void move(task,addDays(task.start,(e.key==='ArrowRight'?1:-1)*(e.shiftKey?7:1)));
 });
})();
