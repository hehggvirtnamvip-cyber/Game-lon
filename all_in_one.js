// =================================================================================================
// all_in_one.js - FULL VERSION 100% - KHÔNG RÚT GỌN
// Tích hợp:
//   - full.py       (workers: 68gb, 789club, b52, betvip, hitclub, lc79, luck8, rikvip, sumclub, sunwin)
//   - xocdia88.py   (workers: xocdia88 hu + md5)
//   - sicbo.py      (workers: sicbo sumclub, sunlive, luckywin)
//   - sicbosum.py   (worker: sicbo sum raw + parsed)
//   - lc79cbm.js    (predictor nâng cao cho lc79 hu + md5)
//   - 11 file JSON  (book + anti + pred_log + model_stats đã học sẵn)
// Tác giả gộp: @tranhoang2286
// =================================================================================================

'use strict';

// ========================== IMPORTS ==========================
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const http = require('http');
const https = require('https');
const crypto = require('crypto');

// ========================== CẤU HÌNH ==========================
const PORT = process.env.PORT || 8080;
const MAX_HISTORY = 100;
const LOG_PREFIX = () => `[${new Date().toISOString()}]`;
const log = (msg) => console.log(`${LOG_PREFIX()} ${msg}`);
const logError = (msg, err) => console.error(`${LOG_PREFIX()} [ERROR] ${msg}`, err || '');

// ========================== DỮ LIỆU TỪ full.py ==========================
const GAME_STATUS = {
    "68gb": true, "789club": true, "b52": true, "betvip": true,
    "hitclub": true, "lc79": true, "luck8": true, "rikvip": true,
    "sumclub": true, "sunwin": true
};

const DATA_STORE = {
    "68gb": { "hu": [], "md5": [] },
    "789club": { "live": [], "minigame": [] },
    "b52": { "hu": [], "md5": [] },
    "betvip": { "hu": [], "md5": [] },
    "hitclub": { "hu": [], "md5": [] },
    "lc79": { "hu": [], "md5": [] },
    "luck8": { "txhu": [], "txmd5": [], "tx3p": [] },
    "rikvip": { "hu": [], "md5": [] },
    "sumclub": { "hu": [], "md5": [] },
    "sunwin": { "main": [] }
};

// ========================== DỮ LIỆU TỪ xocdia88.py ==========================
const API_URL_XOCDIA88_HU = "https://taixiu.system32-cloudfare-356783752985678522.monster/api/luckydice/GetSoiCau";
const API_URL_XOCDIA88_MD5 = "https://taixiumd5.system32-cloudfare-356783752985678522.monster/api/md5luckydice/GetSoiCau";
const xocdia88_history_hu = [];
const xocdia88_history_md5 = [];

// ========================== DỮ LIỆU TỪ sicbo.py ==========================
const SICBO_GAME_CONFIGS = {
    '789club': { 'base_url': 'https://api.xeuigogo.info/v2/history/getLastResult', 'gameId': 'ktrng_3986', 'tableId': '39861215743193', 'size': 100 },
    'b52': { 'base_url': 'https://api.wsmt8g.cc/v2/history/getLastResult', 'gameId': 'ktrng_3996', 'tableId': '39961215743193', 'size': 100 },
    'hitclub': { 'base_url': 'https://api.wsmt8g.cc/v2/history/getLastResult', 'gameId': 'ktrng_3932', 'tableId': '39321215743193', 'size': 100 },
    'rikvip': { 'base_url': 'https://api.wsmt8g.cc/v2/history/getLastResult', 'gameId': 'ktrng_3980', 'tableId': '39801215743193', 'size': 100 },
    'sunwin': { 'base_url': 'https://api.wsktnus8.net/v2/history/getLastResult', 'gameId': 'ktrng_3979', 'tableId': '39791215743193', 'size': 100 },
    'sumclub': { 'base_url': null, 'gameId': null, 'tableId': null, 'size': 100 },
    'sunlive': { 'base_url': null, 'gameId': null, 'tableId': null, 'size': 100 },
    'luckywin': { 'base_url': 'https://luck8bot.com/api/GetNewLottery/Sicbo50', 'gameId': 'Sicbo50', 'tableId': null, 'size': 100, 'poll_interval': 2 }
};

const MAX_SUMCLUB_HISTORY = 100;
const MAX_SUNLIVE_HISTORY = 100;
const MAX_LUCKYWIN_HISTORY = 100;

const sumclub_history = [];
const sumclub_session_seen = new Set();
const sunlive_history = [];
const sunlive_session_seen = new Set();
const luckywin_history = [];
const luckywin_id_seen = new Set();

// ========================== DỮ LIỆU TỪ sicbosum.py ==========================
const SICBOSUM_SERVER = {
    "name": "SICBO",
    "base": "https://sicbo.apisum.pro",
    "hub": "sicboHub",
    "tid": 22
};
const SICBOSUM_HEADERS = { "User-Agent": "Mozilla/5.0", "Origin": "https://play.sum.vin" };
const sicbosum_RAW_DATA = [];
const sicbosum_PARSED_DATA = [];
const sicbosum_SESSION_SEEN = new Set();

// ========================== DỮ LIỆU TỪ lc79cbm.js ==========================
const LC79_API_URL_HU = 'https://wtx.tele68.com/v1/tx/sessions';
const LC79_API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';
const LC79_LEARNING_FILE = 'tranhoang2286.json';
const LC79_HISTORY_FILE = 'tranhoang2286.json';
const LC79_MAX_HISTORY = 100;
const LC79_AUTO_SAVE_INTERVAL = 30000;

let lc79_predictionHistory = { hu: [], md5: [] };
let lc79_lastProcessedPhien = { hu: null, md5: null };

let lc79_learningData = {
    hu: { predictions: [], patternStats: {}, totalPredictions: 0, correctPredictions: 0, patternWeights: {}, lastUpdate: null, streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 }, adaptiveThresholds: {}, recentAccuracy: [] },
    md5: { predictions: [], patternStats: {}, totalPredictions: 0, correctPredictions: 0, patternWeights: {}, lastUpdate: null, streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 }, adaptiveThresholds: {}, recentAccuracy: [] }
};

const LC79_DEFAULT_PATTERN_WEIGHTS = {
    'cau_bet': 1.0, 'cau_dao_11': 1.0, 'cau_22': 1.0, 'cau_33': 1.0, 'cau_121': 1.0, 'cau_123': 1.0,
    'cau_321': 1.0, 'cau_nhay_coc': 1.0, 'cau_nhip_nghieng': 1.0, 'cau_3van1': 1.0, 'cau_be_cau': 1.0,
    'cau_chu_ky': 1.0, 'distribution': 1.0, 'dice_pattern': 1.0, 'sum_trend': 1.0, 'edge_cases': 1.0,
    'momentum': 1.0, 'cau_tu_nhien': 1.0, 'dice_trend_line': 1.0, 'dice_trend_line_md5': 1.0,
    'break_pattern_hu': 1.0, 'break_pattern_md5': 1.0, 'fibonacci': 1.0, 'resistance_support': 1.0,
    'wave': 1.0, 'golden_ratio': 1.0, 'day_gay': 1.0, 'day_gay_md5': 1.0, 'cau_44': 1.0, 'cau_55': 1.0,
    'cau_212': 1.0, 'cau_1221': 1.0, 'cau_2112': 1.0, 'cau_gap': 1.0, 'cau_ziczac': 1.0, 'cau_doi': 1.0,
    'cau_rong': 1.0, 'smart_bet': 1.0, 'break_pattern_advanced': 1.0, 'break_streak': 1.0,
    'alternating_break': 1.0, 'double_pair_break': 1.0, 'triple_pattern': 1.0, 'tong_phan_tich': 1.5,
    'xu_huong_manh': 1.3, 'dao_chieu': 1.4
};

// ========================== DỮ LIỆU JSON PREDICTOR ==========================
// Mỗi key là "game_table", value là state (history + book + anti + pred_log + model_stats)
const JSON_PREDICTOR_STATE = {};

const JSON_FILE_MAP = {
    'b52_hu': { file: 'b52_hu.json', game: 'b52', table: 'hu', src: 'full_py' },
    'b52_md5': { file: 'b52_md5.json', game: 'b52', table: 'md5', src: 'full_py' },
    'hitclub_hu': { file: 'hitclub_hu.json', game: 'hitclub', table: 'hu', src: 'full_py' },
    'hitclub_md5': { file: 'hitclub_md5.json', game: 'hitclub', table: 'md5', src: 'full_py' },
    'rikvip_hu': { file: 'rikvip_hu.json', game: 'rikvip', table: 'hu', src: 'full_py' },
    'betvip_hu': { file: 'betvip_hu.json', game: 'betvip', table: 'hu', src: 'full_py' },
    'betvip_md5': { file: 'betvip_md5.json', game: 'betvip', table: 'md5', src: 'full_py' },
    'lc79_hu': { file: 'lc79_hu.json', game: 'lc79', table: 'hu', src: 'full_py' },
    'lc79_md5': { file: 'lc79_md5.json', game: 'lc79', table: 'md5', src: 'full_py' },
    'sumclub_hu': { file: 'sicbo_sumclub.json', game: 'sumclub', table: 'hu', src: 'sicbo' },
    'luckywin_main': { file: 'sicbo_luckywin.json', game: 'luckywin', table: 'main', src: 'sicbo' }
};

log("Đã khởi tạo cấu hình và biến toàn cục (PHẦN 1/8).");// =================================================================================================
// HÀM HỖ TRỢ CHUNG
// =================================================================================================
function get_tai_xiu(d1, d2, d3) {
    return (d1 + d2 + d3) <= 10 ? "Xỉu" : "Tài";
}

function add_record(game, table, record) {
    if (!DATA_STORE[game] || !DATA_STORE[game][table]) return;
    const arr = DATA_STORE[game][table];
    const idx = arr.findIndex(item => item.phien === record.phien);
    if (idx !== -1) arr[idx] = record;
    else arr.unshift(record);
    if (arr.length > MAX_HISTORY) arr.pop();
}

// =================================================================================================
// WORKERS TỪ full.py
// =================================================================================================

// ---------- Geightdors (B52, HitClub, Rikvip) ----------
function worker_geightdors(game_id, platform_id, table, gid, is_md5) {
    const url = `https://jakpotgwab.geightdors.net/glms/v1/notify/taixiu?platform_id=${platform_id}&gid=${gid}`;
    let last_sid = null;
    let sid_for_tx = null;
    const poll = async () => {
        if (!GAME_STATUS[game_id]) { setTimeout(poll, 2000); return; }
        try {
            const res = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 5000 });
            const data = res.data;
            if (data && data.status === 'OK' && Array.isArray(data.data)) {
                if (!is_md5) {
                    for (const g of data.data) {
                        if (g.cmd === 1008) sid_for_tx = g.sid;
                    }
                }
                for (const g of data.data) {
                    if (is_md5 && g.cmd === 2006) {
                        const sid = g.sid, d1 = g.d1, d2 = g.d2, d3 = g.d3;
                        if (sid && sid !== last_sid && d1 != null && d2 != null && d3 != null) {
                            last_sid = sid;
                            add_record(game_id, table, {
                                phien: sid, xuc_xac: [d1, d2, d3],
                                tong: d1 + d2 + d3, ket_qua: get_tai_xiu(d1, d2, d3)
                            });
                        }
                    } else if (!is_md5 && g.cmd === 1003) {
                        const d1 = g.d1, d2 = g.d2, d3 = g.d3;
                        if (sid_for_tx && sid_for_tx !== last_sid && d1 != null && d2 != null && d3 != null) {
                            last_sid = sid_for_tx;
                            add_record(game_id, table, {
                                phien: last_sid, xuc_xac: [d1, d2, d3],
                                tong: d1 + d2 + d3, ket_qua: get_tai_xiu(d1, d2, d3)
                            });
                            sid_for_tx = null;
                        }
                    }
                }
            }
        } catch (e) { /* silent */ }
        setTimeout(poll, 3000);
    };
    poll();
}

// ---------- WTX (BetVIP, LC79) ----------
function worker_wtx(game_id, table, url) {
    let last_sid = null;
    const poll = async () => {
        if (!GAME_STATUS[game_id]) { setTimeout(poll, 2000); return; }
        try {
            const res = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 5000 });
            const data = res.data;
            if (data && data.list && data.list.length > 0) {
                const s = data.list[0];
                const sid = s.id, dices = s.dices || [];
                if (sid && sid !== last_sid && dices.length === 3) {
                    last_sid = sid;
                    const tong = dices.reduce((a, b) => a + b, 0);
                    add_record(game_id, table, {
                        phien: sid, xuc_xac: dices,
                        tong: tong, ket_qua: get_tai_xiu(dices[0], dices[1], dices[2])
                    });
                }
            }
        } catch (e) { /* silent */ }
        setTimeout(poll, 3000);
    };
    poll();
}

// ---------- 68GB ----------
function worker_68gb(table, api_url) {
    let last_sid = null;
    const poll = async () => {
        if (!GAME_STATUS["68gb"]) { setTimeout(poll, 2000); return; }
        try {
            const res = await axios.get(api_url, { headers: { "User-Agent": "Mozilla/5.0" }, timeout: 5000 });
            const r = res.data;
            const sid = r.Phien;
            if (sid && sid !== last_sid) {
                last_sid = sid;
                const dices = [r.Xuc_xac_1, r.Xuc_xac_2, r.Xuc_xac_3];
                add_record("68gb", table, {
                    phien: sid, xuc_xac: dices,
                    tong: dices.reduce((a, b) => a + b, 0),
                    ket_qua: get_tai_xiu(dices[0], dices[1], dices[2])
                });
            }
        } catch (e) { /* silent */ }
        setTimeout(poll, 2000);
    };
    poll();
}

// ---------- Luck8 ----------
function worker_luck8(table, api_url) {
    let last_sid = null;
    const poll = async () => {
        if (!GAME_STATUS["luck8"]) { setTimeout(poll, 2000); return; }
        try {
            const res = await axios.get(api_url, { headers: { "User-Agent": "Mozilla/5.0" }, timeout: 5000 });
            const r = res.data;
            if (r && r.state === 1 && r.data) {
                const data = r.data;
                const sid = data.ID;
                const open_code = data.OpenCode || '';
                const codes = open_code.split(',');
                if (sid && sid !== last_sid && codes.length === 3) {
                    last_sid = sid;
                    const dices = codes.map(Number);
                    add_record("luck8", table, {
                        phien: sid, xuc_xac: dices,
                        tong: dices.reduce((a, b) => a + b, 0),
                        ket_qua: get_tai_xiu(dices[0], dices[1], dices[2])
                    });
                }
            }
        } catch (e) { /* silent */ }
        setTimeout(poll, 2000);
    };
    poll();
}

// ---------- 789Club Live ----------
function worker_789club_live() {
    const ws_url = "wss://ws-taixiu-ls.atpman.net/websocket";
    let ws;
    const connect = () => {
        if (!GAME_STATUS["789club"]) { setTimeout(connect, 2000); return; }
        try {
            ws = new WebSocket(ws_url);
            ws.on('open', () => log('789club Live WS connected'));
            ws.on('message', (msg) => {
                try {
                    const data = JSON.parse(msg);
                    if (Array.isArray(data) && data.length >= 2 && data[0] === 5) {
                        const gd = data[1];
                        if (gd.sessionId && (gd.resultRaw || gd.aM)) {
                            const sid = gd.sessionId;
                            const ds = String(gd.resultRaw || gd.aM);
                            if (ds.length === 3 && /^\d+$/.test(ds)) {
                                const dices = [parseInt(ds[0]), parseInt(ds[1]), parseInt(ds[2])];
                                add_record("789club", "live", {
                                    phien: sid, xuc_xac: dices,
                                    tong: dices.reduce((a, b) => a + b, 0),
                                    ket_qua: get_tai_xiu(dices[0], dices[1], dices[2])
                                });
                            }
                        }
                    }
                } catch (e) { /* silent */ }
            });
            ws.on('close', () => { log('789club Live WS disconnected'); setTimeout(connect, 5000); });
            ws.on('error', (err) => { logError('789club Live WS:', err.message); ws.close(); });
        } catch (e) { logError('789club Live WS crash:', e.message); setTimeout(connect, 5000); }
    };
    connect();
}

// ---------- 789Club MiniGame ----------
function worker_789club_minigame() {
    const WS_URL = "wss://websocket.atpman.net/websocket";
    const HEADERS = { "Origin": "https://play.789club.wien", "User-Agent": "Mozilla/5.0" };
    const LOGIN_MSG = [
        1, "MiniGame", "wanglin2019aaand", "WamgLin2091",
        {
            "info": JSON.stringify({
                "ipAddress": "113.185.45.88",
                "wsToken": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJnZW5kZXIiOjAsImNhblZpZXdTdGF0IjpmYWxzZSwiZGlzcGxheU5hbWUiOiJlbXlldTE3ODljbHVuIiwiYm90IjowLCJpc01lcmNoYW50IjpmYWxzZSwidmVyaWZpZWRCYW5rQWNjb3VudCI6ZmFsc2UsInBsYXlFdmVudExvYmJ5IjpmYWxzZSwiY3VzdG9tZXJJZCI6NjU3NjU3NjksImFmZklkIjoiNzg5IiwiYmFubmVkIjpmYWxzZSwiYnJhbmQiOiI3ODkuY2x1YiIsInRpbWVzdGFtcCI6MTc2NjQ3MDk1NTY4OCwibG9ja0dhbWVzIjpbXSwiYW1vdW50IjowLCJsb2NrQ2hhdCI6ZmFsc2UsInBob25lVmVyaWZpZWQiOmZhbHNlLCJpcEFkZHJlc3MiOiIxMTMuMTg1LjQ1Ljg4IiwibXV0ZSI6ZmFsc2UsImF2YXRhciI6Imh0dHBzOi8vYXBpLnhldWkuaW8vaW1hZ2VzL2F2YXRhci9hdmF0YXJfMjUucG5nIiwicGxhdGZvcm1JZCI6NSwidXNlcklkIjoiMjFkMTUxMjEtYjIzOC00ZDIyLTgzMTMtNGI3YjYwN2VhZjIxIiwicmVnVGltZSI6MTc2NjQ3MDkzMDEwNCwicGhvbmUiOiIiLCJkZXBvc2l0IjpmYWxzZSwidXNlcm5hbWUiOiJTOF93YW5nbGluMjAxOWFhYW5kIn0.F5jr6g1BPGMQ-5EPRdck-PDvVDXcahyGySOFSjyNEuE",
                "locale": "vi",
                "userId": "21d15121-b238-4d22-8313-4b7b607eaf21",
                "username": "S8_wanglin2019aaand",
                "timestamp": 1766470955689,
                "refreshToken": "34ed90232de44567aec7d4752b021717.e8cd9e15f74c42fb8bd491e395d73ab1"
            }),
            "signature": "55A3202A0554F20C01D09CD018386265C93B292E843BE3722766912A8F01ACF50E9574D88D52FAFDABEBD4794D3306C87021EF3DD6B25DA102872D23C7C31A0F1D3EB99C0714968A64F6C40335726EB999F1CEAE49BC0954EABA48189E1BBE61BD40C898CA4D683DA76E24386F4431772D05BC8142DAEBFA90E27A9C250A5ED3"
        }
    ];
    const SUBSCRIBE_TX = [6, "MiniGame", "taixiuCommonPlugin", { "cmd": 2100 }];
    const SUBSCRIBE_LOBBY = [6, "MiniGame", "lobbyPlugin", { "cmd": 10001 }];
    let ws;
    const connect = () => {
        if (!GAME_STATUS["789club"]) { setTimeout(connect, 2000); return; }
        try {
            ws = new WebSocket(WS_URL, { headers: HEADERS });
            ws.on('open', () => {
                log('789club MiniGame WS connected');
                ws.send(JSON.stringify(LOGIN_MSG));
                setTimeout(() => {
                    ws.send(JSON.stringify(SUBSCRIBE_TX));
                    ws.send(JSON.stringify(SUBSCRIBE_LOBBY));
                }, 1000);
                const ka = setInterval(() => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send("2");
                        ws.send(JSON.stringify(SUBSCRIBE_TX));
                    } else clearInterval(ka);
                }, 10000);
            });
            ws.on('message', (msg) => {
                try {
                    const data = JSON.parse(msg);
                    if (Array.isArray(data) && data.length >= 2 && typeof data[1] === 'object') {
                        if (data[1].cmd === 2106) {
                            const sid = data[1].sid, d1 = data[1].d1, d2 = data[1].d2, d3 = data[1].d3;
                            if (sid && d1 && d2 && d3) {
                                add_record("789club", "minigame", {
                                    phien: sid, xuc_xac: [d1, d2, d3],
                                    tong: d1 + d2 + d3, ket_qua: get_tai_xiu(d1, d2, d3)
                                });
                            }
                        }
                    }
                } catch (e) { /* silent */ }
            });
            ws.on('close', () => { log('789club MiniGame WS disconnected'); setTimeout(connect, 5000); });
            ws.on('error', (err) => { logError('789club MiniGame WS:', err.message); ws.close(); });
        } catch (e) { logError('789club MiniGame WS crash:', e.message); setTimeout(connect, 5000); }
    };
    connect();
}

