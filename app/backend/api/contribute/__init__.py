"""Public contributions (EGI-22): reports, still-valid signals and new-service proposals.

The public app's only write. `intake` hands a contribution to the database through
the intake login, which may only call `editorial.submit_contribution`; `router`
serves the forms at `/contribuisci`. Nothing a visitor sends changes public data.
"""
