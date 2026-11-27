"""Weekly hours in the workspace: the form a moderator fills, and the schedules it gives (EGI-84).

A schedule says when one audience is served: the service itself, its intake desk,
or one of its contact lines. "Aperto ora" reads exactly one schedule per audience at
an instant, so two schedules of the same audience may not be valid on the same day.
Each weekday is open in time ranges, closed, or not known. A range that ends at or
before it starts ends the next day. Values the person left as they were keep their
components and sources; anything else is the moderator's and cites none. Shared
calendar exceptions stay as the schedules carried them.
"""
import copy

from .desk import Refused

SCOPES = ('service', 'intake', 'contact')
DAY_STATES = ('intervals', 'closed', 'unknown')
COMPLETENESS = ('complete', 'partial', 'unknown')
WEEKDAYS = range(1, 8)
TIMEZONE = 'Europe/Rome'
MAX_SCHEDULES, MAX_RANGES = 10, 6
FREE_RANGES = 1  # empty range slots offered after the ones a day already has, at least two in all


def clock(value: str) -> str | None:
    """Return a form time as the body writes it: HH:MM, or HH:MM:SS when seconds are stated."""
    parts = value.strip().split(':')
    if len(parts) not in (2, 3) or not all(p.isdigit() and len(p) == 2 for p in parts):
        return None
    hours, minutes, seconds = int(parts[0]), int(parts[1]), int(parts[2]) if len(parts) == 3 else 0
    if hours > 23 or minutes > 59 or seconds > 59:
        return None
    return f'{hours:02d}:{minutes:02d}' + (f':{seconds:02d}' if seconds else '')


def seconds(value: str) -> int:
    """Return a body time as seconds since midnight."""
    parts = [int(p) for p in value.split(':')] + [0]
    return parts[0] * 3600 + parts[1] * 60 + parts[2]


def slots(schedule: dict) -> int:
    """Return how many range slots each day of a schedule's form offers."""
    most = max((len(day.get('intervals') or []) for day in schedule.get('days') or []), default=0)
    return max(most + FREE_RANGES, 2)


def form_rows(schedules: list[dict]) -> list[dict]:
    """Return the schedules as the form shows them, with an empty one to add."""
    shown = []
    for schedule in schedules + [{}]:
        days = {day['weekday']: day for day in schedule.get('days') or []}
        shown.append({'schedule': schedule, 'slots': slots(schedule),
                      'days': [days.get(weekday, {'weekday': weekday, 'state': 'unknown', 'intervals': []}) for weekday in WEEKDAYS]})
    return shown


def posted_rows(schedules: list[dict], form: dict) -> list[dict]:
    """Render submitted schedule controls after refusal, independently of their validity."""
    if 'schedules' not in form:
        return form_rows(schedules)
    try:
        count = int(form.get('schedules') or 0)
    except ValueError:
        return form_rows(schedules)
    if not 0 <= count <= max(MAX_SCHEDULES, len(schedules)) + 1:
        return form_rows(schedules)
    known = {s.get('component_id'): s for s in schedules}
    shown = []
    for index in range(count):
        key = f'schedule_{index}_'
        before = known.get(form.get(key + 'component')) or {}
        try:
            size = int(form.get(key + 'slots') or 0)
        except ValueError:
            size = slots(before)
        size = min(max(size, 0), max(MAX_RANGES, slots(before)))
        schedule = copy.deepcopy(before)
        mapping = {'scope': 'scope', 'contact': 'contact_component_id', 'from': 'valid_from',
                   'until': 'valid_until', 'completeness': 'completeness'}
        if before or form.get(key + 'scope'):
            schedule.update({field: form.get(key + name, '') for name, field in mapping.items()})
        days = [{'weekday': day, 'state': form.get(f'{key}day_{day}_state', 'unknown'),
                 'intervals': [{'opens': form.get(f'{key}day_{day}_{n}_opens', ''),
                                'closes': form.get(f'{key}day_{day}_{n}_closes', '')} for n in range(size)]}
                for day in WEEKDAYS]
        shown.append({'schedule': schedule, 'slots': size, 'days': days, 'removed': bool(form.get(key + 'remove'))})
    return shown or form_rows([])


