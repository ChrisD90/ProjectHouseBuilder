'use strict';
const $=id=>document.getElementById(id);
let loanSaving=false,equityBusy=false,drawdownBusy=false,pendingLoanScan=null,drawdownOptions=null,currentDrawdown=null;
const loanFlow=PHBFlow.manage({
 dialog:'loanDialog',forms:['loanForm'],dismiss:['closeLoan'],
 isBusy:()=>loanAiBusy||loanSaving,
 busyMessage:'Die Vertragsanalyse läuft noch. Bitte das Ergebnis abwarten.'
});
const equityFlow=PHBFlow.manage({
 dialog:'equityDialog',forms:['equityForm'],dismiss:['closeEquity'],
 isBusy:()=>equityBusy
});
const drawdownFlow=PHBFlow.manage({
 dialog:'drawdownDialog',forms:['drawdownForm'],dismiss:['closeDrawdown'],
 isBusy:()=>drawdownBusy,
 busyMessage:'Der Mittelabruf wird verarbeitet. Bitte das Ergebnis abwarten.'
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
 $('manualDrawdownDocumentWrap').hidden=ek!=='loan_drawdown';
}
function drawdownActions(d){
 const actions=[];
 if(d.status==='Entwurf')actions.push(`<button type="button" data-edit-drawdown="${d.id}">Weiter bearbeiten</button>`);
 if(d.download_url)actions.push(`<a class="button-link" href="${esc(d.download_url)}">ZIP laden</a>`);
 if(d.status==='Eingereicht'){
  actions.push(`<button type="button" class="primary" data-confirm-drawdown="${d.id}">Bank bestätigt</button>`);
  actions.push(`<button type="button" data-reject-drawdown="${d.id}">Bank abgelehnt</button>`);
 }
 if(['Entwurf','Eingereicht','Bestätigt'].includes(d.status))actions.push(`<button type="button" class="danger" data-undo-drawdown="${d.id}">${d.status==='Bestätigt'?'Buchung zurücknehmen':'Abruf zurücknehmen'}</button>`);
 return actions.join('');
}
function drawdownMilestone(d){
 const value=d.status==='Bestätigt'?d.confirmed_at:d.status==='Eingereicht'?d.submitted_at:
  d.status==='Abgelehnt'?d.rejected_at:d.updated_at||d.created_at;
 const label=d.status==='Bestätigt'?'bestätigt':d.status==='Eingereicht'?'eingereicht':
  d.status==='Abgelehnt'?'abgelehnt':d.status==='Zurückgenommen'?'zurückgenommen':'erstellt';
 return value?' · '+label+' '+esc(value.slice(0,10)):'';
}
function render(){
 const s=state.summary;
 const cards=[['Projektbudget',s.project_budget],['Darlehensrahmen',s.loan_frame],['Davon abgerufen',s.loan_drawn],['Kredit noch abrufbar',s.loan_undrawn],['Abgerufen & unverbraucht',s.loan_unallocated],['Eigenkapital verfügbar',s.equity_available],['Bisher über Kredit bezahlt',s.paid_loan],['Bisher über Eigenkapital bezahlt',s.paid_equity],['Offener Finanzbedarf',s.project_remaining],['Verfügbar insgesamt',s.total_available],['Rechnerische Finanzierungslücke',s.financing_gap]];
 $('totals').innerHTML=cards.map(([k,v])=>`<article class="tile ${k==='Rechnerische Finanzierungslücke'&&v>0?'alert':''}"><span>${esc(k)}</span><strong>${euro(v)}</strong></article>`).join('');
 $('warnings').innerHTML=s.warnings.map(x=>`<div class="warning">⚠ ${esc(x)}</div>`).join('');
 $('loanList').innerHTML=state.loans.map(l=>`<article class="smallcard"><h3>${esc(l.name)}</h3><p class="meta">${esc(l.bank)} · ${esc(l.reference)}</p><div class="values"><div>Rahmen<b>${euro(l.principal)}</b></div><div>Sollzins<b>${esc(l.interest_rate)} %</b></div><div>Monatsrate<b>${euro(l.monthly_payment)}</b></div><div>Abgerufen<b>${euro(l.balance.drawn)}</b></div><div>Unverbraucht<b>${euro(l.balance.unallocated_drawn)}</b></div><div>Restschuld nach eingetragenen Tilgungen<b>${euro(l.balance.outstanding_principal)}</b></div></div><div class="inline-actions"><span class="loan-doc-count">${l.documents?.length||0} Dokumente</span><button type="button" data-loan="${l.id}">Bearbeiten &amp; ergänzen</button></div></article>`).join('')||'<p>Noch kein Darlehen erfasst.</p>';
 $('equityList').innerHTML=state.equity.map(l=>`<article class="smallcard"><h3>${esc(l.name)}</h3><div class="values"><div>Startbestand<b>${euro(l.opening_balance)}</b></div><div>Noch verfügbar<b>${euro(l.balance.available)}</b></div><div>Sicherheitsreserve<b>${euro(l.reserve)}</b></div><div>Über Reserve<b>${euro(l.balance.after_reserve)}</b></div></div><div class="inline-actions"><button type="button" data-equity="${l.id}">Bearbeiten</button></div></article>`).join('')||'<p>Noch kein Eigenkapitalkonto erfasst.</p>';
 const kinds={loan_drawdown:'Kreditabruf',loan_repayment:'Tilgung',loan_interest:'Zinsen',loan_fee:'Gebühren',equity_deposit:'Eigenkapital-Zugang',equity_withdrawal:'Eigenkapital-Entnahme'};
 $('events').innerHTML=state.events.map(e=>`<div class="record"><div><strong>${esc(kinds[e.kind])}</strong> · ${euro(e.amount)}<br><span>${esc(e.event_date)} · ${esc(sourceTitle(e.loan_id?'loan':'equity',e.loan_id||e.equity_id))} ${e.notes?'· '+esc(e.notes):''}${e.document?` · <a href="${esc(e.document.download_url)}">${esc(e.document.filename)}</a>`:''}</span></div>${e.kind==='loan_drawdown'&&/^Mittelabruf #/.test(e.notes||'')?'':`<button type="button" data-delete-event="${e.id}" class="danger" title="Buchung stornieren">✕</button>`}</div>`).join('');
 $('drawdownHistory').innerHTML=(state.drawdowns||[]).map(d=>`<article class="drawdown-history-row"><div><div class="drawdown-history-title"><strong>${esc(d.loan_name)} · ${euro(d.requested_amount)}</strong><span class="drawdown-status-badge status-${esc(d.status.toLowerCase())}">${esc(d.status)}</span></div><span>Auszahlung ${esc(d.requested_date)} · ${d.receipt_count} Beleg${d.receipt_count===1?'':'e'}${drawdownMilestone(d)}${d.ai_prefilled?' · Vorlage mit ChatGPT zugeordnet':''}${d.rejection_reason?' · '+esc(d.rejection_reason):''}</span></div><div>${drawdownActions(d)}</div></article>`).join('')||'<p class="hint">Noch keine Mittelabrufe erstellt.</p>';

 fillOptions();
 document.querySelectorAll('[data-loan]').forEach(el=>el.onclick=()=>openLoan(Number(el.dataset.loan)));
 document.querySelectorAll('[data-equity]').forEach(el=>el.onclick=()=>openEquity(Number(el.dataset.equity)));
 document.querySelectorAll('[data-delete-event]').forEach(el=>el.onclick=()=>erase('events',Number(el.dataset.deleteEvent)));
 document.querySelectorAll('[data-delete-payment]').forEach(el=>el.onclick=()=>erase('payments',Number(el.dataset.deletePayment)));
 document.querySelectorAll('[data-undo-drawdown]').forEach(el=>el.onclick=()=>undoDrawdown(Number(el.dataset.undoDrawdown)));
 document.querySelectorAll('[data-edit-drawdown]').forEach(el=>el.onclick=()=>resumeDrawdown(Number(el.dataset.editDrawdown)));
 document.querySelectorAll('[data-confirm-drawdown]').forEach(el=>el.onclick=()=>confirmDrawdown(Number(el.dataset.confirmDrawdown)));
 document.querySelectorAll('[data-reject-drawdown]').forEach(el=>el.onclick=()=>rejectDrawdown(Number(el.dataset.rejectDrawdown)));
}
async function reload(){const [finance,drawdowns]=await Promise.all([api('/api/financing'),api('/api/financing/drawdowns')]);state=finance;state.drawdowns=drawdowns.drawdowns||[];render()}
function fill(form,obj){for(const [k,v] of Object.entries(obj||{})){const f=form.elements.namedItem(k);if(f&&f.tagName!=='BUTTON'){f.value=v??'';if(f instanceof HTMLInputElement)PHBUI.currency.prepare(f);}}}
function documentRows(loan){
 $('loanDocumentList').innerHTML=(loan.documents||[]).map(d=>`<div class="loan-doc-row">
   <div><a href="/api/financing/loans/${loan.id}/documents/${d.id}/download">${esc(d.filename)}</a>
   <small>${d.document_type==='drawdown_template'?'<b class="doc-type">Aktive Kreditabruf-Vorlage</b> · ':''}${esc(d.notes||'Ohne Beschreibung')} · ${esc(d.uploaded_at?.slice(0,10)||'')}</small></div>
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
function showLoanDrawdownProfile(loan){
 const form=$('loanDrawdownProfileForm');form.reset();
 fill(form,loan?.drawdown_profile||{});
 $('loanDrawdownProfileStatus').textContent='';
 $('loanDrawdownProfileDetails').open=false;
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
 pendingLoanScan=null;
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
 if(loan){documentRows(loan);showLoanDrawdownProfile(loan);}
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
 $('loanAiStatus').textContent='ChatGPT liest die Kreditunterlage. Der Kredit wird noch nicht angelegt oder geändert …';
 $('loanAiWarnings').hidden=true;
 $('loanAiWarnings').replaceChildren();
 try{
   const values=payload($('loanForm')),id=values.id;delete values.id;
   const result=await window.PHBImports.run({kind:'loans',files:[file],analysisMode:'ai',model:permission.model,
    processingMode:$('loanProcessingMode').value,fields:{loan_id:id,loan_values:JSON.stringify(values),overwrite:String($('loanAiOverwrite').checked)}});
   loanFlow.finish();
   if(result.background)message('Die Kreditunterlage wird in der Warteschlange analysiert.');
   else window.PHBImports.review(result.jobs);
 }catch(e){$('loanAiStatus').textContent=e.message;}
 finally{
  loanAiBusy=false;
  window.PHBImports.release(button);
  $('closeLoan').disabled=false;
  $('loanSaveButton').disabled=false;
  $('deleteLoan').disabled=false;
 }
};

function applyLoanAnalysis(data){
   const found=Object.entries(data.fields||{}).filter(([k,v])=>
     $('loanForm').elements.namedItem(k)&&v!==null&&v!=='');
   let applied=0,skipped=0;
   const existing=Boolean($('loanForm').elements.namedItem('id').value);
   const allowOverwrite=$('loanAiOverwrite').checked;
   for(const [key,value] of found){
     const field=$('loanForm').elements.namedItem(key);
     const current=String(field.value||'').trim();
     const empty=current===''||(!existing&&Number(PHBUI.currency.parse(current))===0);
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
}
async function reviewLoanScan(id){
 const data=await api('/api/import-jobs/'+id+'/loan-review');
 openLoan(data.loan_id||null);
 if(data.reviewed){$('loanSaveStatus').textContent='Diese Kreditanalyse wurde bereits gespeichert.';return;}
 fill($('loanForm'),data.values||{});
 $('loanAiOverwrite').checked=Boolean(data.overwrite);
 $('loanAiDetails').open=true;
 applyLoanAnalysis(data);
 pendingLoanScan=id;
}

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
$('loanDrawdownProfileForm').onsubmit=async event=>{
 event.preventDefault();const lid=Number($('loanForm').elements.namedItem('id').value);
 if(!lid)return;
 const button=event.submitter,status=$('loanDrawdownProfileStatus');button.disabled=true;
 status.textContent='Auszahlungsvorlage wird gespeichert …';
 try{
  const profile=Object.fromEntries(new FormData(event.currentTarget));
  await api('/api/financing/loans/'+lid+'/drawdown-profile','PATCH',profile);
  await reload();status.textContent='Vorlage gespeichert. Neue Mittelabrufe werden damit vorausgefüllt.';
 }catch(error){status.textContent=error.message;}finally{button.disabled=false;}
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
 if(pendingLoanScan)fields.scan_job_id=pendingLoanScan;
 loanSaving=true;
 button.disabled=true;
 status.textContent='Vertragsangaben werden gespeichert …';
 status.classList.remove('error');
 try{
   const saved=await api('/api/financing/loans'+(id?'/'+id:''),id?'PATCH':'POST',fields);
   pendingLoanScan=null;
   const address=new URL(location.href);address.searchParams.delete('loan_scan');address.searchParams.set('loan_id',String(saved.id));history.replaceState(null,'',address);
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
$('eventForm').onsubmit=async event=>{
 event.preventDefault();const form=event.currentTarget,kind=$('eventKind').value;
 try{
  if(kind==='loan_drawdown'){
   PHBUI.currency.normalizeForm(form);const data=new FormData(form);data.set('loan_id',$('eventSource').value);
   const response=await fetch('/api/financing/manual-drawdowns',{method:'POST',body:data});
   const result=await response.json();if(!response.ok)throw Error(result.error||'Kreditabruf konnte nicht gespeichert werden.');
  }else{
   const values=payload(form),loan=values.kind.startsWith('loan_');delete values.file;
   values[loan?'loan_id':'equity_id']=$('eventSource').value;await api('/api/financing/events','POST',values);
  }
  form.reset();form.elements.namedItem('event_date').value=TODAY;fillOptions();await reload();message('Geldbewegung gespeichert.');
 }catch(error){message(error.message,true);}
};

function updateDrawdownTotal(){
 const selected=[...$('drawdownReceiptList').querySelectorAll('input[type=checkbox]:checked')];
 const total=selected.reduce((sum,input)=>sum+Number(input.dataset.amount||0),0);
 $('drawdownSelectedTotal').textContent=euro(total)+' ausgewählt';
 $('createDrawdownPackage').disabled=drawdownBusy||!selected.length||total>Number(drawdownOptions?.undrawn||0)+0.004;
}
function renderDrawdownOptions(){
 const options=drawdownOptions;
 $('drawdownCapacity').textContent='Noch abrufbar: '+euro(options?.undrawn||0);
 const template=options?.template;
 $('drawdownTemplateState').innerHTML=template
  ? '<strong>Abrufvorlage vorhanden:</strong> '+esc(template.filename)
  : '<strong>Keine Abrufvorlage hinterlegt.</strong> Das ZIP wird trotzdem mit Übersicht und Belegen erstellt. Eine PDF-Vorlage kannst du beim Kredit ergänzen.';
 const aiAvailable=Boolean(template&&window.PHBAI?.connected());
 $('drawdownAiWrap').hidden=!aiAvailable;
 if(!aiAvailable)$('drawdownAiPrefill').checked=false;
 const rows=options?.receipts||[];
 $('drawdownReceiptList').innerHTML=rows.map(r=>`<label class="drawdown-receipt ${r.eligible?'':'disabled'}"><input type="checkbox" value="${r.id}" data-amount="${r.submittable}" ${r.eligible?'':'disabled'}><span><strong>${esc(r.supplier)}</strong><small>${esc(r.document_date||'Ohne Datum')} · ${esc(r.invoice_number||r.filename)} · ${esc(r.source_summary)}</small></span><span class="drawdown-amount"><b>${euro(r.submittable)}</b><small>einreichbar</small></span></label>`).join('')||'<p class="hint">Noch keine gebuchten Rechnungen vorhanden.</p>';
 $('drawdownReceiptList').querySelectorAll('input[type=checkbox]').forEach(input=>input.onchange=updateDrawdownTotal);
 updateDrawdownTotal();
}
function applySavedDrawdownProfile(loanId){
 const profile=state.loans.find(loan=>loan.id===Number(loanId))?.drawdown_profile||{};
 for(const name of ['borrower_names','property_address','recipient_name','recipient_iban','location','notes']){
  const field=$('drawdownForm').elements.namedItem(name);if(field)field.value=profile[name]||'';
 }
}
async function loadDrawdownOptions(){
 const loanId=Number($('drawdownLoan').value);
 if(!loanId){drawdownOptions=null;renderDrawdownOptions();return;}
 $('drawdownReceiptList').innerHTML='<p class="hint">Belege und Zahlungsquellen werden geladen …</p>';
 try{drawdownOptions=await api('/api/financing/drawdowns/options?loan_id='+loanId);applySavedDrawdownProfile(loanId);renderDrawdownOptions();}
 catch(error){drawdownOptions=null;$('drawdownStatus').textContent=error.message;renderDrawdownOptions();}
}
async function openDrawdown(){
 $('drawdownForm').reset();drawdownOptions=null;currentDrawdown=null;
 $('drawdownSetupStage').hidden=false;$('drawdownPreviewStage').hidden=true;
 $('drawdownLoan').innerHTML=state.loans.map(loan=>option(loan.id,loan.name+' · noch abrufbar '+euro(loan.balance.undrawn))).join('');
 $('drawdownForm').elements.namedItem('requested_date').value=TODAY;
 $('drawdownStatus').textContent='';
 drawdownFlow.open();
 if(!state.loans.length){$('drawdownStatus').textContent='Bitte zuerst einen Kredit anlegen.';renderDrawdownOptions();return;}
 await loadDrawdownOptions();drawdownFlow.snapshot();
}
$('newDrawdown').onclick=openDrawdown;
$('drawdownLoan').onchange=loadDrawdownOptions;
$('closeDrawdown').onclick=async()=>{if(drawdownBusy)return;$('drawdownDialog').close();if(currentDrawdown)await reload();};
document.addEventListener('phb-ai-status',()=>{if($('drawdownDialog').open)renderDrawdownOptions();});
async function undoDrawdown(id){
 const row=(state.drawdowns||[]).find(item=>item.id===id),booked=row?.status==='Bestätigt';
 const question=booked
  ? 'Diesen bestätigten Mittelabruf zurücknehmen? Kreditbuchung und alle dadurch umgebuchten Finanzierungsquellen werden gemeinsam wiederhergestellt; der Vorgang bleibt in der Historie.'
  : 'Diesen Mittelabruf zurücknehmen? Der Vorgang bleibt mit dem Status „Zurückgenommen“ in der Historie.';
 if(!await PHBUI.confirm(question))return;
 try{await api('/api/financing/drawdowns/'+id,'DELETE');await reload();message(booked?'Buchung und Umbuchungen wurden gemeinsam zurückgenommen.':'Mittelabruf wurde zurückgenommen.');}
 catch(error){message(error.message,true);}
}
async function confirmDrawdown(id){
 const confirmedDate=await PHBUI.prompt('An welchem Tag hat die Bank die Auszahlung bestätigt? Datum im Format JJJJ-MM-TT:',TODAY);
 if(confirmedDate===null)return;
 try{await api('/api/financing/drawdowns/'+id+'/confirm','POST',{confirmed_date:confirmedDate});await reload();message('Bankbestätigung erfasst. Kreditabruf und Umbuchungen sind jetzt gebucht.');}
 catch(error){message(error.message,true);}
}
async function rejectDrawdown(id){
 const reason=await PHBUI.prompt('Ablehnungsgrund der Bank (optional):','');if(reason===null)return;
 try{await api('/api/financing/drawdowns/'+id+'/reject','POST',{reason});await reload();message('Mittelabruf als abgelehnt dokumentiert.');}
 catch(error){message(error.message,true);}
}
function renderDraftEditor(draft){
 currentDrawdown=draft;$('drawdownSetupStage').hidden=true;$('drawdownPreviewStage').hidden=false;
 $('drawdownPreviewTotal').value=Number(draft.requested_amount).toFixed(2);
 $('drawdownPositionEditor').innerHTML=(draft.positions||[]).map((position,index)=>`<article class="drawdown-position" data-receipt-id="${position.receipt_id}"><header><strong>Position ${index+1}</strong><span>${esc(position.filename||'Beleg')}</span></header><label>Lieferant<input data-position-field="supplier" maxlength="200" required value="${esc(position.supplier)}"></label><label>Rechnungsnummer<input data-position-field="invoice_number" maxlength="100" value="${esc(position.invoice_number||'')}"></label><label>Belegdatum<input data-position-field="document_date" type="date" value="${esc(position.document_date||'')}"></label><label>Betrag (€)<input data-position-field="amount" type="number" min="0.01" step="0.01" required value="${Number(position.amount).toFixed(2)}"></label></article>`).join('');
 const iframe=$('drawdownPdfPreview'),empty=$('drawdownPdfPanel').querySelector('.drawdown-no-preview');
 if(draft.preview_url){iframe.hidden=false;empty.hidden=true;iframe.src=draft.preview_url+'?v='+Date.now();}
 else{iframe.hidden=true;iframe.removeAttribute('src');empty.hidden=false;}
 $('drawdownPreviewMessage').textContent=(draft.data?.warnings||[]).join(' · ');
 $('drawdownDialogTitle').textContent='Mittelabruf #'+draft.id+' prüfen';
}
function draftEditorPayload(){
 const positions=[...$('drawdownPositionEditor').querySelectorAll('.drawdown-position')].map(row=>({
  receipt_id:Number(row.dataset.receiptId),supplier:row.querySelector('[data-position-field="supplier"]').value,
  invoice_number:row.querySelector('[data-position-field="invoice_number"]').value,
  document_date:row.querySelector('[data-position-field="document_date"]').value,
  amount:row.querySelector('[data-position-field="amount"]').value
 }));
 return {requested_amount:$('drawdownPreviewTotal').value,requested_date:currentDrawdown.requested_date,
  borrower_names:currentDrawdown.borrower_names,property_address:currentDrawdown.property_address,
  recipient_iban:currentDrawdown.recipient_iban,recipient_name:currentDrawdown.recipient_name,
  location:currentDrawdown.location,notes:currentDrawdown.notes,positions};
}
async function saveDraft(showMessage=true){
 if(!currentDrawdown)throw Error('Kein Mittelabruf-Entwurf geöffnet.');
 const saved=await api('/api/financing/drawdowns/'+currentDrawdown.id+'/draft','PATCH',draftEditorPayload());
 renderDraftEditor(saved);if(showMessage)$('drawdownPreviewMessage').textContent='Vorschau und Positionen wurden aktualisiert.';return saved;
}
async function resumeDrawdown(id){
 try{const draft=await api('/api/financing/drawdowns/'+id);drawdownFlow.open();renderDraftEditor(draft);drawdownFlow.snapshot();}
 catch(error){message(error.message,true);}
}
$('updateDrawdownPreview').onclick=async()=>{
 if(drawdownBusy)return;drawdownBusy=true;$('drawdownPreviewMessage').textContent='PDF-Vorschau wird aktualisiert …';
 try{await saveDraft();}catch(error){$('drawdownPreviewMessage').textContent=error.message;}finally{drawdownBusy=false;}
};
$('submitDrawdownPackage').onclick=async()=>{
 if(drawdownBusy||!currentDrawdown)return;drawdownBusy=true;$('drawdownPreviewMessage').textContent='Einreichungspaket wird erstellt …';
 try{
  await saveDraft(false);const response=await fetch('/api/financing/drawdowns/'+currentDrawdown.id+'/submit',{method:'POST'});
  if(!response.ok){const result=await response.json();throw Error(result.error||'Einreichung fehlgeschlagen.');}
  const blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download='Mittelabruf_'+currentDrawdown.requested_date+'.zip';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
  drawdownFlow.finish();await reload();message('Mittelabruf als eingereicht gespeichert und ZIP-Paket heruntergeladen. Die Buchung erfolgt erst nach Bestätigung der Bank.');
 }catch(error){$('drawdownPreviewMessage').textContent=error.message;}finally{drawdownBusy=false;}
};
$('backToDrawdownSetup').onclick=async()=>{drawdownFlow.finish();await reload();openDrawdown();};
$('drawdownForm').onsubmit=async event=>{
 event.preventDefault();if(drawdownBusy)return;
 if(currentDrawdown){$('updateDrawdownPreview').click();return;}
 const receiptIds=[...$('drawdownReceiptList').querySelectorAll('input[type=checkbox]:checked')].map(input=>Number(input.value));
 if(!receiptIds.length){$('drawdownStatus').textContent='Bitte mindestens einen Beleg auswählen.';return;}
 const fields=Object.fromEntries(new FormData(event.currentTarget));
 fields.loan_id=Number(fields.loan_id);fields.receipt_ids=receiptIds;
 fields.ai_prefill=$('drawdownAiPrefill').checked;
 if(fields.ai_prefill){
  try{const selection=window.PHBAI?.selection();fields.model=selection?.model||'';fields.plan_only='true';}catch(error){$('drawdownStatus').textContent=error.message;return;}
 }
 drawdownBusy=true;const button=$('createDrawdownPackage');button.disabled=true;
 $('drawdownStatus').textContent=fields.ai_prefill?'ChatGPT ordnet die Formularfelder zu und erstellt die prüfbare PDF-Vorschau …':'Entwurf und Vorschau werden erstellt …';
 try{
  const headers={'Content-Type':'application/json'};if(fields.ai_prefill)headers['X-PHB-AI']='1';
  const response=await fetch('/api/financing/drawdowns/drafts',{method:'POST',headers,body:JSON.stringify(fields)});
  if(!response.ok){const result=await response.json();throw Error(result.error||'Mittelabruf konnte nicht erstellt werden.');}
  renderDraftEditor(await response.json());drawdownFlow.snapshot();
 }catch(error){$('drawdownStatus').textContent=error.message;}
 finally{drawdownBusy=false;button.disabled=false;updateDrawdownTotal();}
};

reload().then(()=>{
   const scanId=Number(new URLSearchParams(location.search).get('loan_scan'));
   if(scanId>0)return reviewLoanScan(scanId);
   const loanId=Number(new URLSearchParams(location.search).get('loan_id'));
   if(loanId&&state.loans.some(loan=>loan.id===loanId))openLoan(loanId);
 }).catch(err=>message('Finanzierung nicht geladen: '+err.message,true));
