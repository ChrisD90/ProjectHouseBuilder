"""Costs And Masterdata services. Dependencies are supplied by the application composition root.

Original entry points stay exported on runtime for CLI integrations and tests.
No imports of app.py and no implicit application context are required.
"""
from types import ModuleType

def register(runtime: ModuleType):
    def as_dict(obj, fields):
        return {f: getattr(obj, f) for f in fields} | {'id': obj.id}

    runtime.as_dict = as_dict

    def update_record(obj, body, fields):
        for f in fields:
            if f not in body:
                continue
            v = body[f]
            if f in ('contractor_id', 'task_id', 'budget_line_id'):
                v = int(v) if v not in ('', None) else None
            elif f == 'selected':
                v = v is True or str(v).lower() in ('true', 'on', '1', 'yes')
            elif f in ('estimate', 'offer', 'committed', 'paid', 'own_hours', 'own_hourly'):
                v = float(v or 0)
                if not runtime.math.isfinite(v) or v < 0:
                    raise ValueError('Beträge und Stunden müssen endliche, nicht negative Zahlen sein.')
            else:
                v = str(v or '')
            setattr(obj, f, v)
        if not getattr(obj, 'name', getattr(obj, 'title', '')).strip():
            raise ValueError('Name/Bezeichnung fehlt.')
        if isinstance(obj, runtime.CostItem):
            if obj.kind not in ('Fremdleistung', 'Eigenleistung'):
                raise ValueError('Ungültige Leistungsart.')
            if obj.state not in ('Schätzung', 'Angebot', 'Beauftragt', 'Abgeschlossen', 'Alternative', 'Abgelehnt'):
                raise ValueError('Ungültiger Status.')
            if obj.budget_line_id and (not runtime.db.session.get(runtime.BudgetLine, obj.budget_line_id)):
                raise ValueError('Budgetzeile nicht vorhanden.')
            if obj.selected and obj.state in ('Alternative', 'Abgelehnt'):
                raise ValueError('Abgelehntes/alternatives Angebot kann nicht ausgewählt sein.')
            if obj.selected and obj.budget_line_id:
                other = runtime.db.session.scalar(runtime.select(runtime.CostItem.id).where(runtime.CostItem.budget_line_id == obj.budget_line_id, runtime.CostItem.selected.is_(True), runtime.CostItem.id != obj.id).limit(1))
                if other:
                    raise ValueError('Für diese Budgetposition ist bereits ein anderes Angebot ausgewählt. Dort zuerst die Auswahl entfernen.')
            if obj.contractor_id and (not runtime.db.session.get(runtime.Contractor, obj.contractor_id)):
                raise ValueError('Firma nicht vorhanden.')
            if obj.task_id and (not runtime.db.session.get(runtime.Task, obj.task_id)):
                raise ValueError('Arbeitspaket nicht vorhanden.')

    runtime.update_record = update_record

    def all_budget_lines():
        return runtime.db.session.scalars(runtime.select(runtime.BudgetLine).order_by(runtime.BudgetLine.sort_order, runtime.BudgetLine.id)).all()

    runtime.all_budget_lines = all_budget_lines

    def budget_dict(x):
        return {key: getattr(x, key) for key in ('id', 'code', 'category', 'title', 'parent_code', 'estimate', 'company_hint', 'kind', 'notes', 'sort_order', 'is_group', 'active')}

    runtime.budget_dict = budget_dict

    def funding_dict(x):
        return runtime.energy_funding_dict(x)

    runtime.funding_dict = funding_dict

    def _receipt_increment(r):
        """Amount newly invoiced; a final invoice may repeat earlier installments.

        Never change the document's original gross amount; only adjust the amount
        counted toward contractor commitments, budget and remaining payables.
        """
        from decimal import Decimal
        return Decimal(r.gross_amount or 0) - Decimal(r.advance_deduction or 0)

    runtime._receipt_increment = _receipt_increment

    def _accepted_receipt_offer(r):
        if not r.cost_item_id:
            return None
        cost = runtime.db.session.get(runtime.CostItem, r.cost_item_id)
        if not cost or not cost.offer_id:
            return None
        offer = runtime.db.session.get(runtime.Offer, cost.offer_id)
        return offer if offer and offer.status in ('Angenommen', 'Beauftragt') else None

    runtime._accepted_receipt_offer = _accepted_receipt_offer

    def offer_billing_dict(offer):
        """Sum *booked* net new billables, never invoice OCR drafts or cash payments.

        Return per-invoice details for a single accepted order; other offer states
        cannot expose linked booked invoices. Money is rounded only for JSON.
        """
        from decimal import Decimal
        if offer.status not in ('Angenommen', 'Beauftragt'):
            return None
        items = runtime.db.session.scalars(runtime.select(runtime.CostItem).where(runtime.CostItem.offer_id == offer.id)).all()
        ids = [item.id for item in items]
        linked_receipts = runtime.db.session.scalars(runtime.select(runtime.Receipt).where(runtime.Receipt.cost_item_id.in_(ids)).order_by(runtime.Receipt.id)).all() if ids else []
        receipts = [r for r in linked_receipts if r.status == 'Gebucht']
        billed = sum((runtime._receipt_increment(r) for r in receipts), Decimal('0'))
        paid = sum((Decimal(r.paid_amount or 0) for r in receipts), Decimal('0'))
        agreed = Decimal(str(runtime._contract_gross(offer)))
        remaining = agreed - billed
        ratio = float(billed / agreed * 100) if agreed > 0 else 0
        stage = 'overrun' if billed > agreed else 'fully_billed' if billed == agreed else 'warning' if ratio >= 80 else 'normal'
        return {'agreed': float(agreed), 'billed': float(billed), 'paid': float(paid), 'remaining': float(remaining), 'percent': round(ratio, 2), 'stage': stage, 'invoices': [{'id': r.id, 'number': r.invoice_number, 'date': r.document_date, 'supplier': r.supplier, 'billing_type': r.billing_type, 'gross': float(r.gross_amount or 0), 'advance_deduction': float(r.advance_deduction or 0), 'counted': float(runtime._receipt_increment(r)), 'paid': float(r.paid_amount or 0)} for r in receipts], 'linked_invoices': [{'id': r.id, 'number': r.invoice_number, 'date': r.document_date, 'supplier': r.supplier, 'billing_type': r.billing_type, 'kind': r.kind, 'status': r.status, 'filename': r.original_name, 'gross': float(r.gross_amount or 0), 'advance_deduction': float(r.advance_deduction or 0), 'counted': float(runtime._receipt_increment(r)), 'paid': float(r.paid_amount or 0)} for r in linked_receipts]}

    runtime.offer_billing_dict = offer_billing_dict

    def financing_budget_total():
        """Financing capacity, not today's cash balance: loan commitments + own funds.

        Deposits and withdrawals change committed own funds. Drawdowns and invoice
        payments merely move/spend existing funds and never change the budget cap.
        """
        from decimal import Decimal
        amount = sum((Decimal(x.principal or 0) for x in runtime.db.session.scalars(runtime.select(runtime.Loan))), Decimal('0'))
        amount += sum((Decimal(x.opening_balance or 0) for x in runtime.db.session.scalars(runtime.select(runtime.EquityAccount))), Decimal('0'))
        for event in runtime.db.session.scalars(runtime.select(runtime.FinancingEvent)):
            if event.kind == 'equity_deposit':
                amount += Decimal(event.amount or 0)
            elif event.kind == 'equity_withdrawal':
                amount -= Decimal(event.amount or 0)
        return round(float(amount), 2)

    runtime.financing_budget_total = financing_budget_total

    def budget_summary(items):
        lines = runtime.all_budget_lines()
        active = [x for x in lines if x.active and (not x.is_group)]
        valid = [x for x in items if x.state not in ('Alternative', 'Abgelehnt')]
        previews, basis, extras = runtime.forecast_lines(lines, items)
        previews = {key: runtime.dec(value) for key, value in previews.items()}
        booked = runtime.db.session.scalars(runtime.select(runtime.Receipt).where(runtime.Receipt.status == 'Gebucht')).all()
        receipt_by_line = {}
        receipt_line = {}
        unplanned_receipts = []
        for receipt in booked:
            item = runtime.db.session.get(runtime.CostItem, receipt.cost_item_id) if receipt.cost_item_id else None
            line_id = receipt.budget_line_id if receipt.budget_line_id in previews else item.budget_line_id if item and item.budget_line_id in previews else None
            if line_id:
                receipt_by_line.setdefault(line_id, []).append(receipt)
                receipt_line[receipt.id] = line_id
            elif item:
                pass
            else:
                unplanned_receipts.append(receipt)
        for line_id, receipts in receipt_by_line.items():
            actual = sum((runtime.dec(runtime._receipt_increment(x)) for x in receipts))
            if actual > previews[line_id]:
                previews[line_id] = runtime.rounded(actual)
                basis[line_id] = 'Belege über Planansatz'
        linked = {}
        for x in valid:
            if x.budget_line_id:
                linked.setdefault(x.budget_line_id, []).append(x)
        booked_by_item = {}
        for receipt in booked:
            if receipt.cost_item_id is not None:
                booked_by_item[receipt.cost_item_id] = booked_by_item.get(receipt.cost_item_id, 0) + runtime.dec(runtime._receipt_increment(receipt))
        outside = sum((max(runtime.dec(runtime.effective_offer(x)), booked_by_item.get(x.id, 0)) for x in extras))
        extra_receipts = sum((runtime.dec(runtime._receipt_increment(x)) for x in unplanned_receipts))
        forecast = sum(previews.values()) + outside + extra_receipts
        spent = sum((runtime.dec(x.paid) for x in items)) + sum((runtime.dec(x.paid_amount or 0) for x in booked))
        committed = sum((runtime.dec(x.committed) for x in items if x.state in ('Beauftragt', 'Abgeschlossen')))
        funds = runtime.db.session.scalars(runtime.select(runtime.Funding)).all()
        funding_confirmed = sum((runtime.dec(f.confirmed) for f in funds))
        funding_expected = sum((runtime.dec(f.expected) for f in funds))
        budget = runtime.dec(runtime.financing_budget_total())
        grouped = {}
        for line in active:
            group = grouped.setdefault(line.category, {'category': line.category, 'estimate': runtime.dec(0), 'planned': runtime.dec(0), 'paid': runtime.dec(0)})
            group['estimate'] += runtime.dec(line.estimate)
            group['planned'] += previews[line.id]
            group['paid'] += sum((runtime.dec(x.paid) for x in linked.get(line.id, [])))
        for x in extras:
            group = grouped.setdefault(x.category, {'category': x.category, 'estimate': runtime.dec(0), 'planned': runtime.dec(0), 'paid': runtime.dec(0)})
            group['planned'] += max(runtime.dec(runtime.effective_offer(x)), booked_by_item.get(x.id, 0))
            group['paid'] += runtime.dec(x.paid)
        for r in booked:
            category = next((line.category for line in active if line.id == receipt_line.get(r.id)), r.category)
            group = grouped.setdefault(category, {'category': category, 'estimate': runtime.dec(0), 'planned': runtime.dec(0), 'paid': runtime.dec(0)})
            group['paid'] += runtime.dec(r.paid_amount or 0)
        for r in unplanned_receipts:
            group = grouped.setdefault(r.category, {'category': r.category, 'estimate': runtime.dec(0), 'planned': runtime.dec(0), 'paid': runtime.dec(0)})
            group['planned'] += runtime.dec(runtime._receipt_increment(r))
        return runtime.wire({'budget': runtime.rounded(budget), 'planned': runtime.rounded(forecast), 'overrun': runtime.rounded(forecast - budget), 'paid': runtime.rounded(spent), 'remaining': runtime.rounded(forecast - spent), 'committed': runtime.rounded(committed), 'funding_confirmed': runtime.rounded(funding_confirmed), 'funding_expected': runtime.rounded(funding_expected), 'net_after_confirmed': runtime.rounded(forecast - funding_confirmed), 'own_budget': runtime.rounded(sum((previews[x.id] for x in active if x.kind == 'Eigenleistung')) + sum((runtime.dec(runtime.effective_offer(x)) for x in extras if x.kind == 'Eigenleistung'))), 'own_hours': round(sum((runtime.dec(x.own_hours) for x in valid if x.kind == 'Eigenleistung')), 1), 'own_imputed_value': runtime.rounded(sum((runtime.dec(x.own_hours) * runtime.dec(x.own_hourly) for x in valid if x.kind == 'Eigenleistung'))), 'receipt_booked': runtime.rounded(sum((runtime.dec(runtime._receipt_increment(x)) for x in booked))), 'receipt_paid': runtime.rounded(sum((runtime.dec(x.paid_amount or 0) for x in booked))), 'receipt_drafts': runtime.db.session.scalar(runtime.select(runtime.db.func.count(runtime.Receipt.id)).where(runtime.Receipt.status == 'Entwurf')) or 0, 'categories': [{'category': k, 'estimate': runtime.rounded(v['estimate']), 'planned': runtime.rounded(v['planned']), 'paid': runtime.rounded(v['paid'])} for k, v in grouped.items()], 'line_forecasts': previews, 'line_basis': basis, 'additional_items': len(extras)})

    runtime.budget_summary = budget_summary

    def cost_dashboard(items, summary):
        """Build read-only, de-duplicated rows for the cost overview."""
        lines = {x.id: x for x in runtime.all_budget_lines() if x.active and (not x.is_group)}
        tasks = {x.id: x for x in runtime.all_tasks()}
        phases = {x.id: x for x in runtime.db.session.scalars(runtime.select(runtime.BuildPhase)).all()}
        contractors = {x.id: x for x in runtime.db.session.scalars(runtime.select(runtime.Contractor)).all()}
        offers = {x.id: x for x in runtime.db.session.scalars(runtime.select(runtime.Offer)).all()}
        valid = [x for x in items if x.state not in ('Alternative', 'Abgelehnt')]
        rows = {}

        def task_values(item=None):
            task = tasks.get(item.task_id) if item and item.task_id else None
            phase = phases.get(task.phase_id) if task and task.phase_id else None
            contractor = contractors.get(item.contractor_id) if item and item.contractor_id else None
            offer = offers.get(item.offer_id) if item and item.offer_id else None
            return runtime.wire({'trade': task.trade if task else '', 'kind': (item.kind if item else '') or (task.execution_type if task else ''), 'phase': phase.title if phase else task.phase if task else '', 'task': f'{task.code} · {task.name}' if task else '', 'company': contractor.name if contractor else offer.vendor if offer else ''})
        for line in lines.values():
            rows[f'line:{line.id}'] = {'id': f'line:{line.id}', 'title': line.title, 'category': line.category, 'trade': '', 'kind': line.kind, 'phase': '', 'task': '', 'company': line.company_hint or '', 'forecast': runtime.dec(summary['line_forecasts'].get(line.id, 0)), 'committed': runtime.dec(0), 'invoiced': runtime.dec(0), 'paid': runtime.dec(0), 'basis': summary['line_basis'].get(line.id, 'Schätzung'), 'source': 'Kostenplan', 'url': '/angebote'}
        for item in valid:
            target = rows.get(f'line:{item.budget_line_id}') if item.budget_line_id else None
            if target is None and item.budget_line_id is None:
                target = {'id': f'item:{item.id}', 'title': item.title, 'category': item.category, **task_values(item), 'forecast': runtime.dec(runtime.effective_offer(item)), 'committed': runtime.dec(0), 'invoiced': runtime.dec(0), 'paid': runtime.dec(0), 'basis': 'Beauftragt' if item.state in ('Beauftragt', 'Abgeschlossen') else 'Zusätzliche Position', 'source': 'Angebot' if item.offer_id else 'Kostenposition', 'url': '/angebote' if item.offer_id else '/belege'}
                rows[target['id']] = target
            if target is None:
                continue
            values = task_values(item)
            for key in ('trade', 'phase', 'task', 'company'):
                if values[key] and (not target[key]):
                    target[key] = values[key]
            if item.kind:
                target['kind'] = item.kind
            if item.state in ('Beauftragt', 'Abgeschlossen'):
                target['committed'] += runtime.dec(item.committed or 0)
            target['paid'] += runtime.dec(item.paid or 0)
        booked = runtime.db.session.scalars(runtime.select(runtime.Receipt).where(runtime.Receipt.status == 'Gebucht').order_by(runtime.Receipt.id)).all()
        item_by_id = {x.id: x for x in items}
        for receipt in booked:
            item = item_by_id.get(receipt.cost_item_id)
            line_id = receipt.budget_line_id or (item.budget_line_id if item else None)
            target = rows.get(f'line:{line_id}') if line_id else rows.get(f'item:{receipt.cost_item_id}')
            amount = runtime.dec(runtime._receipt_increment(receipt))
            if target is None:
                contractor = contractors.get(receipt.contractor_id)
                kind = 'Eigenleistung' if receipt.assignment_type == 'Eigenleistung' else 'Fremdleistung'
                target = {'id': f'receipt:{receipt.id}', 'title': receipt.invoice_number or receipt.original_name or 'Beleg', 'category': receipt.category or 'Sonstiges', 'trade': receipt.trade or '', 'kind': kind, 'phase': '', 'task': '', 'company': contractor.name if contractor else receipt.supplier or '', 'forecast': amount, 'committed': runtime.dec(0), 'invoiced': runtime.dec(0), 'paid': runtime.dec(0), 'basis': 'Nicht eingeplanter Beleg', 'source': 'Rechnung', 'url': f'/belege?receipt_id={receipt.id}'}
                rows[target['id']] = target
            target['invoiced'] += amount
            target['paid'] += runtime.dec(receipt.paid_amount or 0)
            if target['invoiced'] > target['forecast']:
                target['forecast'] = target['invoiced']
                target['basis'] = 'Belege über Planansatz'
            if not target['company']:
                contractor = contractors.get(receipt.contractor_id)
                target['company'] = contractor.name if contractor else receipt.supplier or ''
        result = []
        for row in rows.values():
            for key in ('forecast', 'committed', 'invoiced', 'paid'):
                row[key] = runtime.rounded(row[key])
            row['open'] = runtime.rounded(max(row['forecast'] - row['paid'], 0))
            result.append(row)
        issues = []
        drafts = int(summary.get('receipt_drafts') or 0)
        if drafts:
            issues.append({'kind': 'drafts', 'count': drafts, 'title': 'Rechnungsentwürfe prüfen', 'text': 'Noch nicht gebuchte Belege wirken sich nicht auf die Auswertung aus.', 'url': '/belege'})
        unassigned = [r for r in booked if not r.budget_line_id and (not r.cost_item_id)]
        if unassigned:
            issues.append({'kind': 'unassigned', 'count': len(unassigned), 'title': 'Rechnungen fachlich zuordnen', 'text': 'Diese gebuchten Belege sind keiner Planposition oder keinem Auftrag zugeordnet.', 'url': '/belege'})
        without_task = [x for x in valid if x.offer_id and x.state in ('Beauftragt', 'Abgeschlossen') and (not x.task_id)]
        if without_task:
            issues.append({'kind': 'schedule', 'count': len(without_task), 'title': 'Aufträge ohne Arbeitspaket', 'text': 'Die Bauphase und das Gewerk können erst nach Zuordnung ausgewertet werden.', 'url': '/angebote'})
        overruns = [x for x in result if x['invoiced'] > x['committed'] > 0]
        if overruns:
            issues.append({'kind': 'overrun', 'count': len(overruns), 'title': 'Rechnungsstand über Auftragssumme', 'text': 'Die gebuchten Rechnungen übersteigen bei diesen Positionen den beauftragten Betrag.', 'url': '/belege'})
        return runtime.wire({'rows': result, 'issues': issues, 'totals': {'forecast': summary['planned'], 'committed': summary['committed'], 'invoiced': summary['receipt_booked'], 'paid': summary['paid']}})

    runtime.cost_dashboard = cost_dashboard

    def _ensure_trade(name):
        value = str(name or '').strip()
        if not value or len(value) > 140:
            return
        if not any((x.name.casefold() == value.casefold() for x in runtime.db.session.scalars(runtime.select(runtime.Trade)))):
            runtime.db.session.add(runtime.Trade(name=value))
            runtime.db.session.flush()

    runtime._ensure_trade = _ensure_trade

    def _get_or_add_contractor(name, family):
        existing = runtime.db.session.scalar(runtime.select(runtime.Contractor).where(runtime.db.func.lower(runtime.Contractor.name) == name.lower()).limit(1))
        if existing:
            return existing
        obj = runtime.Contractor(name=name, trade={'WP': 'Wärmepumpe / Heizung', 'PV': 'Photovoltaik', 'P3': 'Elektro'}.get(family, 'Sonstiges'), notes='Aus PDF-Angebot eingelesen; keine Beauftragung bestätigt.')
        runtime._ensure_trade(obj.trade)
        runtime.db.session.add(obj)
        runtime.db.session.flush()
        return obj

    runtime._get_or_add_contractor = _get_or_add_contractor

    def _find_contractor(name):
        value = str(name or '').strip()
        if not value:
            return None
        return runtime.db.session.scalar(runtime.select(runtime.Contractor).where(runtime.db.func.lower(runtime.Contractor.name) == value.lower()).limit(1))

    runtime._find_contractor = _find_contractor

    @runtime.app.get('/api/categories')
    def categories_list():
        return runtime.jsonify(categories=[{'id': c.id, 'name': c.name} for c in runtime.db.session.scalars(runtime.select(runtime.Category).order_by(runtime.Category.sort_order, runtime.Category.name))])

    runtime.categories_list = categories_list

    def _category_name(value):
        name = str(value or '').strip()
        if not name or len(name) > 120 or any((ord(c) < 32 for c in name)):
            raise ValueError('Kategorie muss zwischen 1 und 120 Zeichen enthalten.')
        return name

    runtime._category_name = _category_name

    @runtime.app.post('/api/categories')
    def categories_add():
        try:
            name = runtime._category_name((runtime.request.get_json(silent=True) or {}).get('name'))
            if name.casefold() in {x.casefold() for x in runtime.category_names()}:
                raise ValueError('Diese Kategorie existiert bereits.')
            record = runtime.Category(name=name, sort_order=(runtime.db.session.scalar(runtime.select(runtime.db.func.max(runtime.Category.sort_order))) or 0) + 1)
            runtime.db.session.add(record)
            runtime.db.session.commit()
            return (runtime.jsonify(id=record.id, name=name), 201)
        except ValueError as exc:
            runtime.db.session.rollback()
            return (runtime.jsonify(error=str(exc)), 400)

    runtime.categories_add = categories_add

    @runtime.app.patch('/api/categories/<int:cid>')
    def categories_rename(cid):
        record = runtime.db.session.get(runtime.Category, cid)
        if not record:
            return (runtime.jsonify(error='Kategorie nicht gefunden.'), 404)
        try:
            name = runtime._category_name((runtime.request.get_json(silent=True) or {}).get('name'))
            if any((x.casefold() == name.casefold() and x != record.name for x in runtime.category_names())):
                raise ValueError('Diese Kategorie existiert bereits.')
            old = record.name
            if old == 'Sonstiges':
                raise ValueError('Die Standardkategorie Sonstiges kann nicht umbenannt werden.')
            if name != old:
                for model in (runtime.Receipt, runtime.CostItem, runtime.BudgetLine, runtime.Offer):
                    for item in runtime.db.session.scalars(runtime.select(model).where(model.category == old)):
                        item.category = name
                record.name = name
            runtime.db.session.commit()
            return runtime.jsonify(id=record.id, name=record.name)
        except ValueError as exc:
            runtime.db.session.rollback()
            return (runtime.jsonify(error=str(exc)), 400)

    runtime.categories_rename = categories_rename

    @runtime.app.delete('/api/categories/<int:cid>')
    def categories_remove(cid):
        record = runtime.db.session.get(runtime.Category, cid)
        if not record:
            return (runtime.jsonify(error='Kategorie nicht gefunden.'), 404)
        if record.name == 'Sonstiges':
            return (runtime.jsonify(error='Die Kategorie Sonstiges kann nicht gelöscht werden.'), 409)
        for model in (runtime.Receipt, runtime.CostItem, runtime.BudgetLine, runtime.Offer):
            if runtime.db.session.scalar(runtime.select(model.id).where(model.category == record.name).limit(1)) is not None:
                return (runtime.jsonify(error='Kategorie wird bereits verwendet. Bitte zuerst umbenennen oder Zuordnungen ändern.'), 409)
        runtime.db.session.delete(record)
        runtime.db.session.commit()
        return runtime.jsonify(ok=True)

    runtime.categories_remove = categories_remove

    @runtime.app.get('/stammdaten')
    def masterdata_page():
        return runtime.render_template('stammdaten.html')

    runtime.masterdata_page = masterdata_page

    @runtime.app.get('/api/trades')
    def trades_list():
        return runtime.jsonify(trades=[{'id': x.id, 'name': x.name} for x in runtime.db.session.scalars(runtime.select(runtime.Trade).order_by(runtime.Trade.name))])

    runtime.trades_list = trades_list

    def _trade_name(value):
        value = str(value or '').strip()
        if not value or len(value) > 140 or any((ord(c) < 32 for c in value)):
            raise ValueError('Gewerk muss zwischen 1 und 140 Zeichen haben.')
        return value

    runtime._trade_name = _trade_name

    @runtime.app.post('/api/trades')
    def trades_add():
        try:
            value = runtime._trade_name((runtime.request.get_json(silent=True) or {}).get('name'))
            if any((x.name.casefold() == value.casefold() for x in runtime.db.session.scalars(runtime.select(runtime.Trade)))):
                raise ValueError('Dieses Gewerk existiert bereits.')
            item = runtime.Trade(name=value)
            runtime.db.session.add(item)
            runtime.db.session.commit()
            return (runtime.jsonify(id=item.id, name=item.name), 201)
        except ValueError as exc:
            runtime.db.session.rollback()
            return (runtime.jsonify(error=str(exc)), 400)

    runtime.trades_add = trades_add

    @runtime.app.patch('/api/trades/<int:tid>')
    def trades_rename(tid):
        item = runtime.db.session.get(runtime.Trade, tid)
        if not item:
            return (runtime.jsonify(error='Gewerk nicht gefunden.'), 404)
        try:
            value = runtime._trade_name((runtime.request.get_json(silent=True) or {}).get('name'))
            if any((x.id != tid and x.name.casefold() == value.casefold() for x in runtime.db.session.scalars(runtime.select(runtime.Trade)))):
                raise ValueError('Dieses Gewerk existiert bereits.')
            old = item.name
            if value != old:
                for contractor in runtime.db.session.scalars(runtime.select(runtime.Contractor).where(runtime.Contractor.trade == old)):
                    contractor.trade = value
                for task in runtime.db.session.scalars(runtime.select(runtime.Task).where(runtime.Task.trade == old)):
                    task.trade = value
                for receipt in runtime.db.session.scalars(runtime.select(runtime.Receipt).where(runtime.Receipt.trade == old)):
                    receipt.trade = value
                item.name = value
            runtime.db.session.commit()
            return runtime.jsonify(id=item.id, name=item.name)
        except ValueError as exc:
            runtime.db.session.rollback()
            return (runtime.jsonify(error=str(exc)), 400)

    runtime.trades_rename = trades_rename

    @runtime.app.delete('/api/trades/<int:tid>')
    def trades_delete(tid):
        item = runtime.db.session.get(runtime.Trade, tid)
        if not item:
            return (runtime.jsonify(error='Gewerk nicht gefunden.'), 404)
        if runtime.db.session.scalar(runtime.select(runtime.Contractor.id).where(runtime.Contractor.trade == item.name).limit(1)) or runtime.db.session.scalar(runtime.select(runtime.Task.id).where(runtime.Task.trade == item.name).limit(1)) or runtime.db.session.scalar(runtime.select(runtime.Receipt.id).where(runtime.Receipt.trade == item.name).limit(1)):
            return (runtime.jsonify(error='Gewerk wird von Firmen oder Arbeitspaketen verwendet; bitte zunächst umbenennen oder neu zuordnen.'), 409)
        runtime.db.session.delete(item)
        runtime.db.session.commit()
        return runtime.jsonify(ok=True)

    runtime.trades_delete = trades_delete

    def _restore_defaults(kind):
        """Restore default names, remove unused extras only, never break references."""
        is_trade = kind == 'trades'
        model = runtime.Trade if is_trade else runtime.Category
        default_names = runtime.DEFAULT_TRADES if is_trade else tuple(runtime.CATEGORIES)
        existing = runtime.db.session.scalars(runtime.select(model)).all()
        original = {row.name.casefold(): row for row in existing}
        created = []
        deleted = []
        protected = []
        for index, name in enumerate(default_names):
            if name.casefold() not in original:
                if is_trade:
                    runtime.db.session.add(runtime.Trade(name=name))
                else:
                    runtime.db.session.add(runtime.Category(name=name, sort_order=index))
                created.append(name)
            elif not is_trade:
                original[name.casefold()].sort_order = index
        for record in existing:
            if record.name.casefold() in {n.casefold() for n in default_names}:
                continue
            if is_trade:
                used = bool(runtime.db.session.scalar(runtime.select(runtime.Contractor.id).where(runtime.Contractor.trade == record.name).limit(1)) or runtime.db.session.scalar(runtime.select(runtime.Task.id).where(runtime.Task.trade == record.name).limit(1)) or runtime.db.session.scalar(runtime.select(runtime.Receipt.id).where(runtime.Receipt.trade == record.name).limit(1)))
            else:
                used = any((runtime.db.session.scalar(runtime.select(m.id).where(m.category == record.name).limit(1)) is not None for m in (runtime.Receipt, runtime.CostItem, runtime.BudgetLine, runtime.Offer)))
            if used:
                protected.append(record.name)
            else:
                runtime.db.session.delete(record)
                deleted.append(record.name)
        runtime.db.session.commit()
        return runtime.jsonify(ok=True, added=created, removed=deleted, preserved=protected, message='Standardliste wiederhergestellt; verwendete eigene Einträge bleiben erhalten.')

    runtime._restore_defaults = _restore_defaults

    @runtime.app.post('/api/trades/restore-defaults')
    def trades_restore_defaults():
        data = runtime.request.get_json(silent=True) or {}
        if data.get('confirm') is not True:
            return (runtime.jsonify(error='Bitte Rücksetzung ausdrücklich bestätigen.'), 400)
        return runtime._restore_defaults('trades')

    runtime.trades_restore_defaults = trades_restore_defaults

    @runtime.app.post('/api/categories/restore-defaults')
    def categories_restore_defaults():
        data = runtime.request.get_json(silent=True) or {}
        if data.get('confirm') is not True:
            return (runtime.jsonify(error='Bitte Rücksetzung ausdrücklich bestätigen.'), 400)
        return runtime._restore_defaults('categories')

    runtime.categories_restore_defaults = categories_restore_defaults

    @runtime.app.get('/kosten')
    def costs_page():
        return runtime.render_template('kosten.html')

    runtime.costs_page = costs_page

    @runtime.app.get('/angebote')
    def offers_page():
        return runtime.render_template('angebote.html')

    runtime.offers_page = offers_page

    @runtime.app.get('/api/cost-dashboard')
    def get_cost_dashboard():
        items = runtime.db.session.scalars(runtime.select(runtime.CostItem).order_by(runtime.CostItem.category, runtime.CostItem.id)).all()
        summary = runtime.budget_summary(items)
        return runtime.jsonify(summary=summary, dashboard=runtime.cost_dashboard(items, summary))

    runtime.get_cost_dashboard = get_cost_dashboard

    @runtime.app.get('/api/costs')
    def get_costs():
        items = runtime.db.session.scalars(runtime.select(runtime.CostItem).order_by(runtime.CostItem.category, runtime.CostItem.id)).all()
        contacts = runtime.db.session.scalars(runtime.select(runtime.Contractor).order_by(runtime.Contractor.name)).all()
        summary = runtime.budget_summary(items)
        return runtime.jsonify({'items': [runtime.as_dict(x, runtime.COST_FIELDS) | {'offer_id': x.offer_id} for x in items], 'contractors': [runtime.as_dict(x, runtime.CONTACT_FIELDS) for x in contacts], 'tasks': [{'id': x.id, 'code': x.code, 'name': x.name} for x in runtime.all_tasks()], 'summary': summary, 'budget_lines': [runtime.budget_dict(x) for x in runtime.all_budget_lines()], 'funding': [runtime.funding_dict(x) for x in runtime.db.session.scalars(runtime.select(runtime.Funding).order_by(runtime.Funding.id))], 'documents': [runtime.document_dict(x) for x in runtime.db.session.scalars(runtime.select(runtime.Document).order_by(runtime.Document.id.desc()))], 'offers': [runtime.offer_dict(x) for x in runtime.db.session.scalars(runtime.select(runtime.Offer).order_by(runtime.Offer.id.desc()))], 'offer_categories': runtime.category_names()})

    runtime.get_costs = get_costs

    @runtime.app.route('/api/costs/<int:item_id>', methods=['PUT', 'DELETE'])
    @runtime.app.post('/api/costs')
    def cost_edit(item_id=None):
        obj = runtime.db.session.get(runtime.CostItem, item_id) if item_id else runtime.CostItem(title='')
        if item_id and (not obj):
            return (runtime.jsonify(error='Position nicht gefunden.'), 404)
        if item_id and obj.offer_id:
            return (runtime.jsonify(error='Diese Position stammt aus dem Angebotsimport. Bitte den Angebotsabschnitt bearbeiten.'), 409)
        try:
            if runtime.request.method == 'DELETE':
                if runtime.db.session.scalar(runtime.select(runtime.Receipt.id).where(runtime.Receipt.cost_item_id == item_id, runtime.Receipt.status == 'Gebucht').limit(1)):
                    return (runtime.jsonify(error='Gebuchte Belege zugeordnet. Bitte die Buchung zuerst zurücknehmen.'), 409)
                if runtime.db.session.scalar(runtime.select(runtime.Document.id).where(runtime.Document.cost_item_id == item_id).limit(1)):
                    return (runtime.jsonify(error='Dokumente zugeordnet. Bitte diese erst löschen oder umhängen.'), 409)
                runtime.db.session.delete(obj)
            else:
                body = runtime.request.get_json(force=True)
                if item_id and 'paid' in body and (float(body['paid'] or 0) > 0) and runtime.db.session.scalar(runtime.select(runtime.Receipt.id).where(runtime.Receipt.cost_item_id == obj.id, runtime.Receipt.status == 'Gebucht').limit(1)):
                    raise ValueError('Zu dieser Kostenposition wurden Belege gebucht. Zahlungen bitte im Belegjournal erfassen.')
                runtime.update_record(obj, body, runtime.COST_FIELDS)
                runtime.db.session.add(obj)
            runtime.db.session.commit()
            return runtime.jsonify(ok=True)
        except (ValueError, TypeError) as exc:
            runtime.db.session.rollback()
            return (runtime.jsonify(error=str(exc)), 400)
        except Exception:
            runtime.db.session.rollback()
            return (runtime.jsonify(error='Ungültige Daten oder Referenzen.'), 400)

    runtime.cost_edit = cost_edit

    @runtime.app.route('/api/contractors/<int:item_id>', methods=['PUT', 'DELETE'])
    @runtime.app.post('/api/contractors')
    def contractor_edit(item_id=None):
        obj = runtime.db.session.get(runtime.Contractor, item_id) if item_id else runtime.Contractor(name='')
        if item_id and (not obj):
            return (runtime.jsonify(error='Firma nicht gefunden.'), 404)
        try:
            if runtime.request.method == 'DELETE':
                if runtime.db.session.scalar(runtime.select(runtime.CostItem.id).where(runtime.CostItem.contractor_id == item_id).limit(1)) or runtime.db.session.scalar(runtime.select(runtime.Document.id).where(runtime.Document.contractor_id == item_id).limit(1)) or runtime.db.session.scalar(runtime.select(runtime.Task.id).where(runtime.Task.contractor_id == item_id).limit(1)) or runtime.db.session.scalar(runtime.select(runtime.Receipt.id).where(runtime.Receipt.contractor_id == item_id).limit(1)):
                    return (runtime.jsonify(error='Firma ist mit Kostenpositionen verknüpft.'), 409)
                runtime.db.session.delete(obj)
                runtime.db.session.commit()
                return runtime.jsonify(ok=True)
            else:
                runtime.update_record(obj, runtime.request.get_json(force=True), runtime.CONTACT_FIELDS)
                runtime._ensure_trade(obj.trade)
                runtime.db.session.add(obj)
            runtime.db.session.commit()
            return runtime.jsonify(ok=True, contractor=runtime.as_dict(obj, runtime.CONTACT_FIELDS) | {'id': obj.id})
        except (ValueError, TypeError) as exc:
            runtime.db.session.rollback()
            return (runtime.jsonify(error=str(exc)), 400)

    runtime.contractor_edit = contractor_edit

    @runtime.app.get('/api/costs.csv')
    def costs_csv():
        buf = runtime.io.StringIO()
        writer = runtime.csv.DictWriter(buf, fieldnames=['category', 'title', 'kind', 'state', 'estimate', 'offer', 'committed', 'paid', 'own_hours', 'own_hourly', 'source_ref', 'notes', 'budget_line_id', 'selected'], delimiter=';')
        writer.writeheader()
        for item in runtime.db.session.scalars(runtime.select(runtime.CostItem).order_by(runtime.CostItem.id)):
            writer.writerow({k: getattr(item, k) for k in writer.fieldnames})
        return runtime.Response('\ufeff' + buf.getvalue(), mimetype='text/csv; charset=utf-8', headers={'Content-Disposition': 'attachment; filename=Sanierung_Kosten.csv'})

    runtime.costs_csv = costs_csv

    @runtime.app.patch('/api/budget/config')
    def budget_config():
        return (runtime.jsonify(error='Das Projektbudget wird automatisch aus Kreditrahmen und Eigenkapital berechnet. Bitte die Quellen unter Finanzierung bearbeiten.'), 409)

    runtime.budget_config = budget_config

    @runtime.app.route('/api/budget/lines/<int:line_id>', methods=['PUT', 'DELETE'])
    @runtime.app.post('/api/budget/lines')
    def budget_line_edit(line_id=None):
        obj = runtime.db.session.get(runtime.BudgetLine, line_id) if line_id else runtime.BudgetLine(code='')
        if line_id and (not obj):
            return (runtime.jsonify(error='Kostenplanposition nicht gefunden.'), 404)
        try:
            if runtime.request.method == 'DELETE':
                if runtime.db.session.scalar(runtime.select(runtime.FundingDetail.funding_id).where(runtime.FundingDetail.budget_line_id == line_id).limit(1)):
                    raise ValueError('Förderung verknüpft. Zuerst die Zuordnung in Energetische Planung entfernen.')
                if runtime.db.session.scalar(runtime.select(runtime.CostItem.id).where(runtime.CostItem.budget_line_id == line_id).limit(1)) or runtime.db.session.scalar(runtime.select(runtime.Document.id).where(runtime.Document.budget_line_id == line_id).limit(1)):
                    raise ValueError('Es sind Angebote/Beauftragungen verknüpft; zuerst diese Zuordnung entfernen.')
                if runtime.db.session.scalar(runtime.select(runtime.Receipt.id).where(runtime.Receipt.budget_line_id == line_id, runtime.Receipt.status == 'Gebucht').limit(1)):
                    raise ValueError('Gebuchte Belege verknüpft. Zuerst deren Buchung zurücknehmen.')
                if runtime.db.session.scalar(runtime.select(runtime.BudgetLine.id).where(runtime.BudgetLine.parent_code == obj.code).limit(1)):
                    raise ValueError('Gruppenposition kann erst gelöscht werden, wenn die Unterpositionen entfernt wurden.')
                runtime.db.session.delete(obj)
            else:
                b = runtime.request.get_json(force=True)
                for key in ('title', 'category', 'parent_code', 'company_hint', 'kind', 'notes'):
                    if key in b:
                        setattr(obj, key, str(b[key] or '').strip())
                if 'estimate' in b:
                    obj.estimate = float(b['estimate'] or 0)
                if 'active' in b:
                    obj.active = b['active'] is True or str(b['active']).lower() in ('1', 'true', 'on')
                if 'is_group' in b:
                    obj.is_group = b['is_group'] is True
                if 'sort_order' in b:
                    obj.sort_order = int(b['sort_order'])
                if not line_id:
                    obj.code = 'KNEW' + str((runtime.db.session.scalar(runtime.select(runtime.db.func.max(runtime.BudgetLine.id))) or 0) + 1)
                    obj.sort_order = 1000 + int(obj.code[4:])
                if not obj.title or not obj.category:
                    raise ValueError('Titel und Kategorie fehlen.')
                if not runtime.math.isfinite(obj.estimate) or obj.estimate < 0:
                    raise ValueError('Kosten dürfen nicht negativ sein.')
                if obj.kind not in ('Eigenleistung', 'Fremdleistung'):
                    raise ValueError('Ungültige Leistungsart.')
                if obj.parent_code and obj.parent_code == obj.code:
                    raise ValueError('Eigenverknüpfung nicht erlaubt.')
                runtime.db.session.add(obj)
            runtime.db.session.commit()
            return runtime.jsonify(ok=True)
        except (ValueError, TypeError) as e:
            runtime.db.session.rollback()
            return (runtime.jsonify(error=str(e)), 400)

    runtime.budget_line_edit = budget_line_edit

    @runtime.app.get('/api/budget.csv')
    def budget_csv():
        data = runtime.budget_summary(runtime.db.session.scalars(runtime.select(runtime.CostItem)).all())
        buf = runtime.io.StringIO()
        w = runtime.csv.writer(buf, delimiter=';')
        w.writerow(['Gewerk', 'Bezeichnung', 'Schätzung (€)', 'Aktuelle Prognose (€)', 'Prognosebasis', 'Eigenleistung', 'Firmenhinweis', 'Notiz'])
        for row in runtime.all_budget_lines():
            w.writerow([row.category, row.title, row.estimate, data['line_forecasts'].get(row.id, 0), data['line_basis'].get(row.id, 'Gruppenzeile'), row.kind == 'Eigenleistung', row.company_hint, row.notes])
        return runtime.Response('\ufeff' + buf.getvalue(), mimetype='text/csv; charset=utf-8', headers={'Content-Disposition': 'attachment; filename=Sanierungsprojekt_Budget.csv'})

    runtime.budget_csv = budget_csv
