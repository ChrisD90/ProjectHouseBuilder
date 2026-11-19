"""Cash payable after installment deductions and explicitly confirmed discounts."""
from decimal import Decimal

def payable(receipt):
    base=Decimal(receipt.gross_amount or 0)-Decimal(receipt.advance_deduction or 0)
    terms=getattr(receipt,'discount_terms',None)
    discount=Decimal(terms.settled or 0) if terms and receipt.status=='Gebucht' else Decimal(0)
    return base-discount
