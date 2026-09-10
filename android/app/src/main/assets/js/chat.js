/* ============================================================
 * DSA Mobile - chat.js
 * Agent 策略问股：多轮对话 + 自动抓取实时行情/技术面/联网检索作为上下文
 * 设计：沿用 analyzer 的"先抓取数据、再喂给模型"模式，不依赖函数调用，
 *       兼容所有 OpenAI 兼容 / Gemini / Anthropic 模型。
 * ============================================================ */
(function (root) {
    'use strict';

    var DSA = root.DSA = root.DSA || {};
    var U = DSA.util;

    // 上游 15 种内置策略（摘取常用且模型可理解的视角）
    var STRATEGIES = [
        '均线金叉', '均线多头排列', '缠论', '波浪理论', '多头趋势',
        '热点题材', '事件驱动', '成长质量', '预期重估', '量价关系',
        '布林带', '资金流向', '基本面价值', '缺口理论', 'MACD背离'
    ];

    var SYSTEM_PROMPT = [
        '你是「股票智能分析」App 的问股助手，一名资深股票分析师。',
        '规则：',
        '1. 用简体中文、口语化、结构化回答用户的股票与策略问题，支持多轮追问。',
        '2. 用户若提到具体股票，消息里会附带其实时行情与技术面数据，请基于这些数据给出有依据的判断；数据缺失时如实说明，严禁编造数字。',
        '3. 涉及买点/卖点/仓位，必须加一句"仅供研究参考，不构成投资建议"，并提示主要风险。',
        '4. 用户可指定分析策略（如缠论、波浪、均线金叉、量价、资金流向等），请按其所说策略的视角展开。',
        '5. 尽量给出可执行的观察点：关键价位、信号、催化剂、风险。避免空话套话。',
        '6. 控制在 400 字以内，需要时用要点列表；可用 ``` 代码块给出关键数值。'
    ].join('\n');

    function marketLabel(m) {
        return m === 'hk' ? '港股' : m === 'us' ? '美股' : m === 'bj' ? '北交所' : 'A股';
    }

    /** 识别问题中提及的股票：6位数字 / hk+5位 / 自选股名称 / 指代复用 */
    function detectCodes(text, opts) {
        opts = opts || {};
        var found = [], seen = {};
        text = String(text || '');
        function push(meta) {
            if (!meta || !meta.tencent || seen[meta.tencent]) return;
            seen[meta.tencent] = 1; found.push(meta);
        }
        var m;
        var re6 = /\d{6}/g;
        while ((m = re6.exec(text))) push(DSA.quote.normalize(m[0]));
        var rehk = /hk\d{5}/gi;
        while ((m = rehk.exec(text))) push(DSA.quote.normalize(m[0]));
        // 自选股名称（含子串匹配，如"佰维""茅台"）
        DSA.store.watchlist.forEach(function (s) {
            if (s.name && text.indexOf(s.name) >= 0) push(DSA.quote.normalize(s.code));
        });
        // 指代复用：这只 / 该股票 / 它 / 上面那只
        if (opts.reuseCode && !seen[opts.reuseCode] && /这只|该股票|这支|上面那只|它\b|刚才那只/.test(text)) {
            push(DSA.quote.normalize(opts.reuseCode));
        }
        return found.slice(0, 3);
    }

    /** 抓取上下文：实时行情 + 日K技术面 + 可选联网检索 */
    function gatherContext(metas) {
        var st = DSA.store.get();
        var codes = metas.map(function (x) { return x.tencent; });
        var rtPromise = DSA.quote.realtime(codes).catch(function () {
            return metas.map(function () { return null; });
        });
        var klPromises = metas.map(function (x) {
            return DSA.quote.kline(x.tencent, 'day', 60).catch(function () { return []; });
        });
        var searchPromise = (st.searchEnabled && st.searchKey)
            ? DSA.llm.webSearch(metas.map(function (x) { return x.code; }).join(' ') + ' 股票 最新', 5).catch(function () { return null; })
            : Promise.resolve(null);

        return Promise.all([rtPromise].concat(klPromises).concat([searchPromise])).then(function (res) {
            var rts = res[0];
            var kls = res.slice(1, 1 + metas.length);
            var sr = res[res.length - 1];
            var parts = [];
            metas.forEach(function (x, i) {
                var q = rts && rts[i];
                var kl = kls[i] || [];
                var ts = DSA.quote.technicalSummary(kl);
                var b = '股票 ' + x.tencent + ' ' + (q && q.name ? q.name : x.code) + ' (' + marketLabel(x.market) + '):\n';
                if (q && !isNaN(q.price)) {
                    b += '实时: 现价 ' + U.num(q.price) + ' 涨跌 ' + U.pct(q.changePct) +
                        ' 今开 ' + U.num(q.open) + ' 最高 ' + U.num(q.high) + ' 最低 ' + U.num(q.low) +
                        ' 换手 ' + (isNaN(q.turnoverRate) ? '-' : q.turnoverRate.toFixed(2) + '%') +
                        ' 量比 ' + (isNaN(q.volumeRatio) ? '-' : q.volumeRatio.toFixed(2)) +
                        ' 总市值 ' + (isNaN(q.totalCap) ? '-' : U.num(q.totalCap) + '亿') +
                        ' PE ' + (isNaN(q.pe) ? '-' : q.pe.toFixed(1)) + '\n';
                } else {
                    b += '实时: (获取失败)\n';
                }
                if (ts) {
                    b += '技术面(日K, 截至 ' + ts.last + '):\n' +
                        'MA5 ' + U.num(ts.ma5) + ' MA10 ' + U.num(ts.ma10) + ' MA20 ' + U.num(ts.ma20) + ' MA60 ' + U.num(ts.ma60) + '\n' +
                        'BIAS5 ' + ts.bias5.toFixed(2) + '%  量比(近5日均) ' + ts.volumeRatioPrev5.toFixed(2) + '\n' +
                        'MACD DIF ' + ts.macdDif.toFixed(2) + ' DEA ' + ts.macdDea.toFixed(2) + ' BAR ' + ts.macdBar.toFixed(2) + '\n' +
                        'KDJ K ' + ts.kdjK.toFixed(1) + ' D ' + ts.kdjD.toFixed(1) + ' J ' + ts.kdjJ.toFixed(1) + '\n' +
                        '20日高 ' + U.num(ts.high20) + '  20日低 ' + U.num(ts.low20) + '\n' +
                        '近10日(OHLCV): ' + ts.recent10.join(' | ') + '\n';
                } else {
                    b += '技术面: (K线数据不足，无法计算)\n';
                }
                parts.push(b);
            });
            if (sr && sr.length) {
                parts.push('联网检索摘录:\n' + sr.map(function (r) {
                    return '- ' + (r.title || '') + '：' + (r.snippet || '');
                }).join('\n'));
            }
            return parts.join('\n\n');
        });
    }

    /**
     * 发起一轮问股
     * @param {string} userText 用户本轮输入
     * @param {Array<{role,content}>} history 此前完整对话（不含本轮）
     * @param {object} opts { reuseCode }
     * @returns Promise<{ answer:string, codes:Array }>
     */
    function ask(userText, history, opts) {
        opts = opts || {};
        var codes = detectCodes(userText, opts);
        return gatherContext(codes).then(function (ctxText) {
            var messages = [{ role: 'system', content: SYSTEM_PROMPT }];
            (history || []).forEach(function (m) {
                if (m && (m.role === 'user' || m.role === 'assistant')) messages.push({ role: m.role, content: m.content });
            });
            var userContent = userText;
            if (ctxText) userContent += '\n\n[以下为实时数据，请基于这些数据回答，不要臆造]\n' + ctxText;
            messages.push({ role: 'user', content: userContent });
            return DSA.llm.chat(messages, { temperature: 0.4, maxTokens: 2200, timeoutMs: 180000 })
                .then(function (ans) { return { answer: ans, codes: codes }; });
        });
    }

    DSA.chat = {
        STRATEGIES: STRATEGIES,
        SYSTEM_PROMPT: SYSTEM_PROMPT,
        detectCodes: detectCodes,
        gatherContext: gatherContext,
        ask: ask
    };
})(window);
