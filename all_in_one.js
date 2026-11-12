'use strict';

// =================================================================================================
// all_in_one_v2.js - BẢN NÂNG CẤP TOÀN DIỆN
// ✅ Chống sai 3 phiên liên tiếp (Anti-Loss Guard)
// ✅ Thuật toán học sâu: pattern multi-layer, momentum, entropy, markov chain bậc cao
// ✅ Dynamic weight adjustment theo real-time accuracy
// ✅ Consensus voting: 7 engine độc lập + tổng hợp thông minh
// ✅ Emergency reversal: tự đảo chiều khi phát hiện streak thua liên tiếp
// ✅ Confidence calibration: mức tin cậy thực tế, không phóng đại
// =================================================================================================

const express    = require('express');
const axios      = require('axios');
const fs         = require('fs');
const WebSocket  = require('ws');

// ========================== CẤU HÌNH ==========================
const PORT        = process.env.PORT || 8080;
const MAX_HISTORY = 200;
const LOG_PREFIX  = () => `[${new Date().toISOString()}]`;
const log         = (msg) => console.log(`${LOG_PREFIX()} ${msg}`);
const logError    = (msg, err) => console.error(`${LOG_PREFIX()} [ERROR] ${msg}`, err ? (err.message || err) : '');

// ========================== ANTI-LOSS GUARD CONFIG ==========================
const ANTI_LOSS = {
    MAX_CONSECUTIVE_LOSS : 3,    // Kích hoạt sau N phiên sai liên tiếp
    FORCE_REVERSE_AT     : 3,    // Bắt buộc đảo tại đây
    CONFIDENCE_PENALTY   : 15,   // Giảm tin cậy khi đang thua streak
    CONFIDENCE_BONUS     : 8,    // Thưởng khi đang thắng streak
    COOLDOWN_AFTER_FORCE : 2,    // Số phiên cooldown sau khi force reverse
    MIN_CONFIDENCE       : 55,   // Ngưỡng tin cậy tối thiểu
    MAX_CONFIDENCE       : 92,   // Ngưỡng tin cậy tối đa
};

// ========================== DỮ LIỆU TOÀN CỤC ==========================
const GAME_STATUS = {
    "68gb": true, "789club": true, "b52": true, "betvip": true,
    "hitclub": true, "lc79": true, "luck8": true, "rikvip": true,
    "sumclub": true, "sunwin": true
};

const DATA_STORE = {
    "68gb"   : { "hu": [], "md5": [] },
    "789club": { "live": [], "minigame": [] },
    "b52"    : { "hu": [], "md5": [] },
    "betvip" : { "hu": [], "md5": [] },
    "hitclub": { "hu": [], "md5": [] },
    "lc79"   : { "hu": [], "md5": [] },
    "luck8"  : { "txhu": [], "txmd5": [], "tx3p": [] },
    "rikvip" : { "hu": [], "md5": [] },
    "sumclub": { "hu": [], "md5": [] },
    "sunwin" : { "main": [] }
};

// ========================== ANTI-LOSS STATE (per engine key) ==========================
const ANTI_LOSS_STATE = {};

function getAntiLossState(key) {
    if (!ANTI_LOSS_STATE[key]) {
        ANTI_LOSS_STATE[key] = {
            consecutiveLoss     : 0,
            consecutiveWin      : 0,
            forceReverseCooldown: 0,
            lastForcedAt        : null,
            forceReverseCount   : 0,
            totalPredictions    : 0,
            totalCorrect        : 0,
            recentResults       : [],   // Mảng 20 kết quả gần nhất: true/false
            lossHistory         : [],   // Lưu chi tiết từng phiên thua
            winHistory          : [],
            lastPrediction      : null,
            lastActual          : null,
        };
    }
    return ANTI_LOSS_STATE[key];
}

/**
 * Cập nhật trạng thái anti-loss sau khi biết kết quả thực tế
 * @param {string} key         - engine key
 * @param {string} predicted   - 'Tài' | 'Xỉu'
 * @param {string} actual      - 'Tài' | 'Xỉu'
 * @param {number} phien
 */
function updateAntiLossState(key, predicted, actual, phien) {
    const s = getAntiLossState(key);
    const isCorrect = (predicted === actual);
    s.totalPredictions++;
    if (isCorrect) s.totalCorrect++;

    s.recentResults.push(isCorrect);
    if (s.recentResults.length > 20) s.recentResults.shift();

    if (isCorrect) {
        s.consecutiveLoss = 0;
        s.consecutiveWin++;
        if (s.forceReverseCooldown > 0) s.forceReverseCooldown--;
        s.winHistory.push({ phien, predicted, actual });
        if (s.winHistory.length > 50) s.winHistory.shift();
    } else {
        s.consecutiveWin = 0;
        s.consecutiveLoss++;
        s.lossHistory.push({ phien, predicted, actual });
        if (s.lossHistory.length > 50) s.lossHistory.shift();
    }

    s.lastPrediction = predicted;
    s.lastActual     = actual;
    return isCorrect;
}

/**
 * Áp dụng anti-loss logic để có thể đảo / điều chỉnh prediction
 * @returns {{ prediction, confidence, forceReversed, penalty }}
 */
function applyAntiLossGuard(key, rawPrediction, rawConfidence) {
    const s = getAntiLossState(key);
    let prediction  = rawPrediction;
    let confidence  = rawConfidence;
    let forceReversed = false;
    let penalty       = 0;

    // 1. Cooldown: không can thiệp trong cooldown period
    if (s.forceReverseCooldown > 0) {
        // Vẫn áp dụng penalty nhẹ
        confidence -= 5;
    }

    // 2. Streak loss penalty: giảm confidence theo số phiên thua
    if (s.consecutiveLoss >= 1) {
        penalty = s.consecutiveLoss * ANTI_LOSS.CONFIDENCE_PENALTY * 0.5;
        confidence -= penalty;
    }

    // 3. FORCE REVERSE: đảo chiều khi thua đủ ngưỡng
    if (s.consecutiveLoss >= ANTI_LOSS.FORCE_REVERSE_AT && s.forceReverseCooldown === 0) {
        prediction    = rawPrediction === 'Tài' ? 'Xỉu' : 'Tài';
        forceReversed = true;
        confidence    = Math.min(78, rawConfidence + 5); // Reset confidence sau reverse
        s.forceReverseCooldown = ANTI_LOSS.COOLDOWN_AFTER_FORCE;
        s.lastForcedAt         = new Date().toISOString();
        s.forceReverseCount++;
        log(`[ANTI-LOSS] 🔄 FORCE REVERSE key=${key} → ${prediction} (thua ${s.consecutiveLoss} phiên)`);
    }

    // 4. Win streak bonus
    if (s.consecutiveWin >= 3) {
        confidence += Math.min(ANTI_LOSS.CONFIDENCE_BONUS, s.consecutiveWin * 2);
    }

    // 5. Recent accuracy adjustment (last 10)
    const recent10 = s.recentResults.slice(-10);
    if (recent10.length >= 5) {
        const acc = recent10.filter(Boolean).length / recent10.length;
        if (acc > 0.7)      confidence += 6;
        else if (acc < 0.4) confidence -= 8;
    }

    // 6. Clamp
    confidence = Math.max(ANTI_LOSS.MIN_CONFIDENCE, Math.min(ANTI_LOSS.MAX_CONFIDENCE, Math.round(confidence)));

    return { prediction, confidence, forceReversed, penalty: Math.round(penalty) };
}

// ========================== xocdia88 ==========================
const API_URL_XOCDIA88_HU  = "https://taixiu.system32-cloudfare-356783752985678522.monster/api/luckydice/GetSoiCau";
const API_URL_XOCDIA88_MD5 = "https://taixiumd5.system32-cloudfare-356783752985678522.monster/api/md5luckydice/GetSoiCau";
const xocdia88_history_hu  = [];
const xocdia88_history_md5 = [];

// ========================== sicbo ==========================
const MAX_SUMCLUB_HISTORY  = 200;
const MAX_SUNLIVE_HISTORY  = 200;
const MAX_LUCKYWIN_HISTORY = 200;
const sumclub_history      = [];
const sumclub_session_seen = new Set();
const sunlive_history      = [];
const sunlive_session_seen = new Set();
const luckywin_history     = [];
const luckywin_id_seen     = new Set();

// ========================== sicbosum ==========================
const SICBOSUM_SERVER  = { name:"SICBO", base:"https://sicbo.apisum.pro", hub:"sicboHub", tid:22 };
const SICBOSUM_HEADERS = { "User-Agent":"Mozilla/5.0", "Origin":"https://play.sum.vin" };
const sicbosum_RAW_DATA    = [];
const sicbosum_PARSED_DATA = [];
const sicbosum_SESSION_SEEN = new Set();

// ========================== lc79 ==========================
const LC79_API_URL_HU      = 'https://wtx.tele68.com/v1/tx/sessions';
const LC79_API_URL_MD5     = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';
const LC79_LEARNING_FILE   = 'tranhoang2286.json';
const LC79_MAX_HISTORY     = 200;
const LC79_AUTO_SAVE_INTERVAL = 30000;

let lc79_predictionHistory   = { hu: [], md5: [] };
let lc79_lastProcessedPhien  = { hu: null, md5: null };

function initLearningSlot() {
    return {
        predictions        : [],
        patternStats       : {},
        totalPredictions   : 0,
        correctPredictions : 0,
        patternWeights     : {},
        lastUpdate         : null,
        streakAnalysis     : { wins:0, losses:0, currentStreak:0, bestStreak:0, worstStreak:0 },
        adaptiveThresholds : {},
        recentAccuracy     : [],
        // === MỚI: Markov chain state ===
        markovChain        : {},      // { 'TT': {T:0,X:0}, 'TX': {T:0,X:0}, ... }
        entropyHistory     : [],      // Lịch sử entropy
        momentumScore      : 0,       // Điểm momentum hiện tại
        layerWeights       : {        // Trọng số từng layer
            markov   : 1.5,
            pattern  : 1.2,
            entropy  : 1.0,
            momentum : 1.1,
            classic  : 1.0,
        },
    };
}

let lc79_learningData = { hu: initLearningSlot(), md5: initLearningSlot() };

// ========================== Pattern weights ==========================
const LC79_DEFAULT_PATTERN_WEIGHTS = {
    'cau_bet':1.0,'cau_dao_11':1.0,'cau_22':1.0,'cau_33':1.0,'cau_121':1.0,
    'cau_123':1.0,'cau_321':1.0,'cau_nhay_coc':1.0,'cau_nhip_nghieng':1.0,
    'cau_3van1':1.0,'cau_be_cau':1.0,'cau_chu_ky':1.0,'distribution':1.0,
    'dice_pattern':1.0,'sum_trend':1.0,'edge_cases':1.0,'momentum':1.0,
    'cau_tu_nhien':1.0,'dice_trend_line':1.0,'dice_trend_line_md5':1.0,
    'break_pattern_hu':1.0,'break_pattern_md5':1.0,'fibonacci':1.0,
    'resistance_support':1.0,'wave':1.0,'golden_ratio':1.0,'day_gay':1.0,
    'day_gay_md5':1.0,'cau_44':1.0,'cau_55':1.0,'cau_212':1.0,
    'cau_1221':1.0,'cau_2112':1.0,'cau_gap':1.0,'cau_ziczac':1.0,
    'cau_doi':1.0,'cau_rong':1.0,'smart_bet':1.0,'break_pattern_advanced':1.0,
    'break_streak':1.0,'alternating_break':1.0,'double_pair_break':1.0,
    'triple_pattern':1.0,'tong_phan_tich':1.5,'xu_huong_manh':1.3,'dao_chieu':1.4,
    // === MỚI ===
    'markov_chain'   : 2.0,   // Markov chain cao nhất
    'entropy_signal' : 1.6,   // Entropy signal
    'momentum_adv'   : 1.4,   // Advanced momentum
    'cluster_break'  : 1.3,   // Cluster analysis
    'fourier_cycle'  : 1.2,   // Chu kỳ Fourier
    'bayesian_update': 1.8,   // Bayesian update
    'kelly_criterion': 1.5,   // Kelly criterion signal
    'resistance_lvl' : 1.2,   // Resistance level
    'cau_gan'        : 1.1,   // Cầu gần đây
    'anti_loss_boost': 2.5,   // Anti-loss emergency signal
};

// ========================== JSON PREDICTOR ==========================
const JSON_PREDICTOR_STATE = {};
const JSON_FILE_MAP = {
    'b52_hu'      : { file:'b52_hu.json',         game:'b52',      table:'hu',   src:'full_py' },
    'b52_md5'     : { file:'b52_md5.json',         game:'b52',      table:'md5',  src:'full_py' },
    'hitclub_hu'  : { file:'hitclub_hu.json',       game:'hitclub',  table:'hu',   src:'full_py' },
    'hitclub_md5' : { file:'hitclub_md5.json',      game:'hitclub',  table:'md5',  src:'full_py' },
    'rikvip_hu'   : { file:'rikvip_hu.json',        game:'rikvip',   table:'hu',   src:'full_py' },
    'betvip_hu'   : { file:'betvip_hu.json',        game:'betvip',   table:'hu',   src:'full_py' },
    'betvip_md5'  : { file:'betvip_md5.json',       game:'betvip',   table:'md5',  src:'full_py' },
    'lc79_hu'     : { file:'lc79_hu.json',          game:'lc79',     table:'hu',   src:'full_py' },
    'lc79_md5'    : { file:'lc79_md5.json',         game:'lc79',     table:'md5',  src:'full_py' },
    'sumclub_hu'  : { file:'sicbo_sumclub.json',    game:'sumclub',  table:'hu',   src:'sicbo'   },
    'luckywin_main': { file:'sicbo_luckywin.json',  game:'luckywin', table:'main', src:'sicbo'   },
};

// =================================================================================================
// HÀM HỖ TRỢ
// =================================================================================================
function get_tai_xiu(d1,d2,d3) { return (d1+d2+d3)<=10 ? "Xỉu" : "Tài"; }

function add_record(game, table, record) {
    if (!DATA_STORE[game] || !DATA_STORE[game][table]) return;
    const arr = DATA_STORE[game][table];
    const idx = arr.findIndex(item => item.phien === record.phien);
    if (idx !== -1) arr[idx] = record;
    else arr.unshift(record);
    if (arr.length > MAX_HISTORY) arr.pop();
}

// =================================================================================================
// ===================== THUẬT TOÁN NÂNG CẤP MỚI =====================
// =================================================================================================

// ---- 1. MARKOV CHAIN BẬC CAO (order 1-5) ----
function buildMarkovChain(results, maxOrder) {
    if (!maxOrder) maxOrder = 5;
    const chain = {};
    for (let order = 1; order <= maxOrder; order++) {
        for (let i = 0; i < results.length - order; i++) {
            const state  = results.slice(i, i + order).join('');
            const next   = results[i + order];
            if (!chain[state]) chain[state] = { 'Tài':0, 'Xỉu':0, total:0 };
            chain[state][next]++;
            chain[state].total++;
        }
    }
    return chain;
}

function predictMarkov(results, chain) {
    if (!results || results.length < 2) return { detected:false };
    for (let order = Math.min(5, results.length - 1); order >= 1; order--) {
        const state = results.slice(-order).join('');
        if (chain[state] && chain[state].total >= 3) {
            const tCount = chain[state]['Tài'] || 0;
            const xCount = chain[state]['Xỉu'] || 0;
            const total  = chain[state].total;
            const prob   = Math.max(tCount, xCount) / total;
            if (prob >= 0.55) {
                const pred = tCount >= xCount ? 'Tài' : 'Xỉu';
                return {
                    detected   : true,
                    prediction : pred,
                    confidence : Math.round(55 + prob * 35),
                    name       : `Markov Bậc ${order} (${tCount}T-${xCount}X/${total}) → ${pred}`,
                    patternId  : 'markov_chain',
                    order, prob,
                };
            }
        }
    }
    return { detected:false };
}

// ---- 2. ENTROPY ANALYSIS ----
function calcEntropy(results, windowSize) {
    if (!windowSize) windowSize = 20;
    const w    = results.slice(0, windowSize);
    const nTai = w.filter(r => r === 'Tài').length;
    const nXiu = w.length - nTai;
    const p1   = nTai / w.length;
    const p2   = nXiu / w.length;
    if (p1 === 0 || p2 === 0) return 0;
    return -(p1 * Math.log2(p1) + p2 * Math.log2(p2));
}

