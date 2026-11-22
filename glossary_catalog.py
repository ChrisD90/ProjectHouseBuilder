"""Offline, editorial glossary. Built-ins never become project-owned database rows."""
import json
from pathlib import Path
from urllib.parse import urlsplit

_CATALOG = json.loads((Path(__file__).parent / 'data' / 'handwerk_glossary.json').read_text(encoding='utf-8'))
GLOSSARY = _CATALOG['entries']
GLOSSARY_CATEGORIES = _CATALOG['categories']
GLOSSARY_VERSION = _CATALOG['version']
CATEGORY_IDS = frozenset(row['id'] for row in GLOSSARY_CATEGORIES)


def validate_glossary_metadata(data):
    """Validate new optional metadata without rewriting legacy personal notes."""
    if 'category' in data and (not isinstance(data['category'], str) or data['category'] not in CATEGORY_IDS):
        raise ValueError('Ungültige Glossarkategorie.')
    if 'source_url' in data:
        value = data['source_url']
        if not isinstance(value, str) or len(value) > 2000:
            raise ValueError('Ungültige Quellenadresse.')
        if value:
            try:
                url = urlsplit(value)
                valid = url.scheme in ('https', 'http') and bool(url.hostname) and not url.username and not url.password
                _ = url.port
            except ValueError:
                valid = False
            if not valid or any(char.isspace() or ord(char) < 32 for char in value):
                raise ValueError('Die Quelle muss eine vollständige HTTP- oder HTTPS-Adresse sein.')
