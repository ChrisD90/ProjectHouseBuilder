/* Persistent, global document-import activity feed. No external dependencies. */
(()=>{
 'use strict';
 const $=id=>document.getElementById(id);
 const now=()=>Date.now();
 const finished=new Set();
 const storageKey='phb-import-job-notifications-v1';
 try{
   const arr=JSON.parse(localStorage.getItem(storageKey)||'[]');
   if(Array.isArray(arr))arr.slice(-200).forEach(x=>finished.add(Number(x)));
 }catch(_){}
 let records=[],pending=false,panelOpen=false,activePoll=null;
 const submitting=new Set(),working=new Set(),disabledStates=new WeakMap();
 function syncLocks(){
  const kinds=new Set([...working,...submitting,...records.filter(alive).map(j=>j.kind)]);
  document.querySelectorAll('[data-import-kind],form[data-version-upload]').forEach(node=>{
   const kind=node.dataset.importKind||(node.matches('form[data-version-upload]')?'versions':'');
   const locked=kinds.has(kind);
   const controls=node.matches('form')?[...node.querySelectorAll('input,select,textarea,button')]:[node];
   for(const control of controls){
    if(locked){if(!disabledStates.has(control))disabledStates.set(control,control.disabled);control.disabled=true;control.dataset.importBusy='true';control.setAttribute('aria-busy','true');}
    else if(disabledStates.has(control)){control.disabled=disabledStates.get(control);disabledStates.delete(control);delete control.dataset.importBusy;control.removeAttribute('aria-busy');}
   }
  });
 }
 document.addEventListener('click',e=>{syncLocks();if(e.target.closest('[data-import-busy]')){e.preventDefault();e.stopImmediatePropagation();}},true);
 document.addEventListener('submit',e=>{if(e.target.dataset.importBusy==='true'){e.preventDefault();e.stopImmediatePropagation();}},true);
 const labels={costplans:'Kostenplanung',offers:'Angebot',receipts:'Rechnung',documents:'Projektdokument'};
 const finishedState=j=>['Fertig','Fehler','Unterbrochen'].includes(j.status);
 const alive=j=>j.status==='Wartend'||j.status==='Läuft';
 function remember(id){
   finished.add(id);
   try{localStorage.setItem(storageKey,JSON.stringify([...finished].slice(-200)));}catch(_){}
 }
 function displayToast(j){
   const toast=$('phbImportToast');toast.replaceChildren();
   const title=document.createElement('strong');title.textContent=j.status==='Fertig'
     ?'Dokument fertig eingelesen':'Dokumentimport benötigt Aufmerksamkeit';
   const info=document.createElement('p');
   info.textContent=j.filename+(j.status==='Fertig'?' – bereit zur Prüfung.':' – '+(j.error||j.stage));
   const controls=document.createElement('div');controls.className='phb-import-toast-actions';
   const review=document.createElement('button');
   review.type='button';review.textContent=j.status==='Fertig'?'Jetzt prüfen':'Importe anzeigen';
   review.onclick=()=>{if(j.review_url)location.assign(j.review_url);else {panelOpen=true;render();}};
   const close=document.createElement('button');close.type='button';close.textContent='Schließen';
   close.onclick=()=>{toast.hidden=true;};
   controls.append(review,close);toast.append(title,info,controls);toast.hidden=false;
   if(j.status==='Fertig'&&document.hidden&&'Notification' in window&&Notification.permission==='granted'){
     try{const note=new Notification('ProjectHouseBuilder: Datei fertig',{body:j.filename+' – jetzt prüfen',tag:'phb-import-'+j.id});
       note.onclick=()=>{window.focus();if(j.review_url)location.assign(j.review_url);};}catch(_){}
   }
 }
 async function dismissJob(id){
   const response=await fetch('/api/import-jobs/'+id+'/dismiss',{method:'POST'});
   const payload=await response.json();
   if(!response.ok)throw Error(payload.error||'Benachrichtigung konnte nicht entfernt werden.');
   $('phbImportToast').hidden=true;
   await poll();schedule();
 }
 function jobNode(j){
   const card=document.createElement('article');card.className='phb-import-job';
   const row=document.createElement('div');row.className='phb-import-job-head';
   const icon=document.createElement('span');
   icon.className='phb-import-dot'+(alive(j)?' is-working':j.status==='Fertig'?' is-done':' is-error');
   const label=document.createElement('strong');label.textContent=j.filename;
   const status=document.createElement('span');status.textContent=j.status;
   row.append(icon,label,status);
   const stage=document.createElement('p');stage.textContent=j.stage;
   card.append(row,stage);
   if(j.error){const err=document.createElement('p');err.className='phb-import-error';err.textContent=j.error;card.append(err);}
   const actions=document.createElement('div');actions.className='phb-import-job-actions';
   if(j.review_url){
     const button=document.createElement('button');button.type='button';button.textContent='Prüfen und bearbeiten';
     button.onclick=()=>location.assign(j.review_url);
     actions.append(button);
   }
   if(['Fehler','Unterbrochen'].includes(j.status)){
     const button=document.createElement('button');button.type='button';button.textContent='Erneut versuchen';
     button.onclick=async()=>{
       button.disabled=true;
       try{
         const fields={plan_only:'true'};
         const h={headers:{'Content-Type':'application/json'}};
         if(j.analysis_mode==='ai'){
           const choice=window.PHBAI?.selection();
           if(!choice)throw Error('ChatGPT-Verbindung prüfen.');
           fields.model=choice.model;h.headers['X-PHB-AI']='1';
         }
         const response=await fetch('/api/import-jobs/'+j.id+'/retry',{
           ...h,method:'POST',body:JSON.stringify(fields)});
         const data=await response.json();
         if(!response.ok)throw Error(data.error||'Neustart nicht möglich');
         await poll();
       }catch(error){PHBUI.alert(error.message);}
       finally{button.disabled=false;}
     };
     actions.append(button);
   }
   if(finishedState(j)){
     const dismiss=document.createElement('button');
     dismiss.type='button';dismiss.textContent='Ausblenden';
     dismiss.title='Nur diese Benachrichtigung entfernen; Dokument und gespeicherte Daten bleiben erhalten.';
     dismiss.onclick=async()=>{
       dismiss.disabled=true;
       try{await dismissJob(j.id);}
       catch(error){PHBUI.alert(error.message);dismiss.disabled=false;}
     };
     actions.append(dismiss);
   }
   if(actions.childElementCount)card.append(actions);
   return card;
 }
 function render(){
   const active=records.filter(alive),done=records.filter(j=>j.status==='Fertig'),
     failed=records.filter(j=>j.status==='Fehler'||j.status==='Unterbrochen');
   $('phbImportCenter').hidden=!(records.length||panelOpen);
   $('phbImportCount').textContent=active.length?active.length+' läuft / wartet':
     failed.length?failed.length+' Hinweis(e)':done.length?done.length+' fertig':'Keine Aufträge';
   $('phbImportToggle').setAttribute('aria-expanded',String(panelOpen));
   $('phbImportFeed').hidden=!panelOpen;
   $('phbImportDismissAll').hidden=!records.some(finishedState);
   const list=$('phbImportList');list.replaceChildren();
   for(const j of records.slice(0,18))list.append(jobNode(j));
   if(!records.length){const p=document.createElement('p');p.textContent='Keine Importe vorhanden.';list.append(p);}
 }
 async function poll(){
   if(pending)return;
   pending=true;
   try{
     const result=await fetch('/api/import-jobs',{cache:'no-store'});
     if(!result.ok)throw Error('Status nicht erreichbar');
     const data=await result.json();
     records=data.jobs||[];syncLocks();
     const newlyCompleted=records.filter(j=>finishedState(j)&&!finished.has(j.id));
     // Show at most one new toast per poll. Keep all completed tasks visible in the feed.
     for(const j of newlyCompleted){
       remember(j.id);
       const age=now()-Date.parse(j.finished_at||j.updated_at||0);
       if(age>=0 && age<8*3600000)displayToast(j);
       document.dispatchEvent(new CustomEvent('phb-import-updated',{detail:j}));
     }
     render();
   }catch(error){
     $('phbImportCount').textContent='Status nicht erreichbar';
   }finally{pending=false;}
 }
 function schedule(){
   clearTimeout(activePoll);
   const delay=records.some(alive)?2500:document.hidden?16000:6500;
   activePoll=setTimeout(async()=>{await poll();schedule();},delay);
 }
 function setup(){
   $('phbImportToggle').onclick=()=>{panelOpen=!panelOpen;render();};
   $('phbImportClose').onclick=()=>{panelOpen=false;render();};
   $('phbImportDismissAll').onclick=async()=>{
     if(!await PHBUI.confirm('Alle fertig verarbeiteten, fehlgeschlagenen und unterbrochenen Importmeldungen ausblenden? Bereits importierte Dokumente und Daten bleiben erhalten.'))return;
     const button=$('phbImportDismissAll');button.disabled=true;
     try{
       const response=await fetch('/api/import-jobs/dismiss-completed',{method:'POST'});
       const result=await response.json();
       if(!response.ok)throw Error(result.error||'Ausblenden fehlgeschlagen');
       $('phbImportToast').hidden=true;
       await poll();schedule();
     }catch(error){PHBUI.alert(error.message);}
     finally{button.disabled=false;}
   };
   poll().then(schedule);
   document.addEventListener('visibilitychange',()=>{if(!document.hidden)poll().then(schedule);});
 }
 async function enqueue(options){
  const kind=options.kind;
  if(submitting.has(kind)||working.has(kind)||records.some(j=>j.kind===kind&&alive(j)))throw Error('Diese Analyse läuft bereits. Bitte Ergebnis oder Fehler abwarten.');
  submitting.add(kind);
  try{return await processBatch(options);}
  finally{submitting.delete(kind);working.delete(kind);await poll();syncLocks();}
 }
 async function processBatch({kind,files,analysisMode='local',model='',fields={}}){
   const selected=Array.from(files||[]);
   if(!selected.length)throw Error('Bitte mindestens eine Datei auswählen.');
   if(selected.length>8)throw Error('Maximal acht Dateien pro Durchgang.');
   const data=new FormData();
   data.set('kind',kind);data.set('analysis_mode',analysisMode);
   if(analysisMode==='ai'){
     data.set('model',model);data.set('plan_only','true');
   }
   for(const file of selected)data.append('files',file,file.name);
   for(const [key,value] of Object.entries(fields))data.set(key,value??'');
   // Optional system notification only after an explicit import action.
   // In-app notifications never depend on this permission.
   if('Notification' in window&&Notification.permission==='default'){
     try{Notification.requestPermission().catch(()=>{});}catch(_){}
   }
   syncLocks();
   const response=await fetch('/api/import-jobs',{
     method:'POST',headers:analysisMode==='ai'?{'X-PHB-AI':'1'}:{},body:data});
   const result=await response.json();
   if(!response.ok)throw Error(result.error||'Import konnte nicht gestartet werden.');
   panelOpen=true;
   await poll();schedule();
   working.add(kind);syncLocks();
   let failures=0;
   while(true){
    let jobs;
    try{
     const status=await fetch('/api/import-jobs/batches/'+result.batch_id,{cache:'no-store'});
     const payload=await status.json();if(!status.ok)throw Error(payload.error||'Importstatus nicht erreichbar.');jobs=payload.jobs;
     if(!Array.isArray(jobs)||jobs.length!==result.jobs.length||jobs.some(j=>!result.jobs.some(original=>original.id===j.id)||!['Wartend','Läuft','Fertig','Übernommen','Ausgeblendet','Fehler','Unterbrochen'].includes(j.status)))throw Error('Ungültiger Importstatus.');
     failures=0;
    }catch(error){if(++failures>=3)throw Error('Verbindung zum Importstatus unterbrochen. Die Importübersicht zeigt den letzten Stand; der Server kann weiterarbeiten.');}
    if(jobs&&jobs.every(j=>!alive(j))){
     const failed=jobs.filter(j=>['Fehler','Unterbrochen'].includes(j.status));
     if(failed.length)throw Error(failed.map(j=>j.filename+': '+(j.error||j.stage)).join(' · ')+' Erfolgreiche Dateien bleiben zur Prüfung erhalten.');
     return jobs;
    }
    await new Promise(resolve=>setTimeout(resolve,1000));
   }
 }
 window.PHBImports={enqueue,refresh:poll,open:()=>{panelOpen=true;render();}};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup,{once:true});
 else setup();
})();