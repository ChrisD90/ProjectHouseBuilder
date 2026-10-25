"""Regression tests for mixed scanned PDFs and local OCR tool diagnostics."""
import io
import unittest
from unittest.mock import patch
from pypdf import PdfWriter
from receipt_parser import extract_text, extract_pdf_pages, ocr_diagnostics


class HybridOCRTests(unittest.TestCase):
    @staticmethod
    def blank_pdf(pages=2):
        writer=PdfWriter()
        for _ in range(pages):writer.add_blank_page(width=595,height=842)
        output=io.BytesIO();writer.write(output)
        return output.getvalue()

    def test_scanned_pages_are_processed_individually(self):
        pdf=self.blank_pdf(3)
        calls=[]
        def fake_ocr(path):
            calls.append(path)
            return 'Bauunternehmen Seite '+str(len(calls))+' Gesamtbetrag 199,00 EUR'
        with patch('receipt_parser.subprocess.run') as runner,patch('receipt_parser._ocr',side_effect=fake_ocr):
            pages,used=extract_pdf_pages(pdf)
            self.assertTrue(used)
            self.assertEqual(len(pages),3)
            self.assertEqual(len(calls),3)
            self.assertEqual(runner.call_count,3)
            self.assertIn('Seite 3',pages[2])

    def test_local_receipt_extracts_all_scanned_pages(self):
        with patch('receipt_parser.subprocess.run'),patch('receipt_parser._ocr',return_value='Rechnung Beispiel Gesamtbetrag 149,90 EUR'):
            text,mode=extract_text(self.blank_pdf(6),'lieferant.pdf')
        self.assertEqual(mode,'OCR (PDF)')
        self.assertEqual(text.count('Rechnung Beispiel'),6)

    def test_missing_system_renderer_reports_ocr_error(self):
        with patch('receipt_parser.subprocess.run',side_effect=FileNotFoundError):
            with self.assertRaisesRegex(ValueError,'OCR'):
                extract_text(self.blank_pdf(),'test.pdf')

    def test_missing_ocr_language_reported(self):
        with patch('shutil.which',return_value=None):
            state=ocr_diagnostics()
        self.assertFalse(state['ready'])
        self.assertFalse(state['tools']['tesseract'])
        self.assertFalse(state['tools']['pdftoppm'])


if __name__=='__main__':unittest.main()