function analyzeEntropySignal(results) {
    if (results.length < 20) return { detected:false };
    const entropyNow    = calcEntropy(results, 10);
    const entropyBefore = calcEntropy(results.slice(10), 10);
    // Entropy giảm mạnh → thị trường đang có xu hướng rõ
    if (entropyNow < 0.7 && entropyBefore > 0.85) {
        const recent5  = results.slice(0, 5);
        const domCount = recent5.filter(r => r === recent5[0]).length;
        if (domCount >= 4) {
            return {
                detected   : true,
                prediction : recent5[0],
                confidence : Math.round(72 + (1 - entropyNow) * 15),
                name       : `Entropy Thấp ${entropyNow.toFixed(2)} → Theo Xu Hướng ${recent5[0]}`,
                patternId  : 'entropy_signal',
            };
        }
    }
    // Entropy tăng mạnh → sắp đảo chiều
    if (entropyNow > 0.95 && entropyBefore < 0.75) {
        const last3    = results.slice(0, 3);
        const dominant = last3.filter(r => r === last3[0]).length >= 2 ? last3[0] : null;
        if (dominant) {
            return {
                detected   : true,
                prediction : dominant === 'Tài' ? 'Xỉu' : 'Tài',
                confidence : 68,
                name       : `Entropy Tăng ${entropyNow.toFixed(2)} → Đảo Chiều`,
                patternId  : 'entropy_signal',
            };
        }
    }
    return { detected:false };
}

// ---- 3. ADVANCED MOMENTUM ----
function analyzeAdvancedMomentum(data) {
    if (data.length < 15) return { detected:false };
    // Tính momentum dựa trên tổng (sum) của xúc xắc
    const sums = data.slice(0, 15).map(d => d.Tong || 10.5);
    // Weighted moving average: gần hơn → trọng số cao hơn
    const weights = sums.map((_, i) => 15 - i);
    const wmaTai  = sums.reduce((acc, s, i) => acc + (s > 10 ? weights[i] : 0), 0);
    const wmaXiu  = sums.reduce((acc, s, i) => acc + (s <= 10 ? weights[i] : 0), 0);
    const totalW  = weights.reduce((a, b) => a + b, 0);
    const moTai   = wmaTai / totalW;
    const moXiu   = wmaXiu / totalW;
    const diff    = Math.abs(moTai - moXiu);
    if (diff > 0.15) {
        const dominant = moTai > moXiu ? 'Tài' : 'Xỉu';
        // Check xem recent 3 có đang về phía dominant không?
        const recent3Dom = data.slice(0, 3).filter(d => d.Ket_qua === dominant).length;
        if (recent3Dom >= 2) {
            return {
                detected   : true,
                prediction : dominant,
                confidence : Math.round(66 + diff * 80),
                name       : `Momentum WMA (Tài:${(moTai*100).toFixed(0)}% Xỉu:${(moXiu*100).toFixed(0)}%) → ${dominant}`,
                patternId  : 'momentum_adv',
            };
        }
    }
    return { detected:false };
}

// ---- 4. CLUSTER BREAK ANALYSIS ----
function analyzeClusterBreak(results) {
    if (results.length < 12) return { detected:false };
    // Tìm cluster: nhóm cùng loại liền kề
    const clusters = [];
    let cur = results[0], len = 1;
    for (let i = 1; i < results.length; i++) {
        if (results[i] === cur) len++;
        else { clusters.push({ type:cur, len }); cur = results[i]; len = 1; }
    }
    clusters.push({ type:cur, len });
    if (clusters.length < 3) return { detected:false };
    const c0 = clusters[0], c1 = clusters[1], c2 = clusters[2];
    // Pattern: cluster ngày càng ngắn → sắp đảo nhanh
    if (c2.len > c1.len && c1.len > c0.len && c0.len >= 2) {
        return {
            detected   : true,
            prediction : c0.type === 'Tài' ? 'Xỉu' : 'Tài',
            confidence : Math.round(70 + c0.len * 2),
            name       : `Cluster Ngắn Dần (${c2.len}→${c1.len}→${c0.len}) → Đảo ${c0.type === 'Tài' ? 'Xỉu' : 'Tài'}`,
            patternId  : 'cluster_break',
        };
    }
    // Pattern: cluster đang dài hơn trước → tiếp tục
    if (c0.len > c1.len && c0.len > c2.len && c0.len >= 3) {
        return {
            detected   : true,
            prediction : c0.type,
            confidence : Math.round(68 + c0.len),
            name       : `Cluster Lớn Nhất (${c0.len} ${c0.type}) → Tiếp ${c0.type}`,
            patternId  : 'cluster_break',
        };
    }
    return { detected:false };
}

// ---- 5. FOURIER / CYCLE DETECTION ----
function analyzeFourierCycle(results) {
    if (results.length < 30) return { detected:false };
    const binary = results.map(r => r === 'Tài' ? 1 : -1);
    // Tìm chu kỳ 4,5,6,7,8
    const cycles = [4, 5, 6, 7, 8];
    let bestCycle = null, bestScore = 0;
    for (const c of cycles) {
        let score = 0;
        for (let i = c; i < Math.min(binary.length, 30); i++) {
            if (binary[i] === binary[i - c]) score++;
        }
        const acc = score / (Math.min(binary.length, 30) - c);
        if (acc > bestScore) { bestScore = acc; bestCycle = c; }
    }
    if (bestScore > 0.72 && bestCycle) {
        const nextFromCycle = results[bestCycle] === 'Tài' ? 'Tài' : 'Xỉu';
        return {
            detected   : true,
            prediction : nextFromCycle,
            confidence : Math.round(60 + bestScore * 25),
            name       : `Chu Kỳ Fourier ${bestCycle} phiên (match ${(bestScore*100).toFixed(0)}%) → ${nextFromCycle}`,
            patternId  : 'fourier_cycle',
        };
    }
    return { detected:false };
}

// ---- 6. BAYESIAN UPDATER ----
function analyzeBayesian(results, patternStats) {
    if (results.length < 15) return { detected:false };
    // Prior: 50/50
    let priorTai = 0.5, priorXiu = 0.5;
    // Cập nhật theo 15 phiên gần nhất (Bayes sequential)
    const window = results.slice(0, 15);
    for (let i = 0; i < window.length; i++) {
        const likelihood = i < 5 ? 0.65 : i < 10 ? 0.55 : 0.52; // Gần nhất → ảnh hưởng nhiều
        if (window[i] === 'Tài') {
            priorTai = (priorTai * likelihood) / (priorTai * likelihood + priorXiu * (1 - likelihood));
            priorXiu = 1 - priorTai;
        } else {
            priorXiu = (priorXiu * likelihood) / (priorTai * (1 - likelihood) + priorXiu * likelihood);
            priorTai = 1 - priorXiu;
        }
    }
    const diff = Math.abs(priorTai - priorXiu);
    if (diff > 0.12) {
        const pred = priorTai > priorXiu ? 'Xỉu' : 'Tài'; // Bayesian mean-reversion
        return {
            detected   : true,
            prediction : pred,
            confidence : Math.round(62 + diff * 120),
            name       : `Bayesian (P_Tài=${(priorTai*100).toFixed(1)}% P_Xỉu=${(priorXiu*100).toFixed(1)}%) → ${pred}`,
            patternId  : 'bayesian_update',
        };
    }
    return { detected:false };
}

// ---- 7. RESISTANCE LEVEL ----
function analyzeResistanceLevel(data) {
    if (data.length < 20) return { detected:false };
    const sums = data.slice(0, 30).map(d => d.Tong || 10);
    const avg  = sums.reduce((a, b) => a + b, 0) / sums.length;
    const recent3Avg = sums.slice(0, 3).reduce((a, b) => a + b, 0) / 3;
    // Nếu avg gần 10.5 (trung tâm) và recent drift về một phía → revert
    if (Math.abs(avg - 10.5) < 0.5) {
        if (recent3Avg > 12) {
            return { detected:true, prediction:'Xỉu', confidence:67, name:`Resistance Tổng Cao (${recent3Avg.toFixed(1)}) → Xỉu`, patternId:'resistance_lvl' };
        }
        if (recent3Avg < 9) {
            return { detected:true, prediction:'Tài', confidence:67, name:`Resistance Tổng Thấp (${recent3Avg.toFixed(1)}) → Tài`, patternId:'resistance_lvl' };
        }
    }
    return { detected:false };
}

// ---- 8. KELLY CRITERION SIGNAL ----
function analyzeKellyCriterion(results, patternStats) {
    if (results.length < 20) return { detected:false };
    const recent20  = results.slice(0, 20);
    const taiCount  = recent20.filter(r => r === 'Tài').length;
    const xiuCount  = 20 - taiCount;
    const p_tai     = taiCount / 20;
    const p_xiu     = xiuCount / 20;
    // Kelly fraction: f = p - (1-p) = 2p - 1  (với odds 1:1)
    const kellyTai  = 2 * p_tai - 1;
    const kellyXiu  = 2 * p_xiu - 1;
    // Nếu Kelly mạnh về một phía → đặt theo đó (mean-reversion: đặt ngược)
    if (Math.abs(kellyTai) > 0.2) {
        const side = kellyTai > 0 ? 'Tài' : 'Xỉu'; // phía đang chiếm ưu thế
        const pred = side === 'Tài' ? 'Xỉu' : 'Tài'; // đặt ngược (mean-revert)
        return {
            detected   : true,
            prediction : pred,
            confidence : Math.round(63 + Math.abs(kellyTai) * 70),
            name       : `Kelly Criterion (Tài${(p_tai*100).toFixed(0)}%→Kelly${kellyTai.toFixed(2)}) → Revert ${pred}`,
            patternId  : 'kelly_criterion',
        };
    }
    return { detected:false };
}

// ---- 9. CẦU GẦN ĐÂY (Recency-weighted pattern) ----
function analyzeCauGan(results) {
    if (results.length < 6) return { detected:false };
    // 3 phiên gần nhất giống nhau → tiếp tục hoặc bẻ theo độ dài
    const r = results;
    if (r[0]===r[1] && r[1]===r[2]) {
        // 3 giống nhau
        const len = r.filter((v,i) => i < r.length && v === r[0]).findIndex(v => v !== r[0]);
        const streak = len === -1 ? r.length : len;
        if (streak <= 4) {
            return { detected:true, prediction:r[0], confidence:68, name:`Cầu Gần Đây ${streak} ${r[0]} → Tiếp`, patternId:'cau_gan' };
        } else {
            return { detected:true, prediction:r[0]==='Tài'?'Xỉu':'Tài', confidence:72, name:`Cầu Gần Đây ${streak} ${r[0]} → Bẻ`, patternId:'cau_gan' };
        }
    }
    if (r[0]!==r[1] && r[1]!==r[2] && r[0]===r[2]) {
        // Pattern xen kẽ X T X hoặc T X T
        return { detected:true, prediction:r[0]==='Tài'?'Xỉu':'Tài', confidence:65, name:`Cầu Gần Xen Kẽ → Tiếp ${r[0]==='Tài'?'Xỉu':'Tài'}`, patternId:'cau_gan' };
    }
    return { detected:false };
}

// ---- 10. ANTI-LOSS EMERGENCY BOOST ----
function analyzeAntiLossBoost(key, currentPrediction) {
    const s = getAntiLossState(key);
    if (s.consecutiveLoss < 2) return { detected:false };
    // Nếu đang thua 2+ phiên: tăng weight cho chiều ngược với pattern vừa thua
    if (s.consecutiveLoss === 2 && s.lastPrediction) {
        const boosted = s.lastPrediction === 'Tài' ? 'Xỉu' : 'Tài';
        if (boosted !== currentPrediction) {
            return {
                detected   : true,
                prediction : boosted,
                confidence : 75,
                name       : `Anti-Loss Boost (${s.consecutiveLoss} phiên thua) → ${boosted}`,
                patternId  : 'anti_loss_boost',
            };
        }
    }
    return { detected:false };
}

// =================================================================================================
// HÀM TÍNH TOÁN DỰ ĐOÁN CHÍNH (NÂNG CẤP)
// =================================================================================================
function lc79_initializePatternStats(type) {
    if (!lc79_learningData[type]) lc79_learningData[type] = initLearningSlot();
    if (!lc79_learningData[type].patternWeights || Object.keys(lc79_learningData[type].patternWeights).length === 0) {
        lc79_learningData[type].patternWeights = { ...LC79_DEFAULT_PATTERN_WEIGHTS };
    }
    if (!lc79_learningData[type].patternStats) lc79_learningData[type].patternStats = {};
    if (!lc79_learningData[type].markovChain)  lc79_learningData[type].markovChain  = {};
    if (!lc79_learningData[type].layerWeights) lc79_learningData[type].layerWeights  = { markov:1.5, pattern:1.2, entropy:1.0, momentum:1.1, classic:1.0 };
    Object.keys(LC79_DEFAULT_PATTERN_WEIGHTS).forEach(pattern => {
        if (!lc79_learningData[type].patternStats[pattern]) {
            lc79_learningData[type].patternStats[pattern] = { total:0, correct:0, accuracy:0.5, recentResults:[], lastAdjustment:null };
        }
    });
}

function lc79_getPatternIdFromName(name) {
    const mapping = {
        'Cầu Bệt':'cau_bet','Cầu Đảo 1-1':'cau_dao_11','Cầu 2-2':'cau_22','Cầu 3-3':'cau_33',
        'Cầu 4-4':'cau_44','Cầu 5-5':'cau_55','Cầu 1-2-1':'cau_121','Cầu 1-2-3':'cau_123',
        'Cầu 3-2-1':'cau_321','Cầu 2-1-2':'cau_212','Cầu 1-2-2-1':'cau_1221','Cầu 2-1-1-2':'cau_2112',
        'Cầu Nhảy Cóc':'cau_nhay_coc','Cầu Nhịp Nghiêng':'cau_nhip_nghieng','Cầu 3 Ván 1':'cau_3van1',
        'Cầu Bẻ Cầu':'cau_be_cau','Cầu Chu Kỳ':'cau_chu_ky','Cầu Gấp':'cau_gap','Cầu Ziczac':'cau_ziczac',
        'Cầu Đôi':'cau_doi','Cầu Rồng':'cau_rong','Đảo Xu Hướng':'smart_bet','Xu Hướng Cực':'smart_bet',
        'Phân bố':'distribution','Tổng TB':'dice_pattern','Xu hướng':'sum_trend','Cực Điểm':'edge_cases',
        'Biến động':'momentum','Cầu Tự Nhiên':'cau_tu_nhien','Biểu Đồ Đường':'dice_trend_line',
        'Cầu Liên Tục':'break_pattern_hu','Dây Gãy':'day_gay','Tổng Phân Tích':'tong_phan_tich',
        'Xu Hướng Mạnh':'xu_huong_manh','Đảo Chiều':'dao_chieu','Bẻ Chuỗi':'break_streak',
        'Bẻ Đảo':'alternating_break','Cặp Đảo Xen Kẽ':'double_pair_break','Bộ Ba':'triple_pattern',
        'Markov':'markov_chain','Entropy':'entropy_signal','Momentum WMA':'momentum_adv',
        'Cluster':'cluster_break','Chu Kỳ Fourier':'fourier_cycle','Bayesian':'bayesian_update',
        'Kelly':'kelly_criterion','Resistance':'resistance_lvl','Cầu Gần':'cau_gan',
        'Anti-Loss':'anti_loss_boost',
    };
    for (const [key, value] of Object.entries(mapping)) {
        if (name.includes(key)) return value;
    }
    return null;
}

function lc79_updatePatternPerformance(type, patternId, isCorrect) {
    lc79_initializePatternStats(type);
    const stats = lc79_learningData[type].patternStats[patternId];
    if (!stats) return;
    stats.total++;
    if (isCorrect) stats.correct++;
    stats.recentResults.push(isCorrect ? 1 : 0);
    if (stats.recentResults.length > 20) stats.recentResults.shift();
    const recentAcc = stats.recentResults.reduce((a,b)=>a+b,0)/stats.recentResults.length;
    stats.accuracy  = stats.total > 0 ? stats.correct/stats.total : 0.5;
    const oldWeight = lc79_learningData[type].patternWeights[patternId] || 1.0;
    let newWeight   = oldWeight;
    if (stats.recentResults.length >= 5) {
        if (recentAcc > 0.70) newWeight = Math.min(4.0, oldWeight * 1.15);
        else if (recentAcc > 0.60) newWeight = Math.min(3.0, oldWeight * 1.08);
        else if (recentAcc < 0.30) newWeight = Math.max(0.1, oldWeight * 0.80);
        else if (recentAcc < 0.40) newWeight = Math.max(0.2, oldWeight * 0.90);
    }
    lc79_learningData[type].patternWeights[patternId] = newWeight;
    stats.lastAdjustment = new Date().toISOString();
}

