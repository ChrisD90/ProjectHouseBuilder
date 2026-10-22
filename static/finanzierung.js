'use strict';
const $=id=>document.getElementById(id);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const euro=n=>new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'}).format(Number(n)||0);
let state=null;
const TODAY=new Date().toLocaleDateString('sv-SE');
$('eventForm').elements.namedItem('event_date').value=TODAY;
$('paymentForm').elements.namedItem('payment_date').value=TODAY;
async function api(url,method='GET',payload=null){const o={method};if(payload!==null){o.headers={'Content-Type':'application/json'};o.body=JSON.stringify(payload)}let r=await fetch(url,o),j=await r.json();if(!r.ok)throw Error(j.error||'Aktion fehlgeschlagen');return j}
function message(text,error=false){const n=$('notice');n.hidden=false;n.textContent=text;n.classList.toggle('error',error);n.scrollIntoView({block:'nearest',behavior:'smooth'});}
function payload(form){return Object.fromEntries(new FormData(form).entries());}
function option(id,text){return `<option value="${esc(id)}">${esc(text)}</option>`}
function sourceTitle(s,x){const row=(s==='loan'?state.loans:state.equity).find(a=>a.id===x);return row?.name||'Unbekannte Quelle'}
function fillOptions(){
 const source=$('paymentSource').value;
 $('paymentAccount').innerHTML=(source==='loan'?state.loans:state.equity).map(x=>option(x.id, x.name+' – frei '+euro(source==='loan'?x.balance.unallocated_drawn:x.balance.available))).join('');
 const ek=$('eventKind').value, loans=ek.startsWith('loan_');
 $('eventSource').innerHTML=(loans?state.loans:state.equity).map(x=>option(x.id,x.name)).join('');
 const chosen=$('paymentReceipt').value;
 $('paymentReceipt').innerHTML=option('','Rechnung auswählen')+state.receipts.filter(r=>r.open>0).map(x=>option(x.id,x.name+' · offen '+euro(x.open))).join('');
 if(state.receipts.some(x=>String(x.id)===chosen&&x.open>0))$('paymentReceipt').value=chosen;
}
function render(){
 const s=state.summary;
 const cards=[['Darlehensrahmen',s.loan_frame],['Davon abgerufen',s.loan_drawn],['Kredit noch abrufbar',s.loan_undrawn],['Abgerufen & unverbraucht',s.loan_unallocated],['Eigenkapital verfügbar',s.equity_available],['Bisher über Kredit bezahlt',s.paid_loan],['Bisher über Eigenkapital bezahlt',s.paid_equity],['Offener Finanzbedarf',s.project_remaining],['Verfügbar insgesamt',s.total_available],['Rechnerische Finanzierungslücke',s.financing_gap]];
 $('totals').innerHTML=cards.map(([k,v])=>`<article class="tile ${k==='Rechnerische Finanzierungslücke'&&v>0?'alert':''}"><span>${esc(k)}</span><strong>${euro(v)}</strong></article>`).join('');
 $('warnings').innerHTML=s.warnings.map(x=>`<div class="warning">⚠ ${esc(x)}</div>`).join('');
 $('loanList').innerHTML=state.loans.map(l=>`<article class="smallcard"><h3>${esc(l.name)}</h3><p class="meta">${esc(l.bank)} · ${esc(l.reference)}</p><div class="values"><div>Rahmen<b>${euro(l.principal)}</b></div><div>Sollzins<b>${esc(l.interest_rate)} %</b></div><div>Monatsrate<b>${euro(l.monthly_payment)}</b></div><div>Abgerufen<b>${euro(l.balance.drawn)}</b></div><div>Unverbraucht<b>${euro(l.balance.unallocated_drawn)}</b></div><div>Restschuld nach eingetragenen Tilgungen<b>${euro(l.balance.outstanding_principal)}</b></div></div><div class="inline-actions"><button type="button" data-loan="${l.id}">Bearbeiten</button></div></article>`).join('')||'<p>Noch kein Darlehen erfasst.</p>';
 $('equityList').innerHTML=state.equity.map(l=>`<article class="smallcard"><h3>${esc(l.name)}</h3><div class="values"><div>Startbestand<b>${euro(l.opening_balance)}</b></div><div>Noch verfügbar<b>${euro(l.balance.available)}</b></div><div>Sicherheitsreserve<b>${euro(l.reserve)}</b></div><div>Über Reserve<b>${euro(l.balance.after_reserve)}</b></div></div><div class="inline-actions"><button type="button" data-equity="${l.id}">Bearbeiten</button></div></article>`).join('')||'<p>Noch kein Eigenkapitalkonto erfasst.</p>';
 const kinds={loan_drawdown:'Kreditabruf',loan_repayment:'Tilgung',loan_interest:'Zinsen',loan_fee:'Gebühren',equity_deposit:'Eigenkapital-Zugang',equity_withdrawal:'Eigenkapital-Entnahme'};
 $('events').innerHTML=state.events.map(e=>`<div class="record"><div><strong>${esc(kinds[e.kind])}</strong> · ${euro(e.amount)}<br><span>${esc(e.event_date)} · ${esc(sourceTitle(e.loan_id?'loan':'equity',e.loan_id||e.equity_id))} ${e.notes?'· '+esc(e.notes):''}</span></div><button type="button" data-delete-event="${e.id}" class="danger" title="Buchung stornieren">✕</button></div>`).join('');
 $('payments').innerHTML=state.payments.map(e=>`<div class="record"><div><strong>${euro(e.amount)} · ${esc(e.receipt_name)}</strong><br><span>${esc(e.payment_date)} · ${esc(sourceTitle(e.source,e.loan_id||e.equity_id))} ${e.notes?'· '+esc(e.notes):''}</span></div><button type="button" data-delete-payment="${e.id}" class="danger" title="Zahlung stornieren">✕</button></div>`).join('');
 const max=Math.max(1,...s.months.map(x=>x.due));
 $('monthly').innerHTML=s.months.map(x=>`<div class="month"><small>${esc(x.month)}</small><strong>${euro(x.due)}</strong><div class="bar"><span style="width:${Math.round(x.due/max*100)}%"></span></div></div>`).join('');
 $('undated').textContent=`Überfällig: ${euro(s.overdue)} · Noch ohne Fälligkeitsdatum: ${euro(s.no_due_date)} · Bisher bezahlte Belege ohne Finanzierungszuordnung: ${euro(s.unassigned_paid_receipts)}. Nicht terminierte zukünftige Baukosten sind hier noch nicht enthalten.`;
 fillOptions();
 document.querySelectorAll('[data-loan]').forEach(el=>el.onclick=()=>openLoan(Number(el.dataset.loan)));
 document.querySelectorAll('[data-equity]').forEach(el=>el.onclick=()=>openEquity(Number(el.dataset.equity)));
 document.querySelectorAll('[data-delete-event]').forEach(el=>el.onclick=()=>erase('events',Number(el.dataset.deleteEvent)));
 document.querySelectorAll('[data-delete-payment]').forEach(el=>el.onclick=()=>erase('payments',Number(el.dataset.deletePayment)));
}
async function reload(){state=await api('/api/financing');render()}
function fill(form,obj){for(const [k,v] of Object.entries(obj||{})){const f=form.elements.namedItem(k);if(f&&f.tagName!=='BUTTON')f.value=v??''}}
function openLoan(id=null){$('loanForm').reset();$('loanForm').elements.namedItem('id').value='';if(id)fill($('loanForm'),state.loans.find(x=>x.id===id));$('deleteLoan').hidden=!id;$('loanDialog').showModal()}
function openEquity(id=null){$('equityForm').reset();$('equityForm').elements.namedItem('id').value='';if(id)fill($('equityForm'),state.equity.find(x=>x.id===id));$('deleteEquity').hidden=!id;$('equityDialog').showModal()}
$('newLoan').onclick=()=>openLoan();$('newEquity').onclick=()=>openEquity();
$('closeLoan').onclick=()=>$('loanDialog').close();$('closeEquity').onclick=()=>$('equityDialog').close();
async function submitForm(event,form,base,dialog){event.preventDefault();let fields=payload(form),id=fields.id;delete fields.id;try{await api(base+(id?'/'+id:''),id?'PATCH':'POST',fields);dialog.close();await reload();message('Gespeichert.')}catch(err){message(err.message,true)}}
$('loanForm').onsubmit=e=>submitForm(e,$('loanForm'),'/api/financing/loans',$('loanDialog'));
$('equityForm').onsubmit=e=>submitForm(e,$('equityForm'),'/api/financing/equity',$('equityDialog'));
async function erase(path,id){if(!confirm('Diese Buchung wirklich entfernen? Die Summen werden entsprechend neu berechnet.'))return;try{await api('/api/financing/'+path+'/'+id,'DELETE');await reload();message('Buchung entfernt.')}catch(e){message(e.message,true)}}
$('deleteLoan').onclick=async()=>{const id=$('loanForm').elements.namedItem('id').value;if(!confirm('Kredit ohne verknüpfte Buchungen löschen?'))return;try{await api('/api/financing/loans/'+id,'DELETE');$('loanDialog').close();await reload()}catch(e){message(e.message,true)}};
$('deleteEquity').onclick=async()=>{const id=$('equityForm').elements.namedItem('id').value;if(!confirm('Eigenkapitalkonto ohne Buchungen löschen?'))return;try{await api('/api/financing/equity/'+id,'DELETE');$('equityDialog').close();await reload()}catch(e){message(e.message,true)}};
$('eventKind').onchange=fillOptions;$('paymentSource').onchange=fillOptions;
$('eventForm').onsubmit=async e=>{e.preventDefault();const v=payload(e.currentTarget),loan=v.kind.startsWith('loan_');v[loan?'loan_id':'equity_id']=$('eventSource').value;try{await api('/api/financing/events','POST',v);await reload();message('Geldbewegung gespeichert.')}catch(err){message(err.message,true)}};
$('paymentForm').onsubmit=async e=>{e.preventDefault();const v=payload(e.currentTarget);v[v.source==='loan'?'loan_id':'equity_id']=$('paymentAccount').value;try{await api('/api/financing/payments','POST',v);await reload();message('Zahlung zugeordnet. Die Kosten wurden nicht ein zweites Mal erfasst.')}catch(err){message(err.message,true)}};
async function backupStatus(){try{const s=await api('/api/backup/status');$('backupStatus').textContent=s.configured?`Backupordner: ${s.folder} · ${s.count} Sicherungen · Letztes Backup: ${s.latest||'noch keines'}`:`Noch kein erreichbarer Backupordner. Auf dem Mac einmalig sh mac/backup-setup.sh ausführen. ${s.error||''}`;$('backupButton').disabled=!s.configured;}catch(e){$('backupStatus').textContent=e.message;$('backupButton').disabled=true;}}
$('backupButton').onclick=async()=>{const btn=$('backupButton');btn.disabled=true;btn.textContent='Sicherung läuft …';try{const r=await api('/api/backup/create','POST',{});message('Vollständiges Backup erstellt und geprüft: '+r.filename);await backupStatus()}catch(e){message(e.message,true)}finally{btn.textContent='Jetzt vollständiges Backup erstellen';await backupStatus()}};
reload().catch(err=>message('Finanzierung nicht geladen: '+err.message,true));backupStatus();
