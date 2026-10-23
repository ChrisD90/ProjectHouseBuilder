"""Local-only project document intake and bounded, opt-in AI context.

No external OCR, embedding index, or cloud storage. A PDF/drawing is sent as
multimodal input only when the user selects it for a particular AI request.
"""
from io import BytesIO
from pathlib import Path
import re
import zipfile
from xml.etree import ElementTree
from pypdf import PdfReader

CATEGORIES = ('Bauplan', 'Technische Zeichnung', 'Technisches Datenblatt',
              'Genehmigung', 'Versicherung', 'Vertrag', 'Protokoll', 'Sonstiges')
AREAS = ('Allgemein', 'Bauzeitenplan', 'Elektrik', 'Heizung & Sanitär',
         'Dach & Fassade', 'Innenausbau', 'Finanzierung', 'Versicherung')
STATUSES = ('Aktuell', 'Entwurf', 'Überholt')
EXTENSIONS = {'.pdf', '.jpg', '.jpeg', '.png', '.webp', '.txt', '.docx'}
MAX_BYTES = 12 * 1024 * 1024
MAX_PAGES = 50
MAX_TEXT = 32000
MAX_AI_DOCUMENTS = 3
MAX_AI_TOTAL_BYTES = 16 * 1024 * 1024


def plain(value, field, limit, *, required=False):
    if not isinstance(value, str):
        raise ValueError(field + ' muss Text sein.')
    value = value.strip()
    if len(value) > limit or (required and not value):
        raise ValueError(field + ' fehlt oder ist zu lang.')
    if any(ord(ch) < 32 and ch not in '\n\t' for ch in value):
        raise ValueError('Ungültige Zeichen in ' + field + '.')
    return value


def text_from_document(raw, extension):
    """Extract local searchable text and a warning; never claim drawing understanding."""
    if extension == '.txt':
        try:
            return raw.decode('utf-8-sig')[:MAX_TEXT], ''
        except UnicodeError as exc:
            raise ValueError('Textdatei muss UTF-8-kodiert sein.') from exc
    if extension == '.pdf':
        try:
            pdf = PdfReader(BytesIO(raw))
            if pdf.is_encrypted:
                return '', 'PDF ist verschlüsselt; Text kann nicht lokal ausgewertet werden.'
            if len(pdf.pages) > MAX_PAGES:
                return '', 'PDF mit mehr als 50 Seiten: keine lokale Textextraktion.'
            portions = []
            for page in pdf.pages:
                portions.append((page.extract_text() or '')[:MAX_TEXT])
                if sum(map(len, portions)) >= MAX_TEXT:
                    break
            text = '\n'.join(portions)[:MAX_TEXT]
            return text, ('' if len(text.strip()) > 30 else
                          'Kein durchsuchbarer Text vorhanden. Plan/Scan wird nur bei ausdrücklicher ChatGPT-Auswahl visuell geprüft.')
        except (ValueError, OSError) as exc:
            raise ValueError('Ungültiges oder beschädigtes PDF.') from exc
    if extension == '.docx':
        try:
            with zipfile.ZipFile(BytesIO(raw)) as archive:
                content = archive.getinfo('word/document.xml')
                if content.file_size > 3 * 1024 * 1024:
                    raise ValueError('DOCX-Inhalt ist zu groß.')
                node = ElementTree.fromstring(archive.read(content))
                namespace = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
                lines = [''.join(element.itertext()) for element in node.iter(namespace+'t')]
                return ' '.join(lines)[:MAX_TEXT], ''
        except (zipfile.BadZipFile, KeyError, ElementTree.ParseError) as exc:
            raise ValueError('Ungültige DOCX-Datei.') from exc
    # Technical drawings are deliberately not guessed from pixels by local OCR.
    return '', 'Bild/Zeichnung ohne lokale Textextraktion; visuelle Prüfung nur bei ausdrücklicher ChatGPT-Auswahl.'


def inspect_upload(filename, raw):
    name = Path(filename or '').name[:220]
    extension = Path(name).suffix.lower()
    if extension not in EXTENSIONS:
        raise ValueError('Unterstützt werden PDF, DOCX, TXT, JPG, PNG und WEBP.')
    if not raw or len(raw) > MAX_BYTES:
        raise ValueError('Dokument muss zwischen 1 Byte und 12 MB groß sein.')
    if extension == '.pdf' and not raw.startswith(b'%PDF-'):
        raise ValueError('Keine gültige PDF-Datei.')
    if extension == '.docx' and not raw.startswith(b'PK'):
        raise ValueError('Keine gültige DOCX-Datei.')
    if extension in {'.jpg', '.jpeg', '.png', '.webp'}:
        from PIL import Image, UnidentifiedImageError
        try:
            image = Image.open(BytesIO(raw))
            if image.width * image.height > 25_000_000:
                raise ValueError('Bildauflösung zu groß.')
            image.verify()
            if image.format not in {'JPEG','PNG','WEBP'}:
                raise ValueError('Nicht unterstütztes Bildformat.')
        except (OSError, UnidentifiedImageError) as exc:
            raise ValueError('Ungültige Bilddatei.') from exc
    text,warning = text_from_document(raw,extension)
    return name,extension,text,warning


def matching_score(document, query):
    """Local suggestion ONLY. It never authorizes disclosure."""
    tokens = {word for word in re.findall(r'[a-zäöüß0-9]{4,}', query.lower())
              if word not in {'werden','haben','unser','unsere','sollen','möchte','bitte','diese','einen'}}
    bag = ' '.join((document.title, document.category, document.area,
                    document.tags or '', document.description or '')).lower()
    return sum(3 if t in (document.tags or '').lower() else 1
               for t in tokens if t in bag)
