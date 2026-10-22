import unittest
from unittest.mock import patch
from receipt_parser import parse_receipt, category_for, decimal_amount, extract_text

class ReceiptParserTest(unittest.TestCase):
    def test_receipt_total_date_and_category(self):
        raw='Bauhaus GmbH\nKassenbon 123\nDatum 21.10.2026\nSchrauben 3,99\nGesamtbetrag 13,99 EUR\n'
        x=parse_receipt(raw)
        self.assertEqual(x['document_date'],'2026-10-21')
        self.assertEqual(x['gross_amount'],'13.99')
        self.assertEqual(x['category'],'Eigenleistungen / Material')
    def test_ambiguous_without_total(self):
        x=parse_receipt('Elektro Muster GmbH\nLeitung 12,00')
        self.assertEqual(x['gross_amount'],'')
        self.assertEqual(x['category'],'Elektro')
        self.assertTrue(x['warnings'])
    def test_pdf_with_text(self):
        from pypdf import PdfWriter
        # Textless pdf is intentionally not interpreted as a valid existing text layer.
        writer=PdfWriter();writer.add_blank_page(width=612,height=792)
        import io
        f=io.BytesIO();writer.write(f)
        with patch('receipt_parser.subprocess.run',side_effect=FileNotFoundError):
            with self.assertRaisesRegex(ValueError,'OCR'):
                extract_text(f.getvalue(),'test.pdf')
    def test_category(self):
        self.assertEqual(category_for('Makita Akkuschrauber'),'Werkzeug')
        self.assertEqual(category_for('Unbekannter Posten'),'Sonstiges')

if __name__=='__main__':unittest.main()
