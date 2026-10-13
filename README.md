# assist

Hours, miles, expenses, and the day ahead. A small app for logging work, drives, expenses, and tasks, then seeing what a pay period is worth.

It is built for one person on their own server. There are no accounts.

## What it does

- **Hours.** Clock in and out, or type the time in. If you clocked in late, roll the start time back.
- **Miles.** Log a drive and see the reimbursement.
- **To Do.** A week of tasks, with a calendar to jump around.
- **Reports.** Pay for the current period, a week, a month, or a custom range. Export CSV or PDF.
- **Settings.** Your name, hourly rate, per-mile rate, and whether pay is weekly, every two weeks, or monthly.

On a phone, install it from the browser once it is served over HTTPS. It runs as its own app.

## Run it

You need Node.js, [uv](https://docs.astral.sh/uv/), and Python 3.12 or newer.

```bash
npm install
npm run dev
```

Open http://127.0.0.1:5173. The API listens on port 8000.

The database is a SQLite file at `backend/data/assist.db`. It is created the first time the API starts.

## Docker

```bash
docker compose up -d
```

That serves the app on port 8080. The database lives in `./data` on the host. To put it somewhere else:

```bash
ASSIST_DATA=/srv/assist docker compose up -d
```

Chrome can install it on a phone once this is reached over HTTPS.

## Backups

assist snapshots its database on startup and hourly, into `./backups` on the
host (override with `ASSIST_BACKUPS`). It keeps the newest snapshot for each of
the last 24 hours, then one per day for the last 7 days.

The snapshot is a complete, consistent copy of the SQLite database, so restoring
is just dropping it back in as `data/assist.db`. There is also a JSON dump and
restore:

- `GET /api/backup.json` — every record as JSON.
- `POST /api/restore` — replace everything from a dump produced above.

If the database file goes missing or comes up empty while a data directory has
been used before, the app refuses to start rather than silently creating a blank
database.

### Off-host copies to Seafile

Set these to also push each snapshot to a Seafile library (via the Web API, no
sync client needed). Leave them unset to keep backups local only.

```bash
SEAFILE_URL=https://seafile.example.com \
SEAFILE_TOKEN=your-api-token \
SEAFILE_REPO_ID=the-library-id \
SEAFILE_DIR=/assist-backups \
docker compose up -d
```

Snapshots are uploaded under timestamped names and the remote keeps the newest
30, so a bad snapshot can never overwrite a good one. If Seafile is unreachable,
the upload is logged and retried on the next cycle; the app is unaffected.

## Surviving network hiccups

Every record has a stable `uid`. When the app creates something it sends that
`uid`, and the server treats the same `uid` as the same record, so a request that
is retried after a dropped connection can never create a duplicate. Edits and
deletes are idempotent too — deleting something that is already gone is not an
error. The web client retries failed requests a couple of times with backoff, so
a brief blip is usually invisible.

`GET /api/sync` returns the full state (settings, entries, tasks, payouts, and
any running timer) with each record's `uid` and `updated_at`, which is what the
client uses to reconcile.

## Tests

```bash
uv run --directory backend pytest
```

## License

[MIT](LICENSE)
