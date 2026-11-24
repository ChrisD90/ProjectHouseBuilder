"""Non-destructive baseline positions, shared by startup, Alembic and restores."""
from decimal import Decimal
import sqlalchemy as sa

DESCRIPTION='Gesamtangebot (Sammelposition)'


def baseline_net(net,gross,vat):
    if net is not None:return net
    if gross is not None and vat is not None:
        result=Decimal(str(gross))-Decimal(str(vat))
        if result.is_finite() and result>=0:return result
    return None  # Never guess a tax rate for a historical document.


def baseline_values(net,gross,vat):
    amount=baseline_net(net,gross,vat)
    return dict(number='1',section='',description=DESCRIPTION,quantity=1,unit='Pauschal',
                unit_price=amount,net_amount=amount,optional_amount=None,optional=False,own_work=False,page=None)


def tables(connection):
    inspector=sa.inspect(connection)
    if not inspector.has_table('offer') or not inspector.has_table('offer_position'):return None
    if 'project_id' not in {c['name'] for c in inspector.get_columns('offer_position')}:return None
    metadata=sa.MetaData()
    return tuple(sa.Table(name,metadata,autoload_with=connection,resolve_fks=False) for name in ('offer','offer_position'))


def missing_query(offer,position,owner=None):
    query=sa.select(offer).where(~sa.exists(sa.select(position.c.id).where(position.c.offer_id==offer.c.id)))
    return query.where(offer.c.project_id==owner) if owner is not None else query


def pending(engine):
    with engine.connect() as connection:
        pair=tables(connection)
        return bool(pair and connection.execute(missing_query(*pair).limit(1)).first())


def backfill(connection,owner=None):
    pair=tables(connection)
    if not pair:return 0
    offer,position=pair
    rows=list(connection.execute(missing_query(offer,position,owner)).mappings())
    for row in rows:
        connection.execute(position.insert().values(offer_id=row['id'],project_id=row['project_id'],
            **baseline_values(row['net'],row['gross'],row['vat'])))
    return len(rows)


def install(runtime):
    from multi_projects import current_project_id
    def ensure(offer):
        if not offer.positions:
            offer.positions.append(runtime.OfferPosition(project_id=offer.project_id or current_project_id(),
                **baseline_values(offer.net,offer.gross,offer.vat)))
    def before_commit(session):
        for obj in list(session.new)+list(session.identity_map.values()):
            if isinstance(obj,runtime.Offer) and obj not in session.deleted and obj.project_id in (None,current_project_id()):ensure(obj)
    sa.event.listen(runtime.db.session.session_factory.class_,'before_commit',before_commit)
    runtime.ensure_offer_position=ensure
