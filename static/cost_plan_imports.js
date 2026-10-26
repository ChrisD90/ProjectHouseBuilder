/* Editable import drafts; only explicit apply creates additional budget estimates. */
(()=>{
 'use strict';
 const $=id=>document.getElementById(id),upload=$('planUploadDialog'),review=$('planReviewDialog');
 let active=null,busy=false,dirty=false;
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 async function api(url,method='GET',data){
  const opts={method};if(data!==undefined){opts.headers={'Content-Type':'application/json'};opts.body=JSON.stringify(data);}
  const r=await fetch(url,opts),d=await r.json();if(!r.ok)throw Error(d.error||'Import fehlgeschlagen.');return d;
 }
 async function list(){
  const data=await api('/api/cost-plan-imports');
  $('planImportList').innerHTML=data.imports.map(x=>`<p class="plan-import-row"><strong>${esc(x.filename)}</strong><span class="hint-pill">${esc(x.status)}</span><button type="button" class="mini" data-plan="${x.id}">${x.status==='Entwurf'?'Prüfen und bearbeiten':'Ansehen'}</button></p>`).join('')||'<p>Noch keine Kostenplanung hochgeladen. Einzelpositionen kannst du weiterhin manuell anlegen.</p>';
  $('planImportList').querySelectorAll('[data-plan]').forEach(b=>b.onclick=()=>open(Number(b.dataset.plan)).catch(report));
 }
 function report(e){$('planImportNotice').textContent=e.message;}
 function row(record={}){
  const tr=document.createElement('tr');
  tr.innerHTML=`<td><input data-field="title" aria-label="Position" required maxlength="300" value="${esc(record.title)}"><textarea data-field="notes" aria-label="Notiz" maxlength="2000">${esc(record.notes)}</textarea></td>
   <td><input data-field="category" aria-label="Gewerk" required maxlength="160" value="${esc(record.category||'Sonstiges')}"></td>
   <td><input data-field="estimate" aria-label="Schätzung" inputmode="decimal" data-euro="true" required value="${esc(record.estimate??'')}"></td>
   <td><select data-field="kind" aria-label="Art"><option>Fremdleistung</option><option ${record.kind==='Eigenleistung'?'selected':''}>Eigenleistung</option></select></td>
   <td><input data-field="company_hint" aria-label="Firmenhinweis" maxlength="200" value="${esc(record.company_hint)}"></td>
   <td><input data-field="is_group" aria-label="Nur Gruppenüberschrift, nicht summieren" type="checkbox" ${record.is_group?'checked':''}></td><td><button type="button" class="danger">Entfernen</button></td>`;
  tr.querySelector('button').onclick=()=>{if(busy)return;tr.remove();dirty=true;total();};
  $('planReviewRows').append(tr);
  PHBUI.currency.bind(tr);
 }
 function rows(){
  return [...$('planReviewRows').children].map(tr=>Object.fromEntries([...tr.querySelectorAll('[data-field]')].map(n=>[n.dataset.field,n.type==='checkbox'?n.checked:n.value])));
 }
 function total(){
  let sum=0,count=0;
  for(const tr of $('planReviewRows').children){
   if(tr.querySelector('[data-field=is_group]').checked)continue;
   const value=tr.querySelector('[data-field=estimate]').value;
   try{sum+=PHBUI.currency.parse(value)||0;count++;}catch(_){}
  }
  $('planReviewTotal').textContent=count+' Einzelpositionen · '+new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'}).format(sum);
 }
 async function open(id){
  if(busy)return;active=await api('/api/cost-plan-imports/'+id);
  $('planReviewTitle').textContent='Kostenplanung prüfen: '+active.filename;
  $('planWarnings').textContent=active.warnings.join(' ');
  $('planOriginal').href=active.download_url;
  $('planPreview').hidden=!active.preview_url;
  $('planPreview').src=active.preview_url||'about:blank';
  $('planReviewRows').replaceChildren();active.rows.forEach(row);
  $('planGrossConfirmed').checked=false;$('planReviewMessage').textContent='';dirty=false;
  for(const n of $('planReviewForm').querySelectorAll('input,textarea,select,button'))n.disabled=active.status!=='Entwurf';
  total();if(!review.open)review.showModal();
 }
 async function save(apply){
  if(busy||!active)return;
  if(!$('planReviewForm').reportValidity())return;
  if(apply&&!$('planGrossConfirmed').checked){$('planReviewMessage').textContent='Bitte die Prüfung der Bruttobeträge bestätigen.';return;}
  const data={rows:rows(),confirm:apply,amount_basis:'gross'};
  // Currency normalization uses exactly the shared German amount parser.
  try{data.rows.forEach(r=>{r.estimate=PHBUI.currency.parse(r.estimate);if(!Number.isFinite(r.estimate)||r.estimate<0)throw Error('Bitte gültige Eurobeträge eingeben.');});}catch(e){$('planReviewMessage').textContent=e.message;return;}
  if(apply&&!await PHBUI.confirm('Geprüfte Einzelpositionen als zusätzliche Schätzungen übernehmen? Bestehende Positionen bleiben erhalten. Bereits anderweitig erfasste Kosten vorher aus dem Entwurf entfernen.'))return;
  busy=true;const controls=[...$('planReviewForm').querySelectorAll('input,textarea,select,button')];controls.forEach(n=>n.disabled=true);
  try{
   await api('/api/cost-plan-imports/'+active.id+(apply?'/apply':''),apply?'POST':'PATCH',data);
   dirty=false;
   if(apply){review.close();$('planImportNotice').textContent='Kostenplanung als Schätzungen übernommen.';await reload();}
   else $('planReviewMessage').textContent='Entwurf gespeichert. Die Kostenprognose wurde noch nicht verändert.';
   await list();
  }catch(e){$('planReviewMessage').textContent=e.message;}
  finally{busy=false;controls.forEach(n=>n.disabled=false);}
 }
 async function close(){if(!busy&&(!dirty||await PHBUI.confirm('Ungespeicherte Änderungen an der Kostenplanung verwerfen?')))review.close();}
 $('closePlanReview').onclick=close;review.addEventListener('cancel',e=>{e.preventDefault();close();});
 $('planReviewForm').oninput=()=>{dirty=true;total();};
 $('planReviewForm').onsubmit=e=>{e.preventDefault();save(true);};
 $('savePlanDraft').onclick=()=>save(false);
 $('addPlanReviewRow').onclick=()=>{row();dirty=true;total();};
 $('openPlanUpload').onclick=()=>upload.showModal();
 $('closePlanUpload').onclick=()=>{if(!busy)upload.close();};
 upload.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
 $('planUploadForm').onsubmit=async e=>{
  e.preventDefault();if(busy)return;
  const form=e.currentTarget,data=new FormData(form);data.set('kind','costplans');
  try{
   if(data.get('analysis_mode')==='ai'){
    const choice=window.PHBAI?.selection();if(!choice)throw Error('Bitte ChatGPT verbinden.');
    data.set('model',choice.model);data.set('plan_only','true');
   }
   busy=true;form.querySelector('button[type=submit]').disabled=true;$('planUploadMessage').textContent='Dateien werden hochgeladen …';
   const result=await window.PHBImports.run({form,kind:'costplans',files:form.elements.namedItem('files').files,
    analysisMode:data.get('analysis_mode'),model:data.get('model')||''});
   form.reset();upload.close();
   if(result.background){await list();$('planImportNotice').textContent='Die Kostenplanung wird in der Warteschlange verarbeitet.';}
   else window.PHBImports.review(result.jobs);
  }catch(error){$('planUploadMessage').textContent=error.message;}
  finally{busy=false;window.PHBImports.release(form.querySelector('button[type=submit]'));}
 };
 $('refreshPlanImports').onclick=()=>list().catch(report);
 list().then(()=>{const id=Number(new URLSearchParams(location.search).get('cost_plan_import'));if(id>0)return open(id);}).catch(report);
})();
