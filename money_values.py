"""Explicit monetary arithmetic; float conversion belongs to legacy/API boundaries."""
from decimal import Decimal,InvalidOperation,ROUND_HALF_UP
from sqlalchemy import Numeric
CENT=Decimal('0.01')
ZERO=Decimal('0')

def dec(value):
    try:
        result=Decimal(str(value or 0))
        if not result.is_finite():raise ValueError('Betrag muss endlich sein.')
        return result
    except (InvalidOperation,TypeError):raise ValueError('Ungültiger Betrag.') from None

def rounded(value):return dec(value).quantize(CENT,rounding=ROUND_HALF_UP)
def total(values):return sum((dec(value) for value in values),ZERO)
def wire(value):
    if isinstance(value,Decimal):return float(value)
    if isinstance(value,dict):return {key:wire(item) for key,item in value.items()}
    if isinstance(value,(list,tuple)):return [wire(item) for item in value]
    return value

def Money():
    # Twelve fractional digits retain legacy unit/net prices; totals alone round to cents.
    # Existing classic editors receive floats, while the domain helpers always use Decimal.
    return Numeric(30,12,asdecimal=False)

MONEY_COLUMNS={'cost_item':('estimate','offer','committed','paid','own_hourly'),
 'budget_line':('estimate',),'funding':('expected','confirmed','received'),
 'offer':('gross','net','vat'),'offer_section':('net','gross'),
 'offer_position':('unit_price','net_amount','optional_amount')}

def migrate_money(connection):
    from sqlalchemy import inspect,Float,Numeric
    from alembic.operations import Operations
    from alembic.migration import MigrationContext
    op=Operations(MigrationContext.configure(connection))
    inspector=inspect(connection)
    for name,fields in MONEY_COLUMNS.items():
        if not inspector.has_table(name):continue
        columns={column['name']:column for column in inspector.get_columns(name)}
        changed=[field for field in fields if field in columns and not isinstance(columns[field]['type'],Numeric)]
        if not changed:continue
        with op.batch_alter_table(name) as batch:
            for field in changed:
                extra={'postgresql_using':f'"{field}"::numeric(30,12)'} if connection.dialect.name=='postgresql' else {}
                batch.alter_column(field,existing_type=columns[field]['type'],type_=Numeric(30,12),existing_nullable=columns[field]['nullable'],**extra)
