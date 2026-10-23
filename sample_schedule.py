"""Curated, reviewable renovation schedule template (not an authoritative build plan).

Only validates and returns the project template; no database effects. The
schedule is intentionally loaded on demand rather than automatically seeded.
"""
from collections import Counter
import json
from pathlib import Path

EXECUTION_TYPES = frozenset({'Eigenleistung', 'Fremdleistung'})


def load_schedule_template(path):
    entries=json.loads(Path(path).read_text(encoding='utf-8'))
    if not isinstance(entries,list) or not entries or len(entries)>250:
        raise ValueError('Ungültige Anzahl an Arbeitsschritten in der Mustervorlage.')
    keys=set()
    for item in entries:
        if not isinstance(item,dict):
            raise ValueError('Ungültiger Arbeitsschritt.')
        for name in ('code','name','phase','trade','notes'):
            if not isinstance(item.get(name),str):
                raise ValueError('Ein Pflichtfeld fehlt: '+name)
        code=item['code'].strip()
        if not code or len(code)>30 or code in keys:
            raise ValueError('Doppelte oder ungültige Aufgaben-ID: '+code)
        keys.add(code)
        if (not item['name'].strip() or len(item['name'])>300 or
            not item['phase'].strip() or len(item['phase'])>140 or
            not item['trade'].strip() or len(item['trade'])>140 or
            len(item['notes'])>6000):
            raise ValueError('Aufgabenname oder Text zu lang / leer: '+code)
        if item.get('execution_type') not in EXECUTION_TYPES:
            raise ValueError('Unbekannte Ausführungsart für '+code)
        if type(item.get('duration')) is not int or item['duration']<1 or item['duration']>365:
            raise ValueError('Ungültige Dauer für '+code)
        if type(item.get('lag_days')) is not int or not 0<=item['lag_days']<=180:
            raise ValueError('Ungültiger Abstand für '+code)
        if not isinstance(item.get('predecessors'),list) or any(not isinstance(x,str) for x in item['predecessors']):
            raise ValueError('Ungültige Abhängigkeiten für '+code)
    graph={item['code']:item['predecessors'] for item in entries}
    for code,predecessors in graph.items():
        if len(set(predecessors))!=len(predecessors) or any(p not in keys or p==code for p in predecessors):
            raise ValueError('Ungültige Vorgänger für '+code)
    visiting=set();done=set()
    def visit(code):
        if code in done:return
        if code in visiting:raise ValueError('Zyklische Mustervorlagen-Abhängigkeit.')
        visiting.add(code)
        for parent in graph[code]:visit(parent)
        visiting.remove(code);done.add(code)
    for code in graph:visit(code)
    return entries


def schedule_template_summary(steps):
    phases=Counter(x['phase'] for x in steps)
    types=Counter(x['execution_type'] for x in steps)
    return {'name':'Musterablauf Altbausanierung – Gartenstraße',
            'description':'Unverbindlicher Planvorschlag für Dachumbau, Hülle, Haustechnik, Innenausbau und Eigenleistungen. Termine sind grobe Kalendertag-Schätzungen und müssen mit Fachbetrieben, Statik und Energieberatung abgestimmt werden.',
            'count':len(steps),
            'tasks':[{'code':x['code'],'phase':x['phase'],'name':x['name'],'execution_type':x['execution_type'],'duration':x['duration']} for x in steps],
            'phases':[{'name':name,'count':count} for name,count in phases.items()],
            'execution_types':{'Eigenleistung':types['Eigenleistung'],'Fremdleistung':types['Fremdleistung']},
            'important_notes':['Vor belasteten Materialien, Eingriffen in tragende Bauteile und sicherheitsrelevanten Arbeiten Fachleute einbeziehen.',
                               'Genehmigungen, Lieferzeiten, Estrichtrocknung und Förderschritte vor Ort anpassen.',
                               'Der Plan ist eine Vorlage, keine Statik, Bauleitung oder Termin-/Förderzusage.']}
