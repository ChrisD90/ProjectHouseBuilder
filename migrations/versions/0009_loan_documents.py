"""Private loan attachments, without modifying existing credit terms.

Revision ID: 0009
Revises: 0008
"""
from alembic import op
import sqlalchemy as sa

revision = '0009'
down_revision = '0008'
branch_labels = None
depends_on = None


def upgrade():
    if not sa.inspect(op.get_bind()).has_table('finance_loan_document'):
        op.create_table(
            'finance_loan_document',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('loan_id', sa.Integer(),
                      sa.ForeignKey('finance_loan.id', ondelete='RESTRICT'), nullable=False),
            sa.Column('original_name', sa.String(240), nullable=False),
            sa.Column('stored_name', sa.String(80), nullable=False, unique=True),
            sa.Column('notes', sa.String(500), nullable=False, server_default=''),
            sa.Column('uploaded_at', sa.DateTime(), nullable=False,
                      server_default=sa.func.current_timestamp()),
        )


def downgrade():
    raise RuntimeError('Bitte ein geprüftes Komplettbackup wiederherstellen.')
