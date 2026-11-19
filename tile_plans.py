"""Validate user supplied room contours before storing project-local tile plans."""
import math
from decimal import Decimal, InvalidOperation
from urllib.parse import urlsplit


def validate_osb_settings(settings):
    if not isinstance(settings,dict) or not isinstance(settings.get('osb'),dict):
        raise ValueError('OSB-Aufbau fehlt.')
    config=settings['osb']
    limits={'thickness':(6,60),'minStagger':(100,2500),'joistSpacing':(100,2000),'joistOffset':(0,2000),'joistWidth':(40,200)}
    for key,(low,high) in limits.items():
        value=config.get(key)
        if type(value)not in (int,float) or not math.isfinite(value) or not low<=value<=high:
            raise ValueError('Ungültige OSB-Einstellung: '+key)
    dimension_limits={'width':(100,100000),'height':(100,100000),'tileWidth':(10,5000),'tileHeight':(10,5000),'edge':(0,100),'joint':(0,30),'reserve':(0,100),'offsetX':(0,10000),'offsetY':(0,10000)}
    for key,(low,high) in dimension_limits.items():
        value=settings.get(key)
        if type(value)not in(int,float) or not math.isfinite(value) or not low<=value<=high:raise ValueError('Ungültiges Plattenmaß.')
    if type(settings.get('rotated'))is not bool or settings.get('start')not in ('corner','center','offset'):raise ValueError('Ungültige Plattenausrichtung.')
    validate_contour(settings.get('contour'),settings['width'],settings['height'])
    if config.get('installation')not in('floating','joists') or config.get('profile')not in('tg','square'):
        raise ValueError('Unbekannter OSB-Aufbau.')
    if settings['edge']<=10 or settings.get('pattern')!='half':raise ValueError('OSB benötigt in diesem Planungsprofil mehr als 10 mm Randfuge und versetzte Stöße.')
    if settings['tileWidth']<settings['tileHeight']:raise ValueError('Plattenlänge und Hauptachse müssen mindestens der Breite entsprechen.')
    if (config['profile']=='tg' and settings['joint']!=0) or (config['profile']=='square' and settings['joint']<=0):raise ValueError('Die Plattenfuge passt nicht zum gewählten Kantenprofil.')
    if config['installation']=='joists' and config['joistOffset']>=config['joistSpacing']:raise ValueError('Die erste Balkenachse muss innerhalb eines Balkenabstands liegen.')
    length=settings['tileWidth'];shift=(length+settings['joint'])/2
    if config['installation']=='joists':
        if config['profile']!='tg':raise ValueError('Balkenlage unterstützt vierseitige Nut/Feder-Platten; geradkantige Platten benötigen zusätzliche Kantenunterstützung.')
        spans=math.floor((length+.001)/config['joistSpacing']);required=math.ceil(max(config['minStagger'],config['joistSpacing'])/config['joistSpacing'])
        if spans<2 or spans<required*2:raise ValueError('Plattenformat und Balkenraster erlauben keinen ausreichenden Stoßversatz.')
        length=spans*config['joistSpacing'];shift=max(required,math.floor(spans/2))*config['joistSpacing']
    if min(shift,length+settings['joint']-shift)+.001<config['minStagger']:raise ValueError('Mindest-Stoßversatz wird nicht erreicht.')
    width=(settings['height']if settings['rotated']else settings['width'])-2*settings['edge']
    height=(settings['width']if settings['rotated']else settings['height'])-2*settings['edge']
    if width<=0 or height<=0 or (math.ceil(width/(length+settings['joint']))+2)*(math.ceil(height/(settings['tileHeight']+settings['joint']))+2)>5000:
        raise ValueError('Keine belegbare Fläche oder mehr als 5.000 Plattenfelder.')


