'use strict';
let state={},mode='',current=null;
const el=id=>document.getElementById(id), euro=x=>new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'}).format(Number(x)||0), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nf=x=>new Intl.NumberFormat('de-DE',{maximumFractionDigits:1}).format(x||0);
const fields={
 cost:[['category','Gewerk / Kategorie'],['title','Bezeichnung'],['kind','Leistungsart','choice',['Fremdleistung','Eigenleistung']],['state','Stand','choice',['Schätzung','Angebot','Beauftragt','Abgeschlossen','Alternative','Abgelehnt']],['budget_line_id','Kostenplanposition','budget'],['selected','Für Prognose auswählen (nur ein Angebot pro Planposition)','bool'],['contractor_id','Firma','contractor'],['task_id','Gantt-Arbeitspaket','task'],['estimate','Kostenschätzung (€)','money'],['offer','Angebot (€)','money'],['committed','Beauftragter Wert (€)','money'],['paid','Bereits bezahlt (€)','money'],['own_hours','Eigenleistungsstunden','number'],['own_hourly','Kalkulatorischer Stundenwert (nur Informationswert)','money'],['source_ref','Angebots- / Vertragsreferenz'],['notes','Notizen','textarea']],
 contact:[['trade','Gewerk'],['name','Firmenname'],['contact','Ansprechpartner'],['phone','Telefon'],['email','E-Mail'],['address','Adresse'],['notes','Notizen','textarea']],
 budget:[['category','Gewerk'],['title','Position'],['parent_code','Unterposition von','parent'],['kind','Leistungsart','choice',['Fremdleistung','Eigenleistung']],['estimate','Schätzung (€)','money'],['company_hint','Firmenhinweis (unverbindlich)'],['marker','Excel-Marker / Kennzeichnung'],['notes','Notizen','textarea'],['active','In Prognose einbeziehen','bool'],['is_group','Nur Gruppenüberschrift, nicht summieren','bool']],
 funding:[['name','Fördermaßnahme'],['expected','Erwarteter Förderbetrag (€)','money'],['confirmed','Bewilligter Betrag (€)','money'],['received','Ausgezahlter Betrag (€)','money'],['notes','Notizen','textarea']]
};
async function api(url,opts={}){const r=await fetch(url,{...opts,headers:opts.body?{'Content-Type':'application/json'}:{}});const d=await r.json();if(!r.ok)throw Error(d.error||'Unbekannter Fehler');return d}
async function reload(){state=await api('/api/costs');render()}
function fmtcell(n){return `<td class="amount">${euro(n)}</td>`}
function render(){const s=state.summary;
 for(const [key,val] of Object.entries({budget:euro(s.budget),planned:euro(s.planned),overrun:(s.overrun>0?'+':'')+euro(s.overrun),committed:euro(s.committed),paid:euro(s.paid),remaining:euro(s.remaining),ownbudget:euro(s.own_budget),hours:nf(s.own_hours)+' h',ownvalue:'Kalkulatorisch: '+euro(s.own_imputed_value)}))el(key).textContent=val;
 el('overrun').className=s.overrun>0?'negative':'positive';
 el('budgetNotice').textContent=`Dein Kostenplan enthält derzeit ${euro(s.categories.reduce((a,c)=>a+c.estimate,0))} an Einzelpositionen bei ${euro(s.budget)} hinterlegtem Gesamtbudget. Es handelt sich überwiegend um Schätzungen; Angebote werden erst nach deiner Auswahl bzw. Beauftragung statt der Schätzung berücksichtigt.`;
 el('categories').innerHTML=s.categories.map(c=>`<tr><td>${esc(c.category)}</td>${fmtcell(c.estimate)}${fmtcell(c.planned)}${fmtcell(c.paid)}${fmtcell(c.planned-c.estimate)}</tr>`).join('')||'<tr><td colspan="5">Keine Einträge</td></tr>';
 const q=el('budgetSearch').value.toLowerCase().trim();
 el('budgetrows').innerHTML=state.budget_lines.filter(b=>(b.category+' '+b.title+' '+b.company_hint).toLowerCase().includes(q)).map(b=>`<tr class="${b.is_group?'group-row':''}"><td>${esc(b.category)}<div class="${b.parent_code?'child-title':'muted'}">${b.parent_code?'↳ ':''}${esc(b.title)}</div></td><td><span class="marker">${esc(b.marker)}</span></td><td>${b.is_group?'Gruppe':esc(b.kind)}</td><td>${esc(b.company_hint)}</td>${fmtcell(b.is_group?0:b.estimate)}${fmtcell(s.line_forecasts[b.id]??0)}<td><span class="hint-pill">${esc(s.line_basis[b.id]??(b.is_group?'Gruppenzeile':'Inaktiv'))}</span></td><td><button class="mini" data-budget="${b.id}">Bearbeiten</button></td></tr>`).join('')||'<tr><td colspan="8">Keine passenden Positionen</td></tr>';
 const contractors=new Map(state.contractors.map(x=>[x.id,x.name])); const budget=new Map(state.budget_lines.map(x=>[x.id,x.title]));
 el('costrows').innerHTML=state.items.map(c=>`<tr><td>${esc(c.category)}</td><td>${esc(c.title)}${c.kind==='Eigenleistung'?`<div class="muted">${nf(c.own_hours)} h Eigenarbeit</div>`:''}</td><td>${esc(c.state)}</td><td>${esc(budget.get(c.budget_line_id)||'Zusätzliche Position')}</td><td>${esc(contractors.get(c.contractor_id)||'–')}</td>${fmtcell(c.offer)}${fmtcell(c.committed)}${fmtcell(c.paid)}<td>${c.selected?'✓':'–'}</td><td>${c.offer_id?`<button class="mini" data-offer-paid="${c.id}">Zahlung</button>`:`<button class="mini" data-cost="${c.id}">Bearbeiten</button>`}</td></tr>`).join('')||'<tr><td colspan="10">Noch keine Angebote erfasst. Die Grobschätzungen stehen oben im Kostenplan.</td></tr>';
 const ownLines=state.budget_lines.filter(b=>b.kind==='Eigenleistung'&&b.active&&!b.is_group);
 const ownExtras=state.items.filter(i=>i.kind==='Eigenleistung'&&!i.budget_line_id&&!['Alternative','Abgelehnt'].includes(i.state));
 const ownRows=ownLines.map(b=>{const entries=state.items.filter(i=>i.kind==='Eigenleistung'&&i.budget_line_id===b.id);
 const hours=entries.reduce((a,i)=>a+Number(i.own_hours||0),0);const workValue=entries.reduce((a,i)=>a+Number(i.own_hours||0)*Number(i.own_hourly||0),0);
 return `<tr><td>${esc(b.title)}</td>${fmtcell(b.estimate)}${fmtcell(s.line_forecasts[b.id]??b.estimate)}<td>${nf(hours)} h</td>${fmtcell(workValue)}<td>${entries.length}</td><td><button class="mini" data-own="${b.id}">Erfassen</button></td></tr>`}).join('');
 const extraRows=ownExtras.map(i=>`<tr><td>${esc(i.title)} <small class="muted">(zusätzliche Leistung)</small></td>${fmtcell(i.estimate)}${fmtcell(i.committed||i.offer||i.estimate)}<td>${nf(i.own_hours)} h</td>${fmtcell(i.own_hours*i.own_hourly)}<td>1</td><td><button class="mini" data-ownedit="${i.id}">Bearbeiten</button></td></tr>`).join('');
 el('ownworkrows').innerHTML=ownRows+extraRows||'<tr><td colspan="7">Noch keine Eigenleistungen angelegt.</td></tr>';
 document.querySelectorAll('[data-own]').forEach(btn=>btn.onclick=()=>openEditor('cost',null,{budget_line_id:Number(btn.dataset.own),kind:'Eigenleistung',category:state.budget_lines.find(x=>x.id===Number(btn.dataset.own))?.category||'Eigenleistung',title:state.budget_lines.find(x=>x.id===Number(btn.dataset.own))?.title||'Eigenleistung',state:'Schätzung'}));
 document.querySelectorAll('[data-ownedit]').forEach(btn=>btn.onclick=()=>openEditor('cost',Number(btn.dataset.ownedit)));
 document.querySelectorAll('[data-offer-paid]').forEach(btn=>btn.onclick=async()=>{
   const c=state.items.find(x=>x.id===Number(btn.dataset.offerPaid));
   if(!c)return;
   const answer=await AppUI.money('Tatsächlich insgesamt bezahlt (€), nicht der nächste Abschlag:',c.paid||0,'Zahlung erfassen');
   if(answer===null)return;
   const value=answer;
   if(!Number.isFinite(value)||value<0){await AppUI.alert('Bitte einen gültigen Betrag eingeben.');return}
   try{await api('/api/offer-costs/'+c.id,{method:'PATCH',body:JSON.stringify({paid:value})});await reload()}
   catch(error){await AppUI.alert(error.message)}
 });

 el('documents').innerHTML=state.documents.map(d=>`<tr><td><a href="/api/documents/${d.id}/download">${esc(d.name)}</a></td><td>${esc(d.kind)}</td><td>${esc(contractors.get(d.contractor_id)||'–')}</td><td>${esc(budget.get(d.budget_line_id)||state.items.find(i=>i.id===d.cost_item_id)?.title||'–')}</td><td>${esc(d.notes)}</td><td>${esc((d.uploaded_at||'').substring(0,10))}</td><td>${/\.pdf$/i.test(d.name)?`<button class="mini" data-view-doc="${d.id}">PDF ansehen</button> `:''}<button class="mini" data-delete-doc="${d.id}">Löschen</button></td></tr>`).join('')||'<tr><td colspan="7">Noch keine Dokumente abgelegt</td></tr>';
 for(const [node,values,title] of [['fileContractor',state.contractors,'name'],['fileBudget',state.budget_lines.filter(x=>!x.is_group),'title'],['fileCost',state.items,'title']]){const selection=el(node).value;el(node).innerHTML='<option value="">Keine Zuordnung</option>'+values.map(x=>`<option value="${x.id}">${esc(x[title])}</option>`).join('');el(node).value=selection}
 document.querySelectorAll('[data-delete-doc]').forEach(btn=>btn.onclick=async()=>{if(!await AppUI.confirm('Dieses Dokument dauerhaft von diesem Rechner löschen?'))return;try{await api('/api/documents/'+btn.dataset.deleteDoc,{method:'DELETE'});await reload()}catch(e){await AppUI.alert(e.message)}});
 document.querySelectorAll('[data-view-doc]').forEach(btn=>btn.onclick=()=>{
  showSavedPdf('upload',Number(btn.dataset.viewDoc));
  el('uploadPdfFrame').scrollIntoView({block:'center',behavior:'smooth'});
 });
 el('fundingrows').innerHTML=state.funding.map(f=>`<tr><td>${esc(f.name)}</td>${fmtcell(f.expected)}${fmtcell(f.confirmed)}${fmtcell(f.received)}<td>${esc(f.notes)}</td><td><button class="mini" data-funding="${f.id}">Bearbeiten</button></td></tr>`).join('');
 el('fundingExpected').textContent=euro(s.funding_expected);el('fundingConfirmed').textContent=euro(s.funding_confirmed);el('net').textContent=euro(s.net_after_confirmed);
 el('contacts').innerHTML=state.contractors.map(c=>`<tr><td>${esc(c.trade)}</td><td>${esc(c.name)}</td><td>${esc(c.contact)}</td><td>${esc(c.phone)}</td><td>${c.email?`<a href="mailto:${encodeURIComponent(c.email).replace('%40','@')}">${esc(c.email)}</a>`:'–'}</td><td>${esc(c.address)}</td><td><button class="mini" data-contact="${c.id}">Bearbeiten</button></td></tr>`).join('')||'<tr><td colspan="7">Keine Firmen vorhanden</td></tr>';
 el('historicalrows').innerHTML=state.historical.map(x=>`<tr><td>${esc(x.name)}</td>${fmtcell(x.architect_estimate)}${fmtcell(x.own_estimate)}<td>${esc(x.supplier_note)}</td></tr>`).join('');
 for(const typ of ['budget','cost','funding','contact'])document.querySelectorAll('[data-'+typ+']').forEach(btn=>btn.addEventListener('click',()=>openEditor(typ,Number(btn.dataset[typ]))));
 if(window.renderOffers)window.renderOffers();
}
const sources={budget:'budget_lines',cost:'items',funding:'funding',contact:'contractors'};
function selector(key,val){let arr=key==='budget_line_id'?state.budget_lines.filter(x=>!x.is_group):key==='contractor_id'?state.contractors:key==='task_id'?state.tasks:state.budget_lines.filter(x=>x.is_group);let o=`<option value="">Keine Zuordnung</option>`;return o+arr.map(x=>`<option value="${esc(key==='parent_code'?x.code:x.id)}" ${String(val??'')===String(key==='parent_code'?x.code:x.id)?'selected':''}>${esc(key==='task_id'?x.code+' · '+x.name:key==='contractor_id'?x.name:x.category+' · '+x.title)}</option>`).join('')}
function openEditor(type,id=null,defaults={}){mode=type;current=id;const record=(state[sources[type]]||[]).find(x=>x.id===id)||defaults;el('editTitle').textContent=(id?'Bearbeiten: ':'Neu: ')+({budget:'Kostenplanposition',cost:'Angebot / Ausgabe',contact:'Firma & Kontakt',funding:'Förderung'}[type]);el('formError').textContent='';el('remove').hidden=!id||type==='funding';
 el('editFields').innerHTML=fields[type].map(([key,label,kind,options])=>{const value=record[key]??(kind==='bool'?(key==='active'?true:false):'');let control;
 if(kind==='choice')control=`<select name="${key}">${options.map(o=>`<option value="${esc(o)}" ${o===value?'selected':''}>${esc(o)}</option>`).join('')}</select>`;
 else if(['budget','contractor','task','parent'].includes(kind))control=`<select name="${key}">${selector(key,value)}</select>`;
 else if(kind==='bool')control=`<input name="${key}" type="checkbox" value="true" ${value?'checked':''} style="width:20px;height:20px">`;
 else if(kind==='textarea')control=`<textarea name="${key}" rows="3">${esc(value)}</textarea>`;
 else control=`<input name="${key}" type="${kind==='number'?'number':'text'}" ${kind==='number'?'min="0" step="0.01"':kind==='money'?'data-money="true" inputmode="decimal"':''} ${['title','name'].includes(key)?'required':''} value="${esc(kind==='money'&&value!==''?AppUI.formatEuro(value):value)}">`;
 return `<label class="${kind==='textarea'?'wide':''}">${esc(label)}${control}</label>`}).join('');AppUI.bindMoney(el('editFields'));el('editor').showModal()}
