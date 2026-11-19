"""Project-owned company favorites, existing companies remain unchanged."""
from alembic import op
import sqlalchemy as sa
revision='0041'
down_revision='0040'
branch_labels=None
depends_on=None

def upgrade():
    if 'favorite' not in {c['name'] for c in sa.inspect(op.get_bind()).get_columns('contractor')}:
        op.add_column('contractor',sa.Column('favorite',sa.Boolean(),nullable=False,server_default=sa.false()))

def downgrade():
    raise RuntimeError('Bitte ein geprüftes Projektbackup wiederherstellen.')
