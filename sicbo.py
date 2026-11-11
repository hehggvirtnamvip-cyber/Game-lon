import requests
import json
import threading
import time
import websocket
import urllib.parse
from collections import Counter, defaultdict
import numpy as np
from datetime import datetime
from typing import List, Dict, Tuple, Any
import math
import traceback
import random
from flask import Flask, jsonify, request
from flask_cors import CORS
import logging
import certifi  # ✅ FIX SSL

# ==================== CẤU HÌNH LOGGING ====================
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# ==================== CẤU HÌNH GAME ====================
GAME_CONFIGS = {
    '789club': {
        'base_url': 'https://api.xeuigogo.info/v2/history/getLastResult',
        'gameId': 'ktrng_3986',
        'tableId': '39861215743193',
        'size': 100
    },
    'b52': {
        'base_url': 'https://api.wsmt8g.cc/v2/history/getLastResult',
        'gameId': 'ktrng_3996',
        'tableId': '39961215743193',
        'size': 100
    },
    'hitclub': {
        'base_url': 'https://api.wsmt8g.cc/v2/history/getLastResult',
        'gameId': 'ktrng_3932',
        'tableId': '39321215743193',
        'size': 100
    },
    'rikvip': {
        'base_url': 'https://api.wsmt8g.cc/v2/history/getLastResult',
        'gameId': 'ktrng_3980',
        'tableId': '39801215743193',
        'size': 100
    },
    'sunwin': {
        'base_url': 'https://api.wsktnus8.net/v2/history/getLastResult',
        'gameId': 'ktrng_3979',
        'tableId': '39791215743193',
        'size': 100
    },
    'sumclub': {
        'base_url': None,          # WebSocket
        'gameId': None,
        'tableId': None,
        'size': 100
    },
    'sunlive': {
        'base_url': None,          # WebSocket
        'gameId': None,
        'tableId': None,
        'size': 100
    },
    'luckywin': {
        'base_url': 'https://luck8bot.com/api/GetNewLottery/Sicbo50',
        'gameId': 'Sicbo50',
        'tableId': None,
        'size': 100,
        'poll_interval': 2
    }
}

# ==================== DỮ LIỆU TOÀN CỤC ====================
sumclub_history = []
sumclub_session_seen = set()
sumclub_lock = threading.Lock()
MAX_SUMCLUB_HISTORY = 100

sunlive_history = []
sunlive_session_seen = set()
sunlive_lock = threading.Lock()
MAX_SUNLIVE_HISTORY = 100

luckywin_history = []
luckywin_id_seen = set()
luckywin_lock = threading.Lock()
MAX_LUCKYWIN_HISTORY = 100

# ==================== SUMCLUB WEBSOCKET (ĐÃ SỬA SSL) ====================
SUMCLUB_SERVER = {
    "name": "SICBO",
    "base": "https://sicbo.apisum.pro",
    "hub": "sicboHub",
    "tid": 22
}
SUMCLUB_HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Origin": "https://play.sum.vin"
}

def get_connection_token():
    try:
        url = SUMCLUB_SERVER["base"] + "/signalr/negotiate?clientProtocol=1.5"
        # ✅ FIX: thêm verify=certifi.where()
        res = requests.get(url, headers=SUMCLUB_HEADERS, timeout=5, verify=certifi.where()).json()
        return res["ConnectionToken"]
    except Exception as e:
        logger.error(f"SUMCLUB token error: {e}")
        return None

def build_ws_url():
    token = get_connection_token()
    if not token:
        return None
    token = urllib.parse.quote(token)
    connection_data = urllib.parse.quote(
        json.dumps([{"name": SUMCLUB_SERVER["hub"]}])
    )
    return (
        SUMCLUB_SERVER["base"].replace("https", "wss")
        + "/signalr/connect?"
        + "transport=webSockets"
        + f"&connectionToken={token}"
        + f"&connectionData={connection_data}"
        + "&clientProtocol=1.5"
        + f"&tid={SUMCLUB_SERVER['tid']}"
    )

def parse_sumclub_message(message):
    if message in ["{}", '{"type":6}']:
        return
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
        if not isinstance(obj, dict):
            continue
        if "Result" not in obj:
            continue
        dice_data = obj["Result"]
        d1 = dice_data.get("Dice1", -1)
        d2 = dice_data.get("Dice2", -1)
        d3 = dice_data.get("Dice3", -1)
        if d1 == -1:
            continue
        session = obj.get("SessionID")
        if not session:
            continue
        tong = d1 + d2 + d3
        result_type = 1 if tong >= 11 else 0
        new_record = {
            'gameNum': str(session),
            'score': tong,
            'faces': [d1, d2, d3],
            'resultType': result_type,
            'time': int(time.time())
        }
        with sumclub_lock:
            if sumclub_history and sumclub_history[-1]['gameNum'] == str(session):
                return
            if session in sumclub_session_seen:
                return
            sumclub_session_seen.add(session)
            sumclub_history.append(new_record)
            if len(sumclub_history) > MAX_SUMCLUB_HISTORY:
                old = sumclub_history.pop(0)
                sumclub_session_seen.discard(old['gameNum'])
        logger.info(f"SUMCLUB new record: {new_record}")

def start_sumclub_ws():
    while True:
        try:
            ws_url = build_ws_url()
            if not ws_url:
                time.sleep(2)
                continue
            logger.info("SUMCLUB WS connecting...")
            def on_message(ws, message):
                parse_sumclub_message(message)
            def on_open(ws):
                logger.info("SUMCLUB WS connected")
                def ping():
                    i = 1
                    while True:
                        try:
                            ws.send(json.dumps({
                                "M": "PingPong",
                                "H": SUMCLUB_SERVER["hub"],
                                "I": i
                            }))
                            ws.send('{"type":6}')
                            i += 1
                            time.sleep(5)
                        except:
                            break
                threading.Thread(target=ping, daemon=True).start()
            def on_close(ws, a, b):
                logger.info("SUMCLUB WS disconnected, reconnecting...")
                time.sleep(2)
            def on_error(ws, error):
                logger.error(f"SUMCLUB WS error: {error}")
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
            # ✅ FIX SSL: tắt xác thực certificate cho WebSocket
            ws.run_forever(sslopt={"cert_reqs": 0})
        except Exception as e:
            logger.error(f"SUMCLUB WS crash: {e}")
            time.sleep(2)

