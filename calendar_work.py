"""Local calendar work rules, shared by preview and persisted company time."""
from datetime import timedelta

LEGACY_WORK = {'mode':'continuous','weekdays':list(range(7)),'break_minutes':0,'daily_minutes':480}
DEFAULT_WORK = {'mode':'daily','weekdays':[0,1,2,3,4],'break_minutes':0,'daily_minutes':480}

def clean_work(value):
    if not isinstance(value,dict) or set(value)-set(DEFAULT_WORK):raise ValueError('Ungültige Arbeitszeitregeln.')
    result={**DEFAULT_WORK,**value}
    days=result['weekdays']
    if result['mode'] not in ('daily','continuous') or not isinstance(days,list) or not days or any(type(x)is not int or not 0<=x<=6 for x in days) or len(days)!=len(set(days)):
        raise ValueError('Arbeitszeitmodus und mindestens einen gültigen Wochentag auswählen.')
    if type(result['break_minutes'])is not int or not 0<=result['break_minutes']<=720 or type(result['daily_minutes'])is not int or not 1<=result['daily_minutes']<=1440:
        raise ValueError('Ungültige Pausen- oder Tagesdauer.')
    return result

def work_minutes(start,end,all_day,start_time,end_time,rules):
    rules=clean_work(rules)
    if end<start or (end-start).days>=366:raise ValueError('Zeitraum muss zwischen einem und 366 Tagen liegen.')
    expected={}
    for offset in range((end-start).days+1):
        day=start+timedelta(days=offset)
        if day.weekday() not in rules['weekdays']:continue
        if all_day:minutes=rules['daily_minutes']
        elif rules['mode']=='daily':
            minutes=(end_time.hour-start_time.hour)*60+end_time.minute-start_time.minute
            if minutes<=0:raise ValueError('Bei täglicher Arbeitszeit muss die Endzeit nach der Startzeit liegen. Für Nachtschichten den durchgehenden Modus wählen.')
        else:
            first=start_time.hour*60+start_time.minute if day==start else 0
            last=end_time.hour*60+end_time.minute if day==end else 1440
            minutes=last-first
        minutes=max(0,minutes-rules['break_minutes'])
        if minutes:expected[day]=minutes
    return expected