def validate_tile_products(rows, document_for_id):
    if not isinstance(rows,list) or len(rows)>30:
        raise ValueError('Es können maximal 30 Fliesen verglichen werden.')
    result=[];seen=set();images=[]
    for row in rows:
        if not isinstance(row,dict) or set(row)-{'id','name','url','price','image_document_id'}:
            raise ValueError('Ungültiger Flieseneintrag.')
        ident=row.get('id')
        if not isinstance(ident,str) or not ident or len(ident)>64 or ident in seen:
            raise ValueError('Flieseneinträge benötigen eine eindeutige Kennung.')
        seen.add(ident)
        name=row.get('name','');url=row.get('url','')
        if not isinstance(name,str) or len(name)>200 or not isinstance(url,str) or len(url)>2000:
            raise ValueError('Bezeichnung oder URL der Fliese ist zu lang.')
        url=url.strip()
        if url:
            parsed=urlsplit(url)
            if parsed.scheme not in ('http','https') or not parsed.hostname or parsed.username or parsed.password:
                raise ValueError('Bitte eine gültige HTTP- oder HTTPS-Produktadresse eingeben.')
        price=row.get('price')
        if price is not None:
            try: amount=Decimal(str(price))
            except InvalidOperation: raise ValueError('Ungültiger Fliesenpreis.') from None
            if isinstance(price,bool) or not amount.is_finite() or not 0<=amount<=999999999 or amount!=amount.quantize(Decimal('.01')):
                raise ValueError('Der Stückpreis muss positiv oder null sein und darf maximal zwei Nachkommastellen haben.')
            price=float(amount)
        image_id=row.get('image_document_id')
        if image_id is not None:
            document=document_for_id(image_id) if type(image_id)is int and image_id>0 else None
            extension=document.get('extension') if isinstance(document,dict) else getattr(document,'extension',None)
            if document is None or extension not in ('.jpg','.jpeg','.png','.webp'):
                raise ValueError('Das Fliesenbild muss eine Bilddatei aus diesem Projekt sein.')
            images.append(image_id)
        result.append({'id':ident,'name':name.strip(),'url':url,'price':price,'image_document_id':image_id})
    return result,images


def validate_room_geometry(geometry):
    if not isinstance(geometry, dict) or set(geometry)-{'width', 'height', 'contour', 'roomShape'}:
        raise ValueError('Ungültige Grundrissdaten.')
    for key in ('width', 'height'):
        value = geometry.get(key)
        if type(value) not in (int, float) or not math.isfinite(value) or not 100 <= value <= 100000:
            raise ValueError('Raumbreite und -tiefe müssen zwischen 10 und 10.000 cm liegen.')
    if geometry.get('roomShape') not in (None, 'rectangle', 'l', 'trapezoid', 'round', 'custom'):
        raise ValueError('Unbekannte Raumform.')
    validate_contour(geometry.get('contour'), geometry['width'], geometry['height'])


def validate_contour(points, width, height):
    if points is None:
        return
    if not isinstance(points, list) or not 3 <= len(points) <= 64:
        raise ValueError('Die Raumkontur benötigt 3 bis 64 Eckpunkte.')
    for p in points:
        if not isinstance(p, dict) or set(p) != {'x', 'y'}:
            raise ValueError('Ungültiger Eckpunkt der Raumkontur.')
        for key, maximum in (('x', width), ('y', height)):
            value = p[key]
            if type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= maximum:
                raise ValueError('Alle Eckpunkte müssen innerhalb von Raumbreite und -tiefe liegen.')

    eps = .001

    def cross(a, b, c):
        return (b['x']-a['x'])*(c['y']-a['y'])-(b['y']-a['y'])*(c['x']-a['x'])

    def on(a, b, c):
        return (abs(cross(a, b, c)) < eps and min(a['x'], b['x'])-eps <= c['x'] <= max(a['x'], b['x'])+eps
                and min(a['y'], b['y'])-eps <= c['y'] <= max(a['y'], b['y'])+eps)

    def touches(a, b, c, d):
        return (cross(a, b, c)*cross(a, b, d) < 0 and cross(c, d, a)*cross(c, d, b) < 0
                or on(a, b, c) or on(a, b, d) or on(c, d, a) or on(c, d, b))

    for i, a in enumerate(points):
        b = points[(i+1) % len(points)]
        c = points[(i+2) % len(points)]
        if math.hypot(a['x']-b['x'], a['y']-b['y']) < eps:
            raise ValueError('Zwei aufeinanderfolgende Eckpunkte sind identisch.')
        if abs(cross(a, b, c)) < eps and (b['x']-a['x'])*(c['x']-b['x'])+(b['y']-a['y'])*(c['y']-b['y']) < 0:
            raise ValueError('Die Kontur darf nicht entlang derselben Wand zurücklaufen.')
        for j in range(i+1, len(points)):
            if j == i+1 or (i == 0 and j == len(points)-1):
                continue
            if touches(a, b, points[j], points[(j+1) % len(points)]):
                raise ValueError('Die Raumkontur darf sich nicht überschneiden oder selbst berühren.')
    area = abs(sum(a['x']*points[(i+1) % len(points)]['y']-points[(i+1) % len(points)]['x']*a['y']
                   for i, a in enumerate(points)))/2
    if area < 1:
        raise ValueError('Die Raumkontur muss eine Fläche einschließen.')
