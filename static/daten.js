'use strict';
(() => {
  const get = id => document.getElementById(id);
  const phrase = 'ALLE DATEN LÖSCHEN';
  const notice = (message, error = false) => {
    const box = get('dataNotice');
    box.hidden = false;
    box.classList.toggle('is-error', error);
    box.textContent = message;
  };
  const json = async (url, options = {}) => {
    const response = await fetch(url, options);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    return body;
  };
  const status = async () => {
    try {
      const info = await json('/api/backup/status');
      get('backupInfo').textContent = info.configured
        ? `Sicherungsordner: ${info.folder}\nVorhandene Backups: ${info.count}\nLetztes: ${info.latest || 'noch keines'}`
        : `Noch kein Backupziel eingerichtet: ${info.error || ''}`;
      get('backupNow').disabled = !info.configured;
    } catch (error) {
      get('backupInfo').textContent = 'Backupstatus nicht verfügbar: ' + error.message;
      get('backupNow').disabled = true;
    }
  };
  get('backupNow').addEventListener('click', async () => {
    const button = get('backupNow'); button.disabled = true;
    try {
      const r = await json('/api/backup/create', {method: 'POST'});
      notice(`Komplettbackup erfolgreich geprüft und gespeichert:\n${r.filename}`);
      await status();
    } catch (error) { notice(error.message, true); }
    finally { button.disabled = false; }
  });
  const updateResetButton = () => {
    get('resetButton').disabled = !get('resetUnderstand').checked || get('resetText').value !== phrase;
  };
  get('resetUnderstand').addEventListener('change', updateResetButton);
  get('resetText').addEventListener('input', updateResetButton);
  get('resetForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (get('resetButton').disabled) return;
    if (!await PHBUI.confirm('Wirklich alle Projektdaten und Uploads löschen? Es wird unmittelbar vorher ein vollständiges Backup verlangt.')) return;
    const button = get('resetButton'); button.disabled = true;
    try {
      const result = await json('/api/data/reset', {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'X-PHB-Reset': '1'},
        body: JSON.stringify({confirmation: get('resetText').value})
      });
      notice(`Projekt zurückgesetzt. Das verifizierte Backup liegt unter:\n${result.backup}` + (result.warning ? `\nAchtung: ${result.warning}` : ''));
      get('resetForm').reset();
      updateResetButton();
      await status();
    } catch (error) {
      notice('Keine Daten zurückgesetzt: ' + error.message, true);
      updateResetButton();
    }
  });
  status();
})();
