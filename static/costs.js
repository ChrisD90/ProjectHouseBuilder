'use strict';
let state={},mode='',current=null,ownedDocumentIds=new Set();
const el=id=>document.getElementById(id), euro=x=>new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'}).format(Number(x)||0), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nf=x=>new Intl.NumberFormat('de-DE',{maximumFractionDigits:1}).format(x||0);
const fields={
 cost:[['category','Gewerk / Kategorie','category'],['title','Bezeichnung'],['kind','Leistungsart','choice',['Fremdleistung','Eigenleistung']],['state','Stand (zusätzliche Kostenposition)','choice',['Schätzung','Beauftragt','Abgeschlossen','Alternative','Abgelehnt']],['budget_line_id','Kostenplanposition','budget'],['selected','Für Prognose auswählen (nur ein Angebot pro Planposition)','bool'],['contractor_id','Firma','contractor'],['task_id','Gantt-Arbeitspaket','task'],['estimate','Kostenschätzung (€)','money'],['offer','Bekannter Preis (€) – kein Angebot','money'],['committed','Beauftragter Wert (€)','money'],['paid','Bereits bezahlt (€)','money'],['own_hours','Eigenleistungsstunden','number'],['own_hourly','Kalkulatorischer Stundenwert (nur Informationswert)','money'],['source_ref','Angebots- / Vertragsreferenz'],['notes','Notizen','textarea']],
 budget:[['category','Gewerk','category'],['title','Position'],['parent_code','Unterposition von','parent'],['kind','Leistungsart','choice',['Fremdleistung','Eigenleistung']],['estimate','Schätzung (€)','money'],['company_hint','Firmenhinweis (unverbindlich)'],['notes','Notizen','textarea'],['active','In Prognose einbeziehen','bool'],['is_group','Nur Gruppenüberschrift, nicht summieren','bool']],
 funding:[['name','Fördermaßnahme'],['expected','Erwarteter Förderbetrag (€)','money'],['confirmed','Bewilligter Betrag (€)','money'],['received','Ausgezahlter Betrag (€)','money'],['notes','Notizen','textarea']]
};
async function api(url,opts={}){const r=await fetch(url,{...opts,headers:opts.body?{'Content-Type':'application/json'}:{}});const d=await r.json();if(!r.ok)throw Error(d.error||'Unbekannter Fehler');return d}
async function reload(){
 const [costs,docs]=await Promise.all([api('/api/costs'),api('/api/document-library')]);
 state=costs;
 ownedDocumentIds=new Set((docs.documents||[]).filter(d=>d.source==='Weitere Projektunterlagen')
   .map(d=>d.legacy_document_id));
 render();
}
function fmtcell(n){return `<td class="amount">${euro(n)}</td>`}
function render(){const s=state.summary;
 for(const [key,val] of Object.entries({budget:euro(s.budget),planned:euro(s.planned),overrun:(s.overrun>0?'+':'')+euro(s.overrun),committed:euro(s.committed),paid:euro(s.paid),remaining:euro(s.remaining),ownbudget:euro(s.own_budget),hours:nf(s.own_hours)+' h',ownvalue:'Kalkulatorisch: '+euro(s.own_imputed_value)}))el(key).textContent=val;
 el('overrun').className=s.overrun>0?'negative':'positive';
 el('budgetNotice').textContent=`Dein Kostenplan enthält ${euro(s.categories.reduce((a,c)=>a+c.estimate,0))} an geschätzten Positionen. Ein angenommenes Angebot ersetzt bei Zuordnung den jeweiligen Schätzwert. Du verwaltest Angebote ausschließlich unter „Angebote“ in der Sidebar.`;
 el('categories').innerHTML=s.categories.map(c=>`<tr><td>${esc(c.category)}</td>${fmtcell(c.estimate)}${fmtcell(c.planned)}${fmtcell(c.paid)}${fmtcell(c.planned-c.estimate)}</tr>`).join('')||'<tr><td colspan="5">Keine Einträge</td></tr>';
 const q=el('budgetSearch').value.toLowerCase().trim();
 el('budgetrows').innerHTML=state.budget_lines.filter(b=>(b.category+' '+b.title+' '+b.company_hint).toLowerCase().includes(q)).map(b=>`<tr class="${b.is_group?'group-row':''}"><td>${esc(b.category)}<div class="${b.parent_code?'child-title':'muted'}">${b.parent_code?'↳ ':''}${esc(b.title)}</div></td><td>${b.is_group?'Gruppe':esc(b.kind)}</td><td>${esc(b.company_hint)}</td>${fmtcell(b.is_group?0:b.estimate)}${fmtcell(s.line_forecasts[b.id]??0)}<td><span class="hint-pill">${esc(s.line_basis[b.id]??(b.is_group?'Gruppenzeile':'Inaktiv'))}</span></td><td><button class="mini" data-budget="${b.id}">Bearbeiten</button></td></tr>`).join('')||'<tr><td colspan="7">Keine passenden Positionen</td></tr>';
 const contractors=new Map(state.contractors.map(x=>[x.id,x.name])); const budget=new Map(state.budget_lines.map(x=>[x.id,x.title]));
 el('costrows').innerHTML=state.items.filter(c=>!c.offer_id).map(c=>`<tr><td>${esc(c.category)}</td><td>${esc(c.title)}${c.kind==='Eigenleistung'?`<div class="muted">${nf(c.own_hours)} h Eigenarbeit</div>`:''}</td><td>${esc(c.state)}</td><td>${esc(budget.get(c.budget_line_id)||'Zusätzliche Position')}</td><td>${esc(contractors.get(c.contractor_id)||'–')}</td>${fmtcell(c.offer)}${fmtcell(c.committed)}${fmtcell(c.paid)}<td>${c.selected?'✓':'–'}</td><td><button class="mini" data-cost="${c.id}">Bearbeiten</button></td></tr>`).join('')||'<tr><td colspan="10">Noch keine zusätzlichen Kosten erfasst. Angebote findest du links unter „Angebote“.</td></tr>';
 const ownLines=state.budget_lines.filter(b=>b.kind==='Eigenleistung'&&b.active&&!b.is_group);
 const ownExtras=state.items.filter(i=>i.kind==='Eigenleistung'&&!i.budget_line_id&&!['Alternative','Abgelehnt'].includes(i.state));
 const ownRows=ownLines.map(b=>{const entries=state.items.filter(i=>i.kind==='Eigenleistung'&&i.budget_line_id===b.id);
 const hours=entries.reduce((a,i)=>a+Number(i.own_hours||0),0);const workValue=entries.reduce((a,i)=>a+Number(i.own_hours||0)*Number(i.own_hourly||0),0);
 return `<tr><td>${esc(b.title)}</td>${fmtcell(b.estimate)}${fmtcell(s.line_forecasts[b.id]??b.estimate)}<td>${nf(hours)} h</td>${fmtcell(workValue)}<td>${entries.length}</td><td><button class="mini" data-own="${b.id}">Erfassen</button></td></tr>`}).join('');
 const extraRows=ownExtras.map(i=>`<tr><td>${esc(i.title)} <small class="muted">(zusätzliche Leistung)</small></td>${fmtcell(i.estimate)}${fmtcell(i.committed||i.offer||i.estimate)}<td>${nf(i.own_hours)} h</td>${fmtcell(i.own_hours*i.own_hourly)}<td>1</td><td><button class="mini" data-ownedit="${i.id}">Bearbeiten</button></td></tr>`).join('');
 el('ownworkrows').innerHTML=ownRows+extraRows||'<tr><td colspan="7">Noch keine Eigenleistungen angelegt.</td></tr>';
 document.querySelectorAll('[data-own]').forEach(btn=>btn.onclick=()=>openEditor('cost',null,{budget_line_id:Number(btn.dataset.own),kind:'Eigenleistung',category:state.budget_lines.find(x=>x.id===Number(btn.dataset.own))?.category||'Eigenleistung',title:state.budget_lines.find(x=>x.id===Number(btn.dataset.own))?.title||'Eigenleistung',state:'Schätzung'}));
 document.querySelectorAll('[data-ownedit]').forEach(btn=>btn.onclick=()=>openEditor('cost',Number(btn.dataset.ownedit)));
 el('fundingrows').innerHTML=state.funding.map(f=>`<tr><td>${esc(f.name)}</td>${fmtcell(f.expected)}${fmtcell(f.confirmed)}${fmtcell(f.received)}<td>${esc(f.notes)}</td><td><button class="mini" data-funding="${f.id}">Bearbeiten</button></td></tr>`).join('');
 el('fundingExpected').textContent=euro(s.funding_expected);el('fundingConfirmed').textContent=euro(s.funding_confirmed);el('net').textContent=euro(s.net_after_confirmed);

 renderCostDocuments();
 for(const typ of ['budget','cost','funding'])document.querySelectorAll('[data-'+typ+']').forEach(btn=>btn.addEventListener('click',()=>openEditor(typ,Number(btn.dataset[typ]))));
 
}
const sources={budget:'budget_lines',cost:'items',funding:'funding'};
function selector(key,val){let arr=key==='budget_line_id'?state.budget_lines.filter(x=>!x.is_group):key==='contractor_id'?state.contractors:key==='task_id'?state.tasks:state.budget_lines.filter(x=>x.is_group);let o=`<option value="">Keine Zuordnung</option>`;return o+arr.map(x=>`<option value="${esc(key==='parent_code'?x.code:x.id)}" ${String(val??'')===String(key==='parent_code'?x.code:x.id)?'selected':''}>${esc(key==='task_id'?x.code+' · '+x.name:key==='contractor_id'?x.name:x.category+' · '+x.title)}</option>`).join('')}
function openEditor(type,id=null,defaults={}){mode=type;current=id;const record=(state[sources[type]]||[]).find(x=>x.id===id)||defaults;el('editTitle').textContent=(id?'Bearbeiten: ':'Neu: ')+({budget:'Kostenplanposition',cost:'Weitere Kosten / Eigenleistung',funding:'Förderung'}[type]);el('formError').textContent='';el('remove').hidden=!id||type==='funding';
 el('editFields').innerHTML=fields[type].map(([key,label,kind,options])=>{const value=record[key]??(kind==='bool'?(key==='active'?true:false):'');let control;
 if(kind==='choice')control=`<select name="${key}">${(value&&!options.includes(value)?[...options,value]:options).map(o=>`<option value="${esc(o)}" ${o===value?'selected':''}>${esc(o)}</option>`).join('')}</select>`;
 else if(kind==='category'){
   const names=[...new Set([...(state.offer_categories||[]),value||'Sonstiges'])].filter(Boolean);
   const selected=value||'Sonstiges';
   control=`<select name="${key}" required>${names.map(o=>`<option value="${esc(o)}" ${o===selected?'selected':''}>${esc(o)}</option>`).join('')}</select><small><a href="/stammdaten#kategorien">Kategorien in Stammdaten pflegen</a></small>`;
 }
 else if(['budget','contractor','task','parent'].includes(kind))control=`<select name="${key}">${selector(key,value)}</select>`;
 else if(kind==='bool')control=`<input name="${key}" type="checkbox" value="true" ${value?'checked':''} style="width:20px;height:20px">`;
 else if(kind==='textarea')control=`<textarea name="${key}" rows="3">${esc(value)}</textarea>`;
 else control=`<input name="${key}" type="${kind==='number'?'number':'text'}" ${kind==='number'?'min="0" step="0.01"':kind==='money'?'inputmode="decimal" data-euro="true"':''} ${['title','name'].includes(key)?'required':''} value="${esc(value)}">`;
 return `<label class="${kind==='textarea'?'wide':''}">${esc(label)}${control}</label>`}).join('');el('editor').showModal()}
