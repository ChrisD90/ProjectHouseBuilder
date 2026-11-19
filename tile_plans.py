"""Validate user supplied room contours before storing project-local tile plans."""
import math


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
