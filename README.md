# Light Card Auth

A lightweight Node.js and SQLite service for card-based authentication, device binding,
session heartbeats, client-version policies, and announcements. It includes a browser-based
admin panel and a client API.

## Local setup

Use a Node.js version supported by the locked `better-sqlite3@12.4.1` dependency:
`20.x || 22.x || 23.x || 24.x`.
From this directory, run these commands in Bash (Git Bash also works on Windows):

```bash
npm ci
read -rs -p 'Choose an admin password: ' ADMIN_PASSWORD
printf '\n'
export ADMIN_PASSWORD
npm start
```

Open `http://127.0.0.1:8080` and sign in as `admin` or the name set in
`ADMIN_USERNAME`. There is no default password. For initial setup, use a unique
random password of at least 16 characters. The server requires at least eight
characters after trimming leading and trailing whitespace. After the first setup,
changing the environment variables does not change the existing account; change
its credentials in the admin panel instead. If an existing installation used
a default or shared password in an older version, change it before exposing
the service.

## Configuration

| Environment variable | Purpose |
|---|---|
| `AUTH_CONFIG_PATH` | Path to a complete JSON configuration; defaults to `config.json`. Use `config.local.json` for a local copy. |
| `AUTH_LISTEN_HOST` | Overrides the configured listen address; the shipped config uses `127.0.0.1`. |
| `PORT` | Overrides the configured listen port; the shipped config uses `8080`. |
| `AUTH_DB_PATH` | Overrides the configured SQLite path; the shipped config uses `data/auth.db`. |
| `AUTH_KEY_DIR` | Directory for the server's private keys; defaults to `keys/`. |
| `ADMIN_USERNAME` | Initial admin username; defaults to `admin`. |
| `ADMIN_PASSWORD` | Required when there is no administrator. |
| `AUTH_SECURE_COOKIES` | Set to `1` for production HTTPS; `0` (default) is for local HTTP. |

Relative config, database, and key paths are resolved from this directory.
`npm start` writes process output to the console for your service manager or log collector.
The optional `start-server.sh` uses `NODE_BIN` or `node` from `PATH` and appends
output to `AUTH_LOG_PATH` or `webadmin.log`. The Windows `start-server.cmd` uses
`node` from `PATH` and appends output to `webadmin.log`; use `npm start` if you
want your Windows service manager to collect or redirect the output.

## Production and repository boundary

- Serve the admin panel and client API over HTTPS. If using a TLS-terminating
  reverse proxy, keep the Node HTTP listener private and set
  `AUTH_SECURE_COOKIES=1`. Mount the admin panel at the site's root path.
- Keep database files (including SQLite sidecars), private keys, local
  configuration, environment files, logs, and backups out of version control.
  For custom paths or filenames, prefer locations outside the checkout, or add
  explicit ignore rules before creating them. Do not put real deployment
  addresses, cards, device identifiers, or credentials in documentation.
- Publish this directory as the repository root, not the containing workspace.
  Do not include workspace notes or runtime files.

See the [client integration guide](%E5%AF%B9%E6%8E%A5%E6%96%87%E6%A1%A3.md) for
the protocol, request and response examples, and key verification.
