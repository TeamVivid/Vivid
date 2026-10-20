![Vivid Logo](https://github.com/TeamVivid/.github/blob/main/vivid-logo-transparent-smaller.png?raw=true)

A privacy focused alternative YouTube frontend inspired by Invidious and Nitter

## Instances

- [Official Public Instance](https://vivid.errexe.xyz/) ([Privacy Policy](https://i.errexe.xyz/vivid/public-privacy-v1.html))

## Self Hosting

### Prerequisites

- Node.js
- npm

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/TeamVivid/Vivid.git
   cd vivid
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the frontend:
   ```bash
   npm run build
   ```

4. Start the server:
   ```bash
   npm start
   ```

The app will be available at `http://localhost:3067`.

## Configuration (Environment Variables)

- `PORT`: server port (default `3067`)
- `PRIVACY_POLICY_URL` / `PRIVACY-POLICY-URL`: link the footer's Privacy Policy to your own policy instead of the built-in page
- `VIVID_LANG`: language for innertube requests
- `FORCE_SABR`: force SABR
- `DISABLE_SABR`: disable SABR
- `SPECIAL_CLIENT_RETRY`: retries for special innertube clients
- `FORCE_YT_DLP`: force yt-dlp extraction
- `YT_DLP_PATH`: custom yt-dlp binary path
- `YT_COOKIE_HEADER`: custom cookie header for BotGuard
- `YT_AUTH_HEADER`: custom auth header for BotGuard

## Configuration (Config Files)


- `cookies.txt`: create a cookies.txt file to bypass login requirements
- `proxies.txt`: create a proxies.txt file to bypass IP bans


## Architecture

Vivid is split into three main components:

- **Extractor**: Vivid's Extractor
- **Server**: Vivid's API
- **Frontend**: Vivid's Frontend

## License

AGPL-3.0 - See LICENSE for details.
