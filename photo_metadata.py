"""Read capture dates without using upload/file dates or changing originals."""
from datetime import date, datetime
from functools import lru_cache
from pathlib import Path
import warnings
import re
from struct import error as StructError
from PIL import Image

DATE_TAGS=(36867,36868)  # DateTimeOriginal, DateTimeDigitized; not ModifyDate.
OFFSET_TAGS=(36881,36882)


def _text(value):
    if isinstance(value,bytes):value=value.decode('ascii',errors='ignore')
    return value.strip(' \x00') if isinstance(value,str) and len(value)<256 else ''


def _date(value):
    text=_text(value)
    if len(text)<10:return ''
    normalized=text[:10].replace(':','-')+text[10:]
    try:
        result=date.fromisoformat(normalized) if len(normalized)==10 else datetime.fromisoformat(normalized).date()
        return result.isoformat()
    except ValueError:return ''


def _capture_fields(image):
    try:
        exif=image.getexif()
        nested=exif.get_ifd(34665) if exif.get(34665) else {}
        fields={}
        for tag in DATE_TAGS:
            value=_text(nested.get(tag) or exif.get(tag))
            if _date(value):fields[tag]=value
        for tag in OFFSET_TAGS:
            value=_text(nested.get(tag) or exif.get(tag))
            if re.fullmatch(r'[+-](?:[01]\d|2[0-3]):[0-5]\d',value):fields[tag]=value
        return fields
    except (ValueError,TypeError,OSError,KeyError,AttributeError,SyntaxError,IndexError,OverflowError,StructError):return {}


def capture_date(image):
    fields=_capture_fields(image)
    return next((_date(fields[tag]) for tag in DATE_TAGS if fields.get(tag)), '')


def capture_exif(image):
    """Keep capture timestamps when resizing; exclude the old orientation/GPS."""
    fields=_capture_fields(image)
    if not any(tag in fields for tag in DATE_TAGS):return b''
    exif=Image.Exif();exif[34665]=fields
    return exif.tobytes()


@lru_cache(maxsize=512)
def _file_capture_date(path,modified,size):
    # File signature changes on restore; cached dates never outlive a replaced file.
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error',Image.DecompressionBombWarning)
            with Image.open(path) as image:return capture_date(image)
    except (OSError,ValueError,TypeError,SyntaxError,IndexError,StructError,Image.DecompressionBombWarning,Image.DecompressionBombError):return ''


def stored_capture_date(root,stored_name):
    if not isinstance(stored_name,str) or Path(stored_name).name!=stored_name:return ''
    try:
        base=Path(root).resolve();path=base/stored_name
        if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(base):return ''
        stat=path.stat()
        return _file_capture_date(str(path),stat.st_mtime_ns,stat.st_size)
    except (OSError,ValueError):return ''
