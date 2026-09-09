/* ============================================================
 * DSA Mobile - market.js
 * 大盘复盘：主要指数 / 涨跌停家数 / 板块强弱 / 自选概览 + AI 复盘点评
 * ============================================================ */
(function (root) {
    'use strict';

    var DSA = root.DSA = root.DSA || {};
    var U = DSA.util;
    var Q = DSA.quote;

    /** 汇总大盘快照 */
    function snapshot(opts) {
        opts = opts || {};
        var watchlist = DSA.store.watchlist.map(function (s) { return s.code; });
        var codes = watchlist.slice(0, 30);
        var quotePromise = codes.length
            ? Q.realtime(codes).catch(function () { return []; })
            : Promise.resolve([]);

        return Promise.all([
            Q.indices().catch(function () { return []; }),
            Q.sectors(8).catch(function () { return { leaders: [], laggards: [] }; }),
            Q.limitUpCount().catch(function () { return null; }),
            Q.limitDownCount().catch(function () { return null; }),
            quotePromise
        ]).then(function (r) {
            var quotes = (r[4] || []).filter(Boolean);
            var upCount = 0, downCount = 0, flatCount = 0, bigUp = 0, bigDown = 0;
            quotes.forEach(function (q) {
                var p = q.changePct;
                if (isNaN(p)) return;
                if (p > 0) upCount++;
                else if (p < 0) downCount++;
                else flatCount++;
                if (p >= 5) bigUp++;
                if (p <= -5) bigDown++;
            });
            return {
                ts: Date.now(),
                indices: r[0] || [],
                sectors: r[1] || { leaders: [], laggards: [] },
                limitUp: r[2],
                limitDown: r[3],
                watch: {
                    quotes: quotes,
                    upCount: upCount,
                    downCount: downCount,
                    flatCount: flatCount,
                    bigUp: bigUp,
                    bigDown: bigDown,
                    avgPct: quotes.length
                        ? quotes.reduce(function (s, q) { return s + (isNaN(q.changePct) ? 0 : q.changePct); }, 0) / quotes.length
                        : NaN
                }
            };
        });
    }

    function buildReviewPrompt(data) {
        var L = [];
        L.push('## 主要指数');
        data.indices.forEach(function (i) {
            L.push('- ' + i.name + '：' + U.num(i.price) + '（' + U.pct(i.changePct) + '）　最高 ' + U.num(i.high) + '　最低 ' + U.num(i.low));
        });
        L.push('');
        L.push('## 市场温度');
        if (data.limitUp != null) L.push('- 涨停家数：' + data.limitUp);
        if (data.limitDown != null) L.push('- 跌停家数：' + data.limitDown);
        var wl = data.watch;
        if (wl && wl.quotes.length) {
            L.push('- 自选股：' + wl.quotes.length + ' 只，上涨 ' + wl.upCount + '，下跌 ' + wl.downCount +
                '，平均涨跌 ' + U.pct(wl.avgPct) + '，涨超5% ' + wl.bigUp + ' 只，跌超5% ' + wl.bigDown + ' 只');
            wl.quotes.slice(0, 10).forEach(function (q) {
                L.push('  · ' + q.name + '(' + q.code + ') ' + U.num(q.price) + ' ' + U.pct(q.changePct));
            });
        }
        L.push('');
        L.push('## 领涨板块');
        var ld = data.sectors.leaders || [];
        ld.slice(0, 8).forEach(function (s) { L.push('- ' + s.name + ' ' + U.pct(s.changePct)); });
        L.push('');
        L.push('## 领跌板块');
        var lg = data.sectors.laggards || [];
        lg.slice(0, 8).forEach(function (s) { L.push('- ' + s.name + ' ' + U.pct(s.changePct)); });
        return L.join('\n');
    }

    var REVIEW_SYSTEM = [
        '你是券商首席策略分析师，正在做交易日复盘。',
        '请基于给定数据输出一段条理清楚的大盘复盘，控制在 500 字以内，中文输出。',
        '结构固定为四个部分：1) 指数表现；2) 情绪与赚钱效应；3) 主线与风险；4) 明日策略建议。',
        '不要编造数据以外的具体个股推荐，给出仓位与节奏上的建议即可。',
        '使用 Markdown，二级标题用 ##，条目用 - 开头。'
    ].join('\n');

    /** AI 复盘点评 */
    function review(data) {
        if (!DSA.store.llmReady()) throw new Error('尚未配置大模型，无法生成 AI 复盘');
        return DSA.llm.chat([
            { role: 'system', content: REVIEW_SYSTEM },
            { role: 'user', content: buildReviewPrompt(data) + '\n\n请输出复盘正文。' }
        ], { maxTokens: 1600, temperature: 0.4 });
    }

    function toMarkdown(data, text) {
        var L = [];
        L.push('## 🎯 ' + U.dateText(data.ts) + ' 大盘复盘');
        L.push('');
        L.push('### 📊 主要指数');
        data.indices.forEach(function (i) {
            var dir = U.dir(i.changePct);
            L.push('- **' + i.name + '**：' + U.num(i.price) + '（' + (dir > 0 ? '🟢' : dir < 0 ? '🔴' : '⚪') + U.pct(i.changePct) + '）');
        });
        L.push('');
        L.push('### 🌡 市场温度');
        var wl = data.watch;
        if (data.limitUp != null || data.limitDown != null) {
            L.push('- 涨停 ' + (data.limitUp == null ? '--' : data.limitUp) + ' 家｜跌停 ' + (data.limitDown == null ? '--' : data.limitDown) + ' 家');
        }
        if (wl && wl.quotes.length) {
            L.push('- 自选：上涨 ' + wl.upCount + '｜下跌 ' + wl.downCount + '｜平均 ' + U.pct(wl.avgPct));
        }
        L.push('');
        if ((data.sectors.leaders || []).length) {
            L.push('### 🔥 领涨板块');
            data.sectors.leaders.slice(0, 8).forEach(function (s) { L.push('- ' + s.name + ' ' + U.pct(s.changePct)); });
            L.push('');
        }
        if ((data.sectors.laggards || []).length) {
            L.push('### 🧊 领跌板块');
            data.sectors.laggards.slice(0, 8).forEach(function (s) { L.push('- ' + s.name + ' ' + U.pct(s.changePct)); });
            L.push('');
        }
        if (text) { L.push('### 🧠 复盘点评'); L.push(text); L.push(''); }
        L.push('---');
        L.push('*生成时间：' + U.timeText(data.ts) + '*');
        return L.join('\n');
    }

    DSA.market = { snapshot: snapshot, review: review, toMarkdown: toMarkdown };
})(window);