async function saveEditor(e){e.preventDefault();const data=Object.fromEntries(new FormData(e.target));for(const key of ['selected','active','is_group'])if(fields[mode].some(x=>x[0]===key))data[key]=e.target.elements.namedItem(key).checked;
 for(const [key,label,kind] of fields[mode]){
   if(kind==='money'){
     const raw=data[key];const parsed=raw===''?0:AppUI.amount(raw);
     if(!Number.isFinite(parsed)||parsed<0){el('formError').textContent='Bitte für '+label+' einen gültigen Euro-Betrag eingeben.';return}
     data[key]=parsed;
   }
  }
  const urls={cost:'/api/costs',contact:'/api/contractors',budget:'/api/budget/lines',funding:'/api/funding'};
 const method=current?'PUT':'POST',url=urls[mode]+(current?'/'+current:'');
 try{await api(url,{method,body:JSON.stringify(data)});el('editor').close();await reload()}catch(err){el('formError').textContent=err.message}}
async function removeEditor(){if(!current||!await AppUI.confirm('Diesen Eintrag wirklich löschen?'))return;const urls={cost:'/api/costs/',contact:'/api/contractors/',budget:'/api/budget/lines/'};if(!urls[mode])return;try{await api(urls[mode]+current,{method:'DELETE'});el('editor').close();await reload()}catch(e){el('formError').textContent=e.message}}
el('addOwnWork').onclick=()=>openEditor('cost',null,{kind:'Eigenleistung',category:'Eigenleistung',state:'Schätzung'});
el('budgetSearch').addEventListener('input',render);el('editForm').addEventListener('submit',saveEditor);el('remove').addEventListener('click',removeEditor);el('closeDialog').addEventListener('click',()=>el('editor').close());el('cancelDialog').addEventListener('click',()=>el('editor').close());
for(const type of ['Budget','Cost','Contact','Funding'])el('add'+(type==='Budget'?'Line':type)).addEventListener('click',()=>openEditor(type.toLowerCase()));
el('editBudget').addEventListener('click',async()=>{
 const num=await AppUI.money('Wie hoch ist das Projektbudget in Euro?',state.summary?.budget??350000,'Projektbudget');
 if(num===null)return;
 try{await api('/api/budget/config',{method:'PATCH',body:JSON.stringify({budget:num})});await reload()}
 catch(e){await AppUI.alert(e.message)}
});
reload().catch(e=>AppUI.alert('Kostenverwaltung kann nicht geladen werden: '+e.message));