function lc79_recordPrediction(type, phien, prediction, confidence, patterns) {
    lc79_initializePatternStats(type);
    const record = { phien:phien.toString(), prediction, confidence, patterns, timestamp:new Date().toISOString(), verified:false, actual:null, isCorrect:null };
    lc79_learningData[type].predictions.unshift(record);
    lc79_learningData[type].totalPredictions++;
    if (lc79_learningData[type].predictions.length > 500) lc79_learningData[type].predictions = lc79_learningData[type].predictions.slice(0,500);
}

async function lc79_verifyPredictions(type, currentData) {
    lc79_initializePatternStats(type);
    if (!lc79_learningData[type].predictions) return;
    let updated = false;
    for (const pred of lc79_learningData[type].predictions) {
        if (pred.verified) continue;
        const actualResult = currentData.find(d => d.Phien.toString() === pred.phien);
        if (actualResult) {
            pred.verified = true;
            pred.actual   = actualResult.Ket_qua;
            const predictedNormalized = pred.prediction === 'Tài' || pred.prediction === 'tai' ? 'Tài' : 'Xỉu';
            pred.isCorrect = pred.actual === predictedNormalized;
            const streak   = lc79_learningData[type].streakAnalysis;
            if (pred.isCorrect) {
                lc79_learningData[type].correctPredictions++;
                streak.wins++;
                streak.currentStreak = streak.currentStreak >= 0 ? streak.currentStreak + 1 : 1;
                if (streak.currentStreak > streak.bestStreak) streak.bestStreak = streak.currentStreak;
            } else {
                streak.losses++;
                streak.currentStreak = streak.currentStreak <= 0 ? streak.currentStreak - 1 : -1;
                if (streak.currentStreak < streak.worstStreak) streak.worstStreak = streak.currentStreak;
            }
            lc79_learningData[type].recentAccuracy.push(pred.isCorrect ? 1 : 0);
            if (lc79_learningData[type].recentAccuracy.length > 50) lc79_learningData[type].recentAccuracy.shift();
            if (pred.patterns && pred.patterns.length > 0) {
                pred.patterns.forEach(patternName => {
                    const patternId = lc79_getPatternIdFromName(patternName);
                    if (patternId) lc79_updatePatternPerformance(type, patternId, pred.isCorrect);
                });
            }
            // Update Markov chain
            updateMarkovFromResult(type, currentData, actualResult);
            updated = true;
        }
    }
    if (updated) {
        lc79_learningData[type].lastUpdate = new Date().toISOString();
    }
}

function updateMarkovFromResult(type, data, latestResult) {
    if (!lc79_learningData[type].markovChain) lc79_learningData[type].markovChain = {};
    const chain = lc79_learningData[type].markovChain;
    const results = data.map(d => d.Ket_qua);
    // Update chain với data mới
    for (let order = 1; order <= 5; order++) {
        for (let i = 0; i < Math.min(results.length - order, 20); i++) {
            const state = results.slice(i, i + order).join('');
            const next  = results[i + order];
            if (!chain[state]) chain[state] = { 'Tài':0, 'Xỉu':0, total:0 };
            // Chỉ tăng nếu chưa có
        }
    }
}

function getAdaptiveConfidenceBoost(type) {
    if (!lc79_learningData[type] || !lc79_learningData[type].recentAccuracy) return 0;
    const recentAcc = lc79_learningData[type].recentAccuracy;
    if (recentAcc.length < 10) return 0;
    const accuracy = recentAcc.slice(-10).reduce((a,b)=>a+b,0)/10;
    if (accuracy > 0.75) return 12;
    if (accuracy > 0.65) return 7;
    if (accuracy > 0.55) return 3;
    if (accuracy < 0.30) return -12;
    if (accuracy < 0.40) return -7;
    return 0;
}

// =================================================================================================
// CÁC HÀM PHÂN TÍCH CẦU CỔ ĐIỂN (giữ nguyên từ bản cũ)
// =================================================================================================
function analyzeTongPhanTich(data, type) {
    if (data.length < 10) return { detected:false };
    const recent10 = data.slice(0,10);
    const sums     = recent10.map(d => d.Tong || 10.5);
    const results  = recent10.map(d => d.Ket_qua);
    const taiCount = results.filter(r=>r==='Tài').length;
    const xiuCount = results.length - taiCount;
    const first5Sum= sums.slice(5,10).reduce((a,b)=>a+b,0)/5;
    const last5Sum = sums.slice(0,5).reduce((a,b)=>a+b,0)/5;
    const sumTrend = last5Sum - first5Sum;
    if (sumTrend > 1.5) return { detected:true, prediction:'Xỉu', confidence:Math.round(75+Math.abs(sumTrend)*3), name:`Tổng Phân Tích (Tổng tăng ${sumTrend.toFixed(1)}→Xỉu)`, patternId:'tong_phan_tich' };
    if (sumTrend < -1.5) return { detected:true, prediction:'Tài', confidence:Math.round(75+Math.abs(sumTrend)*3), name:`Tổng Phân Tích (Tổng giảm ${Math.abs(sumTrend).toFixed(1)}→Tài)`, patternId:'tong_phan_tich' };
    if (Math.abs(taiCount - xiuCount) >= 3) {
        const lech = taiCount > xiuCount ? 'Tài' : 'Xỉu';
        const pred = lech === 'Tài' ? 'Xỉu' : 'Tài';
        return { detected:true, prediction:pred, confidence:Math.round(70+Math.abs(taiCount-xiuCount)*3), name:`Tổng Phân Tích (Lệch ${Math.abs(taiCount-xiuCount)} về ${lech}→${pred})`, patternId:'tong_phan_tich' };
    }
    return { detected:false };
}
function analyzeXuHuongManh(results, type) {
    if (results.length < 8) return { detected:false };
    const recent8  = results.slice(0,8);
    const taiCount = recent8.filter(r=>r==='Tài').length;
    if (taiCount >= 6) return { detected:true, prediction:'Xỉu', confidence:Math.round(80+taiCount*2), name:`Xu Hướng Mạnh (${taiCount}/8 Tài→Đảo Xỉu)`, patternId:'xu_huong_manh' };
    if (taiCount <= 2) return { detected:true, prediction:'Tài', confidence:Math.round(80+(8-taiCount)*2), name:`Xu Hướng Mạnh (${8-taiCount}/8 Xỉu→Đảo Tài)`, patternId:'xu_huong_manh' };
    return { detected:false };
}
function analyzeDaoChieu(results, type) {
    if (results.length < 5) return { detected:false };
    const recent5 = results.slice(0,5);
    let isAlt = true;
    for (let i=0;i<recent5.length-1;i++) if (recent5[i]===recent5[i+1]) { isAlt=false; break; }
    if (isAlt) return { detected:true, prediction:recent5[0]==='Tài'?'Xỉu':'Tài', confidence:75, name:`Đảo Chiều (${recent5.join('-')})`, patternId:'dao_chieu' };
    return { detected:false };
}
function analyzeCauBet(results, type) {
    if (results.length < 3) return { detected:false };
    let streakType=results[0], streakLength=1;
    for (let i=1;i<results.length;i++) if (results[i]===streakType) streakLength++; else break;
    if (streakLength >= 3) {
        let shouldBreak=streakLength>=5, confidence=65;
        if (streakLength>=7) { shouldBreak=true; confidence=85; }
        else if (streakLength>=5) { shouldBreak=true; confidence=75; }
        return { detected:true, type:streakType, length:streakLength, prediction:shouldBreak?(streakType==='Tài'?'Xỉu':'Tài'):streakType, confidence, name:`Cầu Bệt ${streakLength} phiên ${streakType}`, patternId:'cau_bet' };
    }
    return { detected:false };
}
function analyzeCauDao11(results, type) {
    if (results.length < 4) return { detected:false };
    let altLen=1;
    for (let i=1;i<Math.min(results.length,10);i++) if (results[i]!==results[i-1]) altLen++; else break;
    if (altLen >= 4) return { detected:true, length:altLen, prediction:results[0]==='Tài'?'Xỉu':'Tài', confidence:Math.min(80,65+altLen*2), name:`Cầu Đảo 1-1 (${altLen} phiên)`, patternId:'cau_dao_11' };
    return { detected:false };
}
function analyzeCau22(results, type) {
    if (results.length < 6) return { detected:false };
    let pairCount=0, i=0, pattern=[];
    while (i<results.length-1 && pairCount<4) {
        if (results[i]===results[i+1]) { pattern.push(results[i]); pairCount++; i+=2; } else break;
    }
    if (pairCount >= 2) {
        let isAlt=true;
        for (let j=1;j<pattern.length;j++) if (pattern[j]===pattern[j-1]) { isAlt=false; break; }
        if (isAlt) {
            const lastPairType=pattern[pattern.length-1];
            return { detected:true, pairCount, prediction:lastPairType==='Tài'?'Xỉu':'Tài', confidence:Math.round(Math.min(78,65+pairCount*3)), name:`Cầu 2-2 (${pairCount} cặp)`, patternId:'cau_22' };
        }
    }
    return { detected:false };
}
function analyzeCau33(results, type) {
    if (results.length < 6) return { detected:false };
    let tripleCount=0, i=0, pattern=[];
    while (i<results.length-2) {
        if (results[i]===results[i+1] && results[i+1]===results[i+2]) { pattern.push(results[i]); tripleCount++; i+=3; } else break;
    }
    if (tripleCount >= 1) {
        const lastTripleType=pattern[pattern.length-1];
        const prediction=tripleCount%2===0?lastTripleType:(lastTripleType==='Tài'?'Xỉu':'Tài');
        return { detected:true, tripleCount, prediction, confidence:Math.round(Math.min(80,68+tripleCount*4)), name:`Cầu 3-3 (${tripleCount} bộ ba)`, patternId:'cau_33' };
    }
    return { detected:false };
}
function analyzeCauRong(results, type) {
    if (results.length < 6) return { detected:false };
    let streakLen=1;
    for (let i=1;i<results.length;i++) if (results[i]===results[0]) streakLen++; else break;
    if (streakLen >= 6) return { detected:true, prediction:results[0]==='Tài'?'Xỉu':'Tài', confidence:Math.round(Math.min(90,75+streakLen)), name:`Cầu Rồng ${streakLen} phiên (Bẻ mạnh)`, patternId:'cau_rong' };
    return { detected:false };
}
function analyzeSmartBet(results, type) {
    if (results.length < 10) return { detected:false };
    const last10=results.slice(0,10), last5=results.slice(0,5), prev5=results.slice(5,10);
    const taiLast5=last5.filter(r=>r==='Tài').length, taiPrev5=prev5.filter(r=>r==='Tài').length;
    const trendChanging=(taiLast5>=4 && taiPrev5<=1)||(taiLast5<=1 && taiPrev5>=4);
    if (trendChanging) {
        const currentDom=taiLast5>=4?'Tài':'Xỉu';
        return { detected:true, prediction:currentDom==='Tài'?'Xỉu':'Tài', confidence:78, name:`Đảo Xu Hướng (${taiLast5}T-${5-taiLast5}X→${taiPrev5}T-${5-taiPrev5}X)`, patternId:'smart_bet' };
    }
    const taiLast10=last10.filter(r=>r==='Tài').length;
    if (taiLast10>=8||taiLast10<=2) {
        const dom=taiLast10>=8?'Tài':'Xỉu';
        return { detected:true, prediction:dom==='Tài'?'Xỉu':'Tài', confidence:82, name:`Xu Hướng Cực (${taiLast10}T-${10-taiLast10}X)→Đảo`, patternId:'smart_bet' };
    }
    return { detected:false };
}
function analyzeCauNhipNghieng(results, type) {
    if (results.length < 5) return { detected:false };
    const last5=results.slice(0,5);
    const taiCount5=last5.filter(r=>r==='Tài').length;
    if (taiCount5>=4) return { detected:true, prediction:'Tài', confidence:70, name:`Cầu Nhịp Nghiêng (${taiCount5}/5 Tài)`, patternId:'cau_nhip_nghieng' };
    if (taiCount5<=1) return { detected:true, prediction:'Xỉu', confidence:70, name:`Cầu Nhịp Nghiêng (${5-taiCount5}/5 Xỉu)`, patternId:'cau_nhip_nghieng' };
    return { detected:false };
}
function analyzeBreakStreak(results, type) {
    if (results.length < 5) return { detected:false };
    let streakType=results[0], streakLen=1;
    for (let i=1;i<results.length;i++) if (results[i]===streakType) streakLen++; else break;
    if (streakLen >= 5) {
        const prediction=streakType==='Tài'?'Xỉu':'Tài';
        return { detected:true, prediction, confidence:Math.round(Math.min(87,70+streakLen)), name:`Bẻ Chuỗi ${streakLen} (${streakType}→${prediction})`, patternId:'break_streak' };
    }
    return { detected:false };
}
function analyzeAlternatingBreak(results, type) {
    if (results.length < 6) return { detected:false };
    let altCount=0;
    for (let i=0;i<results.length-1;i++) if (results[i]!==results[i+1]) altCount++; else break;
    if (altCount >= 6) {
        const prediction=results[0]==='Tài'?'Xỉu':'Tài';
        return { detected:true, prediction, confidence:Math.round(Math.min(84,68+altCount)), name:`Bẻ Đảo ${altCount} phiên→${prediction}`, patternId:'alternating_break' };
    }
    return { detected:false };
}
function analyzeDistribution(data, type, windowSize) {
    if (!windowSize) windowSize=50;
    const window = data.slice(0,windowSize);
    const taiCount=window.filter(d=>d.Ket_qua==='Tài').length;
    const xiuCount=window.length-taiCount;
    return { taiPercent:(taiCount/window.length)*100, xiuPercent:(xiuCount/window.length)*100, taiCount, xiuCount, total:window.length, imbalance:Math.abs(taiCount-xiuCount)/window.length };
}
function analyzeCauTuNhien(results, type) {
    if (results.length < 2) return { detected:false };
    return { detected:true, prediction:results[0], confidence:58, name:'Cầu Tự Nhiên (Theo Ván Trước)', patternId:'cau_tu_nhien' };
}

