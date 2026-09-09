/* ============================================================
 * DSA Mobile - analyzer.js
 * 决策引擎：行情采集 -> 技术分析 -> LLM 决策报告
 * 输出结构严格对齐上游 daily_stock_analysis 的 AnalysisReportSchema
 * ============================================================ */
(function (root) {
    'use strict';

    var DSA = root.DSA = root.DSA || {};
    var U = DSA.util;

    var SYSTEM_PROMPT = [
        '你是一名资深A股/港美股交易员，擅长把「行情数据 + 技术形态 + 公开信息」压缩成一份可执行的交易决策。',
        '你必须只输出一个 JSON 对象，不要输出任何解释性文字、不要使用 Markdown 代码块围栏。',
        '所有金额、价格单位与输入保持一致；无法获取的字段填 null 或空数组，禁止编造具体数值。',
        '评分参考：0-20 极度看空，20-40 偏空，40-60 震荡观望，60-80 偏多，80-100 强烈看多。',
        '结论必须和自己的评分、技术面证据保持一致，禁止出现「高分看空」这类自相矛盾的输出。'
    ].join('\n');

    function buildUserPrompt(ctx) {
        var q = ctx.quote || {};
        var t = ctx.tech || {};
        var lines = [];
        lines.push('## 标的');
        lines.push('名称：' + q.name + '　代码：' + q.code + '　市场：' + marketLabel(q.market));
        lines.push('当前价：' + n(q.price) + '　涨跌：' + n(q.change) + '（' + n(q.changePct) + '%）');
        lines.push('今开：' + n(q.open) + '　最高：' + n(q.high) + '　最低：' + n(q.low) + '　昨收：' + n(q.prevClose));
        lines.push('成交量：' + n(q.volume, 0) + '　成交额：' + n(q.amount, 0));
        if (!isNaN(q.turnoverRate)) lines.push('换手率：' + n(q.turnoverRate) + '%　量比：' + n(q.volumeRatio) + '　振幅：' + n(q.amplitude) + '%');
        if (!isNaN(q.totalCap)) lines.push('总市值(亿)：' + n(q.totalCap) + '　流通市值(亿)：' + n(q.floatCap) + '　PE：' + n(q.pe) + '　PB：' + n(q.pb));
        if (!isNaN(q.avgPrice)) lines.push('均价：' + n(q.avgPrice));
        lines.push('行情时间：' + (q.timeText || '--'));

        lines.push('');
        lines.push('## 技术面');
        if (t.last) {
            lines.push('最近交易日：' + t.last + '　收盘：' + n(t.close));
            lines.push('MA5：' + n(t.ma5) + '　MA10：' + n(t.ma10) + '　MA20：' + n(t.ma20) + '　MA60：' + n(t.ma60));
            lines.push('MA5乖离率：' + n(t.bias5) + '%　近5日均量比：' + n(t.volumeRatioPrev5));
            lines.push('20日最高：' + n(t.high20) + '　20日最低：' + n(t.low20));
            lines.push('MACD：DIF ' + n(t.macdDif) + '　DEA ' + n(t.macdDea) + '　柱 ' + n(t.macdBar));
            lines.push('KDJ：K ' + n(t.kdjK) + '　D ' + n(t.kdjD) + '　J ' + n(t.kdjJ));
            lines.push('最近10日K线（日期 开/高/低/收/量）：');
            (t.recent10 || []).forEach(function (r) { lines.push('  ' + r); });
        } else {
            lines.push('（K线数据不足，仅依据实时行情判断，请降低结论置信度并在 data_limitations 中说明）');
        }

        if (ctx.news && ctx.news.length) {
            lines.push('');
            lines.push('## 公开信息');
            ctx.news.forEach(function (n2, i) {
                lines.push((i + 1) + '. ' + n2.title + '｜' + (n2.snippet || '').replace(/\s+/g, ' ').slice(0, 220));
            });
        } else {
            lines.push('');
            lines.push('## 公开信息');
            lines.push('（未启用联网搜索，请基于技术面与常识给出判断，明确标注缺少消息面验证）');
        }

        lines.push('');
        lines.push('## 输出要求');
        lines.push('按以下 JSON 结构输出：');
        lines.push(JSON.stringify({
            stock_name: q.name || '',
            sentiment_score: 50,
            trend_prediction: '震荡',
            operation_advice: '观望',
            decision_type: 'hold',
            confidence_level: '中',
            dashboard: {
                core_conclusion: {
                    one_sentence: '一句话核心结论',
                    signal_type: '技术面驱动',
                    time_sensitivity: '短线1-3日',
                    position_advice: { no_position: '空仓者建议', has_position: '持仓者建议' }
                },
                data_perspective: {
                    trend_status: { ma_alignment: '多头排列/空头排列/交织', is_bullish: true, trend_score: 60 },
                    price_position: { current_price: 0, ma5: 0, ma10: 0, ma20: 0, bias_ma5: 0, bias_status: '偏高', support_level: 0, resistance_level: 0 },
                    volume_analysis: { volume_ratio: 0, volume_status: '温和放量', turnover_rate: 0, volume_meaning: '量能含义一句话' },
                    chip_structure: { profit_ratio: null, avg_cost: null, concentration: null, chip_health: '结构描述' }
                },
                intelligence: {
                    latest_news: '最新动态一句话',
                    risk_alerts: ['风险1', '风险2'],
                    positive_catalysts: ['利好1'],
                    earnings_outlook: '业绩预期一句话',
                    sentiment_summary: '舆情情绪一句话'
                },
                battle_plan: {
                    sniper_points: { ideal_buy: 0, secondary_buy: 0, stop_loss: 0, take_profit: 0 },
                    position_strategy: { suggested_position: '建议仓位', entry_plan: '进场计划', risk_control: '风控规则' },
                    action_checklist: ['触发条件1', '触发条件2']
                },
                phase_decision: {
                    action_window: '今日尾盘/明日开盘',
                    immediate_action: '立即动作',
                    watch_conditions: ['观察条件'],
                    next_check_time: '复核时间',
                    confidence_reason: '置信度理由',
                    data_limitations: ['数据局限']
                },
                signal_attribution: { technical_indicators: 40, news_sentiment: 20, fundamentals: 20, market_conditions: 20 }
            },
            analysis_summary: '3-5句综合结论',
            risk_warning: '风险提示',
            trend_analysis: '趋势研判',
            technical_analysis: '技术面解读',
            fundamental_analysis: '基本面视角（缺失数据就说明无法评估）',
            search_performed: ctx.news ? true : false
        }, null, 2));
        lines.push('');
        lines.push('约束：decision_type 只能是 buy / hold / sell 之一；所有数值必须是数字，禁止字符串数字或"N/A"。');
        return lines.join('\n');
    }

    function n(v, digits) {
        if (v == null || (typeof v === 'number' && isNaN(v))) return 'N/A';
        if (typeof v === 'number') return v.toFixed(digits == null ? 2 : digits);
        return String(v);
    }

    function marketLabel(m) {
        return { cn: 'A股', sh: 'A股(沪)', sz: 'A股(深)', bj: '北交所', hk: '港股', us: '美股' }[m] || m || '--';
    }

    // ---------------------------------------------------------
    // 采集数据
    // ---------------------------------------------------------
    function gather(input, opts) {
        opts = opts || {};
        var meta = DSA.quote.normalize(input);
        return Promise.all([
            DSA.quote.realtime([meta.tencent]).then(function (r) { return r[0]; }),
            DSA.quote.kline(meta.tencent, opts.period || 'day', 120).catch(function () { return []; })
        ]).then(function (pair) {
            var quote = pair[0] || { name: meta.code, code: meta.code, market: meta.market };
            quote.norm = quote.norm || meta;
            return {
                meta: meta,
                quote: quote,
                klines: pair[1],
                tech: pair[1] && pair[1].length >= 20 ? DSA.quote.technicalSummary(pair[1]) : null
            };
        });
    }

    // ---------------------------------------------------------
    // 分析
    // ---------------------------------------------------------
    function analyze(input, opts) {
        opts = opts || {};
        return gather(input, opts).then(function (ctx) {
            var newsPromise = opts.withNews === false ? Promise.resolve(null) : null;
            if (!newsPromise) {
                newsPromise = DSA.llm.webSearch((ctx.quote.name || ctx.meta.code) + ' 股票 最新消息 公告 业绩', 6);
            }
            return newsPromise.then(function (news) {
                ctx.news = news;
                var messages = [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: buildUserPrompt(ctx) }
                ];
                var st = DSA.store.get();
                var brief = st.reportType === 'brief';
                var callOpts = {
                    maxTokens: brief ? 2048 : 4096,
                    temperature: DSA.store.get().llm.temperature || 0.3,
                    jsonMode: true
                };
                return DSA.llm.chat(messages, callOpts)
                    .catch(function (err) {
                        // 部分兼容端点不支持 response_format，降级重试
                        if (/response_format|400|Unsupported|format/i.test(err.message)) {
                            return DSA.llm.chat(messages, Object.assign({}, callOpts, { jsonMode: false }));
                        }
                        throw err;
                    })
                    .then(function (text) {
                        var report = parseReport(text);
                        report._raw = text;
                        report._ctx = {
                            code: ctx.meta.tencent,
                            name: report.stock_name || ctx.quote.name,
                            market: ctx.meta.market,
                            quote: snapshot(ctx.quote),
                            tech: ctx.tech,
                            news: news || [],
                            ts: Date.now()
                        };
                        report.signal = resolveSignal(report);
                        return report;
                    });
            });
        });
    }

    function snapshot(q) {
        return {
            name: q.name, code: q.code, price: q.price, prevClose: q.prevClose, open: q.open,
            high: q.high, low: q.low, change: q.change, changePct: q.changePct,
            volume: q.volume, amount: q.amount, turnoverRate: q.turnoverRate,
            volumeRatio: q.volumeRatio, amplitude: q.amplitude, pe: q.pe, pb: q.pb,
            totalCap: q.totalCap, floatCap: q.floatCap, timeText: q.timeText, market: q.market
        };
    }

    /** 从 LLM 文本中稳健地提取 JSON */
    function parseReport(text) {
        if (!text) throw new Error('大模型返回为空');
        var cleaned = String(text).trim();
        cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
        var start = cleaned.indexOf('{');
        var end = cleaned.lastIndexOf('}');
        if (start < 0 || end < 0) throw new Error('大模型未返回 JSON：' + cleaned.slice(0, 160));
        var body = cleaned.slice(start, end + 1);
        try {
            return JSON.parse(body);
        } catch (e) {
            // 常见修复：尾部多余逗号
            try {
                return JSON.parse(body.replace(/,\s*([}\]])/g, '$1'));
            } catch (e2) {
                throw new Error('JSON 解析失败：' + e2.message + '｜片段：' + body.slice(0, 120));
            }
        }
    }

    function resolveSignal(report) {
        var score = report.sentiment_score;
        if (typeof score === 'string') score = parseFloat(score);
        var dt = String(report.decision_type || '').toLowerCase();
        var type, label, emoji;
        if (dt === 'buy' || dt === 'sell') {
            type = dt;
        } else if (!isNaN(score)) {
            type = score >= 70 ? 'buy' : (score <= 40 ? 'sell' : 'hold');
        } else {
            type = 'hold';
        }
        if (type === 'buy') { label = '买入'; emoji = '🟢'; }
        else if (type === 'sell') { label = '卖出'; emoji = '🔴'; }
        else { label = '观望'; emoji = '🟡'; }
        return { type: type, label: label, emoji: emoji, score: isNaN(score) ? null : score };
    }

    // ---------------------------------------------------------
    // 导出：推送式 Markdown（对齐上游决策仪表盘排版）
    // ---------------------------------------------------------
    function toMarkdown(report) {
        var r = report || {};
        var db = r.dashboard || {};
        var core = db.core_conclusion || {};
        var dp = db.data_perspective || {};
        var it = db.intelligence || {};
        var bp = db.battle_plan || {};
        var sn = (bp.sniper_points || {});
        var pd = db.phase_decision || {};
        var c = r._ctx || {};
        var sig = r.signal || resolveSignal(r);
        var L = [];

        L.push('## 🎯 ' + (c.name || r.stock_name || '') + '(' + (c.code || '') + ') 决策简报');
        L.push('> ' + sig.emoji + ' ' + sig.label + '｜评分 ' + (sig.score == null ? '--' : sig.score) +
            '｜' + (r.trend_prediction || '--') + '｜' + (r.confidence_level || '') + '置信');
        var q = c.quote || {};
        if (q.price != null) {
            L.push('> 现价 ' + n(q.price) + '（' + U.pct(q.changePct) + '）　' + (q.timeText || ''));
        }
        L.push('');
        if (core.one_sentence) L.push('📌 **' + core.one_sentence + '**');
        L.push('');
        if (it.sentiment_summary) L.push('💭 舆情：' + it.sentiment_summary);
        if (it.earnings_outlook) L.push('📊 业绩：' + it.earnings_outlook);
        if (it.latest_news) L.push('📢 动态：' + it.latest_news);
        if (it.sentiment_summary || it.earnings_outlook || it.latest_news) L.push('');

        if ((it.risk_alerts || []).length) {
            L.push('🚨 **风险警报**');
            it.risk_alerts.slice(0, 4).forEach(function (x) { L.push('   • ' + x); });
            L.push('');
        }
        if ((it.positive_catalysts || []).length) {
            L.push('✨ **利好催化**');
            it.positive_catalysts.slice(0, 4).forEach(function (x) { L.push('   • ' + x); });
            L.push('');
        }

        var parts = [];
        if (sn.ideal_buy != null) parts.push('🎯理想买点 ' + sn.ideal_buy);
        if (sn.secondary_buy != null) parts.push('次选买点 ' + sn.secondary_buy);
        if (sn.stop_loss != null) parts.push('🛑止损 ' + sn.stop_loss);
        if (sn.take_profit != null) parts.push('🎊目标位 ' + sn.take_profit);
        if (parts.length) { L.push(parts.join(' | ')); L.push(''); }

        if (core.position_advice) {
            if (core.position_advice.no_position) L.push('🆕 空仓：' + core.position_advice.no_position);
            if (core.position_advice.has_position) L.push('💼 持仓：' + core.position_advice.has_position);
            L.push('');
        }
        if (pd.immediate_action) L.push('⏱ 即时动作：' + pd.immediate_action);
        if ((pd.watch_conditions || []).length) {
            L.push('👀 观察：' + pd.watch_conditions.slice(0, 3).join('；'));
        }
        if (pd.next_check_time) L.push('🔁 复核：' + pd.next_check_time);
        if (pd.immediate_action || (pd.watch_conditions || []).length) L.push('');

        if ((bp.action_checklist || []).length) {
            L.push('**✅ 操作检查清单**');
            bp.action_checklist.slice(0, 5).forEach(function (x) { L.push('   • ' + x); });
            L.push('');
        }
        if (r.risk_warning) L.push('⚠️ ' + r.risk_warning);
        L.push('');
        L.push('---');
        L.push('*生成时间：' + U.dateText(c.ts || Date.now()) + ' ' + U.timeText(c.ts || Date.now()) + '*');
        return L.join('\n');
    }

    DSA.analyzer = {
        analyze: analyze,
        gather: gather,
        parseReport: parseReport,
        resolveSignal: resolveSignal,
        toMarkdown: toMarkdown,
        SYSTEM_PROMPT: SYSTEM_PROMPT
    };
})(window);
