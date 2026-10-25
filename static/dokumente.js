(() => {
'use strict';
const $=id=>document.getElementById(id);
const safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let records=[],library=[],options=null;
const uploadDialog=$('docUploadDialog');
let uploadRunning=false;
const uploadFlow=PHBFlow.manage({
 dialog:'docUploadDialog',forms:['projectDocumentUpload'],
 dismiss:['closeDocUpload'],isBusy:()=>uploadRunning
});
const editFlow=PHBFlow.manage({
 dialog:'docEditDialog',forms:['docEditForm'],dismiss:['docClose']
});
$('openDocUpload').onclick=()=>uploadFlow.open();
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
const LINKED_GROUPS=[
  {source:'Angebote',title:'Angebote & Auftragsbestätigungen',description:'Aktuelle und frühere Angebots-PDFs sowie zugehörige Auftragsbestätigungen.',href:'/angebote',label:'Angebote öffnen'},
  {source:'Rechnungen & Belege',title:'Rechnungen & Belege',description:'Gebuchte Rechnungen, Entwürfe und Kassenzettel.',href:'/belege',label:'Rechnungen öffnen'},
  {source:'Finanzierung',title:'Kredite & Finanzierung',description:'Kreditverträge und weitere Unterlagen zu den Finanzierungsquellen.',href:'/finanzierung',label:'Finanzierung öffnen'},
  {source:'Weitere Projektunterlagen',title:'Weitere Kostenunterlagen',description:'Verträge und zugeordnete Kostenbelege außerhalb des Angebots- und Rechnungsjournals.',href:'/kosten#kosten-unterlagen',label:'Kostenunterlagen öffnen'}
];
function documentMatches(doc,search){
  return [doc.title,doc.filename,doc.type,doc.source,doc.status,doc.description]
    .join(' ').toLocaleLowerCase('de').includes(search);
}
function documentRow(doc,editable){
  const row=document.createElement('article');row.className='docs-item';
  const info=document.createElement('div');info.className='docs-item-text';
  const meta=document.createElement('div');meta.className='docs-item-meta';
  for(const value of [doc.type,doc.status]){
    if(!value)continue;
    const chip=document.createElement('span');chip.className='docs-chip';
    chip.textContent=value;meta.append(chip);
  }
  const heading=document.createElement('h3');heading.textContent=doc.title||doc.filename;
  const description=document.createElement('p');description.textContent=doc.description||doc.filename;
  const subtitle=document.createElement('small');
  subtitle.textContent=doc.filename+(doc.date?' · '+doc.date.slice(0,10):'');
  info.append(meta,heading,description,subtitle);
  const actions=document.createElement('div');actions.className='docs-item-actions';
  if(doc.view_url){
    const preview=document.createElement('a');preview.href=doc.view_url;
    preview.target='_blank';preview.rel='noopener noreferrer';preview.textContent='Ansehen';
    actions.append(preview);
  }
  if(doc.download_url){
    const download=document.createElement('a');download.href=doc.download_url;
    download.textContent='Original herunterladen';actions.append(download);
  }
  if(editable&&doc.project_document_id){
    const button=document.createElement('button');button.type='button';button.textContent='Bearbeiten';
    button.onclick=()=>edit(doc.project_document_id);actions.append(button);
  }else if(!editable&&doc.module_url){
    const moduleLink=document.createElement('a');moduleLink.href=doc.module_url;
    moduleLink.textContent='Im Fachbereich öffnen';moduleLink.className='docs-owner-link';
    actions.append(moduleLink);
  }
  row.append(info,actions);
  return row;
}
function refresh(){
  const search=$('docSearch').value.toLocaleLowerCase('de').trim();
  const area=$('docFilterArea').value,status=$('docFilterStatus').value;
  const general=library.filter(doc=>Boolean(doc.project_document_id));
  const filtered=general.filter(doc=>
    documentMatches(doc,search)
    &&(!area||records.some(record=>record.id===doc.project_document_id&&record.area===area))
    &&(!status||doc.status===status));
  $('docCount').textContent=filtered.length+' von '+general.length+' Unterlagen';
  const list=$('docList');list.replaceChildren();
  if(!filtered.length){
    const message=document.createElement('p');message.className='docs-empty';
    message.textContent=general.length?'Keine passenden allgemeinen Projektdokumente.':'Noch keine allgemeinen Projektdokumente hochgeladen.';
    list.append(message);
  }
  for(const doc of filtered)list.append(documentRow(doc,true));
  refreshLinked();
}
function refreshLinked(){
  const search=$('linkedDocSearch').value.toLocaleLowerCase('de').trim();
  const source=$('linkedDocType').value;
  const linked=library.filter(doc=>!doc.project_document_id);
  const matching=linked.filter(doc=>documentMatches(doc,search)&&(!source||doc.source===source));
  $('linkedDocCount').textContent=matching.length+' von '+linked.length+' Dateien · nur Ansicht';
  const host=$('linkedDocGroups');host.replaceChildren();
  for(const group of LINKED_GROUPS){
    if(source&&group.source!==source)continue;
    const files=matching.filter(doc=>doc.source===group.source);
    const section=document.createElement('section');section.className='docs-linked-group';
    section.id='docs-group-'+group.source.toLowerCase().replace(/[^a-z]+/g,'-');
    const header=document.createElement('div');header.className='docs-linked-group-head';
    const headText=document.createElement('div');
    const title=document.createElement('h3');title.textContent=group.title;
    const details=document.createElement('p');details.textContent=group.description;
    headText.append(title,details);
    const count=document.createElement('span');count.className='docs-chip';
    count.textContent=files.length+' Datei'+(files.length===1?'':'en');
    const moduleLink=document.createElement('a');moduleLink.href=group.href;
    moduleLink.textContent=group.label;moduleLink.className='docs-owner-link';
    header.append(headText,count,moduleLink);
    const list=document.createElement('div');list.className='docs-list';
    if(!files.length){
      const empty=document.createElement('p');empty.className='docs-empty';
      empty.textContent=search?'Keine Treffer in diesem Fachbereich.':'Noch keine Dokumente aus diesem Fachbereich.';
      list.append(empty);
    }
    for(const doc of files)list.append(documentRow(doc,false));
    section.append(header,list);
    host.append(section);
  }
}
async function reload(){
  const [projectFiles,libraryFiles]=await Promise.all([
    api('/api/project-documents'),api('/api/document-library')
  ]);
  records=projectFiles.documents||[];
  library=libraryFiles.documents||[];
  if(!options){options=projectFiles;setup();}
  refresh();
}
function edit(id){
 const doc=records.find(d=>d.id===id);if(!doc)return;
 const form=$('docEditForm');form.reset();
 for(const key of ['id','title','category','area','status','tags','description'])
   form.elements.namedItem(key).value=doc[key]??'';
 report('',false,'docEditMessage');editFlow.open();
}
$('docSearch').addEventListener('input',refresh);
$('docFilterArea').addEventListener('change',refresh);
$('docFilterStatus').addEventListener('change',refresh);
$('linkedDocSearch').addEventListener('input',refreshLinked);
$('linkedDocType').addEventListener('change',refreshLinked);
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