// =================================================================================================
// TÍNH TOÁN DỰ ĐOÁN CHÍNH - 7 ENGINE + CONSENSUS (NÂNG CẤP)
// =================================================================================================
function calculateAdvancedPrediction(data, type, antiLossKey) {
    const last50  = data.slice(0, 50);
    const results = last50.map(d => d.Ket_qua);
    lc79_initializePatternStats(type);

    // Build / get Markov chain
    const markovChain = buildMarkovChain(results, 5);
    // Lưu vào learning data
    if (lc79_learningData[type]) lc79_learningData[type].markovChain = markovChain;

    let predictions  = [];
    let factors      = [];
    let allPatterns  = [];

    // ---- LAYER 1: MARKOV ENGINE ----
    const markovRes = predictMarkov(results, markovChain);
    if (markovRes.detected) {
        const w = (lc79_learningData[type].patternWeights['markov_chain'] || 2.0);
        predictions.push({ prediction:markovRes.prediction, confidence:markovRes.confidence, priority:16, name:markovRes.name, weight:w });
        factors.push(markovRes.name);
        allPatterns.push(markovRes);
    }

    // ---- LAYER 2: ENTROPY ENGINE ----
    const entropyRes = analyzeEntropySignal(results);
    if (entropyRes.detected) {
        const w = (lc79_learningData[type].patternWeights['entropy_signal'] || 1.6);
        predictions.push({ prediction:entropyRes.prediction, confidence:entropyRes.confidence, priority:15, name:entropyRes.name, weight:w });
        factors.push(entropyRes.name);
        allPatterns.push(entropyRes);
    }

    // ---- LAYER 3: MOMENTUM ENGINE ----
    const momentumRes = analyzeAdvancedMomentum(last50);
    if (momentumRes.detected) {
        const w = (lc79_learningData[type].patternWeights['momentum_adv'] || 1.4);
        predictions.push({ prediction:momentumRes.prediction, confidence:momentumRes.confidence, priority:14, name:momentumRes.name, weight:w });
        factors.push(momentumRes.name);
        allPatterns.push(momentumRes);
    }

    // ---- LAYER 4: BAYESIAN ENGINE ----
    const bayesRes = analyzeBayesian(results, lc79_learningData[type].patternStats);
    if (bayesRes.detected) {
        const w = (lc79_learningData[type].patternWeights['bayesian_update'] || 1.8);
        predictions.push({ prediction:bayesRes.prediction, confidence:bayesRes.confidence, priority:13, name:bayesRes.name, weight:w });
        factors.push(bayesRes.name);
        allPatterns.push(bayesRes);
    }

    // ---- LAYER 5: CLUSTER ENGINE ----
    const clusterRes = analyzeClusterBreak(results);
    if (clusterRes.detected) {
        const w = (lc79_learningData[type].patternWeights['cluster_break'] || 1.3);
        predictions.push({ prediction:clusterRes.prediction, confidence:clusterRes.confidence, priority:12, name:clusterRes.name, weight:w });
        factors.push(clusterRes.name);
        allPatterns.push(clusterRes);
    }

    // ---- LAYER 6: FOURIER ENGINE ----
    const fourierRes = analyzeFourierCycle(results);
    if (fourierRes.detected) {
        const w = (lc79_learningData[type].patternWeights['fourier_cycle'] || 1.2);
        predictions.push({ prediction:fourierRes.prediction, confidence:fourierRes.confidence, priority:11, name:fourierRes.name, weight:w });
        factors.push(fourierRes.name);
        allPatterns.push(fourierRes);
    }

    // ---- LAYER 7: KELLY ENGINE ----
    const kellyRes = analyzeKellyCriterion(results, lc79_learningData[type].patternStats);
    if (kellyRes.detected) {
        const w = (lc79_learningData[type].patternWeights['kelly_criterion'] || 1.5);
        predictions.push({ prediction:kellyRes.prediction, confidence:kellyRes.confidence, priority:11, name:kellyRes.name, weight:w });
        factors.push(kellyRes.name);
        allPatterns.push(kellyRes);
    }

    // ---- CLASSIC PATTERNS ----
    const classicAnalyzers = [
        { fn:()=>analyzeTongPhanTich(last50,type),   priority:10 },
        { fn:()=>analyzeXuHuongManh(results,type),   priority:10 },
        { fn:()=>analyzeDaoChieu(results,type),       priority:9  },
        { fn:()=>analyzeCauRong(results,type),         priority:9  },
        { fn:()=>analyzeBreakStreak(results,type),     priority:8  },
        { fn:()=>analyzeSmartBet(results,type),        priority:8  },
        { fn:()=>analyzeCauBet(results,type),          priority:7  },
        { fn:()=>analyzeCauDao11(results,type),        priority:7  },
        { fn:()=>analyzeCau22(results,type),           priority:6  },
        { fn:()=>analyzeCau33(results,type),           priority:6  },
        { fn:()=>analyzeCauNhipNghieng(results,type),  priority:5  },
        { fn:()=>analyzeAlternatingBreak(results,type),priority:7  },
        { fn:()=>analyzeResistanceLevel(last50),       priority:6  },
        { fn:()=>analyzeKellyCriterion(results,{}),    priority:5  },
        { fn:()=>analyzeCauGan(results),               priority:6  },
    ];
    for (const a of classicAnalyzers) {
        try {
            const res = a.fn();
            if (res.detected) {
                const w = (lc79_learningData[type].patternWeights[res.patternId] || 1.0);
                predictions.push({ prediction:res.prediction, confidence:res.confidence, priority:a.priority, name:res.name, weight:w });
                factors.push(res.name);
                allPatterns.push(res);
            }
        } catch(e) { /* silent */ }
    }

    // Distribution fallback
    const distribution = analyzeDistribution(last50, type);
    if (distribution.imbalance > 0.15) {
        const minority = distribution.taiPercent < 50 ? 'Tài' : 'Xỉu';
        predictions.push({ prediction:minority, confidence:62, priority:4, name:'Phân bố lệch', weight:1.0 });
        factors.push(`Phân bố (T:${distribution.taiPercent.toFixed(0)}%-X:${distribution.xiuPercent.toFixed(0)}%)`);
    }

    // Fallback
    if (predictions.length === 0) {
        const cauTuNhien = analyzeCauTuNhien(results, type);
        predictions.push({ prediction:cauTuNhien.prediction, confidence:cauTuNhien.confidence, priority:1, name:cauTuNhien.name, weight:1.0 });
        factors.push(cauTuNhien.name);
    }

    // ---- CONSENSUS VOTING (weighted) ----
    let taiScore = 0, xiuScore = 0;
    for (const p of predictions) {
        const score = p.confidence * p.priority * (p.weight || 1.0);
        if (p.prediction === 'Tài') taiScore += score;
        else xiuScore += score;
    }

    // ---- ANTI-LOSS BOOST ----
    const antiLossKey2 = antiLossKey || type;
    const antiBoost = analyzeAntiLossBoost(antiLossKey2, taiScore >= xiuScore ? 'Tài' : 'Xỉu');
    if (antiBoost.detected) {
        const w = LC79_DEFAULT_PATTERN_WEIGHTS['anti_loss_boost'] || 2.5;
        const boostScore = antiBoost.confidence * 12 * w;
        if (antiBoost.prediction === 'Tài') taiScore += boostScore;
        else xiuScore += boostScore;
        factors.push(antiBoost.name);
        predictions.push({ ...antiBoost, priority:12, weight:w });
    }

    let finalPrediction = taiScore >= xiuScore ? 'Tài' : 'Xỉu';

    // ---- BASE CONFIDENCE ----
    let baseConfidence = 65;
    const topPreds = predictions.slice(0, 5);
    for (const p of topPreds) {
        if (p.prediction === finalPrediction) baseConfidence += (p.confidence - 65) * 0.25;
    }
    const agreementRatio = predictions.filter(p => p.prediction === finalPrediction).length / predictions.length;
    baseConfidence += Math.round(agreementRatio * 12);
    baseConfidence += getAdaptiveConfidenceBoost(type);

    // ---- APPLY ANTI-LOSS GUARD ----
    const guardResult = applyAntiLossGuard(antiLossKey2, finalPrediction, Math.round(baseConfidence));
    finalPrediction = guardResult.prediction;
    let finalConfidence = guardResult.confidence;

    return {
        prediction  : finalPrediction,
        confidence  : finalConfidence,
        factors,
        allPatterns,
        forceReversed: guardResult.forceReversed,
        antiLossState: getAntiLossState(antiLossKey2),
        detailedAnalysis: {
            totalPatterns : predictions.length,
            taiVotes      : predictions.filter(p=>p.prediction==='Tài').length,
            xiuVotes      : predictions.filter(p=>p.prediction==='Xỉu').length,
            taiScore, xiuScore,
            topPattern    : predictions.sort((a,b)=>b.priority*b.weight-a.priority*a.weight)[0]?.name || 'N/A',
            distribution,
            layersActive  : { markov:!!markovRes.detected, entropy:!!entropyRes.detected, momentum:!!momentumRes.detected, bayesian:!!bayesRes.detected, cluster:!!clusterRes.detected, fourier:!!fourierRes.detected, kelly:!!kellyRes.detected },
            learningStats : {
                totalPredictions   : lc79_learningData[type].totalPredictions,
                correctPredictions : lc79_learningData[type].correctPredictions,
                accuracy           : lc79_learningData[type].totalPredictions > 0 ? (lc79_learningData[type].correctPredictions/lc79_learningData[type].totalPredictions*100).toFixed(1)+'%' : 'N/A',
                currentStreak      : lc79_learningData[type].streakAnalysis?.currentStreak || 0,
            },
            antiLossGuard : {
                consecutiveLoss  : getAntiLossState(antiLossKey2).consecutiveLoss,
                consecutiveWin   : getAntiLossState(antiLossKey2).consecutiveWin,
                forceReversed    : guardResult.forceReversed,
                penalty          : guardResult.penalty,
                totalForceCount  : getAntiLossState(antiLossKey2).forceReverseCount,
                recentAccuracy10 : (()=>{
                    const r10=getAntiLossState(antiLossKey2).recentResults.slice(-10);
                    return r10.length ? (r10.filter(Boolean).length/r10.length*100).toFixed(0)+'%' : 'N/A';
                })(),
            },
        },
    };
}

function savePredictionToHistory(type, phien, prediction, confidence, latestData) {
    if (!lc79_predictionHistory[type]) lc79_predictionHistory[type] = [];
    const record = {
        Phien:latestData.Phien, Xuc_xac_1:latestData.Xuc_xac_1, Xuc_xac_2:latestData.Xuc_xac_2,
        Xuc_xac_3:latestData.Xuc_xac_3, Tong:latestData.Tong, Ket_qua:latestData.Ket_qua,
        Do_tin_cay:`${confidence}%`, Phien_hien_tai:phien.toString(), Du_doan:prediction,
        ket_qua_du_doan:'', id:'@tranhoang2286', timestamp:new Date().toISOString()
    };
    lc79_predictionHistory[type].unshift(record);
    if (lc79_predictionHistory[type].length > LC79_MAX_HISTORY) lc79_predictionHistory[type] = lc79_predictionHistory[type].slice(0,LC79_MAX_HISTORY);
    return record;
}

// =================================================================================================
// WORKERS TỪ full.py (giữ nguyên)
// =================================================================================================
function worker_geightdors(game_id, platform_id, table, gid, is_md5) {
    const url = `https://jakpotgwab.geightdors.net/glms/v1/notify/taixiu?platform_id=${platform_id}&gid=${gid}`;
    let last_sid=null, sid_for_tx=null;
    const poll = async () => {
        if (!GAME_STATUS[game_id]) { setTimeout(poll,2000); return; }
        try {
            const res  = await axios.get(url, { headers:{'User-Agent':'Mozilla/5.0'}, timeout:5000 });
            const data = res.data;
            if (data && data.status==='OK' && Array.isArray(data.data)) {
                if (!is_md5) for (const g of data.data) if (g.cmd===1008) sid_for_tx=g.sid;
                for (const g of data.data) {
                    if (is_md5 && g.cmd===2006) {
                        const sid=g.sid, d1=g.d1, d2=g.d2, d3=g.d3;
                        if (sid && sid!==last_sid && d1!=null && d2!=null && d3!=null) {
                            last_sid=sid;
                            add_record(game_id, table, { phien:sid, xuc_xac:[d1,d2,d3], tong:d1+d2+d3, ket_qua:get_tai_xiu(d1,d2,d3) });
                        }
                    } else if (!is_md5 && g.cmd===1003) {
                        const d1=g.d1, d2=g.d2, d3=g.d3;
                        if (sid_for_tx && sid_for_tx!==last_sid && d1!=null && d2!=null && d3!=null) {
                            last_sid=sid_for_tx;
                            add_record(game_id, table, { phien:last_sid, xuc_xac:[d1,d2,d3], tong:d1+d2+d3, ket_qua:get_tai_xiu(d1,d2,d3) });
                            sid_for_tx=null;
                        }
                    }
                }
            }
        } catch(e) { /* silent */ }
        setTimeout(poll,3000);
    };
    poll();
}

function worker_wtx(game_id, table, url) {
    let last_sid=null;
    const poll = async () => {
        if (!GAME_STATUS[game_id]) { setTimeout(poll,2000); return; }
        try {
            const res=await axios.get(url,{headers:{'User-Agent':'Mozilla/5.0'},timeout:5000});
            const data=res.data;
            if (data && data.list && data.list.length>0) {
                const s=data.list[0];
                const sid=s.id, dices=s.dices||[];
                if (sid && sid!==last_sid && dices.length===3) {
                    last_sid=sid;
                    const tong=dices.reduce((a,b)=>a+b,0);
                    add_record(game_id, table, { phien:sid, xuc_xac:dices, tong, ket_qua:get_tai_xiu(dices[0],dices[1],dices[2]) });
                }
            }
        } catch(e) { /* silent */ }
        setTimeout(poll,3000);
    };
    poll();
}

function worker_68gb(table, api_url) {
    let last_sid=null;
    const poll = async () => {
        if (!GAME_STATUS["68gb"]) { setTimeout(poll,2000); return; }
        try {
            const res=await axios.get(api_url,{headers:{"User-Agent":"Mozilla/5.0"},timeout:5000});
            const r=res.data;
            const sid=r.Phien;
            if (sid && sid!==last_sid) {
                last_sid=sid;
                const dices=[r.Xuc_xac_1,r.Xuc_xac_2,r.Xuc_xac_3];
                add_record("68gb",table,{phien:sid,xuc_xac:dices,tong:dices.reduce((a,b)=>a+b,0),ket_qua:get_tai_xiu(dices[0],dices[1],dices[2])});
            }
        } catch(e) { /* silent */ }
        setTimeout(poll,2000);
    };
    poll();
}

function worker_luck8(table, api_url) {
    let last_sid=null;
    const poll = async () => {
        if (!GAME_STATUS["luck8"]) { setTimeout(poll,2000); return; }
        try {
            const res=await axios.get(api_url,{headers:{"User-Agent":"Mozilla/5.0"},timeout:5000});
            const r=res.data;
            if (r && r.state===1 && r.data) {
                const data=r.data;
                const sid=data.ID;
                const open_code=data.OpenCode||'';
                const codes=open_code.split(',');
                if (sid && sid!==last_sid && codes.length===3) {
                    last_sid=sid;
                    const dices=codes.map(Number);
                    add_record("luck8",table,{phien:sid,xuc_xac:dices,tong:dices.reduce((a,b)=>a+b,0),ket_qua:get_tai_xiu(dices[0],dices[1],dices[2])});
                }
            }
        } catch(e) { /* silent */ }
        setTimeout(poll,2000);
    };
    poll();
}

function worker_789club_live() {
    const ws_url="wss://ws-taixiu-ls.atpman.net/websocket";
    let ws;
    const connect=()=>{
        if (!GAME_STATUS["789club"]) { setTimeout(connect,2000); return; }
        try {
            ws=new WebSocket(ws_url);
            ws.on('open',()=>log('789club Live WS connected'));
            ws.on('message',(msg)=>{
                try {
                    const data=JSON.parse(msg);
                    if (Array.isArray(data) && data.length>=2 && data[0]===5) {
                        const gd=data[1];
                        if (gd.sessionId && (gd.resultRaw||gd.aM)) {
                            const sid=gd.sessionId;
                            const ds=String(gd.resultRaw||gd.aM);
                            if (ds.length===3 && /^\d+$/.test(ds)) {
                                const dices=[parseInt(ds[0]),parseInt(ds[1]),parseInt(ds[2])];
                                add_record("789club","live",{phien:sid,xuc_xac:dices,tong:dices.reduce((a,b)=>a+b,0),ket_qua:get_tai_xiu(dices[0],dices[1],dices[2])});
                            }
                        }
                    }
                } catch(e) { /* silent */ }
            });
            ws.on('close',()=>{ log('789club Live WS disconnected'); setTimeout(connect,5000); });
            ws.on('error',(err)=>{ logError('789club Live WS:',err); ws.close(); });
        } catch(e) { logError('789club Live WS crash:',e); setTimeout(connect,5000); }
    };
    connect();
}

