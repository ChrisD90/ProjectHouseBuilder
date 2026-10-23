'use strict';
const $=id=>document.getElementById(id);
const safe=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=value=>new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'}).format(Number(value)||0);
let selected=null,list=[],overview=null,categoryRecords=[];
const navigation=new URLSearchParams(window.location.search);
const linkOffer=Number(navigation.get('offer_id'))||null;
const linkReceipt=Number(navigation.get('receipt_id'))||null;
let linkedCostItem=null;
function renderCostItems(){
  const accepted=new Map((overview?.offers||[]).filter(o=>['Angenommen','Beauftragt'].includes(o.status)).map(o=>[o.id,o]));
  const itemList=overview?.items||[];
  const offered=itemList.filter(x=>x.offer_id&&accepted.has(x.offer_id)&&x.selected);
  $('costItems').innerHTML='<option value="">Angebot wählen</option>'+offered.map(x=>{
    const o=accepted.get(x.offer_id);
    return `<option value="${x.id}">${safe(o.vendor)} · ${safe(o.number||'ohne Nummer')} · ${money(o.gross)}</option>`;
  }).join('');
  const contractors=overview?.contractors||[];
  $('receiptContractor').innerHTML='<option value="">Betrieb wählen</option>'+
    contractors.map(x=>`<option value="${x.id}">${safe(x.name)} · ${safe(x.trade||'Betrieb')}</option>`).join('');
  linkedCostItem=offered.find(x=>x.offer_id===linkOffer)?.id||null;
}
function updateInvoiceControls(){
 const mode=$('receiptAssignmentType').value;
 const frozen=$('book').hidden;
 $('receiptOfferWrap').hidden=mode!=='Angebot'&&mode!=='Kostenposition';
 $('receiptContractorWrap').hidden=mode!=='Betrieb';
 $('receiptContractorHint').hidden=mode!=='Betrieb';
 $('costItems').disabled=frozen||(mode!=='Angebot'&&mode!=='Kostenposition');
 $('receiptContractor').disabled=frozen||mode!=='Betrieb';
 $('receiptAssignmentType').disabled=frozen;
 const cost=overview?.items?.find(x=>x.id===Number($('costItems').value));
 const offer=(overview?.offers||[]).find(o=>o.id===cost?.offer_id);
 const isAccepted=mode==='Angebot'&&!!(offer&&['Angenommen','Beauftragt'].includes(offer.status));
 if(isAccepted&&!frozen){
   $('budgetLines').value=cost.budget_line_id||'';
   $('categories').value=cost.category;
 }
 $('budgetLines').disabled=isAccepted||frozen;
 $('advanceDeduction').disabled=frozen||$('billingType').value!=='Schlussrechnung'||!isAccepted;
 $('deductionHint').hidden=$('billingType').value!=='Schlussrechnung';
 const hint=$('billableHint');
 hint.textContent=isAccepted
   ? `Mit dem angenommenen Angebot „${offer.vendor}“ verknüpft. Abschläge und Schlussrechnung werden zum Vertragsbetrag von ${money(offer.gross)} addiert, ohne verrechnete Abschläge doppelt zu zählen.`
   : mode==='Betrieb'?'Direkt einem Betrieb zugeordnet; keine automatische Verknüpfung zu einem Angebot. Die Rechnung wird nur einmal als Ausgabe berücksichtigt.'
   : mode==='Eigenleistung'?'Eigenleistung/Material: Keine Verknüpfung zu einem Handwerker oder Angebot. Falls vorhanden, die passende Budgetposition auswählen.'
   : mode==='Kostenposition'?'Historische Kostenpositionszuordnung. Für Änderungen kann ein regulärer Zuordnungstyp ausgewählt werden.'
   : 'Wähle Angebot, Betrieb oder Eigenleistung. Nur angenommene Angebote erscheinen in der Angebotsauswahl.';
}
$('receiptAssignmentType').addEventListener('change',()=>{
  if($('receiptAssignmentType').value!=='Angebot'&&$('receiptAssignmentType').value!=='Kostenposition')$('costItems').value='';
  if($('receiptAssignmentType').value!=='Betrieb')$('receiptContractor').value='';
  updateInvoiceControls();
});
$('costItems').addEventListener('change',updateInvoiceControls);
$('billingType').addEventListener('change',()=>{if($('billingType').value!=='Schlussrechnung')$('advanceDeduction').value='0';updateInvoiceControls();});
$('receiptAnalysisMode').addEventListener('change',()=>{
 const ai=$('receiptAnalysisMode').value==='ai';
 $('receiptAIHint').hidden=!ai;
 $('receiptUploadButton').textContent=ai?'Mit ChatGPT analysieren':'Datei lokal analysieren';
});

