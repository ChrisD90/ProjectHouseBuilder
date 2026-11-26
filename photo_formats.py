"""Known photo formats and the decoders actually available in this installation."""
from PIL import Image, features

try:
    from pillow_heif import register_heif_opener
    register_heif_opener()
except (ImportError, OSError):
    # Older installations can still run and show how to enable HEIC in the UI.
    pass
Image.init()

FORMATS = (
    ('JPEG','JPEG',('.jpg','.jpeg','.jpe','.jfif'),('image/jpeg',)),
    ('PNG','PNG',('.png',),('image/png',)),
    ('WEBP','WEBP',('.webp',),('image/webp',)),
    ('HEIF','HEIC / HEIF',('.heic','.heif'),('image/heic','image/heif')),
    ('AVIF','AVIF',('.avif',),('image/avif',)),
    ('GIF','GIF',('.gif',),('image/gif',)),
    ('TIFF','TIFF',('.tif','.tiff'),('image/tiff',)),
    ('BMP','BMP',('.bmp',),('image/bmp',)),
    ('DIB','DIB',('.dib',),('image/x-ms-bmp',)),
    ('ICO','ICO',('.ico',),('image/x-icon',)),
    ('JPEG2000','JPEG 2000',('.jp2','.j2k','.jpf','.jpx'),('image/jp2',)),
)
PHOTO_EXTENSIONS=tuple(ext for _,_,extensions,_ in FORMATS for ext in extensions)
FORMAT_EXTENSIONS={name:extensions for name,_,extensions,_ in FORMATS}

def supported_formats():
    result=[]
    for name,label,extensions,mimes in FORMATS:
        available=name in Image.OPEN
        if name=='JPEG2000':available=available and features.check_codec('jpg_2000')
        if name=='WEBP':available=available and features.check_module('webp')
        if available:result.append(dict(name=name,label=label,extensions=extensions,mimes=mimes))
    return result

def capabilities():
    rows=supported_formats()
    return dict(formats=rows,accept=','.join(value for row in rows for value in (*row['extensions'],*row['mimes'])),
                heic_available=any(x['name']=='HEIF' for x in rows),
                hint='Bei animierten oder mehrseitigen Dateien zeigt die Vorschau das erste Bild. Die Originaldatei bleibt erhalten; diese Dateien werden nicht komprimiert.')


def upload_failure(raw, filename, detected, error):
    """Describe only this file; extensions are hints, not proof of a codec failure."""
    from pathlib import Path
    from PIL import UnidentifiedImageError
    signature = detected
    if not signature:
        if raw.startswith(b'\xff\xd8\xff'):signature='JPEG'
        elif raw.startswith(b'\x89PNG\r\n\x1a\n'):signature='PNG'
        elif raw[:6] in (b'GIF87a',b'GIF89a'):signature='GIF'
        elif raw.startswith((b'II*\x00',b'MM\x00*')):signature='TIFF'
        elif raw[:4]==b'RIFF' and raw[8:12]==b'WEBP':signature='WEBP'
        elif raw[4:8]==b'ftyp':
            brands=[raw[i:i+4] for i in range(8,min(len(raw),64),4)]
            if any(x in (b'avif',b'avis') for x in brands):signature='AVIF'
            elif any(x in (b'heic',b'heix',b'hevc',b'hevx',b'mif1',b'msf1') for x in brands):signature='HEIF'
    available={x['name'] for x in supported_formats()}
    ext=Path(filename).suffix.lower()
    hint=next((label for _,label,extensions,_ in FORMATS if ext in extensions),None)
    label=next((label for name,label,_,_ in FORMATS if name==signature),None)
    if signature and signature not in available:
        code='decoder_unavailable';reason=f'Für {label or signature} ist in dieser Installation kein Decoder verfügbar. Bitte die App-Abhängigkeiten aktualisieren und die App neu starten oder das Bild als JPEG/PNG exportieren.'
    elif isinstance(error,(Image.DecompressionBombError,Image.DecompressionBombWarning)):
        code='image_too_large';reason='Die Bildabmessungen überschreiten die sichere Decoder-Grenze. Bitte das Bild vor dem Upload verkleinern.'
    elif not raw:
        code='empty_file';reason='Die Datei ist leer.'
    elif isinstance(error,UnidentifiedImageError):
        code='unreadable_image';reason='Der Dateiinhalt konnte nicht als unterstütztes Bild erkannt werden. Die Datei kann beschädigt sein oder einen nicht unterstützten Codec verwenden. Bitte als JPEG/PNG exportieren.'
    else:
        code='decode_failed';reason='Das Bild konnte nicht vollständig gelesen oder komprimiert werden. Bitte die Datei lokal öffnen und erneut als JPEG/PNG speichern.'
    return dict(format=label or ('Unbekannt'+(f' (Dateiendung: {hint})' if hint else '')),error_code=code,reason=reason)