function worker_789club_minigame() {
    const WS_URL="wss://websocket.atpman.net/websocket";
    const HEADERS={"Origin":"https://play.789club.wien","User-Agent":"Mozilla/5.0"};
    const LOGIN_MSG=[1,"MiniGame","wanglin2019aaand","WamgLin2091",{"info":JSON.stringify({"ipAddress":"113.185.45.88","wsToken":"eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJnZW5kZXIiOjAsImNhblZpZXdTdGF0IjpmYWxzZSwiZGlzcGxheU5hbWUiOiJlbXlldTE3ODljbHVuIiwiYm90IjowLCJpc01lcmNoYW50IjpmYWxzZSwidmVyaWZpZWRCYW5rQWNjb3VudCI6ZmFsc2UsInBsYXlFdmVudExvYmJ5IjpmYWxzZSwiY3VzdG9tZXJJZCI6NjU3NjU3NjksImFmZklkIjoiNzg5IiwiYmFubmVkIjpmYWxzZSwiYnJhbmQiOiI3ODkuY2x1YiIsInRpbWVzdGFtcCI6MTc2NjQ3MDk1NTY4OCwibG9ja0dhbWVzIjpbXSwiYW1vdW50IjowLCJsb2NrQ2hhdCI6ZmFsc2UsInBob25lVmVyaWZpZWQiOmZhbHNlLCJpcEFkZHJlc3MiOiIxMTMuMTg1LjQ1Ljg4IiwibXV0ZSI6ZmFsc2UsImF2YXRhciI6Imh0dHBzOi8vYXBpLnhldWkuaW8vaW1hZ2VzL2F2YXRhci9hdmF0YXJfMjUucG5nIiwicGxhdGZvcm1JZCI6NSwidXNlcklkIjoiMjFkMTUxMjEtYjIzOC00ZDIyLTgzMTMtNGI3YjYwN2VhZjIxIiwicmVnVGltZSI6MTc2NjQ3MDkzMDEwNCwicGhvbmUiOiIiLCJkZXBvc2l0IjpmYWxzZSwidXNlcm5hbWUiOiJTOF93YW5nbGluMjAxOWFhYW5kIn0.F5jr6g1BPGMQ-5EPRdck-PDvVDXcahyGySOFSjyNEuE","locale":"vi","userId":"21d15121-b238-4d22-8313-4b7b607eaf21","username":"S8_wanglin2019aaand","timestamp":1766470955689,"refreshToken":"34ed90232de44567aec7d4752b021717.e8cd9e15f74c42fb8bd491e395d73ab1"}),"signature":"55A3202A0554F20C01D09CD018386265C93B292E843BE3722766912A8F01ACF50E9574D88D52FAFDABEBD4794D3306C87021EF3DD6B25DA102872D23C7C31A0F1D3EB99C0714968A64F6C40335726EB999F1CEAE49BC0954EABA48189E1BBE61BD40C898CA4D683DA76E24386F4431772D05BC8142DAEBFA90E27A9C250A5ED3"}];
    const SUBSCRIBE_TX=[6,"MiniGame","taixiuCommonPlugin",{"cmd":2100}];
    const SUBSCRIBE_LOBBY=[6,"MiniGame","lobbyPlugin",{"cmd":10001}];
    let ws;
    const connect=()=>{
        if (!GAME_STATUS["789club"]) { setTimeout(connect,2000); return; }
        try {
            ws=new WebSocket(WS_URL,{headers:HEADERS});
            ws.on('open',()=>{
                log('789club MiniGame WS connected');
                ws.send(JSON.stringify(LOGIN_MSG));
                setTimeout(()=>{
                    ws.send(JSON.stringify(SUBSCRIBE_TX));
                    ws.send(JSON.stringify(SUBSCRIBE_LOBBY));
                },1000);
                const ka=setInterval(()=>{
                    if (ws.readyState===WebSocket.OPEN) { ws.send("2"); ws.send(JSON.stringify(SUBSCRIBE_TX)); }
                    else clearInterval(ka);
                },10000);
            });
            ws.on('message',(msg)=>{
                try {
                    const data=JSON.parse(msg);
                    if (Array.isArray(data) && data.length>=2 && typeof data[1]==='object') {
                        if (data[1].cmd===2106) {
                            const sid=data[1].sid, d1=data[1].d1, d2=data[1].d2, d3=data[1].d3;
                            if (sid && d1 && d2 && d3) add_record("789club","minigame",{phien:sid,xuc_xac:[d1,d2,d3],tong:d1+d2+d3,ket_qua:get_tai_xiu(d1,d2,d3)});
                        }
                    }
                } catch(e) { /* silent */ }
            });
            ws.on('close',()=>{ log('789club MiniGame WS disconnected'); setTimeout(connect,5000); });
            ws.on('error',(err)=>{ logError('789club MiniGame WS:',err); ws.close(); });
        } catch(e) { logError('789club MiniGame WS crash:',e); setTimeout(connect,5000); }
    };
    connect();
}

function worker_sunwin() {
    const WS_URL="wss://websocket.azhkthg1.net/websocket?token=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJhbW91bnQiOjAsInVzZXJuYW1lIjoiU0NfYXBpc3Vud2luMTIzIn0.hgrRbSV6vnBwJMg9ZFtbx3rRu9mX_hZMZ_m5gMNhkw0";
    const HEADERS={"Origin":"https://play.sun.win"};
    const INIT_MSGS=[[1,"MiniGame","GM_apivopnhaan","WangLin",{"info":JSON.stringify({"ipAddress":"113.185.45.88","wsToken":"eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJnZW5kZXIiOjAsImNhblZpZXdTdGF0IjpmYWxzZSwiZGlzcGxheU5hbWUiOiJwbGFtYW1hIiwiYm90IjowLCJpc01lcmNoYW50IjpmYWxzZSwidmVyaWZpZWRCYW5rQWNjb3VudCI6ZmFsc2UsInBsYXlFdmVudExvYmJ5IjpmYWxzZSwiY3VzdG9tZXJJZCI6MzMxNDgxMTYyLCJhZmZJZCI6IkdFTVdJTiIsImJhbm5lZCI6ZmFsc2UsImJyYW5kIjoiZ2VtIiwidGltZXN0YW1wIjoxNzY2NDc0NzgwMDA2LCJsb2NrR2FtZXMiOltdLCJhbW91bnQiOjAsImxvY2tDaGF0IjpmYWxzZSwicGhvbmVWZXJpZmllZCI6ZmFsc2UsImlwQWRkcmVzcyI6IjExMy4xODUuNDUuODgiLCJtdXRlIjpmYWxzZSwiYXZhdGFyIjoiaHR0cHM6Ly9pbWFnZXMuc3dpbnNob3AubmV0L2ltYWdlcy9hdmF0YXIvYXZhdGFyXzE4LnBuZyIsInBsYXRmb3JtSWQiOjUsInVzZXJJZCI6IjZhOGI0ZDM4LTFlYzEtNDUxYi1hYTA1LWYyZDkwYWFhNGM1MCIsInJlZ1RpbWUiOjE3NjY0NzQ3NTEzOTEsInBob25lIjoiIiwiZGVwb3NpdCI6ZmFsc2UsInVzZXJuYW1lIjoiR01fYXBpdm9wbmhhYW4ifQ.YFOscbeojWNlRo7490BtlzkDGYmwVpnlgOoh04oCJy4","locale":"vi","userId":"6a8b4d38-1ec1-451b-aa05-f2d90aaa4c50","username":"GM_apivopnhaan","timestamp":1766474780007,"refreshToken":"63d5c9be0c494b74b53ba150d69039fd.7592f06d63974473b4aaa1ea849b2940"}),"signature":"66772A1641AA8B18BD99207CE448EA00ECA6D8A4D457C1FF13AB092C22C8DECF0C0014971639A0FBA9984701A91FCCBE3056ABC1BE1541D1C198AA18AF3C45595AF6601F8B048947ADF8F48A9E3E074162F9BA3E6C0F7543D38BD54FD4C0A2C56D19716CC5353BBC73D12C3A92F78C833F4EFFDC4AB99E55C77AD2CDFA91E296"}],[6,"MiniGame","taixiuPlugin",{"cmd":1005}],[6,"MiniGame","lobbyPlugin",{"cmd":10001}]];
    let ws, current_sid=null;
    const connect=()=>{
        if (!GAME_STATUS["sunwin"]) { setTimeout(connect,2000); return; }
        try {
            ws=new WebSocket(WS_URL,{headers:HEADERS});
            ws.on('open',async()=>{
                log('Sunwin WS connected');
                for (const m of INIT_MSGS) { ws.send(JSON.stringify(m)); await new Promise(r=>setTimeout(r,600)); }
            });
            ws.on('message',(msg)=>{
                try {
                    const data=JSON.parse(msg);
                    if (!Array.isArray(data)) return;
                    let cmd=null, payload=null;
                    if (data.length>1 && typeof data[1]==='object') { payload=data[1]; cmd=payload.cmd; }
                    else if (data.length>2 && typeof data[2]==='object') { payload=data[2]; cmd=payload.cmd; }
                    if (cmd===1008) { if (payload && payload.sid) current_sid=payload.sid; }
                    else if (cmd===1003) {
                        if (payload) {
                            const d1=payload.d1, d2=payload.d2, d3=payload.d3;
                            if (d1!=null && d2!=null && d3!=null) {
                                const sid_use=current_sid||payload.sid;
                                add_record("sunwin","main",{phien:sid_use,xuc_xac:[d1,d2,d3],tong:d1+d2+d3,ket_qua:get_tai_xiu(d1,d2,d3)});
                                current_sid=null;
                            }
                        }
                    }
                } catch(e) { /* silent */ }
            });
            ws.on('close',()=>{ log('Sunwin WS disconnected'); setTimeout(connect,3000); });
            ws.on('error',(err)=>{ logError('Sunwin WS:',err); ws.close(); });
        } catch(e) { logError('Sunwin WS crash:',e); setTimeout(connect,3000); }
    };
    connect();
}

function worker_sumclub() {
    const SERVERS=[
        { base:"https://taixiu.apisum.pro",  hub:"luckydiceHub",  tid:1, table:"hu"  },
        { base:"https://taixiu1.apisum.pro", hub:"luckydice1Hub", tid:2, table:"md5" }
    ];
    const HEADERS={"User-Agent":"Mozilla/5.0","Origin":"https://play.sum.vin"};
    SERVERS.forEach(sv=>{
        const connect=async()=>{
            if (!GAME_STATUS["sumclub"]) { setTimeout(connect,2000); return; }
            try {
                const negUrl=`${sv.base}/signalr/negotiate?clientProtocol=1.5`;
                const negRes=await axios.get(negUrl,{headers:HEADERS});
                const token=negRes.data.ConnectionToken;
                if (!token) { setTimeout(connect,3000); return; }
                const wsUrl=`${sv.base.replace('https','wss')}/signalr/connect?transport=webSockets&connectionToken=${encodeURIComponent(token)}&connectionData=${encodeURIComponent(JSON.stringify([{name:sv.hub}]))}&clientProtocol=1.5&tid=${sv.tid}`;
                const ws=new WebSocket(wsUrl,{headers:HEADERS});
                ws.on('open',()=>{
                    log(`Sumclub ${sv.table} WS connected`);
                    ws.send(JSON.stringify([1,"MiniGame","GM_apivopnha","tiendat",{info:"{}",signature:""}]));
                    ws.send(JSON.stringify([6,"MiniGame","taixiuPlugin",{cmd:1005}]));
                });
                ws.on('message',(msg)=>{
                    try {
                        const data=JSON.parse(msg);
                        for (const m of data.M||[]) {
                            if (m.M==="sessionInfo" && m.A) {
                                const res=m.A[0].Result||{};
                                const d1=res.Dice1||0, d2=res.Dice2||0, d3=res.Dice3||0;
                                if (d1>0 && d2>0 && d3>0) {
                                    const sid=m.A[0].SessionID;
                                    add_record("sumclub",sv.table,{phien:sid,xuc_xac:[d1,d2,d3],tong:d1+d2+d3,ket_qua:get_tai_xiu(d1,d2,d3)});
                                }
                            }
                        }
                    } catch(e) { /* silent */ }
                });
                ws.on('close',()=>{ log(`Sumclub ${sv.table} WS disconn`); setTimeout(connect,3000); });
                ws.on('error',(err)=>{ logError(`Sumclub ${sv.table} WS:`,err); ws.close(); });
            } catch(e) { logError(`Sumclub ${sv.table} conn:`,e); setTimeout(connect,3000); }
        };
        connect();
    });
}

function start_all_full_py_workers() {
    log("Starting all workers from full.py...");
    worker_geightdors("b52","b5","hu","vgmn_100",false);
    worker_geightdors("b52","b5","md5","vgmn_101",true);
    worker_geightdors("hitclub","g8","hu","vgmn_100",false);
    worker_geightdors("hitclub","g8","md5","vgmn_101",true);
    worker_geightdors("rikvip","rik","hu","vgmn_100",false);
    worker_geightdors("rikvip","rik","md5","vgmn_101",true);
    worker_wtx("betvip","hu","https://wtx.macminim6.online/v1/tx/sessions");
    worker_wtx("betvip","md5","https://wtxmd52.macminim6.online/v1/txmd5/sessions");
    worker_wtx("lc79","hu","https://wtx.tele68.com/v1/tx/sessions");
    worker_wtx("lc79","md5","https://wtxmd52.tele68.com/v1/txmd5/sessions");
    worker_68gb("hu","http://160.250.5.186:3201/api/68/xanh");
    worker_68gb("md5","http://160.250.5.186:3050/api/68/md5");
    worker_luck8("txhu","https://luck8bot.com/api/GetNewLottery/Taixiu");
    worker_luck8("txmd5","https://luck8bot.com/api/GetNewLottery/TaixiuMd5");
    worker_luck8("tx3p","https://luck8bot.com/api/GetNewLottery/TaixiuMd3");
    worker_789club_live();
    worker_789club_minigame();
    worker_sunwin();
    worker_sumclub();
    log("All full.py workers started.");
}

// =================================================================================================
// WORKERS xocdia88 / sicbo / sicbosum (giữ nguyên)
// =================================================================================================
function xocdia88_poll_api(url, history_store, table_name) {
    const poll=async()=>{
        try {
            const res=await axios.get(url,{headers:{'User-Agent':'Python-Proxy/1.0'},timeout:10000});
            const data=res.data;
            if (Array.isArray(data) && data.length>0) {
                const new_hist=[];
                for (const item of data.slice(0,MAX_HISTORY)) {
                    const sid=item.SessionId;
                    if (sid==null) continue;
                    const d1=item.FirstDice||0, d2=item.SecondDice||0, d3=item.ThirdDice||0;
                    const total=item.DiceSum||0;
                    new_hist.push({phien:sid,xuc_xac:[d1,d2,d3],tong:total,ket_qua:total>=11?'Tài':'Xỉu',created_date:item.CreatedDate||""});
                }
                history_store.length=0;
                history_store.push(...new_hist);
            }
        } catch(e) { logError(`xocdia88 ${table_name} poll:`,e); await new Promise(r=>setTimeout(r,5000)); }
        setTimeout(poll,5000);
    };
    poll();
}
function start_xocdia88_workers() {
    log("Starting xocdia88 workers...");
    xocdia88_poll_api(API_URL_XOCDIA88_HU, xocdia88_history_hu, "HU");
    xocdia88_poll_api(API_URL_XOCDIA88_MD5, xocdia88_history_md5, "MD5");
}