# ==================== SUNLIVE WEBSOCKET (THÊM SSLOPT) ====================
SUNLIVE_WS_URL = "wss://livecasino.azhkthg1.com/websocket?token=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJnZW5kZXIiOjAsImNhblZpZXdTdGF0IjpmYWxzZSwiZGlzcGxheU5hbWUiOiJzdW53aW50aGFjaG9lbTEiLCJib3QiOjAsImlzTWVyY2hhbnQiOmZhbHNlLCJ2ZXJpZmllZEJhbmtBY2NvdW50Ijp0cnVlLCJwbGF5RXZlbnRMb2JieSI6ZmFsc2UsImN1c3RvbWVySWQiOjEzMDA1NTkwMCwiYWZmSWQiOiJzdW53aW4iLCJiYW5uZWQiOmZhbHNlLCJicmFuZCI6InN1bi53aW4iLCJ0aW1lc3RhbXAiOjE3NTU5NzA4NDU0NzIsImxvY2tHYW1lcyI6W10sImFtb3VudCI6MCwibG9ja0NoYXQiOmZhbHNlLCJwaG9uZVZlcmlmaWVkIjpmYWxzZSwiaXBBZGRyZXNzIjoiMjAwMTplZTA6NTE0ODpmZTQwOjRkZWQ6MWVkMDphZjA5OmU1MGIiLCJtdXRlIjpmYWxzZSwiYXZhdGFyIjoiaHR0cHM6Ly9pbWFnZXMuc3dpbnNob3AubmV0L2ltYWdlcy9hdmF0YXIvYXZhdGFyXzExLnBuZyIsInBsYXRmb3JtSWQiOjIsInVzZXJJZCI6ImNiMGFhOWZhLWYyNDktNDYwNC1iMzU1LWUwMjA4YjE5MjA5YyIsInJlZ1RpbWUiOjE2OTcwMjQzMjI4MjEsInBob25lIjoiIiwiZGVwb3NpdCI6dHJ1ZSwidXNlcm5hbWUiOiJTQ19uZ3V5ZW52YW50aW5obmUifQ.wqXlP1bi1q-sdkSTlXuhjrXo9XyDr6VhlF1BT-naXBM"
SUNLIVE_INIT_PAYLOAD = [
    1,
    "Livestream",
    "SC_nguyenvantinhne",
    "tinhbip",
    {
        "info": json.dumps({
            "ipAddress": "2001:ee0:5148:fe40:4ded:1ed0:af09:e50b",
            "wsToken": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJnZW5kZXIiOjAsImNhblZpZXdTdGF0IjpmYWxzZSwiZGlzcGxheU5hbWUiOiJzdW53aW50aGFjaG9lbTEiLCJib3QiOjAsImlzTWVyY2hhbnQiOmZhbHNlLCJ2ZXJpZmllZEJhbmtBY2NvdW50Ijp0cnVlLCJwbGF5RXZlbnRMb2JieSI6ZmFsc2UsImN1c3RvbWVySWQiOjEzMDA1NTkwMCwiYWZmSWQiOiJzdW53aW4iLCJiYW5uZWQiOmZhbHNlLCJicmFuZCI6InN1bi53aW4iLCJ0aW1lc3RhbXAiOjE3NTU5Njg1NjQ1NzMsImxvY2tHYW1lcyI6W10sImFtb3VudCI6MCwibG9ja0NoYXQiOmZhbHNlLCJwaG9uZVZlcmlmaWVkIjpmYWxzZSwiaXBBZGRyZXNzIjoiMjAwMTplZTA6NTE0ODpmZTQwOjRkZWQ6MWVkMDphZjA5OmU1MGIiLCJtdXRlIjpmYWxzZSwiYXZhdGFyIjoiaHR0cHM6Ly9pbWFnZXMuc3dpbnNob3AubmV0L2ltYWdlcy9hdmF0YXIvYXZhdGFyXzExLnBuZyIsInBsYXRmb3JtSWQiOjIsInVzZXJJZCI6ImNiMGFhOWZhLWYyNDktNDYwNC1iMzU1LWUwMjA4YjE5MjA5YyIsInJlZ1RpbWUiOjE2OTcwMjQzMjI4MjEsInBob25lIjoiIiwiZGVwb3NpdCI6dHJ1ZSwidXNlcm5hbWUiOiJTQ19uZ3V5ZW52YW50aW5obmUifQ.duRMuLNiau8bcmFFAu4klvN_R4htD0M7cpHTmOjie8A",
            "locale": "vi",
            "userId": "cb0aa9fa-f249-4604-b355-e0208b19209c",
            "username": "SC_nguyenvantinhne",
            "timestamp": 1755968564573,
            "refreshToken": "19397790e2014532a9fdc4c69cc5685a.fbdc9c9d6be747599c0df3c5445085eb"
        }),
        "signature": "61303EEA4C93B1D91FC463F171C32F5A4B02856CAEE2D1E453079C9A6E7C8E97584915C04DC099A560D5D888B6BAED4F7A2BFEA09E4C98CD42FEEE4E4C24CA101CB52B522D97AE03A6DF9699A9B65275AEEA9071AF1C882234543B1C8FE40EA8152CB7824705A74AA13D13C92EC0CBF63BD3A06555F5089C1FE6C03B06924BE6",
        "pid": 5,
        "subi": True
    }
]

def parse_sunlive_message(message):
    try:
        msg = json.loads(message)
    except:
        return

    if isinstance(msg, list) and len(msg) >= 2 and isinstance(msg[1], dict):
        payload = msg[1]
        if payload.get('cmd') == 1956:
            result_raw = payload.get('resultRaw')
            if result_raw:
                xuc_xac = [int(n) for n in result_raw if n.isdigit()]
                if len(xuc_xac) == 3:
                    tong = sum(xuc_xac)
                    session = payload.get('sessionId')
                    if not session:
                        return
                    new_record = {
                        'gameNum': str(session),
                        'score': tong,
                        'faces': xuc_xac,
                        'resultType': 1 if tong >= 11 else 0,
                        'time': int(time.time())
                    }
                    with sunlive_lock:
                        if sunlive_history and sunlive_history[-1]['gameNum'] == str(session):
                            return
                        if session in sunlive_session_seen:
                            return
                        sunlive_session_seen.add(session)
                        sunlive_history.append(new_record)
                        if len(sunlive_history) > MAX_SUNLIVE_HISTORY:
                            old = sunlive_history.pop(0)
                            sunlive_session_seen.discard(old['gameNum'])
                    logger.info(f"SUNLIVE new record: {new_record}")

def start_sunlive_ws():
    global sunlive_ws
    while True:
        try:
            logger.info("SUNLIVE WS connecting...")
            def on_message(ws, message):
                parse_sunlive_message(message)
            def on_open(ws):
                logger.info("SUNLIVE WS connected")
                try:
                    ws.send(json.dumps(SUNLIVE_INIT_PAYLOAD))
                except Exception as e:
                    logger.error(f"SUNLIVE init error: {e}")
                def send_commands():
                    try:
                        if ws and ws.sock and ws.sock.connected:
                            ws.send(json.dumps([6, "Livestream", "Sicbo88Plugin", {"cmd": 1950, "sC": True}]))
                            time.sleep(0.1)
                            ws.send(json.dumps([6, "Livestream", "Sicbo88Plugin", {"cmd": 1959}]))
                    except Exception as e:
                        logger.error(f"SUNLIVE command error: {e}")
                threading.Timer(1.2, send_commands).start()
                def ping_loop():
                    while True:
                        time.sleep(0.5)
                        try:
                            if ws and ws.sock and ws.sock.connected:
                                ws.send(json.dumps([2]))
                        except:
                            break
                threading.Thread(target=ping_loop, daemon=True).start()
            def on_close(ws, a, b):
                logger.info("SUNLIVE WS disconnected, reconnecting...")
                time.sleep(3)
            def on_error(ws, error):
                logger.error(f"SUNLIVE WS error: {error}")
            sunlive_ws = websocket.WebSocketApp(
                SUNLIVE_WS_URL,
                on_open=on_open,
                on_message=on_message,
                on_error=on_error,
                on_close=on_close
            )
            # ✅ FIX SSL: thêm sslopt để tránh lỗi chứng chỉ
            sunlive_ws.run_forever(sslopt={"cert_reqs": 0})
        except Exception as e:
            logger.error(f"SUNLIVE WS crash: {e}")
            time.sleep(3)

# ==================== LUCKYWIN HTTP POLLING ====================
def fetch_luckywin():
    try:
        url = GAME_CONFIGS['luckywin']['base_url']
        resp = requests.get(url, timeout=5, verify=certifi.where())
        if resp.status_code != 200:
            logger.error(f"Luckywin API status {resp.status_code}")
            return None
        data = resp.json()
        if data.get('state') != 1:
            return None
        return data.get('data')
    except Exception as e:
        logger.error(f"Luckywin API error: {e}")
        return None

def parse_luckywin_record(record: dict):
    try:
        raw_code = record.get('OpenCode', '')
        if not raw_code:
            return None
        faces = [int(x.strip()) for x in raw_code.split(',') if x.strip().isdigit()]
        if len(faces) != 3:
            return None
        score = sum(faces)
        result_type = 1 if score >= 11 else 0
        game_num = str(record.get('ID', ''))
        if not game_num:
            return None
        open_time = record.get('OpenTime', '')
        timestamp = int(time.time())
        if open_time:
            try:
                dt = datetime.strptime(open_time, "%Y-%m-%d %H:%M:%S")
                timestamp = int(dt.timestamp())
            except:
                pass
        return {
            'gameNum': game_num,
            'score': score,
            'faces': faces,
            'resultType': result_type,
            'time': timestamp
        }
    except Exception as e:
        logger.error(f"Parse luckywin record error: {e}")
        return None

def luckywin_polling_loop():
    interval = GAME_CONFIGS['luckywin']['poll_interval']
    while True:
        try:
            raw = fetch_luckywin()
            if raw:
                parsed = parse_luckywin_record(raw)
                if parsed:
                    game_num = parsed['gameNum']
                    with luckywin_lock:
                        if game_num in luckywin_id_seen:
                            pass
                        else:
                            luckywin_id_seen.add(game_num)
                            luckywin_history.append(parsed)
                            if len(luckywin_history) > MAX_LUCKYWIN_HISTORY:
                                old = luckywin_history.pop(0)
                                luckywin_id_seen.discard(old['gameNum'])
                            logger.info(f"LUCKYWIN new record: {parsed}")
        except Exception as e:
            logger.error(f"Luckywin polling error: {e}")
        time.sleep(interval)

# ==================== HELPER WRAPPERS (định nghĩa TRƯỚC khi dùng) ====================
def start_ws_safe_sumclub():
    while True:
        try:
            start_sumclub_ws()
        except Exception as e:
            logger.error(f"SUMCLUB WS thread crash: {e}")
            time.sleep(5)

def start_ws_safe_sunlive():
    while True:
        try:
            start_sunlive_ws()
        except Exception as e:
            logger.error(f"SUNLIVE WS thread crash: {e}")
            time.sleep(5)

