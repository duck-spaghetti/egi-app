"""Own bounded cycleway reads and their configured availability."""
from .network import cycleways_view
from .exceptions import CyclewaysError

class Cycleways:
    """Read existing cycle infrastructure for the selected territory."""
    def __init__(self, policy, root):
        """Accept validated application geography."""
        self.policy = policy
        self.root = root

    def view(self, body):
        """Validate the geographic policy before reading local infrastructure."""
        w, s, e, n = self.policy.search_extent
        if not (w <= body.west < body.east <= e and s <= body.south < body.north <= n):
            raise CyclewaysError(422, code='invalid_request')
        return cycleways_view([body.west, body.south, body.east, body.north], body.zoom, self.root)
