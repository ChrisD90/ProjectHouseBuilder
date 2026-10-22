"""Baseline: create fresh schema, upgrade existing pre-Alembic SQLite DBs.

Revision ID: 0001
Revises:
"""
from alembic import op
from sqlalchemy import inspect, text
from app import db

revision = '0001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    # Initial migration must work with a brand new database AND old live user databases.
    # create_all never removes tables, rows, indexes or columns from existing tables.
    db.metadata.create_all(bind=bind, checkfirst=True)
    inspector = inspect(bind)
    additions = {
        'task': {'contractor_id': 'INTEGER'},
        'cost_item': {
            'budget_line_id': 'INTEGER',
            'selected': 'BOOLEAN NOT NULL DEFAULT 0',
            'offer_id': 'INTEGER',
        },
    }
    for table, columns in additions.items():
        if not inspector.has_table(table):
            raise RuntimeError(f'Missing base table: {table}')
        existing = {col['name'] for col in inspect(bind).get_columns(table)}
        for name, sql_type in columns.items():
            if name not in existing:
                op.execute(text(f'ALTER TABLE {table} ADD COLUMN {name} {sql_type}'))


def downgrade():
    raise RuntimeError('Downgrades are intentionally disabled; restore a verified backup instead.')
