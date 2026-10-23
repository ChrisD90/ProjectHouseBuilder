'use strict';
/* Dedicated, independent offers screen. Neither drafts nor listed quotes affect costs. */
(() => {
  const $ = id => document.getElementById(id);
  if (!$('offerImportForm') || !$('offerList')) return;
  let offers = [], categories = [], budgets = [];
  const fmt = n => n == null ? 'Bitte Betrag prüfen' : new Intl.NumberFormat('de-DE', {style:'currency',currency:'EUR'}).format(Number(n));
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const option = (value,label,selected) => `<option value="${esc(value)}" ${String(value)===String(selected??'')?'selected':''}>${esc(label)}</option>`;
  const categoryOptions = selected => categories.map(c => option(c,c,selected)).join('');
  const budgetOptions = selected => option('','Keine Zuordnung (zusätzlicher Auftrag)',selected) + budgets.map(b => option(b.id,b.category+' · '+b.title,selected)).join('');
  const offerUrl = id => '/api/offers/'+encodeURIComponent(id);
  const sourceLabel = o => o.document_id
    ? `<a class="offer-document" href="/api/documents/${o.document_id}/download" target="_blank" rel="noopener">Original-PDF öffnen ↗</a>`
    : '<span class="muted">Manuell eingegeben</span>';
  const budgetLabel = o => budgets.find(b => b.id===o.budget_line_id)?.title || 'Keiner Planposition zugeordnet';
  const stage = o => ({Entwurf:['Noch prüfen','stage-draft'],Angebot:['Zum Vergleich','stage-listed'],Angenommen:['Angenommen','stage-accepted'],Beauftragt:['Angenommen','stage-accepted'],Abgelehnt:['Abgelehnt','stage-rejected']}[o.status] || [o.status,'stage-listed']);
  const notice = o => (o.warnings||[]).length
    ? `<details class="offer-warnings"><summary>Hinweise zur Erkennung (${o.warnings.length})</summary><ul>${o.warnings.map(w=>`<li>${esc(w)}</li>`).join('')}</ul></details>` : '';
  const parsedPositions = o => (o.positions||[]).length ? `<details class="offer-details"><summary>Erkannte Einzelpositionen (${o.positions.length}) – nur zur Kontrolle</summary><div class="tablewrap"><table><thead><tr><th>Pos.</th><th>Leistung</th><th>Menge</th><th>Netto</th></tr></thead><tbody>${o.positions.map(p=>`<tr><td>${esc(p.number)}</td><td>${esc(p.description)}</td><td>${esc(p.quantity)} ${esc(p.unit)}</td><td>${fmt(p.net_amount)}</td></tr>`).join('')}</tbody></table></div></details>` : '';

  function fields(o) {
    return `<label>Anbieter / Firma<input name="vendor" maxlength="200" value="${esc(o.vendor==='Firma nicht erkannt'?'':o.vendor)}" required placeholder="Name des Handwerkers"></label>
      <label>Bruttogesamtbetrag (€)<input name="gross" inputmode="decimal" value="${o.gross==null?'':esc(o.gross)}" required placeholder="z. B. 12.450,00"></label>
      <label>Kategorie / Gewerk<select name="category" required>${categoryOptions(o.category)}</select></label>
      <label>Kostenplanposition <select name="budget_line_id">${budgetOptions(o.budget_line_id)}</select></label>
      <details class="offer-extra-fields offer-wide"><summary>Weitere Angaben (optional)</summary><div class="offer-extra-grid">
        <label>Angebotsnummer<input name="number" value="${esc(o.number)}" maxlength="100"></label>
        <label>Datum<input name="issued" value="${esc(o.issued)}" maxlength="20" placeholder="TT.MM.JJJJ"></label>
        <label>Gültig bis<input name="expires" value="${esc(o.expires)}" maxlength="20" placeholder="TT.MM.JJJJ"></label>
        <label>Netto (€)<input name="net" inputmode="decimal" value="${o.net==null?'':esc(o.net)}"></label>
        <label>MwSt. (€)<input name="vat" inputmode="decimal" value="${o.vat==null?'':esc(o.vat)}"></label>
        <label class="offer-wide">Notiz<textarea name="notes" rows="2" maxlength="2000">${esc(o.notes)}</textarea></label>
      </div></details>`;
  }

  function renderDraft(o) {
    const [label,color] = stage(o);
    return `<article class="offer-card offer-draft-card" data-offer-card="${o.id}"><div class="offer-card-head"><div><span class="offer-stage ${color}">${label}</span><h3>${esc(o.filename)}</h3><p>${sourceLabel(o)} · Werte bitte vor der Übernahme prüfen.</p></div></div>
      ${notice(o)}<form class="offer-review-form" data-review="${o.id}">${fields(o)}
      <div class="offer-form-actions"><button type="button" class="primary" data-offer-promote="${o.id}">Geprüft – in Liste übernehmen</button><button type="submit" class="mini">Entwurf zwischenspeichern</button><button type="button" class="offer-text-danger" data-offer-delete="${o.id}">Entwurf löschen</button></div></form>${parsedPositions(o)}</article>`;
  }

  function billingBlock(o) {
    const b=o.billing;
    if(!b)return '';
    const percent=Math.max(0,Math.min(100,Number(b.percent)||0));
    const flag=b.stage==='overrun'?'Überziehung':b.stage==='fully_billed'?'Vollständig abgerechnet':b.stage==='warning'?'Über 80 % abgerechnet':'Im Rahmen';
    const invoices=(b.invoices||[]).map(r=>`<tr><td><a href="/belege?receipt_id=${r.id}">${esc(r.number||'Rechnung #'+r.id)}</a><small>${esc(r.date||'')} · ${esc(r.billing_type)}</small></td><td>${fmt(r.gross)}</td><td>${r.advance_deduction?'-'+fmt(r.advance_deduction):'–'}</td><td>${fmt(r.counted)}</td><td>${fmt(r.paid)}</td></tr>`).join('');
    return `<section class="offer-billing offer-billing-${esc(b.stage)}" aria-label="Rechnungen und Abrechnungsstand">
      <div class="offer-billing-heading"><strong>Rechnungen & Abrechnungsstand</strong><span class="offer-billing-flag">${flag}</span></div>
      <div class="offer-billing-numbers"><span>Angebot: <b>${fmt(b.agreed)}</b></span><span>Abgerechnet: <b>${fmt(b.billed)}</b></span><span>Bezahlt: <b>${fmt(b.paid)}</b></span><span>Rest: <b>${fmt(b.remaining)}</b></span></div>
      <div class="offer-progress" role="progressbar" aria-label="Anteil der Angebotssumme abgerechnet" aria-valuenow="${esc(Math.round(b.percent))}" aria-valuemin="0" aria-valuemax="100"><span style="width:${percent}%"></span></div>
      <p class="offer-billing-help">${b.stage==='overrun'?`Die gebuchten Rechnungen liegen ${fmt(Math.abs(b.remaining))} über dem angenommenen Angebot. Nachträge prüfen.`:b.stage==='warning'?'Die Angebotssumme ist zu mindestens 80 % ausgeschöpft. Weitere Teilrechnungen prüfen.':'Nur gebuchte Rechnungen zählen. Offene Zahlungen werden gesondert ausgewiesen.'}</p>
      <details class="offer-billing-details"><summary>Rechnungen anzeigen (${b.invoices.length})</summary>
      ${invoices?`<div class="tablewrap"><table><thead><tr><th>Rechnung</th><th>Dokumentbrutto</th><th>Verrechnete Abschläge</th><th>Neu abgerechnet</th><th>Bezahlt</th></tr></thead><tbody>${invoices}</tbody></table></div>`:'<p>Zu diesem angenommenen Angebot sind noch keine gebuchten Rechnungen verknüpft.</p>'}</details>
      <a class="mini" href="/belege?offer_id=${o.id}">Rechnung zuordnen / hochladen →</a>
    </section>`;
  }

  function renderListed(o) {
    const [label,color] = stage(o);
    const accepted = ['Angenommen','Beauftragt'].includes(o.status);
    const rejected = o.status==='Abgelehnt';
    const extras = o.notes ? `<p class="offer-notes">${esc(o.notes)}</p>` : '';
    return `<article class="offer-card offer-list-card" data-offer-card="${o.id}"><div class="offer-card-head"><div><span class="offer-stage ${color}">${label}</span><h3>${esc(o.vendor)} <small>${esc(o.number)}</small></h3><p>${esc(o.category)} · ${esc(o.issued || 'Ohne Datum')} · ${sourceLabel(o)}</p></div><div class="offer-sum"><span>Brutto</span><strong>${fmt(o.gross)}</strong></div></div>
      <p class="offer-mapping">${esc(budgetLabel(o))}${!o.budget_line_id?' · Bei Annahme zusätzliche Kosten':''}</p>${extras}
      <div class="offer-actions">${accepted
          ? `<span class="offer-accepted-note">✓ In der Kostenprognose berücksichtigt</span><a class="mini" href="/belege?offer_id=${o.id}">Rechnung zuordnen</a><button class="mini" type="button" data-offer-unaccept="${o.id}">Annahme zurücknehmen</button>`
          : `<button class="primary" type="button" data-offer-accept="${o.id}">Annehmen</button><button class="mini" type="button" data-offer-edit="${o.id}">Bearbeiten</button>${rejected?`<button class="mini" type="button" data-offer-relist="${o.id}">Wieder berücksichtigen</button>`:`<button class="mini" type="button" data-offer-reject="${o.id}">Ablehnen</button>`}`}
      </div>${accepted?billingBlock(o):''}<div class="offer-inline-edit" id="offerEditor${o.id}" hidden></div>${notice(o)}${parsedPositions(o)}</article>`;
  }

  function refreshUI() {
    const drafts=offers.filter(o=>o.status==='Entwurf');
    const listed=offers.filter(o=>o.status==='Angebot');
    const accepted=offers.filter(o=>['Angenommen','Beauftragt'].includes(o.status));
    $('offersCountDraft').textContent=String(drafts.length);
    $('offersCountListed').textContent=String(listed.length);
    $('offersCountAccepted').textContent=String(accepted.length);
    $('offersDraftBadge').textContent=drafts.length?`(${drafts.length})`:'';
    $('offerDrafts').innerHTML=drafts.length ? drafts.map(renderDraft).join('') : '<p class="offer-empty">Keine offenen PDF-Entwürfe. Neue PDF-Dateien kannst du oben hochladen.</p>';
    const filter=$('offerCategoryFilter'), prev=filter.value;
    filter.innerHTML=option('','Alle Kategorien',prev)+categories.map(c=>option(c,c,prev)).join('');
    filter.value=categories.includes(prev)?prev:'';
    const visible=offers.filter(o=>o.status!=='Entwurf'&&(!filter.value||o.category===filter.value));
    const order={Angebot:0,Angenommen:1,Beauftragt:1,Abgelehnt:2};
    visible.sort((a,b)=>a.category.localeCompare(b.category,'de')||(order[a.status]??9)-(order[b.status]??9)||(a.gross??Infinity)-(b.gross??Infinity));
    $('offerList').innerHTML=visible.length ? visible.map(renderListed).join('') : '<p class="offer-empty">Noch keine Angebote in der Liste. Du kannst oben manuell ein Angebot anlegen oder ein PDF hochladen und prüfen.</p>';
    const cat=$('offerManualCategory'), oldcat=cat.value;
    cat.innerHTML=categoryOptions(categories.includes(oldcat)?oldcat:'Sonstiges');
    const bud=$('offerManualBudget'), oldbudget=bud.value;
    bud.innerHTML=budgetOptions(oldbudget);
  }

  async function request(url,{method='GET',data=null,formData=null}={}) {
    const opts={method};
    if (formData) opts.body=formData;
    else if (data!==null) {opts.headers={'Content-Type':'application/json'};opts.body=JSON.stringify(data)}
    const resp=await fetch(url,opts);
    let body;
    try {body=await resp.json()} catch {throw Error('Der Server hat keine gültige Antwort gesendet.')} 
    if (!resp.ok) throw Error(body.error||'Aktion fehlgeschlagen.');
    return body;
  }
  async function reload() {
    const [o,c] = await Promise.all([request('/api/offers'),request('/api/costs')]);
    offers=o.offers||[]; categories=o.categories||[];
    budgets=(c.budget_lines||[]).filter(b=>b.active&&!b.is_group);
    refreshUI();
  }
  const readForm=form=>Object.fromEntries(new FormData(form).entries());
  function inform(id,message,isError=false) {
    const node=$(id); if(!node)return;
    node.textContent=message;node.classList.toggle('offer-error',isError);
  }
  async function update(id,payload) {await request(offerUrl(id)+'/draft',{method:'PATCH',data:payload})}
  async function changeStatus(id,status) {await request(offerUrl(id),{method:'PATCH',data:{status}});await reload()}
  function switchMethod(which) {
    const isPdf=which==='pdf';
    $('offerImportForm').hidden=!isPdf; $('offerManualForm').hidden=isPdf;
    $('offerMethodPdf').classList.toggle('is-selected',isPdf);
    $('offerMethodManual').classList.toggle('is-selected',!isPdf);
    $('offerMethodPdf').setAttribute('aria-pressed',String(isPdf));
    $('offerMethodManual').setAttribute('aria-pressed',String(!isPdf));
  }
  $('offerMethodPdf').addEventListener('click',()=>switchMethod('pdf'));
  $('offerMethodManual').addEventListener('click',()=>switchMethod('manual'));
  $('offerCategoryFilter').addEventListener('change',refreshUI);
  $('offerImportForm').addEventListener('submit',async event=>{
    event.preventDefault(); const form=event.currentTarget;
    inform('offerImportStatus','PDF wird auf deinem Rechner analysiert …');
    try {
      await request('/api/offers/import',{method:'POST',formData:new FormData(form)});
      form.reset(); await reload();
      inform('offerImportStatus','PDF gespeichert. Bitte die erkannten Angaben unten prüfen.');
      $('angebote-pruefen').scrollIntoView({behavior:'smooth',block:'start'});
    } catch(err) {inform('offerImportStatus','Fehler: '+err.message,true)}
  });
  $('offerManualForm').addEventListener('submit',async event=>{
    event.preventDefault();const form=event.currentTarget;
    inform('offerManualStatus','Angebot wird gespeichert …');
    try {
      await request('/api/offers/manual',{method:'POST',data:readForm(form)});
      form.reset();await reload();
      inform('offerManualStatus','Angebot gespeichert. Du kannst es unten vergleichen oder annehmen.');
      $('angebotsliste').scrollIntoView({behavior:'smooth',block:'start'});
    } catch(err) {inform('offerManualStatus','Fehler: '+err.message,true)}
  });
  document.addEventListener('submit',async e=>{
    const form=e.target.closest('[data-review]');if(!form)return;
    e.preventDefault();
    try {await update(form.dataset.review,readForm(form)); await reload()}
    catch(err){alert(err.message)}
  });
  document.addEventListener('click',async e=>{
    const button=e.target.closest('button[data-offer-promote],button[data-offer-accept],button[data-offer-reject],button[data-offer-relist],button[data-offer-unaccept],button[data-offer-edit],button[data-offer-delete]');
    if(!button)return;
    const dataset=button.dataset;
    const key=Object.keys(dataset).find(k=>k.startsWith('offer'));
    const id=dataset[key];
    try {
      if(key==='offerEdit'){
        const box=$('offerEditor'+id),o=offers.find(item=>String(item.id)===String(id));
        if(!box||!o)return;
        if(!box.hidden){box.hidden=true;button.textContent='Bearbeiten';return}
        box.innerHTML=`<h4>Angaben korrigieren</h4><form class="offer-review-form" data-review="${id}">${fields(o)}<div class="offer-form-actions"><button type="submit" class="primary">Änderungen speichern</button><button type="button" class="mini" data-edit-cancel="${id}">Abbrechen</button></div></form>`;
        box.hidden=false;button.textContent='Bearbeitung schließen';
        return;
      }
      if(key==='offerPromote'){
        const form=button.closest('form');
        if(!form.reportValidity())return;
        await update(id,readForm(form));await changeStatus(id,'Angebot');
        $('angebotsliste').scrollIntoView({behavior:'smooth',block:'start'});
      }
      if(key==='offerAccept'){
        if(!confirm('Dieses Angebot verbindlich annehmen? Der Bruttogesamtbetrag wird dadurch einmalig in deine Kostenprognose übernommen.'))return;
        await changeStatus(id,'Angenommen');
      }
      if(key==='offerReject') await changeStatus(id,'Abgelehnt');
      if(key==='offerRelist') await changeStatus(id,'Angebot');
      if(key==='offerUnaccept'){
        if(!confirm('Annahme zurücknehmen? Das ist nur möglich, solange keine Rechnungen oder Zahlungen verknüpft sind.'))return;
        await changeStatus(id,'Angebot');
      }
      if(key==='offerDelete'){
        if(!confirm('Entwurf entfernen? Ein bereits hochgeladenes Originaldokument bleibt im Archiv.'))return;
        await request(offerUrl(id),{method:'DELETE'});await reload();
      }
    } catch(err) {alert(err.message)}
  });
  document.addEventListener('click',e=>{
    const btn=e.target.closest('[data-edit-cancel]');if(!btn)return;
    const box=$('offerEditor'+btn.dataset.editCancel);
    if(box){box.hidden=true;box.innerHTML=''}
  });
  reload().catch(error=>{
    $('offerList').textContent='Angebote konnten nicht geladen werden: '+error.message;
    $('offerDrafts').textContent='Verbindung zur Angebotsverwaltung fehlgeschlagen.';
  });
})();
