"""Editable build phases and optional task deadlines.

Revision ID: 0022
Revises: 0021
"""
from alembic import op
import sqlalchemy as sa

revision='0022'
down_revision='0021'
branch_labels=None
depends_on=None


def upgrade():
    bind=op.get_bind();inspector=sa.inspect(bind)
    if not inspector.has_table('build_phase'):
        op.create_table('build_phase',
            sa.Column('id',sa.Integer(),primary_key=True),
            sa.Column('title',sa.String(140),nullable=False,unique=True),
            sa.Column('description',sa.String(1000),nullable=False,server_default=''),
            sa.Column('start_date',sa.Date(),nullable=False),
            sa.Column('end_date',sa.Date(),nullable=True),
            sa.Column('position',sa.Integer(),nullable=False,server_default='0'))
    if sa.inspect(bind).has_table('task'):
        columns={column['name'] for column in sa.inspect(bind).get_columns('task')}
        if 'phase_id' not in columns:op.add_column('task',sa.Column('phase_id',sa.Integer(),nullable=True))
        if 'planned_end' not in columns:op.add_column('task',sa.Column('planned_end',sa.Date(),nullable=True))
        columns={column['name'] for column in sa.inspect(bind).get_columns('task')}
        if 'phase' in columns:
            start='2027-03-01'
            if sa.inspect(bind).has_table('setting'):
                found=bind.execute(sa.text("SELECT value FROM setting WHERE key='start'")).scalar()
                if found:start=found
            existing={str(row[1]).casefold():row[0] for row in bind.execute(
                sa.text('SELECT id,title FROM build_phase')).all()}
            titles=[row[0] for row in bind.execute(sa.text(
                "SELECT DISTINCT phase FROM task WHERE phase IS NOT NULL AND TRIM(phase)<>''")).all()]
            for position,title in enumerate(titles):
                key=str(title).casefold()
                if key not in existing:
                    bind.execute(sa.text(
                        'INSERT INTO build_phase (title,description,start_date,position) '
                        'VALUES (:title,:description,:start_date,:position)'),
                        {'title':title,'description':'','start_date':start,'position':position})
                    existing[key]=bind.execute(sa.text(
                        'SELECT id FROM build_phase WHERE title=:title'),{'title':title}).scalar_one()
                bind.execute(sa.text('UPDATE task SET phase_id=:phase_id WHERE phase=:title'),
                             {'phase_id':existing[key],'title':title})


def downgrade():
    raise RuntimeError('Bitte ein geprüftes Komplettbackup wiederherstellen.')