// ---------- Sunwin ----------
function worker_sunwin() {
    const WS_URL = "wss://websocket.azhkthg1.net/websocket?token=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJhbW91bnQiOjAsInVzZXJuYW1lIjoiU0NfYXBpc3Vud2luMTIzIn0.hgrRbSV6vnBwJMg9ZFtbx3rRu9mX_hZMZ_m5gMNhkw0";
    const HEADERS = { "Origin": "https://play.sun.win" };
    const INIT_MSGS = [
        [1, "MiniGame", "GM_apivopnhaan", "WangLin",
            {
                "info": JSON.stringify({
                    "ipAddress": "113.185.45.88",
                    "wsToken": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJnZW5kZXIiOjAsImNhblZpZXdTdGF0IjpmYWxzZSwiZGlzcGxheU5hbWUiOiJwbGFtYW1hIiwiYm90IjowLCJpc01lcmNoYW50IjpmYWxzZSwidmVyaWZpZWRCYW5rQWNjb3VudCI6ZmFsc2UsInBsYXlFdmVudExvYmJ5IjpmYWxzZSwiY3VzdG9tZXJJZCI6MzMxNDgxMTYyLCJhZmZJZCI6IkdFTVdJTiIsImJhbm5lZCI6ZmFsc2UsImJyYW5kIjoiZ2VtIiwidGltZXN0YW1wIjoxNzY2NDc0NzgwMDA2LCJsb2NrR2FtZXMiOltdLCJhbW91bnQiOjAsImxvY2tDaGF0IjpmYWxzZSwicGhvbmVWZXJpZmllZCI6ZmFsc2UsImlwQWRkcmVzcyI6IjExMy4xODUuNDUuODgiLCJtdXRlIjpmYWxzZSwiYXZhdGFyIjoiaHR0cHM6Ly9pbWFnZXMuc3dpbnNob3AubmV0L2ltYWdlcy9hdmF0YXIvYXZhdGFyXzE4LnBuZyIsInBsYXRmb3JtSWQiOjUsInVzZXJJZCI6IjZhOGI0ZDM4LTFlYzEtNDUxYi1hYTA1LWYyZDkwYWFhNGM1MCIsInJlZ1RpbWUiOjE3NjY0NzQ3NTEzOTEsInBob25lIjoiIiwiZGVwb3NpdCI6ZmFsc2UsInVzZXJuYW1lIjoiR01fYXBpdm9wbmhhYW4ifQ.YFOscbeojWNlRo7490BtlzkDGYmwVpnlgOoh04oCJy4",
                    "locale": "vi",
                    "userId": "6a8b4d38-1ec1-451b-aa05-f2d90aaa4c50",
                    "username": "GM_apivopnhaan",
                    "timestamp": 1766474780007,
                    "refreshToken": "63d5c9be0c494b74b53ba150d69039fd.7592f06d63974473b4aaa1ea849b2940"
                }),
                "signature": "66772A1641AA8B18BD99207CE448EA00ECA6D8A4D457C1FF13AB092C22C8DECF0C0014971639A0FBA9984701A91FCCBE3056ABC1BE1541D1C198AA18AF3C45595AF6601F8B048947ADF8F48A9E3E074162F9BA3E6C0F7543D38BD54FD4C0A2C56D19716CC5353BBC73D12C3A92F78C833F4EFFDC4AB99E55C77AD2CDFA91E296"
            }
        ],
        [6, "MiniGame", "taixiuPlugin", { "cmd": 1005 }],
        [6, "MiniGame", "lobbyPlugin", { "cmd": 10001 }]
    ];
    let ws, current_sid = null;
    const connect = () => {
        if (!GAME_STATUS["sunwin"]) { setTimeout(connect, 2000); return; }
        try {
            ws = new WebSocket(WS_URL, { headers: HEADERS });
            ws.on('open', async () => {
                log('Sunwin WS connected');
                for (const m of INIT_MSGS) {
                    ws.send(JSON.stringify(m));
                    await new Promise(r => setTimeout(r, 600));
                }
            });
            ws.on('message', (msg) => {
                try {
                    const data = JSON.parse(msg);
                    if (!Array.isArray(data)) return;
                    let cmd = null, payload = null;
                    if (data.length > 1 && typeof data[1] === 'object') { payload = data[1]; cmd = payload.cmd; }
                    else if (data.length > 2 && typeof data[2] === 'object') { payload = data[2]; cmd = payload.cmd; }
                    if (cmd === 1008) { if (payload && payload.sid) current_sid = payload.sid; }
                    else if (cmd === 1003) {
                        if (payload) {
                            const d1 = payload.d1, d2 = payload.d2, d3 = payload.d3;
                            if (d1 != null && d2 != null && d3 != null) {
                                const sid_use = current_sid || payload.sid;
                                add_record("sunwin", "main", {
                                    phien: sid_use, xuc_xac: [d1, d2, d3],
                                    tong: d1 + d2 + d3, ket_qua: get_tai_xiu(d1, d2, d3)
                                });
                                current_sid = null;
                            }
                        }
                    }
                } catch (e) { /* silent */ }
            });
            ws.on('close', () => { log('Sunwin WS disconnected'); setTimeout(connect, 3000); });
            ws.on('error', (err) => { logError('Sunwin WS:', err.message); ws.close(); });
        } catch (e) { logError('Sunwin WS crash:', e.message); setTimeout(connect, 3000); }
    };
    connect();
}

// ---------- Sumclub (SignalR) ----------
function worker_sumclub() {
    const SERVERS = [
        { base: "https://taixiu.apisum.pro", hub: "luckydiceHub", tid: 1, table: "hu" },
        { base: "https://taixiu1.apisum.pro", hub: "luckydice1Hub", tid: 2, table: "md5" }
    ];
    const HEADERS = { "User-Agent": "Mozilla/5.0", "Origin": "https://play.sum.vin" };
    SERVERS.forEach(sv => {
        const connect = async () => {
            if (!GAME_STATUS["sumclub"]) { setTimeout(connect, 2000); return; }
            try {
                const negUrl = `${sv.base}/signalr/negotiate?clientProtocol=1.5`;
                const negRes = await axios.get(negUrl, { headers: HEADERS });
                const token = negRes.data.ConnectionToken;
                if (!token) { setTimeout(connect, 3000); return; }
                const wsUrl = `${sv.base.replace('https', 'wss')}/signalr/connect?transport=webSockets&connectionToken=${encodeURIComponent(token)}&connectionData=${encodeURIComponent(JSON.stringify([{ name: sv.hub }]))}&clientProtocol=1.5&tid=${sv.tid}`;
                const ws = new WebSocket(wsUrl, { headers: HEADERS });
                ws.on('open', () => {
                    log(`Sumclub ${sv.table} WS connected`);
                    ws.send(JSON.stringify([1, "MiniGame", "GM_apivopnha", "tiendat", { info: "{}", signature: "" }]));
                    ws.send(JSON.stringify([6, "MiniGame", "taixiuPlugin", { cmd: 1005 }]));
                });
                ws.on('message', (msg) => {
                    try {
                        const data = JSON.parse(msg);
                        for (const m of data.M || []) {
                            if (m.M === "sessionInfo" && m.A) {
                                const res = m.A[0].Result || {};
                                const d1 = res.Dice1 || 0, d2 = res.Dice2 || 0, d3 = res.Dice3 || 0;
                                if (d1 > 0 && d2 > 0 && d3 > 0) {
                                    const sid = m.A[0].SessionID;
                                    add_record("sumclub", sv.table, {
                                        phien: sid, xuc_xac: [d1, d2, d3],
                                        tong: d1 + d2 + d3, ket_qua: get_tai_xiu(d1, d2, d3)
                                    });
                                }
                            }
                        }
                    } catch (e) { /* silent */ }
                });
                ws.on('close', () => { log(`Sumclub ${sv.table} WS disconn`); setTimeout(connect, 3000); });
                ws.on('error', (err) => { logError(`Sumclub ${sv.table} WS:`, err.message); ws.close(); });
            } catch (e) { logError(`Sumclub ${sv.table} conn:`, e.message); setTimeout(connect, 3000); }
        };
        connect();
    });
}

function start_all_full_py_workers() {
    log("Starting all workers from full.py...");
    worker_geightdors("b52", "b5", "hu", "vgmn_100", false);
    worker_geightdors("b52", "b5", "md5", "vgmn_101", true);
    worker_geightdors("hitclub", "g8", "hu", "vgmn_100", false);
    worker_geightdors("hitclub", "g8", "md5", "vgmn_101", true);
    worker_geightdors("rikvip", "rik", "hu", "vgmn_100", false);
    worker_geightdors("rikvip", "rik", "md5", "vgmn_101", true);
    worker_wtx("betvip", "hu", "https://wtx.macminim6.online/v1/tx/sessions");
    worker_wtx("betvip", "md5", "https://wtxmd52.macminim6.online/v1/txmd5/sessions");
    worker_wtx("lc79", "hu", "https://wtx.tele68.com/v1/tx/sessions");
    worker_wtx("lc79", "md5", "https://wtxmd52.tele68.com/v1/txmd5/sessions");
    worker_68gb("hu", "http://160.250.5.186:3201/api/68/xanh");
    worker_68gb("md5", "http://160.250.5.186:3050/api/68/md5");
    worker_luck8("txhu", "https://luck8bot.com/api/GetNewLottery/Taixiu");
    worker_luck8("txmd5", "https://luck8bot.com/api/GetNewLottery/TaixiuMd5");
    worker_luck8("tx3p", "https://luck8bot.com/api/GetNewLottery/TaixiuMd3");
    worker_789club_live();
    worker_789club_minigame();
    worker_sunwin();
    worker_sumclub();
    log("All full.py workers started.");
}

log("Đã định nghĩa xong tất cả worker từ full.py (PHẦN 2/8).");// =================================================================================================
// WORKERS TỪ xocdia88.py
// =================================================================================================
function xocdia88_poll_api(url, history_store, table_name) {
    const poll = async () => {
        try {
            const res = await axios.get(url, { headers: { 'User-Agent': 'Python-Proxy/1.0' }, timeout: 10000 });
            const data = res.data;
            if (Array.isArray(data) && data.length > 0) {
                const new_hist = [];
                for (const item of data.slice(0, MAX_HISTORY)) {
                    const sid = item.SessionId;
                    if (sid == null) continue;
                    const d1 = item.FirstDice || 0, d2 = item.SecondDice || 0, d3 = item.ThirdDice || 0;
                    const total = item.DiceSum || 0;
                    const kq = total >= 11 ? "Tài" : "Xỉu";
                    new_hist.push({
                        phien: sid, xuc_xac: [d1, d2, d3], tong: total,
                        ket_qua: kq, created_date: item.CreatedDate || ""
                    });
                }
                history_store.length = 0;
                history_store.push(...new_hist);
            }
        } catch (e) {
            logError(`xocdia88 ${table_name} poll:`, e.message);
            await new Promise(r => setTimeout(r, 5000));
        }
        setTimeout(poll, 5000);
    };
    poll();
}

function start_xocdia88_workers() {
    log("Starting workers from xocdia88.py...");
    xocdia88_poll_api(API_URL_XOCDIA88_HU, xocdia88_history_hu, "HU");
    xocdia88_poll_api(API_URL_XOCDIA88_MD5, xocdia88_history_md5, "MD5");
    log("xocdia88.py workers started.");
}

// =================================================================================================
// WORKERS TỪ sicbo.py
// =================================================================================================
const SICBO_SUMCLUB_SERVER = { name: "SICBO", base: "https://sicbo.apisum.pro", hub: "sicboHub", tid: 22 };
const SICBO_SUMCLUB_HEADERS = { "User-Agent": "Mozilla/5.0", "Origin": "https://play.sum.vin" };

function sicbo_parse_sumclub_message(message) {
    if (message === "{}" || message === '{"type":6}') return;
    try {
        const data = JSON.parse(message);
        if (!data.M) return;
        for (const m of data.M) {
            const args = m.A || [];
            if (!args.length) continue;
            const obj = args[0];
            if (typeof obj !== 'object' || obj === null) continue;
            if (!obj.Result) continue;
            const dice = obj.Result;
            const d1 = dice.Dice1 ?? -1, d2 = dice.Dice2 ?? -1, d3 = dice.Dice3 ?? -1;
            if (d1 === -1) continue;
            const session = obj.SessionID;
            if (!session) continue;
            if (sumclub_session_seen.has(session)) return;
            const tong = d1 + d2 + d3;
            const new_record = {
                gameNum: String(session), score: tong, faces: [d1, d2, d3],
                resultType: tong >= 11 ? 1 : 0, time: Math.floor(Date.now() / 1000)
            };
            sumclub_session_seen.add(session);
            sumclub_history.push(new_record);
            if (sumclub_history.length > MAX_SUMCLUB_HISTORY) {
                const old = sumclub_history.shift();
                sumclub_session_seen.delete(old.gameNum);
            }
        }
    } catch (e) { /* silent */ }
}

function start_sicbo_sumclub_ws() {
    const connect = async () => {
        try {
            const negUrl = `${SICBO_SUMCLUB_SERVER.base}/signalr/negotiate?clientProtocol=1.5`;
            const negRes = await axios.get(negUrl, { headers: SICBO_SUMCLUB_HEADERS });
            const token = negRes.data.ConnectionToken;
            if (!token) { setTimeout(connect, 2000); return; }
            const wsUrl = `${SICBO_SUMCLUB_SERVER.base.replace('https', 'wss')}/signalr/connect?transport=webSockets&connectionToken=${encodeURIComponent(token)}&connectionData=${encodeURIComponent(JSON.stringify([{ name: SICBO_SUMCLUB_SERVER.hub }]))}&clientProtocol=1.5&tid=${SICBO_SUMCLUB_SERVER.tid}`;
            const ws = new WebSocket(wsUrl, { headers: SICBO_SUMCLUB_HEADERS });
            ws.on('open', () => {
                log('Sicbo Sumclub WS connected');
                const ping = setInterval(() => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ M: "PingPong", H: SICBO_SUMCLUB_SERVER.hub, I: Date.now() }));
                        ws.send('{"type":6}');
                    } else clearInterval(ping);
                }, 5000);
            });
            ws.on('message', (msg) => sicbo_parse_sumclub_message(msg));
            ws.on('close', () => { log('Sicbo Sumclub WS disconn'); setTimeout(connect, 2000); });
            ws.on('error', (err) => { logError('Sicbo Sumclub WS:', err.message); ws.close(); });
        } catch (e) { logError('Sicbo Sumclub conn:', e.message); setTimeout(connect, 2000); }
    };
    connect();
}

const SICBO_SUNLIVE_WS_URL = "wss://livecasino.azhkthg1.com/websocket?token=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJnZW5kZXIiOjAsImNhblZpZXdTdGF0IjpmYWxzZSwiZGlzcGxheU5hbWUiOiJzdW53aW50aGFjaG9lbTEiLCJib3QiOjAsImlzTWVyY2hhbnQiOmZhbHNlLCJ2ZXJpZmllZEJhbmtBY2NvdW50Ijp0cnVlLCJwbGF5RXZlbnRMb2JieSI6ZmFsc2UsImN1c3RvbWVySWQiOjEzMDA1NTkwMCwiYWZmSWQiOiJzdW53aW4iLCJiYW5uZWQiOmZhbHNlLCJicmFuZCI6InN1bi53aW4iLCJ0aW1lc3RhbXAiOjE3NTU5NzA4NDU0NzIsImxvY2tHYW1lcyI6W10sImFtb3VudCI6MCwibG9ja0NoYXQiOmZhbHNlLCJwaG9uZVZlcmlmaWVkIjpmYWxzZSwiaXBBZGRyZXNzIjoiMjAwMTplZTA6NTE0ODpmZTQwOjRkZWQ6MWVkMDphZjA5OmU1MGIiLCJtdXRlIjpmYWxzZSwiYXZhdGFyIjoiaHR0cHM6Ly9pbWFnZXMuc3dpbnNob3AubmV0L2ltYWdlcy9hdmF0YXIvYXZhdGFyXzExLnBuZyIsInBsYXRmb3JtSWQiOjIsInVzZXJJZCI6ImNiMGFhOWZhLWYyNDktNDYwNC1iMzU1LWUwMjA4YjE5MjA5YyIsInJlZ1RpbWUiOjE2OTcwMjQzMjI4MjEsInBob25lIjoiIiwiZGVwb3NpdCI6dHJ1ZSwidXNlcm5hbWUiOiJTQ19uZ3V5ZW52YW50aW5obmUifQ.wqXlP1bi1q-sdkSTlXuhjrXo9XyDr6VhlF1BT-naXBM";
const SICBO_SUNLIVE_INIT_PAYLOAD = [
    1, "Livestream", "SC_nguyenvantinhne", "tinhbip",
    {
        "info": JSON.stringify({
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
        "subi": true
    }
];

function start_sicbo_sunlive_ws() {
    const connect = () => {
        try {
            const ws = new WebSocket(SICBO_SUNLIVE_WS_URL);
            ws.on('open', () => {
                log('Sicbo Sunlive WS connected');
                ws.send(JSON.stringify(SICBO_SUNLIVE_INIT_PAYLOAD));
                setTimeout(() => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify([6, "Livestream", "Sicbo88Plugin", { cmd: 1950, sC: true }]));
                        ws.send(JSON.stringify([6, "Livestream", "Sicbo88Plugin", { cmd: 1959 }]));
                    }
                }, 1200);
                const ping = setInterval(() => {
                    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify([2]));
                    else clearInterval(ping);
                }, 500);
            });
            ws.on('message', (msg) => {
                try {
                    const data = JSON.parse(msg);
                    if (Array.isArray(data) && data.length >= 2 && typeof data[1] === 'object') {
                        const p = data[1];
                        if (p.cmd === 1956) {
                            const rr = p.resultRaw;
                            if (rr) {
                                const xuc_xac = rr.split('').filter(c => /\d/.test(c)).map(Number);
                                if (xuc_xac.length === 3) {
                                    const tong = xuc_xac.reduce((a, b) => a + b, 0);
                                    const session = p.sessionId;
                                    if (session && !sunlive_session_seen.has(session)) {
                                        const rec = {
                                            gameNum: String(session), score: tong, faces: xuc_xac,
                                            resultType: tong >= 11 ? 1 : 0, time: Math.floor(Date.now() / 1000)
                                        };
                                        sunlive_session_seen.add(session);
                                        sunlive_history.push(rec);
                                        if (sunlive_history.length > MAX_SUNLIVE_HISTORY) {
                                            const old = sunlive_history.shift();
                                            sunlive_session_seen.delete(old.gameNum);
                                        }
                                    }
                                }
                            }
                        }
                    }
                } catch (e) { /* silent */ }
            });
            ws.on('close', () => { log('Sicbo Sunlive WS disconn'); setTimeout(connect, 3000); });
            ws.on('error', (err) => { logError('Sicbo Sunlive WS:', err.message); ws.close(); });
        } catch (e) { logError('Sicbo Sunlive conn:', e.message); setTimeout(connect, 3000); }
    };
    connect();
}

async function sicbo_luckywin_polling_loop() {
    const interval = 2000;
    while (true) {
        try {
            const url = 'https://luck8bot.com/api/GetNewLottery/Sicbo50';
            const res = await axios.get(url, { timeout: 5000 });
            const data = res.data;
            if (data && data.state === 1 && data.data) {
                const record = data.data;
                const raw_code = record.OpenCode || '';
                if (raw_code) {
                    const faces = raw_code.split(',').map(Number).filter(n => !isNaN(n));
                    if (faces.length === 3) {
                        const score = faces.reduce((a, b) => a + b, 0);
                        const result_type = score >= 11 ? 1 : 0;
                        const game_num = String(record.ID || '');
                        if (game_num && !luckywin_id_seen.has(game_num)) {
                            const open_time = record.OpenTime || '';
                            let ts = Math.floor(Date.now() / 1000);
                            if (open_time) { try { ts = Math.floor(new Date(open_time).getTime() / 1000); } catch (e) {} }
                            const parsed = { gameNum: game_num, score: score, faces: faces, resultType: result_type, time: ts };
                            luckywin_id_seen.add(game_num);
                            luckywin_history.push(parsed);
                            if (luckywin_history.length > MAX_LUCKYWIN_HISTORY) {
                                const old = luckywin_history.shift();
                                luckywin_id_seen.delete(old.gameNum);
                            }
                        }
                    }
                }
            }
        } catch (e) { logError('Sicbo Luckywin poll:', e.message); }
        await new Promise(r => setTimeout(r, interval));
    }
}

function start_sicbo_workers() {
    log("Starting workers from sicbo.py...");
    start_sicbo_sumclub_ws();
    start_sicbo_sunlive_ws();
    sicbo_luckywin_polling_loop();
    log("sicbo.py workers started.");
}

// =================================================================================================
// WORKERS TỪ sicbosum.py
// =================================================================================================
function sicbosum_save_raw(message) {
    try {
        const parsed = JSON.parse(message);
        const rec = { time: Math.floor(Date.now() / 1000), raw: message, json: parsed };
        sicbosum_RAW_DATA.push(rec);
        if (sicbosum_RAW_DATA.length > 100) sicbosum_RAW_DATA.shift();
    } catch (e) { /* silent */ }
}

function sicbosum_parse_message(message) {
    if (message === "{}" || message === '{"type":6}') return;
    sicbosum_save_raw(message);
    try {
        const data = JSON.parse(message);
        if (!data.M) return;
        for (const m of data.M) {
            const args = m.A || [];
            if (!args.length) continue;
            const obj = args[0];
            if (typeof obj !== 'object' || obj === null) continue;
            if (!obj.Result) continue;
            const dice = obj.Result;
            const d1 = dice.Dice1 ?? -1, d2 = dice.Dice2 ?? -1, d3 = dice.Dice3 ?? -1;
            if (d1 === -1) continue;
            const tong = d1 + d2 + d3;
            const session = obj.SessionID;
            if (!session || sicbosum_SESSION_SEEN.has(session)) continue;
            const parsed = {
                session: session, dice: [d1, d2, d3], sum: tong,
                result: tong >= 11 ? "Tai" : "Xiu", md5: obj.MD5,
                bet: { tai: obj.CuaTai, xiu: obj.CuaXiu, chan: obj.CuaChan, le: obj.CuaLe }
            };
            sicbosum_SESSION_SEEN.add(session);
            sicbosum_PARSED_DATA.push(parsed);
            if (sicbosum_PARSED_DATA.length > 100) {
                const old = sicbosum_PARSED_DATA.shift();
                sicbosum_SESSION_SEEN.delete(old.session);
            }
        }
    } catch (e) { /* silent */ }
}

function start_sicbosum_ws() {
    const connect = async () => {
        try {
            const negUrl = `${SICBOSUM_SERVER.base}/signalr/negotiate?clientProtocol=1.5`;
            const negRes = await axios.get(negUrl, { headers: SICBOSUM_HEADERS });
            const token = negRes.data.ConnectionToken;
            if (!token) { setTimeout(connect, 2000); return; }
            const wsUrl = `${SICBOSUM_SERVER.base.replace('https', 'wss')}/signalr/connect?transport=webSockets&connectionToken=${encodeURIComponent(token)}&connectionData=${encodeURIComponent(JSON.stringify([{ name: SICBOSUM_SERVER.hub }]))}&clientProtocol=1.5&tid=${SICBOSUM_SERVER.tid}`;
            const ws = new WebSocket(wsUrl, { headers: SICBOSUM_HEADERS });
            ws.on('open', () => {
                log('SicboSum WS connected');
                const ping = setInterval(() => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ M: "PingPong", H: SICBOSUM_SERVER.hub, I: Date.now() }));
                        ws.send('{"type":6}');
                    } else clearInterval(ping);
                }, 5000);
            });
            ws.on('message', (msg) => sicbosum_parse_message(msg));
            ws.on('close', () => { log('SicboSum WS disconn'); setTimeout(connect, 2000); });
            ws.on('error', (err) => { logError('SicboSum WS:', err.message); ws.close(); });
        } catch (e) { logError('SicboSum conn:', e.message); setTimeout(connect, 2000); }
    };
    connect();
}

function start_sicbosum_workers() {
    log("Starting workers from sicbosum.py...");
    start_sicbosum_ws();
    log("sicbosum.py workers started.");
}

log("Đã định nghĩa xong workers xocdia88 + sicbo + sicbosum (PHẦN 3/8).");// =================================================================================================
// LOGIC TỪ lc79cbm.js - PHẦN 1: LOAD/SAVE/LEARNING/VERIFY/PATTERN STATS
// GIỮ NGUYÊN 100%
// =================================================================================================

function lc79_loadLearningData() {
    try {
        if (fs.existsSync(LC79_LEARNING_FILE)) {
            const data = fs.readFileSync(LC79_LEARNING_FILE, 'utf8');
            const parsed = JSON.parse(data);
            if (parsed.history) {
                lc79_predictionHistory = parsed.history;
                lc79_lastProcessedPhien = parsed.lastProcessedPhien || { hu: null, md5: null };
            }
            if (parsed.learningData) {
                lc79_learningData = { ...lc79_learningData, ...parsed.learningData };
            }
            log('Learning data loaded from ' + LC79_LEARNING_FILE);
        }
    } catch (error) {
        logError('Error loading learning data:', error.message);
    }
}

function lc79_saveLearningData() {
    try {
        const dataToSave = {
            history: lc79_predictionHistory,
            lastProcessedPhien: lc79_lastProcessedPhien,
            learningData: lc79_learningData,
            lastSaved: new Date().toISOString()
        };
        fs.writeFileSync(LC79_LEARNING_FILE, JSON.stringify(dataToSave, null, 2));
    } catch (error) {
        logError('Error saving learning data:', error.message);
    }
}

