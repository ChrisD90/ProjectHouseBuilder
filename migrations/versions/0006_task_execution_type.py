"""Classify schedule tasks as self-performed or externally contracted.

Revision ID: 0006
Revises: 0005
"""
from alembic import op
import sqlalchemy as sa

revision = '0006'
down_revision = '0005'
branch_labels = None
depends_on = None


def upgrade():
    bind=op.get_bind()
    inspector=sa.inspect(bind)
    if not inspector.has_table('task'):
        return  # Very incomplete legacy schema; app.initialize creates missing tables.
    columns={x['name'] for x in inspector.get_columns('task')}
    if 'execution_type' not in columns:
        op.add_column('task',sa.Column('execution_type',sa.String(24),nullable=False,server_default='Noch offen'))
    # Only mark unambiguous existing labels; preserve everything else as unknown
    # to avoid silently calling a joint or unplanned task a contractor task.
    op.execute(sa.text("""UPDATE task SET execution_type='Eigenleistung'
        WHERE execution_type='Noch offen' AND (
          LOWER(trade) LIKE '%eigenleistung%' OR LOWER(trade) LIKE '%bauherrschaft%'
        ) AND LOWER(trade) NOT LIKE '% / %'"""))


def downgrade():
    raise RuntimeError('Bitte ein geprüftes Komplettbackup wiederherstellen.')
