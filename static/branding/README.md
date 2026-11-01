# Logos im Header

Die ausgelieferten SVGs sind Platzhalter mit dem bisherigen Namen. Ersetze sie durch die fertigen Logos:

- `logo-light.svg`: Logo für hellen Hintergrund.
- `logo-dark.svg`: Logo für dunklen Hintergrund.

Beide Dateien werden automatisch im Header oben links und auf der Projektübersicht verwendet. SVG mit transparentem Hintergrund und passendem `viewBox` ist empfohlen. Verwende für beide Varianten dasselbe Seitenverhältnis und möglichst wenig freien Rand. Die Darstellung ist maximal 200 × 30 px (auf schmalen Bildschirmen entsprechend kleiner) und verzerrt das Bild nicht.

Der Alternativtext ist in `frontend/src/brand.tsx` hinterlegt und kann beim endgültigen Namenswechsel angepasst werden. Bei anderen Dateiformaten müssen dort auch die Dateinamen angepasst werden. Nach einem Austausch Anwendung neu laden; bei Änderungen an der Komponente `npm --prefix frontend run build` ausführen.