function lc79_loadPredictionHistory() {
    try {
        if (fs.existsSync(LC79_HISTORY_FILE)) {
            const data = fs.readFileSync(LC79_HISTORY_FILE, 'utf8');
            const parsed = JSON.parse(data);
            lc79_predictionHistory = parsed.history || { hu: [], md5: [] };
            lc79_lastProcessedPhien = parsed.lastProcessedPhien || { hu: null, md5: null };
            log('Prediction history loaded');
        }
    } catch (error) {
        logError('Error loading prediction history:', error.message);
    }
}

function lc79_savePredictionHistory() {
    try {
        const dataToSave = {
            history: lc79_predictionHistory,
            lastProcessedPhien: lc79_lastProcessedPhien,
            lastSaved: new Date().toISOString()
        };
        fs.writeFileSync(LC79_HISTORY_FILE, JSON.stringify(dataToSave, null, 2));
    } catch (error) {
        logError('Error saving prediction history:', error.message);
    }
}

async function lc79_autoProcessPredictions() {
    try {
        const dataHu = await lc79_fetchDataHu();
        if (dataHu && dataHu.length > 0) {
            const latestHuPhien = dataHu[0].Phien;
            const nextHuPhien = latestHuPhien + 1;
            if (lc79_lastProcessedPhien.hu !== nextHuPhien) {
                await lc79_verifyPredictions('hu', dataHu);
                const result = lc79_calculateAdvancedPrediction(dataHu, 'hu');
                lc79_savePredictionToHistory('hu', nextHuPhien, result.prediction, result.confidence, dataHu[0]);
                lc79_recordPrediction('hu', nextHuPhien, result.prediction, result.confidence, result.factors);
                lc79_lastProcessedPhien.hu = nextHuPhien;
                log(`[Auto] Hu phien ${nextHuPhien}: ${result.prediction} (${result.confidence}%)`);
            }
        }
        const dataMd5 = await lc79_fetchDataMd5();
        if (dataMd5 && dataMd5.length > 0) {
            const latestMd5Phien = dataMd5[0].Phien;
            const nextMd5Phien = latestMd5Phien + 1;
            if (lc79_lastProcessedPhien.md5 !== nextMd5Phien) {
                await lc79_verifyPredictions('md5', dataMd5);
                const result = lc79_calculateAdvancedPrediction(dataMd5, 'md5');
                lc79_savePredictionToHistory('md5', nextMd5Phien, result.prediction, result.confidence, dataMd5[0]);
                lc79_recordPrediction('md5', nextMd5Phien, result.prediction, result.confidence, result.factors);
                lc79_lastProcessedPhien.md5 = nextMd5Phien;
                log(`[Auto] MD5 phien ${nextMd5Phien}: ${result.prediction} (${result.confidence}%)`);
            }
        }
        await lc79_updateHistoryStatus('hu');
        await lc79_updateHistoryStatus('md5');
        lc79_savePredictionHistory();
        lc79_saveLearningData();
    } catch (error) {
        logError('[Auto] Error:', error.message);
    }
}

async function lc79_updateHistoryStatus(type) {
    try {
        const data = type === 'hu' ? await lc79_fetchDataHu() : await lc79_fetchDataMd5();
        if (!data || data.length === 0) return;
        let updated = false;
        for (const record of lc79_predictionHistory[type]) {
            if (record.ket_qua_du_doan && record.ket_qua_du_doan !== '') continue;
            const actualResult = data.find(d => d.Phien.toString() === record.Phien_hien_tai);
            if (actualResult) {
                record.ket_qua_du_doan = (record.Du_doan === actualResult.Ket_qua) ? 'Đúng ✅' : 'Sai ❌';
                updated = true;
            }
        }
        if (updated) lc79_savePredictionHistory();
    } catch (error) { logError(`Error updating ${type}:`, error.message); }
}

function lc79_startAutoSaveTask() {
    log(`LC79 Auto-save task started (every ${LC79_AUTO_SAVE_INTERVAL/1000}s)`);
    setTimeout(() => lc79_autoProcessPredictions(), 5000);
    setInterval(() => lc79_autoProcessPredictions(), LC79_AUTO_SAVE_INTERVAL);
}

function lc79_initializePatternStats(type) {
    if (!lc79_learningData[type]) {
        lc79_learningData[type] = {
            predictions: [], patternStats: {}, totalPredictions: 0, correctPredictions: 0,
            patternWeights: { ...LC79_DEFAULT_PATTERN_WEIGHTS }, lastUpdate: null,
            streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
            adaptiveThresholds: {}, recentAccuracy: []
        };
    }
    if (!lc79_learningData[type].patternWeights || Object.keys(lc79_learningData[type].patternWeights).length === 0) {
        lc79_learningData[type].patternWeights = { ...LC79_DEFAULT_PATTERN_WEIGHTS };
    }
    if (!lc79_learningData[type].patternStats) lc79_learningData[type].patternStats = {};
    Object.keys(LC79_DEFAULT_PATTERN_WEIGHTS).forEach(pattern => {
        if (!lc79_learningData[type].patternStats[pattern]) {
            lc79_learningData[type].patternStats[pattern] = {
                total: 0, correct: 0, accuracy: 0.5, recentResults: [], lastAdjustment: null
            };
        }
    });
}

function lc79_getPatternWeight(type, patternId) {
    lc79_initializePatternStats(type);
    return lc79_learningData[type].patternWeights[patternId] || 1.0;
}

function lc79_updatePatternPerformance(type, patternId, isCorrect) {
    lc79_initializePatternStats(type);
    const stats = lc79_learningData[type].patternStats[patternId];
    if (!stats) return;
    stats.total++;
    if (isCorrect) stats.correct++;
    stats.recentResults.push(isCorrect ? 1 : 0);
    if (stats.recentResults.length > 20) stats.recentResults.shift();
    const recentAccuracy = stats.recentResults.reduce((a, b) => a + b, 0) / stats.recentResults.length;
    stats.accuracy = stats.total > 0 ? stats.correct / stats.total : 0.5;
    const oldWeight = lc79_learningData[type].patternWeights[patternId];
    let newWeight = oldWeight;
    if (stats.recentResults.length >= 5) {
        if (recentAccuracy > 0.65) newWeight = Math.min(3.0, oldWeight * 1.1);
        else if (recentAccuracy < 0.35) newWeight = Math.max(0.2, oldWeight * 0.9);
    }
    lc79_learningData[type].patternWeights[patternId] = newWeight;
    stats.lastAdjustment = new Date().toISOString();
}

function lc79_recordPrediction(type, phien, prediction, confidence, patterns) {
    lc79_initializePatternStats(type);
    const record = {
        phien: phien.toString(), prediction, confidence, patterns,
        timestamp: new Date().toISOString(), verified: false, actual: null, isCorrect: null
    };
    lc79_learningData[type].predictions.unshift(record);
    lc79_learningData[type].totalPredictions++;
    if (lc79_learningData[type].predictions.length > 500) {
        lc79_learningData[type].predictions = lc79_learningData[type].predictions.slice(0, 500);
    }
}

async function lc79_verifyPredictions(type, currentData) {
    lc79_initializePatternStats(type);
    let updated = false;
    for (const pred of lc79_learningData[type].predictions) {
        if (pred.verified) continue;
        const actualResult = currentData.find(d => d.Phien.toString() === pred.phien);
        if (actualResult) {
            pred.verified = true;
            pred.actual = actualResult.Ket_qua;
            const predictedNormalized = pred.prediction === 'Tài' || pred.prediction === 'tai' ? 'Tài' : 'Xỉu';
            pred.isCorrect = pred.actual === predictedNormalized;
            if (pred.isCorrect) {
                lc79_learningData[type].correctPredictions++;
                lc79_learningData[type].streakAnalysis.wins++;
                if (lc79_learningData[type].streakAnalysis.currentStreak >= 0) lc79_learningData[type].streakAnalysis.currentStreak++;
                else lc79_learningData[type].streakAnalysis.currentStreak = 1;
                if (lc79_learningData[type].streakAnalysis.currentStreak > lc79_learningData[type].streakAnalysis.bestStreak)
                    lc79_learningData[type].streakAnalysis.bestStreak = lc79_learningData[type].streakAnalysis.currentStreak;
            } else {
                lc79_learningData[type].streakAnalysis.losses++;
                if (lc79_learningData[type].streakAnalysis.currentStreak <= 0) lc79_learningData[type].streakAnalysis.currentStreak--;
                else lc79_learningData[type].streakAnalysis.currentStreak = -1;
                if (lc79_learningData[type].streakAnalysis.currentStreak < lc79_learningData[type].streakAnalysis.worstStreak)
                    lc79_learningData[type].streakAnalysis.worstStreak = lc79_learningData[type].streakAnalysis.currentStreak;
            }
            lc79_learningData[type].recentAccuracy.push(pred.isCorrect ? 1 : 0);
            if (lc79_learningData[type].recentAccuracy.length > 50) lc79_learningData[type].recentAccuracy.shift();
            if (pred.patterns && pred.patterns.length > 0) {
                pred.patterns.forEach(patternName => {
                    const patternId = lc79_getPatternIdFromName(patternName);
                    if (patternId) lc79_updatePatternPerformance(type, patternId, pred.isCorrect);
                });
            }
            updated = true;
        }
    }
    if (updated) {
        lc79_learningData[type].lastUpdate = new Date().toISOString();
        lc79_saveLearningData();
    }
}

function lc79_getPatternIdFromName(name) {
    const mapping = {
        'Cầu Bệt': 'cau_bet', 'Cầu Đảo 1-1': 'cau_dao_11', 'Cầu 2-2': 'cau_22', 'Cầu 3-3': 'cau_33',
        'Cầu 4-4': 'cau_44', 'Cầu 5-5': 'cau_55', 'Cầu 1-2-1': 'cau_121', 'Cầu 1-2-3': 'cau_123',
        'Cầu 3-2-1': 'cau_321', 'Cầu 2-1-2': 'cau_212', 'Cầu 1-2-2-1': 'cau_1221', 'Cầu 1-2-1-2-1': 'cau_1221',
        'Cầu 2-1-1-2': 'cau_2112', 'Cầu Nhảy Cóc': 'cau_nhay_coc', 'Cầu Nhịp Nghiêng': 'cau_nhip_nghieng',
        'Cầu 3 Ván 1': 'cau_3van1', 'Cầu Bẻ Cầu': 'cau_be_cau', 'Cầu Chu Kỳ': 'cau_chu_ky', 'Cầu Gấp': 'cau_gap',
        'Cầu Ziczac': 'cau_ziczac', 'Cầu Đôi': 'cau_doi', 'Cầu Rồng': 'cau_rong', 'Đảo Xu Hướng': 'smart_bet',
        'Xu Hướng Cực': 'smart_bet', 'Phân bố': 'distribution', 'Tổng TB': 'dice_pattern', 'Xu hướng': 'sum_trend',
        'Cực Điểm': 'edge_cases', 'Biến động': 'momentum', 'Cầu Tự Nhiên': 'cau_tu_nhien',
        'Biểu Đồ Đường': 'dice_trend_line', 'MD5 Biểu Đồ': 'dice_trend_line_md5', 'Cầu Liên Tục': 'break_pattern_hu',
        'MD5 Cầu': 'break_pattern_md5', 'Dây Gãy': 'day_gay', 'MD5 Dây Gãy': 'day_gay_md5',
        'Tổng Phân Tích': 'tong_phan_tich', 'Xu Hướng Mạnh': 'xu_huong_manh', 'Đảo Chiều': 'dao_chieu',
        'Bẻ Chuỗi': 'break_streak', 'Bẻ Đảo': 'alternating_break', 'Cặp Đảo Xen Kẽ': 'double_pair_break',
        'Bộ Ba': 'triple_pattern'
    };
    for (const [key, value] of Object.entries(mapping)) {
        if (name.includes(key)) return value;
    }
    return null;
}

function lc79_getAdaptiveConfidenceBoost(type) {
    if (!lc79_learningData[type] || !lc79_learningData[type].recentAccuracy) return 0;
    const recentAcc = lc79_learningData[type].recentAccuracy;
    if (recentAcc.length < 10) return 0;
    const accuracy = recentAcc.reduce((a, b) => a + b, 0) / recentAcc.length;
    if (accuracy > 0.70) return 10;
    if (accuracy > 0.60) return 6;
    if (accuracy > 0.50) return 3;
    if (accuracy < 0.30) return -10;
    if (accuracy < 0.40) return -6;
    return 0;
}

function lc79_getSmartPredictionAdjustment(type, prediction, patterns) {
    if (!lc79_learningData[type]) return prediction;
    const streakInfo = lc79_learningData[type].streakAnalysis || { currentStreak: 0 };
    if (streakInfo.currentStreak <= -4) return prediction === 'Tài' ? 'Xỉu' : 'Tài';
    let taiScore = 0, xiuScore = 0;
    patterns.forEach(p => {
        const pid = lc79_getPatternIdFromName(p.name || p);
        if (pid) {
            const stats = lc79_learningData[type].patternStats[pid];
            if (stats && stats.recentResults.length >= 5) {
                const acc = stats.recentResults.reduce((a, b) => a + b, 0) / stats.recentResults.length;
                const weight = lc79_learningData[type].patternWeights[pid] || 1;
                if (p.prediction === 'Tài') taiScore += acc * weight;
                else xiuScore += acc * weight;
            }
        }
    });
    if (Math.abs(taiScore - xiuScore) > 0.7) return taiScore > xiuScore ? 'Tài' : 'Xỉu';
    return prediction;
}

function lc79_normalizeResult(result) {
    if (result === 'Tài' || result === 'tài') return 'tai';
    if (result === 'Xỉu' || result === 'xỉu') return 'xiu';
    return result.toLowerCase();
}

function lc79_transformApiData(apiData) {
    if (!apiData || !apiData.list || !Array.isArray(apiData.list)) return null;
    return apiData.list.map(item => {
        const result = item.resultTruyenThong === 'TAI' ? 'Tài' : 'Xỉu';
        return {
            Phien: item.id, Ket_qua: result, Xuc_xac_1: item.dices[0],
            Xuc_xac_2: item.dices[1], Xuc_xac_3: item.dices[2], Tong: item.point
        };
    });
}

async function lc79_fetchDataHu() {
    try {
        const response = await axios.get(LC79_API_URL_HU, { timeout: 10000 });
        return lc79_transformApiData(response.data);
    } catch (error) { logError('Error fetching HU:', error.message); return null; }
}

async function lc79_fetchDataMd5() {
    try {
        const response = await axios.get(LC79_API_URL_MD5, { timeout: 10000 });
        return lc79_transformApiData(response.data);
    } catch (error) { logError('Error fetching MD5:', error.message); return null; }
}

log("Đã định nghĩa xong logic lc79cbm.js phần 1 (PHẦN 4/8).");// =================================================================================================
// LOGIC TỪ lc79cbm.js - PHẦN 2: HÀM PHÂN TÍCH CẦU + CALCULATE + UTILITIES + ALGO
// GIỮ NGUYÊN 100%
// =================================================================================================

// ============ CÁC HÀM PHÂN TÍCH CẦU ============
function lc79_analyzeTongPhanTich(data, type) {
    if (data.length < 10) return { detected: false };
    const recent10 = data.slice(0, 10);
    const sums = recent10.map(d => d.Tong);
    const results = recent10.map(d => d.Ket_qua);
    const taiCount = results.filter(r => r === 'Tài').length;
    const xiuCount = results.filter(r => r === 'Xỉu').length;
    const first5Sum = sums.slice(5, 10).reduce((a, b) => a + b, 0) / 5;
    const last5Sum = sums.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
    const sumTrend = last5Sum - first5Sum;
    if (sumTrend > 1.5) return { detected: true, prediction: 'Xỉu', confidence: Math.round(75 + Math.abs(sumTrend) * 3), name: `Tổng Phân Tích (Tổng tăng ${sumTrend.toFixed(1)} → Xỉu)`, patternId: 'tong_phan_tich' };
    if (sumTrend < -1.5) return { detected: true, prediction: 'Tài', confidence: Math.round(75 + Math.abs(sumTrend) * 3), name: `Tổng Phân Tích (Tổng giảm ${Math.abs(sumTrend).toFixed(1)} → Tài)`, patternId: 'tong_phan_tich' };
    if (Math.abs(taiCount - xiuCount) >= 3) {
        const lech = taiCount > xiuCount ? 'Tài' : 'Xỉu';
        const prediction = lech === 'Tài' ? 'Xỉu' : 'Tài';
        return { detected: true, prediction, confidence: Math.round(70 + Math.abs(taiCount - xiuCount) * 3), name: `Tổng Phân Tích (Lệch ${Math.abs(taiCount - xiuCount)} về ${lech} → ${prediction})`, patternId: 'tong_phan_tich' };
    }
    return { detected: false };
}

function lc79_analyzeXuHuongManh(results, type) {
    if (results.length < 8) return { detected: false };
    const recent8 = results.slice(0, 8);
    const taiCount = recent8.filter(r => r === 'Tài').length;
    if (taiCount >= 6) return { detected: true, prediction: 'Xỉu', confidence: Math.round(80 + taiCount * 2), name: `Xu Hướng Mạnh (${taiCount}/8 Tài → Đảo Xỉu)`, patternId: 'xu_huong_manh' };
    if (taiCount <= 2) return { detected: true, prediction: 'Tài', confidence: Math.round(80 + (8 - taiCount) * 2), name: `Xu Hướng Mạnh (${8 - taiCount}/8 Xỉu → Đảo Tài)`, patternId: 'xu_huong_manh' };
    return { detected: false };
}

function lc79_analyzeDaoChieu(results, type) {
    if (results.length < 5) return { detected: false };
    const recent5 = results.slice(0, 5);
    let isAlt = true;
    for (let i = 0; i < recent5.length - 1; i++) if (recent5[i] === recent5[i + 1]) { isAlt = false; break; }
    if (isAlt) return { detected: true, prediction: recent5[0] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 75, name: `Đảo Chiều (Chuỗi ${recent5.join('-')} → ${recent5[0] === 'Tài' ? 'Xỉu' : 'Tài'})`, patternId: 'dao_chieu' };
    return { detected: false };
}

function lc79_analyzeCauBet(results, type) {
    if (results.length < 3) return { detected: false };
    let streakType = results[0], streakLength = 1;
    for (let i = 1; i < results.length; i++) if (results[i] === streakType) streakLength++; else break;
    if (streakLength >= 3) {
        let shouldBreak = streakLength >= 5, confidence = 65;
        if (streakLength >= 7) { shouldBreak = true; confidence = 85; }
        else if (streakLength >= 5) { shouldBreak = true; confidence = 75; }
        else if (streakLength >= 3) { shouldBreak = false; confidence = 68; }
        return { detected: true, type: streakType, length: streakLength,
            prediction: shouldBreak ? (streakType === 'Tài' ? 'Xỉu' : 'Tài') : streakType,
            confidence, name: `Cầu Bệt ${streakLength} phiên ${streakType}`, patternId: 'cau_bet' };
    }
    return { detected: false };
}

function lc79_analyzeCauDao11(results, type) {
    if (results.length < 4) return { detected: false };
    let altLen = 1;
    for (let i = 1; i < Math.min(results.length, 10); i++) if (results[i] !== results[i - 1]) altLen++; else break;
    if (altLen >= 4) {
        const confidence = Math.min(80, 65 + altLen * 2);
        return { detected: true, length: altLen, prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
            confidence, name: `Cầu Đảo 1-1 (${altLen} phiên)`, patternId: 'cau_dao_11' };
    }
    return { detected: false };
}

function lc79_analyzeCau22(results, type) {
    if (results.length < 6) return { detected: false };
    let pairCount = 0, i = 0, pattern = [];
    while (i < results.length - 1 && pairCount < 4) {
        if (results[i] === results[i + 1]) { pattern.push(results[i]); pairCount++; i += 2; } else break;
    }
    if (pairCount >= 2) {
        let isAlt = true;
        for (let j = 1; j < pattern.length; j++) if (pattern[j] === pattern[j - 1]) { isAlt = false; break; }
        if (isAlt) {
            const lastPairType = pattern[pattern.length - 1];
            return { detected: true, pairCount, prediction: lastPairType === 'Tài' ? 'Xỉu' : 'Tài',
                confidence: Math.round(Math.min(78, 65 + pairCount * 3)), name: `Cầu 2-2 (${pairCount} cặp)`, patternId: 'cau_22' };
        }
    }
    return { detected: false };
}

function lc79_analyzeCau33(results, type) {
    if (results.length < 6) return { detected: false };
    let tripleCount = 0, i = 0, pattern = [];
    while (i < results.length - 2) {
        if (results[i] === results[i + 1] && results[i + 1] === results[i + 2]) {
            pattern.push(results[i]); tripleCount++; i += 3;
        } else break;
    }
    if (tripleCount >= 1) {
        const currentPos = results.length % 3;
        const lastTripleType = pattern[pattern.length - 1];
        let prediction = currentPos === 0 ? (lastTripleType === 'Tài' ? 'Xỉu' : 'Tài') : lastTripleType;
        return { detected: true, tripleCount, prediction,
            confidence: Math.round(Math.min(80, 68 + tripleCount * 4)),
            name: `Cầu 3-3 (${tripleCount} bộ ba)`, patternId: 'cau_33' };
    }
    return { detected: false };
}

function lc79_analyzeCau121(results, type) {
    if (results.length < 4) return { detected: false };
    const p = results.slice(0, 4);
    if (p[0] !== p[1] && p[1] === p[2] && p[2] !== p[3] && p[0] === p[3])
        return { detected: true, pattern: '1-2-1', prediction: p[0], confidence: 72, name: 'Cầu 1-2-1', patternId: 'cau_121' };
    return { detected: false };
}

function lc79_analyzeCau123(results, type) {
    if (results.length < 6) return { detected: false };
    const first = results[5];
    const nextTwo = results.slice(3, 5);
    const lastThree = results.slice(0, 3);
    if (nextTwo[0] === nextTwo[1] && nextTwo[0] !== first) {
        const allSame = lastThree.every(r => r === lastThree[0]);
        if (allSame && lastThree[0] !== nextTwo[0])
            return { detected: true, pattern: '1-2-3', prediction: first, confidence: 74, name: 'Cầu 1-2-3', patternId: 'cau_123' };
    }
    return { detected: false };
}

function lc79_analyzeCau321(results, type) {
    if (results.length < 6) return { detected: false };
    const first3 = results.slice(3, 6);
    const next2 = results.slice(1, 3);
    const last1 = results[0];
    const first3Same = first3.every(r => r === first3[0]);
    const next2Same = next2.every(r => r === next2[0]);
    if (first3Same && next2Same && first3[0] !== next2[0] && last1 !== next2[0])
        return { detected: true, pattern: '3-2-1', prediction: next2[0], confidence: 76, name: 'Cầu 3-2-1', patternId: 'cau_321' };
    return { detected: false };
}

