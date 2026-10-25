'use strict';
const $=id=>document.getElementById(id);
let loanSaving=false,equityBusy=false;
const loanFlow=PHBFlow.manage({
 dialog:'loanDialog',forms:['loanForm'],dismiss:['closeLoan'],
 isBusy:()=>loanAiBusy||loanSaving,
 busyMessage:'Die Vertragsanalyse läuft noch. Bitte das Ergebnis abwarten.'
});
const equityFlow=PHBFlow.manage({
 dialog:'equityDialog',forms:['equityForm'],dismiss:['closeEquity'],
 isBusy:()=>equityBusy
});

const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const euro=n=>new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'}).format(Number(n)||0);
let state=null;
const TODAY=new Date().toLocaleDateString('sv-SE');
$('eventForm').elements.namedItem('event_date').value=TODAY;
async function api(url,method='GET',payload=null){const o={method};if(payload!==null){o.headers={'Content-Type':'application/json'};o.body=JSON.stringify(payload)}let r=await fetch(url,o),j=await r.json();if(!r.ok)throw Error(j.error||'Aktion fehlgeschlagen');return j}
function message(text,error=false){const n=$('notice');n.hidden=false;n.textContent=text;n.classList.toggle('error',error);n.scrollIntoView({block:'nearest',behavior:'smooth'});}
function payload(form){PHBUI.currency.normalizeForm(form);return Object.fromEntries(new FormData(form).entries());}
function option(id,text){return `<option value="${esc(id)}">${esc(text)}</option>`}
function sourceTitle(s,x){const row=(s==='loan'?state.loans:state.equity).find(a=>a.id===x);return row?.name||'Unbekannte Quelle'}
function fillOptions(){
 const ek=$('eventKind').value, loans=ek.startsWith('loan_');
 $('eventSource').innerHTML=(loans?state.loans:state.equity).map(x=>option(x.id,x.name)).join('');
}
function render(){
 const s=state.summary;
 const cards=[['Projektbudget',s.project_budget],['Darlehensrahmen',s.loan_frame],['Davon abgerufen',s.loan_drawn],['Kredit noch abrufbar',s.loan_undrawn],['Abgerufen & unverbraucht',s.loan_unallocated],['Eigenkapital verfügbar',s.equity_available],['Bisher über Kredit bezahlt',s.paid_loan],['Bisher über Eigenkapital bezahlt',s.paid_equity],['Offener Finanzbedarf',s.project_remaining],['Verfügbar insgesamt',s.total_available],['Rechnerische Finanzierungslücke',s.financing_gap]];
 $('totals').innerHTML=cards.map(([k,v])=>`<article class="tile ${k==='Rechnerische Finanzierungslücke'&&v>0?'alert':''}"><span>${esc(k)}</span><strong>${euro(v)}</strong></article>`).join('');
 $('warnings').innerHTML=s.warnings.map(x=>`<div class="warning">⚠ ${esc(x)}</div>`).join('');
 $('loanList').innerHTML=state.loans.map(l=>`<article class="smallcard"><h3>${esc(l.name)}</h3><p class="meta">${esc(l.bank)} · ${esc(l.reference)}</p><div class="values"><div>Rahmen<b>${euro(l.principal)}</b></div><div>Sollzins<b>${esc(l.interest_rate)} %</b></div><div>Monatsrate<b>${euro(l.monthly_payment)}</b></div><div>Abgerufen<b>${euro(l.balance.drawn)}</b></div><div>Unverbraucht<b>${euro(l.balance.unallocated_drawn)}</b></div><div>Restschuld nach eingetragenen Tilgungen<b>${euro(l.balance.outstanding_principal)}</b></div></div><div class="inline-actions"><span class="loan-doc-count">${l.documents?.length||0} Dokumente</span><button type="button" data-loan="${l.id}">Bearbeiten &amp; ergänzen</button></div></article>`).join('')||'<p>Noch kein Darlehen erfasst.</p>';
 $('equityList').innerHTML=state.equity.map(l=>`<article class="smallcard"><h3>${esc(l.name)}</h3><div class="values"><div>Startbestand<b>${euro(l.opening_balance)}</b></div><div>Noch verfügbar<b>${euro(l.balance.available)}</b></div><div>Sicherheitsreserve<b>${euro(l.reserve)}</b></div><div>Über Reserve<b>${euro(l.balance.after_reserve)}</b></div></div><div class="inline-actions"><button type="button" data-equity="${l.id}">Bearbeiten</button></div></article>`).join('')||'<p>Noch kein Eigenkapitalkonto erfasst.</p>';
 const kinds={loan_drawdown:'Kreditabruf',loan_repayment:'Tilgung',loan_interest:'Zinsen',loan_fee:'Gebühren',equity_deposit:'Eigenkapital-Zugang',equity_withdrawal:'Eigenkapital-Entnahme'};
 $('events').innerHTML=state.events.map(e=>`<div class="record"><div><strong>${esc(kinds[e.kind])}</strong> · ${euro(e.amount)}<br><span>${esc(e.event_date)} · ${esc(sourceTitle(e.loan_id?'loan':'equity',e.loan_id||e.equity_id))} ${e.notes?'· '+esc(e.notes):''}</span></div><button type="button" data-delete-event="${e.id}" class="danger" title="Buchung stornieren">✕</button></div>`).join('');

 fillOptions();
 document.querySelectorAll('[data-loan]').forEach(el=>el.onclick=()=>openLoan(Number(el.dataset.loan)));
 document.querySelectorAll('[data-equity]').forEach(el=>el.onclick=()=>openEquity(Number(el.dataset.equity)));
 document.querySelectorAll('[data-delete-event]').forEach(el=>el.onclick=()=>erase('events',Number(el.dataset.deleteEvent)));
 document.querySelectorAll('[data-delete-payment]').forEach(el=>el.onclick=()=>erase('payments',Number(el.dataset.deletePayment)));
}
async function reload(){state=await api('/api/financing');render()}
function fill(form,obj){for(const [k,v] of Object.entries(obj||{})){const f=form.elements.namedItem(k);if(f&&f.tagName!=='BUTTON'){f.value=v??'';if(f instanceof HTMLInputElement)PHBUI.currency.prepare(f);}}}
function documentRows(loan){
 $('loanDocumentList').innerHTML=(loan.documents||[]).map(d=>`<div class="loan-doc-row">
   <div><a href="/api/financing/loans/${loan.id}/documents/${d.id}/download">${esc(d.filename)}</a>
   <small>${esc(d.notes||'Ohne Beschreibung')} · ${esc(d.uploaded_at?.slice(0,10)||'')}</small></div>
   <button type="button" class="danger" data-delete-loan-document="${d.id}" aria-label="Dokument ${esc(d.filename)} entfernen">Löschen</button>
 </div>`).join('')||'<p class="hint">Noch keine Dokumente hinterlegt.</p>';
 $('loanDocumentList').querySelectorAll('[data-delete-loan-document]').forEach(b=>b.onclick=async()=>{
   if(!await PHBUI.confirm('Dieses Kreditdokument endgültig löschen?'))return;
   try{await api('/api/financing/loans/'+loan.id+'/documents/'+b.dataset.deleteLoanDocument,'DELETE');
     await reload();const updated=state.loans.find(x=>x.id===loan.id);
     if(updated)documentRows(updated);
     $('loanDocumentStatus').textContent='Dokument gelöscht.';
   }catch(e){$('loanDocumentStatus').textContent=e.message;}
 });
}
function updateLoanEditorMode(id){
 const existing=Boolean(id);
 $('loanDialogTitle').textContent=existing?'Kredit bearbeiten und ergänzen':'Neuen Kredit anlegen';
 $('loanFormHelp').textContent=existing
   ? 'Ändere oder ergänze Vertragskonditionen und Notizen. Bereits hinterlegte Kreditabrufe, Zahlungen und Dokumente bleiben erhalten.'
   : 'Lege den Kredit manuell an oder lasse Vertragsfelder mit ChatGPT vorausfüllen. Alle Angaben können später ergänzt werden.';
 $('loanSaveButton').textContent=existing?'Änderungen am Kredit speichern':'Kredit anlegen';
 $('deleteLoan').hidden=!existing;
 $('loanDocuments').hidden=!existing;
}
function openLoan(id=null){
 const loan=id?state.loans.find(x=>x.id===id):null;
 if(id&&!loan){message('Kredit nicht gefunden.',true);return;}
 $('loanForm').reset();
 $('loanForm').elements.namedItem('id').value='';
 if(loan)fill($('loanForm'),loan);
 $('loanAiFile').value='';
 $('loanAiOverwrite').checked=false;
 $('loanAiStatus').textContent='';
 $('loanAiWarnings').hidden=true;
 $('loanAiWarnings').replaceChildren();
 $('loanSaveStatus').textContent='';
 $('loanSaveStatus').classList.remove('error');
 $('loanDocumentStatus').textContent='';
 $('loanDocumentUpload').reset();
 $('loanAiDetails').open=false;
 $('loanDocUploadDetails').open=false;
 updateLoanEditorMode(id);
 if(loan)documentRows(loan);
 loanFlow.open();
}
function openEquity(id=null){$('equityForm').reset();$('equityForm').elements.namedItem('id').value='';if(id)fill($('equityForm'),state.equity.find(x=>x.id===id));$('deleteEquity').hidden=!id;equityFlow.open()}
$('newLoan').onclick=()=>openLoan();$('newEquity').onclick=()=>openEquity();

