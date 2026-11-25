"""Widen project settings for validated dashboard layouts; keep all values."""
from alembic import op
import sqlalchemy as sa
revision='0044'
down_revision='0043'
branch_labels=None
depends_on=None

def upgrade():
    # SQLite already stores arbitrary-length strings without a table rewrite.
    if op.get_bind().dialect.name!='sqlite':
        op.alter_column('setting','value',existing_type=sa.String(255),type_=sa.Text(),existing_nullable=False)

def downgrade():raise RuntimeError('Bitte ein geprüftes Projektbackup wiederherstellen.')