function lc79_analyzeCauNhayCoc(results, type) {
    if (results.length < 6) return { detected: false };
    const skipPattern = [];
    for (let i = 0; i < Math.min(results.length, 12); i += 2) skipPattern.push(results[i]);
    if (skipPattern.length >= 3) {
        const allSame = skipPattern.slice(0, 3).every(r => r === skipPattern[0]);
        if (allSame) return { detected: true, prediction: skipPattern[0], confidence: 68, name: 'Cầu Nhảy Cóc', patternId: 'cau_nhay_coc' };
        let alt = true;
        for (let i = 1; i < skipPattern.length - 1; i++) if (skipPattern[i] === skipPattern[i - 1]) { alt = false; break; }
        if (alt && skipPattern.length >= 3)
            return { detected: true, prediction: skipPattern[0] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 66, name: 'Cầu Nhảy Cóc Đảo', patternId: 'cau_nhay_coc' };
    }
    return { detected: false };
}

function lc79_analyzeCauNhipNghieng(results, type) {
    if (results.length < 5) return { detected: false };
    const last5 = results.slice(0, 5);
    const taiCount5 = last5.filter(r => r === 'Tài').length;
    if (taiCount5 >= 4) return { detected: true, prediction: 'Tài', confidence: 70, name: `Cầu Nhịp Nghiêng (${taiCount5}/5 Tài)`, patternId: 'cau_nhip_nghieng' };
    if (taiCount5 <= 1) return { detected: true, prediction: 'Xỉu', confidence: 70, name: `Cầu Nhịp Nghiêng (${5 - taiCount5}/5 Xỉu)`, patternId: 'cau_nhip_nghieng' };
    return { detected: false };
}

function lc79_analyzeCau3Van1(results, type) {
    if (results.length < 4) return { detected: false };
    const last4 = results.slice(0, 4);
    const taiCount = last4.filter(r => r === 'Tài').length;
    if (taiCount === 3) return { detected: true, prediction: 'Xỉu', confidence: 68, name: 'Cầu 3 Ván 1 (3T-1X) → Xỉu', patternId: 'cau_3van1' };
    if (taiCount === 1) return { detected: true, prediction: 'Tài', confidence: 68, name: 'Cầu 3 Ván 1 (3X-1T) → Tài', patternId: 'cau_3van1' };
    return { detected: false };
}

function lc79_analyzeCauBeCau(results, type) {
    if (results.length < 8) return { detected: false };
    const recentStreak = lc79_analyzeCauBet(results, type);
    if (recentStreak.detected && recentStreak.length >= 4) {
        const beforeStreak = results.slice(recentStreak.length, recentStreak.length + 4);
        const prevPattern = lc79_analyzeCauBet(beforeStreak, type);
        if (prevPattern.detected && prevPattern.type !== recentStreak.type)
            return { detected: true, prediction: recentStreak.type === 'Tài' ? 'Xỉu' : 'Tài', confidence: 76, name: 'Cầu Bẻ Cầu', patternId: 'cau_be_cau' };
    }
    return { detected: false };
}

function lc79_analyzeCauTuNhien(results, type) {
    if (results.length < 2) return { detected: false };
    return { detected: true, prediction: results[0], confidence: 60, name: 'Cầu Tự Nhiên (Theo Ván Trước)', patternId: 'cau_tu_nhien' };
}

