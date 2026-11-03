# Mitgelieferte Komponenten – Testbuild

Die Anwendung enthält Python, die Pakete aus `desktop/requirements.txt` und eine
Conda-forge-Umgebung mit Tesseract und Poppler. Deren Lizenz- und Paketmetadaten
liegen unter `_internal/ocr/conda-meta`; die beim Build ermittelten Versionen und
Quellen stehen in `_internal/ocr/package-manifest.json`.

Tesseract und tessdata_fast: https://github.com/tesseract-ocr (Apache-2.0).
Poppler: https://poppler.freedesktop.org/ (GPL; genaue Version siehe Manifest).
pywebview: https://github.com/r0x0r/pywebview (BSD-3-Clause).
PyInstaller: https://pyinstaller.org/ (GPL mit Bootloader-Ausnahme).
WebView2: Microsoft-Laufzeit, Installation über Microsofts Bootstrapper.

Dies legt **keine Lizenz für den eigenen Anwendungscode** fest. Vor einer
öffentlichen Verteilung müssen die Lizenzpflichten aller tatsächlich gebündelten
Pakete einschließlich Bereitstellung erforderlicher korrespondierender Quellen
geprüft und erfüllt werden. Der Workflow erzeugt zunächst ein Testartefakt,
keinen veröffentlichten GitHub Release. Das Repository ist öffentlich; auch
Actions-Artefakte sind deshalb nicht als private Ablage zu behandeln.
