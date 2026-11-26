"""Moderation Module: protected editorial routes under `/moderazione` (ADR 0009, 0011).

`desk` talks to the database as the single editorial login and lets every request act
as the person of a session the database verifies; `auth` owns tokens, passwords, codes
and signed values; `oidc` signs people in with an OpenID Connect provider; `router`
serves the pages; `decisions` applies individually verified proposals and records
closure through existing canonical operations. Nothing here is mounted unless the editorial database is configured.
"""
