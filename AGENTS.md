# Working on this repo

Atelier ("Room-designer") is a single-file back end plus three static front-end
files:

- `room-back-endhandler.py` — Python standard-library HTTP server (no pip
  dependencies, no build step). Serves the static files from this directory and
  exposes the `/api/*` JSON endpoints (session, register/login/logout, projects
  list/read/create/delete).
- `index.html`, `app.js`, `styles.css` — the studio UI (canvas room designer,
  furniture/finish/details controls, sign-in dialog, saved-projects drawer).
- `atelier.db` — SQLite database, created automatically on boot
  (`CREATE TABLE IF NOT EXISTS`), holding `users`, `sessions` and `projects`.
  It is a runtime file and is git-ignored; the schema is created from the code.

## Run it

```sh
docker compose -f docker-compose.base44.yml up -d --build
```

The server listens on port 5173 inside the container, mapped to host port 3000
(the preview entry point). `PORT` overrides the port; it defaults to 5173.

## Verify it works

```sh
curl -s http://localhost:3000/ | head            # serves index.html
curl -s http://localhost:3000/api/session        # {"user": null} when signed out
```

The sign-in flow is end to end checkable by hand: register in the dialog, then
save a design and reload — projects are stored per user id in `atelier.db`, and
only for the signed-in user (`401` when signed out).

## Non-obvious notes

- Served files are read from disk on every request, so front-end edits
  (html/css/js) appear on a browser reload with no restart.
- The Python process itself has no reloader: after editing
  `room-back-endhandler.py`, restart the service
  (`docker compose -f docker-compose.base44.yml restart atelier`) before
  checking the API. There is no live-reload dev server in this project, so
  `reload_preview` is the way to show a change in the preview iframe.
- The server binds `0.0.0.0` and does no `Host`/`Origin` validation, so the
  sandbox proxy host needs no allowlist entry. Session auth uses a same-origin
  cookie (`atelier_session`), so no CORS configuration is involved.
- `/atelier.db` is deliberately not downloadable: the server returns 404 for it.
- No secrets are required — everything runs locally in the compose service.
