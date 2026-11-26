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