def start_polling_luckywin():
    luckywin_polling_loop()

# ==================== SICBO PREDICTOR NÂNG CẤP (VIP) ====================
class SicboPredictor:
    def __init__(self, game_config):
        self.base_url = game_config['base_url']
        self.params = {
            "gameId": game_config.get('gameId'),
            "size": game_config.get('size', 100),
            "tableId": game_config.get('tableId'),
            "curPage": 1
        }
        
        # ========== CÁC MODEL CHÍNH (MỞ RỘNG) ==========
        self.main_models = {
            # Các model cũ (giữ nguyên)
            'basic_pattern': self.analyze_basic_patterns,
            'trend': self.analyze_trend,
            'imbalance': self.analyze_imbalance,
            'short_term': self.analyze_short_term,
            'dice_volatility': self.analyze_dice_volatility,
            'score_distribution': self.analyze_score_distribution,
            'face_frequency': self.analyze_face_frequency,
            'pattern_121': self.analyze_pattern_121,
            'pattern_212': self.analyze_pattern_212,
            'streak': self.analyze_streak,
            'reversal': self.analyze_reversal,
            'momentum': self.analyze_momentum,
            'odd_even': self.analyze_odd_even_model,
            'total_points': self.analyze_total_points,
            'dice_combination': self.analyze_dice_combination,
            # 🚀 CÁC MODEL MỚI
            'cau_bet': self.detect_streak_pattern,
            'cau_1_1': self.detect_alternating,
            'cau_2_2': self.detect_double_alternate,
            'cau_321': self.detect_321_pattern,
            'cau_dao': self.detect_reversal_pattern,
            'cau_chan_le': self.analyze_even_odd_enhanced,
            'cau_mat_xuc_xac': self.analyze_dice_face_pattern,
            'cau_tong_diem': self.analyze_score_cluster
        }
        
        # Sub-models mở rộng
        self.sub_models = {
            'long_streak': self.detect_long_streak,
            'gap_analysis': self.analyze_gap,
            'historical_compare': self.compare_with_history,
            'odd_even_balance': self.analyze_odd_even,
            'score_regression': self.analyze_total_score,
            'bbp': self.analyze_bbp,
            'balance_recovery': self.analyze_balance_recovery,
            'martingale_signal': self.analyze_martingale_signal
        }
        
        # Mini models mới
        self.mini_models = {
            'good_pattern': self.detect_good_pattern,
            'volatility': self.predict_volatility,
            'pattern_match': self.compare_patterns,
            'local_trend': self.local_trend,
            'staircase': self.detect_staircase,
            'symmetry': self.detect_symmetry
        }
        
        # Lưu hiệu suất các model
        self.performance_history = defaultdict(list)
        self.model_weights = {name: 1.0 for name in self.main_models.keys()}
        for name in self.sub_models.keys():
            self.model_weights[name] = 0.6
        for name in self.mini_models.keys():
            self.model_weights[name] = 0.4

    # ---------- HÀM LẤY LỊCH SỬ ----------
    def fetch_history(self) -> List[Dict]:
        if self.base_url is None:
            return self._fetch_memory_history()
        try:
            logger.info(f"Fetching {self.params['gameId']} from {self.base_url}")
            response = requests.get(self.base_url, params=self.params, timeout=10, verify=certifi.where())
            data = response.json()
            result_list = []
            if isinstance(data, dict):
                if 'data' in data:
                    if isinstance(data['data'], dict) and 'resultList' in data['data']:
                        result_list = data['data']['resultList']
                    elif isinstance(data['data'], list):
                        result_list = data['data']
                elif 'resultList' in data:
                    result_list = data['resultList']
                elif isinstance(data.get('data'), list):
                    result_list = data['data']
            elif isinstance(data, list):
                result_list = data
            history = result_list[:50]
            processed = []
            for item in history:
                if not isinstance(item, dict):
                    continue
                faces = item.get('facesList', [])
                if not isinstance(faces, list):
                    faces = []
                score = item.get('score', 0)
                if not isinstance(score, (int, float)):
                    score = 0
                processed.append({
                    'gameNum': item.get('gameNum', ''),
                    'score': score,
                    'faces': faces,
                    'resultType': item.get('resultType', 0),
                    'time': item.get('timeMilli', 0)
                })
            return processed
        except Exception as e:
            logger.error(f"Error fetching history: {e}")
            traceback.print_exc()
            return []

    def _fetch_memory_history(self):
        raise NotImplementedError("Must be overridden for memory-based games")

    # ---------- DỰ ĐOÁN XÚC XẮC ----------
    def predict_dice(self, history: List[Dict]) -> List[int]:
        if len(history) < 5:
            return [3, 3, 3]
        all_faces = []
        for h in history[:20]:
            if isinstance(h.get('faces'), list) and len(h['faces']) == 3:
                all_faces.extend(h['faces'])
        if not all_faces:
            return [3, 3, 3]
        recent_faces = []
        for h in history[:15]:
            if isinstance(h.get('faces'), list) and len(h['faces']) == 3:
                recent_faces.extend(h['faces'])
        face_freq = Counter(recent_faces)
        most_common = face_freq.most_common(3)
        if len(most_common) < 3:
            while len(most_common) < 3:
                most_common.append((3, 0))
        pred_dice = [face for face, _ in most_common]
        pred_dice.sort()
        return pred_dice[:3]

    # ==================== CÁC MODEL MỚI ====================
    def detect_streak_pattern(self, history: List[Dict]) -> Dict:
        if len(history) < 3:
            return {'prediction': None, 'confidence': 0, 'reason': 'Không đủ dữ liệu'}
        results = ['Tài' if h['score'] >= 11 else 'Xỉu' for h in history]
        streak = 1
        for i in range(len(results)-2, -1, -1):
            if results[i] == results[-1]:
                streak += 1
            else:
                break
        if streak >= 4:
            other = 'Xỉu' if results[-1] == 'Tài' else 'Tài'
            conf = min(0.4 + streak * 0.05, 0.75)
            return {
                'prediction': other,
                'confidence': conf,
                'reason': f"Cầu bệt {results[-1]} {streak} phiên, dự đoán gãy"
            }
        elif streak >= 2:
            return {
                'prediction': results[-1],
                'confidence': 0.6,
                'reason': f"Cầu bệt {results[-1]} {streak} phiên, tiếp tục"
            }
        return {
            'prediction': results[-1],
            'confidence': 0.5,
            'reason': "Chưa hình thành bệt"
        }

    def detect_alternating(self, history: List[Dict]) -> Dict:
        if len(history) < 4:
            return {'prediction': None, 'confidence': 0, 'reason': 'Không đủ dữ liệu'}
        results = ['Tài' if h['score'] >= 11 else 'Xỉu' for h in history]
        if len(results) >= 4 and results[-4] != results[-3] and results[-3] != results[-2] and results[-2] != results[-1]:
            if results[-4] == results[-2] and results[-3] == results[-1]:
                return {
                    'prediction': results[-2] if results[-2] == 'Tài' else 'Xỉu',
                    'confidence': 0.75,
                    'reason': "Cầu 1-1 đan xen hoàn hảo"
                }
        if len(results) >= 3 and results[-3] != results[-2] and results[-2] != results[-1]:
            next_pred = results[-1]
            return {
                'prediction': next_pred,
                'confidence': 0.65,
                'reason': "Cầu 1-1 đang diễn ra"
            }
        return {'prediction': None, 'confidence': 0, 'reason': 'Không có cầu 1-1'}

    def detect_double_alternate(self, history: List[Dict]) -> Dict:
        if len(history) < 6:
            return {'prediction': None, 'confidence': 0, 'reason': 'Không đủ dữ liệu'}
        results = ['Tài' if h['score'] >= 11 else 'Xỉu' for h in history]
        if len(results) >= 4 and results[-4] == results[-3] and results[-2] == results[-1] and results[-3] != results[-2]:
            pred = results[-1]
            return {
                'prediction': pred,
                'confidence': 0.7,
                'reason': f"Cầu 2-2: {results[-4]}{results[-4]}{results[-2]}{results[-2]}"
            }
        if len(results) >= 6 and results[-6]==results[-5]==results[-4] and results[-3]==results[-2]==results[-1] and results[-4]!=results[-3]:
            pred = results[-1]
            return {
                'prediction': pred,
                'confidence': 0.8,
                'reason': f"Cầu 3-3 hoặc 2-2 mở rộng"
            }
        return {'prediction': None, 'confidence': 0, 'reason': 'Không có cầu 2-2'}

    def detect_321_pattern(self, history: List[Dict]) -> Dict:
        if len(history) < 6:
            return {'prediction': None, 'confidence': 0, 'reason': 'Không đủ dữ liệu'}
        results = ['Tài' if h['score'] >= 11 else 'Xỉu' for h in history]
        if len(results) >= 6 and results[-6] == results[-5] == results[-4] and results[-3] == results[-2] and results[-1] != results[-2]:
            if results[-4] != results[-3]:
                pred = results[-1]
                conf = 0.7
                reason = f"Cầu 3-2-1: {results[-6]}{results[-5]}{results[-4]} | {results[-3]}{results[-2]} | {results[-1]}"
                return {'prediction': pred, 'confidence': conf, 'reason': reason}
        return {'prediction': None, 'confidence': 0, 'reason': 'Không có cầu 3-2-1'}

    def detect_reversal_pattern(self, history: List[Dict]) -> Dict:
        if len(history) < 3:
            return {'prediction': None, 'confidence': 0, 'reason': 'Không đủ dữ liệu'}
        results = ['Tài' if h['score'] >= 11 else 'Xỉu' for h in history]
        if results[-1] != results[-2] and results[-2] == results[-3]:
            if len(results) >= 4 and results[-3] == results[-4] and results[-2] != results[-3]:
                return {
                    'prediction': results[-1],
                    'confidence': 0.7,
                    'reason': "Cầu đảo chiều sau 2 phiên liền"
                }
        return {'prediction': None, 'confidence': 0, 'reason': 'Không có cầu đảo'}

    def analyze_even_odd_enhanced(self, history: List[Dict]) -> Dict:
        if len(history) < 5:
            return {'prediction': None, 'confidence': 0, 'reason': 'Không đủ dữ liệu'}
        even_odd = ['Chẵn' if h['score'] % 2 == 0 else 'Lẻ' for h in history]
        if len(even_odd) >= 4 and even_odd[-4]==even_odd[-2] and even_odd[-3]==even_odd[-1] and even_odd[-2]!=even_odd[-3]:
            next_eo = even_odd[-1]
            last_score = history[-1]['score']
            if next_eo == 'Chẵn':
                predicted_score = last_score + 1 if last_score < 18 else last_score - 1
            else:
                predicted_score = last_score + 1 if last_score < 18 else last_score - 1
            pred = 'Tài' if predicted_score >= 11 else 'Xỉu'
            return {
                'prediction': pred,
                'confidence': 0.65,
                'reason': f"Cầu chẵn/lẻ đan xen, dự đoán {next_eo}"
            }
        return {'prediction': None, 'confidence': 0, 'reason': 'Không có cầu chẵn/lẻ rõ'}

    def analyze_dice_face_pattern(self, history: List[Dict]) -> Dict:
        if len(history) < 10:
            return {'prediction': None, 'confidence': 0, 'reason': 'Không đủ dữ liệu'}
        recent_faces = []
        for h in history[-20:]:
            if isinstance(h.get('faces'), list):
                recent_faces.extend(h['faces'])
        if not recent_faces:
            return {'prediction': None, 'confidence': 0, 'reason': 'Không có dữ liệu mặt'}
        freq = Counter(recent_faces)
        least_face = min(freq.items(), key=lambda x: x[1])[0] if freq else 1
        base_score = least_face * 3
        pred_score = min(18, max(3, base_score + np.random.randint(-2, 3)))
        pred = 'Tài' if pred_score >= 11 else 'Xỉu'
        return {
            'prediction': pred,
            'confidence': 0.55,
            'reason': f"Mặt {least_face} ít xuất hiện, khả năng về cao"
        }

    def analyze_score_cluster(self, history: List[Dict]) -> Dict:
        if len(history) < 4:
            return {'prediction': None, 'confidence': 0, 'reason': 'Không đủ dữ liệu'}
        scores = [h['score'] for h in history[-6:]]
        diffs = [scores[i] - scores[i-1] for i in range(1, len(scores))]
        if len(diffs) >= 3 and all(d > 0 for d in diffs[-3:]):
            next_score = min(18, scores[-1] + (diffs[-1] if diffs[-1] > 0 else 1))
            return {
                'prediction': 'Tài' if next_score >= 11 else 'Xỉu',
                'confidence': 0.6,
                'reason': "Xu hướng điểm tăng dần"
            }
        elif len(diffs) >= 3 and all(d < 0 for d in diffs[-3:]):
            next_score = max(3, scores[-1] + (diffs[-1] if diffs[-1] < 0 else -1))
            return {
                'prediction': 'Xỉu' if next_score < 11 else 'Tài',
                'confidence': 0.6,
                'reason': "Xu hướng điểm giảm dần"
            }
        return {'prediction': None, 'confidence': 0, 'reason': 'Không có cụm điểm rõ'}

    # ========== SUB-MODELS MỚI ==========
    def analyze_bbp(self, history: List[Dict]) -> Dict:
        if len(history) < 4:
            return None
        results = ['Tài' if h['score'] >= 11 else 'Xỉu' for h in history]
        if len(results) >= 4 and results[-4] == results[-3] == results[-2] and results[-1] != results[-2]:
            other = 'Xỉu' if results[-1] == 'Tài' else 'Tài'
            return {
                'prediction': other,
                'confidence': 0.7,
                'reason': "BBP: Bệt 3, Đảo, dự đoán tiếp tục đảo"
            }
        return None

    def analyze_balance_recovery(self, history: List[Dict]) -> Dict:
        if len(history) < 10:
            return None
        results = ['Tài' if h['score'] >= 11 else 'Xỉu' for h in history]
        tai_last5 = results[-5:].count('Tài')
        if tai_last5 >= 4:
            return {
                'prediction': 'Xỉu',
                'confidence': 0.65,
                'reason': "Quá lệch Tài (4/5), dự đoán Xỉu phục hồi"
            }
        elif tai_last5 <= 1:
            return {
                'prediction': 'Tài',
                'confidence': 0.65,
                'reason': "Quá lệch Xỉu (4/5), dự đoán Tài phục hồi"
            }
        return None

    def analyze_martingale_signal(self, history: List[Dict]) -> Dict:
        if len(history) < 3:
            return None
        results = ['Tài' if h['score'] >= 11 else 'Xỉu' for h in history]
        if results[-3] == results[-2] == results[-1]:
            other = 'Xỉu' if results[-1] == 'Tài' else 'Tài'
            return {
                'prediction': other,
                'confidence': 0.7,
                'reason': "Tín hiệu Martingale: 3 phiên liên tiếp, dự đoán đảo"
            }
        return None

    # ========== MINI MODELS MỚI ==========
    def detect_staircase(self, history: List[Dict]) -> Dict:
        if len(history) < 4:
            return None
        scores = [h['score'] for h in history[-4:]]
        diffs = [scores[i] - scores[i-1] for i in range(1, len(scores))]
        if len(set(diffs)) == 1 and abs(diffs[0]) == 1:
            next_score = scores[-1] + diffs[0]
            if 3 <= next_score <= 18:
                pred = 'Tài' if next_score >= 11 else 'Xỉu'
                return {
                    'prediction': pred,
                    'confidence': 0.75,
                    'reason': f"Cầu thang điểm {scores[-3]}→{scores[-2]}→{scores[-1]}"
                }
        return None

    def detect_symmetry(self, history: List[Dict]) -> Dict:
        if len(history) < 5:
            return None
        results = ['Tài' if h['score'] >= 11 else 'Xỉu' for h in history[-5:]]
        if results[0] == results[4] and results[1] == results[3]:
            return {
                'prediction': results[0],
                'confidence': 0.7,
                'reason': "Cầu đối xứng 5 phiên"
            }
        return None

    # ========== CÁC HÀM CŨ ==========
    def analyze_basic_patterns(self, history: List[Dict]) -> Dict:
        if len(history) < 3:
            return {'prediction': None, 'confidence': 0, 'reason': 'Không đủ dữ liệu'}
        results = ['Tài' if h['score'] >= 11 else 'Xỉu' for h in history]
        patterns_found = []
        if len(results) >= 3:
            if results[-3] != results[-2] and results[-2] != results[-1] and results[-3] == results[-1]:
                patterns_found.append(('1-2-1', results[-1], 0.75))
            if len(results) >= 3 and results[-3] == results[-2] and results[-2] != results[-1]:
                patterns_found.append(('1-1-2', results[-1], 0.7))
            if len(results) >= 3 and results[-3] != results[-2] and results[-2] == results[-1]:
                patterns_found.append(('2-1-1', results[-1], 0.7))
        if len(results) >= 2 and results[-1] == results[-2]:
            streak = 1
            for i in range(len(results)-2, -1, -1):
                if results[i] == results[-1]:
                    streak += 1
                else:
                    break
            if streak >= 3:
                patterns_found.append(('bệt', results[-1], 0.6 + streak * 0.05))
        if patterns_found:
            best_pattern = max(patterns_found, key=lambda x: x[2])
            return {
                'prediction': best_pattern[1],
                'confidence': min(best_pattern[2], 0.95),
                'reason': f"Phát hiện pattern {best_pattern[0]}"
            }
        return {
            'prediction': results[-1],
            'confidence': 0.4,
            'reason': 'Không phát hiện pattern rõ ràng'
        }

    def analyze_trend(self, history: List[Dict]) -> Dict:
        if len(history) < 10:
            return {'prediction': None, 'confidence': 0, 'reason': 'Không đủ dữ liệu'}
        results = ['Tài' if h['score'] >= 11 else 'Xỉu' for h in history]
        short_term = results[-5:]
        short_tai = short_term.count('Tài')
        short_xiu = short_term.count('Xỉu')
        long_term = results[-10:]
        long_tai = long_term.count('Tài')
        long_xiu = long_term.count('Xỉu')
        if short_tai > short_xiu:
            short_trend = 'Tài'
            short_strength = short_tai / 5
        else:
            short_trend = 'Xỉu'
            short_strength = short_xiu / 5
        if long_tai > long_xiu:
            long_trend = 'Tài'
            long_strength = long_tai / 10
        else:
            long_trend = 'Xỉu'
            long_strength = long_xiu / 10
        if short_trend == long_trend:
            confidence = 0.5 + (short_strength + long_strength) / 4
            return {
                'prediction': short_trend,
                'confidence': min(confidence, 0.9),
                'reason': f"Xu hướng {short_trend} cả ngắn và dài hạn"
            }
        else:
            confidence = 0.4 + short_strength / 3
            return {
                'prediction': short_trend,
                'confidence': min(confidence, 0.7),
                'reason': f"Xu hướng ngắn hạn {short_trend} (dài hạn {long_trend})"
            }

    def analyze_imbalance(self, history: List[Dict]) -> Dict:
        if len(history) < 15:
            return {'prediction': None, 'confidence': 0, 'reason': 'Không đủ dữ liệu'}
        results = ['Tài' if h['score'] >= 11 else 'Xỉu' for h in history]
        recent = results[-15:]
        tai_count = recent.count('Tài')
        xiu_count = recent.count('Xỉu')
        tai_ratio = tai_count / 15
        if tai_ratio > 0.6:
            confidence = 0.5 + (tai_ratio - 0.5)
            return {
                'prediction': 'Xỉu',
                'confidence': min(confidence, 0.8),
                'reason': f"Tài quá nhiều ({tai_count}/15), dự đoán Xỉu cân bằng"
            }
        elif xiu_count / 15 > 0.6:
            confidence = 0.5 + ((xiu_count/15) - 0.5)
            return {
                'prediction': 'Tài',
                'confidence': min(confidence, 0.8),
                'reason': f"Xỉu quá nhiều ({xiu_count}/15), dự đoán Tài cân bằng"
            }
        return {
            'prediction': results[-1],
            'confidence': 0.5,
            'reason': f"Tỷ lệ cân bằng ({tai_count}T-{xiu_count}X)"
        }

    def analyze_short_term(self, history: List[Dict]) -> Dict:
        if len(history) < 3:
            return {'prediction': None, 'confidence': 0, 'reason': 'Không đủ dữ liệu'}
        results = ['Tài' if h['score'] >= 11 else 'Xỉu' for h in history]
        last_3 = results[-3:]
        if len(set(last_3)) == 1:
            return {
                'prediction': last_3[0],
                'confidence': 0.7,
                'reason': f"3 phiên {last_3[0]} liên tiếp"
            }
        if last_3[0] != last_3[1] and last_3[1] != last_3[2]:
            return {
                'prediction': last_3[2],
                'confidence': 0.6,
                'reason': "Pattern đan xen"
            }
        if last_3[1] == last_3[2]:
            return {
                'prediction': last_3[2],
                'confidence': 0.55,
                'reason': f"2 phiên {last_3[2]} gần nhất"
            }
        return {
            'prediction': results[-1],
            'confidence': 0.4,
            'reason': "Không có pattern ngắn hạn"
        }

    def analyze_dice_volatility(self, history: List[Dict]) -> Dict:
        if len(history) < 5:
            return {'prediction': None, 'confidence': 0, 'reason': 'Không đủ dữ liệu'}
        all_faces = []
        for h in history:
            if isinstance(h.get('faces'), list):
                all_faces.extend(h['faces'])
        if not all_faces:
            return {'prediction': None, 'confidence': 0, 'reason': 'Không có dữ liệu mặt'}
        face_freq = Counter(all_faces)
        total = len(all_faces)
        face_prob = {face: count/total for face, count in face_freq.items()}
        expected_prob = 1/6
        under_represented = [face for face, prob in face_prob.items() if prob < expected_prob * 0.8]
        if under_represented and len(under_represented) >= 3:
            avg_score = sum(under_represented[:3]) / len(under_represented[:3]) * 3
            pred = 'Tài' if avg_score >= 11 else 'Xỉu'
            return {
                'prediction': pred,
                'confidence': 0.6,
                'reason': f"Các mặt {under_represented[:3]} ít xuất hiện"
            }
        return {
            'prediction': 'Tài' if history[-1]['score'] >= 11 else 'Xỉu',
            'confidence': 0.4,
            'reason': "Phân bố mặt tương đối đều"
        }

    def analyze_score_distribution(self, history: List[Dict]) -> Dict:
        if len(history) < 10:
            return {'prediction': None, 'confidence': 0, 'reason': 'Không đủ dữ liệu'}
        scores = [h['score'] for h in history]
        tai_scores = [s for s in scores if s >= 11]
        xiu_scores = [s for s in scores if s < 11]
        avg_tai = np.mean(tai_scores) if tai_scores else 0
        avg_xiu = np.mean(xiu_scores) if xiu_scores else 0
        last_score = scores[-1]
        if last_score >= 11 and last_score > avg_tai * 1.1:
            return {
                'prediction': 'Xỉu',
                'confidence': 0.55,
                'reason': f"Điểm {last_score} cao hơn TB Tài {avg_tai:.1f}"
            }
        elif last_score < 11 and last_score < avg_xiu * 0.9:
            return {
                'prediction': 'Tài',
                'confidence': 0.55,
                'reason': f"Điểm {last_score} thấp hơn TB Xỉu {avg_xiu:.1f}"
            }
        return {
            'prediction': 'Tài' if last_score >= 11 else 'Xỉu',
            'confidence': 0.4,
            'reason': "Phân bố điểm bình thường"
        }

    def analyze_face_frequency(self, history: List[Dict]) -> Dict:
        if len(history) < 5:
            return {'prediction': None, 'confidence': 0, 'reason': 'Không đủ dữ liệu'}
        recent_faces = []
        for h in history[-10:]:
            if isinstance(h.get('faces'), list):
                recent_faces.extend(h['faces'])
        if not recent_faces:
            return {'prediction': None, 'confidence': 0, 'reason': 'Không có dữ liệu mặt'}
        recent_freq = Counter(recent_faces)
        min_face = min(recent_freq.items(), key=lambda x: x[1])[0] if recent_freq else 1
        predicted_score = min_face + 3.5 + 3.5
        pred = 'Tài' if predicted_score >= 11 else 'Xỉu'
        return {
            'prediction': pred,
            'confidence': 0.5,
            'reason': f"Mặt {min_face} ít xuất hiện gần đây"
        }

    def analyze_pattern_121(self, history: List[Dict]) -> Dict:
        if len(history) < 3:
            return {'prediction': None, 'confidence': 0, 'reason': 'Không đủ dữ liệu'}
        results = ['Tài' if h['score'] >= 11 else 'Xỉu' for h in history]
        if len(results) >= 3 and results[-3] == results[-1] and results[-2] != results[-1]:
            return {
                'prediction': results[-1],
                'confidence': 0.7,
                'reason': f"Pattern 1-2-1: {results[-3]}-{results[-2]}-{results[-1]}"
            }
        return {
            'prediction': results[-1],
            'confidence': 0.3,
            'reason': "Không phát hiện pattern 1-2-1"
        }

    def analyze_pattern_212(self, history: List[Dict]) -> Dict:
        if len(history) < 3:
            return {'prediction': None, 'confidence': 0, 'reason': 'Không đủ dữ liệu'}
        results = ['Tài' if h['score'] >= 11 else 'Xỉu' for h in history]
        if len(results) >= 3 and results[-3] != results[-2] and results[-2] == results[-1]:
            return {
                'prediction': results[-2],
                'confidence': 0.7,
                'reason': f"Pattern 2-1-2: {results[-3]}-{results[-2]}-{results[-1]}"
            }
        return {
            'prediction': results[-1],
            'confidence': 0.3,
            'reason': "Không phát hiện pattern 2-1-2"
        }

    def analyze_streak(self, history: List[Dict]) -> Dict:
        if len(history) < 2:
            return {'prediction': None, 'confidence': 0, 'reason': 'Không đủ dữ liệu'}
        results = ['Tài' if h['score'] >= 11 else 'Xỉu' for h in history]
        streak = 1
        for i in range(len(results)-2, -1, -1):
            if results[i] == results[-1]:
                streak += 1
            else:
                break
        if streak >= 3:
            other = 'Xỉu' if results[-1] == 'Tài' else 'Tài'
            confidence = 0.3 + streak * 0.05
            return {
                'prediction': other,
                'confidence': min(confidence, 0.7),
                'reason': f"Cầu {results[-1]} đã {streak} phiên, có thể gãy"
            }
        return {
            'prediction': results[-1],
            'confidence': 0.4,
            'reason': f"Cầu ngắn {streak} phiên"
        }

    def analyze_reversal(self, history: List[Dict]) -> Dict:
        if len(history) < 2:
            return {'prediction': None, 'confidence': 0, 'reason': 'Không đủ dữ liệu'}
        results = ['Tài' if h['score'] >= 11 else 'Xỉu' for h in history]
        if len(results) >= 2 and results[-2] != results[-1]:
            return {
                'prediction': results[-1],
                'confidence': 0.55,
                'reason': f"Đảo chiều từ {results[-2]} sang {results[-1]}"
            }
        other = 'Xỉu' if results[-1] == 'Tài' else 'Tài'
        return {
            'prediction': other,
            'confidence': 0.4,
            'reason': "Chưa đảo chiều, dự đoán đảo"
        }

    def analyze_momentum(self, history: List[Dict]) -> Dict:
        if len(history) < 5:
            return {'prediction': None, 'confidence': 0, 'reason': 'Không đủ dữ liệu'}
        scores = [h['score'] for h in history[-10:]]
        if len(scores) >= 5:
            x = np.arange(len(scores))
            z = np.polyfit(x, scores, 1)
            slope = z[0]
            if slope > 0.5:
                pred = 'Tài'
                confidence = 0.6
                reason = "Momentum tăng mạnh"
            elif slope < -0.5:
                pred = 'Xỉu'
                confidence = 0.6
                reason = "Momentum giảm mạnh"
            else:
                pred = 'Tài' if scores[-1] >= 11 else 'Xỉu'
                confidence = 0.4
                reason = "Momentum ổn định"
        else:
            pred = 'Tài' if scores[-1] >= 11 else 'Xỉu'
            confidence = 0.4
            reason = "Không đủ dữ liệu momentum"
        return {
            'prediction': pred,
            'confidence': confidence,
            'reason': reason
        }

    def analyze_odd_even_model(self, history: List[Dict]) -> Dict:
        if len(history) < 5:
            return {'prediction': None, 'confidence': 0, 'reason': 'Không đủ dữ liệu'}
        results = ['Chẵn' if h['score'] % 2 == 0 else 'Lẻ' for h in history]
        last_score = history[-1]['score']
        recent_odd_even = results[-5:]
        even_count = recent_odd_even.count('Chẵn')
        odd_count = recent_odd_even.count('Lẻ')
        if even_count > odd_count * 2:
            pred_score = last_score + 1 if last_score < 17 else last_score - 1
            pred = 'Tài' if pred_score >= 11 else 'Xỉu'
            return {
                'prediction': pred,
                'confidence': 0.6,
                'reason': "Nhiều chẵn, dự đoán lẻ"
            }
        elif odd_count > even_count * 2:
            pred_score = last_score + 1 if last_score < 17 else last_score - 1
            pred = 'Tài' if pred_score >= 11 else 'Xỉu'
            return {
                'prediction': pred,
                'confidence': 0.6,
                'reason': "Nhiều lẻ, dự đoán chẵn"
            }
        return {
            'prediction': 'Tài' if last_score >= 11 else 'Xỉu',
            'confidence': 0.4,
            'reason': "Cân bằng chẵn lẻ"
        }

    def analyze_total_points(self, history: List[Dict]) -> Dict:
        if len(history) < 5:
            return {'prediction': None, 'confidence': 0, 'reason': 'Không đủ dữ liệu'}
        scores = [h['score'] for h in history]
        avg_score = np.mean(scores)
        last_score = scores[-1]
        if last_score > avg_score * 1.2:
            return {
                'prediction': 'Xỉu',
                'confidence': 0.55,
                'reason': f"Điểm {last_score} cao hơn TB {avg_score:.1f}"
            }
        elif last_score < avg_score * 0.8:
            return {
                'prediction': 'Tài',
                'confidence': 0.55,
                'reason': f"Điểm {last_score} thấp hơn TB {avg_score:.1f}"
            }
        return {
            'prediction': 'Tài' if last_score >= 11 else 'Xỉu',
            'confidence': 0.4,
            'reason': "Điểm trong khoảng bình thường"
        }

    def analyze_dice_combination(self, history: List[Dict]) -> Dict:
        if len(history) < 5:
            return {'prediction': None, 'confidence': 0, 'reason': 'Không đủ dữ liệu'}
        combinations = []
        for h in history:
            if isinstance(h.get('faces'), list) and len(h['faces']) == 3:
                comb = tuple(sorted(h['faces']))
                combinations.append(comb)
        if not combinations:
            return {'prediction': None, 'confidence': 0, 'reason': 'Không có dữ liệu bộ số'}
        comb_freq = Counter(combinations)
        rarest_combs = comb_freq.most_common()[:-4:-1]
        if rarest_combs:
            avg_score = sum(sum(comb[0]) for comb in rarest_combs) / len(rarest_combs)
            pred = 'Tài' if avg_score >= 11 else 'Xỉu'
            return {
                'prediction': pred,
                'confidence': 0.55,
                'reason': "Dựa trên bộ số ít xuất hiện"
            }
        return {
            'prediction': 'Tài' if history[-1]['score'] >= 11 else 'Xỉu',
            'confidence': 0.4,
            'reason': "Không phát hiện bộ số đặc biệt"
        }

    def detect_long_streak(self, history: List[Dict]) -> Dict:
        if len(history) < 10:
            return None
        results = ['Tài' if h['score'] >= 11 else 'Xỉu' for h in history]
        streak = 1
        for i in range(len(results)-2, -1, -1):
            if results[i] == results[-1]:
                streak += 1
            else:
                break
        if streak >= 5:
            other = 'Xỉu' if results[-1] == 'Tài' else 'Tài'
            confidence = 0.3 + (streak * 0.05)
            return {
                'prediction': other,
                'confidence': min(confidence, 0.7),
                'reason': f"Cầu {results[-1]} đã {streak} phiên, có khả năng gãy"
            }
        return None

    def analyze_gap(self, history: List[Dict]) -> Dict:
        if len(history) < 3:
            return None
        scores = [h['score'] for h in history]
        gaps = [abs(scores[i] - scores[i-1]) for i in range(1, len(scores))]
        if not gaps:
            return None
        avg_gap = np.mean(gaps)
        last_gap = gaps[-1] if gaps else 0
        if last_gap > avg_gap * 1.5:
            pred = 'Tài' if scores[-1] < 10.5 else 'Xỉu'
            return {
                'prediction': pred,
                'confidence': 0.6,
                'reason': f"Gap lớn {last_gap}, dự đoán hồi phục"
            }
        return None

    def compare_with_history(self, history: List[Dict]) -> Dict:
        if len(history) < 15:
            return None
        recent = history[-5:]
        older = history[-15:-5]
        recent_tai = sum(1 for h in recent if h['score'] >= 11) / 5
        older_tai = sum(1 for h in older if h['score'] >= 11) / 10
        if recent_tai > older_tai * 1.3:
            return {
                'prediction': 'Xỉu',
                'confidence': 0.55,
                'reason': "Tỉ lệ Tài gần đây cao hơn lịch sử"
            }
        elif recent_tai < older_tai * 0.7:
            return {
                'prediction': 'Tài',
                'confidence': 0.55,
                'reason': "Tỉ lệ Tài gần đây thấp hơn lịch sử"
            }
        return None

    def analyze_odd_even(self, history: List[Dict]) -> Dict:
        if len(history) < 5:
            return None
        results = ['Chẵn' if h['score'] % 2 == 0 else 'Lẻ' for h in history]
        recent = results[-5:]
        even_count = recent.count('Chẵn')
        odd_count = recent.count('Lẻ')
        if even_count > odd_count * 2:
            return {
                'prediction': 'Lẻ',
                'confidence': 0.6,
                'reason': "Xu hướng chẵn mạnh, dự đoán lẻ"
            }
        elif odd_count > even_count * 2:
            return {
                'prediction': 'Chẵn',
                'confidence': 0.6,
                'reason': "Xu hướng lẻ mạnh, dự đoán chẵn"
            }
        return None

    def analyze_total_score(self, history: List[Dict]) -> Dict:
        if len(history) < 5:
            return None
        scores = [h['score'] for h in history[-5:]]
        avg_score = np.mean(scores)
        if avg_score > 13:
            return {
                'prediction': 'Xỉu',
                'confidence': 0.55,
                'reason': f"Điểm TB cao ({avg_score:.1f})"
            }
        elif avg_score < 9:
            return {
                'prediction': 'Tài',
                'confidence': 0.55,
                'reason': f"Điểm TB thấp ({avg_score:.1f})"
            }
        return None

    def detect_good_pattern(self, history: List[Dict]) -> Dict:
        if len(history) < 4:
            return None
        results = ['Tài' if h['score'] >= 11 else 'Xỉu' for h in history]
        if len(results) >= 3 and results[-3] != results[-2] and results[-2] != results[-1] and results[-3] == results[-1]:
            return {
                'prediction': results[-1],
                'confidence': 0.8,
                'reason': "Phát hiện cầu 1-2-1 đẹp"
            }
        return None

    def predict_volatility(self, history: List[Dict]) -> Dict:
        if len(history) < 5:
            return None
        scores = [h['score'] for h in history]
        volatility = np.std(scores)
        if volatility > 4.5:
            pred = 'Tài' if scores[-1] < 10.5 else 'Xỉu'
            return {
                'prediction': pred,
                'confidence': 0.6,
                'reason': f"Biến động cao ({volatility:.2f})"
            }
        elif volatility < 2:
            pred = 'Tài' if scores[-1] >= 11 else 'Xỉu'
            return {
                'prediction': pred,
                'confidence': 0.65,
                'reason': f"Biến động thấp ({volatility:.2f})"
            }
        return None

    def compare_patterns(self, history: List[Dict]) -> Dict:
        if len(history) < 6:
            return None
        results = ['Tài' if h['score'] >= 11 else 'Xỉu' for h in history]
        pattern1 = tuple(results[-6:-3])
        pattern2 = tuple(results[-3:])
        if pattern1 == pattern2:
            return {
                'prediction': results[-1],
                'confidence': 0.7,
                'reason': f"Pattern lặp lại: {pattern1} -> {pattern2}"
            }
        return None

    def local_trend(self, history: List[Dict]) -> Dict:
        if len(history) < 4:
            return None
        results = ['Tài' if h['score'] >= 11 else 'Xỉu' for h in history]
        if results[-2] == results[-1]:
            return {
                'prediction': results[-1],
                'confidence': 0.6,
                'reason': f"Xu hướng cục bộ: {results[-2]} -> {results[-1]}"
            }
        return None

    def predict_score_range(self, history: List[Dict]) -> Dict:
        default_return = {
            'predicted_scores': [],
            'probabilities': [],
            'trend': 'unknown',
            'avg_score': 0,
            'recent_avg': 0,
            'confidence': 0
        }
        if len(history) < 10:
            return default_return
        scores = [h['score'] for h in history if isinstance(h.get('score'), (int, float))]
        if len(scores) < 10:
            return default_return
        score_freq = Counter(scores)
        recent_scores = scores[-10:]
        avg_score = np.mean(scores)
        recent_avg = np.mean(recent_scores)
        if recent_avg > avg_score * 1.05:
            trend = 'up'
        elif recent_avg < avg_score * 0.95:
            trend = 'down'
        else:
            trend = 'stable'
        possible_scores = []
        top_scores = [s for s, c in score_freq.most_common(5)]
        possible_scores.extend(top_scores)
        possible_scores.extend(recent_scores[-3:])
        if trend == 'up':
            possible_scores.extend([s + 1 for s in recent_scores[-2:] if s + 1 <= 18])
            possible_scores.extend([s + 2 for s in recent_scores[-1:] if s + 2 <= 18])
        elif trend == 'down':
            possible_scores.extend([s - 1 for s in recent_scores[-2:] if s - 1 >= 3])
            possible_scores.extend([s - 2 for s in recent_scores[-1:] if s - 2 >= 3])
        possible_scores = list(set(possible_scores))
        score_probabilities = {}
        total_prob = 0
        for score in possible_scores:
            prob = 0
            if score in score_freq:
                prob += score_freq[score] / len(scores) * 0.5
            if score in recent_scores:
                prob += 0.3
            if trend == 'up' and score > recent_avg:
                prob += 0.2
            elif trend == 'down' and score < recent_avg:
                prob += 0.2
            elif trend == 'stable' and abs(score - recent_avg) < 2:
                prob += 0.1
            score_probabilities[score] = prob
            total_prob += prob
        if total_prob > 0:
            for score in score_probabilities:
                score_probabilities[score] /= total_prob
        sorted_scores = sorted(score_probabilities.items(), key=lambda x: x[1], reverse=True)
        top_scores = sorted_scores[:4]
        return {
            'predicted_scores': [int(s[0]) for s in top_scores],
            'probabilities': [round(s[1], 3) for s in top_scores],
            'trend': trend,
            'avg_score': round(avg_score, 2),
            'recent_avg': round(recent_avg, 2),
            'confidence': 0.7 if top_scores else 0
        }

    def ensemble_models(self, history: List[Dict]) -> Dict:
        model_results = {}
        for model_name, model_func in self.main_models.items():
            try:
                result = model_func(history)
                if result and result.get('prediction') in ['Tài', 'Xỉu']:
                    model_results[model_name] = result
            except Exception as e:
                logger.error(f"Error in {model_name}: {e}")
        for model_name, model_func in self.sub_models.items():
            try:
                result = model_func(history)
                if result and result.get('prediction') in ['Tài', 'Xỉu', 'Chẵn', 'Lẻ']:
                    model_results[model_name] = result
            except Exception as e:
                logger.error(f"Error in sub_model {model_name}: {e}")
        for model_name, model_func in self.mini_models.items():
            try:
                result = model_func(history)
                if result and result.get('prediction') in ['Tài', 'Xỉu']:
                    model_results[model_name] = result
            except Exception as e:
                logger.error(f"Error in mini_model {model_name}: {e}")

        if not model_results:
            last_result = 'Tài' if history and history[-1].get('score', 0) >= 11 else 'Xỉu' if history else 'Tài'
            return {
                'prediction': last_result,
                'confidence': 0.3,
                'tai_weight': 0,
                'xiu_weight': 0,
                'top_reasons': ['Không có model nào dự đoán'],
                'score_prediction': self.predict_score_range(history),
                'model_count': 0,
                'patterns_found': []
            }

        tai_weight = 0.0
        xiu_weight = 0.0
        details = []
        for model_name, result in model_results.items():
            pred = result['prediction']
            if pred in ['Chẵn', 'Lẻ']:
                last_score = history[-1]['score'] if history else 10
                pred = 'Tài' if last_score >= 11 else 'Xỉu'
            base_weight = self.model_weights.get(model_name, 1.0)
            perf_history = self.performance_history.get(model_name, [])
            if len(perf_history) >= 5:
                recent_acc = np.mean(perf_history[-5:])
                adjusted_conf = result['confidence'] * (0.6 + recent_acc * 0.4)
            else:
                adjusted_conf = result['confidence']
            weight = base_weight * adjusted_conf
            if pred == 'Tài':
                tai_weight += weight
            else:
                xiu_weight += weight
            details.append({
                'model': model_name,
                'pred': pred,
                'conf': result['confidence'],
                'weight': round(weight, 3),
                'reason': result.get('reason', '')
            })

        total = tai_weight + xiu_weight
        if total > 0:
            if tai_weight > xiu_weight:
                final_pred = 'Tài'
                confidence = tai_weight / total
            else:
                final_pred = 'Xỉu'
                confidence = xiu_weight / total
        else:
            final_pred = details[0]['pred'] if details else 'Tài'
            confidence = 0.5

        top_reasons = [f"{d['model']}: {d['reason']}" for d in sorted(details, key=lambda x: x['weight'], reverse=True)[:3]]
        patterns_found = [d['model'] for d in details if d['weight'] > 0.3][:5]

        return {
            'prediction': final_pred,
            'confidence': round(confidence, 3),
            'tai_weight': round(tai_weight, 3),
            'xiu_weight': round(xiu_weight, 3),
            'top_reasons': top_reasons,
            'score_prediction': self.predict_score_range(history),
            'model_count': len(details),
            'patterns_found': patterns_found
        }

    def update_performance(self, model_name, correct):
        if model_name not in self.performance_history:
            self.performance_history[model_name] = []
        self.performance_history[model_name].append(1 if correct else 0)
        if len(self.performance_history[model_name]) > 30:
            self.performance_history[model_name].pop(0)
        if len(self.performance_history[model_name]) >= 10:
            accuracy = np.mean(self.performance_history[model_name][-10:])
            if accuracy > 0.65:
                self.model_weights[model_name] = min(1.6, self.model_weights.get(model_name, 1.0) * 1.05)
            elif accuracy < 0.45:
                self.model_weights[model_name] = max(0.3, self.model_weights.get(model_name, 1.0) * 0.95)

