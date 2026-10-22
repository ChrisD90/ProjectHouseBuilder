'use strict';
const $=id=>document.getElementById(id);
const safe=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=value=>new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'}).format(Number(value)||0);
let selected=null,list=[],overview=null,categoryRecords=[];
async function api(path,opts={}){const res=await fetch(path,opts);let data=await res.json();if(!res.ok)throw new Error(data.error||'Anfrage fehlgeschlagen');return data}
function notice(msg,err=false){$('message').textContent=msg;$('message').classList.toggle('error',err)}
function inputs(){return Object.fromEntries(new FormData($('review')))}
function fillSelect(node,values,getTitle){node.innerHTML='<option value="">Keine Zuordnung</option>'+values.map(x=>`<option value="${x.id}">${safe(getTitle(x))}</option>`).join('')}
async function reload(keepId=selected){
 const [r,c,cat]=await Promise.all([api('/api/receipts'),api('/api/costs'),api('/api/categories')]);overview=c;list=r.receipts;categoryRecords=cat.categories;renderCategoryManager();
 $('stats').innerHTML=`<span>Entwürfe: <b>${r.drafts}</b></span><span>Gebucht brutto: <b>${money(r.booked_gross)}</b></span><span>Bezahlt: <b>${money(r.paid)}</b></span>`;
 $('categories').innerHTML=r.categories.map(x=>`<option value="${safe(x)}">${safe(x)}</option>`).join('');
 fillSelect($('budgetLines'),c.budget_lines.filter(x=>x.active&&!x.is_group),x=>x.category+' · '+x.title);
 fillSelect($('costItems'),c.items.filter(x=>!['Alternative','Abgelehnt'].includes(x.state)),x=>x.category+' · '+x.title);
 $('list').innerHTML=list.map(x=>`<button type="button" data-id="${x.id}" class="entry ${keepId===x.id?'active':''}"><span class="status ${x.status==='Gebucht'?'booked':''}">${safe(x.status)}</span><strong>${safe(x.supplier||x.filename)}</strong><small>${safe(x.document_date||'Ohne Datum')} · ${money(x.gross_amount)} · ${safe(x.category)}</small></button>`).join('')||'<p>Du hast noch keine Belege erfasst.</p>';
 document.querySelectorAll('.entry').forEach(b=>b.onclick=()=>open(Number(b.dataset.id)));
 if(keepId&&list.some(x=>x.id===keepId))await open(keepId);else if(!list.length){$('review').hidden=true;$('placeholder').hidden=false;}
}
async function open(id){
 try{let x=await api('/api/receipts/'+id);selected=id;document.querySelectorAll('.entry').forEach(b=>b.classList.toggle('active',Number(b.dataset.id)===id));
 $('review').hidden=false;$('placeholder').hidden=true;$('editorTitle').textContent=x.filename;
 for(let [k,v] of Object.entries(x)){const input=$('review').elements.namedItem(k);if(input&&v!==undefined)input.value=v??'';}
 $('book').hidden=x.status==='Gebucht';$('unbook').hidden=x.status!=='Gebucht';$('delete').hidden=x.status==='Gebucht';
 for(let node of $('review').querySelectorAll('input,select,textarea'))node.disabled=x.status==='Gebucht'&&node.name!=='notes'&&node.name!=='paid_amount'&&node.name!=='due_date';
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