def _ranges(form: dict, key: str, count: int, limit: int = MAX_RANGES) -> list[dict]:
    """Read one day's ranges; a half-filled or unreadable range is refused."""
    if count < 0 or count > limit:
        raise Refused('invalid_hours')
    found = []
    for index in range(count):
        opens, closes = form.get(f'{key}{index}_opens', '').strip(), form.get(f'{key}{index}_closes', '').strip()
        if not opens and not closes:
            continue
        opens, closes = clock(opens), clock(closes)
        if opens is None or closes is None:
            raise Refused('invalid_hours')
        found.append({'opens': opens, 'closes': closes, 'end_day_offset': 1 if seconds(closes) <= seconds(opens) else 0})
    return sorted(found, key=lambda item: (seconds(item['opens']), seconds(item['closes'])))


def _same_range(item: dict, wanted: dict) -> bool:
    """Say whether a stated interval is the range the form gives."""
    return (item.get('opens'), item.get('closes'), item.get('end_day_offset') or 0) == \
        (wanted['opens'], wanted['closes'], wanted['end_day_offset'])


def _day(before: dict | None, weekday: int, state: str, ranges: list[dict]) -> dict:
    """Build one weekday, keeping the intervals and completeness that did not change."""
    old = list((before or {}).get('intervals') or [])
    intervals = []
    for wanted in ranges if state == 'intervals' else []:
        kept = next((item for item in old if _same_range(item, wanted)), None)
        if kept is not None:
            old.remove(kept)
            intervals.append(kept)
        else:
            item = {'opens': wanted['opens'], 'closes': wanted['closes'], 'evidence': []}
            if wanted['end_day_offset']:
                item['end_day_offset'] = 1
            intervals.append(item)
    if state == 'intervals' and not intervals:
        raise Refused('invalid_hours')
    same = before is not None and before.get('state') == state and before.get('intervals', []) == intervals
    completeness = before.get('completeness', 'complete') if same else ('unknown' if state == 'unknown' else 'complete')
    return {'weekday': weekday, 'state': state, 'completeness': completeness, 'intervals': intervals}


def _overlap(first: dict, second: dict) -> bool:
    """Say whether two schedules of the same audience are valid on a common day."""
    if (first.get('scope'), first.get('contact_component_id')) != (second.get('scope'), second.get('contact_component_id')):
        return False
    starts = max(first.get('valid_from') or '0000-01-01', second.get('valid_from') or '0000-01-01')
    ends = min(first.get('valid_until') or '9999-12-31', second.get('valid_until') or '9999-12-31')
    return starts <= ends


def correct_day(body: dict, form: dict) -> dict:
    """Apply one moderator-entered weekday correction, preserving all other schedules/days."""
    try:
        weekday = int(form.get('weekday', ''))
    except ValueError:
        raise Refused('invalid_hours') from None
    state = form.get('day_state')
    if weekday not in WEEKDAYS or state not in DAY_STATES:
        raise Refused('invalid_hours')
    schedules = body.setdefault('schedules', [])
    wanted = form.get('schedule')
    schedule = next((s for s in schedules if s.get('component_id') == wanted), None) if wanted else None
    if wanted and schedule is None:
        raise Refused('invalid_hours')
    if schedule is None:
        if len(schedules) >= MAX_SCHEDULES or form.get('scope') not in ('service', 'intake'):
            raise Refused('invalid_hours')
        schedule = {'scope': form['scope'], 'timezone': TIMEZONE, 'completeness': 'partial', 'days': []}
        if any(_overlap(schedule, other) for other in schedules):
            raise Refused('schedule_overlap')
        schedules.append(schedule)
    before = next((d for d in schedule.get('days', []) if d['weekday'] == weekday), None)
    ranges = _ranges(form, 'range_', MAX_RANGES) if state == 'intervals' else []
    corrected = _day(before, weekday, state, ranges)
    schedule['days'] = sorted([d for d in schedule.get('days', []) if d['weekday'] != weekday] + [corrected],
                              key=lambda d: d['weekday'])
    return {'index': schedules.index(schedule), 'weekday': weekday, 'scope': schedule['scope'],
            'state': state, 'intervals': ranges}