async function saveEditor(e){e.preventDefault();PHBUI.currency.normalizeForm(e.target);const data=Object.fromEntries(new FormData(e.target));for(const key of ['selected','active','is_group'])if(fields[mode].some(x=>x[0]===key))data[key]=e.target.elements.namedItem(key).checked;
 const urls={cost:'/api/costs',budget:'/api/budget/lines',funding:'/api/funding'};
 const method=current?'PUT':'POST',url=urls[mode]+(current?'/'+current:'');
 try{await api(url,{method,body:JSON.stringify(data)});el('editor').close();await reload()}catch(err){el('formError').textContent=err.message}}
async function removeEditor(){if(!current||!await PHBUI.confirm('Diesen Eintrag wirklich löschen?'))return;const urls={cost:'/api/costs/',budget:'/api/budget/lines/'};if(!urls[mode])return;try{await api(urls[mode]+current,{method:'DELETE'});el('editor').close();await reload()}catch(e){el('formError').textContent=e.message}}
el('addOwnWork').onclick=()=>openEditor('cost',null,{kind:'Eigenleistung',category:'Eigenleistung',state:'Schätzung'});
el('budgetSearch').addEventListener('input',render);el('editForm').addEventListener('submit',saveEditor);el('remove').addEventListener('click',removeEditor);el('closeDialog').addEventListener('click',()=>el('editor').close());el('cancelDialog').addEventListener('click',()=>el('editor').close());
for(const type of ['Budget','Cost','Funding'])el('add'+(type==='Budget'?'Line':type)).addEventListener('click',()=>openEditor(type.toLowerCase()));