function lc79_analyzeCauRong(results, type) {
    if (results.length < 6) return { detected: false };
    let streakLen = 1;
    for (let i = 1; i < results.length; i++) if (results[i] === results[0]) streakLen++; else break;
    if (streakLen >= 6)
        return { detected: true, prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài', confidence: Math.round(Math.min(88, 75 + streakLen)), name: `Cầu Rồng ${streakLen} phiên (Bẻ mạnh)`, patternId: 'cau_rong' };
    return { detected: false };
}

function lc79_analyzeSmartBet(results, type) {
    if (results.length < 10) return { detected: false };
    const last10 = results.slice(0, 10), last5 = results.slice(0, 5), prev5 = results.slice(5, 10);
    const taiLast5 = last5.filter(r => r === 'Tài').length, taiPrev5 = prev5.filter(r => r === 'Tài').length;
    const trendChanging = (taiLast5 >= 4 && taiPrev5 <= 1) || (taiLast5 <= 1 && taiPrev5 >= 4);
    if (trendChanging) {
        const currentDom = taiLast5 >= 4 ? 'Tài' : 'Xỉu';
        return { detected: true, prediction: currentDom === 'Tài' ? 'Xỉu' : 'Tài', confidence: 78, name: `Đảo Xu Hướng (${taiLast5}T-${5-taiLast5}X → ${taiPrev5}T-${5-taiPrev5}X)`, patternId: 'smart_bet' };
    }
    const taiLast10 = last10.filter(r => r === 'Tài').length;
    if (taiLast10 >= 8 || taiLast10 <= 2) {
        const dom = taiLast10 >= 8 ? 'Tài' : 'Xỉu';
        return { detected: true, prediction: dom === 'Tài' ? 'Xỉu' : 'Tài', confidence: 82, name: `Xu Hướng Cực (${taiLast10}T-${10-taiLast10}X) → Đảo`, patternId: 'smart_bet' };
    }
    return { detected: false };
}

function lc79_analyzeBreakStreak(results, type) {
    if (results.length < 5) return { detected: false };
    let streakType = results[0], streakLen = 1;
    for (let i = 1; i < results.length; i++) if (results[i] === streakType) streakLen++; else break;
    if (streakLen >= 5) {
        const prediction = streakType === 'Tài' ? 'Xỉu' : 'Tài';
        return { detected: true, prediction, confidence: Math.round(Math.min(85, 70 + streakLen)), name: `Bẻ Chuỗi ${streakLen} (${streakType} → ${prediction})`, patternId: 'break_streak' };
    }
    return { detected: false };
}

function lc79_analyzeAlternatingBreak(results, type) {
    if (results.length < 6) return { detected: false };
    let altCount = 0;
    for (let i = 0; i < results.length - 1; i++) if (results[i] !== results[i + 1]) altCount++; else break;
    if (altCount >= 6) {
        const prediction = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
        return { detected: true, prediction, confidence: Math.round(Math.min(82, 68 + altCount)), name: `Bẻ Đảo ${altCount} phiên → ${prediction}`, patternId: 'alternating_break' };
    }
    return { detected: false };
}

function lc79_analyzeDoublePairBreak(results, type) {
    if (results.length < 8) return { detected: false };
    const isPair1 = results[0] === results[1], isPair2 = results[2] === results[3], isPair3 = results[4] === results[5], isPair4 = results[6] === results[7];
    if (isPair1 && isPair2 && isPair3 && isPair4) {
        const pairType1 = results[0], pairType2 = results[2];
        const allSamePair = pairType1 === pairType2 && pairType2 === results[4] && results[4] === results[6];
        if (allSamePair) {
            const prediction = pairType1 === 'Tài' ? 'Xỉu' : 'Tài';
            return { detected: true, prediction, confidence: 84, name: `4 Cặp Cùng ${pairType1} → Bẻ ${prediction}`, patternId: 'double_pair_break' };
        }
        const altPairs = pairType1 !== pairType2 && pairType2 !== results[4] && results[4] !== results[6];
        if (altPairs) {
            const prediction = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
            return { detected: true, prediction, confidence: 78, name: `Cặp Đảo Xen Kẽ → Bẻ ${prediction}`, patternId: 'double_pair_break' };
        }
    }
    return { detected: false };
}

function lc79_analyzeTriplePattern(results, type) {
    if (results.length < 9) return { detected: false };
    const isTrip1 = results[0] === results[1] && results[1] === results[2];
    const isTrip2 = results[3] === results[4] && results[4] === results[5];
    const isTrip3 = results[6] === results[7] && results[7] === results[8];
    if (isTrip1 && isTrip2 && isTrip3) {
        const tripType1 = results[0], tripType2 = results[3], tripType3 = results[6];
        if (tripType1 === tripType2 && tripType2 === tripType3) {
            const prediction = tripType1 === 'Tài' ? 'Xỉu' : 'Tài';
            return { detected: true, prediction, confidence: 88, name: `3 Bộ Ba Cùng ${tripType1} → Bẻ ${prediction}`, patternId: 'triple_pattern' };
        }
        if (tripType1 !== tripType2 && tripType2 !== tripType3)
            return { detected: true, prediction: tripType1, confidence: 80, name: `Bộ Ba Đảo → Theo ${tripType1}`, patternId: 'triple_pattern' };
    }
    return { detected: false };
}

function lc79_analyzeDistribution(data, type, windowSize = 50) {
    const window = data.slice(0, windowSize);
    const taiCount = window.filter(d => d.Ket_qua === 'Tài').length;
    const xiuCount = window.length - taiCount;
    return { taiPercent: (taiCount / window.length) * 100, xiuPercent: (xiuCount / window.length) * 100, taiCount, xiuCount, total: window.length, imbalance: Math.abs(taiCount - xiuCount) / window.length };
}

// ============ HÀM TÍNH TOÁN DỰ ĐOÁN CHÍNH ============
function lc79_calculateAdvancedPrediction(data, type) {
    const last50 = data.slice(0, 50);
    const results = last50.map(d => d.Ket_qua);
    lc79_initializePatternStats(type);
    let predictions = [], factors = [], allPatterns = [];

    const tongPhanTich = lc79_analyzeTongPhanTich(last50, type);
    if (tongPhanTich.detected) { predictions.push({ prediction: tongPhanTich.prediction, confidence: tongPhanTich.confidence, priority: 15, name: tongPhanTich.name }); factors.push(tongPhanTich.name); allPatterns.push(tongPhanTich); }

    const xuHuongManh = lc79_analyzeXuHuongManh(results, type);
    if (xuHuongManh.detected) { predictions.push({ prediction: xuHuongManh.prediction, confidence: xuHuongManh.confidence, priority: 14, name: xuHuongManh.name }); factors.push(xuHuongManh.name); allPatterns.push(xuHuongManh); }

    const daoChieu = lc79_analyzeDaoChieu(results, type);
    if (daoChieu.detected) { predictions.push({ prediction: daoChieu.prediction, confidence: daoChieu.confidence, priority: 13, name: daoChieu.name }); factors.push(daoChieu.name); allPatterns.push(daoChieu); }

    const cauRong = lc79_analyzeCauRong(results, type);
    if (cauRong.detected) { predictions.push({ prediction: cauRong.prediction, confidence: cauRong.confidence, priority: 12, name: cauRong.name }); factors.push(cauRong.name); allPatterns.push(cauRong); }

    const breakStreak = lc79_analyzeBreakStreak(results, type);
    if (breakStreak.detected) { predictions.push({ prediction: breakStreak.prediction, confidence: breakStreak.confidence, priority: 11, name: breakStreak.name }); factors.push(breakStreak.name); allPatterns.push(breakStreak); }

    const triplePattern = lc79_analyzeTriplePattern(results, type);
    if (triplePattern.detected) { predictions.push({ prediction: triplePattern.prediction, confidence: triplePattern.confidence, priority: 11, name: triplePattern.name }); factors.push(triplePattern.name); allPatterns.push(triplePattern); }

    const doublePairBreak = lc79_analyzeDoublePairBreak(results, type);
    if (doublePairBreak.detected) { predictions.push({ prediction: doublePairBreak.prediction, confidence: doublePairBreak.confidence, priority: 10, name: doublePairBreak.name }); factors.push(doublePairBreak.name); allPatterns.push(doublePairBreak); }

    const smartBet = lc79_analyzeSmartBet(results, type);
    if (smartBet.detected) { predictions.push({ prediction: smartBet.prediction, confidence: smartBet.confidence, priority: 10, name: smartBet.name }); factors.push(smartBet.name); allPatterns.push(smartBet); }

    const cauBet = lc79_analyzeCauBet(results, type);
    if (cauBet.detected) { predictions.push({ prediction: cauBet.prediction, confidence: cauBet.confidence, priority: 9, name: cauBet.name }); factors.push(cauBet.name); allPatterns.push(cauBet); }

    const cauDao11 = lc79_analyzeCauDao11(results, type);
    if (cauDao11.detected) { predictions.push({ prediction: cauDao11.prediction, confidence: cauDao11.confidence, priority: 9, name: cauDao11.name }); factors.push(cauDao11.name); allPatterns.push(cauDao11); }

    const cau22 = lc79_analyzeCau22(results, type);
    if (cau22.detected) { predictions.push({ prediction: cau22.prediction, confidence: cau22.confidence, priority: 8, name: cau22.name }); factors.push(cau22.name); allPatterns.push(cau22); }

    const cau33 = lc79_analyzeCau33(results, type);
    if (cau33.detected) { predictions.push({ prediction: cau33.prediction, confidence: cau33.confidence, priority: 8, name: cau33.name }); factors.push(cau33.name); allPatterns.push(cau33); }

    const cau121 = lc79_analyzeCau121(results, type);
    if (cau121.detected) { predictions.push({ prediction: cau121.prediction, confidence: cau121.confidence, priority: 7, name: cau121.name }); factors.push(cau121.name); allPatterns.push(cau121); }

    const cau123 = lc79_analyzeCau123(results, type);
    if (cau123.detected) { predictions.push({ prediction: cau123.prediction, confidence: cau123.confidence, priority: 7, name: cau123.name }); factors.push(cau123.name); allPatterns.push(cau123); }

    const cau321 = lc79_analyzeCau321(results, type);
    if (cau321.detected) { predictions.push({ prediction: cau321.prediction, confidence: cau321.confidence, priority: 7, name: cau321.name }); factors.push(cau321.name); allPatterns.push(cau321); }

    const cauBeCau = lc79_analyzeCauBeCau(results, type);
    if (cauBeCau.detected) { predictions.push({ prediction: cauBeCau.prediction, confidence: cauBeCau.confidence, priority: 8, name: cauBeCau.name }); factors.push(cauBeCau.name); allPatterns.push(cauBeCau); }

    const cauNhipNghieng = lc79_analyzeCauNhipNghieng(results, type);
    if (cauNhipNghieng.detected) { predictions.push({ prediction: cauNhipNghieng.prediction, confidence: cauNhipNghieng.confidence, priority: 7, name: cauNhipNghieng.name }); factors.push(cauNhipNghieng.name); allPatterns.push(cauNhipNghieng); }

    const cau3Van1 = lc79_analyzeCau3Van1(results, type);
    if (cau3Van1.detected) { predictions.push({ prediction: cau3Van1.prediction, confidence: cau3Van1.confidence, priority: 6, name: cau3Van1.name }); factors.push(cau3Van1.name); allPatterns.push(cau3Van1); }

    const cauNhayCoc = lc79_analyzeCauNhayCoc(results, type);
    if (cauNhayCoc.detected) { predictions.push({ prediction: cauNhayCoc.prediction, confidence: cauNhayCoc.confidence, priority: 6, name: cauNhayCoc.name }); factors.push(cauNhayCoc.name); allPatterns.push(cauNhayCoc); }

    const altBreak = lc79_analyzeAlternatingBreak(results, type);
    if (altBreak.detected) { predictions.push({ prediction: altBreak.prediction, confidence: altBreak.confidence, priority: 8, name: altBreak.name }); factors.push(altBreak.name); allPatterns.push(altBreak); }

    const distribution = lc79_analyzeDistribution(last50, type);
    if (distribution.imbalance > 0.15) {
        const minority = distribution.taiPercent < 50 ? 'Tài' : 'Xỉu';
        predictions.push({ prediction: minority, confidence: 65, priority: 5, name: 'Phân bố lệch' });
        factors.push(`Phân bố lệch (T:${distribution.taiPercent.toFixed(0)}% - X:${distribution.xiuPercent.toFixed(0)}%)`);
    }

    if (predictions.length === 0) {
        const cauTuNhien = lc79_analyzeCauTuNhien(results, type);
        predictions.push({ prediction: cauTuNhien.prediction, confidence: cauTuNhien.confidence, priority: 1, name: cauTuNhien.name });
        factors.push(cauTuNhien.name);
        allPatterns.push(cauTuNhien);
    }

    predictions.sort((a, b) => b.priority - a.priority || b.confidence - a.confidence);
    const taiVotes = predictions.filter(p => p.prediction === 'Tài');
    const xiuVotes = predictions.filter(p => p.prediction === 'Xỉu');
    let taiScore = taiVotes.reduce((sum, p) => sum + p.confidence * p.priority, 0);
    let xiuScore = xiuVotes.reduce((sum, p) => sum + p.confidence * p.priority, 0);

    const streakInfo = lc79_learningData[type].streakAnalysis;
    if (streakInfo.currentStreak <= -3) {
        if (taiScore > xiuScore) xiuScore *= 1.3; else taiScore *= 1.3;
    }

    let finalPrediction = taiScore >= xiuScore ? 'Tài' : 'Xỉu';
    finalPrediction = lc79_getSmartPredictionAdjustment(type, finalPrediction, allPatterns);

    let baseConfidence = 65;
    predictions.slice(0, 3).forEach(p => { if (p.prediction === finalPrediction) baseConfidence += (p.confidence - 65) * 0.3; });
    const agreementRatio = (finalPrediction === 'Tài' ? taiVotes.length : xiuVotes.length) / predictions.length;
    baseConfidence += Math.round(agreementRatio * 10);
    baseConfidence += lc79_getAdaptiveConfidenceBoost(type);
    let finalConfidence = Math.round(baseConfidence);
    finalConfidence = Math.max(60, Math.min(92, finalConfidence));

    return {
        prediction: finalPrediction, confidence: finalConfidence, factors, allPatterns,
        detailedAnalysis: {
            totalPatterns: predictions.length, taiVotes: taiVotes.length, xiuVotes: xiuVotes.length,
            taiScore, xiuScore, topPattern: predictions[0]?.name || 'N/A', distribution,
            learningStats: {
                totalPredictions: lc79_learningData[type].totalPredictions,
                correctPredictions: lc79_learningData[type].correctPredictions,
                accuracy: lc79_learningData[type].totalPredictions > 0 ? (lc79_learningData[type].correctPredictions / lc79_learningData[type].totalPredictions * 100).toFixed(1) + '%' : 'N/A',
                currentStreak: lc79_learningData[type].streakAnalysis.currentStreak
            }
        }
    };
}

function lc79_savePredictionToHistory(type, phien, prediction, confidence, latestData) {
    if (!lc79_predictionHistory[type]) lc79_predictionHistory[type] = [];
    const record = {
        Phien: latestData.Phien, Xuc_xac_1: latestData.Xuc_xac_1, Xuc_xac_2: latestData.Xuc_xac_2,
        Xuc_xac_3: latestData.Xuc_xac_3, Tong: latestData.Tong, Ket_qua: latestData.Ket_qua,
        Do_tin_cay: `${confidence}%`, Phien_hien_tai: phien.toString(), Du_doan: prediction,
        ket_qua_du_doan: '', id: '@tranhoang2286', timestamp: new Date().toISOString()
    };
    lc79_predictionHistory[type].unshift(record);
    if (lc79_predictionHistory[type].length > LC79_MAX_HISTORY) lc79_predictionHistory[type] = lc79_predictionHistory[type].slice(0, LC79_MAX_HISTORY);
    return record;
}

// ============ UTILITIES ============
function lc79_parseLines(data) {
    if (!data || !Array.isArray(data.list)) return [];
    const sorted = data.list.sort((a, b) => b.id - a.id);
    return sorted.map(item => ({ session: item.id, dice: item.dices, total: item.point, result: item.resultTruyenThong, tx: item.point >= 11 ? 'T' : 'X' })).sort((a, b) => a.session - b.session);
}
function lc79_parseLinesNx(data) {
    if (!data || !Array.isArray(data.history)) return [];
    const sorted = data.history.sort((a, b) => b.round - a.round);
    return sorted.map(item => ({ session: item.round, dice: [item.dice1, item.dice2, item.dice3], total: item.dice1 + item.dice2 + item.dice3, result: item.result, tx: (item.dice1 + item.dice2 + item.dice3) >= 11 ? 'T' : 'X' })).sort((a, b) => a.session - b.session);
}
function lc79_lastN(arr, n) { const start = Math.max(0, arr.length - n); return arr.slice(start); }
function lc79_majority(obj) { let maxK = null, maxV = -Infinity; for (const k in obj) if (obj[k] > maxV) { maxV = obj[k]; maxK = k; } return { key: maxK, val: maxV }; }
function lc79_sum(nums) { return nums.reduce((a, b) => a + b, 0); }
function lc79_avg(nums) { return nums.length ? lc79_sum(nums) / nums.length : 0; }
function lc79_entropy(arr) { if (!arr.length) return 0; const freq = {}; for (const v of arr) freq[v] = (freq[v] || 0) + 1; let e = 0; const n = arr.length; for (const k in freq) { const p = freq[k] / n; e -= p * Math.log2(p); } return e; }
function lc79_similarity(a, b) { if (a.length !== b.length) return 0; let m = 0; for (let i = 0; i < a.length; i++) if (a[i] === b[i]) m++; return m / a.length; }

function lc79_extractFeatures(history) {
    const tx = history.map(h => h.tx);
    const totals = history.map(h => h.total);
    const dice1 = history.map(h => h.dice[0]);
    const dice2 = history.map(h => h.dice[1]);
    const dice3 = history.map(h => h.dice[2]);
    const freq = {};
    for (const v of tx) freq[v] = (freq[v] || 0) + 1;
    let runs = [], cur = tx[0], len = 1;
    for (let i = 1; i < tx.length; i++) {
        if (tx[i] === cur) len++;
        else { runs.push({ val: cur, len }); cur = tx[i]; len = 1; }
    }
    if (tx.length) runs.push({ val: cur, len });
    const meanTotal = lc79_avg(totals);
    const variance = lc79_avg(totals.map(t => Math.pow(t - meanTotal, 2)));
    const last10Totals = totals.slice(-10);
    const upward = last10Totals.filter((t, i) => i > 0 && t > last10Totals[i - 1]).length;
    const downward = last10Totals.filter((t, i) => i > 0 && t < last10Totals[i - 1]).length;
    const sumDice = dice1.map((d, i) => d + dice2[i] + dice3[i]);
    return {
        tx, totals, dice1, dice2, dice3, freq, runs,
        maxRun: runs.reduce((m, r) => Math.max(m, r.len), 0),
        meanTotal, stdTotal: Math.sqrt(variance),
        entropy: lc79_entropy(tx),
        last3Pattern: tx.slice(-3).join(''),
        last5Pattern: tx.slice(-5).join(''),
        last8Pattern: tx.slice(-8).join(''),
        trends: { upward, downward },
        diceStats: { avgDice1: lc79_avg(dice1), avgDice2: lc79_avg(dice2), avgDice3: lc79_avg(dice3), volatilityDice: Math.sqrt(lc79_avg(sumDice.map(s => Math.pow(s - meanTotal, 2)))) }
    };
}

function lc79_detectPatternType(runs) {
    if (runs.length < 3) return null;
    const recentRuns = runs.slice(-5);
    const lengths = recentRuns.map(r => r.len);
    if (lengths.every(l => l === 1)) return 'alternating_advanced';
    if (lengths.every(l => l >= 2) && recentRuns.every((r, i) => i === 0 || r.val !== recentRuns[i - 1].val)) return 'continuation_advanced';
    if (recentRuns[recentRuns.length - 1].len >= 4) return 'super_long_run';
    if (lengths.length >= 3 && lengths[0] < lengths[1] && lengths[1] > lengths[2]) return 'break_advanced';
    return 'normal_pattern';
}

log("Đã định nghĩa xong logic lc79cbm.js phần 2 (PHẦN 5/8).");// =================================================================================================
// LOGIC TỪ lc79cbm.js - PHẦN 3: CÁC THUẬT TOÁN ALGO A-Z
// GIỮ NGUYÊN 100%
// =================================================================================================

function lc79_algo5_freqRebalance(history) {
    if (history.length < 20) return null;
    const features = lc79_extractFeatures(history);
    const { freq, entropy: e } = features;
    const tCount = freq['T'] || 0, xCount = freq['X'] || 0;
    const diff = Math.abs(tCount - xCount), total = tCount + xCount;
    let threshold;
    if (e > 0.9) threshold = 0.45;
    else if (e < 0.4) threshold = 0.65;
    else threshold = 0.55;
    const recent = history.slice(-30);
    const recentT = recent.filter(h => h.tx === 'T').length;
    const recentX = recent.filter(h => h.tx === 'X').length;
    const recentDiff = Math.abs(recentT - recentX), recentTotal = recentT + recentX;
    if (total > 0 && recentTotal > 0) {
        const longTermRatio = diff / total;
        const shortTermRatio = recentDiff / recentTotal;
        const combinedRatio = (longTermRatio * 0.4) + (shortTermRatio * 0.6);
        if (combinedRatio > threshold) {
            if (recentT > recentX + 2) return 'X';
            if (recentX > recentT + 2) return 'T';
        }
    }
    return null;
}

function lc79_algoA_markov(history) {
    if (history.length < 15) return null;
    const tx = history.map(h => h.tx);
    let maxOrder = 4;
    if (history.length < 30) maxOrder = 3;
    if (history.length < 20) maxOrder = 2;
    let bestPred = null, bestScore = -1;
    for (let order = 2; order <= maxOrder; order++) {
        if (tx.length < order + 8) continue;
        const transitions = {};
        const totalTransitions = tx.length - order;
        const decayFactor = 0.95;
        for (let i = 0; i < totalTransitions; i++) {
            const key = tx.slice(i, i + order).join('');
            const next = tx[i + order];
            const weight = Math.pow(decayFactor, totalTransitions - i - 1);
            if (!transitions[key]) transitions[key] = { T: 0, X: 0 };
            transitions[key][next] += weight;
        }
        const lastKey = tx.slice(-order).join('');
        const counts = transitions[lastKey];
        if (counts && (counts.T + counts.X) > 0.5) {
            const total = counts.T + counts.X;
            const confidence = Math.abs(counts.T - counts.X) / total;
            const pred = counts.T > counts.X ? 'T' : 'X';
            const orderWeight = order / maxOrder;
            const supportWeight = Math.min(1, (counts.T + counts.X) / 10);
            const score = confidence * orderWeight * supportWeight;
            if (score > bestScore) { bestScore = score; bestPred = pred; }
        }
    }
    return bestPred;
}

function lc79_algoB_ngram(history) {
    if (history.length < 30) return null;
    const tx = history.map(h => h.tx);
    const ngramSizes = [];
    if (history.length >= 50) ngramSizes.push(5, 6);
    if (history.length >= 40) ngramSizes.push(4);
    ngramSizes.push(3, 2);
    let bestPred = null, bestConfidence = 0;
    for (const n of ngramSizes) {
        if (tx.length < n * 2) continue;
        const target = tx.slice(-n).join('');
        let matches = [];
        for (let i = 0; i <= tx.length - n - 1; i++) {
            const gram = tx.slice(i, i + n).join('');
            if (gram === target) matches.push({ position: i, next: tx[i + n], distance: tx.length - i });
        }
        if (matches.length >= 2) {
            const weights = { T: 0, X: 0 };
            let totalWeight = 0;
            for (const match of matches) {
                const weight = 1 / (match.distance * 0.5 + 1);
                weights[match.next] += weight;
                totalWeight += weight;
            }
            if (totalWeight > 0) {
                const tRatio = weights.T / totalWeight, xRatio = weights.X / totalWeight;
                const confidence = Math.abs(tRatio - xRatio);
                if (confidence > bestConfidence) { bestConfidence = confidence; bestPred = weights.T > weights.X ? 'T' : 'X'; }
            }
        }
    }
    return bestConfidence > 0.3 ? bestPred : null;
}

function lc79_algoS_NeoPattern(history) {
    if (history.length < 25) return null;
    const features = lc79_extractFeatures(history);
    const { runs, tx } = features;
    const patternType = lc79_detectPatternType(runs);
    if (!patternType || patternType === 'normal_pattern') return null;
    const lastTx = tx[tx.length - 1];
    let prediction = null;
    if (patternType === 'alternating_advanced') prediction = lastTx === 'T' ? 'X' : 'T';
    else if (patternType === 'continuation_advanced') prediction = lastTx;
    else if (patternType === 'break_advanced') prediction = lastTx === 'T' ? 'X' : 'T';
    else if (patternType === 'super_long_run') prediction = runs[runs.length - 1]?.len > 7 ? (lastTx === 'T' ? 'X' : 'T') : lastTx;
    else return null;
    const recentRuns = runs.slice(-Math.min(8, runs.length));
    const patternConsistency = recentRuns.filter(r => patternType.includes('alternating') || (patternType === 'super_long_run' && r.len >= 4)).length / recentRuns.length;
    return patternConsistency > 0.55 ? prediction : null;
}

function lc79_algoF_SuperDeepAnalysis(history) {
    if (history.length < 60) return null;
    const timeframes = [{ lookback: 10, weight: 0.3 }, { lookback: 30, weight: 0.4 }, { lookback: 60, weight: 0.3 }];
    let totalScore = { T: 0, X: 0 }, totalWeight = 0;
    for (const tf of timeframes) {
        if (history.length < tf.lookback) continue;
        const slice = history.slice(-tf.lookback);
        const sliceTx = slice.map(h => h.tx);
        const sliceTotals = slice.map(h => h.total);
        const tCount = sliceTx.filter(t => t === 'T').length;
        const xCount = sliceTx.filter(t => t === 'X').length;
        const meanTotal = lc79_avg(sliceTotals);
        const volatility = Math.sqrt(lc79_avg(sliceTotals.map(t => Math.pow(t - meanTotal, 2))));
        let tScore = 0, xScore = 0;
        if (meanTotal > 12) xScore += 0.4;
        if (meanTotal < 9) tScore += 0.4;
        if (tCount > xCount + 3) xScore += 0.3;
        if (xCount > tCount + 3) tScore += 0.3;
        if (volatility > 4) { if (sliceTx[sliceTx.length - 1] === 'T') tScore += 0.2; else xScore += 0.2; }
        const trend = sliceTotals[sliceTotals.length - 1] - sliceTotals[0];
        if (trend > 3) xScore += 0.1;
        if (trend < -3) tScore += 0.1;
        const tfWeight = tf.weight * (sliceTx.length / tf.lookback);
        totalScore.T += tScore * tfWeight;
        totalScore.X += xScore * tfWeight;
        totalWeight += tfWeight;
    }
    if (totalWeight > 0 && Math.abs(totalScore.T - totalScore.X) > 0.15) return totalScore.T > totalScore.X ? 'T' : 'X';
    return null;
}

function lc79_algoE_Transformer(history) {
    if (history.length < 100) return null;
    const tx = history.map(h => h.tx);
    const seqLengths = [6, 8, 10, 12];
    let attentionScores = { T: 0, X: 0 };
    for (const seqLen of seqLengths) {
        if (tx.length < seqLen * 2) continue;
        const targetSeq = tx.slice(-seqLen).join('');
        let seqMatches = 0;
        for (let i = 0; i <= tx.length - seqLen - 1; i++) {
            const historySeq = tx.slice(i, i + seqLen).join('');
            const matchScore = lc79_similarity(historySeq, targetSeq);
            if (matchScore >= 0.7) {
                const nextResult = tx[i + seqLen];
                const recency = 1 / (tx.length - i);
                const lengthFactor = seqLen / 12;
                const weight = matchScore * recency * lengthFactor;
                attentionScores[nextResult] = (attentionScores[nextResult] || 0) + weight;
                seqMatches++;
            }
        }
        if (seqMatches >= 3) {
            const boostFactor = Math.min(1.5, seqMatches / 2);
            attentionScores.T *= boostFactor;
            attentionScores.X *= boostFactor;
        }
    }
    if (attentionScores.T + attentionScores.X > 0.2) {
        const total = attentionScores.T + attentionScores.X;
        const confidence = Math.abs(attentionScores.T - attentionScores.X) / total;
        if (confidence > 0.25) return attentionScores.T > attentionScores.X ? 'T' : 'X';
    }
    return null;
}

function lc79_algoG_SuperBridgePredictor(history) {
    const features = lc79_extractFeatures(history);
    const { runs, tx } = features;
    if (runs.length < 4) return null;
    const lastRun = runs[runs.length - 1];
    let prediction = null, confidence = 0;
    if (lastRun.len >= 5) {
        if (lastRun.len >= 8) { prediction = lastRun.val === 'T' ? 'X' : 'T'; confidence = 0.8; }
        else if (lastRun.len >= 5 && lastRun.len <= 7) {
            const avgRunLength = lc79_avg(runs.map(r => r.len));
            if (lastRun.len > avgRunLength * 1.8) { prediction = lastRun.val === 'T' ? 'X' : 'T'; confidence = 0.65; }
            else { prediction = lastRun.val; confidence = 0.6; }
        }
    }
    if (!prediction && runs.length >= 5) {
        const last5Runs = runs.slice(-5);
        const lengths = last5Runs.map(r => r.len);
        if (lengths[0] === 1 && lengths[1] === 1 && lengths[2] >= 3) {
            if (lastRun.len >= 3) { prediction = lastRun.val === 'T' ? 'X' : 'T'; confidence = 0.7; }
        }
    }
    if (!prediction && runs.length >= 8) {
        const recentRuns = runs.slice(-8);
        const runLengths = recentRuns.map(r => r.len);
        const meanLength = lc79_avg(runLengths);
        const stdLength = Math.sqrt(lc79_avg(runLengths.map(l => Math.pow(l - meanLength, 2))));
        if (lastRun.len > meanLength + (stdLength * 1.5)) { prediction = lastRun.val === 'T' ? 'X' : 'T'; confidence = 0.6; }
    }
    return confidence > 0.55 ? prediction : null;
}

function lc79_algoH_AdaptiveMarkov(history) {
    if (history.length < 25) return null;
    const tx = history.map(h => h.tx);
    const models = [
        { type: 'markov', orders: [2, 3, 4] },
        { type: 'frequency', lookbacks: [10, 20, 30] },
        { type: 'momentum', windows: [5, 10, 15] }
    ];
    let ensembleVotes = { T: 0, X: 0 };
    for (const model of models) {
        if (model.type === 'markov') {
            for (const order of model.orders) {
                if (tx.length < order + 5) continue;
                const transitions = {};
                for (let i = 0; i <= tx.length - order - 1; i++) {
                    const key = tx.slice(i, i + order).join('');
                    const next = tx[i + order];
                    if (!transitions[key]) transitions[key] = { T: 0, X: 0 };
                    transitions[key][next]++;
                }
                const lastKey = tx.slice(-order).join('');
                const counts = transitions[lastKey];
                if (counts && counts.T + counts.X >= 2) {
                    const pred = counts.T > counts.X ? 'T' : 'X';
                    const confidence = Math.abs(counts.T - counts.X) / (counts.T + counts.X);
                    ensembleVotes[pred] += confidence * (order / 10);
                }
            }
        }
        if (model.type === 'frequency') {
            for (const lookback of model.lookbacks) {
                if (tx.length < lookback) continue;
                const recent = tx.slice(-lookback);
                const tCount = recent.filter(t => t === 'T').length;
                const xCount = recent.filter(t => t === 'X').length;
                if (Math.abs(tCount - xCount) > lookback * 0.2) {
                    const pred = tCount > xCount ? 'X' : 'T';
                    const confidence = Math.abs(tCount - xCount) / lookback;
                    ensembleVotes[pred] += confidence * 0.5;
                }
            }
        }
        if (model.type === 'momentum') {
            for (const window of model.windows) {
                if (tx.length < window * 2) continue;
                const firstHalf = tx.slice(-window * 2, -window);
                const secondHalf = tx.slice(-window);
                const firstT = firstHalf.filter(t => t === 'T').length;
                const firstX = firstHalf.filter(t => t === 'X').length;
                const secondT = secondHalf.filter(t => t === 'T').length;
                const secondX = secondHalf.filter(t => t === 'X').length;
                const momentumT = secondT - firstT, momentumX = secondX - firstX;
                if (Math.abs(momentumT - momentumX) > window * 0.3) {
                    const pred = momentumT > momentumX ? 'T' : 'X';
                    const confidence = Math.abs(momentumT - momentumX) / window;
                    ensembleVotes[pred] += confidence * 0.3;
                }
            }
        }
    }
    if (ensembleVotes.T + ensembleVotes.X > 0.3) return ensembleVotes.T > ensembleVotes.X ? 'T' : 'X';
    return null;
}

function lc79_algoI_PatternMaster(history) {
    if (history.length < 35) return null;
    const features = lc79_extractFeatures(history);
    const { runs, tx } = features;
    if (runs.length < 5) return null;
    const recentRuns = runs.slice(-Math.min(8, runs.length));
    const runLengths = recentRuns.map(r => r.len);
    const runValues = recentRuns.map(r => r.val);
    let patternStrength = { T: 0, X: 0 };
    const runPattern = runLengths.join('');
    const valuePattern = runValues.join('');
    const patternLibrary = [
        { pattern: '12121', prediction: valuePattern[valuePattern.length - 1] === 'T' ? 'X' : 'T', strength: 0.7 },
        { pattern: '21212', prediction: valuePattern[valuePattern.length - 1] === 'T' ? 'T' : 'X', strength: 0.7 },
        { pattern: '13131', prediction: valuePattern[valuePattern.length - 1], strength: 0.6 },
        { pattern: '31313', prediction: valuePattern[valuePattern.length - 1] === 'T' ? 'X' : 'T', strength: 0.6 },
        { pattern: '24242', prediction: valuePattern[valuePattern.length - 1] === 'T' ? 'X' : 'T', strength: 0.65 },
        { pattern: '42424', prediction: valuePattern[valuePattern.length - 1], strength: 0.65 }
    ];
    for (const libPattern of patternLibrary) {
        if (runPattern.includes(libPattern.pattern)) patternStrength[libPattern.prediction] += libPattern.strength;
    }
    const last10Tx = tx.slice(-10).join('');
    const txPatterns = [
        { pattern: 'TXTXTXTX', prediction: 'X', strength: 0.8 },
        { pattern: 'XTXTXTXT', prediction: 'T', strength: 0.8 },
        { pattern: 'TTXXTTXX', prediction: 'X', strength: 0.7 },
        { pattern: 'XXTTXXTT', prediction: 'T', strength: 0.7 }
    ];
    for (const txPattern of txPatterns) {
        if (last10Tx.includes(txPattern.pattern)) patternStrength[txPattern.prediction] += txPattern.strength;
    }
    const lastRun = recentRuns[recentRuns.length - 1];
    if (lastRun) {
        const avgRecentLength = lc79_avg(runLengths);
        if (lastRun.len > avgRecentLength * 1.8) patternStrength[lastRun.val === 'T' ? 'X' : 'T'] += 0.5;
        else if (lastRun.len < avgRecentLength * 0.6) patternStrength[lastRun.val] += 0.4;
    }
    if (patternStrength.T > 0 || patternStrength.X > 0) {
        const totalStrength = patternStrength.T + patternStrength.X;
        const confidence = Math.abs(patternStrength.T - patternStrength.X) / totalStrength;
        if (confidence > 0.3) return patternStrength.T > patternStrength.X ? 'T' : 'X';
    }
    return null;
}

function lc79_algoJ_QuantumEntropy(history) {
    if (history.length < 40) return null;
    const features = lc79_extractFeatures(history);
    const { entropy: e, tx, runs } = features;
    const entropyWindows = [10, 20, 30];
    let entropyPredictions = { T: 0, X: 0 };
    for (const window of entropyWindows) {
        if (tx.length < window) continue;
        const windowTx = tx.slice(-window);
        const windowEntropy = lc79_entropy(windowTx);
        if (windowEntropy < 0.3) {
            const lastVal = windowTx[windowTx.length - 1];
            entropyPredictions[lastVal] += 0.6;
        } else if (windowEntropy > 0.9) {
            const tCount = windowTx.filter(t => t === 'T').length;
            const xCount = windowTx.filter(t => t === 'X').length;
            if (tCount > xCount) entropyPredictions['X'] += 0.5;
            else if (xCount > tCount) entropyPredictions['T'] += 0.5;
        } else {
            const recentRuns = runs.slice(-4);
            if (recentRuns.length >= 3) {
                const runLengths = recentRuns.map(r => r.len);
                const isEmergingPattern = Math.max(...runLengths) - Math.min(...runLengths) <= 2;
                if (isEmergingPattern) {
                    const lastVal = tx[tx.length - 1];
                    entropyPredictions[lastVal] += 0.4;
                }
            }
        }
    }
    if (e < 0.4) { const lastVal = tx[tx.length - 1]; entropyPredictions[lastVal] += 0.3; }
    else if (e > 0.95) {
        const recentT = tx.slice(-20).filter(t => t === 'T').length;
        const recentX = tx.slice(-20).filter(t => t === 'X').length;
        if (recentT > recentX) entropyPredictions['X'] += 0.4;
        else if (recentX > recentT) entropyPredictions['T'] += 0.4;
    }
    if (entropyPredictions.T + entropyPredictions.X > 0.4) return entropyPredictions.T > entropyPredictions.X ? 'T' : 'X';
    return null;
}

function lc79_algoK_HyperMarkov(history) {
    if (history.length < 30) return null;
    const tx = history.map(h => h.tx);
    const orders = [2, 3, 4, 5, 6];
    let hyperVotes = { T: 0, X: 0 }, totalWeight = 0;
    for (const order of orders) {
        if (tx.length < order + 10) continue;
        const transitions = {};
        for (let i = 0; i <= tx.length - order - 1; i++) {
            const key = tx.slice(i, i + order).join('');
            const next = tx[i + order];
            const recency = Math.pow(0.98, tx.length - order - i);
            if (!transitions[key]) transitions[key] = { T: 0, X: 0 };
            transitions[key][next] += recency;
        }
        const lastKey = tx.slice(-order).join('');
        const counts = transitions[lastKey];
        if (counts && counts.T + counts.X >= 1) {
            const orderWeight = Math.pow(1.2, order - 2);
            const pred = counts.T > counts.X ? 'T' : 'X';
            const confidence = Math.abs(counts.T - counts.X) / (counts.T + counts.X);
            hyperVotes[pred] += confidence * orderWeight;
            totalWeight += orderWeight;
        }
    }
    if (totalWeight > 0) {
        const avgT = hyperVotes.T / totalWeight, avgX = hyperVotes.X / totalWeight;
        if (Math.abs(avgT - avgX) > 0.15) return avgT > avgX ? 'T' : 'X';
    }
    return null;
}

function lc79_algoL_CNN(history) {
    if (history.length < 50) return null;
    const tx = history.map(h => h.tx);
    const convPatterns = [
        { weights: [1, -1, 1], pred: 'alternate', bias: 0.2 },
        { weights: [1, 1, -1], pred: 'continue', bias: 0.1 },
        { weights: [-1, 1, 1], pred: 'continue', bias: 0.1 },
        { weights: [1, 1, 1], pred: 'break', bias: 0.3 }
    ];
    let scores = { T: 0, X: 0 };
    for (const cnn of convPatterns) {
        let sum = 0;
        const len = cnn.weights.length;
        for (let i = 0; i < len; i++) {
            const val = tx[tx.length - len + i] === 'T' ? 1 : -1;
            sum += val * cnn.weights[i];
        }
        sum += cnn.bias;
        const lastTx = tx[tx.length - 1];
        let pred = null;
        if (cnn.pred === 'alternate') pred = lastTx === 'T' ? 'X' : 'T';
        else if (cnn.pred === 'continue') pred = lastTx;
        else if (cnn.pred === 'break') pred = lastTx === 'T' ? 'X' : 'T';
        if (pred && Math.abs(sum) > 1) scores[pred] += Math.abs(sum) * 0.3;
    }
    const total = scores.T + scores.X;
    if (total > 0.5) return scores.T > scores.X ? 'T' : 'X';
    return null;
}

function lc79_algoM_LogisticRegression(history) {
    if (history.length < 40) return null;
    const tx = history.map(h => h.tx);
    const features = lc79_extractFeatures(history);
    const weights = {
        lastResult: 0.3,
        streakLength: -0.15,
        freqImbalance: -0.4,
        entropy: -0.2,
        momentum: 0.25
    };
    let score = 0;
    const lastTx = tx[tx.length - 1];
    score += (lastTx === 'T' ? 1 : -1) * weights.lastResult;
    const lastRun = features.runs[features.runs.length - 1];
    if (lastRun) score += Math.min(lastRun.len, 8) * weights.streakLength;
    const tFreq = features.freq['T'] || 0, xFreq = features.freq['X'] || 0;
    const imbalance = (tFreq - xFreq) / (tFreq + xFreq);
    score += imbalance * weights.freqImbalance;
    score += (features.entropy - 0.7) * weights.entropy;
    const momentum = features.trends.upward - features.trends.downward;
    score += momentum * weights.momentum * 0.1;
    const probT = 1 / (1 + Math.exp(-score * 2));
    if (Math.abs(probT - 0.5) > 0.12) return probT > 0.5 ? 'T' : 'X';
    return null;
}

function lc79_algoN_RandomForest(history) {
    if (history.length < 40) return null;
    const tx = history.map(h => h.tx);
    const features = lc79_extractFeatures(history);
    const votes = { T: 0, X: 0 };
    const lastTx = tx[tx.length - 1];
    const lastRun = features.runs[features.runs.length - 1];
    if (lastRun && lastRun.len >= 5) {
        const pred = lastRun.len >= 7 ? (lastRun.val === 'T' ? 'X' : 'T') : lastRun.val;
        votes[pred] += 1;
    }
    const tFreq = features.freq['T'] || 0, xFreq = features.freq['X'] || 0;
    if (Math.abs(tFreq - xFreq) > tx.length * 0.2) votes[tFreq > xFreq ? 'X' : 'T'] += 1;
    if (features.entropy < 0.4) votes[lastTx] += 1;
    else if (features.entropy > 0.9) votes[lastTx === 'T' ? 'X' : 'T'] += 1;
    const last3 = tx.slice(-3);
    if (last3.length === 3 && new Set(last3).size === 1) votes[lastTx === 'T' ? 'X' : 'T'] += 0.5;
    if (features.maxRun >= 4) {
        const longestRunVal = features.runs.reduce((a, b) => a.len > b.len ? a : b).val;
        votes[longestRunVal === 'T' ? 'X' : 'T'] += 0.7;
    }
    const total = votes.T + votes.X;
    if (total > 0.5) return votes.T > votes.X ? 'T' : 'X';
    return null;
}

function lc79_algoO_CycleAnalysis(history) {
    if (history.length < 30) return null;
    const tx = history.map(h => h.tx);
    const cycles = [4, 6, 8, 10, 12];
    let bestCycle = null, bestConfidence = 0;
    for (const cycle of cycles) {
        if (tx.length < cycle * 2) continue;
        let matches = 0;
        for (let i = 0; i < cycle; i++) {
            if (tx[tx.length - cycle + i] === tx[tx.length - cycle * 2 + i]) matches++;
        }
        const confidence = matches / cycle;
        if (confidence > bestConfidence) { bestConfidence = confidence; bestCycle = cycle; }
    }
    if (bestCycle && bestConfidence > 0.65) {
        const predictedNext = tx[tx.length - bestCycle];
        return predictedNext;
    }
    return null;
}

function lc79_algoP_BayesianInference(history) {
    if (history.length < 25) return null;
    const tx = history.map(h => h.tx);
    const priors = { T: 0.5, X: 0.5 };
    const tCount = tx.filter(t => t === 'T').length, xCount = tx.filter(t => t === 'X').length;
    priors.T = tCount / tx.length;
    priors.X = xCount / tx.length;
    const lastRun = tx[tx.length - 1];
    let streak = 1;
    for (let i = tx.length - 2; i >= 0; i--) if (tx[i] === lastRun) streak++; else break;
    const likeT = streak >= 4 ? 0.35 : 0.55;
    const likeX = streak >= 4 ? 0.65 : 0.45;
    const postT = priors.T * likeT;
    const postX = priors.X * likeX;
    const total = postT + postX;
    if (total === 0) return null;
    const probT = postT / total, probX = postX / total;
    if (Math.abs(probT - probX) > 0.15) return probT > probX ? 'T' : 'X';
    return null;
}

function lc79_algoQ_ChaosTheory(history) {
    if (history.length < 50) return null;
    const tx = history.map(h => h.tx);
    let divergence = [];
    for (let delta = 1; delta <= 5; delta++) {
        let differences = 0, count = 0;
        for (let i = 0; i < tx.length - delta; i++) {
            if (tx[i] !== tx[i + delta]) differences++;
            count++;
        }
        divergence.push(differences / count);
    }
    const embeddingDim = 3, delay = 2;
    let phaseSpace = [];
    for (let i = 0; i <= tx.length - embeddingDim * delay; i++) {
        const point = [];
        for (let d = 0; d < embeddingDim; d++) point.push(tx[i + d * delay] === 'T' ? 1 : 0);
        phaseSpace.push(point);
    }
    if (phaseSpace.length === 0) return null;
    const lastPoint = phaseSpace[phaseSpace.length - 1];
    let nearestNeighbor = null, minDistance = Infinity;
    for (let i = 0; i < phaseSpace.length - 1; i++) {
        const point = phaseSpace[i];
        let distance = 0;
        for (let j = 0; j < embeddingDim; j++) distance += Math.pow(point[j] - lastPoint[j], 2);
        distance = Math.sqrt(distance);
        if (distance < minDistance && distance > 0) { minDistance = distance; nearestNeighbor = i; }
    }
    if (nearestNeighbor !== null && minDistance < 0.5) {
        const nextIdx = nearestNeighbor + 1;
        if (nextIdx < tx.length) {
            const prediction = tx[nextIdx];
            const divergenceRate = divergence[divergence.length - 1];
            const confidence = Math.max(0, 0.8 - divergenceRate);
            if (confidence > 0.5) return prediction;
        }
    }
    return null;
}

function lc79_algoR_QuantumTunneling(history) {
    if (history.length < 40) return null;
    const features = lc79_extractFeatures(history);
    const { tx, entropy: e, runs } = features;
    let quantumState = { T: 0.5, X: 0.5 };
    const operators = [
        { name: 'entropy', threshold: 0.5, collapse: e < 0.4 ? 'T' : (e > 0.7 ? 'X' : null) },
        { name: 'run_operator', collapse: runs.length > 0 && runs[runs.length - 1].len >= 4 ? runs[runs.length - 1].val : null },
        { name: 'balance_operator', collapse: (() => {
            const recent20 = tx.slice(-20);
            const tCount = recent20.filter(v => v === 'T').length;
            if (tCount >= 14) return 'X';
            if (tCount <= 6) return 'T';
            return null;
        })() }
    ];
    for (const op of operators) {
        if (op.collapse) {
            quantumState[op.collapse] += 0.3;
            quantumState[op.collapse === 'T' ? 'X' : 'T'] -= 0.15;
        }
    }
    const tunnelingProb = Math.min(0.3, Math.max(0.05, 1 - e));
    quantumState.T = quantumState.T * (1 - tunnelingProb) + quantumState.X * tunnelingProb;
    quantumState.X = quantumState.X * (1 - tunnelingProb) + quantumState.T * tunnelingProb;
    const total = quantumState.T + quantumState.X;
    quantumState.T /= total;
    quantumState.X /= total;
    if (Math.abs(quantumState.T - quantumState.X) > 0.2) return quantumState.T > quantumState.X ? 'T' : 'X';
    return null;
}

function lc79_algoS_DeepResidual(history) {
    if (history.length < 70) return null;
    const tx = history.map(h => h.tx);
    const totals = history.map(h => h.total);
    let residual = { T: 0, X: 0 };
    const blocks = [
        { weights: [0.4, 0.3, 0.2, 0.1], lookback: 4 },
        { weights: [0.35, 0.25, 0.2, 0.12, 0.08], lookback: 5 },
        { weights: [0.3, 0.25, 0.2, 0.15, 0.07, 0.03], lookback: 6 }
    ];
    for (const block of blocks) {
        let weightedSum = 0;
        for (let i = 0; i < block.lookback && i < totals.length; i++) {
            weightedSum += (totals[totals.length - 1 - i] - 10.5) * block.weights[i];
        }
        const rawPrediction = weightedSum > 0 ? 'X' : 'T';
        const confidence = Math.min(0.8, Math.abs(weightedSum) / 10);
        if (rawPrediction === 'T') residual.T += confidence;
        else residual.X += confidence;
        const skipPred = tx[tx.length - 1 - block.lookback];
        if (skipPred === 'T') residual.T += 0.15;
        else residual.X += 0.15;
    }
    const last5Tx = tx.slice(-5);
    const last5T = last5Tx.filter(v => v === 'T').length;
    if (last5T >= 4) residual.T += 0.2;
    else if (last5T <= 1) residual.X += 0.2;
    if (Math.abs(residual.T - residual.X) > 0.3) return residual.T > residual.X ? 'T' : 'X';
    return null;
}

function lc79_algoT_GeneticAlgorithm(history) {
    if (history.length < 100) return null;
    const tx = history.map(h => h.tx);
    const populationSize = 20;
    let population = [];
    for (let i = 0; i < populationSize; i++) {
        population.push({
            lookback: Math.floor(Math.random() * 15) + 5,
            threshold: Math.random() * 0.4 + 0.3,
            bias: Math.random() * 0.6 - 0.3,
            weights: Array(5).fill(0).map(() => Math.random() * 2 - 1)
        });
    }
    const trainSize = Math.min(60, history.length - 20);
    for (const individual of population) {
        let correct = 0, total = 0;
        for (let i = trainSize; i < history.length - 1; i++) {
            const windowTx = tx.slice(i - individual.lookback, i);
            let score = individual.bias;
            for (let j = 0; j < Math.min(5, windowTx.length); j++) score += (windowTx[j] === 'T' ? 1 : -1) * individual.weights[j];
            const prediction = score > individual.threshold ? 'T' : 'X';
            if (prediction === tx[i]) correct++;
            total++;
        }
        individual.fitness = correct / total;
    }
    population.sort((a, b) => b.fitness - a.fitness);
    const best = population[0];
    if (best.fitness < 0.55) return null;
    const lastWindowTx = tx.slice(-best.lookback);
    let finalScore = best.bias;
    for (let j = 0; j < Math.min(5, lastWindowTx.length); j++) finalScore += (lastWindowTx[j] === 'T' ? 1 : -1) * best.weights[j];
    return finalScore > best.threshold ? 'T' : 'X';
}

function lc79_algoV_AllBridgesAndAntiBreak(history) {
    if (history.length < 15) return null;
    const features = lc79_extractFeatures(history);
    const { runs, tx } = features;
    const lastRun = runs[runs.length - 1];
    const lastTx = tx[tx.length - 1];
    let detectedBridge = null, bridgeConfidence = 0.5;
    if (lastRun && lastRun.len >= 4) { detectedBridge = 'cau_bet'; bridgeConfidence = lastRun.len >= 7 ? 0.65 : (lastRun.len >= 5 ? 0.75 : 0.8); }
    if (!detectedBridge && runs.length >= 4) {
        const last4 = runs.slice(-4);
        if (last4.every(r => r.len === 1) && last4[0].val !== last4[1].val && last4[1].val !== last4[2].val && last4[2].val !== last4[3].val) {
            detectedBridge = 'cau_1_1'; bridgeConfidence = 0.85;
        }
    }
    if (!detectedBridge && runs.length >= 4) {
        const last4 = runs.slice(-4);
        if (last4.every(r => r.len === 2) && last4[0].val !== last4[1].val && last4[1].val !== last4[2].val && last4[2].val !== last4[3].val) {
            detectedBridge = 'cau_2_2'; bridgeConfidence = (lastRun.len === 2) ? 0.9 : 0.8;
        }
    }
    if (!detectedBridge && runs.length >= 4) {
        const last4 = runs.slice(-4);
        if (last4.every(r => r.len === 3) && last4[0].val !== last4[1].val && last4[1].val !== last4[2].val && last4[2].val !== last4[3].val) {
            detectedBridge = 'cau_3_3'; bridgeConfidence = (lastRun.len === 3) ? 0.9 : 0.85;
        }
    }
    if (!detectedBridge && runs.length >= 4) {
        const lens = runs.slice(-4).map(r => r.len);
        let increasing = true;
        for (let i = 1; i < lens.length; i++) if (lens[i] <= lens[i - 1]) { increasing = false; break; }
        if (increasing) { detectedBridge = 'cau_nghieng_tang'; bridgeConfidence = 0.8; }
    }
    if (!detectedBridge && runs.length >= 5) {
        const last5Lens = runs.slice(-5).map(r => r.len);
        const patternStr = last5Lens.join('');
        const patterns = { '123': 0.8, '321': 0.8, '131': 0.75, '121': 0.75, '212': 0.75, '313': 0.7, '141': 0.7 };
        for (const [pat, conf] of Object.entries(patterns)) {
            if (patternStr.includes(pat)) { detectedBridge = `cau_nhay_${pat}`; bridgeConfidence = conf; break; }
        }
    }
    if (!detectedBridge) {
        const localEntropy = lc79_entropy(tx.slice(-20));
        if (localEntropy < 0.4) detectedBridge = 'xu_huong_bet_nhe';
        else if (localEntropy > 0.9) detectedBridge = 'xu_huong_dao_chieu';
        else detectedBridge = 'khong_ro_cau';
    }
    let prediction = null, baseConfidence = bridgeConfidence;
    switch (detectedBridge) {
        case 'cau_bet': prediction = lastRun.len >= 7 ? (lastRun.val === 'T' ? 'X' : 'T') : lastRun.val; break;
        case 'cau_1_1': prediction = lastTx === 'T' ? 'X' : 'T'; break;
        case 'cau_2_2': prediction = lastRun.len === 2 ? (lastRun.val === 'T' ? 'X' : 'T') : lastRun.val; break;
        case 'cau_3_3': prediction = lastRun.len === 3 ? (lastRun.val === 'T' ? 'X' : 'T') : lastRun.val; break;
        case 'cau_nghieng_tang': prediction = lastRun.len < (runs[runs.length - 2]?.len || 0) + 1 ? lastRun.val : (lastRun.val === 'T' ? 'X' : 'T'); break;
        case 'cau_nhay_123': case 'cau_nhay_321': case 'cau_nhay_121': case 'cau_nhay_212': case 'cau_nhay_313':
            prediction = lastTx === 'T' ? 'X' : 'T'; break;
        case 'cau_nhay_131': case 'cau_nhay_141': prediction = lastTx === 'T' ? 'T' : 'X'; break;
        case 'xu_huong_bet_nhe': prediction = lastTx; baseConfidence = 0.6; break;
        case 'xu_huong_dao_chieu': prediction = lastTx === 'T' ? 'X' : 'T'; baseConfidence = 0.6; break;
        default:
            const recent10 = tx.slice(-10);
            const tCount = recent10.filter(t => t === 'T').length;
            prediction = tCount >= 6 ? 'X' : (tCount <= 4 ? 'T' : (lastTx === 'T' ? 'X' : 'T'));
            baseConfidence = 0.55;
    }
    const runLengths = runs.map(r => r.len);
    const avgRunLen = lc79_avg(runLengths);
    const maxRunLen = Math.max(...runLengths);
    const currentRunLen = lastRun ? lastRun.len : 0;
    let breakRisk = false;
    if (currentRunLen > avgRunLen * 1.8 || currentRunLen >= maxRunLen - 1) breakRisk = true;
    const recentEntropy = lc79_entropy(tx.slice(-10));
    const globalEnt = lc79_entropy(tx);
    if (recentEntropy > globalEnt + 0.2) breakRisk = true;
    let finalPrediction = breakRisk ? (prediction === 'T' ? 'X' : 'T') : prediction;
    let finalConfidence = breakRisk ? Math.max(0.6, baseConfidence * 0.9) : baseConfidence;
    return finalConfidence >= 0.55 ? finalPrediction : null;
}

const ALL_ALGS = [
    { id: 'algo5_freqrebalance', fn: lc79_algo5_freqRebalance },
    { id: 'a_markov', fn: lc79_algoA_markov },
    { id: 'b_ngram', fn: lc79_algoB_ngram },
    { id: 's_neo_pattern', fn: lc79_algoS_NeoPattern },
    { id: 'f_super_deep_analysis', fn: lc79_algoF_SuperDeepAnalysis },
    { id: 'e_transformer', fn: lc79_algoE_Transformer },
    { id: 'g_super_bridge_predictor', fn: lc79_algoG_SuperBridgePredictor },
    { id: 'h_adaptive_markov', fn: lc79_algoH_AdaptiveMarkov },
    { id: 'i_pattern_master', fn: lc79_algoI_PatternMaster },
    { id: 'j_quantum_entropy', fn: lc79_algoJ_QuantumEntropy },
    { id: 'k_hyper_markov', fn: lc79_algoK_HyperMarkov },
    { id: 'l_cnn_simulator', fn: lc79_algoL_CNN },
    { id: 'm_logistic_regression', fn: lc79_algoM_LogisticRegression },
    { id: 'n_random_forest', fn: lc79_algoN_RandomForest },
    { id: 'o_cycle_analysis', fn: lc79_algoO_CycleAnalysis },
    { id: 'p_bayesian', fn: lc79_algoP_BayesianInference },
    { id: 'q_chaos_theory', fn: lc79_algoQ_ChaosTheory },
    { id: 'r_quantum_tunneling', fn: lc79_algoR_QuantumTunneling },
    { id: 's_deep_residual', fn: lc79_algoS_DeepResidual },
    { id: 't_genetic', fn: lc79_algoT_GeneticAlgorithm },
    { id: 'v_all_bridges_antibreak', fn: lc79_algoV_AllBridgesAndAntiBreak }
];

// =================================================================================================
// NẠP 11 FILE JSON VÀO BỘ NHỚ (DATA_STORE)
// =================================================================================================
function loadAllJsonData() {
    log("Loading all 11 JSON data files into DATA_STORE...");
    const jsonFiles = [
        { path: 'lc79_md5.json', game: 'lc79', table: 'md5' },
        { path: 'sicbo_luckywin.json', game: 'luckywin', table: 'main' },
        { path: 'b52_md5.json', game: 'b52', table: 'md5' },
        { path: 'hitclub_md5.json', game: 'hitclub', table: 'md5' },
        { path: 'betvip_md5.json', game: 'betvip', table: 'md5' },
        { path: 'rikvip_hu.json', game: 'rikvip', table: 'hu' },
        { path: 'sicbo_sumclub.json', game: 'sumclub', table: 'hu' },
        { path: 'betvip_hu.json', game: 'betvip', table: 'hu' },
        { path: 'hitclub_hu.json', game: 'hitclub', table: 'hu' },
        { path: 'lc79_hu.json', game: 'lc79', table: 'hu' },
        { path: 'b52_hu.json', game: 'b52', table: 'hu' }
    ];
    for (const fileInfo of jsonFiles) {
        try {
            if (!fs.existsSync(fileInfo.path)) { log(`File not found: ${fileInfo.path}`); continue; }
            const content = fs.readFileSync(fileInfo.path, 'utf8');
            const data = JSON.parse(content);
            if (data.history && Array.isArray(data.history)) {
                if (!DATA_STORE[fileInfo.game]) DATA_STORE[fileInfo.game] = {};
                if (!DATA_STORE[fileInfo.game][fileInfo.table]) DATA_STORE[fileInfo.game][fileInfo.table] = [];
                const target = DATA_STORE[fileInfo.game][fileInfo.table];
                target.length = 0;
                if (data.history.length > 0 && typeof data.history[0] === 'string') {
                    const basePhien = data.last_phien || 1000000;
                    data.history.forEach((result, idx) => {
                        const phien = basePhien - data.history.length + idx + 1;
                        const kq = result === 'T' ? 'Tài' : 'Xỉu';
                        target.push({
                            phien: phien, xuc_xac: [0, 0, 0],
                            tong: result === 'T' ? 11 : 10, ket_qua: kq, fromJson: true
                        });
                    });
                } else if (data.history.length > 0 && typeof data.history[0] === 'object') {
                    target.push(...data.history);
                }
                log(`Loaded ${target.length} records from ${fileInfo.path} → ${fileInfo.game}/${fileInfo.table}`);
            }
        } catch (err) {
            logError(`Error loading ${fileInfo.path}:`, err.message);
        }
    }
    log("All 11 JSON files loaded.");
}

log("Đã định nghĩa xong tất cả algo A-Z + nạp 11 file JSON (PHẦN 6/8).");// =================================================================================================
// JSON PREDICTOR ENGINE - Dựa trên book + anti + pred_log + model_stats đã học sẵn
// Áp dụng cho: b52, hitclub, rikvip, betvip, lc79, sumclub, luckywin
// =================================================================================================

// ---------- Nạp 1 file JSON vào state ----------
function load_json_predictor_state(key) {
    const cfg = JSON_FILE_MAP[key];
    if (!cfg) return false;
    try {
        if (!fs.existsSync(cfg.file)) {
            log(`[JSON-PREDICTOR] File not found: ${cfg.file}`);
            return false;
        }
        const raw = fs.readFileSync(cfg.file, 'utf8');
        const data = JSON.parse(raw);
        JSON_PREDICTOR_STATE[key] = {
            history: Array.isArray(data.history) ? data.history : [],
            book: data.book || {},
            anti: data.anti || {},
            pred_log: Array.isArray(data.pred_log) ? data.pred_log : [],
            model_stats: data.model_stats || {},
            last_pred: data.last_pred || null,
            last_phien: data.last_phien || null,
            game: cfg.game, table: cfg.table, file: cfg.file, src: cfg.src,
            dirty: false, loadedAt: new Date().toISOString()
        };
        log(`[JSON-PREDICTOR] Loaded ${key} from ${cfg.file}: ${JSON_PREDICTOR_STATE[key].history.length} history, ${Object.keys(JSON_PREDICTOR_STATE[key].book).length} patterns, ${Object.keys(JSON_PREDICTOR_STATE[key].anti).length} anti, ${JSON_PREDICTOR_STATE[key].pred_log.length} pred_log`);
        return true;
    } catch (e) {
        logError(`[JSON-PREDICTOR] Load ${key} error:`, e.message);
        return false;
    }
}

// ---------- Lưu state xuống file JSON ----------
function save_json_predictor_state(key) {
    const st = JSON_PREDICTOR_STATE[key];
    if (!st) return false;
    try {
        const toSave = {
            history: st.history, book: st.book, anti: st.anti,
            pred_log: st.pred_log, model_stats: st.model_stats,
            last_pred: st.last_pred, last_phien: st.last_phien
        };
        fs.writeFileSync(st.file, JSON.stringify(toSave, null, 2));
        st.dirty = false;
        return true;
    } catch (e) {
        logError(`[JSON-PREDICTOR] Save ${key} error:`, e.message);
        return false;
    }
}

// ---------- Nạp TẤT CẢ file JSON ----------
function load_all_json_predictors() {
    log("[JSON-PREDICTOR] Loading all JSON predictor files...");
    let count = 0;
    for (const key in JSON_FILE_MAP) {
        if (load_json_predictor_state(key)) count++;
    }
    log(`[JSON-PREDICTOR] Loaded ${count}/${Object.keys(JSON_FILE_MAP).length} files.`);
}

// ---------- Lấy history_tx mới nhất (ưu tiên DATA_STORE realtime) ----------
function get_latest_history_tx(key) {
    const st = JSON_PREDICTOR_STATE[key];
    if (!st) return [];
    const cfg = JSON_FILE_MAP[key];

    // 1. Ưu tiên DATA_STORE (realtime worker) — full.py games
    if (cfg.src === 'full_py' && DATA_STORE[cfg.game] && DATA_STORE[cfg.game][cfg.table]) {
        const arr = DATA_STORE[cfg.game][cfg.table];
        // arr mới nhất ở index 0 → đảo để TX mới nhất ở cuối
        const tx = arr.slice(0, 50).map(r => r.ket_qua === 'Tài' ? 'T' : 'X').reverse();
        if (tx.length >= 2) return tx;
    }

    // 2. Fallback: dùng history từ file JSON state (string array, mới nhất ở index 0)
    if (st.history && st.history.length > 0) {
        const tx = st.history.slice(0, 50).reverse();
        if (tx.length >= 2) return tx;
    }

    // 3. Fallback sicbo: lấy từ mảng tương ứng
    if (cfg.src === 'sicbo') {
        if (key === 'sumclub_hu' && sumclub_history.length > 0) {
            return sumclub_history.slice(0, 50).reverse().map(h => h.resultType === 1 ? 'T' : 'X');
        }
        if (key === 'luckywin_main' && luckywin_history.length > 0) {
            return luckywin_history.slice(0, 50).reverse().map(h => h.resultType === 1 ? 'T' : 'X');
        }
    }

    return [];
}

// ---------- Lấy tất cả pattern candidates (dài → ngắn) ----------
function get_all_candidate_patterns(history_array, maxLen = 8) {
    if (!history_array || history_array.length === 0) return [];
    const result = [];
    const startLen = Math.min(history_array.length, maxLen);
    for (let len = startLen; len >= 2; len--) {
        const suffix = history_array.slice(-len);
        result.push({ pattern: suffix.join(''), len: len, suffix: suffix });
    }
    return result;
}

// ---------- Dự đoán từ book + anti + model_stats ----------
function predict_from_json_book(key, history_tx) {
    const st = JSON_PREDICTOR_STATE[key];
    if (!st) return { prediction: null, confidence: 0, source: 'no_state', pattern_used: null };
    if (!history_tx || history_tx.length < 2) return { prediction: null, confidence: 0, source: 'not_enough_history', pattern_used: null };

    const candidates = get_all_candidate_patterns(history_tx, 8);

    for (const cand of candidates) {
        const pat = cand.pattern;
        if (st.book[pat]) {
            const bk = st.book[pat];
            const countT = bk.T || 0, countX = bk.X || 0;
            const total = bk.count || (countT + countX);
            if (total < 3) continue;

            let predT = countT / total, predX = countX / total;
            let pred, conf = 0;

            if (predT > predX) { pred = 'T'; conf = predT; }
            else if (predX > predT) { pred = 'X'; conf = predX; }
            else { continue; } // hòa → thử pattern ngắn hơn

            // Anti — nếu pattern đã sai nhiều lần → đảo
            if (st.anti[pat] && st.anti[pat].flip === true && st.anti[pat].wrong >= 1) {
                pred = pred === 'T' ? 'X' : 'T';
                conf = Math.max(0.5, conf - 0.1);
            }

            // Model stats — điều chỉnh confidence
            if (st.model_stats[pat]) {
                const ms = st.model_stats[pat];
                const total_pred = ms.total || 0;
                if (total_pred >= 3) {
                    const accuracy = (ms.correct || 0) / total_pred;
                    if (accuracy > 0.7) conf = Math.min(0.95, conf + 0.05);
                    else if (accuracy < 0.4) conf = Math.max(0.5, conf - 0.1);
                }
            }

            return {
                prediction: pred,
                confidence: Math.round(conf * 1000) / 10,
                source: 'book',
                pattern_used: pat,
                pattern_len: cand.len,
                book_stats: { T: countT, X: countX, total: total }
            };
        }
    }

    // Fallback: đa số 5 phiên gần nhất
    const last5 = history_tx.slice(-5);
    const tCount = last5.filter(x => x === 'T').length;
    const xCount = last5.length - tCount;
    if (tCount > xCount) return { prediction: 'T', confidence: 55, source: 'fallback_last5', pattern_used: null };
    if (xCount > tCount) return { prediction: 'X', confidence: 55, source: 'fallback_last5', pattern_used: null };
    return { prediction: null, confidence: 0, source: 'no_pattern_no_fallback', pattern_used: null };
}

// ---------- Cập nhật book khi có kết quả mới ----------
function update_json_book_with_actual(key, history_tx, actual, pattern_len_max = 6) {
    const st = JSON_PREDICTOR_STATE[key];
    if (!st || !actual || (actual !== 'T' && actual !== 'X')) return 0;
    const startLen = Math.min(pattern_len_max, history_tx.length);
    let updated = 0;
    for (let len = 2; len <= startLen; len++) {
        const suffix = history_tx.slice(-len);
        if (suffix.length < len) continue;
        const pattern = suffix.join('');
        if (!st.book[pattern]) st.book[pattern] = { T: 0, X: 0, count: 0 };
        st.book[pattern][actual] = (st.book[pattern][actual] || 0) + 1;
        st.book[pattern].count = (st.book[pattern].count || 0) + 1;
        updated++;
    }
    if (updated > 0) st.dirty = true;
    return updated;
}

// ---------- Cập nhật anti + model_stats khi verify ----------
function update_json_anti_and_stats(key, pattern, predicted, actual) {
    const st = JSON_PREDICTOR_STATE[key];
    if (!st || !pattern) return;
    const isCorrect = (predicted === actual);

    if (!st.model_stats[pattern]) st.model_stats[pattern] = { total: 0, correct: 0, wrong: 0, flipped: 0 };
    st.model_stats[pattern].total++;
    if (isCorrect) st.model_stats[pattern].correct++;
    else st.model_stats[pattern].wrong++;

    // Nếu pattern sai >= 2 lần và sai > đúng → bật anti.flip
    const ms = st.model_stats[pattern];
    if (ms.wrong >= 2 && ms.wrong > ms.correct) {
        if (!st.anti[pattern]) st.anti[pattern] = { wrong: 0, original: predicted, flip: true };
        st.anti[pattern].wrong = ms.wrong;
        st.anti[pattern].flip = true;
    }

    st.last_pred = { pattern, predicted, actual, correct: isCorrect, timestamp: new Date().toISOString() };

    st.pred_log.push({
        phien: st.last_phien, pattern,
        pred: predicted === 'T' ? 'Tài' : 'Xỉu',
        actual: actual === 'T' ? 'Tài' : 'Xỉu',
        correct: isCorrect,
        flipped: !!(st.anti[pattern] && st.anti[pattern].flip),
        timestamp: new Date().toISOString()
    });
    if (st.pred_log.length > 200) st.pred_log = st.pred_log.slice(-200);

    st.dirty = true;
}

// =================================================================================================
// API DỰ ĐOÁN TỪ JSON BOOK
// =================================================================================================

app_get_json_predict = null; // placeholder (sẽ khai báo trong PHẦN 8 khi app khởi tạo)

function json_predict_handler(req, res) {
    const game = req.params.game.toLowerCase();
    const table = req.params.table.toLowerCase();
    const key = `${game}_${table}`;
    const st = JSON_PREDICTOR_STATE[key];

    if (!st) {
        return res.status(404).json({
            success: false,
            error: `Không có file JSON predictor cho ${game}/${table}`,
            available: Object.keys(JSON_PREDICTOR_STATE)
        });
    }

    try {
        const history_tx = get_latest_history_tx(key);
        if (history_tx.length < 3) {
            return res.json({
                success: false,
                error: `Chưa đủ dữ liệu (${history_tx.length} phiên, cần >= 3)`,
                game, table
            });
        }

        // BƯỚC 1: VERIFY DỰ ĐOÁN TRƯỚC ĐÓ
        if (st.last_pred && st.last_pred.pattern && !st.last_pred.verified) {
            const actualLatest = history_tx[history_tx.length - 1];
            if (st.last_pred.predicted && actualLatest) {
                update_json_anti_and_stats(key, st.last_pred.pattern, st.last_pred.predicted, actualLatest);
                st.last_pred.verified = true;
            }
        }

        // BƯỚC 2: TRA BOOK ĐỂ DỰ ĐOÁN PHIÊN TIẾP (bỏ phiên cuối vì đã có kết quả)
        const history_for_lookup = history_tx.slice(0, -1);
        if (history_for_lookup.length < 2) {
            return res.json({ success: false, error: 'Chưa đủ dữ liệu để tra cứu (cần >= 3 phiên)', game, table });
        }

        const result = predict_from_json_book(key, history_for_lookup);
        if (!result.prediction) {
            return res.json({
                success: false,
                error: 'Không tìm được pattern khớp trong book',
                game, table,
                history_tx_len: history_tx.length,
                candidates_tried: get_all_candidate_patterns(history_for_lookup, 8).map(c => c.pattern)
            });
        }

        // BƯỚC 3: LƯU last_pred
        let latest_phien = null;
        const cfg = JSON_FILE_MAP[key];
        if (cfg.src === 'full_py' && DATA_STORE[cfg.game] && DATA_STORE[cfg.game][cfg.table] && DATA_STORE[cfg.game][cfg.table][0]) {
            latest_phien = DATA_STORE[cfg.game][cfg.table][0].phien;
        } else if (st.last_phien) {
            latest_phien = st.last_phien;
        }

        st.last_pred = {
            pattern: result.pattern_used, predicted: result.prediction,
            actual: null, verified: false, phien: latest_phien,
            confidence: result.confidence, timestamp: new Date().toISOString()
        };
        st.dirty = true;
        save_json_predictor_state(key);

        // BƯỚC 4: TRẢ VỀ
        res.json({
            success: true,
            game, table,
            phien_hien_tai: latest_phien,
            history_tx: history_tx.join(''),
            history_for_lookup: history_for_lookup.join(''),
            du_doan: result.prediction === 'T' ? 'Tài' : 'Xỉu',
            du_doan_raw: result.prediction,
            do_tin_cay: result.confidence,
            source: result.source,
            pattern_su_dung: result.pattern_used,
            pattern_len: result.pattern_len,
            book_stats: result.book_stats,
            anti_info: st.anti[result.pattern_used] || null,
            model_stats: st.model_stats[result.pattern_used] || null,
            so_pattern_da_hoc: Object.keys(st.book).length,
            so_anti: Object.keys(st.anti).length,
            so_pred_log: st.pred_log.length
        });
    } catch (e) {
        logError(`/json-predict/${game}/${table}:`, e.message);
        res.status(500).json({ success: false, error: e.message });
    }
}

// ---------- API xem state ----------
function json_state_handler(req, res) {
    const key = `${req.params.game.toLowerCase()}_${req.params.table.toLowerCase()}`;
    const st = JSON_PREDICTOR_STATE[key];
    if (!st) return res.status(404).json({ success: false, error: 'Not found', available: Object.keys(JSON_PREDICTOR_STATE) });
    res.json({
        success: true, key, file: st.file,
        history_len: st.history.length,
        book_patterns: Object.keys(st.book).length,
        anti_patterns: Object.keys(st.anti).length,
        pred_log_len: st.pred_log.length,
        model_stats_len: Object.keys(st.model_stats).length,
        last_pred: st.last_pred, last_phien: st.last_phien,
        loadedAt: st.loadedAt
    });
}

// ---------- API liệt kê tất cả ----------
function json_list_handler(req, res) {
    const out = {};
    for (const key in JSON_PREDICTOR_STATE) {
        const st = JSON_PREDICTOR_STATE[key];
        out[key] = {
            file: st.file, game: st.game, table: st.table,
            history_len: st.history.length,
            book_patterns: Object.keys(st.book).length,
            anti_patterns: Object.keys(st.anti).length,
            pred_log_len: st.pred_log.length,
            model_stats_len: Object.keys(st.model_stats).length,
            last_phien: st.last_phien,
            endpoint: `/json-predict/${st.game}/${st.table}`,
            dirty: st.dirty
        };
    }
    res.json({ success: true, total: Object.keys(out).length, predictors: out });
}

// ---------- API dự đoán tất cả 1 lần ----------
async function json_predict_all_handler(req, res) {
    const results = {};
    for (const key in JSON_PREDICTOR_STATE) {
        const st = JSON_PREDICTOR_STATE[key];
        try {
            const history_tx = get_latest_history_tx(key);
            if (history_tx.length < 3) { results[key] = { success: false, error: 'Chưa đủ dữ liệu' }; continue; }
            const history_for_lookup = history_tx.slice(0, -1);
            const result = predict_from_json_book(key, history_for_lookup);
            results[key] = result.prediction
                ? { success: true, game: st.game, table: st.table, du_doan: result.prediction === 'T' ? 'Tài' : 'Xỉu', do_tin_cay: result.confidence, pattern_su_dung: result.pattern_used, source: result.source }
                : { success: false, error: 'Không tìm được pattern khớp' };
        } catch (e) { results[key] = { success: false, error: e.message }; }
    }
    res.json({ success: true, timestamp: new Date().toISOString(), total: Object.keys(results).length, results });
}

// ---------- API cập nhật book thủ công ----------
async function json_update_book_handler(req, res) {
    const key = `${req.params.game.toLowerCase()}_${req.params.table.toLowerCase()}`;
    const st = JSON_PREDICTOR_STATE[key];
    if (!st) return res.status(404).json({ success: false, error: 'Not found', available: Object.keys(JSON_PREDICTOR_STATE) });
    try {
        const history_tx = get_latest_history_tx(key);
        if (history_tx.length < 3) return res.json({ success: false, error: 'Cần >= 3 phiên' });
        const actual = history_tx[history_tx.length - 1];
        const history_before = history_tx.slice(0, -1);
        const updated = update_json_book_with_actual(key, history_before, actual, 6);
        const cfg = JSON_FILE_MAP[key];
        if (cfg.src === 'full_py' && DATA_STORE[cfg.game] && DATA_STORE[cfg.game][cfg.table] && DATA_STORE[cfg.game][cfg.table][0]) {
            st.last_phien = DATA_STORE[cfg.game][cfg.table][0].phien;
        }
        if (st.dirty) save_json_predictor_state(key);
        res.json({
            success: true, key, updated_patterns: updated,
            total_book_patterns: Object.keys(st.book).length,
            actual_result: actual === 'T' ? 'Tài' : 'Xỉu',
            last_phien: st.last_phien, history_tx: history_tx.join('')
        });
    } catch (e) {
        logError(`/json-update-book/${key}:`, e.message);
        res.status(500).json({ success: false, error: e.message });
    }
}

// ---------- API reset book ----------
function json_reset_handler(req, res) {
    const key = `${req.params.game.toLowerCase()}_${req.params.table.toLowerCase()}`;
    if (!JSON_FILE_MAP[key]) return res.status(404).json({ success: false, error: 'Not found' });
    const ok = load_json_predictor_state(key);
    res.json({ success: ok, key, message: ok ? 'Reset OK' : 'Reset failed' });
}

// =================================================================================================
// AUTO-TASK: TỰ ĐỘNG CẬP NHẬT BOOK MỖI 30 GIÂY
// =================================================================================================
function start_json_auto_update_task() {
    log("[JSON-PREDICTOR] Auto-update task started (every 30s)");
    const task = async () => {
        for (const key in JSON_PREDICTOR_STATE) {
            const st = JSON_PREDICTOR_STATE[key];
            try {
                const cfg = JSON_FILE_MAP[key];
                if (!cfg) continue;
                const history_tx = get_latest_history_tx(key);
                if (history_tx.length < 3) continue;

                let current_phien = null;
                if (cfg.src === 'full_py' && DATA_STORE[cfg.game] && DATA_STORE[cfg.game][cfg.table] && DATA_STORE[cfg.game][cfg.table][0]) {
                    current_phien = DATA_STORE[cfg.game][cfg.table][0].phien;
                } else if (cfg.src === 'sicbo') {
                    if (key === 'sumclub_hu' && sumclub_history[0]) current_phien = sumclub_history[0].gameNum;
                    else if (key === 'luckywin_main' && luckywin_history[0]) current_phien = luckywin_history[0].gameNum;
                }

                if (current_phien && current_phien !== st.last_phien) {
                    const actual = history_tx[history_tx.length - 1];
                    const history_before = history_tx.slice(0, -1);
                    update_json_book_with_actual(key, history_before, actual, 6);

                    if (st.last_pred && !st.last_pred.verified) {
                        update_json_anti_and_stats(key, st.last_pred.pattern, st.last_pred.predicted, actual);
                        st.last_pred.verified = true;
                    }

                    st.last_phien = current_phien;
                    st.dirty = true;
                    save_json_predictor_state(key);
                    log(`[JSON-PREDICTOR] Auto-updated ${key} phien ${current_phien} → ${actual}`);
                }
            } catch (e) {
                logError(`[JSON-PREDICTOR] Auto-update ${key}:`, e.message);
            }
        }
    };
    setInterval(task, 30000);
}

log("Đã định nghĩa xong JSON PREDICTOR ENGINE + routes (PHẦN 7/8).");// =================================================================================================
// EXPRESS SERVER + TẤT CẢ ROUTES
// =================================================================================================
const app = express();
app.use(express.json());

app.use((req, res, next) => {
    log(`${req.method} ${req.url}`);
    next();
});

// ---------- ROUTE GỐC ----------
app.get('/', (req, res) => {
    res.json({
        status: "ALL-IN-ONE Tài Xỉu API đang chạy",
        port: PORT,
        version: "FULL 100% - KHÔNG RÚT GỌN",
        active_games: Object.keys(GAME_STATUS).filter(k => GAME_STATUS[k]),
        json_predictors_loaded: Object.keys(JSON_PREDICTOR_STATE).length,
        endpoints: {
            "JSON-PREDICT (book + anti + model_stats đã học sẵn)": [
                "GET /json-predict/:game/:table",
                "GET /json-predict-all",
                "GET /json-predictors",
                "GET /json-predict-state/:game/:table",
                "GET /json-update-book/:game/:table",
                "GET /json-reset-book/:game/:table"
            ],
            "LC79 (engine nâng cao 40+ pattern)": [
                "GET /lc79-hu",
                "GET /lc79-md5",
                "GET /lc79-hu/lichsu",
                "GET /lc79-md5/lichsu",
                "GET /lc79-hu/analysis",
                "GET /lc79-md5/analysis",
                "GET /lc79-hu/learning",
                "GET /lc79-md5/learning",
                "GET /reset-learning"
            ],
            "full.py (dữ liệu + dự đoán cho tất cả game)": [
                "GET /predict/:game/:table",
                "GET /predict/all",
                "GET /api/:game/:table?",
                "GET /api/status",
                "GET /games"
            ],
            "xocdia88": [
                "GET /api/xocdia88/hu",
                "GET /api/xocdia88/md5",
                "GET /predict/xocdia88/hu",
                "GET /predict/xocdia88/md5"
            ],
            "sicbo": [
                "GET /sicbo/sumclub",
                "GET /sicbo/sunlive",
                "GET /sicbo/luckywin",
                "GET /sicbo/sumclub/history",
                "GET /sicbo/sunlive/history",
                "GET /sicbo/luckywin/history",
                "GET /predict/sicbo/sumclub",
                "GET /predict/sicbo/sunlive",
                "GET /predict/sicbo/luckywin"
            ],
            "sicbosum": [
                "GET /sicbo",
                "GET /sicbo_raw",
                "GET /predict/sicbosum"
            ]
        }
    });
});

// =================================================================================================
// ROUTES TỪ full.py
// =================================================================================================
app.get("/api/status", (req, res) => {
    const counts = {};
    for (const g in DATA_STORE) {
        counts[g] = {};
        for (const t in DATA_STORE[g]) counts[g][t] = DATA_STORE[g][t].length;
    }
    res.json({ games: GAME_STATUS, data_counts: counts });
});

app.get("/api/:game/:table?", (req, res) => {
    let { game, table } = req.params;
    game = game.toLowerCase();
    if (!DATA_STORE[game]) return res.status(404).json({ error: "Game không tồn tại" });
    if (!GAME_STATUS[game]) return res.status(403).json({ error: `API của ${game} đang TẮT` });
    if (!table) {
        const tables = Object.keys(DATA_STORE[game]);
        if (tables.length === 1) table = tables[0];
        else return res.status(400).json({ error: "Cần chỉ định bàn: " + tables.join(", ") });
    }
    table = table.toLowerCase();
    if (!DATA_STORE[game][table]) return res.status(404).json({ error: `Bàn '${table}' không tồn tại` });
    res.json(DATA_STORE[game][table]);
});

// =================================================================================================
// ROUTES TỪ xocdia88.py
// =================================================================================================
app.get('/api/xocdia88/hu', (req, res) => {
    res.json(xocdia88_history_hu.slice(0, 10).map(i => ({ phien: i.phien, ket_qua: i.ket_qua, xuc_xac: i.xuc_xac, Tong: i.tong })));
});
app.get('/api/xocdia88/md5', (req, res) => {
    res.json(xocdia88_history_md5.slice(0, 10).map(i => ({ phien: i.phien, ket_qua: i.ket_qua, xuc_xac: i.xuc_xac, Tong: i.tong })));
});

// =================================================================================================
// ROUTES TỪ sicbo.py
// =================================================================================================
app.get('/sicbo/sumclub', (req, res) => res.json(sumclub_history.slice(0, 50)));
app.get('/sicbo/sunlive', (req, res) => res.json(sunlive_history.slice(0, 50)));
app.get('/sicbo/luckywin', (req, res) => res.json(luckywin_history.slice(0, 50)));
app.get('/sicbo/sumclub/history', (req, res) => res.json(sumclub_history.slice(0, 50).map(h => ({
    phien: h.gameNum, score: h.score, type: h.resultType === 1 ? 'Tài' : 'Xỉu', faces: h.faces, time: h.time
}))));
app.get('/sicbo/sunlive/history', (req, res) => res.json(sunlive_history.slice(0, 50).map(h => ({
    phien: h.gameNum, score: h.score, type: h.resultType === 1 ? 'Tài' : 'Xỉu', faces: h.faces, time: h.time
}))));
app.get('/sicbo/luckywin/history', (req, res) => res.json(luckywin_history.slice(0, 50).map(h => ({
    phien: h.gameNum, score: h.score, type: h.resultType === 1 ? 'Tài' : 'Xỉu', faces: h.faces, time: h.time
}))));

// =================================================================================================
// ROUTES TỪ sicbosum.py
// =================================================================================================
app.get("/sicbo", (req, res) => res.json(sicbosum_PARSED_DATA));
app.get("/sicbo_raw", (req, res) => res.json(sicbosum_RAW_DATA));

// =================================================================================================
// ROUTES TỪ lc79cbm.js
// =================================================================================================
app.get('/lc79-hu', async (req, res) => {
    try {
        const data = await lc79_fetchDataHu();
        if (!data || !data.length) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
        await lc79_verifyPredictions('hu', data);
        const latestPhien = data[0].Phien;
        const nextPhien = latestPhien + 1;
        const result = lc79_calculateAdvancedPrediction(data, 'hu');
        const record = lc79_savePredictionToHistory('hu', nextPhien, result.prediction, result.confidence, data[0]);
        lc79_recordPrediction('hu', nextPhien, result.prediction, result.confidence, result.factors);
        setTimeout(() => lc79_updateHistoryStatus('hu'), 5000);
        res.json({ ...record });
    } catch (e) { logError('LC79 HU API:', e.message); res.status(500).json({ error: 'Lỗi server' }); }
});

app.get('/lc79-md5', async (req, res) => {
    try {
        const data = await lc79_fetchDataMd5();
        if (!data || !data.length) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
        await lc79_verifyPredictions('md5', data);
        const latestPhien = data[0].Phien;
        const nextPhien = latestPhien + 1;
        const result = lc79_calculateAdvancedPrediction(data, 'md5');
        const record = lc79_savePredictionToHistory('md5', nextPhien, result.prediction, result.confidence, data[0]);
        lc79_recordPrediction('md5', nextPhien, result.prediction, result.confidence, result.factors);
        setTimeout(() => lc79_updateHistoryStatus('md5'), 5000);
        res.json({ ...record });
    } catch (e) { logError('LC79 MD5 API:', e.message); res.status(500).json({ error: 'Lỗi server' }); }
});

app.get('/lc79-hu/lichsu', async (req, res) => {
    try { await lc79_updateHistoryStatus('hu'); } catch (e) {}
    res.json({ type: 'LC79 HU', history: lc79_predictionHistory.hu, total: lc79_predictionHistory.hu.length });
});
app.get('/lc79-md5/lichsu', async (req, res) => {
    try { await lc79_updateHistoryStatus('md5'); } catch (e) {}
    res.json({ type: 'LC79 MD5', history: lc79_predictionHistory.md5, total: lc79_predictionHistory.md5.length });
});
app.get('/lc79-hu/analysis', async (req, res) => {
    try {
        const data = await lc79_fetchDataHu();
        if (!data) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
        await lc79_verifyPredictions('hu', data);
        const r = lc79_calculateAdvancedPrediction(data, 'hu');
        res.json({ prediction: r.prediction, confidence: r.confidence, factors: r.factors, analysis: r.detailedAnalysis });
    } catch (e) { res.status(500).json({ error: 'Lỗi server' }); }
});
app.get('/lc79-md5/analysis', async (req, res) => {
    try {
        const data = await lc79_fetchDataMd5();
        if (!data) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
        await lc79_verifyPredictions('md5', data);
        const r = lc79_calculateAdvancedPrediction(data, 'md5');
        res.json({ prediction: r.prediction, confidence: r.confidence, factors: r.factors, analysis: r.detailedAnalysis });
    } catch (e) { res.status(500).json({ error: 'Lỗi server' }); }
});
app.get('/lc79-hu/learning', (req, res) => {
    const s = lc79_learningData.hu;
    const acc = s.totalPredictions > 0 ? (s.correctPredictions / s.totalPredictions * 100).toFixed(2) : 0;
    res.json({ type: 'LC79 HU Learning', totalPredictions: s.totalPredictions, correctPredictions: s.correctPredictions, overallAccuracy: `${acc}%`, streakAnalysis: s.streakAnalysis });
});
app.get('/lc79-md5/learning', (req, res) => {
    const s = lc79_learningData.md5;
    const acc = s.totalPredictions > 0 ? (s.correctPredictions / s.totalPredictions * 100).toFixed(2) : 0;
    res.json({ type: 'LC79 MD5 Learning', totalPredictions: s.totalPredictions, correctPredictions: s.correctPredictions, overallAccuracy: `${acc}%`, streakAnalysis: s.streakAnalysis });
});
app.get('/reset-learning', (req, res) => {
    lc79_learningData = {
        hu: { predictions: [], patternStats: {}, totalPredictions: 0, correctPredictions: 0, patternWeights: { ...LC79_DEFAULT_PATTERN_WEIGHTS }, lastUpdate: null, streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 }, adaptiveThresholds: {}, recentAccuracy: [] },
        md5: { predictions: [], patternStats: {}, totalPredictions: 0, correctPredictions: 0, patternWeights: { ...LC79_DEFAULT_PATTERN_WEIGHTS }, lastUpdate: null, streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 }, adaptiveThresholds: {}, recentAccuracy: [] }
    };
    lc79_saveLearningData();
    res.json({ message: 'Learning data reset successfully' });
});

