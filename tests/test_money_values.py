import unittest
from decimal import Decimal
from sqlalchemy import create_engine,text,inspect,Numeric
from money_values import dec,rounded,total,migrate_money

class MoneyValuesTest(unittest.TestCase):
 def test_cent_rounding_is_explicit_and_totals_do_not_accumulate_float_error(self):
  self.assertEqual(rounded('2.675'),Decimal('2.68'))
  self.assertEqual(rounded('-2.675'),Decimal('-2.68'))
  self.assertEqual(total([0.1]*100),Decimal('10.0'))
  self.assertEqual(rounded(dec('0.1')*dec('0.05')),Decimal('0.01'))
  for bad in ('NaN','Infinity','not money'):
   with self.assertRaises(ValueError):dec(bad)
 def test_legacy_storage_conversion_keeps_values_and_non_money_columns(self):
  engine=create_engine('sqlite:///:memory:')
  with engine.begin() as connection:
   connection.execute(text('CREATE TABLE cost_item (id INTEGER PRIMARY KEY, title TEXT, estimate REAL)'))
   connection.execute(text("INSERT INTO cost_item VALUES (17,'Historisch',1234.56789012)"))
   migrate_money(connection)
   self.assertIsInstance(next(c['type'] for c in inspect(connection).get_columns('cost_item') if c['name']=='estimate'),Numeric)
   row=connection.execute(text('SELECT id,title,estimate FROM cost_item')).one()
   self.assertEqual(row[:2],(17,'Historisch'));self.assertEqual(dec(row.estimate),Decimal('1234.56789012'))
  engine.dispose()
