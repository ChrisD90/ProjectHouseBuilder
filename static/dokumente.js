(() => {
'use strict';
const $=id=>document.getElementById(id);
const safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let records=[],options=null;
const uploadDialog=$('docUploadDialog');
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
 const q=$('docSearch').value.toLocaleLowerCase('de').trim(),
   area=$('docFilterArea').value,status=$('docFilterStatus').value;
 const list=records.filter(d=>[d.title,d.filename,d.area,d.category,d.tags,d.description]
   .join(' ').toLocaleLowerCase('de').includes(q)
   &&(!area||d.area===area)&&(!status||d.status===status));
 $('docCount').textContent=list.length+' von '+records.length+' Dokumenten';
 const container=$('docList');container.replaceChildren();
 if(!list.length){const p=document.createElement('p');p.textContent='Keine passenden Dokumente vorhanden.';container.append(p);}
 for(const doc of list){
   const row=document.createElement('article');row.className='docs-item';
   const info=document.createElement('div');info.className='docs-item-text';
   const meta=document.createElement('div');meta.className='docs-item-meta';
   for(const item of [doc.category,doc.area,doc.status]){
     const span=document.createElement('span');span.className='docs-chip';span.textContent=item;meta.append(span);
   }
   const heading=document.createElement('h3');heading.textContent=doc.title;
   const details=document.createElement('p');details.textContent=doc.description||doc.filename;
   const subtitle=document.createElement('small');
   subtitle.textContent='DOK-'+doc.id+' · '+doc.filename+' · '+(doc.size_bytes/1048576).toFixed(2)+' MB'+(doc.tags?' · '+doc.tags:'');
   info.append(meta,heading,details,subtitle);
   if(doc.extraction_note){const note=document.createElement('small');note.textContent=doc.extraction_note;info.append(note);}
   const actions=document.createElement('div');actions.className='docs-item-actions';
   const link=document.createElement('a');link.href='/api/project-documents/'+doc.id+'/download';link.textContent='Original herunterladen';
   if(['.pdf','.jpg','.jpeg','.png','.webp','.txt'].includes(doc.extension)){
     const preview=document.createElement('a');
     preview.href='/api/project-documents/'+doc.id+'/preview';
     preview.target='_blank';preview.rel='noopener noreferrer';preview.textContent='Vorschau';
     actions.append(preview);
   }
   const button=document.createElement('button');button.type='button';button.textContent='Bearbeiten';button.onclick=()=>edit(doc.id);
   actions.append(link,button);row.append(info,actions);container.append(row);
 }
}
async function reload(){
 const result=await api('/api/project-documents');records=result.documents||[];
 if(!options){options=result;setup();}
 refresh();
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
 if(!confirm('Originaldokument endgültig löschen? Der Quellenvermerk in der Entscheidungshistorie bleibt erhalten.'))return;
 try{await api('/api/project-documents/'+id,'DELETE');$('docEditDialog').close();
   await reload();report('Dokument gelöscht.',false,'docPageStatus');}
 catch(err){report(err.message,true,'docEditMessage');}
};
reload().then(()=>{
 const documentId=Number(new URLSearchParams(location.search).get('document_id'));
 if(documentId)edit(documentId);
}).catch(err=>report(err.message,true,'docPageStatus'));
})();