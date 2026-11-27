"""Blocking matching/password work must leave the ASGI event loop available."""
import asyncio
from datetime import date
from threading import Event
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, patch
from uuid import uuid4

from app.backend.api.moderation.router import accept_invitation, sign_in
from app.backend.api.preparations.catalog import suggest


class EventLoopTests(unittest.IsolatedAsyncioTestCase):
    """Gate real route work and verify the coroutine can progress before release."""

    async def assert_offloaded(self, operation, target, value):
        """Keep one synchronous call waiting while the event loop observes it."""
        entered, release = Event(), Event()

        def blocked(*args, **kwargs):
            """Wait in the selected synchronous seam until the loop releases it."""
            entered.set()
            release.wait(3)
            return value(*args, **kwargs) if callable(value) else value
        with (patch.object(target[0],target[1],blocked) if isinstance(target,tuple) else patch(target,blocked)):
            task = asyncio.create_task(operation())
            try:
                self.assertTrue(await asyncio.to_thread(entered.wait, 2))
                await asyncio.sleep(0)
                self.assertFalse(task.done(), 'blocking work ran on the event loop before the release marker')
            finally:
                release.set()
                await task

    async def test_password_verification_runs_away_from_the_loop(self):
        """Sign-in can wait for Argon2 while other coroutines continue."""
        module = SimpleNamespace(form=AsyncMock(return_value={'login':'fixture','password':'fixture-only'}),check_post=Mock(),
            desk=SimpleNamespace(one=Mock(return_value={'password_hash':'fixture-hash','totp_secret':None,'account_id':str(uuid4())})),
            start_session=Mock(),render=Mock())
        await self.assert_offloaded(lambda:sign_in(SimpleNamespace(),module), 'app.backend.api.moderation.auth.password_matches', True)
        module.start_session.assert_called_once()

    async def test_invitation_hashing_runs_away_from_the_loop(self):
        """Password enrolment keeps its existing DB sequence but does not block ASGI."""
        def lookup(sql, args):
            """Return only synthetic invitation/session data for this route boundary."""
            return {'role':'moderator','login_name':'fixture','account':str(uuid4())}
        module = SimpleNamespace(form=AsyncMock(return_value={'password':'Fixture-password-123','password_again':'Fixture-password-123'}),
            check_post=Mock(),desk=SimpleNamespace(one=lookup),start_session=Mock(),render=Mock())
        await self.assert_offloaded(lambda:accept_invitation(SimpleNamespace(),'fixture-token',module),
                                   'app.backend.api.moderation.auth.hash_password', 'fixture-hash')
        module.start_session.assert_called_once()

    async def test_local_matching_runs_away_from_the_loop(self):
        """Catalog CPU work cannot monopolize the loop serving private/read requests."""
        from review.matching import propose
        axis = str(uuid4())
        page = {'context':{'kind':'classification','territory_id':str(uuid4()),'axis_id':axis},'complete':True,'next_offset':None,
                'as_of':date(2026,11,27).isoformat(), 'entries':[{'label':'Mensa','published':True,'effective_from':'2026-01-01','effective_until':None,
                'target':{'kind':'classification','axis_id':axis,'term_id':str(uuid4()),'adoption_id':str(uuid4()),'release_id':str(uuid4())}}]}
        fact = {'fact_id':str(uuid4()),'kind':'category_label','subject':'service','source_value':'Mensa','value':'Mensa'}
        with patch('app.backend.api.preparations.catalog.read_catalog', AsyncMock(return_value=page)):
            await self.assert_offloaded(lambda:suggest(SimpleNamespace(),uuid4(),{'source_facts':[fact]},fact['fact_id'],{'kind':'classification'}),
                                       'review.matching.propose',propose)

    async def test_queue_write_runs_away_from_the_loop(self):
        """A waiting claim transaction cannot stall other requests."""
        from app.backend.api.moderation.queue import claim
        module = SimpleNamespace(form=AsyncMock(return_value={}), check_post=Mock(),session_hash=Mock(return_value='fixture'),
                                 desk=SimpleNamespace(as_person=Mock()))
        await self.assert_offloaded(lambda:claim(SimpleNamespace(),'fixture-contribution',module),
                                   (module.desk,'as_person'), None)

    async def test_workspace_transaction_runs_away_from_the_loop(self):
        """Draft editing keeps synchronous transaction acquisition off ASGI."""
        from contextlib import nullcontext
        from app.backend.api.moderation.workspace import save_draft
        from app.backend.api.moderation.desk import Refused
        module = SimpleNamespace(form=AsyncMock(return_value={}),check_post=Mock(),session_hash=Mock(return_value='fixture'),
                                 desk=SimpleNamespace(acting=Mock()))
        with patch('app.backend.api.moderation.workspace.Workspace',side_effect=Refused('stale_base')), \
             patch('app.backend.api.moderation.workspace.page',return_value=SimpleNamespace()):
            await self.assert_offloaded(lambda:save_draft(SimpleNamespace(),uuid4(),module),
                                       (module.desk,'acting'),lambda *args:nullcontext((SimpleNamespace(),{})))

    async def test_editorial_decision_runs_away_from_the_loop(self):
        """Contribution closure waits in a worker through its DB transaction."""
        from contextlib import nullcontext
        from app.backend.api.moderation.decisions import close
        connection=SimpleNamespace(execute=Mock())
        module=SimpleNamespace(form=AsyncMock(return_value={'outcome':'rejected','reason':'Fixture decision'}),check_post=Mock(),
            session_hash=Mock(return_value='fixture'),desk=SimpleNamespace(acting=Mock(return_value=nullcontext((connection,{})))))
        await self.assert_offloaded(lambda:close(SimpleNamespace(),uuid4(),module),
                                   'app.backend.api.moderation.decisions.read_open',{'proposals':[]})
        connection.execute.assert_called_once()

    async def test_public_intake_runs_away_from_the_loop(self):
        """The retained public contribution writer cannot block unrelated reads."""
        from app.backend.api.contribute.router import submit
        intake=SimpleNamespace(submit=Mock())
        request=SimpleNamespace(headers={'origin':'http://fixture.local'},url=SimpleNamespace(scheme='http',netloc='fixture.local'),
            body=AsyncMock(return_value=b'name=Fixture&offer=Fixture'),
            app=SimpleNamespace(state=SimpleNamespace(resources=SimpleNamespace(configuration=SimpleNamespace(canonical=True),intake=intake))))
        with patch('app.backend.api.contribute.router.page',return_value=SimpleNamespace()):
            await self.assert_offloaded(lambda:submit(request), (intake,'submit'),'stored')

    async def test_workbench_preview_transaction_runs_away_from_the_loop(self):
        """Freezing a plan can wait for PostgreSQL without blocking the ASGI loop."""
        from contextlib import nullcontext
        from app.backend.api.preparations import http, workbench

        connection = SimpleNamespace(execute=Mock(return_value=SimpleNamespace(
            fetchone=Mock(return_value={'result': {'plan_id': str(uuid4())}}))))
        desk = SimpleNamespace(acting=Mock())
        module = SimpleNamespace(desk=desk)
        body = {'item_ids': [str(uuid4())], 'configuration_version': None,
            'limits': {'max_total_packets': 2}, 'request_key': str(uuid4())}
        with patch.object(workbench, 'read_json', AsyncMock(return_value=body)), \
             patch.object(http, 'session', return_value='synthetic-session'), \
             patch.object(http, 'moderation', return_value=module):
            await self.assert_offloaded(lambda: workbench.preview(SimpleNamespace(), uuid4()),
                (desk, 'acting'), lambda *args: nullcontext((connection, {})))
        connection.execute.assert_called_once()
