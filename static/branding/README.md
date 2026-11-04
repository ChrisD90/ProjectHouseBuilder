# Logos im Header

Die ausgelieferten SVGs sind Platzhalter mit dem bisherigen Namen. Ersetze sie durch die fertigen Logos:

- `logo-light.svg`: Logo für hellen Hintergrund.
- `logo-dark.svg`: Logo für dunklen Hintergrund.

Beide Dateien werden automatisch im Header oben links und auf der Projektübersicht verwendet. SVG mit transparentem Hintergrund und passendem `viewBox` ist empfohlen. Verwende für beide Varianten dasselbe Seitenverhältnis und möglichst wenig freien Rand. Die Darstellung ist maximal 236 × 40 px (auf schmalen Bildschirmen entsprechend kleiner) und verzerrt das Bild nicht.

Der Alternativtext ist in `frontend/src/brand.tsx` hinterlegt und kann beim endgültigen Namenswechsel angepasst werden. Bei anderen Dateiformaten müssen dort auch die Dateinamen angepasst werden. Nach einem Austausch Anwendung neu laden; bei Änderungen an der Komponente `npm --prefix frontend run build` ausführen.

## ChatGPT-Verbindung

- `logo-active-light.svg`: Verbunden und freigegeben, helles Theme.
- `logo-active-dark.svg`: Verbunden und freigegeben, dunkles Theme.
- `logo-inactive-light.svg`: Nicht verbunden oder Freigabe fehlt, helles Theme.
- `logo-inactive-dark.svg`: Nicht verbunden oder Freigabe fehlt, dunkles Theme.

Diese vier Dateien enthalten vorerst das bisherige Symbol als Platzhalter. Sie können durch die bereitgestellten Statuslogos ersetzt werden. Der Header wechselt die Datei automatisch je nach Verbindungsstatus und tatsächlich angezeigtem Theme, ohne Neubau der Oberfläche. Bei „System“ folgt das Logo auch einem Wechsel des Betriebssystem-Themes. Alle Varianten werden mit 22 × 22 px dargestellt; transparente SVGs mit demselben Seitenverhältnis eignen sich dafür. Ohne Verbindung zeigt der Button nur das Logo; der Status ist weiterhin im Tooltip verfügbar.
