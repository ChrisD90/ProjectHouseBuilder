"""Move maintenance of contractor details and trades to master data.

Revision ID: 0010
Revises: 0009
"""
from alembic import op
import sqlalchemy as sa

revision='0010'
down_revision='0009'
branch_labels=None
depends_on=None


def upgrade():
    bind=op.get_bind()
    inspector=sa.inspect(bind)
    if inspector.has_table('contractor'):
        cols={c['name'] for c in inspector.get_columns('contractor')}
        for key,maxlen in (
            ('mobile',100),('phone_other',100),('contact_secondary',200),('website',240)
        ):
            if key not in cols:
                op.add_column('contractor',sa.Column(
                    key,sa.String(maxlen),nullable=False,server_default=''))
    if not inspector.has_table('trade'):
        op.create_table('trade',
            sa.Column('id',sa.Integer(),primary_key=True),
            sa.Column('name',sa.String(140),nullable=False,unique=True))
    # Preserve historic free-text trades and seed the editable vocabulary.
    existing={x[0].casefold() for x in bind.execute(sa.text('SELECT name FROM trade')).all()}
    names=set()
    for table in ('contractor','task'):
        # Some supported old databases contain partial task/contractor schemas.
        if inspector.has_table(table) and 'trade' in {
                c['name'] for c in inspector.get_columns(table)}:
            names.update(str(row[0]).strip() for row in bind.execute(
                sa.text('SELECT DISTINCT trade FROM '+table+' WHERE trade IS NOT NULL')).all())
    for name in sorted(names):
        if name and len(name)<=140 and name.casefold() not in existing:
            bind.execute(sa.text('INSERT INTO trade(name) VALUES (:name)'),{'name':name})
            existing.add(name.casefold())


def downgrade():
    raise RuntimeError('Bitte ein geprüftes Komplettbackup wiederherstellen.')
