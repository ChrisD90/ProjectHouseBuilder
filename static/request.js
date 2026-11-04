/* One transport contract for React and classic workflows. No automatic write retry. */
(()=>{
 'use strict';
 if(window.PHBRequests)return;
 const nativeFetch=window.fetch.bind(window),versions=new Map(),snapshots=new WeakMap(),baselines=new WeakMap();
 let lastForm=null;
 document.addEventListener('click',event=>{const node=event.target.closest?.('button,input,select,textarea');if(node?.form)lastForm=node.form;},true);
 document.addEventListener('submit',event=>{lastForm=event.target;},true);
 const activeForm=()=>lastForm?.isConnected&&(!lastForm.closest('dialog')||lastForm.closest('dialog').open)?lastForm:null;
 const owner=()=>String(window.PHBProject?.id||location.pathname.match(/^\/p\/(\d+)/)?.[1]||new URLSearchParams(location.search).get('project_id')||1);
 const labels={notes:'Notizen',name:'Name',title:'Titel',supplier:'Lieferant',invoice_number:'Rechnungsnummer',gross_amount:'Bruttobetrag',paid_amount:'Bezahlt',contractor_id:'Firma',offer_id:'Angebot',budget_line_id:'Kostenplanposition',description:'Beschreibung',trade:'Gewerk',due_date:'Zahlungsziel',document_date:'Rechnungsdatum',phone:'Telefon',mobile:'Mobiltelefon',email:'E-Mail',address:'Adresse',website:'Website',contact:'Ansprechpartner',contact_secondary:'Weiterer Ansprechpartner',kind:'Art',category:'Kategorie',amount:'Betrag',principal:'Kreditsumme',interest_rate:'Zinssatz',monthly_payment:'Monatliche Rate',opening_balance:'Anfangsguthaben',reserve:'Reserve',expected:'Erwartete Förderung',confirmed:'Bestätigte Förderung',received:'Erhaltene Förderung',status:'Status',start_date:'Anfangsdatum',end_date:'Enddatum',duration:'Dauer',planned_end:'Geplantes Ende',usage:'Nutzung'};
 const caption=field=>labels[field]||field.replaceAll('_',' ');
 const mutation=method=>!['GET','HEAD','OPTIONS'].includes(method);
 const storagePrefix=()=>`phb-operation:${owner()}:`;
 const key=()=>crypto.randomUUID?.().replaceAll('-','')||Date.now().toString(36)+Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2);
 const canonical=path=>path.replace(/\/funding\/plans\//,'/funding/').replace('/api/offer-costs/','/api/costs/').match(/^\/api\/(?:financing\/(?:loans|equity)|budget\/lines|[^/]+)\/\d+/)?.[0];
 function snapshot(node,original){
  if(!node)return;snapshots.set(node,new Map(versions));
  let values=original;
  if(!values&&node.tagName==='FORM'&&window.PHBFlow?.signature){try{values=Object.fromEntries(JSON.parse(window.PHBFlow.signature(node)).map(([key,value,checked])=>[key,checked===undefined?value:checked]));}catch{}}
  if(values)baselines.set(node,JSON.parse(JSON.stringify(values)));
  for(const form of node.querySelectorAll?.('form')||[])snapshot(form,original);
 }
 function baseline(){const nodes=[activeForm(),document.activeElement?.closest('form'),...Array.from(document.querySelectorAll('dialog[open],[role="dialog"]')).reverse()].filter(Boolean);for(const node of nodes)if(baselines.has(node))return baselines.get(node);return null;}
 function equivalent(key,a,b){if(a==null||a==='')return b==null||b==='';if(typeof a==='number'||typeof b==='number')return Number(a)===Number(b);if(/_id$|^(amount|gross|net|vat|.*_amount|estimate|offer|committed|principal|expected|confirmed|received)$/.test(key))return Number(a)===Number(b);return JSON.stringify(a)===JSON.stringify(b);}

 function expected(path){
  const nodes=[activeForm(),document.activeElement?.closest('form'),...Array.from(document.querySelectorAll('dialog[open],[role="dialog"]')).reverse()].filter(Boolean);
  for(const node of nodes){const saved=snapshots.get(node);if(saved?.has(path))return saved.get(path);}
  return versions.get(path);
 }
 function remember(name,value){try{sessionStorage.setItem(name,JSON.stringify(value));}catch{}}
 function forget(name){try{sessionStorage.removeItem(name);}catch{}}
 function read(name){try{return JSON.parse(sessionStorage.getItem(name)||'null');}catch{return null;}}
 async function signature(body){
  let text=typeof body==='string'?body:'';
  if(body instanceof FormData){const parts=[];for(const [name,value] of body.entries())parts.push([name,value instanceof Blob?[value.name,value.size,value.lastModified]:value]);text=JSON.stringify(parts);}
  const bytes=new TextEncoder().encode(text);
  if(crypto.subtle)return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');
  let hash=2166136261;for(const v of bytes)hash=Math.imul(hash^v,16777619);return String(hash>>>0)+':'+bytes.length;
 }
 function notify(kind,detail){
  try{if(parent!==window&&parent.PHBRequests){parent.PHBRequests.notify(kind,detail);return;}}catch{}
  document.dispatchEvent(new CustomEvent('phb-request-'+kind,{detail}));
  const previous=document.getElementById('phbRequestNotice');if(previous)previous.remove();
  const dialog=document.createElement('dialog');dialog.id='phbRequestNotice';dialog.className='phb-request-notice';
  const heading=document.createElement('h2');heading.textContent=kind==='conflict'?'Änderungen vergleichen':'Vorgang prüfen';dialog.append(heading);
  const message=document.createElement('p');message.textContent=detail.error||'Die Antwort ist noch nicht bestätigt. Deine Eingaben bleiben erhalten.';dialog.append(message);
  if(detail.changes){const list=document.createElement('dl');for(const [field,values] of Object.entries(detail.changes)){const term=document.createElement('dt'),description=document.createElement('dd');term.textContent=caption(field);description.textContent='Aktuell: '+String(values.current??'leer')+' · Deine Eingabe: '+String(values.incoming??'leer');list.append(term,description);}dialog.append(list);}
  if(detail.operation_key){const check=document.createElement('button');check.type='button';check.textContent='Status erneut prüfen';check.onclick=async()=>{check.disabled=true;try{const r=await nativeFetch('/api/operations/'+encodeURIComponent(detail.operation_key),{headers:{'X-PHB-Project':detail.project_id||owner()}});const state=await r.json();message.textContent=state.state==='done'?'Der Vorgang wurde erfolgreich gespeichert. Bitte die Fachansicht aktualisieren.':state.message||'Der Ausgang ist noch unklar. Bitte zuerst die Buchungen in der Fachansicht prüfen.';}catch{message.textContent='Status nicht erreichbar. Bitte später erneut prüfen.';}finally{check.disabled=false;}};dialog.append(check);}
  let close;
  if(kind==='conflict'){
   const selected=new Set(),values=detail.original,desired=detail.draft,current=detail.current;
   const fields=values&&desired&&current?Object.keys(desired).filter(field=>field in values && !equivalent(field,values[field],desired[field])):[];
   const canMerge=fields.length && fields.every(field=>field in current && (desired[field]===null||typeof desired[field]!=='object'));
   if(canMerge && detail.apply){
    const choices=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent='Welche eigenen Änderungen möchtest du speichern?';choices.append(legend);
    for(const field of fields){const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';const collision=!equivalent(field,values[field],current[field])&&!equivalent(field,desired[field],current[field]);check.checked=!collision;if(check.checked)selected.add(field);check.onchange=()=>{if(check.checked)selected.add(field);else selected.delete(field);};label.append(check,document.createTextNode(caption(field)+': '+String(desired[field])+(collision?' (überschreibt die zwischenzeitliche Änderung)':'')));choices.append(label);}
    const apply=document.createElement('button');apply.type='button';apply.textContent='Ausgewählte Änderungen speichern';apply.onclick=async()=>{if(!selected.size){message.textContent='Bitte mindestens eine eigene Änderung auswählen.';return;}apply.disabled=true;try{await detail.apply([...selected]);close.click();detail.reload();}catch(error){message.textContent=error.message;}finally{apply.disabled=false;}};dialog.append(choices,apply);
   }
   if(detail.reload){const reload=document.createElement('button');reload.type='button';reload.textContent='Eigene Eingaben verwerfen und aktuellen Stand laden';reload.onclick=()=>{close.click();detail.reload();};dialog.append(reload);}
   if(detail.draft){const saved=document.createElement('details'),summary=document.createElement('summary'),text=document.createElement('textarea');summary.textContent='Eigene Eingaben zum Kopieren anzeigen';text.readOnly=true;text.value=Object.entries(detail.draft).map(([field,value])=>caption(field)+': '+(typeof value==='object'?JSON.stringify(value):String(value??''))).join('\n');text.setAttribute('aria-label','Eigene Eingaben');text.rows=6;saved.append(summary,text);dialog.append(saved);}
  }
  close=document.createElement('button');close.type='button';close.textContent='Zurück zu meinen Eingaben';close.onclick=()=>{dialog.close();dialog.remove();document.dispatchEvent(new CustomEvent('phb-request-notice-closed'));};dialog.append(close);dialog.addEventListener('cancel',event=>{event.preventDefault();close.click();});document.body.append(dialog);dialog.showModal();
 }
 window.PHBRequests={snapshot,notify,versions};
 document.addEventListener('input',event=>{const form=event.target.closest?.('form');if(form&&!snapshots.has(form))snapshot(form);},true);
 document.addEventListener('phb-write-complete',event=>{const form=event.detail?.form;if(form){snapshot(form);snapshot(form.closest('dialog'));}});
 const start=()=>new MutationObserver(()=>{for(const node of document.querySelectorAll('dialog[open],[role="dialog"]'))if(!snapshots.has(node))snapshot(node);}).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['open']});
 if(document.body)start();else document.addEventListener('DOMContentLoaded',start,{once:true});
 window.fetch=async(input,init={})=>{
  const request=input instanceof Request?input:null,url=new URL(request?.url||String(input),location.href);
  if(url.origin!==location.origin||!url.pathname.startsWith('/api/'))return nativeFetch(input,init);
  const method=(init.method||request?.method||'GET').toUpperCase(),write=mutation(method);
  const requestForm=activeForm()||document.activeElement?.closest('form');
  const headers=new Headers(init.headers||request?.headers),resource=canonical(url.pathname);
  if(!headers.has('X-PHB-Project'))headers.set('X-PHB-Project',owner());
  if(write&&resource&&!headers.has('If-Match')){const token=expected(resource);if(token)headers.set('If-Match',token);}
  let operation=null,storage=null;
  if(write&&url.pathname.startsWith('/api/financing/')){
   storage=storagePrefix()+method+':'+url.pathname+':'+await signature(init.body);
   operation=read(storage)?.key||key();headers.set('Idempotency-Key',operation);
   remember(storage,{key:operation,path:url.pathname,created:Date.now()});
  }
  const controller=new AbortController(),abort=()=>controller.abort();
  const external=init.signal||request?.signal;external?.addEventListener('abort',abort,{once:true});if(external?.aborted)abort();
  const timeout=setTimeout(abort,init.body instanceof FormData||url.pathname.includes('/ai/')?240000:write?120000:30000);
  try{
   const response=await nativeFetch(input,{...init,headers,signal:controller.signal});
   if(response.status===401)return response;
   if(!response.headers.get('Content-Type')?.includes('application/json')){
    if(response.ok)return response;
    const messages={413:'Die Dateien sind zu groß. Bitte Dateigröße und Anzahl reduzieren.',502:'Der Server ist vorübergehend nicht erreichbar.',504:'Der Server benötigt zu lange. Bitte zuerst den aktuellen Stand prüfen.'};
    const message=messages[response.status]||'Der Server konnte die Anfrage nicht abschließen (HTTP '+response.status+'). Bitte den aktuellen Stand prüfen.';
    if(response.status<500){if(storage)forget(storage);return Response.json({error:message,code:'http_'+response.status},{status:response.status});}
    throw Error(message);
   }
   const data=await response.clone().json();
   if(data?._version_transitions){
    // A document added from a suspended funding form is our own side effect.
    // Advance only snapshots that still match its exact pre-change revision.
    if(response.ok)for(const [path,change] of Object.entries(data._version_transitions)){
     if(versions.get(path)===change.before)versions.set(path,change.after);
     for(const node of document.querySelectorAll('form,dialog,[role="dialog"]')){
      const saved=snapshots.get(node);if(saved?.get(path)===change.before)saved.set(path,change.after);
     }
    }
    delete data._version_transitions;
   }
   if(data?._versions){
    for(const [path,token] of Object.entries(data._versions))versions.set(path,token);
    // Advance only the record this form just saved, even if its values did not change.
    // Background reads and writes to unrelated records must never bless stale input.
    if(response.ok&&write&&resource&&data._versions[resource]&&requestForm?.isConnected){
     for(const node of [requestForm,requestForm.closest('dialog,[role="dialog"]')]){
      if(node&&snapshots.has(node))snapshots.get(node).set(resource,data._versions[resource]);
     }
    }
    delete data._versions;
   }
   if(response.ok&&storage)forget(storage);
   if(!response.ok&&response.status<500&&data?.code!=='operation_pending'&&storage)forget(storage);
   if(data?.code==='edit_conflict'){
    let draft;try{draft=typeof init.body==='string'?JSON.parse(init.body):null;}catch{}
    const original=baseline();
    notify('conflict',{...data,original,draft,reload:()=>location.reload(),apply:data.actual&&draft?async fields=>{
      const chosen=Object.fromEntries(fields.map(field=>[field,draft[field]])),fresh=new Headers(headers);fresh.set('If-Match',data.actual);
      const result=await window.fetch(input,{...init,headers:fresh,body:JSON.stringify(chosen)});const answer=await result.json();if(!result.ok)throw Error(answer.error||'Die Änderungen konnten nicht gespeichert werden.');
    }:null});
   }

   if(data?.code==='operation_pending')notify('uncertain',{...data,project_id:owner()});
   const resultHeaders=new Headers(response.headers);resultHeaders.delete('Content-Length');resultHeaders.delete('Content-Encoding');
   return new Response(JSON.stringify(data),{status:response.status,statusText:response.statusText,headers:resultHeaders});
  }catch(error){
   const message=controller.signal.aborted?'Die Anfrage hat keine rechtzeitige Antwort geliefert.':error.message||'Verbindung unterbrochen.';
   if(write)notify('uncertain',{error:message+' Bitte vor einer erneuten Buchung zuerst den gespeicherten Stand prüfen.',operation_key:operation,project_id:owner()});
   throw Error(message+(write?' Bitte zuerst den gespeicherten Stand prüfen.':''));
  }finally{clearTimeout(timeout);external?.removeEventListener('abort',abort);}
 };
})();
