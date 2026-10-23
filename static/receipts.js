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
  const other=itemList.filter(x=>!x.offer_id&&!['Alternative','Abgelehnt'].includes(x.state));
  $('costItems').innerHTML='<option value="">Keine Zuordnung</option>'+(
    offered.length?'<optgroup label="Angenommene Angebote">'+offered.map(x=>{
      const o=accepted.get(x.offer_id);return `<option value="${x.id}">${safe(o.vendor)} · ${safe(o.number||'ohne Nummer')} · ${money(o.gross)}</option>`;
    }).join('')+'</optgroup>':'')+(
    other.length?'<optgroup label="Sonstige Kostenpositionen (ohne Angebot)">'+other.map(x=>`<option value="${x.id}">${safe(x.category)} · ${safe(x.title)}</option>`).join('')+'</optgroup>':'');
  linkedCostItem=offered.find(x=>x.offer_id===linkOffer)?.id||null;
}
function updateInvoiceControls(){
 const cost=overview?.items?.find(x=>x.id===Number($('costItems').value));
 const offer=(overview?.offers||[]).find(o=>o.id===cost?.offer_id);
 const isAccepted=!!(offer&&['Angenommen','Beauftragt'].includes(offer.status));
 if(isAccepted){
   $('budgetLines').value=cost.budget_line_id||'';
   $('categories').value=cost.category;
 }
 $('budgetLines').disabled=isAccepted||$('book').hidden;
 $('advanceDeduction').disabled=$('book').hidden||$('billingType').value!=='Schlussrechnung'||!isAccepted;
 $('deductionHint').hidden=$('billingType').value!=='Schlussrechnung';
 const hint=$('billableHint');
 hint.textContent=isAccepted
   ? `Mit dem angenommenen Angebot „${offer.vendor}“ verknüpft. Abschläge und Schlussrechnung werden zum Vertragsbetrag von ${money(offer.gross)} addiert, ohne verrechnete Abschläge doppelt zu zählen.`
   : 'Für die Abrechnung eines Angebots muss oben ein angenommenes Angebot ausgewählt werden. Nur angenommene Angebote sind hier auswählbar.';
}
$('costItems').addEventListener('change',updateInvoiceControls);
$('billingType').addEventListener('change',()=>{if($('billingType').value!=='Schlussrechnung')$('advanceDeduction').value='0';updateInvoiceControls();});

async function api(path,opts={}){const res=await fetch(path,opts);let data=await res.json();if(!res.ok)throw new Error(data.error||'Anfrage fehlgeschlagen');return data}
function notice(msg,err=false){$('message').textContent=msg;$('message').classList.toggle('error',err)}
function inputs(){return Object.fromEntries(new FormData($('review')))}
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
 for(let [k,v] of Object.entries(x)){const input=$('review').elements.namedItem(k);if(input&&v!==undefined)input.value=v??'';}
 $('book').hidden=x.status==='Gebucht';$('unbook').hidden=x.status!=='Gebucht';$('delete').hidden=x.status==='Gebucht';
 for(let node of $('review').querySelectorAll('input,select,textarea'))node.disabled=x.status==='Gebucht'&&node.name!=='notes'&&node.name!=='paid_amount'&&node.name!=='due_date';
 if(linkedCostItem && x.status==='Entwurf' && !x.cost_item_id){$('costItems').value=String(linkedCostItem);}
 updateInvoiceControls();
 $('original').href='/api/receipts/'+id+'/download';$('raw').textContent=x.ocr_text||'Keine Textdaten erkannt. Manuelle Eingabe erforderlich.';
 $('rawDetails').hidden=!x.ocr_text; $('warnings').textContent=(x.warnings||[]).join(' · ');notice(x.status==='Gebucht'?'Gebucht: Für Betragsänderungen zuerst Buchung zurücknehmen.':'Bitte Daten prüfen, dann speichern und buchen.');
 }catch(e){notice(e.message,true)}
}
$('upload').onsubmit=async e=>{e.preventDefault();$('uploadStatus').textContent='PDF / Bild wird lokal analysiert …';const b=$('upload').querySelector('button');b.disabled=true;
 try{const r=await fetch('/api/receipts',{method:'POST',body:new FormData($('upload'))});const data=await r.json();if(!r.ok)throw new Error(data.error||'Upload fehlgeschlagen');$('upload').reset();$('uploadStatus').textContent='Beleg gespeichert. Bitte Erkennung kontrollieren.';await reload(data.id)}catch(error){$('uploadStatus').textContent=error.message}finally{b.disabled=false}};
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
