'use strict';
/* Separate steps: import -> editable draft -> listed quote -> accepted/rejected.
   Reading or listing PDF data never commits costs. */
window.renderOffers=function renderOffers(){
 const drafts=document.getElementById('offerDrafts'), list=document.getElementById('offerList');
 if(!drafts || !list || typeof state==='undefined')return;
 const offers=state.offers||[];
 const categories=state.offer_categories||[];
 const budgets=(state.budget_lines||[]).filter(b=>b.active&&!b.is_group);
 const money=n=>n==null?'Noch nicht erkannt':new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'}).format(n);
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const pick=(choices,value,empty)=> (empty?`<option value="">${esc(empty)}</option>`:'')+choices.map(c=>`<option value="${esc(c.value)}" ${String(c.value)===String(value??'')?'selected':''}>${esc(c.label)}</option>`).join('');
 const cats=value=>pick(categories.map(x=>({value:x,label:x})),value);
 const lines=value=>pick(budgets.map(x=>({value:x.id,label:x.category+' · '+x.title})),value,'Keine (zusätzliche Kostenposition)');
 const pdf=o=>o.document_id?`<a class="subtle" href="/api/documents/${o.document_id}/download" target="_blank" rel="noopener">Original-PDF ansehen</a>`:'Original-PDF nicht verknüpft';
 const details=o=>{
   const positions=o.positions||[];
   return positions.length?`<details class="offer-details"><summary>Erkannte Einzelpositionen (${positions.length}, nur zur Information)</summary><div class="tablewrap"><table><thead><tr><th>Pos.</th><th>Beschreibung</th><th>Menge</th><th>Netto</th></tr></thead><tbody>${positions.map(x=>`<tr><td>${esc(x.number)}</td><td>${esc(x.description)}</td><td>${esc(x.quantity)} ${esc(x.unit)}</td><td>${money(x.net_amount)}</td></tr>`).join('')}</tbody></table></div></details>`:'';
 };
 const notices=o=>(o.warnings||[]).length?`<details class="offer-warnings"><summary>Hinweise aus der PDF-Analyse (${o.warnings.length})</summary><ul>${o.warnings.map(w=>`<li>${esc(w)}</li>`).join('')}</ul></details>`:'';
 const renderEditable=(o,isDraft)=>`<article class="offer-card" data-offer-card="${o.id}">
   <div class="offer-card-head"><div><h3>${esc(isDraft?'Entwurf':'Angebot')} · ${esc(o.filename)}</h3><p class="muted">${pdf(o)} · Bruttobetrag wird vor der Übernahme geprüft</p></div><span class="offer-stage ${isDraft?'stage-draft':'stage-listed'}">${esc(o.status)}</span></div>
   ${notices(o)}
   <form class="offer-review-form" data-offer-review="${o.id}">
     <label>Firma / Anbieter <input name="vendor" maxlength="200" value="${esc(o.vendor==='Firma nicht erkannt'?'':o.vendor)}" required></label>
     <label>Angebotsnummer <input name="number" maxlength="100" value="${esc(o.number)}"></label>
     <label>Datum laut Angebot <input name="issued" maxlength="20" value="${esc(o.issued)}" placeholder="z. B. 22.10.2026"></label>
     <label>Gültig bis <input name="expires" maxlength="20" value="${esc(o.expires)}"></label>
     <label>Netto € <input name="net" inputmode="decimal" value="${o.net==null?'':esc(o.net)}" placeholder="Optional"></label>
     <label>MwSt. € <input name="vat" inputmode="decimal" value="${o.vat==null?'':esc(o.vat)}" placeholder="Optional"></label>
     <label>Bruttogesamtbetrag € <input name="gross" inputmode="decimal" value="${o.gross==null?'':esc(o.gross)}" placeholder="Bitte prüfen" required></label>
     <label>Kategorie / Gewerk <select name="category">${cats(o.category)}</select></label>
     <label class="wide">Kostenplanposition <select name="budget_line_id">${lines(o.budget_line_id)}</select></label>
     <label class="wide">Notiz <textarea name="notes" rows="2" maxlength="2000">${esc(o.notes)}</textarea></label>
     <div class="offer-form-actions"><button type="submit" class="mini">Änderungen speichern</button>
       ${isDraft?`<button type="button" class="primary" data-offer-promote="${o.id}">In Angebotsliste übernehmen</button>`:`<button type="button" class="mini" data-offer-accept="${o.id}">Angebot annehmen</button><button type="button" class="mini" data-offer-reject="${o.id}">Ablehnen</button>`}
       <button type="button" class="mini" data-offer-delete="${o.id}">Auswertung entfernen</button></div>
   </form>${details(o)}
 </article>`;
 const draftOffers=offers.filter(o=>o.status==='Entwurf');
 drafts.innerHTML=draftOffers.length?draftOffers.map(o=>renderEditable(o,true)).join(''):'<p class="muted">Keine offenen Entwürfe. Beim PDF-Upload entsteht automatisch ein bearbeitbarer Entwurf.</p>';
 const listed=offers.filter(o=>o.status!=='Entwurf');
 const filters=document.getElementById('offerCategoryFilter');
 const previous=filters.value;
 filters.innerHTML='<option value="">Alle Kategorien</option>'+categories.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('');
 filters.value=categories.includes(previous)?previous:'';
 const available=listed.filter(o=>!filters.value||o.category===filters.value);
 const sorter=[...available].sort((a,b)=>a.category.localeCompare(b.category,'de') || (a.gross??Infinity)-(b.gross??Infinity));
 list.innerHTML=sorter.length?sorter.map(o=>{
   const status=o.status;
   const accepted=['Angenommen','Beauftragt'].includes(status);
   return `<article class="offer-card offer-list-card"><div class="offer-card-head"><div><h3>${esc(o.vendor)} <span class="offer-number">${esc(o.number)}</span></h3><div class="muted">${esc(o.category)} · ${esc(o.issued||'Ohne Datum')} · ${pdf(o)}</div></div><div><strong>${money(o.gross)}</strong><span class="offer-stage ${accepted?'stage-accepted':status==='Abgelehnt'?'stage-rejected':'stage-listed'}">${esc(status)}</span></div></div>
   <div class="offer-facts"><span>Netto: ${money(o.net)}</span><span>Zuordnung: ${esc(budgets.find(x=>x.id===o.budget_line_id)?.title||'Zusätzliche Position')}</span><span>Gültig bis: ${esc(o.expires||'–')}</span></div>
   ${o.notes?`<p>${esc(o.notes)}</p>`:''}${notices(o)}
   <div class="offer-form-actions">
    ${accepted?`<button class="mini" data-offer-unaccept="${o.id}">Annahme zurücknehmen</button>`:`<button class="mini" data-offer-edit="${o.id}">Angaben bearbeiten</button><button class="primary" data-offer-accept="${o.id}">Annehmen → Kosten übernehmen</button>${status!=='Abgelehnt'?`<button class="mini" data-offer-reject="${o.id}">Ablehnen</button>`:`<button class="mini" data-offer-relist="${o.id}">Wieder berücksichtigen</button>`}`}
   </div>
   <div data-offer-inline-edit="${o.id}" class="offer-inline-edit" hidden></div>
   ${details(o)}
   </article>`;
 }).join(''):'<p class="muted">Noch keine passenden Angebote. Übernimm zuerst einen geprüften Entwurf.</p>';
 // Handler for drafts and inline edit panels.
 async function save(form){
  const id=form.dataset.offerReview;
  const body=Object.fromEntries(new FormData(form));
  await send(`/api/offers/${id}/draft`,body);
 }
 async function send(url,body,method='PATCH'){
  const resp=await fetch(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await resp.json();
  if(!resp.ok)throw Error(data.error||'Änderung nicht möglich');
  await reload();return data;
 }
 document.querySelectorAll('[data-offer-review]').forEach(form=>form.addEventListener('submit',async e=>{
  e.preventDefault();try{await save(form)}catch(err){alert(err.message)}
 }));
 document.querySelectorAll('[data-offer-promote]').forEach(btn=>btn.addEventListener('click',async()=>{
  const form=btn.closest('form');
  try{
   const body=Object.fromEntries(new FormData(form));
   const response=await fetch(`/api/offers/${btn.dataset.offerPromote}/draft`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   const data=await response.json();if(!response.ok)throw Error(data.error||'Entwurf konnte nicht gespeichert werden.');
   await send(`/api/offers/${btn.dataset.offerPromote}`,{status:'Angebot'});
   document.getElementById('offerList').scrollIntoView({behavior:'smooth',block:'start'});
  }catch(err){alert(err.message)}
 }));
 document.querySelectorAll('[data-offer-accept]').forEach(btn=>btn.addEventListener('click',async()=>{
  if(!confirm('Angebot verbindlich annehmen? Die Bruttogesamtsumme wird jetzt genau einmal als beauftragt in die Kostenprognose übernommen.'))return;
  try{await send('/api/offers/'+btn.dataset.offerAccept,{status:'Angenommen'})}catch(e){alert(e.message)}
 }));
 document.querySelectorAll('[data-offer-reject]').forEach(btn=>btn.addEventListener('click',async()=>{
  try{await send('/api/offers/'+btn.dataset.offerReject,{status:'Abgelehnt'})}catch(e){alert(e.message)}
 }));
 document.querySelectorAll('[data-offer-relist]').forEach(btn=>btn.addEventListener('click',async()=>{
  try{await send('/api/offers/'+btn.dataset.offerRelist,{status:'Angebot'})}catch(e){alert(e.message)}
 }));
 document.querySelectorAll('[data-offer-unaccept]').forEach(btn=>btn.addEventListener('click',async()=>{
  if(!confirm('Annahme zurücknehmen? Der Auftrag wird aus den beauftragten Kosten entfernt, sofern noch keine Zahlungen oder Belege verknüpft sind.'))return;
  try{await send('/api/offers/'+btn.dataset.offerUnaccept,{status:'Angebot'})}catch(e){alert(e.message)}
 }));
 document.querySelectorAll('[data-offer-delete]').forEach(btn=>btn.addEventListener('click',async()=>{
  if(!confirm('Analyse entfernen? Das Original-PDF bleibt unter Dokumente archiviert.'))return;
  try{const r=await fetch('/api/offers/'+btn.dataset.offerDelete,{method:'DELETE'});const d=await r.json();if(!r.ok)throw Error(d.error||'Löschen fehlgeschlagen.');await reload()}catch(e){alert(e.message)}
 }));
 document.querySelectorAll('[data-offer-edit]').forEach(btn=>btn.addEventListener('click',()=>{
  const panel=document.querySelector(`[data-offer-inline-edit="${btn.dataset.offerEdit}"]`);
  const offer=offers.find(x=>x.id===Number(btn.dataset.offerEdit));
  if(!offer)return;
  panel.innerHTML=renderEditable(offer,false);
  panel.hidden=false;
  // Avoid duplicating nested form handler; bind edit controls locally.
  const form=panel.querySelector('form');
  form.addEventListener('submit',async e=>{e.preventDefault();try{await save(form)}catch(err){alert(err.message)}});
  form.querySelector('[data-offer-accept]').addEventListener('click',async()=>{
   try{await saveWithoutReload(form);if(confirm('Annehmen und als Kosten übernehmen?'))await send('/api/offers/'+offer.id,{status:'Angenommen'})}catch(e){alert(e.message)}
  });
  form.querySelector('[data-offer-reject]').addEventListener('click',async()=>{
   try{await send('/api/offers/'+offer.id,{status:'Abgelehnt'})}catch(e){alert(e.message)}
  });
  form.querySelector('[data-offer-delete]').addEventListener('click',()=>alert('Zum Entfernen bitte zuerst den Status überprüfen.'));
 }));
 async function saveWithoutReload(form){
  const body=Object.fromEntries(new FormData(form));
  const r=await fetch('/api/offers/'+form.dataset.offerReview+'/draft',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await r.json();if(!r.ok)throw Error(data.error||'Speichern fehlgeschlagen');
 }
};
const offerForm=document.getElementById('offerImportForm');
if(offerForm)offerForm.addEventListener('submit',async event=>{
 event.preventDefault();const msg=document.getElementById('offerImportStatus');msg.textContent='PDF wird lokal analysiert …';
 try{const r=await fetch('/api/offers/import',{method:'POST',body:new FormData(offerForm)});
  const d=await r.json();if(!r.ok)throw Error(d.error||'Upload fehlgeschlagen');
  msg.textContent='Entwurf angelegt. Bitte Firma, Betrag und Kategorie prüfen.';
  offerForm.reset();await reload();document.getElementById('offerDrafts').scrollIntoView({behavior:'smooth',block:'start'});
 }catch(e){msg.textContent='Fehler: '+e.message}
});
const filter=document.getElementById('offerCategoryFilter');
if(filter)filter.addEventListener('change',()=>window.renderOffers());
