"""Bounded local Tesseract pipeline. Originals are only read, never rewritten."""
from dataclasses import dataclass
from io import StringIO
from pathlib import Path
import csv
import math
import re
import subprocess
import tempfile
import time

from PIL import Image, ImageFilter, ImageOps, ImageStat, UnidentifiedImageError
from ocr_runtime import ocr_command

MAX_PIXELS = 25_000_000
MAX_SECONDS = 85


@dataclass(frozen=True)
class Recognition:
    text: str
    confidence: float
    reliable_fraction: float
    uncertain_numbers: bool = False

    @property
    def good(self):
        return len(re.sub(r'\s', '', self.text)) >= 35 and self.confidence >= 78 and self.reliable_fraction >= .7 and not self.uncertain_numbers

    @property
    def score(self):
        # A few perfectly recognised words must not displace a whole invoice.
        coverage = min(1, len(re.sub(r'\s', '', self.text)) / 80)
        return self.confidence * coverage * (.7 + .3 * self.reliable_fraction)


def read_tsv(raw):
    """Use word confidence and line IDs, not the length of an OCR string."""
    lines = {}; words = []
    for row in csv.DictReader(StringIO(raw), delimiter='\t', quoting=csv.QUOTE_NONE):
        if row.get('level') != '5':
            continue
        word = (row.get('text') or '').strip()
        try:
            conf = float(row['conf'])
        except (KeyError, TypeError, ValueError):
            continue
        if not word or not math.isfinite(conf) or not 0 <= conf <= 100:
            continue
        key = tuple(row.get(k) for k in ('page_num', 'block_num', 'par_num', 'line_num'))
        lines.setdefault(key, []).append(word)
        words.append((word, conf))
    weight = sum(len(word) for word, _ in words)
    confidence = sum(len(word) * conf for word, conf in words) / weight if weight else 0
    reliable = sum(len(word) for word, conf in words if conf >= 70) / weight if weight else 0
    numeric = any(any(char.isdigit() for char in word) and conf < 65 for word, conf in words)
    return Recognition('\n'.join(' '.join(line) for line in lines.values()), confidence, reliable, numeric)


def prepare_image(source):
    with Image.open(source) as image:
        if image.width * image.height > MAX_PIXELS:
            raise ValueError('Bildauflösung zu groß für die lokale OCR. Bitte einen kleineren Scan verwenden.')
        image = ImageOps.exif_transpose(image)
        if image.mode in ('RGBA', 'LA') or 'transparency' in image.info:
            rgba = image.convert('RGBA')
            canvas = Image.new('RGBA', rgba.size, 'white')
            canvas.alpha_composite(rgba)
            image = canvas.convert('RGB')
        image = ImageOps.grayscale(image)
        # Scale small photos without pretending that interpolation restores lost detail.
        scale = min(2, max(1, 1000 / min(image.size)), math.sqrt(MAX_PIXELS / (image.width * image.height)))
        if scale > 1.05:
            image = image.resize((round(image.width * scale), round(image.height * scale)), Image.Resampling.LANCZOS)
        image = ImageOps.autocontrast(image, cutoff=0)
        return image.filter(ImageFilter.UnsharpMask(radius=1, percent=110, threshold=3))


def orientation(path, remaining):
    """OSD is optional; absence of the osd language never disables ordinary OCR."""
    try:
        result = subprocess.run(ocr_command('tesseract') + [str(path), 'stdout', '-l', 'osd', '--psm', '0'],
                                capture_output=True, text=True, timeout=min(8, remaining), check=True)
        rotation = re.search(r'^Rotate:\s*(90|180|270)\s*$', result.stdout, re.M)
        confidence = re.search(r'^Orientation confidence:\s*([\d.]+)', result.stdout, re.M)
        if rotation and confidence and float(confidence[1]) >= 8:
            return -int(rotation[1])  # Tesseract reports clockwise correction; PIL uses counterclockwise.
    except (OSError, subprocess.SubprocessError):
        pass
    return 0


def deskew(image):
    """Conservative small-angle correction by horizontal ink projection."""
    sample = image.copy()
    sample.thumbnail((650, 850))
    # Inverted binary ink makes every row sum proportional to its dark pixels.
    sample = sample.point(lambda p: 255 if p < 150 else 0)
    def score(angle):
        rotated = sample.rotate(angle, resample=Image.Resampling.NEAREST, fillcolor=0)
        sums = [ImageStat.Stat(rotated.crop((0, y, rotated.width, y + 1))).sum[0] for y in range(rotated.height)]
        return sum((b - a) ** 2 for a, b in zip(sums, sums[1:]))
    baseline = score(0)
    scores = [(score(angle), angle) for angle in (-3, -2, -1, -.5, .5, 1, 2, 3)]
    best, angle = max(scores)
    if baseline and best > baseline * 1.2:
        return image.rotate(angle, resample=Image.Resampling.BICUBIC, expand=True, fillcolor=255)
    return image


def recognize_image(source):
    deadline = time.monotonic() + MAX_SECONDS
    try:
        image = prepare_image(source)
        with tempfile.TemporaryDirectory(prefix='phb-ocr-') as folder:
            prepared = Path(folder) / 'prepared.png'
            image.save(prepared, dpi=(300, 300))
            angle = orientation(prepared, max(1, deadline - time.monotonic()))
            if angle:
                image = image.rotate(angle, expand=True, fillcolor=255)
            image = ImageOps.expand(deskew(image), border=12, fill=255)
            image.save(prepared, dpi=(300, 300))
            best = Recognition('', 0, 0); failure = None
            for attempt, mode in enumerate(('3', '6', '6')):
                remaining = deadline - time.monotonic()
                if remaining < 1:
                    break
                if attempt == 2:
                    # Hard thresholding is only a fallback for faint/uneven scans.
                    image.point(lambda p: 0 if p < 170 else 255).save(prepared, dpi=(300, 300))
                try:
                    result = subprocess.run(ocr_command('tesseract') + [str(prepared), 'stdout', '-l', 'deu+eng',
                        '--dpi', '300', '--psm', mode, '-c', 'tessedit_create_tsv=1', '-c', 'tessedit_create_txt=0'], timeout=min(25, remaining), check=True,
                        capture_output=True, text=True)
                    candidate = read_tsv(result.stdout)
                    if candidate.score > best.score:
                        best = candidate
                    if best.good:
                        break
                except (OSError, subprocess.SubprocessError) as exc:
                    failure = exc
            if not best.text:
                if isinstance(failure, FileNotFoundError):
                    raise ValueError('Tesseract nicht installiert. OCR-Diagnose auf der Datenseite prüfen.') from failure
                if isinstance(failure, subprocess.TimeoutExpired):
                    raise ValueError('OCR-Zeitlimit überschritten. Bitte Scan prüfen oder manuell erfassen.') from failure
                if failure:
                    raise ValueError('Tesseract konnte die Datei nicht erkennen (deu/eng Sprachpakete prüfen).') from failure
                raise ValueError('Kein lesbarer OCR-Text erkannt. Bitte einen schärferen Scan verwenden oder manuell erfassen.')
            return best
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise ValueError('Das Bild konnte für die lokale OCR nicht aufbereitet werden.') from exc