async function api(path,opts={}){const res=await fetch(path,opts);let data=await res.json();if(!res.ok)throw new Error(data.error||'Anfrage fehlgeschlagen');return data}
function notice(msg,err=false){$('message').textContent=msg;$('message').classList.toggle('error',err)}
function inputs(){
 const result=Object.fromEntries(new FormData($('review')));
 const mode=$('receiptAssignmentType').value;
 if(!mode)throw Error('Bitte die Rechnung einem Angebot, Betrieb oder der Eigenleistung zuordnen.');
 if(mode==='Angebot'&&!$('costItems').value)throw Error('Bitte ein angenommenes Angebot auswählen.');
 if(mode==='Betrieb'&&!$('receiptContractor').value)throw Error('Bitte einen Betrieb auswählen.');
 result.assignment_type=mode;
 result.cost_item_id=(mode==='Angebot'||mode==='Kostenposition')?$('costItems').value:null;
 result.contractor_id=mode==='Betrieb'?$('receiptContractor').value:null;
 return result;
}
function fillSelect(node,values,getTitle){node.innerHTML='<option value="">Keine Zuordnung</option>'+values.map(x=>`<option value="${x.id}">${safe(getTitle(x))}</option>`).join('')}
async function reload(keepId=selected){
 const [r,c,cat]=await Promise.all([api('/api/receipts'),api('/api/costs'),api('/api/categories')]);overview=c;list=r.receipts;categoryRecords=cat.categories;renderCategoryManager();
 $('stats').innerHTML=`<span>Entwürfe: <b>${r.drafts}</b></span><span>Gebucht brutto: <b>${money(r.booked_gross)}</b></span><span>Bezahlt: <b>${money(r.paid)}</b></span>`;
 $('categories').innerHTML=r.categories.map(x=>`<option value="${safe(x)}">${safe(x)}</option>`).join('');
 fillSelect($('budgetLines'),c.budget_lines.filter(x=>x.active&&!x.is_group),x=>x.category+' · '+x.title);
 renderCostItems();
 $('list').innerHTML=list.map(x=>`<button type="button" data-id="${x.id}" class="entry ${keepId===x.id?'active':''}"><span class="status ${x.status==='Gebucht'?'booked':''}">${safe(x.status)}</span><strong>${safe(x.supplier||x.filename)}</strong><small>${safe(x.document_date||'Ohne Datum')} · ${money(x.counted_amount)} neu abgerechnet · ${safe(x.category)}</small></button>`).join('')||'<p>Du hast noch keine Belege erfasst.</p>';
 document.querySelectorAll('.entry').forEach(b=>b.onclick=()=>open(Number(b.dataset.id)));
 if(keepId&&list.some(x=>x.id===keepId))await open(keepId);
 else if(linkReceipt&&list.some(x=>x.id===linkReceipt))await open(linkReceipt);
 else if(!list.length){$('review').hidden=true;$('placeholder').hidden=false;}
 if(linkOffer&&!selected){$('uploadStatus').textContent='Angebot ausgewählt: Lade die Rechnung hoch und prüfe danach die Verknüpfung im Entwurf.';}
}
async function open(id){
 try{let x=await api('/api/receipts/'+id);selected=id;document.querySelectorAll('.entry').forEach(b=>b.classList.toggle('active',Number(b.dataset.id)===id));
 $('review').hidden=false;$('placeholder').hidden=true;$('editorTitle').textContent=x.filename;
 const legacy=x.assignment_type==='Kostenposition';
 const legacyOption=$('receiptAssignmentType').querySelector('option[value="Kostenposition"]');
 if(legacyOption)legacyOption.remove();
 if(legacy){
   $('receiptAssignmentType').add(new Option('Bisherige Kostenposition (Bestand)','Kostenposition'));
   if(x.cost_item_id&&!Array.from($('costItems').options).some(o=>o.value===String(x.cost_item_id))){
     const item=(overview?.items||[]).find(i=>i.id===x.cost_item_id);
     $('costItems').add(new Option(item?item.title:'Bisherige Kostenposition',String(x.cost_item_id)));
   }
 }
 for(let [k,v] of Object.entries(x)){const input=$('review').elements.namedItem(k);if(input&&v!==undefined)input.value=v??'';}
 $('receiptAssignmentType').value=x.assignment_type||'';
 $('book').hidden=x.status==='Gebucht';$('unbook').hidden=x.status!=='Gebucht';$('delete').hidden=x.status==='Gebucht';
 for(let node of $('review').querySelectorAll('input,select,textarea'))node.disabled=x.status==='Gebucht'&&node.name!=='notes'&&node.name!=='paid_amount'&&node.name!=='due_date';
 if(linkedCostItem&&x.status==='Entwurf'&&!x.cost_item_id&&!x.assignment_type){
   $('receiptAssignmentType').value='Angebot';
   $('costItems').value=String(linkedCostItem);
 }
 updateInvoiceControls();
 $('original').href='/api/receipts/'+id+'/download';$('raw').textContent=x.ocr_text||'Keine Textdaten erkannt. Manuelle Eingabe erforderlich.';
 $('rawDetails').hidden=!x.ocr_text; $('warnings').textContent=(x.warnings||[]).join(' · ');notice(x.status==='Gebucht'?'Gebucht: Für Betragsänderungen zuerst Buchung zurücknehmen.':'Bitte Daten prüfen, dann speichern und buchen.');
 }catch(e){notice(e.message,true)}
}
$('upload').onsubmit=async e=>{
 e.preventDefault();
 const ai=$('receiptAnalysisMode').value==='ai';
 let permission=null;
 try{
   if(ai){
     permission=window.PHBAI?.selection();
     if(!permission)throw Error('Bitte zuerst mit ChatGPT verbinden.');
   }
 }catch(error){$('uploadStatus').textContent=error.message;return;}
 $('uploadStatus').textContent=ai?'ChatGPT analysiert die Datei. Es wird noch nichts gebucht …':'PDF / Bild wird lokal analysiert …';
 const b=$('receiptUploadButton');b.disabled=true;
 try{
   const form=new FormData($('upload'));
   if(ai){
     form.set('model',permission.model);
     form.set('plan_only','true');
   }
   const r=await fetch('/api/receipts',{method:'POST',headers:ai?{'X-PHB-AI':'1'}:{},body:form});
   const data=await r.json();
   if(!r.ok)throw new Error(data.error||'Upload fehlgeschlagen');
   $('upload').reset();
   $('receiptAIHint').hidden=true;
   b.textContent='Datei lokal analysieren';
   $('uploadStatus').textContent=(ai?'ChatGPT-Vorschlag':'Lokale Erkennung')+' gespeichert. Bitte alle erkannten Angaben kontrollieren.';
   await reload(data.id);
 }catch(error){$('uploadStatus').textContent=error.message}
 finally{b.disabled=false}
};
$('review').onsubmit=async e=>{e.preventDefault();if(!selected)return;try{await api('/api/receipts/'+selected,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(inputs())});await reload(selected);notice('Änderungen gespeichert. Noch nicht automatisch gebucht.')}catch(err){notice(err.message,true)}};
$('book').onclick=async()=>{if(!selected)return;try{await api('/api/receipts/'+selected,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(inputs())});if(!confirm('Beleg verbindlich in die Kostenübersicht übernehmen? Noch nicht bezahlte Rechnungen bleiben offen.'))return;await api('/api/receipts/'+selected+'/book',{method:'POST'});await reload(selected);notice('Beleg wurde übernommen.')}catch(err){notice(err.message,true)}};
$('unbook').onclick=async()=>{if(!selected||!confirm('Buchung zurücknehmen? Die Belegausgaben werden aus der Übersicht entfernt.'))return;try{await api('/api/receipts/'+selected+'/unbook',{method:'POST'});await reload(selected)}catch(err){notice(err.message,true)}};
$('delete').onclick=async()=>{if(!selected||!confirm('Diesen Entwurf einschließlich Originaldatei dauerhaft löschen?'))return;try{await api('/api/receipts/'+selected,{method:'DELETE'});selected=null;await reload(null)}catch(err){notice(err.message,true)}};