el('uploadForm').addEventListener('submit',async e=>{e.preventDefault();el('uploadMessage').textContent='Datei wird gespeichert …';const form=new FormData(e.target);try{const r=await fetch('/api/documents',{method:'POST',body:form});const data=await r.json();if(!r.ok)throw Error(data.error||'Fehler beim Hochladen');el('uploadMessage').textContent='Datei wurde lokal gespeichert.';e.target.reset();if(/\.pdf$/i.test(form.get('file')?.name||''))showSavedPdf('upload',data.id);else clearPreview('upload');await reload()}catch(err){el('uploadMessage').textContent='Fehler: '+err.message}});

let offerObjectUrl=null,uploadObjectUrl=null;
function clearPreview(type){
 const frame=el(type==='offer'?'offerPdfFrame':'uploadPdfFrame');
 const hint=el(type==='offer'?'offerPdfHint':'uploadPdfHint');
 const link=el(type==='offer'?'offerPdfDownload':'uploadPdfDownload');
 frame.removeAttribute('src');frame.classList.remove('has-pdf');
 hint.textContent='PDF auswählen, um den Beleg direkt neben den Eingabefeldern zu sehen.';
 link.hidden=true;link.removeAttribute('href');
}
function setPreview(type,url,download,description){
 const frame=el(type==='offer'?'offerPdfFrame':'uploadPdfFrame');
 const hint=el(type==='offer'?'offerPdfHint':'uploadPdfHint');
 const link=el(type==='offer'?'offerPdfDownload':'uploadPdfDownload');
 if(!url){clearPreview(type);return}
 if(frame.getAttribute('src')!==url)frame.src=url;frame.classList.add('has-pdf');
 hint.textContent=description||'Lokale PDF-Vorschau';
 link.hidden=!download;if(download)link.href=download;
}
function showSavedPdf(type,docId){
 const documentInfo=(state.documents||[]).find(d=>d.id===docId);
 // Beim unmittelbar neuen Upload kann die Liste noch nicht neu geladen sein.
 const url='/api/documents/'+docId+'/view';
 setPreview(type,url,'/api/documents/'+docId+'/download',documentInfo?.name||'Angebot-PDF');
}
window.showOfferPdf=offerId=>{
 const offer=(state.offers||[]).find(o=>o.id===offerId);
 if(offer?.document_id){
   showSavedPdf('offer',offer.document_id);
   el('offerPdfFrame').dataset.documentId=String(offer.document_id);
 }
};
window.previewLocalPdf=(type,file)=>{
 if(type==='offer' && offerObjectUrl)URL.revokeObjectURL(offerObjectUrl);
 if(type==='upload' && uploadObjectUrl)URL.revokeObjectURL(uploadObjectUrl);
 if(!file||!(/\.pdf$/i.test(file.name)||file.type==='application/pdf')){
   clearPreview(type);return;
 }
 const objectUrl=URL.createObjectURL(file);
 if(type==='offer')offerObjectUrl=objectUrl;else uploadObjectUrl=objectUrl;
 setPreview(type,objectUrl,null,file.name+' · noch nicht gespeichert');
};
el('uploadForm').elements.namedItem('file').addEventListener('change',e=>window.previewLocalPdf('upload',e.target.files[0]));
