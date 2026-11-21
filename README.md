# EasyVerify

[English](#english)

EasyVerify &#26159;&#19968;&#20010;&#22522;&#20110; Node.js &#21644; SQLite &#30340;&#36731;&#37327;&#21345;&#23494;&#39564;&#35777;&#26381;&#21153;&#65292;&#25903;&#25345;&#35774;&#22791;&#32465;&#23450;&#12289;&#20250;&#35805;&#24515;&#36339;&#12289;&#23458;&#25143;&#31471;&#29256;&#26412;&#25511;&#21046;&#21644;&#20844;&#21578;&#19979;&#21457;&#65292;&#25552;&#20379;&#32593;&#39029;&#31649;&#29702;&#21518;&#21488;&#21644;&#23458;&#25143;&#31471; API&#12290;

## &#26412;&#22320;&#21551;&#21160;

&#20351;&#29992;&#38145;&#23450;&#20381;&#36182; `better-sqlite3@12.4.1` &#25903;&#25345;&#30340; Node.js &#29256;&#26412;&#65306;`20.x || 22.x || 23.x || 24.x`&#12290;
&#22312;&#20179;&#24211;&#26681;&#30446;&#24405;&#20013;&#29992; Bash &#25191;&#34892;&#65288;Windows &#21487;&#20351;&#29992; Git Bash&#65289;&#65306;

```bash
npm ci
read -rs -p 'Choose an admin password: ' ADMIN_PASSWORD
printf '\n'
export ADMIN_PASSWORD
npm start
```

&#25171;&#24320; `http://127.0.0.1:8080`&#65292;&#20351;&#29992; `admin` &#25110; `ADMIN_USERNAME` &#25351;&#23450;&#30340;&#29992;&#25143;&#21517;&#30331;&#24405;&#12290;&#31995;&#32479;&#27809;&#26377;&#40664;&#35748;&#23494;&#30721;&#12290;&#39318;&#27425;&#37197;&#32622;&#24314;&#35758;&#20351;&#29992;&#33267;&#23569; 16 &#20010;&#23383;&#31526;&#30340;&#29420;&#31435;&#38543;&#26426;&#23494;&#30721;&#65307;&#26381;&#21153;&#31471;&#35201;&#27714;&#21435;&#25481;&#39318;&#23614;&#31354;&#30333;&#21518;&#33267;&#23569;&#26377; 8 &#20010;&#23383;&#31526;&#12290;

&#21021;&#22987;&#21270;&#21518;&#65292;&#20462;&#25913;&#29615;&#22659;&#21464;&#37327;&#19981;&#20250;&#26356;&#26032;&#24050;&#26377;&#36134;&#21495;&#65292;&#35831;&#22312;&#31649;&#29702;&#21518;&#21488;&#20462;&#25913;&#12290;&#26087;&#37096;&#32626;&#33509;&#20351;&#29992;&#20102;&#40664;&#35748;&#23494;&#30721;&#25110;&#20849;&#20139;&#23494;&#30721;&#65292;&#35831;&#22312;&#23545;&#22806;&#25552;&#20379;&#26381;&#21153;&#21069;&#26356;&#25442;&#12290;

## &#37197;&#32622;

| &#29615;&#22659;&#21464;&#37327; | &#29992;&#36884; |
|---|---|
| `AUTH_CONFIG_PATH` | &#23436;&#25972; JSON &#37197;&#32622;&#25991;&#20214;&#30340;&#36335;&#24452;&#65292;&#40664;&#35748; `config.json`&#12290;&#26412;&#22320;&#21103;&#26412;&#21487;&#21629;&#21517;&#20026; `config.local.json`&#12290; |
| `AUTH_LISTEN_HOST` | &#35206;&#30422;&#30417;&#21548;&#22320;&#22336;&#65292;&#40664;&#35748; `127.0.0.1`&#12290; |
| `PORT` | &#35206;&#30422;&#30417;&#21548;&#31471;&#21475;&#65292;&#40664;&#35748; `8080`&#12290; |
| `AUTH_DB_PATH` | &#35206;&#30422; SQLite &#25968;&#25454;&#24211;&#36335;&#24452;&#65292;&#40664;&#35748; `data/auth.db`&#12290; |
| `AUTH_KEY_DIR` | &#26381;&#21153;&#31471;&#31169;&#38053;&#30446;&#24405;&#65292;&#40664;&#35748; `keys/`&#12290; |
| `ADMIN_USERNAME` | &#39318;&#27425;&#21021;&#22987;&#21270;&#30340;&#31649;&#29702;&#21592;&#29992;&#25143;&#21517;&#65292;&#40664;&#35748; `admin`&#12290; |
| `ADMIN_PASSWORD` | &#27809;&#26377;&#31649;&#29702;&#21592;&#36134;&#21495;&#26102;&#24517;&#39035;&#35774;&#32622;&#12290; |
| `AUTH_SECURE_COOKIES` | &#29983;&#20135; HTTPS &#37096;&#32626;&#35774;&#20026; `1`&#65307;&#26412;&#22320; HTTP &#20351;&#29992; `0`&#65288;&#40664;&#35748;&#65289;&#12290; |

&#37197;&#32622;&#25991;&#20214;&#12289;&#25968;&#25454;&#24211;&#21644;&#23494;&#38053;&#30340;&#30456;&#23545;&#36335;&#24452;&#22343;&#20197;&#20179;&#24211;&#26681;&#30446;&#24405;&#20026;&#22522;&#20934;&#12290;`npm start` &#23558;&#36755;&#20986;&#20889;&#21040;&#25511;&#21046;&#21488;&#65292;&#21487;&#30001;&#26381;&#21153;&#31649;&#29702;&#22120;&#25110;&#26085;&#24535;&#37319;&#38598;&#24037;&#20855;&#25509;&#25910;&#12290;
`start-server.sh` &#20351;&#29992; `NODE_BIN` &#25110; `PATH` &#20013;&#30340; `node`&#65292;&#24182;&#23558;&#36755;&#20986;&#36861;&#21152;&#21040; `AUTH_LOG_PATH` &#25110; `webadmin.log`&#12290;
Windows &#30340; `start-server.cmd` &#20351;&#29992; `PATH` &#20013;&#30340; `node` &#24182;&#23558;&#36755;&#20986;&#36861;&#21152;&#21040; `webadmin.log`&#65307;&#22914;&#38656;&#30001; Windows &#26381;&#21153;&#31649;&#29702;&#22120;&#25509;&#25910;&#25110;&#37325;&#23450;&#21521;&#36755;&#20986;&#65292;&#35831;&#20351;&#29992; `npm start`&#12290;

## &#29983;&#20135;&#37096;&#32626;&#19982;&#21457;&#24067;&#36793;&#30028;

- &#31649;&#29702;&#21518;&#21488;&#21644;&#23458;&#25143;&#31471; API &#22343;&#24212;&#36890;&#36807; HTTPS &#25552;&#20379;&#12290;&#33509;&#22312;&#21453;&#21521;&#20195;&#29702;&#22788;&#32456;&#27490; TLS&#65292;&#35831;&#38480;&#21046; Node HTTP &#30417;&#21548;&#30340;&#35775;&#38382;&#33539;&#22260;&#65292;&#24182;&#35774;&#32622; `AUTH_SECURE_COOKIES=1`&#12290;&#31649;&#29702;&#21518;&#21488;&#24212;&#37096;&#32626;&#22312;&#31449;&#28857;&#26681;&#36335;&#24452;&#12290;
- &#19981;&#35201;&#25552;&#20132;&#25968;&#25454;&#24211;&#21450; SQLite &#38468;&#23646;&#25991;&#20214;&#12289;&#31169;&#38053;&#12289;&#26412;&#22320;&#37197;&#32622;&#12289;&#29615;&#22659;&#25991;&#20214;&#12289;&#26085;&#24535;&#25110;&#22791;&#20221;&#12290;&#33258;&#23450;&#20041;&#36335;&#24452;&#20248;&#20808;&#25918;&#22312;&#20179;&#24211;&#22806;&#65307;&#22914;&#38656;&#25918;&#22312;&#20179;&#24211;&#20869;&#65292;&#20808;&#28155;&#21152;&#26126;&#30830;&#30340;&#24573;&#30053;&#35268;&#21017;&#12290;
- &#19981;&#35201;&#22312;&#25991;&#26723;&#20013;&#22635;&#20889;&#30495;&#23454;&#37096;&#32626;&#22320;&#22336;&#12289;&#21345;&#23494;&#12289;&#35774;&#22791;&#26631;&#35782;&#25110;&#20973;&#25454;&#12290;&#21457;&#24067;&#26102;&#21482;&#25552;&#20132;&#26412;&#30446;&#24405;&#65292;&#19981;&#21253;&#21547;&#19978;&#19968;&#32423;&#24037;&#20316;&#21306;&#25110;&#20854;&#20013;&#30340;&#31508;&#35760;&#21644;&#36816;&#34892;&#25968;&#25454;&#12290;

&#21327;&#35758;&#12289;&#35831;&#27714;&#19982;&#21709;&#24212;&#31034;&#20363;&#20197;&#21450;&#20844;&#38053;&#39564;&#35777;&#26041;&#27861;&#35265;[&#23458;&#25143;&#31471;&#23545;&#25509;&#25991;&#26723;](%E5%AF%B9%E6%8E%A5%E6%96%87%E6%A1%A3.md)&#12290;

---

## English

[Back to Chinese](#easyverify)

A lightweight Node.js and SQLite service for card-based authentication, device binding,
session heartbeats, client-version policies, and announcements. It includes a browser-based
admin panel and a client API.

### Local setup

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

### Configuration

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

### Production and repository boundary

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
