'use strict';
// Offers are parsed and stored locally. No imported section affects the forecast
// until an explicit checkbox has been activated by the user.
window.renderOffers = function renderOffers(){
 const host=document.getElementById('offerCards');
 if(!host || typeof state==='undefined')return;
 const offers=state.offers||[];
 const budgets=(state.budget_lines||[]).filter(x=>!x.is_group && x.active);
 const euros=x=>new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'}).format(x||0);
 const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 if(!offers.length){host.innerHTML='<p class="muted">Noch keine PDF-Angebote erfasst. Oben kannst du ein Angebot importieren.</p>';return}
 host.innerHTML=offers.map(o=>{
  const chosen=(o.sections||[]).filter(g=>g.selected);
  const opt=o.positions.filter(x=>x.optional);
  const money=opt.reduce((a,p)=>a+(p.optional_amount||0),0);
  const notices=o.warnings.map(w=>`<li>${escape(w)}</li>`).join('');
  const sections=o.sections.map(g=>`<tr class="${g.selected?'offer-selected':''}"><td><input aria-label="Leistungsgruppe in Prognose aufnehmen" type="checkbox" data-offer-section="${g.id}" ${g.selected?'checked':''} ${!o.reconciled || ['Angenommen','Beauftragt'].includes(o.status)?'disabled':''}></td><td>${escape(g.name)}</td><td class="amount">${euros(g.net)}</td><td class="amount"><strong>${euros(g.gross)}</strong></td><td><select data-offer-budget="${g.id}" aria-label="Kostenplanposition für ${escape(g.name)}"><option value="">Bitte zuordnen</option>${budgets.map(b=>`<option value="${b.id}" ${g.budget_line_id===b.id?'selected':''}>${escape(b.category+' – '+b.title)} (${euros(b.estimate)})</option>`).join('')}</select></td></tr>`).join('');
  const positions=o.positions.map(p=>`<tr class="${p.optional?'offer-optional':''}"><td>${escape(p.number)}</td><td>${escape(p.section)}</td><td>${escape(p.description)}</td><td>${escape(p.quantity)} ${escape(p.unit)}</td><td class="amount">${p.unit_price==null?'–':euros(p.unit_price)}</td><td class="amount">${p.optional?`<span class="hint-pill">Optional / E.P. ${p.optional_amount!=null?euros(p.optional_amount):''}</span>`:euros(p.net_amount)}</td><td>PDF S. ${escape(p.page)}</td></tr>`).join('');
  return `<article class="offer-card"><div class="offer-card-head"><div><h3>${escape(o.vendor)} <span class="offer-number">${escape(o.number)}</span></h3><div class="muted">${escape(o.filename)} · ${escape(o.issued||'Datum unbekannt')} ${o.expires?' · gültig bis '+escape(o.expires):''}</div></div><div><strong>${euros(o.gross)}</strong><div class="${o.reconciled?'offer-ok':'offer-danger'}">${o.reconciled?'✓ Summen geprüft':'! Prüfung erforderlich'}</div></div></div>
  <div class="offer-facts"><span>Netto: <b>${euros(o.net)}</b></span><span>Steuer: <b>${euros(o.vat)}</b></span><span>Positionen: <b>${o.positions.length}</b></span><span>Optional: <b>${opt.length}${money?' / '+euros(money):''}</b></span><span>In Kosten berücksichtigt: <b>${chosen.length} Gruppen</b></span></div>
  ${notices?`<div class="offer-warnings"><b>Hinweise:</b><ul>${notices}</ul></div>`:''}
  <div class="offer-status-row"><label>Auftragsstatus <select data-offer-status="${o.id}"><option value="Angebot" ${o.status==='Angebot'?'selected':''}>Nur Angebot</option><option value="Angenommen" ${['Angenommen','Beauftragt'].includes(o.status)?'selected':''}>Angenommen – in Kosten übernehmen</option></select></label><span class="muted">Angenommen = kompletter Angebotspreis zählt als beauftragt; optionale Positionen bleiben außen vor.</span><button type="button" class="mini" data-offer-delete="${o.id}">Auswertung entfernen</button>${o.document_id?`<a class="subtle" href="/api/documents/${o.document_id}/download">Original-PDF</a>`:''}</div>
  <div class="tablewrap"><table class="offer-table"><thead><tr><th>Prognose</th><th>Leistungsgruppe</th><th>Netto</th><th>Brutto</th><th>Kostenplan-Zuordnung</th></tr></thead><tbody>${sections}</tbody></table></div>
  <details class="offer-details"><summary>Alle ${o.positions.length} Angebotspositionen anzeigen</summary><div class="tablewrap"><table><thead><tr><th>Pos.</th><th>Gruppe</th><th>Beschreibung</th><th>Menge</th><th>Einzelpreis netto</th><th>Gesamt netto</th><th>Quelle</th></tr></thead><tbody>${positions}</tbody></table></div></details></article>`;
 }).join('');
 const send=async(url,body,method='PATCH')=>{
   const response=await fetch(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   const json=await response.json();if(!response.ok)throw Error(json.error||'Änderung nicht möglich');await reload();
 };
 host.querySelectorAll('[data-offer-section]').forEach(box=>box.onchange=async()=>{
  try{await send('/api/offer-sections/'+box.dataset.offerSection,{selected:box.checked})}
  catch(e){alert(e.message);await reload()}
 });
 host.querySelectorAll('[data-offer-budget]').forEach(select=>select.onchange=async()=>{
  try{await send('/api/offer-sections/'+select.dataset.offerBudget,{budget_line_id:select.value||null})}
  catch(e){alert(e.message);await reload()}
 });
 host.querySelectorAll('[data-offer-status]').forEach(select=>select.onchange=async()=>{
  if(select.value==='Angenommen' && !confirm('Angebot annehmen? Alle regulären Leistungsgruppen werden in die Kostenprognose übernommen. Nicht zugeordnete Gruppen zählen zusätzlich.')){await reload();return}
  try{await send('/api/offers/'+select.dataset.offerStatus,{status:select.value})}
  catch(e){alert(e.message);await reload()}
 });
 host.querySelectorAll('[data-offer-delete]').forEach(button=>button.onclick=async()=>{
  if(!confirm('Auswertung entfernen? Die Original-PDF bleibt als Dokument erhalten.'))return;
  try{const response=await fetch('/api/offers/'+button.dataset.offerDelete,{method:'DELETE'});const d=await response.json();if(!response.ok)throw Error(d.error);await reload()}
  catch(e){alert(e.message)}
 });
};
const offerForm=document.getElementById('offerImportForm');
if(offerForm){offerForm.addEventListener('submit',async e=>{
 e.preventDefault();const msg=document.getElementById('offerImportStatus');msg.textContent='PDF wird lokal gelesen und geprüft …';
 try{const r=await fetch('/api/offers/import',{method:'POST',body:new FormData(offerForm)});const d=await r.json();if(!r.ok)throw Error(d.error||'Importfehler');
  msg.textContent=d.offer.reconciled?'Angebot erfolgreich gelesen; bitte gewünschte Gruppen auswählen.':'PDF gelesen; einige Summen müssen geprüft werden.';
  offerForm.reset();await reload();document.getElementById('imported-offers').scrollIntoView({behavior:'smooth'});
 }catch(error){msg.textContent='Import nicht möglich: '+error.message}
})}
