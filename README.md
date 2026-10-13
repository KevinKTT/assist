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

## Tests

```bash
uv run --directory backend pytest
```

## License

[MIT](LICENSE)
