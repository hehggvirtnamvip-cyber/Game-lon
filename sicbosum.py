import requests
import websocket
import threading
import time
import json
import urllib.parse
from flask import Flask, jsonify

# ================== CONFIG ==================
SERVER = {
    "name": "SICBO",
    "base": "https://sicbo.apisum.pro",
    "hub": "sicboHub",
    "tid": 22
}

HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Origin": "https://play.sum.vin"
}

# ================== STORAGE ==================
RAW_DATA = []
PARSED_DATA = []
SESSION_SEEN = set()

MAX_LEN = 100

# ================== TOKEN ==================
def get_connection_data():
    try:
        url = SERVER["base"] + "/signalr/negotiate?clientProtocol=1.5"
        res = requests.get(url, headers=HEADERS, timeout=5).json()
        return res["ConnectionToken"]
    except Exception as e:
        print("❌ Lỗi token:", e)
        return None

# ================== BUILD WS ==================
def build_ws_url():
    token = get_connection_data()
    if not token:
        return None

    token = urllib.parse.quote(token)

    connection_data = urllib.parse.quote(
        json.dumps([{"name": SERVER["hub"]}])
    )

    return (
        SERVER["base"].replace("https", "wss")
        + "/signalr/connect?"
        + "transport=webSockets"
        + f"&connectionToken={token}"
        + f"&connectionData={connection_data}"
        + "&clientProtocol=1.5"
        + f"&tid={SERVER['tid']}"
    )

# ================== SAVE RAW ==================
def save_raw(message):
    global RAW_DATA

    try:
        parsed = json.loads(message)
    except:
        parsed = None

    record = {
        "time": int(time.time()),
        "raw": message,
        "json": parsed
    }

    RAW_DATA.append(record)

    if len(RAW_DATA) > MAX_LEN:
        RAW_DATA.pop(0)

# ================== SAVE PARSED ==================
def save_parsed(data):
    global PARSED_DATA, SESSION_SEEN

    sid = data["session"]

    # tránh trùng phiên
    if sid in SESSION_SEEN:
        return

    SESSION_SEEN.add(sid)
    PARSED_DATA.append(data)

    if len(PARSED_DATA) > MAX_LEN:
        old = PARSED_DATA.pop(0)
        SESSION_SEEN.discard(old["session"])

    print("🔥 SICBO:", data)

# ================== PARSE LOGIC ==================
def try_parse_sicbo(obj):
    try:
        if "Result" not in obj:
            return None

        dice = obj["Result"]

        d1 = dice.get("Dice1", -1)
        d2 = dice.get("Dice2", -1)
        d3 = dice.get("Dice3", -1)

        if d1 == -1:
            return None

        tong = d1 + d2 + d3

        return {
            "session": obj.get("SessionID"),
            "dice": [d1, d2, d3],
            "sum": tong,
            "result": "Tai" if tong >= 11 else "Xiu",
            "md5": obj.get("MD5"),

            "bet": {
                "tai": obj.get("CuaTai"),
                "xiu": obj.get("CuaXiu"),
                "chan": obj.get("CuaChan"),
                "le": obj.get("CuaLe")
            }
        }
    except:
        return None

# ================== PARSE MESSAGE ==================
def parse_message(message):
    # lọc rác
    if message in ["{}", '{"type":6}']:
        return

    save_raw(message)

    try:
        data = json.loads(message)
    except:
        return

    if "M" not in data:
        return

    for m in data["M"]:
        args = m.get("A", [])

        if not args:
            continue

        obj = args[0]

        if isinstance(obj, dict):
            result = try_parse_sicbo(obj)

            if result:
                save_parsed(result)

# ================== WS ==================
def start_ws():
    while True:
        try:
            ws_url = build_ws_url()

            if not ws_url:
                time.sleep(2)
                continue

            print("🌐 CONNECT:", ws_url)

            def on_message(ws, message):
                parse_message(message)

            def on_open(ws):
                print("✅ SICBO Connected")

                def ping():
                    i = 1
                    while True:
                        try:
                            ws.send(json.dumps({
                                "M": "PingPong",
                                "H": SERVER["hub"],
                                "I": i
                            }))

                            ws.send('{"type":6}')

                            i += 1
                            time.sleep(5)
                        except:
                            break

                threading.Thread(target=ping, daemon=True).start()

            def on_close(ws, a, b):
                print("❌ Disconnect → reconnect...")
                time.sleep(2)

            def on_error(ws, error):
                print("⚠️ WS Error:", error)

            ws = websocket.WebSocketApp(
                ws_url,
                on_open=on_open,
                on_message=on_message,
                on_error=on_error,
                on_close=on_close,
                header=[
                    "Origin: https://play.sum.vin",
                    "User-Agent: Mozilla/5.0"
                ]
            )

            ws.run_forever()

        except Exception as e:
            print("🔥 Crash:", e)
            time.sleep(2)

# ================== FLASK ==================
app = Flask(__name__)

@app.route("/")
def home():
    return {
        "status": "running",
        "routes": ["/sicbo", "/sicbo_raw"]
    }

# 👉 JSON đã rút gọn (dùng bot)
@app.route("/sicbo")
def sicbo():
    return jsonify(PARSED_DATA)

# 👉 RAW debug
@app.route("/sicbo_raw")
def sicbo_raw():
    return jsonify(RAW_DATA)

# ================== RUN ==================
threading.Thread(target=start_ws, daemon=True).start()

app.run(host="0.0.0.0", port=2000)