// =================================================================================================
// ENGINE LC79 DÙNG CHUNG CHO TẤT CẢ GAME KHÁC (predict_for_game)
// =================================================================================================

function convert_data_to_lc79_format(records, source_type) {
    if (!records || !Array.isArray(records) || records.length === 0) return [];
    const converted = [];
    for (const r of records) {
        try {
            let phien, ket_qua, d1 = 0, d2 = 0, d3 = 0, tong = 0;
            if (source_type === 'full_py') {
                phien = r.phien;
                ket_qua = r.ket_qua;
                if (Array.isArray(r.xuc_xac) && r.xuc_xac.length === 3) { d1 = r.xuc_xac[0]; d2 = r.xuc_xac[1]; d3 = r.xuc_xac[2]; }
                tong = r.tong || (d1 + d2 + d3);
            } else if (source_type === 'xocdia88') {
                phien = r.phien;
                ket_qua = r.ket_qua;
                if (Array.isArray(r.xuc_xac) && r.xuc_xac.length === 3) { d1 = r.xuc_xac[0]; d2 = r.xuc_xac[1]; d3 = r.xuc_xac[2]; }
                tong = r.tong || (d1 + d2 + d3);
            } else if (source_type === 'sicbo') {
                phien = r.gameNum;
                ket_qua = r.resultType === 1 ? 'Tài' : 'Xỉu';
                if (Array.isArray(r.faces) && r.faces.length === 3) { d1 = r.faces[0]; d2 = r.faces[1]; d3 = r.faces[2]; }
                tong = r.score || (d1 + d2 + d3);
            } else if (source_type === 'sicbosum') {
                phien = r.session;
                ket_qua = r.result === 'Tai' ? 'Tài' : 'Xỉu';
                if (Array.isArray(r.dice) && r.dice.length === 3) { d1 = r.dice[0]; d2 = r.dice[1]; d3 = r.dice[2]; }
                tong = r.sum || (d1 + d2 + d3);
            }
            if (phien == null || !ket_qua) continue;
            converted.push({ Phien: phien, Ket_qua: ket_qua, Xuc_xac_1: d1, Xuc_xac_2: d2, Xuc_xac_3: d3, Tong: tong, fromSource: source_type, timestamp: r.timestamp || r.time || null });
        } catch (e) { /* skip */ }
    }
    converted.sort((a, b) => {
        const pa = typeof a.Phien === 'number' ? a.Phien : parseInt(a.Phien) || 0;
        const pb = typeof b.Phien === 'number' ? b.Phien : parseInt(b.Phien) || 0;
        return pb - pa;
    });
    return converted;
}