# ==================== FLASK APP ====================
app = Flask(__name__)
CORS(app)

predictors = {}

for game, config in GAME_CONFIGS.items():
    try:
        if game == 'sumclub':
            pred = SicboPredictor(config)
            def sumclub_fetch(self):
                with sumclub_lock:
                    data = list(sumclub_history)
                    data.sort(key=lambda x: x.get('time', 0), reverse=True)
                    return data[:50]
            pred.fetch_history = sumclub_fetch.__get__(pred, SicboPredictor)
            predictors[game] = pred
            logger.info(f"Initialized predictor for {game} (WebSocket)")

        elif game == 'sunlive':
            pred = SicboPredictor(config)
            def sunlive_fetch(self):
                with sunlive_lock:
                    data = list(sunlive_history)
                    data.sort(key=lambda x: x.get('time', 0), reverse=True)
                    return data[:50]
            pred.fetch_history = sunlive_fetch.__get__(pred, SicboPredictor)
            predictors[game] = pred
            logger.info(f"Initialized predictor for {game} (WebSocket)")

        elif game == 'luckywin':
            pred = SicboPredictor(config)
            def luckywin_fetch(self):
                with luckywin_lock:
                    data = list(luckywin_history)
                    data.sort(key=lambda x: x.get('time', 0), reverse=True)
                    return data[:50]
            pred.fetch_history = luckywin_fetch.__get__(pred, SicboPredictor)
            predictors[game] = pred
            logger.info(f"Initialized predictor for {game} (HTTP Polling)")

        else:
            predictors[game] = SicboPredictor(config)
            logger.info(f"Initialized predictor for {game} (REST API)")

    except Exception as e:
        logger.error(f"Failed to initialize {game}: {e}")