def edited_schedules(base: dict, form: dict, contacts: list[dict]) -> tuple[list[dict], list[dict]]:
    """Apply the hours form to a body's schedules; return the schedules and the calendar links kept.

    `contacts` are the contacts the saved body will have: a contact's hours need one of
    them, already saved. A form without hours leaves them as they were.
    """
    schedules, links = base.get('schedules') or [], base.get('calendar_links') or []
    if 'schedules' not in form:
        return schedules, links
    try:
        count = int(form.get('schedules') or 0)
    except ValueError:
        raise Refused('invalid_hours') from None
    if count < 0 or count > max(MAX_SCHEDULES, len(schedules)) + 1:
        raise Refused('invalid_hours')
    known = {item.get('component_id'): item for item in schedules}
    saved_contacts = {item['component_id'] for item in contacts if item.get('component_id')}
    result = []
    for index in range(count):
        key = f'schedule_{index}_'
        before = known.pop(form.get(key + 'component') or None, None)
        scope = form.get(key + 'scope', '')
        if form.get(key + 'remove') or scope not in SCOPES:
            continue
        try:
            slots_count = int(form.get(key + 'slots') or 0)
        except ValueError:
            raise Refused('invalid_hours') from None
        schedule = copy.deepcopy(before) if before else {'timezone': TIMEZONE}
        old_days = {day['weekday']: day for day in (before or {}).get('days') or []}
        days = []
        for weekday in WEEKDAYS:
            state = form.get(f'{key}day_{weekday}_state', 'unknown')
            if state not in DAY_STATES:
                raise Refused('invalid_hours')
            days.append(_day(old_days.get(weekday), weekday, state,
                             _ranges(form, f'{key}day_{weekday}_', slots_count, max(MAX_RANGES, slots(before or {})))))
        contact = form.get(key + 'contact') or None if scope == 'contact' else None
        if scope == 'contact' and contact not in saved_contacts:
            raise Refused('schedule_contact')
        changed = {'scope': scope, 'contact_component_id': contact, 'valid_from': form.get(key + 'from') or None,
                   'valid_until': form.get(key + 'until') or None,
                   'completeness': form.get(key + 'completeness') if form.get(key + 'completeness') in COMPLETENESS else 'unknown'}
        if changed['valid_from'] and changed['valid_until'] and changed['valid_until'] < changed['valid_from']:
            raise Refused('invalid_hours')
        for name, value in changed.items():
            if value is None:
                schedule.pop(name, None)
            else:
                schedule[name] = value
        schedule['days'] = days
        if before is None or schedule != before:
            schedule['evidence'] = []
        result.append(schedule)
    if len(result) > max(MAX_SCHEDULES, len(schedules)):
        raise Refused('invalid_hours')
    for position, first in enumerate(result):
        if any(_overlap(first, second) for second in result[position + 1:]):
            raise Refused('schedule_overlap')
    kept = {item.get('component_id') for item in result if item.get('component_id')}
    return result, [link for link in links if link.get('schedule_id') in kept]


def summary(schedules: list[dict], text, contacts: dict) -> str:
    """Write a body's hours in one line for the comparison."""
    parts = []
    for schedule in schedules or []:
        days = []
        for day in schedule.get('days') or []:
            name = text(f"moderation.workspace.weekdays_short.{day['weekday']}")
            if day['state'] == 'intervals':
                days.append(name + ' ' + ', '.join(f"{i['opens']}–{i['closes']}" for i in day.get('intervals') or []))
            else:
                days.append(f"{name} {text('moderation.workspace.day_states.' + day['state'])}")
        audience = text('moderation.workspace.scopes.' + schedule.get('scope', 'service'))
        if schedule.get('contact_component_id'):
            audience += ' ' + contacts.get(schedule['contact_component_id'], '')
        if schedule.get('valid_from') or schedule.get('valid_until'):
            audience += f" ({schedule.get('valid_from') or '…'} → {schedule.get('valid_until') or '…'})"
        parts.append(f"{audience}: {'; '.join(days)}")
    return ' | '.join(parts) or '—'