async function predict_for_game(game, table, source_type, fetcher) {
    try {
        let rawData = null;
        if (fetcher) rawData = await fetcher();
        else if (DATA_STORE[game] && DATA_STORE[game][table]) rawData = DATA_STORE[game][table];

        if (!rawData || rawData.length === 0) return { success: false, error: `Không có dữ liệu cho ${game}/${table}` };

        const formatted = convert_data_to_lc79_format(rawData, source_type);
        if (formatted.length < 5) return { success: false, error: `Không đủ dữ liệu (${formatted.length} phiên), cần >= 5` };

        const learningKey = `${game}_${table}_engine`;
        if (!lc79_learningData[learningKey]) {
            lc79_learningData[learningKey] = {
                predictions: [], patternStats: {}, totalPredictions: 0, correctPredictions: 0,
                patternWeights: { ...LC79_DEFAULT_PATTERN_WEIGHTS }, lastUpdate: null,
                streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
                adaptiveThresholds: {}, recentAccuracy: []
            };
        }
        await lc79_verifyPredictions(learningKey, formatted);
        const result = lc79_calculateAdvancedPrediction(formatted, learningKey);
        const latestPhien = formatted[0].Phien;
        const nextPhien = typeof latestPhien === 'number' ? latestPhien + 1 : `${latestPhien}_next`;
        lc79_recordPrediction(learningKey, nextPhien, result.prediction, result.confidence, result.factors);

        return {
            success: true, game, table,
            phien_hien_tai: formatted[0].Phien,
            phien_du_doan: nextPhien,
            ket_qua_phien_truoc: formatted[0].Ket_qua,
            du_doan: result.prediction,
            do_tin_cay: `${result.confidence}%`,
            cac_cau_phat_hien: result.factors,
            chi_tiet: result.detailedAnalysis,
            so_phien_da_co: formatted.length
        };
    } catch (e) {
        logError(`predict_for_game ${game}/${table}:`, e.message);
        return { success: false, error: e.message };
    }
}