# ==================== START THREADS ====================
threading.Thread(target=start_ws_safe_sumclub, daemon=True).start()
threading.Thread(target=start_ws_safe_sunlive, daemon=True).start()
threading.Thread(target=start_polling_luckywin, daemon=True).start()

# ==================== API ROUTES ====================
@app.route('/')
def index():
    return jsonify({
        'success': True,
        'message': 'Unified Sicbo Predictor API (VIP Edition + SSL Fix + 16 Pattern Types)',
        'available_games': list(predictors.keys()),
        'endpoints': {
            '/sicbo/<game>': 'Get prediction for game',
            '/sicbo/<game>/history': 'Get history',
            '/sicbo/<game>/model-weights': 'Get model weights',
            '/sicbo/<game>/stats': 'Get statistics',
            '/sicbo/<game>/health': 'Health check'
        }
    })

@app.route('/sicbo/<game>', methods=['GET'])
def get_prediction(game):
    predictor = predictors.get(game)
    if not predictor:
        return jsonify({'success': False, 'error': 'Game not found'}), 404
    try:
        history = predictor.fetch_history()
        if not history:
            return jsonify({'success': False, 'error': 'No history data'}), 500

        ensemble_result = predictor.ensemble_models(history)
        dice_prediction = predictor.predict_dice(history)

        latest_record = history[0] if history else None
        phien_hien_tai = "#1"
        if latest_record and latest_record.get('gameNum'):
            phien_str = str(latest_record['gameNum']).replace('#', '')
            if phien_str.isdigit():
                phien_number = int(phien_str)
                phien_hien_tai = f"#{phien_number + 1}"
            else:
                phien_hien_tai = f"#{int(time.time())}"
        else:
            phien_hien_tai = f"#{int(time.time())}"

        latest = history[0] if history else {}
        phien = latest.get('gameNum', '')
        ket_qua = 'Tài' if latest.get('score', 0) >= 11 else 'Xỉu' if latest else ''
        xuc_xac = latest.get('faces', [])

        response = {
            'success': True,
            'game': game,
            'phien': phien,
            'ket_qua': ket_qua,
            'xuc_xac': xuc_xac,
            'phien_hien_tai': phien_hien_tai,
            'du_doan': ensemble_result.get('prediction', 'Tài'),
            'do_tin_cay': ensemble_result.get('confidence', 0.5),
            'du_doan_vi': dice_prediction,
            'cac_cau_phat_hien': ensemble_result.get('patterns_found', []),
            'chi_tiet_model': {
                'tai_weight': ensemble_result.get('tai_weight', 0),
                'xiu_weight': ensemble_result.get('xiu_weight', 0),
                'so_model': ensemble_result.get('model_count', 0)
            }
        }
        return jsonify(response)
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/sicbo/<game>/history', methods=['GET'])
def get_history(game):
    predictor = predictors.get(game)
    if not predictor:
        return jsonify({'success': False, 'error': 'Game not found'}), 404
    try:
        history = predictor.fetch_history()
        processed = []
        for h in history:
            processed.append({
                'phien': h.get('gameNum', ''),
                'score': h.get('score', 0),
                'type': 'Tài' if h.get('score', 0) >= 11 else 'Xỉu',
                'faces': h.get('faces', []),
                'time': h.get('time', 0)
            })
        return jsonify({
            'success': True,
            'game': game,
            'data': processed,
            'count': len(processed)
        })
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/sicbo/<game>/model-weights', methods=['GET'])
def get_model_weights(game):
    predictor = predictors.get(game)
    if not predictor:
        return jsonify({'success': False, 'error': 'Game not found'}), 404
    return jsonify({
        'success': True,
        'game': game,
        'main_models': predictor.model_weights,
        'sub_models': {name: predictor.model_weights.get(name, 0.6) for name in predictor.sub_models.keys()},
        'mini_models': {name: predictor.model_weights.get(name, 0.4) for name in predictor.mini_models.keys()},
        'performance_history': {k: list(v) for k, v in predictor.performance_history.items()}
    })

