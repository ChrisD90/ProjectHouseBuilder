"""Small safety checks: no original mutation or replacement by longer noisy OCR."""
from pathlib import Path
from subprocess import CompletedProcess
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from PIL import Image, ImageDraw
from receipt_parser import _ocr, extract_pdf_pages


def tsv(words):
    header='level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n'
    return header+''.join(f'5\t1\t1\t1\t1\t{i}\t0\t0\t20\t10\t{conf}\t{word}\n' for i,(word,conf) in enumerate(words,1))


class OCRQualitySafetyTest(unittest.TestCase):
    def test_keeps_original_and_reliable_amount_instead_of_longer_noise(self):
        with TemporaryDirectory() as folder:
            source=Path(folder)/'original.png'
            image=Image.new('RGB',(600,900),'white');ImageDraw.Draw(image).text((40,60),'Rechnung 123,45 EUR',fill='black');image.save(source)
            original=source.read_bytes();temporary=[]
            def engine(command,**kwargs):
                temporary.append(Path(command[1]));self.assertTrue(temporary[-1].is_file())
                if 'osd' in command:return CompletedProcess(command,0,'Rotate: 90\nOrientation confidence: 12\n','')
                text=tsv([('Rechnung',96),('Bauunternehmen',96),('Gesamtbetrag',96),('123,45',45),('EUR',96)]) if len(temporary)==2 else tsv([('unleserlich'*20,28),('999,99',15)])
                return CompletedProcess(command,0,text,'')
            warnings=[]
            with patch('local_ocr.subprocess.run',side_effect=engine):
                text=_ocr(source,diagnostics=warnings)
            self.assertIn('123,45',text);self.assertNotIn('999,99',text)
            self.assertTrue(warnings);self.assertEqual(source.read_bytes(),original)
            self.assertTrue(all(not path.exists() for path in temporary))

    def test_failed_scan_keeps_other_native_pages_and_exposes_warning(self):
        native='Rechnung Bauunternehmen. Bereits vorhandene PDF-Textebene 123,45 EUR.'
        pages=[SimpleNamespace(extract_text=lambda **kw:native),SimpleNamespace(extract_text=lambda **kw:'')]
        reader=SimpleNamespace(pages=pages,is_encrypted=False)
        warnings=[]
        with patch('receipt_parser.PdfReader',return_value=reader),patch('receipt_parser.subprocess.run'),patch('receipt_parser._ocr',side_effect=ValueError('Scan beschädigt')):
            result,used=extract_pdf_pages(b'%PDF-test',diagnostics=warnings)
        self.assertEqual(result,[native,'']);self.assertFalse(used)
        self.assertTrue(any('Seite 2' in warning and 'Scan beschädigt' in warning for warning in warnings))
