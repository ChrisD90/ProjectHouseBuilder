'use strict';
(() => {
  const get=id=>document.getElementById(id);
  const phrase='ALLE DATEN LÖSCHEN';
  const restorePhrase='BACKUP WIEDERHERSTELLEN';
  let config=null, pendingBackup=false, verifiedRef=null, restoring=false;
  const backupFlow=PHBFlow.manage({
    dialog:'backupConfigDialog',forms:['backupConfigForm'],
    dismiss:['backupConfigCancel'],
    onClose:()=>{pendingBackup=false;}
  });
  const restoreFlow=PHBFlow.manage({
    dialog:'backupRestoreDialog',dismiss:['cancelRestore'],
    isBusy:()=>restoring,
    busyMessage:'Die Wiederherstellung läuft noch. Bitte den Abschluss prüfen.'
  });
  const notice=(message,error=false)=>{
    const box=get('dataNotice');box.hidden=false;box.classList.toggle('is-error',error);
    box.textContent=message;
  };
  const json=async(url,options={})=>{
    const response=await fetch(url,options);
    const data=await response.json();
    if(!response.ok)throw Error(data.error||'HTTP '+response.status);
    return data;
  };
  const post=(url,payload)=>json(url,{method:'POST',headers:{'Content-Type':'application/json'},
                                      body:JSON.stringify(payload)});
  const status=async()=>{
    try{
      config=await json('/api/backup/status');
      get('backupInfo').textContent=config.configured
        ? 'Sicherungsordner: '+config.folder+'\nVorhandene Backups: '+config.count+
          '\nLetztes: '+(config.latest||'noch keines')
        : 'Noch kein Backupziel eingerichtet: '+(config.error||'Bitte Zielordner festlegen.');
      get('backupNow').disabled=false;
      get('backupFolderHint').textContent=config.backend==='postgres'
        ?'Synology: Die App verwaltet Unterordner im eingebundenen NAS-Speicher. Für eine andere Freigabe PHB_BACKUP_DIR im Docker-Volume ändern. Terminal-Backups bleiben verfügbar.'
        :'Mac: Gib einen auf diesem Mac vorhandenen Ordnerpfad an. Die vorhandene Terminal-/LaunchAgent-Sicherung bleibt eingerichtet.';
      return config;
    }catch(err){
      get('backupInfo').textContent='Backupstatus nicht verfügbar: '+err.message;
      get('backupNow').disabled=false;
      return null;
    }
  };
  let browsingFolder='';
  async function browse(folder=''){
    if(config?.backend!=='postgres'){get('backupFolderBrowser').hidden=true;return;}
    const browser=get('backupFolderBrowser');
    try{
      const data=await json('/api/backup/folders?folder='+encodeURIComponent(folder));
      browsingFolder=data.current;
      browser.hidden=false;
      get('backupBrowseCurrent').textContent='NAS-Speicher: '+data.root+' / '+(data.current||'');
      const list=get('backupBrowseList');list.replaceChildren();
      const make=(label,path,action='browse')=>{
        const b=document.createElement('button');b.type='button';b.textContent=label;
        b.className='phb-folder-entry';
        b.onclick=()=>{
          if(action==='select'){
            get('backupFolder').value=path;
            get('backupConfigMessage').textContent='Ausgewählt: '+path;
          }else browse(path).catch(error=>{get('backupConfigMessage').textContent=error.message});
        };
        list.append(b);
      };
      if(data.current)make('✓ Diesen Ordner als Backup-Ziel auswählen',data.current,'select');
      if(data.parent!==null)make('↰ Eine Ebene höher',data.parent);
      for(const entry of data.directories)make('📁 '+entry.name,entry.path);
    }catch(error){
      get('backupBrowseCurrent').textContent='Ordner können gerade nicht angezeigt werden: '+error.message;
      get('backupBrowseList').replaceChildren();
    }
  }
  get('backupNativeFolder').onclick=async()=>{
    get('backupNativeFolder').disabled=true;
    try{
      const data=await post('/api/backup/native-folder',{});
      get('backupFolder').value=data.folder;
      get('backupConfigMessage').textContent='Systemordner ausgewählt: '+data.folder;
    }catch(error){get('backupConfigMessage').textContent=error.message;}
    finally{get('backupNativeFolder').disabled=false;}
  };
  get('backupNewSubfolder').onclick=async()=>{
    const name=await PHBUI.prompt('Name für einen neuen Unterordner im aktuell geöffneten NAS-Verzeichnis:');
    if(name===null)return;
    if(!name || name==='.' || name==='..' || name.includes('/') || name.includes('\\') || name.startsWith('.')){
      get('backupConfigMessage').textContent='Bitte einen gültigen einfachen Ordnernamen eingeben.';
      return;
    }
    const target=(browsingFolder?browsingFolder+'/':'')+name;
    get('backupFolder').value=target;
    get('backupConfigMessage').textContent='Neuer Unterordner „'+target+'“ wird beim Speichern angelegt.';
  };
  const openConfigure=async(fromBackup=false)=>{
    pendingBackup=fromBackup;
    await status();
    get('backupFolder').value=config?.configured?config.relative_folder:(config?.backend==='postgres'?'': '');
    get('backupKeep').value=config?.keep||30;
    get('backupFolder').readOnly=true;
    get('backupNativeFolder').hidden=config?.backend==='postgres';
    get('backupNewSubfolder').hidden=config?.backend!=='postgres';
    get('backupConfigMessage').textContent='';
    get('backupRootDescription').textContent=config?.backend==='postgres'
      ?'Der Ordner liegt innerhalb des auf der Synology bereitgestellten Backup-Volumes. Unterordner lassen sich auch neu anlegen.'
      :'Öffne den macOS-Systemdialog, um einen lokalen Backup-Ordner auszuwählen.';
    backupFlow.open();
    if(config?.backend==='postgres')await browse(config?.configured?config.relative_folder:'');
  };
  get('backupConfigure').onclick=()=>openConfigure(false);
  get('backupConfigCancel').onclick=()=>{
    pendingBackup=false;get('backupConfigDialog').close();
  };
  get('backupConfigForm').onsubmit=async event=>{
    event.preventDefault();
    const button=event.submitter;button.disabled=true;
    try{
      await post('/api/backup/configure',{folder:get('backupFolder').value,keep:Number(get('backupKeep').value)});
      const createAfterConfiguration=pendingBackup;
      pendingBackup=false;
      get('backupConfigDialog').close();
      await status();
      notice('Backupziel gespeichert.');
      if(createAfterConfiguration)await createBackup();
    }catch(err){get('backupConfigMessage').textContent=err.message;}
    finally{button.disabled=false;}
  };
  async function createBackup(){
    const btn=get('backupNow');btn.disabled=true;
    try{
      if(!config?.configured){await openConfigure(true);return;}
      const result=await post('/api/backup/create',{});
      notice('Vollständiges Backup erstellt und geprüft:\n'+result.filename);
      await status();
    }catch(error){notice(error.message,true);
      if(/nicht eingerichtet|nicht konfiguriert/.test(error.message))await openConfigure(true);
    }finally{btn.disabled=false;}
  }
  get('backupNow').onclick=createBackup;

  const updateRestoreButton=()=>{
    get('performRestore').disabled=restoring||!verifiedRef||
      get('restorePhrase').value!==restorePhrase;
  };
  get('restorePhrase').addEventListener('input',updateRestoreButton);
  function invalidateRestore(){
    verifiedRef=null;get('restoreVerifyInfo').textContent='Bitte zuerst die Datei prüfen.';
    get('restorePhrase').value='';updateRestoreButton();
  }
  get('restoreBackupSelect').addEventListener('change',()=>{
    get('restoreBackupUpload').value='';invalidateRestore();
  });
  get('restoreBackupUpload').addEventListener('change',()=>{
    get('restoreBackupSelect').value='';invalidateRestore();
  });
  get('openRestore').onclick=async()=>{
    await status();
    const list=get('restoreBackupSelect');list.replaceChildren(new Option('Aus Backup-Ordner auswählen',''));
    for(const file of config?.backups||[])list.add(new Option(file.filename,file.filename));
    get('restoreBackupUpload').value='';
    get('restoreProgress').textContent='';
    invalidateRestore();restoreFlow.open();
  };
  get('cancelRestore').onclick=()=>{if(!restoring)get('backupRestoreDialog').close();};
  get('backupRestoreDialog').addEventListener('cancel',e=>{if(restoring)e.preventDefault();});
  get('verifyRestore').onclick=async()=>{
    invalidateRestore();
    const btn=get('verifyRestore');btn.disabled=true;
    get('restoreVerifyInfo').textContent='Sicherung und Prüfsummen werden kontrolliert …';
    try{
      let data;
      const file=get('restoreBackupUpload').files[0];
      if(file){
        const form=new FormData();form.set('file',file);
        data=await json('/api/backup/inspect',{method:'POST',body:form});
      }else if(get('restoreBackupSelect').value){
        data=await post('/api/backup/inspect',{filename:get('restoreBackupSelect').value});
      }else throw Error('Bitte ein Backup aus der Liste oder eine ZIP-Datei wählen.');
      verifiedRef=data.ref;
      get('restoreVerifyInfo').textContent='Backup geprüft ✓ · '+data.files+' Dateien · Sicherungsdatum: '+(data.created||'unbekannt')+
        '. Gib die Bestätigungsphrase ein.';
      updateRestoreButton();
    }catch(err){get('restoreVerifyInfo').textContent=err.message;}
    finally{btn.disabled=false;}
  };
  async function pollRestore(){
    while(restoring){
      await new Promise(resolve=>setTimeout(resolve,1500));
      try{
        const status=await json('/api/backup/restore/status');
        get('restoreProgress').textContent=status.message||'Wiederherstellung wird geprüft …';
        if(status.state==='done'||status.state==='failed'){
          restoring=false;
          get('cancelRestore').textContent='Schließen';
          get('restoreBackupSelect').disabled=false;
          get('restoreBackupUpload').disabled=false;
          get('verifyRestore').disabled=false;
          get('restoreResult').textContent=status.state==='done'?
            'Wiederhergestellt. Sicherheitsbackup: '+(status.result?.safety_backup||'')+
            '. Bitte die Seite neu laden und den Projektstand kontrollieren.':
            'Wiederherstellung fehlgeschlagen. Bitte Serverprotokoll und Sicherungsstand prüfen.';
          invalidateRestore();
          if(status.state==='done'){
            notice('Wiederherstellung abgeschlossen. Projekt bitte neu laden und Daten kontrollieren.');
            await status();
          }else notice(status.message,true);
        }
      }catch(error){get('restoreProgress').textContent='Statusabfrage fehlgeschlagen: '+error.message;}
    }
  }
  get('performRestore').onclick=async()=>{
    if(!verifiedRef||get('restorePhrase').value!==restorePhrase)return;
    if(!await PHBUI.confirm('Jetzt den aktuellen Datenbestand durch das geprüfte Backup ersetzen? Vorher wird eine Sicherheitssicherung angelegt.'))return;
    try{
      restoring=true;updateRestoreButton();
      get('cancelRestore').textContent='Wiederherstellung läuft …';
      get('restoreBackupSelect').disabled=true;get('restoreBackupUpload').disabled=true;get('verifyRestore').disabled=true;
      get('restoreProgress').textContent='Wiederherstellung wird gestartet …';
      await post('/api/backup/restore',{ref:verifiedRef,confirmation:restorePhrase});
      pollRestore();
    }catch(error){
      restoring=false;
      get('cancelRestore').textContent='Schließen';
      get('restoreBackupSelect').disabled=false;get('restoreBackupUpload').disabled=false;get('verifyRestore').disabled=false;
      get('restoreProgress').textContent='Nicht gestartet: '+error.message;
      updateRestoreButton();
    }
  };

  get('checkOCR').onclick=async()=>{
    const button=get('checkOCR');
    button.disabled=true;
    get('ocrStatus').textContent='Prüfe die tatsächlich installierten OCR-Werkzeuge im laufenden App-Prozess …';
    get('ocrStatus').classList.remove('error');
    get('ocrHelp').hidden=true;
    try{
      const info=await json('/api/ocr/status');
      const versions=info.versions||{};
      const runtime=info.environment==='container'?'Synology-/Docker-App-Container':'lokaler App-Server';
      if(info.ready){
        get('ocrStatus').textContent='✓ Lokale OCR einsatzbereit ('+runtime+'): Tesseract, Poppler und Sprachpakete '+
          info.languages.join(', ')+'. '+[versions.tesseract,versions.pdftoppm].filter(Boolean).join(' · ');
      }else{
        const reasons=[
          'Tesseract: '+(info.tools?.tesseract?'vorhanden':'fehlt'),
          'Poppler: '+(info.tools?.pdftoppm?'vorhanden':'fehlt'),
          'Deutsch: '+(info.languages?.includes('deu')?'vorhanden':'fehlt'),
          'Englisch: '+(info.languages?.includes('eng')?'vorhanden':'fehlt')
        ];
        get('ocrStatus').textContent='OCR im '+runtime+' nicht verfügbar. '+reasons.join(' · ')+
          '. '+(info.reason||'Bitte Serverinstallation prüfen.')+
          (info.environment==='container'&&!info.image_marker?' (Kein OCR-Image-Kennzeichen gefunden.)':'');
        get('ocrStatus').classList.add('error');
        get('ocrHelp').hidden=false;
        get('ocrSynologySteps').hidden=info.environment!=='container';
        get('ocrMacSteps').hidden=info.environment==='container';
      }
    }catch(error){
      get('ocrStatus').textContent='OCR-Diagnose fehlgeschlagen: '+error.message;
      get('ocrStatus').classList.add('error');
    }finally{button.disabled=false;}
  };
    const updateResetButton=()=>{
    get('resetButton').disabled=!get('resetUnderstand').checked||get('resetText').value!==phrase;
  };
  get('resetUnderstand').addEventListener('change',updateResetButton);
  get('resetText').addEventListener('input',updateResetButton);
  get('resetForm').addEventListener('submit',async event=>{
    event.preventDefault();
    if(get('resetButton').disabled)return;
    if(!await PHBUI.confirm('Wirklich alle Projektdaten und Uploads löschen? Es wird unmittelbar vorher ein vollständiges Backup verlangt.'))return;
    const button=get('resetButton');button.disabled=true;
    try{
      const result=await json('/api/data/reset',{
        method:'POST',headers:{'Content-Type':'application/json','X-PHB-Reset':'1'},
        body:JSON.stringify({confirmation:get('resetText').value})
      });
      notice('Projekt zurückgesetzt. Das verifizierte Backup liegt unter:\n'+result.backup+
        (result.warning?'\nAchtung: '+result.warning:''));
      get('resetForm').reset();updateResetButton();await status();
    }catch(error){notice('Keine Daten zurückgesetzt: '+error.message,true);updateResetButton();}
  });
  status();
})();