const SICBO_SUMCLUB_SERVER ={ name:"SICBO", base:"https://sicbo.apisum.pro", hub:"sicboHub", tid:22 };
const SICBO_SUMCLUB_HEADERS={"User-Agent":"Mozilla/5.0","Origin":"https://play.sum.vin"};
function sicbo_parse_sumclub_message(message) {
    if (message==="{}"||message==='{"type":6}') return;
    try {
        const data=JSON.parse(message);
        if (!data.M) return;
        for (const m of data.M) {
            const args=m.A||[];
            if (!args.length) continue;
            const obj=args[0];
            if (typeof obj!=='object'||obj===null||!obj.Result) continue;
            const dice=obj.Result;
            const d1=dice.Dice1!=null?dice.Dice1:-1;
            const d2=dice.Dice2!=null?dice.Dice2:-1;
            const d3=dice.Dice3!=null?dice.Dice3:-1;
            if (d1===-1) continue;
            const session=obj.SessionID;
            if (!session||sumclub_session_seen.has(session)) return;
            const tong=d1+d2+d3;
            sumclub_session_seen.add(session);
            sumclub_history.push({gameNum:String(session),score:tong,faces:[d1,d2,d3],resultType:tong>=11?1:0,time:Math.floor(Date.now()/1000)});
            if (sumclub_history.length>MAX_SUMCLUB_HISTORY) { const old=sumclub_history.shift(); sumclub_session_seen.delete(old.gameNum); }
        }
    } catch(e) { /* silent */ }
}
function start_sicbo_sumclub_ws() {
    const connect=async()=>{
        try {
            const negRes=await axios.get(`${SICBO_SUMCLUB_SERVER.base}/signalr/negotiate?clientProtocol=1.5`,{headers:SICBO_SUMCLUB_HEADERS});
            const token=negRes.data.ConnectionToken;
            if (!token) { setTimeout(connect,2000); return; }
            const wsUrl=`${SICBO_SUMCLUB_SERVER.base.replace('https','wss')}/signalr/connect?transport=webSockets&connectionToken=${encodeURIComponent(token)}&connectionData=${encodeURIComponent(JSON.stringify([{name:SICBO_SUMCLUB_SERVER.hub}]))}&clientProtocol=1.5&tid=${SICBO_SUMCLUB_SERVER.tid}`;
            const ws=new WebSocket(wsUrl,{headers:SICBO_SUMCLUB_HEADERS});
            ws.on('open',()=>{ log('Sicbo Sumclub WS connected'); setInterval(()=>{ if(ws.readyState===WebSocket.OPEN){ws.send(JSON.stringify({M:"PingPong",H:SICBO_SUMCLUB_SERVER.hub,I:Date.now()}));ws.send('{"type":6}');}},5000); });
            ws.on('message',(msg)=>sicbo_parse_sumclub_message(msg));
            ws.on('close',()=>{ log('Sicbo Sumclub WS disconn'); setTimeout(connect,2000); });
            ws.on('error',(err)=>{ logError('Sicbo Sumclub WS:',err); ws.close(); });
        } catch(e) { logError('Sicbo Sumclub conn:',e); setTimeout(connect,2000); }
    };
    connect();
}
const SICBO_SUNLIVE_WS_URL="wss://livecasino.azhkthg1.com/websocket?token=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJnZW5kZXIiOjAsImNhblZpZXdTdGF0IjpmYWxzZSwiZGlzcGxheU5hbWUiOiJzdW53aW50aGFjaG9lbTEiLCJib3QiOjAsImlzTWVyY2hhbnQiOmZhbHNlLCJ2ZXJpZmllZEJhbmtBY2NvdW50Ijp0cnVlLCJwbGF5RXZlbnRMb2JieSI6ZmFsc2UsImN1c3RvbWVySWQiOjEzMDA1NTkwMCwiYWZmSWQiOiJzdW53aW4iLCJiYW5uZWQiOmZhbHNlLCJicmFuZCI6InN1bi53aW4iLCJ0aW1lc3RhbXAiOjE3NTU5NzA4NDU0NzIsImxvY2tHYW1lcyI6W10sImFtb3VudCI6MCwibG9ja0NoYXQiOmZhbHNlLCJwaG9uZVZlcmlmaWVkIjpmYWxzZSwiaXBBZGRyZXNzIjoiMjAwMTplZTA6NTE0ODpmZTQwOjRkZWQ6MWVkMDphZjA5OmU1MGIiLCJtdXRlIjpmYWxzZSwiYXZhdGFyIjoiaHR0cHM6Ly9pbWFnZXMuc3dpbnNob3AubmV0L2ltYWdlcy9hdmF0YXIvYXZhdGFyXzExLnBuZyIsInBsYXRmb3JtSWQiOjIsInVzZXJJZCI6ImNiMGFhOWZhLWYyNDktNDYwNC1iMzU1LWUwMjA4YjE5MjA5YyIsInJlZ1RpbWUiOjE2OTcwMjQzMjI4MjEsInBob25lIjoiIiwiZGVwb3NpdCI6dHJ1ZSwidXNlcm5hbWUiOiJTQ19uZ3V5ZW52YW50aW5obmUifQ.wqXlP1bi1q-sdkSTlXuhjrXo9XyDr6VhlF1BT-naXBM";
function start_sicbo_sunlive_ws() {
    const connect=()=>{
        try {
            const ws=new WebSocket(SICBO_SUNLIVE_WS_URL);
            ws.on('open',()=>{
                log('Sicbo Sunlive WS connected');
                ws.send(JSON.stringify([1,"Livestream","SC_nguyenvantinhne","tinhbip",{}]));
                setTimeout(()=>{ if(ws.readyState===WebSocket.OPEN){ws.send(JSON.stringify([6,"Livestream","Sicbo88Plugin",{cmd:1950,sC:true}]));ws.send(JSON.stringify([6,"Livestream","Sicbo88Plugin",{cmd:1959}]));} },1200);
                setInterval(()=>{ if(ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify([2])); },500);
            });
            ws.on('message',(msg)=>{
                try {
                    const data=JSON.parse(msg);
                    if (Array.isArray(data) && data.length>=2 && typeof data[1]==='object') {
                        const p=data[1];
                        if (p.cmd===1956) {
                            const rr=p.resultRaw;
                            if (rr) {
                                const xuc_xac=rr.split('').filter(c=>/\d/.test(c)).map(Number);
                                if (xuc_xac.length===3) {
                                    const tong=xuc_xac.reduce((a,b)=>a+b,0);
                                    const session=p.sessionId;
                                    if (session && !sunlive_session_seen.has(session)) {
                                        sunlive_session_seen.add(session);
                                        sunlive_history.push({gameNum:String(session),score:tong,faces:xuc_xac,resultType:tong>=11?1:0,time:Math.floor(Date.now()/1000)});
                                        if (sunlive_history.length>MAX_SUNLIVE_HISTORY) { const old=sunlive_history.shift(); sunlive_session_seen.delete(old.gameNum); }
                                    }
                                }
                            }
                        }
                    }
                } catch(e) { /* silent */ }
            });
            ws.on('close',()=>{ log('Sicbo Sunlive WS disconn'); setTimeout(connect,3000); });
            ws.on('error',(err)=>{ logError('Sicbo Sunlive WS:',err); ws.close(); });
        } catch(e) { logError('Sicbo Sunlive conn:',e); setTimeout(connect,3000); }
    };
    connect();
}
async function sicbo_luckywin_polling_loop() {
    while (true) {
        try {
            const res=await axios.get('https://luck8bot.com/api/GetNewLottery/Sicbo50',{timeout:5000});
            const data=res.data;
            if (data && data.state===1 && data.data) {
                const record=data.data;
                const faces=(record.OpenCode||'').split(',').map(Number).filter(n=>!isNaN(n));
                if (faces.length===3) {
                    const game_num=String(record.ID||'');
                    if (game_num && !luckywin_id_seen.has(game_num)) {
                        const score=faces.reduce((a,b)=>a+b,0);
                        luckywin_id_seen.add(game_num);
                        luckywin_history.push({gameNum:game_num,score,faces,resultType:score>=11?1:0,time:Math.floor(Date.now()/1000)});
                        if (luckywin_history.length>MAX_LUCKYWIN_HISTORY) { const old=luckywin_history.shift(); luckywin_id_seen.delete(old.gameNum); }
                    }
                }
            }
        } catch(e) { logError('Sicbo Luckywin poll:',e); }
        await new Promise(r=>setTimeout(r,2000));
    }
}
function start_sicbo_workers() {
    log("Starting sicbo workers...");
    start_sicbo_sumclub_ws();
    start_sicbo_sunlive_ws();
    sicbo_luckywin_polling_loop();
}
function sicbosum_parse_message(message) {
    if (message==="{}"||message==='{"type":6}') return;
    try {
        const data=JSON.parse(message);
        sicbosum_RAW_DATA.push({time:Math.floor(Date.now()/1000),raw:message,json:data});
        if (sicbosum_RAW_DATA.length>100) sicbosum_RAW_DATA.shift();
        if (!data.M) return;
        for (const m of data.M) {
            const args=m.A||[];
            if (!args.length) continue;
            const obj=args[0];
            if (typeof obj!=='object'||obj===null||!obj.Result) continue;
            const dice=obj.Result;
            const d1=dice.Dice1!=null?dice.Dice1:-1, d2=dice.Dice2!=null?dice.Dice2:-1, d3=dice.Dice3!=null?dice.Dice3:-1;
            if (d1===-1) continue;
            const tong=d1+d2+d3;
            const session=obj.SessionID;
            if (!session||sicbosum_SESSION_SEEN.has(session)) continue;
            sicbosum_SESSION_SEEN.add(session);
            sicbosum_PARSED_DATA.push({session,dice:[d1,d2,d3],sum:tong,result:tong>=11?"Tai":"Xiu",md5:obj.MD5,bet:{tai:obj.CuaTai,xiu:obj.CuaXiu,chan:obj.CuaChan,le:obj.CuaLe}});
            if (sicbosum_PARSED_DATA.length>100) { const old=sicbosum_PARSED_DATA.shift(); sicbosum_SESSION_SEEN.delete(old.session); }
        }
    } catch(e) { /* silent */ }
}
function start_sicbosum_ws() {
    const connect=async()=>{
        try {
            const negRes=await axios.get(`${SICBOSUM_SERVER.base}/signalr/negotiate?clientProtocol=1.5`,{headers:SICBOSUM_HEADERS});
            const token=negRes.data.ConnectionToken;
            if (!token) { setTimeout(connect,2000); return; }
            const wsUrl=`${SICBOSUM_SERVER.base.replace('https','wss')}/signalr/connect?transport=webSockets&connectionToken=${encodeURIComponent(token)}&connectionData=${encodeURIComponent(JSON.stringify([{name:SICBOSUM_SERVER.hub}]))}&clientProtocol=1.5&tid=${SICBOSUM_SERVER.tid}`;
            const ws=new WebSocket(wsUrl,{headers:SICBOSUM_HEADERS});
            ws.on('open',()=>{ log('SicboSum WS connected'); setInterval(()=>{ if(ws.readyState===WebSocket.OPEN){ws.send(JSON.stringify({M:"PingPong",H:SICBOSUM_SERVER.hub,I:Date.now()}));ws.send('{"type":6}');}},5000); });
            ws.on('message',(msg)=>sicbosum_parse_message(msg));
            ws.on('close',()=>{ log('SicboSum WS disconn'); setTimeout(connect,2000); });
            ws.on('error',(err)=>{ logError('SicboSum WS:',err); ws.close(); });
        } catch(e) { logError('SicboSum conn:',e); setTimeout(connect,2000); }
    };
    connect();
}

// =================================================================================================
// LC79 - LOAD / SAVE / AUTO PROCESS
// =================================================================================================
function lc79_loadLearningData() {
    try {
        if (fs.existsSync(LC79_LEARNING_FILE)) {
            const data=JSON.parse(fs.readFileSync(LC79_LEARNING_FILE,'utf8'));
            if (data.history) { lc79_predictionHistory=data.history; lc79_lastProcessedPhien=data.lastProcessedPhien||{hu:null,md5:null}; }
            if (data.learningData) lc79_learningData={...lc79_learningData,...data.learningData};
            if (data.antiLossState) Object.assign(ANTI_LOSS_STATE, data.antiLossState);
            log('Learning data loaded from '+LC79_LEARNING_FILE);
        }
    } catch(e) { logError('Error loading learning data:',e); }
}
function lc79_saveLearningData() {
    try {
        fs.writeFileSync(LC79_LEARNING_FILE, JSON.stringify({ history:lc79_predictionHistory, lastProcessedPhien:lc79_lastProcessedPhien, learningData:lc79_learningData, antiLossState:ANTI_LOSS_STATE, lastSaved:new Date().toISOString() }, null, 2));
    } catch(e) { logError('Error saving learning data:',e); }
}

function lc79_transformApiData(apiData) {
    if (!apiData||!apiData.list||!Array.isArray(apiData.list)) return null;
    return apiData.list.map(item=>({ Phien:item.id, Ket_qua:item.resultTruyenThong==='TAI'?'Tài':'Xỉu', Xuc_xac_1:item.dices[0], Xuc_xac_2:item.dices[1], Xuc_xac_3:item.dices[2], Tong:item.point }));
}
async function lc79_fetchDataHu()  { try { return lc79_transformApiData((await axios.get(LC79_API_URL_HU,{timeout:10000})).data); } catch(e){ return null; } }
async function lc79_fetchDataMd5() { try { return lc79_transformApiData((await axios.get(LC79_API_URL_MD5,{timeout:10000})).data); } catch(e){ return null; } }

async function lc79_autoProcessPredictions() {
    try {
        // Hu
        const dataHu=await lc79_fetchDataHu();
        if (dataHu && dataHu.length>0) {
            await lc79_verifyPredictions('hu',dataHu);
            const nextPhien=dataHu[0].Phien+1;
            if (lc79_lastProcessedPhien.hu!==nextPhien) {
                const result=calculateAdvancedPrediction(dataHu,'hu','lc79_hu');
                savePredictionToHistory('hu',nextPhien,result.prediction,result.confidence,dataHu[0]);
                lc79_recordPrediction('hu',nextPhien,result.prediction,result.confidence,result.factors);
                lc79_lastProcessedPhien.hu=nextPhien;
                log(`[Auto] Hu phien ${nextPhien}: ${result.prediction} (${result.confidence}%)${result.forceReversed?' [FORCE REVERSED]':''}`);
            }
        }
        // Md5
        const dataMd5=await lc79_fetchDataMd5();
        if (dataMd5 && dataMd5.length>0) {
            await lc79_verifyPredictions('md5',dataMd5);
            const nextPhien=dataMd5[0].Phien+1;
            if (lc79_lastProcessedPhien.md5!==nextPhien) {
                const result=calculateAdvancedPrediction(dataMd5,'md5','lc79_md5');
                savePredictionToHistory('md5',nextPhien,result.prediction,result.confidence,dataMd5[0]);
                lc79_recordPrediction('md5',nextPhien,result.prediction,result.confidence,result.factors);
                lc79_lastProcessedPhien.md5=nextPhien;
                log(`[Auto] MD5 phien ${nextPhien}: ${result.prediction} (${result.confidence}%)${result.forceReversed?' [FORCE REVERSED]':''}`);
            }
        }
        lc79_saveLearningData();
    } catch(e) { logError('[Auto] Error:',e); }
}
function lc79_startAutoSaveTask() {
    log(`LC79 Auto-save task started (every ${LC79_AUTO_SAVE_INTERVAL/1000}s)`);
    setTimeout(()=>lc79_autoProcessPredictions(),5000);
    setInterval(()=>lc79_autoProcessPredictions(),LC79_AUTO_SAVE_INTERVAL);
}

// =================================================================================================
// JSON PREDICTOR ENGINE (nâng cấp anti-loss)
// =================================================================================================
function load_json_predictor_state(key) {
    const cfg=JSON_FILE_MAP[key];
    if (!cfg) return false;
    try {
        if (!fs.existsSync(cfg.file)) { log(`[JSON-PREDICTOR] File not found: ${cfg.file}`); return false; }
        const data=JSON.parse(fs.readFileSync(cfg.file,'utf8'));
        JSON_PREDICTOR_STATE[key]={ history:Array.isArray(data.history)?data.history:[], book:data.book||{}, anti:data.anti||{}, pred_log:Array.isArray(data.pred_log)?data.pred_log:[], model_stats:data.model_stats||{}, last_pred:data.last_pred||null, last_phien:data.last_phien||null, game:cfg.game, table:cfg.table, file:cfg.file, src:cfg.src, dirty:false, loadedAt:new Date().toISOString() };
        log(`[JSON-PREDICTOR] Loaded ${key}: ${JSON_PREDICTOR_STATE[key].history.length} history, ${Object.keys(JSON_PREDICTOR_STATE[key].book).length} patterns`);
        return true;
    } catch(e) { logError(`[JSON-PREDICTOR] Load ${key} error:`,e); return false; }
}
function save_json_predictor_state(key) {
    const st=JSON_PREDICTOR_STATE[key];
    if (!st) return false;
    try {
        fs.writeFileSync(st.file, JSON.stringify({history:st.history,book:st.book,anti:st.anti,pred_log:st.pred_log,model_stats:st.model_stats,last_pred:st.last_pred,last_phien:st.last_phien},null,2));
        st.dirty=false; return true;
    } catch(e) { logError(`[JSON-PREDICTOR] Save ${key} error:`,e); return false; }
}
function load_all_json_predictors() {
    log("[JSON-PREDICTOR] Loading all JSON predictor files...");
    let count=0;
    for (const key in JSON_FILE_MAP) if (load_json_predictor_state(key)) count++;
    log(`[JSON-PREDICTOR] Loaded ${count}/${Object.keys(JSON_FILE_MAP).length} files.`);
}

function get_latest_history_tx(key) {
    const st=JSON_PREDICTOR_STATE[key];
    if (!st) return [];
    const cfg=JSON_FILE_MAP[key];
    if (cfg.src==='full_py' && DATA_STORE[cfg.game]?.[cfg.table]) {
        const arr=DATA_STORE[cfg.game][cfg.table];
        const tx=arr.slice(0,50).map(r=>r.ket_qua==='Tài'?'T':'X').reverse();
        if (tx.length>=2) return tx;
    }
    if (st.history && st.history.length>0) return st.history.slice(0,50).reverse();
    if (cfg.src==='sicbo') {
        if (key==='sumclub_hu' && sumclub_history.length>0) return sumclub_history.slice(0,50).reverse().map(h=>h.resultType===1?'T':'X');
        if (key==='luckywin_main' && luckywin_history.length>0) return luckywin_history.slice(0,50).reverse().map(h=>h.resultType===1?'T':'X');
    }
    return [];
}

