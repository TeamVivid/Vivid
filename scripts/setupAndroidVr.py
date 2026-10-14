#!/usr/bin/env python3
import json
import os
import sys
import time
import urllib.request
import urllib.error
import uuid

CLIENT_ID = "652469312169-4lvs9bnhr9lpns9v451j5oivd81vjvu1.apps.googleusercontent.com"
CLIENT_SECRET = "3fTWrBJI5Uojm1TK7_iJCW5Z"
SCOPE = "https://www.googleapis.com/auth/youtube"
DEVICE_MODEL = "PICO4"
DEVICE_CODE_URL = "https://www.youtube.com/o/oauth2/device/code"
TOKEN_URL = "https://www.youtube.com/o/oauth2/token"
GRANT_DEVICE = "http://oauth.net/grant_type/device/1.0"
UA = "com.google.android.apps.youtube.vr.pico/1.73.21(Linux; U; Android 10; en_US; A8110 Build/5.13.7) gzip"

OUTPUT_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "oauth2.json")

def http_json(url, body=None, headers=None, timeout=30):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers or {}, method="POST" if data is not None else "GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode("utf-8", "replace")
            return r.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            return e.code, json.loads(raw)
        except json.JSONDecodeError:
            return e.code, {"raw": raw}

def oauth_headers():
    return {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": UA,
        "Pragma": "no-cache",
        "Cache-Control": "no-cache",
    }

def main():
    print("=" * 60)
    print("  Vivid - YouTube Android VR (Pico) OAuth2 Setup")
    print("=" * 60)

    status, data = http_json(
        DEVICE_CODE_URL,
        {
            "client_id": CLIENT_ID,
            "scope": SCOPE,
            "device_id": str(uuid.uuid4()),
            "device_model": DEVICE_MODEL,
        },
        oauth_headers(),
    )

    if status != 200 or "device_code" not in data:
        print(f"Error fetching device code (status {status}): {data}")
        sys.exit(1)

    verify_url = data.get("verification_url", "https://www.youtube.com/activate")
    user_code = data.get("user_code")
    device_code = data.get("device_code")
    interval = int(data.get("interval", 5))
    expires_in = int(data.get("expires_in", 1800))
    deadline = time.time() + expires_in

    print(f"\n1. Open your browser and go to: {verify_url}")
    print(f"2. Enter the code:              {user_code}")
    print("3. Authorize with your Google / YouTube account.\n")
    print("Waiting for authorization (press Ctrl+C to cancel)...")

    while time.time() < deadline:
        time.sleep(interval)
        status, tok = http_json(
            TOKEN_URL,
            {
                "client_id": CLIENT_ID,
                "client_secret": CLIENT_SECRET,
                "code": device_code,
                "grant_type": GRANT_DEVICE,
            },
            oauth_headers(),
        )

        err = tok.get("error")
        if err == "authorization_pending":
            continue
        if err == "slow_down":
            interval += 5
            continue
        if err:
            print(f"Authorization failed: {err}")
            sys.exit(1)

        if status == 200 and tok.get("refresh_token"):
            token_data = {
                "refresh_token": tok["refresh_token"],
                "access_token": tok.get("access_token", ""),
                "token_type": tok.get("token_type", "Bearer"),
                "expires_at": time.time() + float(tok.get("expires_in", 3600)),
            }
            with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
                json.dump(token_data, f, indent=2)
            try:
                os.chmod(OUTPUT_FILE, 0o600)
            except OSError:
                pass
            print(f"\nAuthorization successful!")
            print(f"Saved OAuth credentials to: {OUTPUT_FILE}")
            print("ANDROID_VR client with SABR streaming is now ready to use.")
            return

        print(f"Unexpected response ({status}): {tok}")
        sys.exit(1)

    print("Authorization code expired.")
    sys.exit(1)

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nSetup cancelled.")
        sys.exit(130)
