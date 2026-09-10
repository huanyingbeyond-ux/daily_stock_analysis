/* ============================================================
 * DSA Mobile - sentiment.js
 * 舆情热度 / 市场情绪温度（端侧由行情交易信号推导）
 *
 * 设计说明：免费可跨站 JSONP 的「新闻/公告/人气榜」接口多数被反爬拦截，
 * 故本模块以「行情交易信号」作为舆情代理：
 *   - 涨跌幅 / 振幅  → 情绪方向与强度
 *   - 量比 / 换手率  → 市场关注度（声量）
 *   - 涨跌停 / 涨跌家数 / 板块涨跌 → 全市场情绪温度
 * 复刻上游 economic-public-opinion 的「行业温度指数(0-100) + 五档分层 + 升降温」思路。
 * 定性舆情解读（AI 舆情解读）复用 DSA.llm 大模型能力。
 * ============================================================ */
(function (root) {
    'use strict';

    var DSA = root.DSA = root.DSA || {};
    var U = DSA.util;

    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

    // 温度分层（对齐上游 0-100 五档）
    var LAYERS = [
        { max: 20,  key: 'freeze',   label: '冰点', emoji: '🧊', tone: 'down' },
        { max: 40,  key: 'cold',     label: '偏冷', emoji: '❄️',  tone: 'down' },
        { max: 60,  key: 'neutral',  label: '中性', emoji: '⚖️',  tone: 'flat' },
        { max: 80,  key: 'hot',      label: '偏热', emoji: '🔥', tone: 'up' },
        { max: 101, key: 'overheat', label: '过热', emoji: '🌋', tone: 'down' }
    ];
    function layerOf(score) {
        for (var i = 0; i < LAYERS.length; i++) if (score < LAYERS[i].max) return LAYERS[i];
        return LAYERS[LAYERS.length - 1];
    }

    // 个股热度：由行情交易信号推导
    // 热度(温度) = 关注强度（含方向）+ 声量 + 波动；另给出多空「情绪倾向」
    function stockHeat(q) {
        if (!q || isNaN(q.changePct)) return null;
        var cp = q.changePct;
        var vr = q.volumeRatio, tr = q.turnoverRate, amp = q.amplitude;

        var emo = clamp(50 + cp * 4, 0, 100);            // 情绪强度（含方向）
        var vol = 0, vw = 0;
        if (!isNaN(vr)) { vol += clamp((vr - 1) * 28 + 35, 0, 100) * 0.6; vw += 0.6; }
        if (!isNaN(tr)) { vol += clamp(tr * 2.5 + 25, 0, 100) * 0.4; vw += 0.4; }
        if (vw > 0) vol = vol / vw;
        var ampScore = isNaN(amp) ? 30 : clamp(amp * 3 + 20, 0, 100);

        var heat = clamp(Math.round(Math.abs(cp) * 4 + vol * 0.4 + ampScore * 0.15 + 25), 0, 100);

        var sentiment;
        if (cp > 1.5) sentiment = { label: '看多', emoji: '🟢', tone: 'up' };
        else if (cp < -1.5) sentiment = { label: '看空', emoji: '🔴', tone: 'down' };
        else sentiment = { label: '中性', emoji: '⚪', tone: 'flat' };

        return {
            heat: heat,
            layer: layerOf(heat),
            sentiment: sentiment,
            emo: Math.round(emo),
            vol: Math.round(vol),
            amp: Math.round(ampScore),
            factors: {
                changePct: cp,
                volumeRatio: isNaN(vr) ? null : vr,
                turnoverRate: isNaN(tr) ? null : tr,
                amplitude: isNaN(amp) ? null : amp
            }
        };
    }

    // 全市场情绪温度
    function marketTemperature(snap) {
        var idx = (snap.indices || []).slice(0, 7);
        var avgIdx = idx.length
            ? idx.reduce(function (s, i) { return s + (isNaN(i.changePct) ? 0 : i.changePct); }, 0) / idx.length
            : 0;
        var lu = snap.limitUp, ld = snap.limitDown;
        var lr = 0;
        if (lu != null && ld != null && (lu + ld) > 0) lr = (lu - ld) / (lu + ld);
        var wl = snap.watch;
        var watchAvg = (wl && !isNaN(wl.avgPct)) ? wl.avgPct : 0;
        var score = clamp(Math.round(50 + avgIdx * 3 + lr * 18 + watchAvg * 1.5), 0, 100);
        return {
            score: score,
            layer: layerOf(score),
            avgIdx: avgIdx,
            limitUp: lu, limitDown: ld, lr: lr,
            watchAvg: watchAvg
        };
    }

    // 板块温度（领涨+领跌合并后按温度排序）
    function sectorTemps(snap) {
        var arr = [];
        ((snap.sectors && snap.sectors.leaders) || []).concat((snap.sectors && snap.sectors.laggards) || []).forEach(function (s) {
            var t = clamp(Math.round(50 + s.changePct * 4), 0, 100);
            arr.push({
                name: s.name,
                changePct: s.changePct,
                up: s.up, down: s.down,
                temp: t,
                layer: layerOf(t)
            });
        });
        arr.sort(function (a, b) { return b.temp - a.temp; });
        return arr;
    }

    // 升温/降温对比（基于历史快照，存入 localStorage）
    var SNAP_KEY = 'dsa.sentiment.sectors.v2';
    function diffSectors(cur) {
        var prev = U.LS.get(SNAP_KEY) || {};
        var out = cur.map(function (s) {
            var p = prev[s.name];
            return { name: s.name, changePct: s.changePct, temp: s.temp, delta: (p == null ? null : s.temp - p) };
        });
        var map = {};
        out.forEach(function (s) { map[s.name] = s.temp; });
        U.LS.set(SNAP_KEY, map);
        out.sort(function (a, b) {
            var da = a.delta == null ? -1e9 : a.delta;
            var db = b.delta == null ? -1e9 : b.delta;
            return db - da;
        });
        return out;
    }

    // 自选股情绪分布
    function distribution(quotes) {
        var counts = { freeze: 0, cold: 0, neutral: 0, hot: 0, overheat: 0 };
        var list = [];
        Object.keys(quotes).forEach(function (code) {
            var h = stockHeat(quotes[code]);
            if (!h) return;
            counts[h.layer.key]++;
            list.push({ code: code, name: quotes[code].name || code, quote: quotes[code], heat: h });
        });
        list.sort(function (a, b) { return b.heat.heat - a.heat.heat; });
        return { counts: counts, list: list };
    }

    // AI 个股舆情解读
    function aiInterpret(code, name, q, heat) {
        if (!DSA.store.llmReady()) return Promise.reject(new Error('尚未配置大模型'));
        var f = heat.factors;
        var ctx = [
            '股票：' + name + '（' + code + '）',
            '最新价 ' + U.num(q.price) + '，涨跌幅 ' + U.pct(q.changePct),
            '量比 ' + (f.volumeRatio == null ? '--' : U.num(f.volumeRatio)) +
                '，换手率 ' + (f.turnoverRate == null ? '--' : U.num(f.turnoverRate) + '%') +
                '，振幅 ' + (f.amplitude == null ? '--' : U.num(f.amplitude) + '%'),
            '综合热度(0-100) ' + heat.heat + '，分层「' + heat.layer.label + '」，情绪倾向「' + heat.sentiment.label + '」'
        ].join('\n');
        var sys = '你是资深市场情绪分析师。请基于给定的个股行情与热度数据，做一段简洁的舆情解读（不超过300字）：' +
            '1) 当前市场关注度与情绪温度；2) 多空资金态度；3) 值得关注的舆情信号或风险。' +
            '使用 Markdown，不要给出具体买卖建议，不编造数据。';
        return DSA.llm.chat([
            { role: 'system', content: sys },
            { role: 'user', content: ctx + '\n\n请给出舆情解读。' }
        ], { maxTokens: 900, temperature: 0.5 });
    }

    DSA.sentiment = {
        LAYERS: LAYERS,
        layerOf: layerOf,
        stockHeat: stockHeat,
        marketTemperature: marketTemperature,
        sectorTemps: sectorTemps,
        diffSectors: diffSectors,
        distribution: distribution,
        aiInterpret: aiInterpret
    };
})(window);
