"""Resolve the preview Module owned by the requesting application."""
from fastapi import Request

def owner(request: Request):
    """Inject this app's preview behavior, never a module-global instance."""
    return request.app.state.resources.preview

from fastapi import Depends
from .subjects import SubjectSource, SubjectSourceUnavailable
from .exceptions import PreviewError

def subject_source(request: Request) -> SubjectSource:
    """Provide the actual selected source reader; tests override this same Seam."""
    return request.app.state.resources.source

def subjects(source: SubjectSource = Depends(subject_source)):
    """Read retained evidence only for routes mounted in preview mode."""
    try:
        return source.latest()
    except SubjectSourceUnavailable:
        raise PreviewError(503) from None