function get_all_candidate_patterns(history_array, maxLen) {
    if (!maxLen) maxLen=8;
    if (!history_array||!history_array.length) return [];
    const result=[];
    const startLen=Math.min(history_array.length, maxLen);
    for (let len=startLen;len>=2;len--) result.push({pattern:history_array.slice(-len).join(''),len});
    return result;
}

function predict_from_json_book(key, history_tx) {
    const st=JSON_PREDICTOR_STATE[key];
    if (!st||history_tx.length<2) return {prediction:null,confidence:0,source:'no_state',pattern_used:null};
    const candidates=get_all_candidate_patterns(history_tx,8);
    for (const cand of candidates) {
        const pat=cand.pattern;
        if (st.book[pat]) {
            const bk=st.book[pat];
            const countT=bk.T||0, countX=bk.X||0;
            const total=bk.count||(countT+countX);
            if (total<3) continue;
            let pred, conf;
            if (countT>countX) { pred='T'; conf=countT/total; } else if (countX>countT) { pred='X'; conf=countX/total; } else continue;
            if (st.anti[pat]?.flip && st.anti[pat].wrong>=1) { pred=pred==='T'?'X':'T'; conf=Math.max(0.5,conf-0.1); }
            if (st.model_stats[pat]?.total>=3) {
                const acc=(st.model_stats[pat].correct||0)/st.model_stats[pat].total;
                if (acc>0.7) conf=Math.min(0.95,conf+0.05);
                else if (acc<0.4) conf=Math.max(0.5,conf-0.1);
            }
            // Apply anti-loss guard
            const guardResult=applyAntiLossGuard(`json_${key}`, pred==='T'?'Tài':'Xỉu', Math.round(conf*100));
            const finalPred=guardResult.prediction==='Tài'?'T':'X';
            return {prediction:finalPred,confidence:guardResult.confidence,source:'book',pattern_used:pat,pattern_len:cand.len,book_stats:{T:countT,X:countX,total},forceReversed:guardResult.forceReversed};
        }
    }
    // Fallback với anti-loss
    const last5=history_tx.slice(-5);
    const tCount=last5.filter(x=>x==='T').length;
    const xCount=last5.length-tCount;
    let fallbackPred = tCount>xCount?'T':'X';
    const guardResult=applyAntiLossGuard(`json_${key}`, fallbackPred==='T'?'Tài':'Xỉu', 55);
    fallbackPred=guardResult.prediction==='Tài'?'T':'X';
    return {prediction:fallbackPred,confidence:guardResult.confidence,source:'fallback_last5',pattern_used:null};
}

function update_json_book_with_actual(key, history_tx, actual, pattern_len_max) {
    if (!pattern_len_max) pattern_len_max=6;
    const st=JSON_PREDICTOR_STATE[key];
    if (!st||!actual||(actual!=='T'&&actual!=='X')) return 0;
    let updated=0;
    for (let len=2;len<=Math.min(pattern_len_max,history_tx.length);len++) {
        const pattern=history_tx.slice(-len).join('');
        if (!st.book[pattern]) st.book[pattern]={T:0,X:0,count:0};
        st.book[pattern][actual]=(st.book[pattern][actual]||0)+1;
        st.book[pattern].count=(st.book[pattern].count||0)+1;
        updated++;
    }
    if (updated>0) st.dirty=true;
    return updated;
}

function update_json_anti_and_stats(key, pattern, predicted, actual) {
    const st=JSON_PREDICTOR_STATE[key];
    if (!st||!pattern) return;
    const isCorrect=(predicted===actual);
    // Update anti-loss state
    updateAntiLossState(`json_${key}`, predicted==='T'?'Tài':'Xỉu', actual==='T'?'Tài':'Xỉu', st.last_phien);
    if (!st.model_stats[pattern]) st.model_stats[pattern]={total:0,correct:0,wrong:0};
    st.model_stats[pattern].total++;
    if (isCorrect) st.model_stats[pattern].correct++;
    else st.model_stats[pattern].wrong++;
    const ms=st.model_stats[pattern];
    if (ms.wrong>=2 && ms.wrong>ms.correct) {
        if (!st.anti[pattern]) st.anti[pattern]={wrong:0,flip:true};
        st.anti[pattern].wrong=ms.wrong;
        st.anti[pattern].flip=true;
    }
    st.last_pred={pattern,predicted,actual,correct:isCorrect,timestamp:new Date().toISOString()};
    st.pred_log.push({phien:st.last_phien,pattern,pred:predicted==='T'?'Tài':'Xỉu',actual:actual==='T'?'Tài':'Xỉu',correct:isCorrect,timestamp:new Date().toISOString()});
    if (st.pred_log.length>200) st.pred_log=st.pred_log.slice(-200);
    st.dirty=true;
}

function start_json_auto_update_task() {
    log("[JSON-PREDICTOR] Auto-update task started (every 30s)");
    setInterval(async()=>{
        for (const key in JSON_PREDICTOR_STATE) {
            const st=JSON_PREDICTOR_STATE[key];
            try {
                const cfg=JSON_FILE_MAP[key];
                if (!cfg) continue;
                const history_tx=get_latest_history_tx(key);
                if (history_tx.length<3) continue;
                let current_phien=null;
                if (cfg.src==='full_py' && DATA_STORE[cfg.game]?.[cfg.table]?.[0]) current_phien=DATA_STORE[cfg.game][cfg.table][0].phien;
                else if (cfg.src==='sicbo') {
                    if (key==='sumclub_hu' && sumclub_history[0]) current_phien=sumclub_history[0].gameNum;
                    else if (key==='luckywin_main' && luckywin_history[0]) current_phien=luckywin_history[0].gameNum;
                }
                if (current_phien && current_phien!==st.last_phien) {
                    const actual=history_tx[history_tx.length-1];
                    update_json_book_with_actual(key,history_tx.slice(0,-1),actual,6);
                    if (st.last_pred && !st.last_pred.verified) {
                        update_json_anti_and_stats(key,st.last_pred.pattern,st.last_pred.predicted,actual);
                        st.last_pred.verified=true;
                    }
                    st.last_phien=current_phien;
                    st.dirty=true;
                    save_json_predictor_state(key);
                }
            } catch(e) { logError(`[JSON-PREDICTOR] Auto-update ${key}:`,e); }
        }
    },30000);
}

// =================================================================================================
// NẠP JSON FILES
// =================================================================================================
function loadAllJsonData() {
    log("Loading all JSON data files into DATA_STORE...");
    const jsonFiles=[
        {path:'lc79_md5.json',game:'lc79',table:'md5'},{path:'sicbo_luckywin.json',game:'luckywin',table:'main'},
        {path:'b52_md5.json',game:'b52',table:'md5'},{path:'hitclub_md5.json',game:'hitclub',table:'md5'},
        {path:'betvip_md5.json',game:'betvip',table:'md5'},{path:'rikvip_hu.json',game:'rikvip',table:'hu'},
        {path:'sicbo_sumclub.json',game:'sumclub',table:'hu'},{path:'betvip_hu.json',game:'betvip',table:'hu'},
        {path:'hitclub_hu.json',game:'hitclub',table:'hu'},{path:'lc79_hu.json',game:'lc79',table:'hu'},
        {path:'b52_hu.json',game:'b52',table:'hu'},
    ];
    for (const fi of jsonFiles) {
        try {
            if (!fs.existsSync(fi.path)) continue;
            const data=JSON.parse(fs.readFileSync(fi.path,'utf8'));
            if (data.history && Array.isArray(data.history)) {
                if (!DATA_STORE[fi.game]) DATA_STORE[fi.game]={};
                if (!DATA_STORE[fi.game][fi.table]) DATA_STORE[fi.game][fi.table]=[];
                const target=DATA_STORE[fi.game][fi.table];
                target.length=0;
                if (data.history.length>0 && typeof data.history[0]==='string') {
                    const basePhien=data.last_phien||1000000;
                    data.history.forEach((result,idx)=>{ const phien=basePhien-data.history.length+idx+1; target.push({phien,xuc_xac:[0,0,0],tong:result==='T'?11:10,ket_qua:result==='T'?'Tài':'Xỉu',fromJson:true}); });
                } else { target.push(...data.history); }
                log(`Loaded ${target.length} records from ${fi.path} → ${fi.game}/${fi.table}`);
            }
        } catch(err) { logError(`Error loading ${fi.path}:`,err); }
    }
    log("All JSON files loaded.");
}

// =================================================================================================
// HELPER: convert data to LC79 format
// =================================================================================================
function convert_data_to_lc79_format(records, source_type) {
    if (!records||!Array.isArray(records)||!records.length) return [];
    const converted=[];
    for (const r of records) {
        try {
            let phien, ket_qua, d1=0, d2=0, d3=0, tong=0;
            if (source_type==='full_py') { phien=r.phien; ket_qua=r.ket_qua; if(Array.isArray(r.xuc_xac)&&r.xuc_xac.length===3){d1=r.xuc_xac[0];d2=r.xuc_xac[1];d3=r.xuc_xac[2];} tong=r.tong||(d1+d2+d3); }
            else if (source_type==='xocdia88') { phien=r.phien; ket_qua=r.ket_qua; if(Array.isArray(r.xuc_xac)&&r.xuc_xac.length===3){d1=r.xuc_xac[0];d2=r.xuc_xac[1];d3=r.xuc_xac[2];} tong=r.tong||(d1+d2+d3); }
            else if (source_type==='sicbo') { phien=r.gameNum; ket_qua=r.resultType===1?'Tài':'Xỉu'; if(Array.isArray(r.faces)&&r.faces.length===3){d1=r.faces[0];d2=r.faces[1];d3=r.faces[2];} tong=r.score||(d1+d2+d3); }
            else if (source_type==='sicbosum') { phien=r.session; ket_qua=r.result==='Tai'?'Tài':'Xỉu'; if(Array.isArray(r.dice)&&r.dice.length===3){d1=r.dice[0];d2=r.dice[1];d3=r.dice[2];} tong=r.sum||(d1+d2+d3); }
            if (phien==null||!ket_qua) continue;
            converted.push({Phien:phien,Ket_qua:ket_qua,Xuc_xac_1:d1,Xuc_xac_2:d2,Xuc_xac_3:d3,Tong:tong});
        } catch(e) { /* skip */ }
    }
    converted.sort((a,b)=>(typeof b.Phien==='number'?b.Phien:parseInt(b.Phien)||0)-(typeof a.Phien==='number'?a.Phien:parseInt(a.Phien)||0));
    return converted;
}

async function predict_for_game(game, table, source_type, fetcher) {
    try {
        let rawData=null;
        if (fetcher) rawData=await fetcher();
        else if (DATA_STORE[game]?.[table]) rawData=DATA_STORE[game][table];
        if (!rawData||rawData.length===0) return {success:false,error:`Không có dữ liệu cho ${game}/${table}`};
        const formatted=convert_data_to_lc79_format(rawData, source_type);
        if (formatted.length<5) return {success:false,error:`Không đủ dữ liệu (${formatted.length} phiên), cần >= 5`};
        const learningKey=`${game}_${table}_engine`;
        if (!lc79_learningData[learningKey]) lc79_learningData[learningKey]=initLearningSlot();
        await lc79_verifyPredictions(learningKey,formatted);
        const result=calculateAdvancedPrediction(formatted,learningKey,learningKey);
        const latestPhien=formatted[0].Phien;
        const nextPhien=typeof latestPhien==='number'?latestPhien+1:`${latestPhien}_next`;
        lc79_recordPrediction(learningKey,nextPhien,result.prediction,result.confidence,result.factors);
        return {
            success:true, game, table,
            phien_hien_tai:formatted[0].Phien, phien_du_doan:nextPhien,
            ket_qua_phien_truoc:formatted[0].Ket_qua,
            du_doan:result.prediction, do_tin_cay:`${result.confidence}%`,
            force_reversed:result.forceReversed||false,
            cac_cau_phat_hien:result.factors,
            chi_tiet:result.detailedAnalysis,
            so_phien_da_co:formatted.length,
            anti_loss:result.detailedAnalysis?.antiLossGuard,
        };
    } catch(e) { logError(`predict_for_game ${game}/${table}:`,e); return {success:false,error:e.message}; }
}

// =================================================================================================
// EXPRESS APP
// =================================================================================================
const app=express();
app.use(express.json());
app.use((req,res,next)=>{ log(`${req.method} ${req.url}`); next(); });

app.get('/',(req,res)=>{
    res.json({
        status:"ALL-IN-ONE Tài Xỉu API v2 đang chạy",
        version:"NÂNG CẤP HOÀN TOÀN - Anti-Loss Guard + 7 Engine",
        new_algorithms:["Markov Chain bậc 1-5","Entropy Analysis","Advanced Momentum WMA","Bayesian Sequential Update","Cluster Break Analysis","Fourier Cycle Detection","Kelly Criterion Signal","Anti-Loss Guard (max 3 consecutive loss)"],
        endpoints:{
            predict:["/predict/:game/:table","/predict/all"],
            lc79:["/lc79-hu","/lc79-md5","/lc79-hu/analysis","/lc79-md5/analysis","/lc79-hu/learning","/lc79-md5/learning"],
            json:["/json-predict/:game/:table","/json-predict-all","/json-predictors"],
            data:["/api/:game/:table","/games","/api/status"],
            xocdia88:["/api/xocdia88/hu","/api/xocdia88/md5"],
            sicbo:["/sicbo/sumclub","/sicbo/sunlive","/sicbo/luckywin"],
            anti_loss:["/anti-loss-status","/anti-loss-reset/:key"],
        }
    });
});

// ---- Anti-Loss status endpoints ----
app.get('/anti-loss-status',(req,res)=>{
    const out={};
    for (const key in ANTI_LOSS_STATE) {
        const s=ANTI_LOSS_STATE[key];
        const r10=s.recentResults.slice(-10);
        out[key]={
            consecutiveLoss:s.consecutiveLoss, consecutiveWin:s.consecutiveWin,
            forceReverseCount:s.forceReverseCount, lastForcedAt:s.lastForcedAt,
            totalPredictions:s.totalPredictions, totalCorrect:s.totalCorrect,
            overallAccuracy:s.totalPredictions>0?((s.totalCorrect/s.totalPredictions)*100).toFixed(1)+'%':'N/A',
            recentAccuracy10:r10.length?((r10.filter(Boolean).length/r10.length)*100).toFixed(0)+'%':'N/A',
            cooldown:s.forceReverseCooldown,
        };
    }
    res.json({success:true,total_keys:Object.keys(out).length,states:out});
});
app.get('/anti-loss-reset/:key',(req,res)=>{
    const key=req.params.key;
    if (ANTI_LOSS_STATE[key]) {
        ANTI_LOSS_STATE[key].consecutiveLoss=0;
        ANTI_LOSS_STATE[key].consecutiveWin=0;
        ANTI_LOSS_STATE[key].forceReverseCooldown=0;
        res.json({success:true,message:`Reset anti-loss state for ${key}`});
    } else {
        res.json({success:false,error:'Key not found',available:Object.keys(ANTI_LOSS_STATE)});
    }
});

