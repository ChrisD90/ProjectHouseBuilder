# Lokale OCR: Bildaufbereitung und Qualitätsbewertung

Die lokale Verarbeitung nutzt weiterhin Tesseract (`deu+eng`), Poppler und Pillow. Es kommen keine weiteren Laufzeitpakete, Cloudzugänge oder automatisch heruntergeladenen Modelle hinzu.

## Verarbeitung

1. Native PDF-Textebenen bleiben vorrangig. Nur Seiten mit sehr wenig Text oder deutlichen Ersatzzeichen werden gerastert, jetzt mit 300 statt 230 dpi.
2. Für Fotos und gerasterte Seiten werden ausschließlich temporäre Kopien bearbeitet: EXIF-Ausrichtung, Transparenz auf Weiß, Graustufen, vorsichtige Kontrastanpassung und Schärfung. Kleine Bilder werden begrenzt hochskaliert; verlorene Bilddetails lassen sich dadurch nicht wiederherstellen.
3. Tesseracts optionale Ausrichtungserkennung korrigiert 90°/180°/270° nur bei hinreichender Sicherheit. Fehlendes `osd` verhindert die normale OCR nicht. Kleine Schräglagen werden konservativ anhand horizontaler Textprojektionen korrigiert.
4. Die Erkennung verwendet TSV-Wortpositionen und Wortsicherheiten. Bei schwachen Ergebnissen folgen ein anderes Seitenlayout und gegebenenfalls eine binarisierte Bildkopie. Gute Ergebnisse stoppen früh. Die Ausgabe wird nach Wortsicherheit und Textabdeckung gewählt, nicht nach der längsten Zeichenfolge.
5. Unklare Zahlen oder niedrige Wortsicherheit führen bei Rechnungen und Angeboten zu einem Hinweis in den bestehenden Erkennungswarnungen. Dieser Wert ist keine Wahrscheinlichkeit dafür, dass Rechnungsfelder korrekt sind. Beträge, Datum und Nummer müssen weiterhin geprüft werden.

Die Bildverarbeitung hat eine Grenze von 25 Millionen Eingangspixeln. Ein Erkennungsauftrag je Bild/Seite hat ein Zeitbudget von 85 Sekunden mit höchstens drei Texterkennungsversuchen. PDF-Rasterung hat weiterhin ein separates Zeitlimit. Die bestehenden Dokument-Seitenlimits bleiben erhalten. Lesbare PDF-Seiten gehen bei einer fehlgeschlagenen anderen Seite nicht mehr verloren; der Upload zeigt die betreffende Seite als Warnung.

Originaldateien werden nicht überschrieben. Die OCR erzeugt ausschließlich Vorschläge und löst keine Buchung aus. Manuelle Erfassung und ChatGPT-Analyse bleiben wie bisher verfügbar.

## Prüfung und Grenzen

Gezielte Prüfungen sichern Originalerhalt, Auswahl verlässlicher Texte statt langer Erkennungsfehler und den Erhalt nativer PDF-Seiten bei einzelnen OCR-Fehlern. Der vorhandene echte OCR-Smoke-Test liest ein synthetisches Foto sowie beide Seiten eines gescannten PDFs mit Deutsch/Englisch. Das ist keine repräsentative Messung der Erkennungsrate auf Benutzerbelegen.

Starke Perspektivverzerrung, Handschrift und komplexe Positionstabellen bleiben mögliche Schwachstellen. Dafür wären ein gesondert vermessener optionaler PaddleOCR-Backend oder spezialisierte Layoutanalyse nächste Ausbaustufen. OCRmyPDF wäre vor allem für zusätzlich durchsuchbare PDF-Kopien geeignet; es wird hier nicht zur Pflichtabhängigkeit. Größere Tesseract-Modelle können auf einem Beleg-Testkorpus geprüft werden, bevor sie wegen höherem Speicher-/Zeitbedarf Standard werden.

Technische Referenzen:

- [Tesseract: Improving the quality of the output](https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html)
- [Tesseract: Command-Line Usage, TSV und Seitensegmentierung](https://tesseract-ocr.github.io/tessdoc/Command-Line-Usage.html)
- [OCRmyPDF: Cookbook](https://ocrmypdf.readthedocs.io/en/latest/cookbook.html)
- [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR)
