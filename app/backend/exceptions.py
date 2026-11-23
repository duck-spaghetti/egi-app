"""Translate application failures centrally without retaining sensitive details."""

class ApplicationError(Exception):
    """A safe failure category with an HTTP status owned by the application."""
    def __init__(self, status: int, detail: str = '', code: str = 'directory_unavailable'):
        """Keep only a trusted status/code; discard source or request-bearing detail."""
        self.status = status
        self.code = code
        super().__init__(code)

class DirectoryUnavailable(ApplicationError):
    """The selected canonical reader could not complete a coherent read."""
    def __init__(self, detail: str = ''):
        """Expose a store failure without its private connection configuration."""
        super().__init__(503)