function renderCategoryManager(){
 $('categoryManage').innerHTML=categoryRecords.map(x=>`<div class="category-row" data-cat="${x.id}"><span>${safe(x.name)}</span><button type="button" class="neutral" data-action="rename">Umbenennen</button><button type="button" class="danger" data-action="delete" ${x.name==='Sonstiges'?'disabled':''}>Löschen</button></div>`).join('');
 $('categoryManage').querySelectorAll('button').forEach(button=>button.onclick=async()=>{
  const id=Number(button.closest('[data-cat]').dataset.cat),item=categoryRecords.find(x=>x.id===id);
  if(!item)return;
  try{
   if(button.dataset.action==='rename'){
     const name=prompt('Neuer Kategoriename:',item.name);
     if(name===null||name.trim()===item.name)return;
     await api('/api/categories/'+id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name.trim()})});
   }else{
     if(!confirm('Kategorie '+item.name+' endgültig löschen? Dies ist nur möglich, wenn sie nicht verwendet wird.'))return;
     await api('/api/categories/'+id,{method:'DELETE'});
   }
   $('categoryMessage').textContent='Kategorie aktualisiert.';await reload(selected);
  }catch(e){$('categoryMessage').textContent=e.message;}
 });
}
$('categoryCreate').onsubmit=async e=>{e.preventDefault();try{
 const name=$('categoryNew').value.trim();await api('/api/categories',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})});
 $('categoryNew').value='';$('categoryMessage').textContent='Kategorie hinzugefügt.';await reload(selected);
 }catch(err){$('categoryMessage').textContent=err.message;}};

reload().catch(e=>notice(e.message,true));