@app.route('/sicbo/<game>/stats', methods=['GET'])
def get_stats(game):
    predictor = predictors.get(game)
    if not predictor:
        return jsonify({'success': False, 'error': 'Game not found'}), 404
    try:
        history = predictor.fetch_history()
        if not history:
            return jsonify({'success': False, 'error': 'No data'}), 500
        results = ['Tài' if h['score'] >= 11 else 'Xỉu' for h in history]
        tai_count = results.count('Tài')
        xiu_count = results.count('Xỉu')
        scores = [h['score'] for h in history if isinstance(h.get('score'), (int, float))]
        stats = {
            'tong_phien': len(history),
            'tai_count': tai_count,
            'xiu_count': xiu_count,
            'ti_le_tai': round(tai_count / len(history) * 100, 2) if history else 0,
            'ti_le_xiu': round(xiu_count / len(history) * 100, 2) if history else 0,
            'diem_trung_binh': round(np.mean(scores), 2) if scores else 0,
            'diem_cao_nhat': max(scores) if scores else 0,
            'diem_thap_nhat': min(scores) if scores else 0,
            'do_lech_chuan': round(np.std(scores), 2) if scores else 0
        }
        return jsonify({'success': True, 'game': game, 'stats': stats})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/sicbo/<game>/health', methods=['GET'])
def health_check(game):
    predictor = predictors.get(game)
    if not predictor:
        return jsonify({'success': False, 'error': 'Game not found'}), 404
    try:
        history = predictor.fetch_history()
        return jsonify({
            'success': True,
            'game': game,
            'status': 'healthy',
            'api_connected': len(history) > 0,
            'data_count': len(history),
            'timestamp': datetime.now().isoformat()
        })
    except Exception as e:
        return jsonify({'success': False, 'game': game, 'status': 'unhealthy', 'error': str(e)}), 500

if __name__ == '__main__':
    print("=" * 60)
    print("🚀 UNIFIED SICBO PREDICTOR API (VIP + SSL FIX + 16 PATTERNS)")
    print("=" * 60)
    print("Available games:", list(predictors.keys()))
    print("Example: http://localhost:5000/sicbo/sumclub")
    print("Example: http://localhost:5000/sicbo/sunlive")
    print("Example: http://localhost:5000/sicbo/luckywin")
    print("=" * 60)
    app.run(debug=True, port=5000, host='0.0.0.0')