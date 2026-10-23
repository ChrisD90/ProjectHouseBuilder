"""Remove retired spreadsheet-template metadata, preserving costs and user entries.

Revision ID: 0004
Revises: 0003
"""
from alembic import op
import sqlalchemy as sa

revision = '0004'
down_revision = '0003'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table('historical_estimate'):
        op.drop_table('historical_estimate')
    if inspector.has_table('budget_line'):
        cols = {x['name'] for x in sa.inspect(bind).get_columns('budget_line')}
        # Batch operations handle SQLite versions without native DROP COLUMN.
        removed = [name for name in ('marker','source_row') if name in cols]
        if removed:
            with op.batch_alter_table('budget_line') as batch:
                for name in removed:
                    batch.drop_column(name)
    if inspector.has_table('setting'):
        op.execute(sa.text("DELETE FROM setting WHERE key IN ('excel_budget_initialized','historical_funding')"))


def downgrade():
    raise RuntimeError('Bitte ein geprüftes Komplettbackup wiederherstellen.')
