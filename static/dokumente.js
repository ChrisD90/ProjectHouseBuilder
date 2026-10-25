(() => {
'use strict';
const $=id=>document.getElementById(id);
const safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let records=[],library=[],options=null,costInfo=null;
const uploadDialog=$('docUploadDialog');
const costDocumentDialog=$('costDocumentDialog');
let costDocumentUploading=false;
$('openCostUpload').onclick=()=>costDocumentDialog.showModal();
$('closeCostUpload').onclick=()=>{if(!costDocumentUploading)costDocumentDialog.close();};
costDocumentDialog.addEventListener('cancel',e=>{if(costDocumentUploading)e.preventDefault();});
costDocumentDialog.addEventListener('click',e=>{
  if(e.target===costDocumentDialog&&!costDocumentUploading)costDocumentDialog.close();
});
$('uploadForm').onsubmit=async e=>{
  e.preventDefault();if(costDocumentUploading)return;
  const button=e.currentTarget.querySelector('button[type="submit"]');
  costDocumentUploading=true;button.disabled=true;
  $('uploadMessage').textContent='Originaldatei wird gespeichert …';
  try{
    const result=await fetch('/api/documents',{method:'POST',body:new FormData(e.currentTarget)});
    const payload=await result.json();
    if(!result.ok)throw Error(payload.error||'Hochladen fehlgeschlagen.');
    e.currentTarget.reset();await reload();
    $('uploadMessage').textContent='Originaldatei gespeichert und in der Gesamtliste ergänzt.';
    costDocumentDialog.close();
  }catch(error){$('uploadMessage').textContent=error.message;}
  finally{costDocumentUploading=false;button.disabled=false;}
};

let uploadRunning=false;
$('openDocUpload').onclick=()=>uploadDialog.showModal();
$('closeDocUpload').onclick=()=>{if(!uploadRunning)uploadDialog.close();};
uploadDialog.addEventListener('cancel',e=>{if(uploadRunning)e.preventDefault();});
uploadDialog.addEventListener('click',e=>{
 if(e.target===uploadDialog&&!uploadRunning)uploadDialog.close();
});
const report=(msg,error=false,id='docMessage')=>{const n=$(id);n.textContent=msg;n.classList.toggle('error',error);};
async function api(url,method='GET',data){
 const opts={method};
 if(data instanceof FormData)opts.body=data;
 else if(data!==undefined){opts.headers={'Content-Type':'application/json'};opts.body=JSON.stringify(data);}
 const response=await fetch(url,opts);const body=await response.json();
 if(!response.ok)throw Error(body.error||'Dokumentanfrage fehlgeschlagen.');
 return body;
}
function selectOptions(id,items,empty){
 const node=$(id);node.replaceChildren();
 if(empty)node.add(new Option(empty,''));
 for(const item of items)node.add(new Option(item,item));
}
function setup(){
 for(const mode of ['Upload','Edit']){
   selectOptions('doc'+mode+'Category',options.categories);
   selectOptions('doc'+mode+'Area',options.areas);
   selectOptions('doc'+mode+'Status',options.statuses);
 }
 selectOptions('docFilterArea',options.areas,'Alle Bereiche');
 selectOptions('docFilterStatus',options.statuses,'Alle');
 $('docUploadStatus').value='Aktuell';
 $('docUploadCategory').value='Bauplan';
}
function refresh(){
  const q=$('docSearch').value.toLocaleLowerCase('de').trim();
  const area=$('docFilterArea').value,status=$('docFilterStatus').value;
  const filtered=library.filter(d=>
    [d.title,d.filename,d.type,d.source,d.status,d.description].join(' ')
      .toLocaleLowerCase('de').includes(q)
    &&(!area||d.source==='Projektdokumente' && records.some(x=>x.id===d.project_document_id && x.area===area))
    &&(!status||d.status===status));
  $('docCount').textContent=filtered.length+' von '+library.length+' Dateien · alle Fachbereiche';
  const container=$('docList');container.replaceChildren();
  if(!filtered.length){
    const p=document.createElement('p');p.textContent='Keine passenden Dokumente vorhanden.';container.append(p);
  }
  for(const doc of filtered){
    const row=document.createElement('article');row.className='docs-item';
    const info=document.createElement('div');info.className='docs-item-text';
    const meta=document.createElement('div');meta.className='docs-item-meta';
    for(const item of [doc.source,doc.type,doc.status]){
      if(!item)continue;
      const span=document.createElement('span');span.className='docs-chip';span.textContent=item;meta.append(span);
    }
    const heading=document.createElement('h3');heading.textContent=doc.title;
    const details=document.createElement('p');details.textContent=doc.description||doc.filename;
    const subtitle=document.createElement('small');
    subtitle.textContent=doc.filename+(doc.date?' · '+doc.date.slice(0,10):'');
    info.append(meta,heading,details,subtitle);
    const actions=document.createElement('div');actions.className='docs-item-actions';
    if(doc.view_url){
      const preview=document.createElement('a');preview.href=doc.view_url;
      preview.target='_blank';preview.rel='noopener noreferrer';preview.textContent='Vorschau';
      actions.append(preview);
    }
    const link=document.createElement('a');link.href=doc.download_url;
    link.textContent='Original herunterladen';actions.append(link);
    if(doc.project_document_id){
      const button=document.createElement('button');button.type='button';button.textContent='Bearbeiten';
      button.onclick=()=>edit(doc.project_document_id);actions.append(button);
    }else if(doc.module_url){
      const back=document.createElement('a');back.href=doc.module_url;
      back.textContent='Im Fachbereich öffnen';actions.append(back);
    }
    row.append(info,actions);container.append(row);
  }
}
function optionsMarkup(values,title){
  return '<option value="">Keine Zuordnung</option>'+
    values.map(x=>'<option value="'+safe(x.id)+'">'+safe(x[title])+'</option>').join('');
}
function renderCostAttachments(){
  if(!costInfo)return;
  const contractors=new Map((costInfo.contractors||[]).map(x=>[x.id,x.name]));
  const budget=new Map((costInfo.budget_lines||[]).map(x=>[x.id,x.title]));
  const attachmentList=costInfo.documents||[];
  $('documents').innerHTML=attachmentList.map(d=>`<tr><td><a href="/api/documents/${d.id}/download">${safe(d.name)}</a></td>
    <td>${safe(d.kind)}</td><td>${safe(contractors.get(d.contractor_id)||'–')}</td>
    <td>${safe(budget.get(d.budget_line_id)||(costInfo.items||[]).find(i=>i.id===d.cost_item_id)?.title||'–')}</td>
    <td>${safe(d.notes)}</td><td>${safe((d.uploaded_at||'').slice(0,10))}</td>
    <td><button type="button" class="mini" data-delete-doc="${d.id}">Löschen</button></td></tr>`).join('')
    ||'<tr><td colspan="7">Keine weiteren zugeordneten Projektunterlagen.</td></tr>';
  for(const [node,values,title] of [
    ['fileContractor',costInfo.contractors||[],'name'],
    ['fileBudget',(costInfo.budget_lines||[]).filter(x=>!x.is_group),'title'],
    ['fileCost',costInfo.items||[],'title']
  ]){
    $(node).innerHTML=optionsMarkup(values,title);
  }
  $('documents').querySelectorAll('[data-delete-doc]').forEach(button=>{
    button.onclick=async()=>{
      if(!await PHBUI.confirm('Diese zugeordnete Projektunterlage endgültig löschen?'))return;
      try{await api('/api/documents/'+button.dataset.deleteDoc,'DELETE');await reload();
        report('Dokument gelöscht.',false,'docPageStatus');}
      catch(error){report(error.message,true,'docPageStatus');}
    };
  });
}
async function reload(){
  const [projectFiles,libraryFiles,costs]=await Promise.all([
    api('/api/project-documents'),api('/api/document-library'),api('/api/costs')
  ]);
  records=projectFiles.documents||[];
  library=libraryFiles.documents||[];
  costInfo=costs;
  if(!options){options=projectFiles;setup();}
  refresh();renderCostAttachments();
}
function edit(id){
 const doc=records.find(d=>d.id===id);if(!doc)return;
 const form=$('docEditForm');form.reset();
 for(const key of ['id','title','category','area','status','tags','description'])
   form.elements.namedItem(key).value=doc[key]??'';
 report('',false,'docEditMessage');$('docEditDialog').showModal();
}
$('docSearch').addEventListener('input',refresh);
$('docFilterArea').addEventListener('change',refresh);
$('docFilterStatus').addEventListener('change',refresh);
$('projectDocumentUpload').elements.namedItem('files').addEventListener('change',event=>{
 const name=event.target.files?.[0]?.name;
 const input=$('projectDocumentUpload').elements.namedItem('title');
 if(name&&!input.value)input.value=name.replace(/\.[^.]+$/,'');
});
$('projectDocumentUpload').onsubmit=async e=>{
 e.preventDefault();
 if(uploadRunning)return;
 const form=$('projectDocumentUpload'),btn=$('docUploadButton');
 btn.disabled=true;uploadRunning=true;report('Dateien werden für das lokale Einlesen vorbereitet …');
 try{
   const data=new FormData(form),fields={};
   for(const [key,value] of data.entries())if(key!=='files')fields[key]=value;
   const jobs=await window.PHBImports.enqueue({
     kind:'documents',files:form.elements.namedItem('files').files,
     analysisMode:'local',fields
   });
   form.reset();report(jobs.length+' Projektunterlage(n) in der Warteschlange.');
   uploadDialog.close();
 }catch(err){report(err.message,true);}
 finally{btn.disabled=false;uploadRunning=false;}
};
document.addEventListener('phb-import-updated',event=>{
 if(event.detail.kind==='documents'&&!$('docEditDialog').open)reload().catch(()=>{});
});

$('docClose').onclick=()=>$('docEditDialog').close();
$('docEditForm').onsubmit=async e=>{
 e.preventDefault();const data=Object.fromEntries(new FormData($('docEditForm')));
 const id=data.id;delete data.id;
 try{await api('/api/project-documents/'+id,'PATCH',data);
   $('docEditDialog').close();await reload();report('Dokumentdetails gespeichert.',false,'docPageStatus');}
 catch(err){report(err.message,true,'docEditMessage');}
};
$('docDelete').onclick=async()=>{
 const id=$('docEditForm').elements.namedItem('id').value;
 if(!await PHBUI.confirm('Originaldokument endgültig löschen? Der Quellenvermerk in der Entscheidungshistorie bleibt erhalten.'))return;
 try{await api('/api/project-documents/'+id,'DELETE');$('docEditDialog').close();
   await reload();report('Dokument gelöscht.',false,'docPageStatus');}
 catch(err){report(err.message,true,'docEditMessage');}
};
reload().then(()=>{
 const documentId=Number(new URLSearchParams(location.search).get('document_id'));
 if(documentId)edit(documentId);
}).catch(err=>report(err.message,true,'docPageStatus'));
})();