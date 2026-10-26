"""Real local image + scanned PDF OCR, with synthetic data and no external requests."""
import io
from pathlib import Path
import sys

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from PIL import Image, ImageDraw, ImageFont
from ocr_runtime import main as check_ocr
from receipt_parser import extract_text


def run():
    if check_ocr(['--check']):
        raise SystemExit(1)
    pages=[]
    for position in ('Fenster','Dacharbeiten'):
        image=Image.new('RGB',(1654,2339),'white')
        draw=ImageDraw.Draw(image)
        font=ImageFont.load_default(size=42)
        for row,text in enumerate(('Rechnung Musterbetrieb',position,'Gesamtbetrag 123,45 EUR')):
            draw.text((130,180+row*100),text,font=font,fill='black')
        pages.append(image)
    photo=io.BytesIO();pages[0].save(photo,format='PNG')
    text,mode=extract_text(photo.getvalue(),'synthetischer-beleg.png')
    assert mode=='OCR (Foto)' and 'Fenster' in text and '123,45' in text,(mode,text)
    pdf=io.BytesIO();pages[0].save(pdf,format='PDF',save_all=True,append_images=pages[1:],resolution=200)
    text,mode=extract_text(pdf.getvalue(),'synthetischer-scan.pdf')
    assert mode=='OCR (PDF)' and all(word in text for word in ('Fenster','Dacharbeiten','123,45')),(mode,text)
    print('OCR-Smoke-Test erfolgreich: Foto und beide gescannten PDF-Seiten mit deu+eng gelesen.')


if __name__=='__main__':
    run()
