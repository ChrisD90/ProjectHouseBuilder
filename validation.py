"""Shared date contracts. Import timestamps are explicit, never truncated input."""
from datetime import date, datetime
import re

def parse_date(value, *, optional=True, timestamps=False):
    if value in (None,''):
        if optional:return None
        raise ValueError('Datum fehlt. Bitte JJJJ-MM-TT angeben.')
    if isinstance(value,datetime):
        if timestamps:return value.date()
        raise ValueError('Hier ist ein Datum ohne Uhrzeit erforderlich.')
    if isinstance(value,date):return value
    if not isinstance(value,str):raise ValueError('Ungültiges Datum. Bitte JJJJ-MM-TT angeben.')
    raw=value.strip()
    try:
        if re.fullmatch(r'\d{4}-\d{2}-\d{2}',raw):return date.fromisoformat(raw)
        if timestamps and re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?',raw):
            return datetime.fromisoformat(raw.replace('Z','+00:00')).date()
    except ValueError:pass
    raise ValueError('Ungültiges Datum. Bitte einen gültigen Tag im Format JJJJ-MM-TT angeben.')

def iso_date(value, *, optional=False):
    result=parse_date(value,optional=optional)
    return result.isoformat() if result else ''
