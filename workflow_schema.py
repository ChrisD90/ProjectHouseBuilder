"""Idempotent additive upgrades for launchers that use initialize directly."""
from sqlalchemy import inspect,text
COLUMNS=(('calendar_preferences','work_json',"TEXT NOT NULL DEFAULT '{}'"),('finance_loan_drawdown','payouts_json',"TEXT NOT NULL DEFAULT '[]'"),('self_work_plan','calendar_event_id','INTEGER'),('offer','payment_completed','BOOLEAN NOT NULL DEFAULT FALSE'))
def pending(engine):
    inspector=inspect(engine)
    return [(table,column,kind) for table,column,kind in COLUMNS if inspector.has_table(table) and column not in {c['name'] for c in inspector.get_columns(table)}]
def upgrade(engine,changes):
    with engine.begin() as connection:
        for table,column,kind in changes:connection.execute(text(f'ALTER TABLE {table} ADD COLUMN {column} {kind}'))
