"""Resolve the retained private preview reader without consulting it in canonical mode."""
from typing import Any
from fastapi import Depends, HTTPException
from .subjects import SubjectSource, SubjectSourceUnavailable
from .runtime import SUBJECT_SOURCE, CANONICAL

def subject_source() -> SubjectSource:
    """Return the process-wide subject source; tests override this dependency."""
    return SUBJECT_SOURCE


def subjects(source: SubjectSource = Depends(subject_source)) -> list[dict[str, Any]]:
    """Translate unavailable DB state into an explicit service error instead of an empty map."""
    if CANONICAL:
        return []  # retained transit handlers use canonical place_points; never the preview store
    try:
        return source.latest()
    except SubjectSourceUnavailable as exc:
        raise HTTPException(503, "Database preview non disponibile") from exc