let loanAiBusy=false;
$('loanAiAnalyze').onclick=async()=>{
 const file=$('loanAiFile').files[0];
 if(!file){$('loanAiStatus').textContent='Bitte zuerst eine Kreditunterlage auswählen.';return;}
 const button=$('loanAiAnalyze');
 let permission;
 try{permission=window.PHBAI?.selection();if(!permission)throw Error('Bitte zuerst ChatGPT verbinden.');}
 catch(e){$('loanAiStatus').textContent=e.message;return;}
 if(loanAiBusy)return;
 loanAiBusy=true;
 button.disabled=true;
 $('closeLoan').disabled=true;
 $('loanSaveButton').disabled=true;
 $('deleteLoan').disabled=true;
 $('loanAiStatus').textContent='ChatGPT liest die Kreditunterlage. Die Daten werden noch nicht gespeichert …';
 $('loanAiWarnings').hidden=true;
 $('loanAiWarnings').replaceChildren();
 try{
   const form=new FormData();
   form.set('file',file);
   form.set('model',permission.model);
   form.set('plan_only','true');
   const response=await fetch('/api/financing/loans/ai/extract',{
     method:'POST',headers:{'X-PHB-AI':'1'},body:form
   });
   const data=await response.json();
   if(!response.ok)throw Error(data.error||'ChatGPT-Auslesen fehlgeschlagen.');
   const found=Object.entries(data.fields||{}).filter(([k,v])=>
     $('loanForm').elements.namedItem(k)&&v!==null&&v!=='');
   let applied=0,skipped=0;
   const existing=Boolean($('loanForm').elements.namedItem('id').value);
   const allowOverwrite=$('loanAiOverwrite').checked;
   for(const [key,value] of found){
     const field=$('loanForm').elements.namedItem(key);
     const current=String(field.value||'').trim();
     const empty=current===''||(!existing&&field.type==='number'&&Number(current)===0);
     if(!allowOverwrite&&!empty){skipped++;continue;}
     field.value=value;PHBUI.currency.prepare(field);applied++;
   }
   if((data.warnings||[]).length){
     $('loanAiWarnings').replaceChildren(...data.warnings.map(w=>{
       const li=document.createElement('li');li.textContent=w;return li;
     }));
     $('loanAiWarnings').hidden=false;
   }
   $('loanAiStatus').textContent=applied+
     ' Vertragsfelder ergänzt'+(skipped?', '+skipped+' bestehende Angaben beibehalten':'')+
     '. Bitte alle Werte mit dem Original prüfen und danach die Änderungen speichern.';
 }catch(e){$('loanAiStatus').textContent=e.message;}
 finally{
  loanAiBusy=false;
  button.disabled=false;
  $('closeLoan').disabled=false;
  $('loanSaveButton').disabled=false;
  $('deleteLoan').disabled=false;
 }
};