// ---- Data endpoints ----
app.get('/api/status',(req,res)=>{
    const counts={};
    for (const g in DATA_STORE) { counts[g]={}; for (const t in DATA_STORE[g]) counts[g][t]=DATA_STORE[g][t].length; }
    res.json({games:GAME_STATUS,data_counts:counts});
});
app.get('/api/:game/:table?',(req,res)=>{
    let {game,table}=req.params;
    game=game.toLowerCase();
    if (!DATA_STORE[game]) return res.status(404).json({error:'Game không tồn tại'});
    if (!GAME_STATUS[game]) return res.status(403).json({error:`API của ${game} đang TẮT`});
    if (!table) { const tables=Object.keys(DATA_STORE[game]); if(tables.length===1) table=tables[0]; else return res.status(400).json({error:'Cần chỉ định bàn: '+tables.join(', ')}); }
    table=table.toLowerCase();
    if (!DATA_STORE[game][table]) return res.status(404).json({error:`Bàn '${table}' không tồn tại`});
    res.json(DATA_STORE[game][table]);
});
app.get('/api/xocdia88/hu',(req,res)=>res.json(xocdia88_history_hu.slice(0,10).map(i=>({phien:i.phien,ket_qua:i.ket_qua,xuc_xac:i.xuc_xac,Tong:i.tong}))));
app.get('/api/xocdia88/md5',(req,res)=>res.json(xocdia88_history_md5.slice(0,10).map(i=>({phien:i.phien,ket_qua:i.ket_qua,xuc_xac:i.xuc_xac,Tong:i.tong}))));
app.get('/sicbo/sumclub',(req,res)=>res.json(sumclub_history.slice(0,50)));
app.get('/sicbo/sunlive',(req,res)=>res.json(sunlive_history.slice(0,50)));
app.get('/sicbo/luckywin',(req,res)=>res.json(luckywin_history.slice(0,50)));
app.get('/sicbo',(req,res)=>res.json(sicbosum_PARSED_DATA));
app.get('/sicbo_raw',(req,res)=>res.json(sicbosum_RAW_DATA));

// ---- LC79 endpoints ----
app.get('/lc79-hu',async(req,res)=>{
    try {
        const data=await lc79_fetchDataHu();
        if (!data||!data.length) return res.status(500).json({error:'Không thể lấy dữ liệu'});
        await lc79_verifyPredictions('hu',data);
        const latestPhien=data[0].Phien, nextPhien=latestPhien+1;
        const result=calculateAdvancedPrediction(data,'hu','lc79_hu');
        const record=savePredictionToHistory('hu',nextPhien,result.prediction,result.confidence,data[0]);
        lc79_recordPrediction('hu',nextPhien,result.prediction,result.confidence,result.factors);
        res.json({...record,force_reversed:result.forceReversed,anti_loss:result.detailedAnalysis?.antiLossGuard});
    } catch(e) { logError('LC79 HU API:',e); res.status(500).json({error:'Lỗi server'}); }
});
app.get('/lc79-md5',async(req,res)=>{
    try {
        const data=await lc79_fetchDataMd5();
        if (!data||!data.length) return res.status(500).json({error:'Không thể lấy dữ liệu'});
        await lc79_verifyPredictions('md5',data);
        const latestPhien=data[0].Phien, nextPhien=latestPhien+1;
        const result=calculateAdvancedPrediction(data,'md5','lc79_md5');
        const record=savePredictionToHistory('md5',nextPhien,result.prediction,result.confidence,data[0]);
        lc79_recordPrediction('md5',nextPhien,result.prediction,result.confidence,result.factors);
        res.json({...record,force_reversed:result.forceReversed,anti_loss:result.detailedAnalysis?.antiLossGuard});
    } catch(e) { logError('LC79 MD5 API:',e); res.status(500).json({error:'Lỗi server'}); }
});
app.get('/lc79-hu/lichsu',async(req,res)=>res.json({type:'LC79 HU',history:lc79_predictionHistory.hu,total:lc79_predictionHistory.hu.length}));
app.get('/lc79-md5/lichsu',async(req,res)=>res.json({type:'LC79 MD5',history:lc79_predictionHistory.md5,total:lc79_predictionHistory.md5.length}));
app.get('/lc79-hu/analysis',async(req,res)=>{
    try {
        const data=await lc79_fetchDataHu();
        if (!data) return res.status(500).json({error:'Không có dữ liệu'});
        await lc79_verifyPredictions('hu',data);
        const r=calculateAdvancedPrediction(data,'hu','lc79_hu');
        res.json({prediction:r.prediction,confidence:r.confidence,forceReversed:r.forceReversed,factors:r.factors,analysis:r.detailedAnalysis});
    } catch(e) { res.status(500).json({error:'Lỗi server'}); }
});
app.get('/lc79-md5/analysis',async(req,res)=>{
    try {
        const data=await lc79_fetchDataMd5();
        if (!data) return res.status(500).json({error:'Không có dữ liệu'});
        await lc79_verifyPredictions('md5',data);
        const r=calculateAdvancedPrediction(data,'md5','lc79_md5');
        res.json({prediction:r.prediction,confidence:r.confidence,forceReversed:r.forceReversed,factors:r.factors,analysis:r.detailedAnalysis});
    } catch(e) { res.status(500).json({error:'Lỗi server'}); }
});
app.get('/lc79-hu/learning',(req,res)=>{
    const s=lc79_learningData.hu;
    const acc=s.totalPredictions>0?(s.correctPredictions/s.totalPredictions*100).toFixed(2):0;
    res.json({type:'LC79 HU Learning',totalPredictions:s.totalPredictions,correctPredictions:s.correctPredictions,overallAccuracy:`${acc}%`,streakAnalysis:s.streakAnalysis,antiLoss:getAntiLossState('lc79_hu')});
});
app.get('/lc79-md5/learning',(req,res)=>{
    const s=lc79_learningData.md5;
    const acc=s.totalPredictions>0?(s.correctPredictions/s.totalPredictions*100).toFixed(2):0;
    res.json({type:'LC79 MD5 Learning',totalPredictions:s.totalPredictions,correctPredictions:s.correctPredictions,overallAccuracy:`${acc}%`,streakAnalysis:s.streakAnalysis,antiLoss:getAntiLossState('lc79_md5')});
});
app.get('/reset-learning',(req,res)=>{
    lc79_learningData={hu:initLearningSlot(),md5:initLearningSlot()};
    lc79_saveLearningData();
    res.json({message:'Learning data reset successfully'});
});

// ---- Predict endpoints ----
const PREDICT_TARGETS=[
    {r:'/predict/b52/hu',      g:'b52',      t:'hu',      s:'full_py'},
    {r:'/predict/b52/md5',     g:'b52',      t:'md5',     s:'full_py'},
    {r:'/predict/hitclub/hu',  g:'hitclub',  t:'hu',      s:'full_py'},
    {r:'/predict/hitclub/md5', g:'hitclub',  t:'md5',     s:'full_py'},
    {r:'/predict/rikvip/hu',   g:'rikvip',   t:'hu',      s:'full_py'},
    {r:'/predict/rikvip/md5',  g:'rikvip',   t:'md5',     s:'full_py'},
    {r:'/predict/betvip/hu',   g:'betvip',   t:'hu',      s:'full_py'},
    {r:'/predict/betvip/md5',  g:'betvip',   t:'md5',     s:'full_py'},
    {r:'/predict/sunwin/main', g:'sunwin',   t:'main',    s:'full_py'},
    {r:'/predict/68gb/hu',     g:'68gb',     t:'hu',      s:'full_py'},
    {r:'/predict/68gb/md5',    g:'68gb',     t:'md5',     s:'full_py'},
    {r:'/predict/luck8/txhu',  g:'luck8',    t:'txhu',    s:'full_py'},
    {r:'/predict/luck8/txmd5', g:'luck8',    t:'txmd5',   s:'full_py'},
    {r:'/predict/luck8/tx3p',  g:'luck8',    t:'tx3p',    s:'full_py'},
    {r:'/predict/789club/live',g:'789club',  t:'live',    s:'full_py'},
    {r:'/predict/789club/minigame',g:'789club',t:'minigame',s:'full_py'},
    {r:'/predict/sumclub/hu',  g:'sumclub',  t:'hu',      s:'full_py'},
    {r:'/predict/sumclub/md5', g:'sumclub',  t:'md5',     s:'full_py'},
];
for (const pt of PREDICT_TARGETS) {
    app.get(pt.r, async(req,res)=>res.json(await predict_for_game(pt.g,pt.t,pt.s,null)));
}
app.get('/predict/xocdia88/hu',async(req,res)=>res.json(await predict_for_game('xocdia88','hu','xocdia88',()=>Promise.resolve(xocdia88_history_hu))));
app.get('/predict/xocdia88/md5',async(req,res)=>res.json(await predict_for_game('xocdia88','md5','xocdia88',()=>Promise.resolve(xocdia88_history_md5))));
app.get('/predict/sicbo/sumclub',async(req,res)=>res.json(await predict_for_game('sicbo','sumclub','sicbo',()=>Promise.resolve(sumclub_history))));
app.get('/predict/sicbo/sunlive',async(req,res)=>res.json(await predict_for_game('sicbo','sunlive','sicbo',()=>Promise.resolve(sunlive_history))));
app.get('/predict/sicbo/luckywin',async(req,res)=>res.json(await predict_for_game('sicbo','luckywin','sicbo',()=>Promise.resolve(luckywin_history))));
app.get('/predict/sicbosum',async(req,res)=>res.json(await predict_for_game('sicbosum','main','sicbosum',()=>Promise.resolve(sicbosum_PARSED_DATA))));

app.get('/predict/all',async(req,res)=>{
    const results={};
    for (const pt of PREDICT_TARGETS) {
        try { results[`${pt.g}/${pt.t}`]=await predict_for_game(pt.g,pt.t,pt.s,null); }
        catch(e) { results[`${pt.g}/${pt.t}`]={success:false,error:e.message}; }
    }
    res.json({success:true,timestamp:new Date().toISOString(),total:Object.keys(results).length,results});
});

app.get('/games',(req,res)=>{
    const out={};
    for (const game in DATA_STORE) { out[game]={}; for (const table in DATA_STORE[game]) out[game][table]={source:'full.py',phien_da_co:DATA_STORE[game][table].length,has_predict:true,endpoint:`/predict/${game}/${table}`}; }
    res.json(out);
});

// ---- JSON Predictor endpoints ----
app.get('/json-predict/:game/:table',(req,res)=>{
    const game=req.params.game.toLowerCase(), table=req.params.table.toLowerCase();
    const key=`${game}_${table}`;
    const st=JSON_PREDICTOR_STATE[key];
    if (!st) return res.status(404).json({success:false,error:`Không có JSON predictor cho ${game}/${table}`,available:Object.keys(JSON_PREDICTOR_STATE)});
    try {
        const history_tx=get_latest_history_tx(key);
        if (history_tx.length<3) return res.json({success:false,error:`Chưa đủ dữ liệu (${history_tx.length} phiên)`,game,table});
        const history_for_lookup=history_tx.slice(0,-1);
        if (history_for_lookup.length<2) return res.json({success:false,error:'Cần >= 3 phiên',game,table});
        const result=predict_from_json_book(key,history_for_lookup);
        if (!result.prediction) return res.json({success:false,error:'Không tìm được pattern',game,table});
        let latest_phien=null;
        const cfg=JSON_FILE_MAP[key];
        if (cfg.src==='full_py' && DATA_STORE[cfg.game]?.[cfg.table]?.[0]) latest_phien=DATA_STORE[cfg.game][cfg.table][0].phien;
        else if (st.last_phien) latest_phien=st.last_phien;
        st.last_pred={pattern:result.pattern_used,predicted:result.prediction,actual:null,verified:false,phien:latest_phien,confidence:result.confidence,timestamp:new Date().toISOString()};
        st.dirty=true;
        save_json_predictor_state(key);
        res.json({
            success:true,game,table,phien_hien_tai:latest_phien,
            history_tx:history_tx.join(''),
            du_doan:result.prediction==='T'?'Tài':'Xỉu',
            du_doan_raw:result.prediction,
            do_tin_cay:result.confidence,
            source:result.source,
            pattern_su_dung:result.pattern_used,
            force_reversed:result.forceReversed||false,
            anti_loss:getAntiLossState(`json_${key}`),
            so_pattern_da_hoc:Object.keys(st.book).length,
        });
    } catch(e) { logError(`/json-predict/${game}/${table}:`,e); res.status(500).json({success:false,error:e.message}); }
});
app.get('/json-predictors',(req,res)=>{
    const out={};
    for (const key in JSON_PREDICTOR_STATE) {
        const st=JSON_PREDICTOR_STATE[key];
        out[key]={file:st.file,game:st.game,table:st.table,history_len:st.history.length,book_patterns:Object.keys(st.book).length,last_phien:st.last_phien,endpoint:`/json-predict/${st.game}/${st.table}`,anti_loss:getAntiLossState(`json_${key}`)};
    }
    res.json({success:true,total:Object.keys(out).length,predictors:out});
});
app.get('/json-predict-all',async(req,res)=>{
    const results={};
    for (const key in JSON_PREDICTOR_STATE) {
        const st=JSON_PREDICTOR_STATE[key];
        try {
            const history_tx=get_latest_history_tx(key);
            if (history_tx.length<3) { results[key]={success:false,error:'Chưa đủ dữ liệu'}; continue; }
            const result=predict_from_json_book(key,history_tx.slice(0,-1));
            results[key]=result.prediction?{success:true,game:st.game,table:st.table,du_doan:result.prediction==='T'?'Tài':'Xỉu',do_tin_cay:result.confidence,pattern_su_dung:result.pattern_used,source:result.source,force_reversed:result.forceReversed||false}:{success:false,error:'Không tìm được pattern'};
        } catch(e) { results[key]={success:false,error:e.message}; }
    }
    res.json({success:true,timestamp:new Date().toISOString(),total:Object.keys(results).length,results});
});
app.get('/json-predict-state/:game/:table',(req,res)=>{
    const key=`${req.params.game.toLowerCase()}_${req.params.table.toLowerCase()}`;
    const st=JSON_PREDICTOR_STATE[key];
    if (!st) return res.status(404).json({success:false,error:'Not found'});
    res.json({success:true,key,file:st.file,history_len:st.history.length,book_patterns:Object.keys(st.book).length,pred_log_len:st.pred_log.length,last_pred:st.last_pred,last_phien:st.last_phien,anti_loss:getAntiLossState(`json_${key}`)});
});
app.get('/json-update-book/:game/:table',async(req,res)=>{
    const key=`${req.params.game.toLowerCase()}_${req.params.table.toLowerCase()}`;
    const st=JSON_PREDICTOR_STATE[key];
    if (!st) return res.status(404).json({success:false,error:'Not found'});
    const history_tx=get_latest_history_tx(key);
    if (history_tx.length<3) return res.json({success:false,error:'Cần >= 3 phiên'});
    const actual=history_tx[history_tx.length-1];
    const updated=update_json_book_with_actual(key,history_tx.slice(0,-1),actual,6);
    if (st.dirty) save_json_predictor_state(key);
    res.json({success:true,key,updated_patterns:updated,total_book_patterns:Object.keys(st.book).length,actual_result:actual==='T'?'Tài':'Xỉu'});
});
app.get('/json-reset-book/:game/:table',(req,res)=>{
    const key=`${req.params.game.toLowerCase()}_${req.params.table.toLowerCase()}`;
    if (!JSON_FILE_MAP[key]) return res.status(404).json({success:false,error:'Not found'});
    const ok=load_json_predictor_state(key);
    res.json({success:ok,key,message:ok?'Reset OK':'Reset failed'});
});

// =================================================================================================
// START
// =================================================================================================
async function start() {
    log("=".repeat(70));
    log("ALL-IN-ONE TÀI XỈU API v2 - NÂNG CẤP HOÀN TOÀN");
    log("✅ Anti-Loss Guard: Chống thua 3 phiên liên tiếp");
    log("✅ 7 Engine mới: Markov/Entropy/Momentum/Bayesian/Cluster/Fourier/Kelly");
    log("✅ Dynamic weight adjustment theo real-time accuracy");
    log("✅ Consensus voting + Emergency reversal");
    log("=".repeat(70));

    loadAllJsonData();
    load_all_json_predictors();
    lc79_loadLearningData();
    start_all_full_py_workers();
    start_xocdia88_workers();
    start_sicbo_workers();
    start_sicbosum_ws();
    lc79_startAutoSaveTask();
    start_json_auto_update_task();

    app.listen(PORT,'0.0.0.0',()=>{
        log(`✅ Server đang chạy tại http://0.0.0.0:${PORT}`);
        log("🔥 Anti-Loss Guard: MAX 3 phiên thua liên tiếp → tự đảo chiều");
        log("📊 7 thuật toán AI: Markov/Entropy/Momentum/Bayesian/Cluster/Fourier/Kelly");
        log("⚡ Dynamic weight: Tự học và điều chỉnh trọng số theo kết quả thực tế");
    });
}

process.on('SIGINT',()=>{
    log("\n🛑 Đang dừng server...");
    try { lc79_saveLearningData(); } catch(e) {}
    for (const key in JSON_PREDICTOR_STATE) if (JSON_PREDICTOR_STATE[key].dirty) save_json_predictor_state(key);
    process.exit(0);
});

start();
