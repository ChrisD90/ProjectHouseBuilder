/* Completed-task notes/dependencies auto-save; reopening restores the prior state. */
(()=>{
 'use strict';
 const form=document.getElementById('taskForm'),status=document.getElementById('taskAutosaveStatus');
 let id=null,timer=null,lastSaved='',saving=null;
 function read(){return {notes:form.elements.namedItem('notes').value,
  predecessors:[...form.elements.namedItem('predecessors').selectedOptions].map(x=>x.value),
  successors:[...form.elements.namedItem('successors').selectedOptions].map(x=>x.value)};}
 function closed(){clearTimeout(timer);timer=null;id=null;lastSaved='';}
 async function save(){
  clearTimeout(timer);timer=null;if(!id)return true;
  if(saving){await saving;return save();}
  const data=read(),signature=JSON.stringify(data),target=id;
  if(signature===lastSaved)return true;
  taskBusy=true;status.textContent='Änderungen werden gespeichert …';
  let success=false;
  saving=(async()=>{
   try{
    await api('/api/tasks/'+target,{method:'PUT',body:JSON.stringify(data)});
    if(id===target){lastSaved=signature;status.textContent='Automatisch gespeichert.';if(JSON.stringify(read())===signature)taskFlow.snapshot();}
    await reload();success=true;
   }catch(error){status.textContent='Nicht gespeichert: '+error.message;}
   finally{taskBusy=false;}
  })();
  await saving;saving=null;
  if(success&&id===target&&JSON.stringify(read())!==lastSaved)return save();
  return success;
 }
 document.addEventListener('phb-task-opened',event=>{
  closed();id=event.detail.completed?event.detail.id:null;status.textContent='';
  if(id)lastSaved=JSON.stringify(read());
 });
 form.addEventListener('input',event=>{
  if(!id||event.target.name!=='notes')return;
  clearTimeout(timer);status.textContent='Änderungen noch nicht gespeichert …';timer=setTimeout(save,650);
 });
 form.addEventListener('change',event=>{
  if(!id||!['predecessors','successors'].includes(event.target.name))return;
  clearTimeout(timer);timer=setTimeout(save,30);
 });
 document.getElementById('reopenTask').onclick=async()=>{
  if(!id||taskBusy)return;
  const target=id;if(!await save())return;
  if(!await PHBUI.confirm('Abschluss zurücknehmen und das Arbeitspaket wieder bearbeiten? Der vorherige Status wird soweit dokumentiert wiederhergestellt.'))return;
  taskBusy=true;const button=document.getElementById('reopenTask');button.disabled=true;
  try{
   await api('/api/tasks/'+target+'/reopen',{method:'POST',body:JSON.stringify({confirm:true})});
   await reload();taskBusy=false;openTask(target);message('Abschluss zurückgenommen. Arbeitspaket wieder bearbeitbar.');
  }catch(error){status.textContent=error.message;}
  finally{taskBusy=false;button.disabled=false;}
 };
 window.PHBTaskCompletion={closed,flush:save};
})();
