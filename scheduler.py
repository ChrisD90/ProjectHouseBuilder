"""Terminberechnung ohne Datenbankabhängigkeit (Kalendertage)."""
from datetime import timedelta


def schedule(tasks, start):
    """Ende-Anfang-Verknüpfung, inkl. Anfangs- und Enddatum.

    Die Berechnung ist bewusst unabhängig von Ist-Terminen. Ist-Termine sind
    für die Baufortschrittsdokumentation; der Plan bleibt editierbar.
    """
    if start is None:
        raise ValueError('Projektstart fehlt.')
    by_id = {task.id: task for task in tasks}
    deps = {task.id: [dependency.predecessor_id for dependency in task.dependencies] for task in tasks}
    computed, visiting = {}, set()

    def calc(task_id):
        if task_id in computed:
            return computed[task_id]
        if task_id in visiting:
            raise ValueError('Zirkuläre Abhängigkeit erkannt.')
        if task_id not in by_id:
            raise ValueError('Vorgänger existiert nicht.')
        visiting.add(task_id)
        task = by_id[task_id]
        if task.duration < 1 or task.lag_days < 0:
            raise ValueError('Dauer muss mindestens ein Tag sein und der Abstand nicht negativ.')
        phase=getattr(task,'phase_record',None)
        phase_start=getattr(phase,'start_date',None)
        candidates=[start]
        if task.earliest_start:candidates.append(task.earliest_start)
        if phase_start:candidates.append(phase_start)
        beginning=max(candidates)
        for dependency_id in deps[task_id]:
            _, end = calc(dependency_id)
            beginning = max(beginning, end + timedelta(days=1 + task.lag_days))
        result = (beginning, beginning + timedelta(days=task.duration - 1))
        visiting.remove(task_id)
        computed[task_id] = result
        return result

    for task in tasks:
        calc(task.id)
    return computed
