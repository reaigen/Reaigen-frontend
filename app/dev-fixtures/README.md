# Dev QA fixtures

Development-only pages that mount real components with known data so the
UI smoke suite (`npm run smoke-ui`) can drive them in a browser. Each page
calls `notFound()` outside development — they never ship.

Add a fixture here whenever a surface regresses twice: the smoke suite is
the contract that a fix for one surface may not break another.
