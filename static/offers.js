'use strict';
/* Dedicated, independent offers screen. Neither drafts nor listed quotes affect costs. */
(() => {
  const $ = id => document.getElementById(id);
  if (!$('offerImportForm') || !$('offerList')) return;
  let offers = [], categories = [], budgets = [], versionDrafts = [];
  const expandedOffers=new Set();
  let comparingOffers = false;
  let offerUploading = false;
  let currentPreviewDocument=null;
  function showOfferPreview(docId){
    const pane=$('offerPdfPane'),frame=$('offerPdfFrame');
    if(!docId){pane.hidden=true;frame.removeAttribute('src');currentPreviewDocument=null;return;}
    const url='/api/documents/'+Number(docId)+'/preview';
    pane.hidden=false;
    if(currentPreviewDocument!==Number(docId)){frame.src=url;currentPreviewDocument=Number(docId);}
    $('offerPdfDownload').href='/api/documents/'+Number(docId)+'/download';
  }
  function previewOfferCard(target){
    const version=target.closest('[data-version-card]');
    if(version){
      const [id,v]=version.dataset.versionCard.split(':').map(Number);
      const item=versionDrafts.find(x=>Number(x.offer_id)===id&&Number(x.version)===v);
      return showOfferPreview(item?.document_id);
    }
    const card=target.closest('[data-offer-card]');
    if(card)showOfferPreview(offers.find(x=>Number(x.id)===Number(card.dataset.offerCard))?.document_id);
  }
  $('offerDrafts').addEventListener('focusin',e=>previewOfferCard(e.target),true);
  $('offerDrafts').addEventListener('click',e=>previewOfferCard(e.target),true);

  const workflow=$('offerWorkflowDialog');
  const openWorkflow=(review=false)=>{
    workflow.classList.toggle('is-reviewing',Boolean(review));
    $('anotherOffer').hidden=!review;
    if(!workflow.open)workflow.showModal();
    if(review){
      const section=$('angebote-pruefen');
      requestAnimationFrame(()=>section.scrollIntoView({block:'start'}));
    }else{
      requestAnimationFrame(()=>$('offerImportForm').querySelector('input[type=file]')?.focus({preventScroll:true}));
    }
  };
  $('openOfferWorkflow').onclick=()=>openWorkflow();
  $('openOfferDrafts').onclick=()=>openWorkflow(true);
  $('anotherOffer').onclick=()=>openWorkflow(false);
  $('closeOfferWorkflow').onclick=()=>{if(!offerUploading)workflow.close();};
  workflow.addEventListener('cancel',event=>{if(offerUploading)event.preventDefault();});
  workflow.addEventListener('click',event=>{
    if(event.target===workflow&&!offerUploading)workflow.close();
  });
  const defaultCompareLabel = 'Ausgewählte Angebote mit KI vergleichen';
  function updateAICompareSelection() {
    const choices=$('aiOfferChoices'),button=$('aiCompareOffers');
    if(!choices||!button)return;
    const count=choices.querySelectorAll('input:checked').length;
    button.disabled=comparingOffers||count<2||count>8;
    button.textContent=comparingOffers?'Vergleich läuft …':defaultCompareLabel;
    button.setAttribute('aria-busy',String(comparingOffers));
    const indicator=$('aiCompareSelectionCount');
    if(indicator)indicator.textContent=count+' ausgewählt · 2 bis 8 erforderlich';
  }
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
  const parsedPositions = o => (o.positions||[]).length ? `<details class="offer-details"><summary>Einzelpositionen (${o.positions.length}) – geprüft / ergänzt</summary><div class="tablewrap"><table><thead><tr><th>Pos.</th><th>Leistung</th><th>Menge</th><th>Netto</th></tr></thead><tbody>${o.positions.map(p=>`<tr><td>${esc(p.number)}</td><td>${esc(p.description)}</td><td>${esc(p.quantity)} ${esc(p.unit)}</td><td>${fmt(p.net_amount)}</td></tr>`).join('')}</tbody></table></div></details>` : '';

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

  function positionCard(p={}, idx=0, expanded=false) {
    const num=p.number==null ? String(idx+1) : String(p.number);
    const text=p.description||'';
    const moneyInput = val => val==null ? '' : esc(val);
    return `<details class="offer-position-row" data-position-row ${expanded?'open':''}>
      <summary class="offer-position-title"><strong data-position-label>Pos. ${esc(num)} · ${esc(text||'Neue Position')}</strong><span class="offer-position-amount">${p.optional?'Optional · ':''}${p.net_amount==null?'Betrag offen':fmt(p.net_amount)+' netto'}</span></summary>
      <div class="offer-position-fields">
        <label>Positionsnummer<input data-position-field="number" value="${esc(num)}" maxlength="30" placeholder="z. B. 3.2"></label>
        <label class="offer-position-description">Leistungsbeschreibung<input data-position-field="description" value="${esc(text)}" maxlength="300" placeholder="z. B. Leitungen verlegen" required></label>
        <label>Leistungsgruppe / Beiblatt<input data-position-field="section" value="${esc(p.section||'')}" maxlength="170" placeholder="z. B. Elektro oder Anlage 2"></label>
        <label>Menge<input data-position-field="quantity" inputmode="decimal" value="${moneyInput(p.quantity)}" placeholder="1"></label>
        <label>Einheit<input data-position-field="unit" value="${esc(p.unit||'')}" maxlength="40" placeholder="Stk., m², Std."></label>
        <label>Einzelpreis netto (€)<input data-position-field="unit_price" data-euro="true" inputmode="decimal" value="${moneyInput(p.unit_price)}" placeholder="0,00"></label>
        <label>Positionssumme netto (€)<input data-position-field="net_amount" data-euro="true" inputmode="decimal" value="${moneyInput(p.net_amount)}" placeholder="0,00"></label>
        <label>Optionaler Positionsbetrag (€)<input data-position-field="optional_amount" data-euro="true" inputmode="decimal" value="${moneyInput(p.optional_amount)}" placeholder="Nur bei optionaler Position"></label>
        <label>PDF-Seite (optional)<input data-position-field="page" type="number" min="1" max="9999" step="1" value="${moneyInput(p.page)}" placeholder="Seite"></label>
        <label class="offer-position-optional"><input type="checkbox" data-position-field="optional" ${p.optional?'checked':''}> Optionale / nicht beauftragte Position</label>
        <div class="offer-position-tools"><button type="button" class="mini" data-position-calculate>Aus Menge × Einzelpreis berechnen</button><button type="button" class="offer-text-danger" data-position-remove>Position entfernen</button></div>
      </div>
    </details>`;
  }

  function positionEditor(o) {
    const positions=o.positions||[];
    return `<section class="offer-positions-editor offer-wide" data-positions-editor>
      <div class="offer-positions-head"><div><h4>Einzelpositionen prüfen und ergänzen</h4><p>Erkannte Positionen bearbeiten, fehlende Leistungen aus zusätzlichen Formularen eintragen oder falsche Positionen entfernen. Leere Beträge sind erlaubt.</p></div>
      <button type="button" class="mini" data-position-add>+ Position hinzufügen</button></div>
      <div class="offer-position-list" data-position-list>${positions.map((p,i)=>positionCard(p,i,i===0)).join('')}</div>
      <p class="offer-position-empty" data-position-empty ${positions.length?'hidden':''}>Keine Einzelpositionen erkannt. Du kannst sie jetzt manuell hinzufügen oder das Angebot nur mit einer Gesamtsumme übernehmen.</p>
      <div class="offer-positions-reconcile" data-position-summary role="status" aria-live="polite"></div>
      <p class="offer-positions-footnote">Die Positionen werden netto geprüft. Optionale Leistungen zählen nicht zur Summe. Der <strong>Bruttogesamtbetrag oben bleibt unverändert</strong>, solange du ihn nicht selbst anpasst.</p>
    </section>`;
  }
  function collectDraft(form) {
    const data=readForm(form);
    data.positions=[...form.querySelectorAll('[data-position-row]')].map(row=>{
      const field=name=>row.querySelector(`[data-position-field="${name}"]`);
      return {number:field('number').value,description:field('description').value,
        section:field('section').value,quantity:field('quantity').value,
        unit:field('unit').value,unit_price:field('unit_price').value,
        net_amount:field('net_amount').value,optional_amount:field('optional_amount').value,
        page:field('page').value,optional:field('optional').checked};
    });
    for(const item of data.positions){
      for(const field of ['unit_price','net_amount','optional_amount']){
        if(item[field]==='')continue;
        const value=PHBUI.currency.parse(item[field]);
        if(!Number.isFinite(value))throw Error('Ungültiger Positionsbetrag: '+field);
        item[field]=String(value);
      }
    }
    return data;
  }
  function readMoney(raw) {
    const text=String(raw??'').trim();
    if (!text) return null;
    const normalized=/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(text)
      ? text.replace(/\./g,'').replace(',','.') : text.replace(',','.');
    const n=Number(normalized);
    return Number.isFinite(n)&&n>=0?n:NaN;
  }
  function checkPositions(form) {
    const summary=form.querySelector('[data-position-summary]');
    if (!summary) return {warning:false};
    const positions=collectDraft(form).positions;
    const included=positions.filter(p=>!p.optional);
    const subtotal=included.reduce((acc,p)=>acc+(readMoney(p.net_amount)||0),0);
    const missing=included.filter(p=>readMoney(p.net_amount)==null||Number.isNaN(readMoney(p.net_amount))).length;
    const formNet=readMoney(form.elements.namedItem('net')?.value);
    const formGross=readMoney(form.elements.namedItem('gross')?.value);
    const formVat=readMoney(form.elements.namedItem('vat')?.value);
    const target=formNet==null&&formGross!=null&&formVat!=null?formGross-formVat:formNet;
    const different=target!=null && Number.isFinite(target) && included.length && missing===0 && Math.abs(subtotal-target)>0.025;
    const matching=target!=null && Number.isFinite(target) && included.length && missing===0 && !different;
    const invalid=[...form.querySelectorAll('[data-position-row] input')].some(input=>!input.validity.valid);
    summary.classList.toggle('offer-position-alert',Boolean(different||missing||invalid));
    summary.innerHTML=`<strong>${positions.length} Positionen</strong> · ${fmt(subtotal)} netto (ohne ${positions.length-included.length} optionale)`
      +(missing?`<span>${missing} Position(en) ohne erfassten Nettobetrag.</span>`:'')
      +(different?`<span>Abweichung zur Angebotsnettosumme: ${fmt(subtotal-target)}. Bitte Preise und Gesamtbetrag prüfen.</span>`:'')
      +(matching?'<span>✓ Positionssumme und Angebotsnetto stimmen überein.</span>':'')
      +(!matching&&!different&&target==null?'<span>Für den Nettovergleich bitte auch Angebot netto oder MwSt. prüfen.</span>':'');
    form.querySelector('[data-position-empty]').hidden=positions.length>0;
    for (const row of form.querySelectorAll('[data-position-row]')) {
      const label=row.querySelector('[data-position-label]');
      const num=row.querySelector('[data-position-field="number"]').value;
      const desc=row.querySelector('[data-position-field="description"]').value;
      const opt=row.querySelector('[data-position-field="optional"]').checked;
      const amount=readMoney(row.querySelector('[data-position-field="net_amount"]').value);
      label.textContent=`Pos. ${num||'–'} · ${desc||'Neue Position'}`;
      row.querySelector('.offer-position-amount').textContent=(opt?'Optional · ':'')+(amount==null||Number.isNaN(amount)?'Betrag offen':fmt(amount)+' netto');
    }
    return {warning:Boolean(different||missing||invalid),different,missing};
  }

  function renderVersionDraft(o) {
    const id=Number(o.offer_id),v=Number(o.version);
    return `<article class="offer-card offer-draft-card offer-version-draft" data-version-card="${id}:${v}">
      <div class="offer-card-head"><div><span class="offer-stage stage-draft">Neue Version ${v} – prüfen</span>
      <h3>${esc(o.current_vendor)} · ${esc(o.filename)}</h3>
      <p>Bestehendes Angebot #${id} · <a class="offer-document" href="/api/documents/${o.document_id}/download" target="_blank" rel="noopener">Neue PDF ansehen ↗</a></p></div></div>
      <p class="offer-version-note">Die bisherige Version bleibt sichtbar und unverändert, bis du diese Version freigibst.</p>
      ${notice(o)}<form class="offer-review-form" data-version-review="${id}:${v}">${fields(o)}${positionEditor(o)}
      <div class="offer-form-actions"><button type="button" class="primary" data-version-activate="${id}:${v}">Version ${v} als aktuell übernehmen</button>
      <button type="submit" class="mini">Versionsentwurf speichern</button>
      <button type="button" class="offer-text-danger" data-version-discard="${id}:${v}">Entwurf verwerfen</button></div></form></article>`;
  }

  function versionHistory(o) {
    const versions=(o.versions||[]).filter(v=>v.state!=='draft');
    if(!versions.length) return '';
    return `<details class="offer-version-history" data-version-history="${o.id}"><summary>Versionshistorie (${versions.length}) · aktuell: Version ${o.current_version||1}</summary>
      <div class="offer-version-content" data-version-content="${o.id}"><p>Historie öffnen, um ältere PDFs und Positionen einzusehen.</p></div></details>`;
  }

  function historicRows(data) {
    return (data.positions||[]).length ? `<div class="tablewrap"><table><thead><tr><th>Pos.</th><th>Leistung</th><th>Menge</th><th>Netto</th></tr></thead><tbody>
      ${data.positions.map(p=>`<tr><td>${esc(p.number)}</td><td>${esc(p.description)}</td><td>${esc(p.quantity)} ${esc(p.unit)}</td><td>${fmt(p.net_amount)}</td></tr>`).join('')}
      </tbody></table></div>`:'<p>Keine Einzelpositionen hinterlegt.</p>';
  }

  function renderHistory(versions) {
    return versions.map(v=>{const d=v.snapshot||{};
      const label=v.state==='current'?'Aktuelle Version':v.state==='historical'?'Frühere Version':'Verworfener Entwurf';
      const link=v.document_id?`<a href="/api/documents/${v.document_id}/download" target="_blank" rel="noopener">Original-PDF öffnen ↗</a>`:'Manuell erfasst';
      return `<details class="offer-version-record"><summary><strong>Version ${v.version}: ${esc(label)}</strong><span>${fmt(d.gross)} · ${esc(d.number||'Ohne Nummer')}</span></summary>
        <div class="offer-version-record-details"><p><b>Anbieter:</b> ${esc(d.vendor)} · <b>Datum:</b> ${esc(d.issued||'–')} · <b>Kategorie:</b> ${esc(d.category||'–')}</p>
        <p><b>Netto:</b> ${fmt(d.net)} · <b>Brutto:</b> ${fmt(d.gross)} · <b>Damals:</b> ${esc(d.status||'–')}</p>
        <p><b>PDF:</b> ${link}</p>${d.notes?`<p><b>Notizen:</b> ${esc(d.notes)}</p>`:''}
        ${historicRows(d)}</div></details>`;
    }).join('');
  }

  function versionUpload(o) {
    return `<details class="offer-version-upload-details"><summary>Neue PDF-Version hochladen</summary><form class="offer-version-upload" data-version-upload="${o.id}">
      <label>Neue PDF-Version hochladen<input type="file" name="file" accept=".pdf,application/pdf" required></label>
      <label>Analyseart<select name="analysis_mode"><option value="local">Lokal</option><option value="ai">ChatGPT</option></select></label>
      <button type="submit" class="mini">Neue Version analysieren</button>
      <span data-version-upload-status="${o.id}" role="status"></span></form></details>`;
  }

  function renderDraft(o) {
    const [label,color] = stage(o);
    return `<article class="offer-card offer-draft-card" data-offer-card="${o.id}"><div class="offer-card-head"><div><span class="offer-stage ${color}">${label}</span><h3>${esc(o.filename)}</h3><p>${sourceLabel(o)} · Werte bitte vor der Übernahme prüfen.</p></div></div>
      ${notice(o)}<form class="offer-review-form" data-review="${o.id}">${fields(o)}${positionEditor(o)}
      <div class="offer-form-actions"><button type="button" class="primary" data-offer-promote="${o.id}">Geprüft – in Liste übernehmen</button><button type="submit" class="mini">Entwurf zwischenspeichern</button><button type="button" class="offer-text-danger" data-offer-delete="${o.id}">Entwurf löschen</button></div></form></article>`;
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
    const [label,color]=stage(o);
    const accepted=['Angenommen','Beauftragt'].includes(o.status);
    const rejected=o.status==='Abgelehnt';
    const expanded=expandedOffers.has(o.id);
    const meta=[o.category,o.issued||'Ohne Datum'].filter(Boolean).map(esc).join(' · ');
    const notes=o.notes?`<p class="offer-notes">${esc(o.notes)}</p>`:'';
    const actions=accepted
      ? `<span class="offer-accepted-note">✓ Berücksichtigt</span><a class="mini" href="/belege?offer_id=${o.id}">Rechnung</a><button class="mini" type="button" data-offer-unaccept="${o.id}">Annahme zurücknehmen</button>`
      : `<button class="primary" type="button" data-offer-accept="${o.id}">Annehmen</button><button class="mini" type="button" data-offer-edit="${o.id}">Bearbeiten</button>${rejected?`<button class="mini" type="button" data-offer-relist="${o.id}">Wieder aufnehmen</button>`:`<button class="mini" type="button" data-offer-reject="${o.id}">Ablehnen</button>`}`;
    return `<article class="offer-card offer-list-card offer-tile" data-offer-card="${o.id}">
      <button type="button" class="offer-tile-toggle" data-offer-expand="${o.id}"
        aria-expanded="${expanded}" aria-controls="offerDetails${o.id}"
        aria-label="Details zu ${esc(o.vendor)} ${expanded?'schließen':'öffnen'}">
        <span class="offer-stage ${color}">${label}</span>
        <strong class="offer-tile-vendor">${esc(o.vendor)}</strong>
        <span class="offer-tile-meta">${meta}${o.number?` · Nr. ${esc(o.number)}`:''}</span>
        <strong class="offer-tile-price">${fmt(o.gross)}</strong>
        <span class="offer-tile-chevron" aria-hidden="true">${expanded?'−':'+'}</span>
      </button>
      <div class="offer-actions offer-tile-actions">${actions}</div>
      <div class="offer-tile-details" id="offerDetails${o.id}" ${expanded?'':'hidden'}>
        <p class="offer-mapping">${esc(budgetLabel(o))}${!o.budget_line_id?' · Bei Annahme zusätzliche Kosten':''}</p>
        ${notes}${accepted?billingBlock(o):''}
        ${versionUpload(o)}${versionHistory(o)}
        <div class="offer-inline-edit" id="offerEditor${o.id}" hidden></div>
        ${notice(o)}${parsedPositions(o)}
      </div>
    </article>`;
  }

  function refreshUI() {
    const drafts=offers.filter(o=>o.status==='Entwurf');
    const listed=offers.filter(o=>o.status==='Angebot');
    const accepted=offers.filter(o=>['Angenommen','Beauftragt'].includes(o.status));
    $('offersCountDraft').textContent=String(drafts.length+versionDrafts.length);
    $('offersCountListed').textContent=String(listed.length);
    $('offersCountAccepted').textContent=String(accepted.length);
    $('offersDraftBadge').textContent=(drafts.length+versionDrafts.length)?`(${drafts.length+versionDrafts.length})`:'';
    $('offerDraftTriggerCount').textContent=(drafts.length+versionDrafts.length)
      ?'('+String(drafts.length+versionDrafts.length)+')':'';
    $('offerDrafts').innerHTML=(drafts.length||versionDrafts.length) ? [...drafts.map(renderDraft),...versionDrafts.map(renderVersionDraft)].join('') : '<p class="offer-empty">Keine offenen PDF-Entwürfe. Neue PDF-Dateien kannst du oben hochladen.</p>';
    $('offerDrafts').querySelectorAll('form[data-review],form[data-version-review]').forEach(checkPositions);
    const first=drafts.find(o=>o.document_id)||versionDrafts.find(v=>v.document_id);
    if(first && (!currentPreviewDocument ||
        !(drafts.some(o=>o.document_id===currentPreviewDocument)||versionDrafts.some(v=>v.document_id===currentPreviewDocument))))
      showOfferPreview(first.document_id);
    if(!first)showOfferPreview(null);
    const filter=$('offerCategoryFilter'), prev=filter.value;
    filter.innerHTML=option('','Alle Kategorien',prev)+categories.map(c=>option(c,c,prev)).join('');
    filter.value=categories.includes(prev)?prev:'';
    const visible=offers.filter(o=>o.status!=='Entwurf'&&(!filter.value||o.category===filter.value));
    const order={Angebot:0,Angenommen:1,Beauftragt:1,Abgelehnt:2};
    visible.sort((a,b)=>a.category.localeCompare(b.category,'de')||(order[a.status]??9)-(order[b.status]??9)||(a.gross??Infinity)-(b.gross??Infinity));
    $('offerList').innerHTML=visible.length ? visible.map(renderListed).join('') : '<p class="offer-empty">Noch keine Angebote in der Liste. Du kannst oben manuell ein Angebot anlegen oder ein PDF hochladen und prüfen.</p>';
    if ($('aiOfferChoices')) {
      const previous=new Set([...$('aiOfferChoices').querySelectorAll('input:checked')].map(x=>Number(x.value)));
      $('aiOfferChoices').innerHTML=visible.map(o=>`<label><input type="checkbox" name="ai-compare" value="${o.id}" ${previous.has(o.id)?'checked':''}><span>${esc(o.vendor)} · ${esc(o.category)} · ${fmt(o.gross)}</span></label>`).join('')||'<p class="offer-empty">Mindestens zwei geprüfte Angebote benötigt.</p>';
      updateAICompareSelection();
    }

    const cat=$('offerManualCategory'), oldcat=cat.value;
    cat.innerHTML=categoryOptions(categories.includes(oldcat)?oldcat:'Sonstiges');
    const bud=$('offerManualBudget'), oldbudget=bud.value;
    bud.innerHTML=budgetOptions(oldbudget);
  }

  async function request(url,{method='GET',data=null,formData=null,ai=false}={}) {
    const opts={method};
    if (ai)opts.headers={'X-PHB-AI':'1'};
    if (formData) opts.body=formData;
    else if (data!==null) {opts.headers={...(opts.headers||{}),'Content-Type':'application/json'};opts.body=JSON.stringify(data)}
    const resp=await fetch(url,opts);
    let body;
    try {body=await resp.json()} catch {throw Error('Der Server hat keine gültige Antwort gesendet.')} 
    if (!resp.ok) throw Error(body.error||'Aktion fehlgeschlagen.');
    return body;
  }
  async function reload() {
    const [o,c] = await Promise.all([request('/api/offers'),request('/api/costs')]);
    offers=o.offers||[]; categories=o.categories||[]; versionDrafts=o.draft_versions||[];
    budgets=(c.budget_lines||[]).filter(b=>b.active&&!b.is_group);
    refreshUI();
  }
  const readForm=form=>{
    const fields=Object.fromEntries(new FormData(form).entries());
    for(const key of ['gross','net','vat']){
      if(fields[key]==null||fields[key]==='')continue;
      const value=PHBUI.currency.parse(fields[key]);
      if(!Number.isFinite(value))throw Error('Bitte einen gültigen Euro-Betrag eingeben: '+key);
      fields[key]=String(value);
    }
    return fields;
  };
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
  const aiAppend=form=>{
    const data=new FormData(form);
    if(data.get('analysis_mode')==='ai'){
      const settings=window.PHBAI?.selection();
      if(!settings)throw Error('ChatGPT ist nicht verbunden.');
      data.set('model',settings.model);
      data.set('plan_only','true');
    }
    return data;
  };
  $('offerImportForm').addEventListener('submit',async event=>{
    event.preventDefault(); const form=event.currentTarget;
    if(offerUploading)return;
    offerUploading=true;
    const submit=form.querySelector('button[type=submit]');submit.disabled=true;
    inform('offerImportStatus',form.elements.analysis_mode.value==='ai'?'PDF wird mit ChatGPT analysiert …':'PDF wird lokal analysiert …');
    try {
      const mode=form.elements.analysis_mode.value;
      let model='';
      if(mode==='ai')model=window.PHBAI?.selection()?.model||'';
      const files=form.elements.files.files;
      const jobs=await window.PHBImports.enqueue({
        kind:'offers',files,analysisMode:mode,model
      });
      form.reset();
      inform('offerImportStatus',jobs.length+' PDF(s) in der Warteschlange. Die Verarbeitung läuft nacheinander im Hintergrund.');
      workflow.close();
    } catch(err) {inform('offerImportStatus','Fehler: '+err.message,true)}
    finally{offerUploading=false;submit.disabled=false;}
  });
  $('offerManualForm').addEventListener('submit',async event=>{
    event.preventDefault();const form=event.currentTarget;
    inform('offerManualStatus','Angebot wird gespeichert …');
    try {
      await request('/api/offers/manual',{method:'POST',data:readForm(form)});
      form.reset();await reload();
      inform('offerManualStatus','Angebot gespeichert. Du kannst es im Hintergrund vergleichen oder annehmen.');
    } catch(err) {inform('offerManualStatus','Fehler: '+err.message,true)}
  });
  document.addEventListener('click',async e=>{
    const add=e.target.closest('[data-position-add]');
    if(add){
      const editor=add.closest('[data-positions-editor]');
      const list=editor.querySelector('[data-position-list]');
      list.insertAdjacentHTML('beforeend',positionCard({},list.children.length,true));
      list.lastElementChild.querySelector('[data-position-field="description"]').focus();
      checkPositions(add.closest('form'));
      return;
    }
    const remove=e.target.closest('[data-position-remove]');
    if(remove){
      if(!await PHBUI.confirm('Diese Einzelposition aus dem Entwurf entfernen? Die Änderung wird erst beim Speichern wirksam.'))return;
      const form=remove.closest('form');remove.closest('[data-position-row]').remove();checkPositions(form);
      return;
    }
    const calculate=e.target.closest('[data-position-calculate]');
    if(calculate){
      const row=calculate.closest('[data-position-row]');
      const q=readMoney(row.querySelector('[data-position-field="quantity"]').value);
      const price=readMoney(row.querySelector('[data-position-field="unit_price"]').value);
      if(q===null||price===null||!Number.isFinite(q)||!Number.isFinite(price)){
        await PHBUI.alert('Bitte zuerst eine gültige Menge und einen gültigen Einzelpreis eingeben.');return;
      }
      const value=(Math.round((q*price+Number.EPSILON)*100)/100).toFixed(2);
      const target=row.querySelector(row.querySelector('[data-position-field="optional"]').checked
        ? '[data-position-field="optional_amount"]':'[data-position-field="net_amount"]');
      target.value=value;checkPositions(calculate.closest('form'));
    }
  });
  document.addEventListener('input',e=>{
    const form=e.target.closest('form[data-review],form[data-version-review]');
    if(form && (e.target.closest('[data-position-row]') || ['gross','net','vat'].includes(e.target.name)))checkPositions(form);
  });
  document.addEventListener('change',e=>{
    const form=e.target.closest('form[data-review],form[data-version-review]');
    if(form && e.target.closest('[data-position-row]'))checkPositions(form);
  });
  document.addEventListener('submit',async e=>{
    const form=e.target.closest('[data-review], [data-version-review]');if(!form)return;
    e.preventDefault();
    try {
      if(form.dataset.versionReview){const [id,v]=form.dataset.versionReview.split(':');await request(offerUrl(id)+'/versions/'+v+'/draft',{method:'PATCH',data:collectDraft(form)});}
      else await update(form.dataset.review,collectDraft(form));
      await reload();
    }
    catch(err){await PHBUI.alert(err.message)}
  });
  document.addEventListener('submit',async e=>{
    const form=e.target.closest('form[data-version-upload]');if(!form)return;
    e.preventDefault();
    const id=form.dataset.versionUpload;
    const status=form.querySelector('[data-version-upload-status]');
    const button=form.querySelector('button[type="submit"]');
    button.disabled=true; status.textContent='Neue Version wird in die Warteschlange gestellt …';
    try{
      const mode=form.elements.analysis_mode.value;
      const model=mode==='ai'?window.PHBAI?.selection()?.model||'':'';
      await window.PHBImports.enqueue({
        kind:'versions',files:form.elements.file.files,analysisMode:mode,
        model,fields:{offer_id:String(id)}
      });
      form.reset();
      status.textContent='PDF eingereiht. Du kannst weiterarbeiten; die Prüfung erfolgt nach Abschluss über die Importübersicht.';
    }catch(err){status.textContent='Fehler: '+err.message;}
    finally{button.disabled=false;}
  });
  document.addEventListener('toggle',async e=>{
    const details=e.target;
    if(!details.matches?.('[data-version-history]')||!details.open)return;
    const id=details.dataset.versionHistory;
    const content=details.querySelector('[data-version-content]');
    try{
      const history=await request(offerUrl(id)+'/versions');
      content.innerHTML=renderHistory(history.versions);
    }catch(err){content.textContent='Versionshistorie konnte nicht geladen werden: '+err.message;}
  },true);
  document.addEventListener('click',async e=>{
    const button=e.target.closest('[data-version-activate], [data-version-discard]');if(!button)return;
    const activation=Boolean(button.dataset.versionActivate);
    const [id,v]=(button.dataset.versionActivate||button.dataset.versionDiscard).split(':');
    try{
      if(activation){
        const form=button.closest('form');if(!form.reportValidity())return;
        const review=checkPositions(form);
        if(review.warning&&!await PHBUI.confirm('Die Positionen sind möglicherweise unvollständig. Version dennoch als aktuell übernehmen?'))return;
        const active=offers.find(o=>String(o.id)===id);
        const isAccepted=['Angenommen','Beauftragt'].includes(active?.status);
        const prompt=isAccepted
          ? 'Neue PDF-Version verbindlich übernehmen? Die Angebotssumme des angenommenen Auftrags wird angepasst. Alle bisherigen Rechnungen bleiben mit diesem Angebot verknüpft.'
          : 'Diese geprüfte Version als aktuelles Angebot übernehmen? Die alte Version bleibt in der Historie erhalten.';
        if(!await PHBUI.confirm(prompt))return;
        await request(offerUrl(id)+'/versions/'+v+'/draft',{method:'PATCH',data:collectDraft(form)});
        await request(offerUrl(id)+'/versions/'+v+'/activate',{method:'POST'});
      }else{
        if(!await PHBUI.confirm('Versionsentwurf verwerfen? Das PDF bleibt als historischer Nachweis gespeichert.'))return;
        await request(offerUrl(id)+'/versions/'+v+'/discard',{method:'POST'});
      }
      await reload();
    }catch(err){await PHBUI.alert(err.message)}
  });
  document.addEventListener('click',event=>{
    const toggle=event.target.closest('button[data-offer-expand]');
    if(!toggle)return;
    const id=Number(toggle.dataset.offerExpand);
    const details=$('offerDetails'+id);
    if(!details)return;
    const open=details.hidden;
    details.hidden=!open;
    toggle.setAttribute('aria-expanded',String(open));
    toggle.setAttribute('aria-label',toggle.getAttribute('aria-label').replace(
      open?'öffnen':'schließen',open?'schließen':'öffnen'));
    toggle.querySelector('.offer-tile-chevron').textContent=open?'−':'+';
    if(open)expandedOffers.add(id);else expandedOffers.delete(id);
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
        const tile=$('offerDetails'+id);
        if(tile){
          tile.hidden=false;expandedOffers.add(Number(id));
          const toggle=document.querySelector('[data-offer-expand="'+id+'"]');
          if(toggle){toggle.setAttribute('aria-expanded','true');
            toggle.querySelector('.offer-tile-chevron').textContent='−';}
        }
        if(!box||!o)return;
        if(!box.hidden){box.hidden=true;button.textContent='Bearbeiten';return}
        box.innerHTML=`<h4>Angaben korrigieren</h4><form class="offer-review-form" data-review="${id}">${fields(o)}<div class="offer-form-actions"><button type="submit" class="primary">Änderungen speichern</button><button type="button" class="mini" data-edit-cancel="${id}">Abbrechen</button></div></form>`;
        box.hidden=false;button.textContent='Bearbeitung schließen';
        return;
      }
      if(key==='offerPromote'){
        const form=button.closest('form');
        if(!form.reportValidity())return;
        const checked=checkPositions(form);
        if(checked.warning && !await PHBUI.confirm('Einige Positionsbeträge fehlen oder die Positionssumme weicht von der Angebotssumme ab. Trotzdem als geprüft in die Liste übernehmen?'))return;
        await update(id,collectDraft(form));await changeStatus(id,'Angebot');
        workflow.close();
      }
      if(key==='offerAccept'){
        if(!await PHBUI.confirm('Dieses Angebot verbindlich annehmen? Der Bruttogesamtbetrag wird dadurch einmalig in deine Kostenprognose übernommen.'))return;
        await changeStatus(id,'Angenommen');
      }
      if(key==='offerReject') await changeStatus(id,'Abgelehnt');
      if(key==='offerRelist') await changeStatus(id,'Angebot');
      if(key==='offerUnaccept'){
        if(!await PHBUI.confirm('Annahme zurücknehmen? Das ist nur möglich, solange keine Rechnungen oder Zahlungen verknüpft sind.'))return;
        await changeStatus(id,'Angebot');
      }
      if(key==='offerDelete'){
        if(!await PHBUI.confirm('Entwurf entfernen? Ein bereits hochgeladenes Originaldokument bleibt im Archiv.'))return;
        await request(offerUrl(id),{method:'DELETE'});await reload();
      }
    } catch(err) {await PHBUI.alert(err.message)}
  });
  document.addEventListener('click',e=>{
    const btn=e.target.closest('[data-edit-cancel]');if(!btn)return;
    const box=$('offerEditor'+btn.dataset.editCancel);
    if(box){box.hidden=true;box.innerHTML=''}
  });
  $('aiOfferChoices')?.addEventListener('change',()=>{
    $('aiCompareResult').hidden=true;
    inform('aiCompareStatus','');
    updateAICompareSelection();
  });
  $('aiCompareOffers')?.addEventListener('click',async()=>{
    if(comparingOffers)return;
    const checked=[...$('aiOfferChoices').querySelectorAll('input:checked')].map(x=>Number(x.value));
    const status=$('aiCompareStatus'),output=$('aiCompareResult');
    comparingOffers=true;
    updateAICompareSelection();
    output.hidden=true;
    try{
      if(checked.length<2||checked.length>8)throw Error('Bitte zwischen 2 und 8 Angebote auswählen.');
      const permission=window.PHBAI?.selection();
      if(!permission)throw Error('Bitte ChatGPT verbinden.');
      inform('aiCompareStatus','Angebote werden verglichen …');
      const result=await request('/api/ai/offers/compare',{method:'POST',ai:true,
          data:{...permission,offer_ids:checked}});
      output.textContent=result.analysis;
      output.hidden=false;
      inform('aiCompareStatus','KI-Vorschlag – Angaben anhand der Originalangebote prüfen.');
    }catch(e){
      inform('aiCompareStatus',e.message,true);
    }finally{
      comparingOffers=false;
      updateAICompareSelection();
    }
  });
  document.addEventListener('phb-import-updated',event=>{
    if(['offers','versions'].includes(event.detail.kind)&&!workflow.open)reload().catch(()=>{});
  });
  reload().then(()=>{
    const draftId=Number(new URLSearchParams(location.search).get('offer_draft'));
    if(!draftId)return;
    const isKnown=offers.some(o=>o.id===draftId&&o.status==='Entwurf')||
      versionDrafts.some(v=>v.id===draftId||v.offer_id===draftId);
    if(isKnown){
      openWorkflow(true);
      requestAnimationFrame(()=>$('offerDrafts').querySelector('[data-offer-card="'+draftId+'"]')?.scrollIntoView({block:'nearest'}));
    }
  }).catch(error=>{
    $('offerList').textContent='Angebote konnten nicht geladen werden: '+error.message;
    $('offerDrafts').textContent='Verbindung zur Angebotsverwaltung fehlgeschlagen.';
  });
})();
