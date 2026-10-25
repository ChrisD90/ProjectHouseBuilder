"""Conservative, reviewable contractor suggestions for construction tasks.

Suggestions are not assignments. Existing assignments and DIY tasks are protected.
"""
import re
import unicodedata

KEYWORDS = {
    'pv': ('photovoltaik','solaranlage','solarmodul','wechselrichter','stromspeicher','pv'),
    'elektro': ('elektro','elektrik','stromkreis','schaltschrank','verkabelung','wallbox'),
    'waermepumpe': ('waermepump','wp','hydraulik'),
    'heizung': ('heizung','heizkoerper','fussbodenheiz','heizungsbauer'),
    'sanitaer': ('sanitaer','abwasser','steigleitung','badinstallation','trinkwasser'),
    'dach': ('dach','dachdecker','zimmerer','gaube','kniestock'),
    'fenster': ('fenster','tueren','haustuer','verglasung'),
    'fassade': ('fassade','wdvs','aussendaemmung'),
    'klima': ('klima','splitgeraet','kaeltetechnik'),
    'estrich': ('estrich',),
    'putz': ('putz','stuckateur'),
    'fliesen': ('fliesen','fliesenleger'),
    'maler': ('maler','anstrich','lackieren'),
}

def normalize(value):
    text=str(value or '').lower().replace('ä','ae').replace('ö','oe').replace('ü','ue').replace('ß','ss')
    text=unicodedata.normalize('NFKD',text)
    return ''.join(c for c in text if not unicodedata.combining(c))

def facets(value):
    text=normalize(value)
    return {group for group, terms in KEYWORDS.items()
            if any(re.search(r'(?<![a-z])'+re.escape(term),text) for term in terms)}

def suggestions(tasks, sources):
    """Return keyed suggestions, ordered by relevance, with explanatory reasons."""
    result={}
    for t in tasks:
        if (t.get('contractor_id') or str(t.get('company') or '').strip()
            or t.get('execution_type')=='Eigenleistung'):
            continue
        task_facets=facets(str(t.get('trade',''))+' '+str(t.get('name','')))
        if not task_facets:continue
        found={}
        for source in sources:
            if source.get('task_id') is not None and source['task_id'] != t['id']:
                continue
            source_facets=facets(' '.join(str(source.get(k) or '') for k in ('category','trade','details')))
            overlap=task_facets & source_facets
            if not overlap and source.get('task_id')!=t['id']:continue
            # A specialist solar or heat pump offer should not be distributed
            # to unrelated generic electrical/pipe tasks.
            task_specific=facets(t.get('name'))
            detail_specific=facets(source.get('details'))
            if task_specific and detail_specific and not (task_specific & detail_specific):
                if source.get('task_id')!=t['id']:continue
            score=100 if source.get('task_id')==t['id'] else 65+10*len(overlap)
            cid=source['contractor_id']
            old=found.get(cid)
            if not old or score>old['score']:
                found[cid]={'contractor_id':cid,'name':source['contractor'],
                            'score':score,'reason':source['reason']}
        if found:
            result[str(t['id'])]=sorted(found.values(),key=lambda x:(-x['score'],x['name'].casefold()))
    return result