const costDocumentDialog=el('costDocumentDialog');
let costDocumentUploading=false;
el('openCostUpload').onclick=()=>costDocumentDialog.showModal();
el('closeCostUpload').onclick=()=>{if(!costDocumentUploading)costDocumentDialog.close()};
costDocumentDialog.addEventListener('cancel',e=>{if(costDocumentUploading)e.preventDefault()});
costDocumentDialog.addEventListener('click',e=>{
 if(e.target===costDocumentDialog&&!costDocumentUploading)costDocumentDialog.close();
});
function costDocumentChoices(node,rows,label){
 node.innerHTML='<option value="">Keine Zuordnung</option>'+
   rows.map(item=>'<option value="'+esc(item.id)+'">'+esc(item[label])+'</option>').join('');
}
function renderCostDocuments(){
 const contractors=new Map((state.contractors||[]).map(c=>[c.id,c.name]));
 const budget=new Map((state.budget_lines||[]).map(b=>[b.id,b.title]));
 const linked=(state.documents||[]).filter(d=>ownedDocumentIds.has(d.id));
 el('documents').innerHTML=linked.map(doc=>`<tr>
  <td><a href="/api/documents/${doc.id}/download">${esc(doc.name)}</a></td>
  <td>${esc(doc.kind)}</td><td>${esc(contractors.get(doc.contractor_id)||'–')}</td>
  <td>${esc(budget.get(doc.budget_line_id)||(state.items||[]).find(i=>i.id===doc.cost_item_id)?.title||'–')}</td>
  <td>${esc(doc.notes)}</td><td>${esc((doc.uploaded_at||'').slice(0,10))}</td>
  <td><button type="button" class="mini" data-delete-cost-document="${doc.id}">Löschen</button></td></tr>`).join('')
  ||'<tr><td colspan="7">Noch keine weiteren Kostenunterlagen zugeordnet.</td></tr>';
 costDocumentChoices(el('fileContractor'),state.contractors||[],'name');
 costDocumentChoices(el('fileBudget'),(state.budget_lines||[]).filter(b=>!b.is_group),'title');
 costDocumentChoices(el('fileCost'),state.items||[],'title');
 el('documents').querySelectorAll('[data-delete-cost-document]').forEach(button=>{
  button.onclick=async()=>{
   const id=Number(button.dataset.deleteCostDocument);
   if(!ownedDocumentIds.has(id))return;
   if(!await PHBUI.confirm('Diese zugeordnete Kostenunterlage und ihre Originaldatei endgültig löschen?'))return;
   button.disabled=true;
   try{
    await api('/api/documents/'+id,{method:'DELETE'});
    await reload();
   }catch(error){await PHBUI.alert(error.message);button.disabled=false;}
  };
 });
}
el('uploadForm').onsubmit=async e=>{
 e.preventDefault();if(costDocumentUploading)return;
 const form=e.currentTarget,button=form.querySelector('button[type=submit]');
 costDocumentUploading=true;button.disabled=true;
 el('uploadMessage').textContent='Kostenunterlage wird gespeichert …';
 try{
  const resp=await fetch('/api/documents',{method:'POST',body:new FormData(form)});
  const data=await resp.json();
  if(!resp.ok)throw Error(data.error||'Upload fehlgeschlagen.');
  form.reset();
  await reload();
  costDocumentDialog.close();
 }catch(error){el('uploadMessage').textContent=error.message;}
 finally{costDocumentUploading=false;button.disabled=false;}
};

reload().catch(e=>PHBUI.alert('Kostenverwaltung kann nicht geladen werden: '+e.message));