// =================================================================================================
// ROUTES DỰ ĐOÁN ENGINE LC79 CHO CÁC GAME KHÁC
// =================================================================================================
app.get('/predict/b52/hu', async (req, res) => res.json(await predict_for_game('b52', 'hu', 'full_py', null)));
app.get('/predict/b52/md5', async (req, res) => res.json(await predict_for_game('b52', 'md5', 'full_py', null)));
app.get('/predict/hitclub/hu', async (req, res) => res.json(await predict_for_game('hitclub', 'hu', 'full_py', null)));
app.get('/predict/hitclub/md5', async (req, res) => res.json(await predict_for_game('hitclub', 'md5', 'full_py', null)));
app.get('/predict/rikvip/hu', async (req, res) => res.json(await predict_for_game('rikvip', 'hu', 'full_py', null)));
app.get('/predict/rikvip/md5', async (req, res) => res.json(await predict_for_game('rikvip', 'md5', 'full_py', null)));
app.get('/predict/betvip/hu', async (req, res) => res.json(await predict_for_game('betvip', 'hu', 'full_py', null)));
app.get('/predict/betvip/md5', async (req, res) => res.json(await predict_for_game('betvip', 'md5', 'full_py', null)));
app.get('/predict/sunwin/main', async (req, res) => res.json(await predict_for_game('sunwin', 'main', 'full_py', null)));
app.get('/predict/68gb/hu', async (req, res) => res.json(await predict_for_game('68gb', 'hu', 'full_py', null)));
app.get('/predict/68gb/md5', async (req, res) => res.json(await predict_for_game('68gb', 'md5', 'full_py', null)));
app.get('/predict/luck8/txhu', async (req, res) => res.json(await predict_for_game('luck8', 'txhu', 'full_py', null)));
app.get('/predict/luck8/txmd5', async (req, res) => res.json(await predict_for_game('luck8', 'txmd5', 'full_py', null)));
app.get('/predict/luck8/tx3p', async (req, res) => res.json(await predict_for_game('luck8', 'tx3p', 'full_py', null)));
app.get('/predict/789club/live', async (req, res) => res.json(await predict_for_game('789club', 'live', 'full_py', null)));
app.get('/predict/789club/minigame', async (req, res) => res.json(await predict_for_game('789club', 'minigame', 'full_py', null)));
app.get('/predict/sumclub/hu', async (req, res) => res.json(await predict_for_game('sumclub', 'hu', 'full_py', null)));
app.get('/predict/sumclub/md5', async (req, res) => res.json(await predict_for_game('sumclub', 'md5', 'full_py', null)));

// Xocdia88
app.get('/predict/xocdia88/hu', async (req, res) => {
    const formatted = convert_data_to_lc79_format(xocdia88_history_hu, 'xocdia88');
    if (formatted.length < 5) return res.json({ success: false, error: 'Chưa đủ dữ liệu xocdia88/hu' });
    const lk = 'xocdia88_hu_engine';
    if (!lc79_learningData[lk]) lc79_learningData[lk] = { predictions: [], patternStats: {}, totalPredictions: 0, correctPredictions: 0, patternWeights: { ...LC79_DEFAULT_PATTERN_WEIGHTS }, lastUpdate: null, streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 }, adaptiveThresholds: {}, recentAccuracy: [] };
    await lc79_verifyPredictions(lk, formatted);
    const r = lc79_calculateAdvancedPrediction(formatted, lk);
    const latestPhien = formatted[0].Phien;
    const nextPhien = typeof latestPhien === 'number' ? latestPhien + 1 : `${latestPhien}_next`;
    lc79_recordPrediction(lk, nextPhien, r.prediction, r.confidence, r.factors);
    res.json({ success: true, game: 'xocdia88', table: 'hu', phien_hien_tai: formatted[0].Phien, phien_du_doan: nextPhien, ket_qua_phien_truoc: formatted[0].Ket_qua, du_doan: r.prediction, do_tin_cay: `${r.confidence}%`, cac_cau_phat_hien: r.factors, chi_tiet: r.detailedAnalysis, so_phien_da_co: formatted.length });
});
app.get('/predict/xocdia88/md5', async (req, res) => {
    const formatted = convert_data_to_lc79_format(xocdia88_history_md5, 'xocdia88');
    if (formatted.length < 5) return res.json({ success: false, error: 'Chưa đủ dữ liệu xocdia88/md5' });
    const lk = 'xocdia88_md5_engine';
    if (!lc79_learningData[lk]) lc79_learningData[lk] = { predictions: [], patternStats: {}, totalPredictions: 0, correctPredictions: 0, patternWeights: { ...LC79_DEFAULT_PATTERN_WEIGHTS }, lastUpdate: null, streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 }, adaptiveThresholds: {}, recentAccuracy: [] };
    await lc79_verifyPredictions(lk, formatted);
    const r = lc79_calculateAdvancedPrediction(formatted, lk);
    const latestPhien = formatted[0].Phien;
    const nextPhien = typeof latestPhien === 'number' ? latestPhien + 1 : `${latestPhien}_next`;
    lc79_recordPrediction(lk, nextPhien, r.prediction, r.confidence, r.factors);
    res.json({ success: true, game: 'xocdia88', table: 'md5', phien_hien_tai: formatted[0].Phien, phien_du_doan: nextPhien, ket_qua_phien_truoc: formatted[0].Ket_qua, du_doan: r.prediction, do_tin_cay: `${r.confidence}%`, cac_cau_phat_hien: r.factors, chi_tiet: r.detailedAnalysis, so_phien_da_co: formatted.length });
});

// Sicbo
app.get('/predict/sicbo/sumclub', async (req, res) => {
    const formatted = convert_data_to_lc79_format(sumclub_history, 'sicbo');
    if (formatted.length < 5) return res.json({ success: false, error: 'Chưa đủ dữ liệu sicbo/sumclub' });
    const lk = 'sicbo_sumclub_engine';
    if (!lc79_learningData[lk]) lc79_learningData[lk] = { predictions: [], patternStats: {}, totalPredictions: 0, correctPredictions: 0, patternWeights: { ...LC79_DEFAULT_PATTERN_WEIGHTS }, lastUpdate: null, streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 }, adaptiveThresholds: {}, recentAccuracy: [] };
    await lc79_verifyPredictions(lk, formatted);
    const r = lc79_calculateAdvancedPrediction(formatted, lk);
    const latestPhien = formatted[0].Phien;
    const nextPhien = typeof latestPhien === 'number' ? latestPhien + 1 : `${latestPhien}_next`;
    lc79_recordPrediction(lk, nextPhien, r.prediction, r.confidence, r.factors);
    res.json({ success: true, game: 'sicbo', table: 'sumclub', phien_hien_tai: formatted[0].Phien, phien_du_doan: nextPhien, ket_qua_phien_truoc: formatted[0].Ket_qua, du_doan: r.prediction, do_tin_cay: `${r.confidence}%`, cac_cau_phat_hien: r.factors, chi_tiet: r.detailedAnalysis, so_phien_da_co: formatted.length });
});
app.get('/predict/sicbo/sunlive', async (req, res) => {
    const formatted = convert_data_to_lc79_format(sunlive_history, 'sicbo');
    if (formatted.length < 5) return res.json({ success: false, error: 'Chưa đủ dữ liệu sicbo/sunlive' });
    const lk = 'sicbo_sunlive_engine';
    if (!lc79_learningData[lk]) lc79_learningData[lk] = { predictions: [], patternStats: {}, totalPredictions: 0, correctPredictions: 0, patternWeights: { ...LC79_DEFAULT_PATTERN_WEIGHTS }, lastUpdate: null, streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 }, adaptiveThresholds: {}, recentAccuracy: [] };
    await lc79_verifyPredictions(lk, formatted);
    const r = lc79_calculateAdvancedPrediction(formatted, lk);
    const latestPhien = formatted[0].Phien;
    const nextPhien = typeof latestPhien === 'number' ? latestPhien + 1 : `${latestPhien}_next`;
    lc79_recordPrediction(lk, nextPhien, r.prediction, r.confidence, r.factors);
    res.json({ success: true, game: 'sicbo', table: 'sunlive', phien_hien_tai: formatted[0].Phien, phien_du_doan: nextPhien, ket_qua_phien_truoc: formatted[0].Ket_qua, du_doan: r.prediction, do_tin_cay: `${r.confidence}%`, cac_cau_phat_hien: r.factors, chi_tiet: r.detailedAnalysis, so_phien_da_co: formatted.length });
});
app.get('/predict/sicbo/luckywin', async (req, res) => {
    const formatted = convert_data_to_lc79_format(luckywin_history, 'sicbo');
    if (formatted.length < 5) return res.json({ success: false, error: 'Chưa đủ dữ liệu sicbo/luckywin' });
    const lk = 'sicbo_luckywin_engine';
    if (!lc79_learningData[lk]) lc79_learningData[lk] = { predictions: [], patternStats: {}, totalPredictions: 0, correctPredictions: 0, patternWeights: { ...LC79_DEFAULT_PATTERN_WEIGHTS }, lastUpdate: null, streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 }, adaptiveThresholds: {}, recentAccuracy: [] };
    await lc79_verifyPredictions(lk, formatted);
    const r = lc79_calculateAdvancedPrediction(formatted, lk);
    const latestPhien = formatted[0].Phien;
    const nextPhien = typeof latestPhien === 'number' ? latestPhien + 1 : `${latestPhien}_next`;
    lc79_recordPrediction(lk, nextPhien, r.prediction, r.confidence, r.factors);
    res.json({ success: true, game: 'sicbo', table: 'luckywin', phien_hien_tai: formatted[0].Phien, phien_du_doan: nextPhien, ket_qua_phien_truoc: formatted[0].Ket_qua, du_doan: r.prediction, do_tin_cay: `${r.confidence}%`, cac_cau_phat_hien: r.factors, chi_tiet: r.detailedAnalysis, so_phien_da_co: formatted.length });
});

// SicboSum
app.get('/predict/sicbosum', async (req, res) => {
    const formatted = convert_data_to_lc79_format(sicbosum_PARSED_DATA, 'sicbosum');
    if (formatted.length < 5) return res.json({ success: false, error: 'Chưa đủ dữ liệu sicbosum' });
    const lk = 'sicbosum_engine';
    if (!lc79_learningData[lk]) lc79_learningData[lk] = { predictions: [], patternStats: {}, totalPredictions: 0, correctPredictions: 0, patternWeights: { ...LC79_DEFAULT_PATTERN_WEIGHTS }, lastUpdate: null, streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 }, adaptiveThresholds: {}, recentAccuracy: [] };
    await lc79_verifyPredictions(lk, formatted);
    const r = lc79_calculateAdvancedPrediction(formatted, lk);
    const latestPhien = formatted[0].Phien;
    const nextPhien = typeof latestPhien === 'number' ? latestPhien + 1 : `${latestPhien}_next`;
    lc79_recordPrediction(lk, nextPhien, r.prediction, r.confidence, r.factors);
    res.json({ success: true, game: 'sicbosum', table: 'main', phien_hien_tai: formatted[0].Phien, phien_du_doan: nextPhien, ket_qua_phien_truoc: formatted[0].Ket_qua, du_doan: r.prediction, do_tin_cay: `${r.confidence}%`, cac_cau_phat_hien: r.factors, chi_tiet: r.detailedAnalysis, so_phien_da_co: formatted.length });
});

// Predict ALL
app.get('/predict/all', async (req, res) => {
    const targets = [
        { game: 'b52', table: 'hu', src: 'full_py' }, { game: 'b52', table: 'md5', src: 'full_py' },
        { game: 'hitclub', table: 'hu', src: 'full_py' }, { game: 'hitclub', table: 'md5', src: 'full_py' },
        { game: 'rikvip', table: 'hu', src: 'full_py' }, { game: 'rikvip', table: 'md5', src: 'full_py' },
        { game: 'betvip', table: 'hu', src: 'full_py' }, { game: 'betvip', table: 'md5', src: 'full_py' },
        { game: 'sunwin', table: 'main', src: 'full_py' },
        { game: '68gb', table: 'hu', src: 'full_py' }, { game: '68gb', table: 'md5', src: 'full_py' },
        { game: 'luck8', table: 'txhu', src: 'full_py' }, { game: 'luck8', table: 'txmd5', src: 'full_py' }, { game: 'luck8', table: 'tx3p', src: 'full_py' },
        { game: '789club', table: 'live', src: 'full_py' }, { game: '789club', table: 'minigame', src: 'full_py' },
        { game: 'sumclub', table: 'hu', src: 'full_py' }, { game: 'sumclub', table: 'md5', src: 'full_py' }
    ];
    const results = {};
    for (const t of targets) {
        try { results[`${t.game}/${t.table}`] = await predict_for_game(t.game, t.table, t.src, null); }
        catch (e) { results[`${t.game}/${t.table}`] = { success: false, error: e.message }; }
    }
    res.json({ success: true, timestamp: new Date().toISOString(), total: Object.keys(results).length, results });
});

// Games list
app.get('/games', (req, res) => {
    const out = {};
    for (const game in DATA_STORE) {
        out[game] = {};
        for (const table in DATA_STORE[game]) {
            out[game][table] = {
                source: 'full.py',
                phien_da_co: DATA_STORE[game][table].length,
                has_predict: true,
                endpoint: `/predict/${game}/${table}`
            };
        }
    }
    out['xocdia88'] = {
        hu: { source: 'xocdia88.py', phien_da_co: xocdia88_history_hu.length, has_predict: true, endpoint: '/predict/xocdia88/hu' },
        md5: { source: 'xocdia88.py', phien_da_co: xocdia88_history_md5.length, has_predict: true, endpoint: '/predict/xocdia88/md5' }
    };
    out['sicbo'] = {
        sumclub: { source: 'sicbo.py', phien_da_co: sumclub_history.length, has_predict: true, endpoint: '/predict/sicbo/sumclub' },
        sunlive: { source: 'sicbo.py', phien_da_co: sunlive_history.length, has_predict: true, endpoint: '/predict/sicbo/sunlive' },
        luckywin: { source: 'sicbo.py', phien_da_co: luckywin_history.length, has_predict: true, endpoint: '/predict/sicbo/luckywin' }
    };
    out['sicbosum'] = {
        main: { source: 'sicbosum.py', phien_da_co: sicbosum_PARSED_DATA.length, has_predict: true, endpoint: '/predict/sicbosum' }
    };
    res.json(out);
});

// =================================================================================================
// ROUTES JSON PREDICTOR (dùng engine book/anti/pred_log/model_stats)
// =================================================================================================
app.get('/json-predict/:game/:table', json_predict_handler);
app.get('/json-predict-state/:game/:table', json_state_handler);
app.get('/json-predictors', json_list_handler);
app.get('/json-predict-all', json_predict_all_handler);
app.get('/json-update-book/:game/:table', json_update_book_handler);
app.get('/json-reset-book/:game/:table', json_reset_handler);

// =================================================================================================
// KHỞI CHẠY TẤT CẢ
// =================================================================================================
async function start() {
    log("=".repeat(70));
    log("ALL-IN-ONE TÀI XỈU API SERVER - FULL VERSION 100%");
    log("Tích hợp: full.py + xocdia88.py + sicbo.py + sicbosum.py + lc79cbm.js + 11 file JSON");
    log("=".repeat(70));

    // 1. Nạp dữ liệu
    loadAllJsonData();              // 11 file JSON gốc vào DATA_STORE
    load_all_json_predictors();     // 11 file JSON predictor (book + anti + pred_log + model_stats)
    lc79_loadLearningData();
    lc79_loadPredictionHistory();

    // 2. Khởi động workers
    start_all_full_py_workers();
    start_xocdia88_workers();
    start_sicbo_workers();
    start_sicbosum_workers();
    lc79_startAutoSaveTask();
    start_json_auto_update_task();

    // 3. Chạy server
    app.listen(PORT, '0.0.0.0', () => {
        log(`✅ Server đang chạy tại http://0.0.0.0:${PORT}`);
        log("");
        log("📊 ENDPOINTS CHÍNH:");
        log("");
        log("  ⭐ JSON-PREDICT (book + anti + model_stats đã học sẵn):");
        log("     GET /json-predict/:game/:table");
        log("     VD: /json-predict/b52/hu");
        log("         /json-predict/hitclub/md5");
        log("         /json-predict/lc79/hu");
        log("         /json-predict/rikvip/hu");
        log("         /json-predict/betvip/hu");
        log("         /json-predict/sumclub/hu");
        log("     GET /json-predict-all       → tất cả game 1 lần");
        log("     GET /json-predictors         → liệt kê tất cả");
        log("     GET /json-predict-state/:game/:table → xem state");
        log("     GET /json-update-book/:game/:table   → cập nhật book");
        log("     GET /json-reset-book/:game/:table    → reset từ file");
        log("");
        log("  🔥 ENGINE LC79 (40+ pattern + learning):");
        log("     GET /lc79-hu, /lc79-md5");
        log("     GET /lc79-hu/lichsu, /lc79-md5/lichsu");
        log("     GET /lc79-hu/analysis, /lc79-md5/analysis");
        log("     GET /lc79-hu/learning, /lc79-md5/learning");
        log("     GET /predict/:game/:table");
        log("     GET /predict/all");
        log("");
        log("  📊 DỮ LIỆU GỐC:");
        log("     GET /api/:game/:table");
        log("     GET /api/status, /games");
        log("     GET /api/xocdia88/hu, /api/xocdia88/md5");
        log("     GET /sicbo, /sicbo_raw");
        log("     GET /sicbo/sumclub, /sicbo/sunlive, /sicbo/luckywin");
        log("=".repeat(70));
    });
}

process.on('SIGINT', () => {
    log("\n🛑 Đang dừng server...");
    try { lc79_saveLearningData(); lc79_savePredictionHistory(); } catch (e) {}
    for (const key in JSON_PREDICTOR_STATE) {
        if (JSON_PREDICTOR_STATE[key].dirty) save_json_predictor_state(key);
    }
    process.exit(0);
});

// ============ BẮT ĐẦU CHẠY ============
start();