$('loanDocumentUpload').onsubmit=async event=>{
 event.preventDefault();
 const lid=$('loanForm').elements.namedItem('id').value;
 if(!lid){$('loanDocumentStatus').textContent='Bitte den Kredit zuerst speichern.';return;}
 const btn=$('loanDocumentAdd');btn.disabled=true;
 $('loanDocumentStatus').textContent='Dokument wird lokal gespeichert …';
 try{
   const response=await fetch('/api/financing/loans/'+lid+'/documents',{
     method:'POST',body:new FormData($('loanDocumentUpload'))
   });
   const data=await response.json();
   if(!response.ok)throw Error(data.error||'Hochladen fehlgeschlagen.');
   $('loanDocumentUpload').reset();
   $('loanDocUploadDetails').open=false;
   await reload();
   const updated=state.loans.find(x=>x.id===Number(lid));
   if(updated)documentRows(updated);
   $('loanDocumentStatus').textContent='Kreditdokument angehängt und in den Projektbackups enthalten.';
 }catch(e){$('loanDocumentStatus').textContent=e.message;}
 finally{btn.disabled=false;}
};

$('loanDialog').addEventListener('cancel',event=>{
 if(loanAiBusy){
  event.preventDefault();
  $('loanAiStatus').textContent='Die ChatGPT-Analyse läuft. Der Dialog bleibt bis zum Ergebnis geöffnet.';
 }
});
$('closeLoan').onclick=()=>{
  if(loanAiBusy){
    $('loanAiStatus').textContent='ChatGPT analysiert noch. Damit die Vorschläge nicht verloren gehen, bleibt der Dialog bis zum Abschluss geöffnet.';
    return;
  }
  $('loanDialog').close();
};$('closeEquity').onclick=()=>$('equityDialog').close();
async function submitForm(event,form,base,dialog){
 event.preventDefault();
 if(equityBusy)return;
 const button=event.submitter||form.querySelector('button[type=submit]');
 equityBusy=true;button.disabled=true;
 try{
  const fields=payload(form),id=fields.id;delete fields.id;
  await api(base+(id?'/'+id:''),id?'PATCH':'POST',fields);
  dialog.close();await reload();message('Gespeichert.');
 }catch(err){message(err.message,true);}
 finally{equityBusy=false;button.disabled=false;}
}
$('loanForm').onsubmit=async event=>{
 event.preventDefault();
 if(loanAiBusy)return;
 const form=$('loanForm'),button=$('loanSaveButton'),status=$('loanSaveStatus');
 const fields=payload(form),id=fields.id;
 delete fields.id;
 loanSaving=true;
 button.disabled=true;
 status.textContent='Vertragsangaben werden gespeichert …';
 status.classList.remove('error');
 try{
   const saved=await api('/api/financing/loans'+(id?'/'+id:''),id?'PATCH':'POST',fields);
   await reload();
   form.elements.namedItem('id').value=String(saved.id);
   // Show the persisted (server-validated) values, without altering finance bookings.
   const loan=state.loans.find(x=>x.id===saved.id);
   if(loan){
     fill(form,loan);
     documentRows(loan);
   }
   updateLoanEditorMode(saved.id);
   loanFlow.snapshot();
   status.textContent='Änderungen gespeichert. Der Kredit kann hier weiter ergänzt werden.';
   status.classList.remove('error');
 }catch(err){
   status.textContent='Speichern fehlgeschlagen: '+err.message;
   status.classList.add('error');
 }finally{
   loanSaving=false;
   button.disabled=false;
 }
};
$('equityForm').onsubmit=e=>submitForm(e,$('equityForm'),'/api/financing/equity',$('equityDialog'));
async function erase(path,id){if(!await PHBUI.confirm('Diese Buchung wirklich entfernen? Die Summen werden entsprechend neu berechnet.'))return;try{await api('/api/financing/'+path+'/'+id,'DELETE');await reload();message('Buchung entfernt.')}catch(e){message(e.message,true)}}
$('deleteLoan').onclick=async()=>{if(loanAiBusy)return;const id=$('loanForm').elements.namedItem('id').value;if(!await PHBUI.confirm('Kredit ohne verknüpfte Buchungen löschen?'))return;try{await api('/api/financing/loans/'+id,'DELETE');$('loanDialog').close();await reload()}catch(e){message(e.message,true)}};
$('deleteEquity').onclick=async()=>{const id=$('equityForm').elements.namedItem('id').value;if(!await PHBUI.confirm('Eigenkapitalkonto ohne Buchungen löschen?'))return;try{await api('/api/financing/equity/'+id,'DELETE');$('equityDialog').close();await reload()}catch(e){message(e.message,true)}};
$('eventKind').onchange=fillOptions;
$('eventForm').onsubmit=async e=>{e.preventDefault();const v=payload(e.currentTarget),loan=v.kind.startsWith('loan_');v[loan?'loan_id':'equity_id']=$('eventSource').value;try{await api('/api/financing/events','POST',v);await reload();message('Geldbewegung gespeichert.')}catch(err){message(err.message,true)}};

reload().then(()=>{
   const loanId=Number(new URLSearchParams(location.search).get('loan_id'));
   if(loanId&&state.loans.some(loan=>loan.id===loanId))openLoan(loanId);
 }).catch(err=>message('Finanzierung nicht geladen: '+err.message,true));
