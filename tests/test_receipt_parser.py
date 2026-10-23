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
    def test_labeled_invoice_total_with_separate_amount_and_dates(self):
        raw=('Malerbetrieb Beispiel GmbH\\nRechnung Nr. MB-2026-471\\n'
             'Rechnungsdatum: 22.10.2026\\nZahlbar bis 05.11.2026\\n'
             'Zwischensumme netto 1.000,00 EUR\\n'
             'Umsatzsteuer 19 % 190,00 EUR\\n'
             'Bereits bezahlt 300,00 EUR\\n'
             'Gesamtbetrag\\n1.190,00 EUR')
        parsed=parse_receipt(raw)
        self.assertEqual(parsed['invoice_number'],'MB-2026-471')
        self.assertEqual(parsed['document_date'],'2026-10-22')
        self.assertEqual(parsed['due_date'],'2026-11-05')
        self.assertEqual(parsed['gross_amount'],'1190.00')
        self.assertEqual(parsed['net_amount'],'1000.00')
        self.assertEqual(parsed['vat_amount'],'190.00')
        self.assertEqual(parsed['supplier'],'Malerbetrieb Beispiel GmbH')
        self.assertNotIn('Gesamtbetrag nicht sicher erkannt.',parsed['warnings'])

    def test_installments_are_not_mistaken_for_full_invoice_total(self):
        raw=('Sanitär Fachbetrieb\\nSchlussrechnung RE-77\\n'
             'Netto 10.000,00 EUR\\nMehrwertsteuer 1.900,00 EUR\\n'
             'Rechnungsbetrag 11.900,00 EUR\\n'
             'bereits gezahlte Abschläge 7.000,00 EUR\\n'
             'Noch zu zahlen 4.900,00 EUR')
        parsed=parse_receipt(raw)
        self.assertEqual(parsed['gross_amount'],'11900.00')
        self.assertEqual(parsed['billing_type'],'Schlussrechnung')
        self.assertEqual(parsed['net_amount'],'10000.00')
        self.assertEqual(parsed['vat_amount'],'1900.00')

    def test_no_assumed_total_from_single_item_price(self):
        parsed=parse_receipt('Lagerbedarf\\nArtikel 3,99 EUR\\nBezahlart Kartenzahlung')
        self.assertEqual(parsed['gross_amount'],'')
        self.assertTrue(parsed['warnings'])

    def test_category(self):
        self.assertEqual(category_for('Makita Akkuschrauber'),'Werkzeug')
        self.assertEqual(category_for('Unbekannter Posten'),'Sonstiges')

if __name__=='__main__':unittest.main()
