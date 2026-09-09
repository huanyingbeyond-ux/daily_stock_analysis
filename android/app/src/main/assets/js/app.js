/* ============================================================
 * DSA Mobile - app.js
 * 路由、页面渲染、交互主逻辑
 * ============================================================ */
(function (root) {
    'use strict';

    var DSA = root.DSA = root.DSA || {};
    var U = DSA.util;
    var $ = U.$, $$ = U.$$;
    var el = U.el;

    var state = {
        tab: 'watch',
        title: '自选股',
        quotes: {},            // code -> quote
        reports: {},           // code -> report（内存缓存，与 localStorage 同步）
        refreshing: false,
        marketData: null,
        timer: null,
        detail: null,          // {code, sheet, chartCtrl, period, minuteCtrl, data}
        lastDetailRendered: 0,
        sheetStack: []         // 打开的浮层栈（Android 返回键用）
    };

    // ==========================================================
    // 通用组件
    // ==========================================================
    function priceClass(v) {
        var d = U.dir(v);
        return d > 0 ? 'up' : d < 0 ? 'down' : 'flat';
    }

    function pctChip(v) {
        var cls = priceClass(v);
        return el('span.pct-chip.' + cls, { text: U.pct(v) });
    }

    function signalBadge(signal) {
        if (!signal) return null;
        return el('span.signal-badge.' + signal.type, { text: signal.emoji + ' ' + signal.label });
    }

    function skeleton(n) {
        return Array.apply(null, Array(n || 5)).map(function () { return el('div.skel-row'); });
    }

    function setTitle(title, sub) {
        $('#page-title').textContent = title;
        $('#page-sub').textContent = sub || '';
    }

    function setActions(nodes) {
        var box = $('#topbar-actions');
        U.clear(box);
        (nodes || []).forEach(function (n) { if (n) box.appendChild(n); });
    }

    function openSheet(buildBody, opts) {
        opts = opts || {};
        var rootNode = el('div.sheet-mask');
        var sheet = el('div.sheet');
        var header = el('div.sheet-header');
        var back = el('button.icon-btn', { onclick: close, text: '←' });
        header.appendChild(back);
        header.appendChild(el('div.sheet-title', {}, [
            el('div.st-name', { text: opts.title || '' }),
            el('div.st-sub', { text: opts.sub || '' })
        ]));
        if (opts.actions) opts.actions.forEach(function (a) { header.appendChild(a); });
        var body = el('div.sheet-body');
        sheet.appendChild(header);
        sheet.appendChild(body);
        document.getElementById('sheet-root').appendChild(sheet);
        document.getElementById('sheet-root').appendChild(rootNode);
        rootNode.addEventListener('click', function () { });
        rootNode.style.pointerEvents = 'none';
        document.body.style.overflow = 'hidden';

        function close() {
            var i = state.sheetStack.indexOf(close);
            if (i >= 0) state.sheetStack.splice(i, 1);
            document.getElementById('sheet-root').removeChild(sheet);
            document.getElementById('sheet-root').removeChild(rootNode);
            document.body.style.overflow = '';
            if (opts.onClose) opts.onClose();
        }
        state.sheetStack.push(close);
        buildBody(body, {
            setSub: function (t) { $('.st-sub', header).textContent = t; },
            setName: function (t) { $('.st-name', header).textContent = t; },
            close: close,
            sheet: sheet
        });
        return { close: close, body: body };
    }

    // ==========================================================
    // 自选股页面
    // ==========================================================
    function renderWatch() {
        state.tab = 'watch';
        setTitle('自选股', '红涨绿跌 · ' + DSA.store.watchlist.length + ' 只');
        setActions([
            el('button.icon-btn', {
                text: '＋',
                onclick: function () { openAddSheet(); }
            }),
            el('button.icon-btn', {
                text: '⟳',
                onclick: function () { refreshWatch(true); }
            })
        ]);

        var view = U.clear($('#view'));
        var list = DSA.store.watchlist;

        if (!list.length) {
            view.appendChild(el('div.empty', {}, [
                el('span.empty-icon', { text: '📭' }),
                '还没有自选股，点右上角 ＋ 添加'
            ]));
            renderWatchIntro(view);
            return;
        }

        var box = el('div.stock-list');
        view.appendChild(box);
        view.appendChild(el('div.refresh-tip', { id: 'refresh-tip' }));

        renderWatchRows(box);
        if (!Object.keys(state.quotes).length) refreshWatch(true);
        startAutoRefresh();
    }

    function renderWatchIntro(view) {
        view.appendChild(el('div.card', {}, [el('div.card-body', {}, [
            el('div.card-title', { text: '快速上手' }),
            el('div.md-p', { text: '1. 右上角 ＋ 搜索并添加股票' }),
            el('div.md-p', { text: '2. 进入「设置」填写大模型 API Key（推荐 DeepSeek，几块钱能用很久）' }),
            el('div.md-p', { text: '3. 点开任意股票，切到日K，点「生成决策报告」' })
        ])]));
    }

    function renderWatchRows(box) {
        U.clear(box);
        var list = DSA.store.watchlist;
        if (!list.length) {
            box.appendChild(el('div.empty', {}, [el('span.empty-icon', { text: '📭' }), '暂无自选股']));
            return;
        }
        list.forEach(function (s) {
            var q = state.quotes[s.code];
            var rep = state.reports[s.code] || DSA.store.getReport(s.code);
            var row = el('div.stock-row', { dataset: { id: s.id }, onclick: function () { openDetail(s.code, s.name); } });
            row.appendChild(el('div.stock-main', {}, [
                el('div.stock-name', {}, [
                    document.createTextNode(q && q.name ? q.name : s.name),
                    rep && rep.signal ? ' ' : null,
                    rep && rep.signal ? signalBadge(rep.signal) : null
                ]),
                el('div.stock-code', { text: s.code.toUpperCase() })
            ]));
            var priceBox = el('div.stock-price');
            if (q && !isNaN(q.price)) {
                priceBox.appendChild(el('div.price.' + priceClass(q.changePct), { text: U.num(q.price) }));
                priceBox.appendChild(pctChip(q.changePct));
            } else {
                priceBox.appendChild(el('div.price.flat', { text: '--' }));
                priceBox.appendChild(el('div.pct.flat', { text: '--' }));
            }
            row.appendChild(priceBox);
            box.appendChild(row);
        });
    }

    function refreshWatch(showLoading) {
        if (state.refreshing) return Promise.resolve();
        var list = DSA.store.watchlist.map(function (s) { return s.code; });
        if (!list.length) return Promise.resolve();
        state.refreshing = true;
        var tip = $('#refresh-tip');
        if (tip) tip.textContent = '刷新中…';

        return DSA.quote.realtime(list).then(function (quotes) {
            quotes.forEach(function (q, i) { if (q) state.quotes[list[i]] = q; });
            var box = $('.stock-list');
            if (box) renderWatchRows(box);
            if (state.tab === 'watch') {
                var any = quotes.filter(Boolean)[0];
                setTitle('自选股', any && any.timeText ? '行情 ' + any.timeText : DSA.store.watchlist.length + ' 只');
            }
            return quotes;
        }).catch(function (e) {
            U.toast('行情刷新失败：' + e.message, 'warn');
        }).then(function () {
            state.refreshing = false;
            if (tip) tip.textContent = '下拉刷新 · ' + U.timeText(Date.now());
        });
    }

    function startAutoRefresh() {
        stopAutoRefresh();
        var st = DSA.store.get();
        if (!st.autoRefresh || state.tab !== 'watch') return;
        var sec = Math.max(5, st.refreshSec || 15);
        state.timer = setInterval(function () {
            if (state.tab !== 'watch' || document.hidden) return;
            refreshWatch();
        }, sec * 1000);
    }

    function stopAutoRefresh() {
        if (state.timer) { clearInterval(state.timer); state.timer = null; }
    }

    // ---- 添加自选 ----
    function openAddSheet() {
        openSheet(function (body, ctx) {
            var resultBox = el('div.result-box');
            var input = el('input.input', { placeholder: '输入名称/拼音/代码，如 茅台、gzmt、600519、AAPL', type: 'search' });
            body.appendChild(el('div.search-box', {}, [input]));
            body.appendChild(resultBox);
            body.appendChild(el('div.field-hint', {
                style: { padding: '10px 14px' },
                text: '支持 A股/港股/美股搜索；也可直接手输腾讯格式代码（如 sh600519、hk00700、usAAPL.OQ）。'
            }));

            var renderEmpty = function (msg) {
                U.clear(resultBox);
                resultBox.appendChild(el('div.empty', { text: msg || '输入关键词开始搜索' }));
            };
            renderEmpty();

            var lastResults = [];
            var doSearch = U.debounce(function (kw) {
                if (!kw) { renderEmpty(); return; }
                U.clear(resultBox);
                resultBox.appendChild(el('div.search-box', { style: { background: 'transparent', border: 'none' } }, [el('div.skel-row')]));
                DSA.quote.search(kw).then(function (list) {
                    lastResults = list;
                    U.clear(resultBox);
                    if (!list.length) { renderEmpty('没有找到匹配的标的'); return; }
                    list.forEach(function (r) {
                        resultBox.appendChild(el('div.sr-item', {
                            onclick: function () { addOne(r.code, r.name, ctx); }
                        }, [
                            el('div', {}, [
                                el('div.sr-name', { text: r.name }),
                                el('div.sr-code', { text: r.code.toUpperCase() })
                            ]),
                            el('span.sr-type', { text: r.type })
                        ]));
                    });
                }).catch(function () { renderEmpty('搜索服务暂时不可用'); });
            }, 400);

            input.addEventListener('input', function () { doSearch(input.value.trim()); });
            setTimeout(function () { input.focus(); }, 260);

            // 手工添加（无搜索结果时）
            body.appendChild(el('div.field', {}, [
                el('div.field-label', { text: '手工添加' }),
                el('div.btn-row', {}, [
                    el('input.input', { id: 'manual-code', placeholder: '腾讯格式代码', style: { flex: '1' } }),
                    el('button.btn.btn-primary', {
                        text: '添加', onclick: function () {
                            var v = $('#manual-code').value.trim();
                            if (!v) return;
                            addOne(v, v, ctx);
                        }
                    })
                ])
            ]));

            function addOne(code, name, c) {
                if (DSA.store.addStock(code, name)) {
                    U.toast('已添加 ' + name);
                    refreshWatch(true).then(function () { if (state.tab === 'watch') renderWatch(); });
                    c.close();
                } else {
                    U.toast('已存在于自选股', 'warn');
                }
            }
        }, { title: '添加自选股', sub: '支持名称/拼音/代码搜索' });
    }

    // ==========================================================
    // 股票详情
    // ==========================================================
    function openDetail(code, name) {
        var meta = DSA.quote.normalize(code);
        var handle = openSheet(function (body, ctx) {
            var stateD = state.detail = { code: code, meta: meta, ctx: ctx, period: 'day', sub: 'volume', chart: null, minute: null, kdata: {} };
            body.appendChild(el('div', { id: 'detail-root' }, skeleton(3)));
            loadDetail(body, stateD, ctx);
        }, {
            title: name || code,
            sub: '加载中…',
            onClose: function () { state.detail = null; }
        });
        return handle;
    }

    function loadDetail(body, d, ctx) {
        var rootNode = $('#detail-root', body);
        var code = d.code;

        Promise.all([
            DSA.quote.realtime([code]).then(function (r) { return r[0]; }).catch(function () { return null; }),
            DSA.quote.minute(code).catch(function () { return null; }),
            DSA.quote.kline(code, 'day', 120).catch(function () { return []; })
        ]).then(function (res) {
            d.quote = res[0];
            d.minuteData = res[1];
            d.kdata.day = res[2];
            U.clear(rootNode);
            if (d.quote && d.quote.name && ctx.setName) ctx.setName(d.quote.name);
            d.render = function () { renderDetail(rootNode, d, ctx); };
            d.render();
        }).catch(function (e) {
            U.clear(rootNode);
            rootNode.appendChild(el('div.empty', { text: '加载失败：' + e.message }));
        });
    }

    function renderDetail(rootNode, d, ctx) {
        U.clear(rootNode);
        var q = d.quote || {};
        ctx.setSub((q.timeText ? '行情 ' + q.timeText + ' · ' : '') + (codeLabel(d.code)));

        // ---- 报价头 ----
        var head = el('div.card');
        var headBody = el('div.card-body');
        head.appendChild(headBody);
        headBody.appendChild(el('div.row-between', {}, [
            el('div', {}, [
                el('div', { style: { fontSize: '26px', fontWeight: '700', lineHeight: '1.15', fontVariantNumeric: 'tabular-nums' }, class: priceClass(q.changePct), text: U.num(q.price) }),
                el('div', { style: { fontSize: '13px', fontVariantNumeric: 'tabular-nums' }, class: priceClass(q.changePct) }, [
                    document.createTextNode(U.num(q.change, 2, true) + ' ' + U.pct(q.changePct))
                ])
            ]),
            el('div', { style: { textAlign: 'right', fontSize: '12px', color: 'var(--text-3)', lineHeight: '1.7' } }, [
                el('div', { text: '今开 ' + U.num(q.open) }),
                el('div', { text: '最高 ' + U.num(q.high) }),
                el('div', { text: '最低 ' + U.num(q.low) }),
                el('div', { text: '昨收 ' + U.num(q.prevClose) })
            ])
        ]));
        rootNode.appendChild(head);

        // ---- 图表面板 ----
        var chartCard = el('div.card');
        var chartBody = el('div.card-body');
        chartCard.appendChild(chartBody);

        var periodPills = el('div.pills', { style: { marginBottom: '8px' } });
        var periods = [['minute', '分时'], ['day', '日K'], ['week', '周K'], ['month', '月K']];
        periods.forEach(function (p) {
            periodPills.appendChild(el('button.pill' + (d.period === p[0] ? '.active' : ''), {
                text: p[1],
                onclick: function () {
                    d.period = p[0];
                    d.render();
                }
            }));
        });
        var subPills = el('div.pills', { style: { marginBottom: '6px' } });
        chartBody.appendChild(el('div.row-between', {}, [
            el('div.pills', {}, [periodPills]),
            d.period !== 'minute' ? subPills : null
        ].filter(Boolean)));

        var canvasBox = el('div.chart-wrap');
        var canvas = el('canvas');
        canvasBox.appendChild(canvas);
        chartBody.appendChild(canvasBox);
        chartBody.appendChild(el('div.refresh-tip', { text: '可拖动平移 · 双指缩放 · 长按查看光标' }));
        rootNode.appendChild(chartCard);

        function mountChart() {
            if (d.chartCtrl && d.chartCtrl.destroy) d.chartCtrl.destroy();
            if (d.period === 'minute') {
                if (!d.minuteData || !d.minuteData.points.length) { canvas.style.height = '120px'; return; }
                d.chartCtrl = DSA.chart.minute(canvas, d.minuteData, { height: 210 });
            } else {
                [['volume', '成交量'], ['macd', 'MACD']].forEach(function (s) {
                    subPills.appendChild(el('button.pill' + (d.sub === s[0] ? '.active' : ''), {
                        text: s[1],
                        onclick: function () { d.sub = s[0]; d.render(); }
                    }));
                });
                var data = d.kdata[d.period];
                if (!data) {
                    canvas.style.height = '120px';
                    DSA.quote.kline(d.code, d.period, d.period === 'day' ? 120 : 80).then(function (k) {
                        d.kdata[d.period] = k;
                        if (d.period !== 'minute') mountChart();
                    });
                    return;
                }
                d.chartCtrl = DSA.chart.kline(canvas, data, { height: 240, sub: d.sub });
            }
        }
        U.clear(subPills);
        mountChart();

        // ---- 关键数据 ----
        var cells = [
            ['成交量', U.amount(q.volume)],
            ['成交额', U.amount(q.amount)],
            ['换手率', isNaN(q.turnoverRate) ? '--' : U.num(q.turnoverRate) + '%'],
            ['振幅', isNaN(q.amplitude) ? '--' : U.num(q.amplitude) + '%'],
            ['量比', isNaN(q.volumeRatio) ? '--' : U.num(q.volumeRatio)],
            ['均价', isNaN(q.avgPrice) ? '--' : U.num(q.avgPrice)],
            ['总市值', isNaN(q.totalCap) ? '--' : U.num(q.totalCap) + '亿'],
            ['市盈率', isNaN(q.pe) ? '--' : U.num(q.pe)],
            ['市净率', isNaN(q.pb) ? '--' : U.num(q.pb)]
        ];
        var grid = el('div.stat-grid');
        cells.forEach(function (c) {
            grid.appendChild(el('div.stat-cell', {}, [
                el('div.k', { text: c[0] }),
                el('div.v', { text: c[1] })
            ]));
        });
        rootNode.appendChild(el('div.card', {}, [el('div.card-body', {}, [grid])]));

        // ---- 操作区 ----
        var opRow = el('div.btn-row', { style: { marginBottom: '10px' } });
        var genBtn = el('button.btn.btn-primary', {
            style: { flex: '1' },
            text: '生成决策报告',
            onclick: function () { runAnalysis(d.code, rootNode, d); }
        });
        opRow.appendChild(genBtn);
        opRow.appendChild(el('button.btn.btn-sm', {
            text: '⟳ 刷新',
            onclick: function () {
                U.clear(rootNode);
                rootNode.appendChild(el('div', {}, skeleton(3)));
                loadDetail(body, d, ctx);
            }
        }));
        rootNode.appendChild(opRow);

        // ---- 已缓存报告 ----
        var cached = state.reports[d.code] || DSA.store.getReport(d.code);
        if (cached) {
            var cachedBox = el('div');
            rootNode.appendChild(cachedBox);
            renderReportCard(cachedBox, cached, d);
        }
    }

    function codeLabel(code) {
        var m = DSA.quote.marketOf(code);
        return ({ cn: 'A股', hk: '港股', us: '美股', bj: '北交所' })[m] + ' · ' + code.toUpperCase();
    }

    // ==========================================================
    // 决策报告渲染
    // ==========================================================
    function renderReportCard(box, report, d) {
        U.clear(box);
        var db = report.dashboard || {};
        var core = db.core_conclusion || {};
        var dp = db.data_perspective || {};
        var it = db.intelligence || {};
        var bp = db.battle_plan || {};
        var pd = db.phase_decision || {};
        var sn = bp.sniper_points || {};
        var sig = report.signal || DSA.analyzer.resolveSignal(report);

        var card = el('div.card');
        var body = el('div.card-body');
        card.appendChild(body);

        // 头部：评分环 + 信号
        var score = sig.score;
        var ringColor = score == null ? 'var(--flat)' : (score >= 70 ? 'var(--up)' : score <= 40 ? 'var(--down)' : 'var(--warn)');
        var ringBg = score == null ? 'transparent' : 'color-mix(in srgb, ' + ringColor + ' 12%, transparent)';
        var headRow = el('div.report-head');
        headRow.appendChild(el('div.score-ring', {
            style: { color: ringColor, background: ringBg, border: '2px solid ' + ringColor }
        }, [
            el('span', { text: score == null ? '--' : Math.round(score) }),
            el('span.sr-sub', { text: SCORE_LABEL(score) })
        ]));
        var headMeta = el('div', { style: { flex: '1', minWidth: '0' } });
        headMeta.appendChild(el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } }, [
            el('span.report-signal.' + priceClass(score == null ? 0 : score - 50), { text: sig.emoji + ' ' + sig.label }),
            db.core_conclusion && core.time_sensitivity ? el('span.muted', { style: { fontSize: '11px' }, text: core.time_sensitivity }) : null
        ]));
        headMeta.appendChild(el('div.report-meta', {
            text: (report.trend_prediction || '趋势研判未提供') +
                (report.confidence_level ? ' · ' + report.confidence_level + '置信' : '') +
                ' · ' + U.dateText(report._ctx.ts) + ' ' + U.timeText(report._ctx.ts)
        }));
        headRow.appendChild(headMeta);
        body.appendChild(headRow);

        if (core.one_sentence) {
            body.appendChild(el('div.quote-line', { style: { marginTop: '10px', fontWeight: '500' }, text: '📌 ' + core.one_sentence }));
        }

        // 操作要害
        var points = [];
        if (sn.ideal_buy != null) points.push(['理想买点', sn.ideal_buy, 'down']);
        if (sn.take_profit != null) points.push(['目标位', sn.take_profit, 'up']);
        if (sn.stop_loss != null) points.push(['止损位', sn.stop_loss, 'down']);
        if (sn.secondary_buy != null) points.push(['次选买点', sn.secondary_buy, 'flat']);
        if (points.length) {
            var pg = el('div.point-grid', { style: { marginTop: '10px' } });
            points.forEach(function (p) {
                pg.appendChild(el('div.point-cell', {}, [
                    el('div.k', { text: p[0] }),
                    el('div.v.' + (p[0].indexOf('止损') >= 0 ? 'down' : p[2]), { text: U.num(p[1]) })
                ]));
            });
            body.appendChild(pg);
        }

        // 风险 + 催化
        if ((it.risk_alerts || []).length) {
            body.appendChild(el('div.block', {}, [
                el('div.block-title', {}, [el('span.bt-bar', { style: { background: 'var(--up)' } }), '风险警报']),
                el('ul.bullets.danger', {}, it.risk_alerts.slice(0, 5).map(function (x) { return el('li', { text: x }); }))
            ]));
        }
        if ((it.positive_catalysts || []).length) {
            body.appendChild(el('div.block', {}, [
                el('div.block-title', {}, [el('span.bt-bar', { style: { background: 'var(--down)' } }), '利好催化']),
                el('ul.bullets.good', {}, it.positive_catalysts.slice(0, 5).map(function (x) { return el('li', { text: x }); }))
            ]));
        }

        // 情报
        var intelRows = [];
        if (it.latest_news) intelRows.push(['最新动态', it.latest_news]);
        if (it.sentiment_summary) intelRows.push(['舆情情绪', it.sentiment_summary]);
        if (it.earnings_outlook) intelRows.push(['业绩预期', it.earnings_outlook]);
        if (intelRows.length) {
            var ib = el('div.block');
            ib.appendChild(el('div.block-title', {}, [el('span.bt-bar'), '情报速览']));
            intelRows.forEach(function (r) {
                ib.appendChild(el('div.md-p', { style: { margin: '4px 0' } }, [
                    el('strong', { text: r[0] + '：' }),
                    document.createTextNode(r[1])
                ]));
            });
            body.appendChild(ib);
        }

        // 数据视角
        var pp = dp.price_position || {};
        var ts = dp.trend_status || {};
        var va = dp.volume_analysis || {};
        if (pp.current_price != null || ts.ma_alignment || va.volume_status) {
            var cells = [];
            if (ts.ma_alignment) cells.push(['均线格局', ts.ma_alignment]);
            if (ts.trend_score != null) cells.push(['趋势评分', ts.trend_score]);
            if (pp.bias_status) cells.push(['乖离状态', pp.bias_status]);
            if (pp.support_level != null) cells.push(['支撑位', U.num(pp.support_level)]);
            if (pp.resistance_level != null) cells.push(['压力位', U.num(pp.resistance_level)]);
            if (va.volume_status) cells.push(['量能', va.volume_status]);
            if (va.volume_meaning) cells.push(['量能含义', va.volume_meaning]);
            if (dp.chip_structure && dp.chip_structure.chip_health) cells.push(['筹码', dp.chip_structure.chip_health]);
            cells.push(['MA5/10/20', (pp.ma5 != null ? U.num(pp.ma5) : '--') + ' / ' + (pp.ma10 != null ? U.num(pp.ma10) : '--') + ' / ' + (pp.ma20 != null ? U.num(pp.ma20) : '--')]);
            var sg = el('div.stat-grid', { style: { marginTop: '10px' } });
            cells.forEach(function (c) {
                sg.appendChild(el('div.stat-cell', {}, [
                    el('div.k', { text: c[0] }),
                    el('div.v', { style: { fontSize: String(c[1]).length > 8 ? '12px' : '14px' }, text: c[1] })
                ]));
            });
            body.appendChild(el('div.block', {}, [
                el('div.block-title', {}, [el('span.bt-bar'), '数据视角']),
                sg
            ]));
        }

        // 持仓建议
        if (core.position_advice) {
            var ab = el('div.block');
            ab.appendChild(el('div.block-title', {}, [el('span.bt-bar'), '持仓应对']));
            if (core.position_advice.no_position) {
                ab.appendChild(el('div.advice-box', {}, [
                    el('span.ab-label', { text: '🆕 空仓者' }), document.createTextNode(core.position_advice.no_position)
                ]));
            }
            if (core.position_advice.has_position) {
                ab.appendChild(el('div.advice-box', {}, [
                    el('span.ab-label', { text: '💼 持仓者' }), document.createTextNode(core.position_advice.has_position)
                ]));
            }
            body.appendChild(ab);
        }

        // 操作清单
        if ((bp.action_checklist || []).length) {
            body.appendChild(el('div.block', {}, [
                el('div.block-title', {}, [el('span.bt-bar', { style: { background: 'var(--warn)' } }), '操作检查清单']),
                el('ul.bullets', {}, bp.action_checklist.slice(0, 6).map(function (x) { return el('li', { text: x }); }))
            ]));
        }

        // 盘中决策
        if (pd.immediate_action || (pd.watch_conditions || []).length) {
            var pdb = el('div.block');
            pdb.appendChild(el('div.block-title', {}, [el('span.bt-bar', { style: { background: 'var(--brand)' } }), '交易节奏']));
            if (pd.immediate_action) pdb.appendChild(el('div.md-p', { text: '⏱ ' + pd.immediate_action }));
            if ((pd.watch_conditions || []).length) {
                pdb.appendChild(el('ul.bullets', {}, pd.watch_conditions.slice(0, 4).map(function (x) { return el('li', { text: x }); })));
            }
            if (pd.next_check_time) pdb.appendChild(el('div.md-p', { text: '🔁 复核：' + pd.next_check_time }));
            body.appendChild(pdb);
        }

        // 免责 + 操作按钮
        body.appendChild(el('div.divider'));
        var btnRow = el('div.btn-row');
        btnRow.appendChild(el('button.btn.btn-sm', {
            text: '📋 复制简报',
            onclick: function () { U.copyText(DSA.analyzer.toMarkdown(report)); }
        }));
        btnRow.appendChild(el('button.btn.btn-sm', {
            text: '📄 查看原文',
            onclick: function () { openRawSheet(report); }
        }));
        btnRow.appendChild(el('button.btn.btn-sm.btn-danger', {
            text: '删除',
            onclick: function () {
                DSA.store.delReport(d.code || report._ctx.code);
                delete state.reports[d.code || report._ctx.code];
                U.clear(box);
                U.toast('已删除缓存报告');
            }
        }));
        body.appendChild(btnRow);
        body.appendChild(el('div.field-hint', {
            text: '本结论由大模型基于公开行情数据生成，仅供参考，不构成投资建议。'
        }));

        box.appendChild(card);
    }

    function SCORE_LABEL(s) {
        if (s == null) return '暂无';
        if (s >= 80) return '强烈看多';
        if (s >= 70) return '看多';
        if (s >= 60) return '偏多';
        if (s >= 40) return '观望';
        if (s >= 20) return '偏空';
        return '看空';
    }

    function openRawSheet(report) {
        openSheet(function (body) {
            body.appendChild(el('div.card', {}, [el('div.card-body', {
                html: U.markdown(report._raw ? '```json\n' + report._raw + '\n```' : '（无原文）')
            })]));
        }, { title: '报告原文 JSON', sub: U.dateText(report._ctx.ts) + ' ' + U.timeText(report._ctx.ts) });
    }

    // ==========================================================
    // 分析执行
    // ==========================================================
    function runAnalysis(code, rootNode, d) {
        var st = DSA.store.get();
        var box = el('div.card', {});
        var body = el('div.card-body');
        box.appendChild(body);
        rootNode.appendChild(box);

        var tipNode = el('div.md-p', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [
            el('span.spinner'), el('span', { text: '正在采集行情并生成决策报告…' })
        ]);
        var bar = el('div.progress-line', {}, [el('i')]);
        body.appendChild(tipNode);
        body.appendChild(bar);
        box.scrollIntoView({ behavior: 'smooth', block: 'center' });

        var finishRender = function (report) {
            U.clear(body);
            renderReportCard(box, report, d || { code: code });
            delete box.dataset.loading;
        };
        var fail = function (err) {
            U.clear(body);
            body.appendChild(el('div.md-p', { style: { color: 'var(--danger)' }, text: '分析失败：' + err.message }));
        };

        if (st.mode === 'server' && st.serverBase) {
            tipNode.querySelector('span:last-child').textContent = '已提交到服务器分析，等待完成…';
            DSA.server.analyze([code], { async: true })
                .then(function (res) {
                    var taskId = res.task_id || (res.tasks && res.tasks[0] && res.tasks[0].task_id);
                    if (!taskId) {
                        var norm = DSA.server.normalizeServerResult(res);
                        if (norm) { finishRender(norm); return null; }
                        throw new Error('服务端未返回任务 ID');
                    }
                    return DSA.server.waitTask(taskId, function (st2) {
                        tipNode.querySelector('span:last-child').textContent = '服务器任务状态：' + (st2.status || '') + '…';
                    });
                })
                .then(function (finalTask) {
                    if (!finalTask) return;
                    var norm = DSA.server.normalizeServerResult(finalTask.result || finalTask);
                    if (!norm) throw new Error('服务端结果解析失败');
                    state.reports[code] = norm;
                    DSA.store.setReport(code, norm);
                    finishRender(norm);
                })
                .catch(fail);
            return;
        }

        if (!DSA.store.llmReady()) {
            fail(new Error('尚未配置大模型，请先到「设置」填写 API Key'));
            return;
        }

        DSA.analyzer.analyze(code, { withNews: st.searchEnabled })
            .then(function (report) {
                state.reports[code] = report;
                DSA.store.setReport(code, report);
                finishRender(report);
                U.toast('分析完成：' + report.signal.label);
            })
            .catch(fail);
    }

    // ==========================================================
    // 大盘复盘页
    // ==========================================================
    function renderMarket(force) {
        state.tab = 'market';
        stopAutoRefresh();
        setTitle('大盘复盘', '指数 · 板块 · 情绪');
        setActions([el('button.icon-btn', { text: '⟳', onclick: function () { renderMarket(true); } })]);

        var view = U.clear($('#view'));
        if (!state.marketData || force) {
            view.appendChild(el('div.card', {}, [el('div.card-body', {}, skeleton(4))]));
            DSA.market.snapshot().then(function (data) {
                state.marketData = data;
                if (state.tab === 'market') renderMarket();
            }).catch(function (e) {
                if (state.tab !== 'market') return;
                U.clear(view);
                view.appendChild(el('div.empty', { text: '大盘数据加载失败：' + e.message }));
            });
            return;
        }

        var data = state.marketData;
        setTitle('大盘复盘', U.timeText(data.ts) + ' 更新');

        // 指数
        var grid = el('div.index-grid');
        data.indices.forEach(function (i) {
            var cls = priceClass(i.changePct);
            grid.appendChild(el('div.index-card', {}, [
                el('div.ic-name', { text: i.name }),
                el('div.ic-price.' + cls, { text: U.num(i.price) }),
                el('div.ic-pct.' + cls, { text: U.pct(i.changePct) })
            ]));
        });
        view.appendChild(grid);

        // 温度
        var temp = el('div.card', { style: { marginTop: '10px' } });
        var tempBody = el('div.card-body');
        temp.appendChild(tempBody);
        tempBody.appendChild(el('div.card-title', { text: '市场温度' }));
        var tg = el('div.temp-grid', { style: { marginTop: '8px' } });
        var wl = data.watch;
        [
            ['涨停', data.limitUp == null ? '--' : data.limitUp, 'up'],
            ['跌停', data.limitDown == null ? '--' : data.limitDown, 'down'],
            ['自选涨', wl ? wl.upCount : '--', 'up'],
            ['自选跌', wl ? wl.downCount : '--', 'down']
        ].forEach(function (c) {
            tg.appendChild(el('div.temp-cell', {}, [
                el('div.tv.' + c[2], { text: c[1] }),
                el('div.tk', { text: c[0] })
            ]));
        });
        tempBody.appendChild(tg);
        if (wl && wl.quotes.length) {
            tempBody.appendChild(el('div.md-p', {
                style: { marginTop: '8px' },
                text: '自选 ' + wl.quotes.length + ' 只平均涨跌 ' + U.pct(wl.avgPct) +
                    '，涨超5% ' + wl.bigUp + ' 只，跌超5% ' + wl.bigDown + ' 只'
            }));
        }
        view.appendChild(temp);

        // 板块榜
        function rankCard(title, list, colorTrade) {
            if (!list || !list.length) return null;
            var maxAbs = Math.max.apply(null, list.map(function (s) { return Math.abs(s.changePct); })) || 1;
            var card = el('div.card', { style: { marginTop: '10px' } });
            var cb = el('div.card-body');
            card.appendChild(cb);
            cb.appendChild(el('div.card-title', { text: title }));
            list.forEach(function (s, i) {
                cb.appendChild(el('div.rank-row', {}, [
                    el('div.rank-idx' + (i < 3 ? '.top' : ''), { text: i + 1 }),
                    el('div.rank-name', { text: s.name }),
                    el('div.bar-track', {}, [el('i', {
                        style: {
                            width: Math.max(3, Math.abs(s.changePct) / maxAbs * 100) + '%',
                            background: U.dir(s.changePct) >= 0 ? 'var(--up)' : 'var(--down)'
                        }
                    })]),
                    el('div', {
                        style: { width: '58px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: '13px' },
                        class: priceClass(s.changePct), text: U.pct(s.changePct)
                    })
                ]));
            });
            return card;
        }
        var ld = rankCard('🔥 领涨板块', data.sectors.leaders);
        if (ld) view.appendChild(ld);
        var lg = rankCard('🧊 领跌板块', data.sectors.laggards);
        if (lg) view.appendChild(lg);

        // AI 复盘
        var aiCard = el('div.card', { style: { marginTop: '10px' } });
        var aiBody = el('div.card-body');
        aiCard.appendChild(aiBody);
        aiBody.appendChild(el('div.row-between', {}, [
            el('div.card-title', { text: '🧠 AI 复盘点评' }),
            el('div.btn-row', {}, [
                el('button.btn.btn-sm.btn-primary', {
                    text: '生成',
                    onclick: function (e) { runMarketReview(data, aiBody, e.target); }
                }),
                el('button.btn.btn-sm', {
                    text: '复制',
                    onclick: function () { U.copyText(DSA.market.toMarkdown(data, data.aiText)); }
                })
            ])
        ]));
        if (data.aiText) {
            aiBody.appendChild(el('div', { style: { marginTop: '8px' }, html: U.markdown(data.aiText) }));
        } else {
            aiBody.appendChild(el('div.field-hint', { text: '基于当前指数、涨跌停、板块数据生成不超过 500 字的复盘，需要已配置大模型。' }));
        }
        view.appendChild(aiCard);
    }

    function runMarketReview(data, body, btn) {
        if (!DSA.store.llmReady()) { U.toast('请先配置大模型', 'warn'); return; }
        var node = el('div', { style: { marginTop: '8px' } }, [
            el('div.md-p', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [
                el('span.spinner'), el('span', { text: '正在复盘…' })
            ]),
            el('div.progress-line', {}, [el('i')])
        ]);
        var old = $('.md-h, .md-p, .md-ul', body.parentNode);
        body.appendChild(node);
        if (btn) btn.disabled = true;
        DSA.market.review(data).then(function (text) {
            data.aiText = text;
            U.clear(node);
            node.appendChild(el('div', { html: U.markdown(text) }));
            if (btn) btn.disabled = false;
        }).catch(function (e) {
            U.clear(node);
            node.appendChild(el('div.md-p', { style: { color: 'var(--danger)' }, text: '生成失败：' + e.message }));
            if (btn) btn.disabled = false;
        });
    }

    // ==========================================================
    // 报告/任务页
    // ==========================================================
    function renderTasks() {
        state.tab = 'tasks';
        stopAutoRefresh();
        setTitle('分析记录', '本地缓存的决策报告');
        setActions([
            el('button.icon-btn', {
                text: '🗑',
                onclick: function () {
                    if (!confirm('确定清空所有缓存报告？')) return;
                    Object.keys(DSA.store.allReports()).forEach(function (k) { DSA.store.delReport(k); });
                    state.reports = {};
                    renderTasks();
                    U.toast('已清空');
                }
            })
        ]);

        var view = U.clear($('#view'));
        var bag = DSA.store.allReports();
        var codes = Object.keys(bag).sort(function (a, b) { return bag[b].ts - bag[a].ts; });

        if (!codes.length) {
            view.appendChild(el('div.empty', {}, [
                el('span.empty-icon', { text: '📋' }),
                '还没有分析记录',
                el('div', { style: { marginTop: '8px', fontSize: '12px' }, text: '到自选股详情页点「生成决策报告」' })
            ]));
            return;
        }

        var listBox = el('div.stock-list');
        codes.forEach(function (code) {
            var item = bag[code];
            var rep = item.data;
            var sig = rep.signal || DSA.analyzer.resolveSignal(rep);
            var name = (rep._ctx && rep._ctx.name) || rep.stock_name || code;
            listBox.appendChild(el('div.task-row', {
                onclick: function () { openReport(code, rep); }
            }, [
                el('div.task-main', {}, [
                    el('div.task-title', {}, [
                        document.createTextNode(name), ' ',
                        el('span.muted', { style: { fontSize: '11px' }, text: code.toUpperCase() })
                    ]),
                    el('div.task-time', {
                        text: U.dateText(item.ts) + ' ' + U.timeText(item.ts) + ' · 评分 ' +
                            (sig.score == null ? '--' : Math.round(sig.score))
                    })
                ]),
                signalBadge(sig),
                el('div.task-badge', {
                    style: { color: 'var(--text-3)', marginLeft: '6px' },
                    text: '›'
                })
            ]));
        });
        view.appendChild(listBox);
        view.appendChild(el('div.tagline', { text: '报告缓存在本机，卸载应用或清理浏览器数据会丢失' }));
    }

    function openReport(code, rep) {
        openSheet(function (body, ctx) {
            var box = el('div');
            body.appendChild(box);
            renderReportCard(box, rep, {
                code: code,
                _ctx: rep._ctx
            });
        }, {
            title: (rep._ctx && rep._ctx.name) || rep.stock_name || code,
            sub: code.toUpperCase() + ' · ' + U.dateText((rep._ctx || {}).ts || Date.now())
        });
    }

    // ==========================================================
    // 设置页
    // ==========================================================
    function renderSettings() {
        state.tab = 'settings';
        stopAutoRefresh();
        setTitle('设置', '模式 · 模型 · 自选管理');
        setActions([]);
        var view = U.clear($('#view'));
        var st = DSA.store.get();

        // ---- 运行模式 ----
        var modeCard = el('div.card');
        modeCard.appendChild(el('div.card-body', {}, [
            el('div.card-title', { text: '运行模式' }),
            el('div.pills', { style: { marginTop: '8px' } }, [
                el('button.pill' + (st.mode === 'direct' ? '.active' : ''), {
                    text: '手机直连',
                    onclick: function () { DSA.store.set({ mode: 'direct' }); renderSettings(); }
                }),
                el('button.pill' + (st.mode === 'server' ? '.active' : ''), {
                    text: '服务器模式',
                    onclick: function () { DSA.store.set({ mode: 'server' }); renderSettings(); }
                })
            ]),
            el('div.field-hint', {
                text: st.mode === 'direct'
                    ? '行情走腾讯/东财 JSONP，AI 分析在手机上直接调用大模型。装完即用，无需服务器。'
                    : '连接你电脑或服务器上运行的 python main.py --webui，分析在服务端执行，功能更全。'
            })
        ]));
        view.appendChild(modeCard);

        if (st.mode === 'server') {
            var srvCard = el('div.card', { style: { marginTop: '10px' } });
            var sb = el('div.card-body');
            srvCard.appendChild(sb);
            sb.appendChild(el('div.card-title', { text: '服务器地址' }));
            var baseInput = el('input.input', { value: st.serverBase || '', placeholder: 'http://192.168.1.20:8000', style: { marginTop: '8px' } });
            sb.appendChild(baseInput);
            sb.appendChild(el('div.field-hint', { text: '手机与电脑需在同一局域网。查看电脑 IP：命令行 ipconfig' }));
            var testBtn = el('button.btn.btn-sm', {
                style: { marginTop: '8px' },
                text: '测试连接',
                onclick: function () {
                    DSA.store.set({ serverBase: baseInput.value.trim() });
                    testBtn.disabled = true;
                    testBtn.textContent = '测试中…';
                    DSA.server.ping().then(function (r) {
                        testBtn.disabled = false;
                        testBtn.textContent = '测试连接';
                        U.toast(r.ok ? '连接成功：' + r.detail : '连接失败：' + r.detail, r.ok ? '' : 'error');
                    });
                }
            });
            sb.appendChild(testBtn);
            view.appendChild(srvCard);
        }

        // ---- 大模型 ----
        var llmCard = el('div.card', { style: { marginTop: '10px' } });
        var lb = el('div.card-body');
        llmCard.appendChild(lb);
        lb.appendChild(el('div.row-between', {}, [
            el('div.card-title', { text: '大模型（直连模式）' }),
            DSA.store.llmReady() ? el('span.signal-badge.buy', { text: '已配置' }) : el('span.signal-badge.hold', { text: '未配置' })
        ]));

        var presets = DSA.store.LLM_PRESETS;
        var presetSelect = el('select.select', { style: { marginTop: '8px' } });
        Object.keys(presets).forEach(function (k) {
            presetSelect.appendChild(el('option', { value: k, text: presets[k].label, selected: st.llm.preset === k }));
        });
        presetSelect.addEventListener('change', function () {
            var p = presets[presetSelect.value];
            DSA.store.set({
                llm: Object.assign({}, DSA.store.get().llm, {
                    preset: presetSelect.value, label: p.label, provider: p.provider,
                    baseUrl: p.baseUrl, model: p.model
                })
            });
            renderSettings();
            U.toast('已切换到 ' + p.label);
        });
        lb.appendChild(presetSelect);

        function fieldRow(label, value, placeholder, onInput, hint) {
            var wrap = el('div', { style: { marginTop: '10px' } });
            wrap.appendChild(el('label.field-label', { text: label }));
            var input = el('input.input', { value: value || '', placeholder: placeholder || '' });
            input.addEventListener('change', function () { onInput(input.value.trim()); });
            wrap.appendChild(input);
            if (hint) wrap.appendChild(el('div.field-hint', { text: hint }));
            return wrap;
        }

        lb.appendChild(fieldRow('API 地址 Base URL', st.llm.baseUrl, 'https://api.deepseek.com/v1', function (v) {
            DSA.store.set({ llm: Object.assign({}, DSA.store.get().llm, { baseUrl: v }) });
        }));
        lb.appendChild(fieldRow('模型名称 Model', st.llm.model, 'deepseek-chat', function (v) {
            DSA.store.set({ llm: Object.assign({}, DSA.store.get().llm, { model: v }) });
        }, '需要 JSON 输出能力，推荐 deepseek-chat / gpt-4o-mini / qwen-plus'));

        var keyWrap = el('div', { style: { marginTop: '10px' } });
        keyWrap.appendChild(el('label.field-label', { text: 'API Key' }));
        var keyInput = el('input.input', { type: 'password', value: st.llm.apiKey || '', placeholder: 'sk-...' });
        keyWrap.appendChild(keyInput);
        keyWrap.appendChild(el('div.field-hint', { text: 'Key 仅保存在本机浏览器 / App 本地存储中，不会上传到任何第三方服务器。' }));
        lb.appendChild(keyWrap);

        var saveRow = el('div.btn-row', { style: { marginTop: '10px' } });
        var testLlm = el('button.btn.btn-sm', {
            text: '测试连通',
            onclick: function () {
                DSA.store.set({ llm: Object.assign({}, DSA.store.get().llm, { apiKey: keyInput.value.trim() }) });
                testLlm.disabled = true;
                testLlm.textContent = '测试中…';
                DSA.llm.test().then(function (r) {
                    testLlm.disabled = false;
                    testLlm.textContent = '测试连通';
                    U.toast(r.ok ? '连通正常：' + r.detail : '失败：' + r.detail, r.ok ? '' : 'error');
                });
            }
        });
        saveRow.appendChild(testLlm);
        saveRow.appendChild(el('button.btn.btn-sm.btn-primary', {
            text: '保存',
            onclick: function () {
                DSA.store.set({ llm: Object.assign({}, DSA.store.get().llm, { apiKey: keyInput.value.trim() }) });
                U.toast('已保存');
            }
        }));
        lb.appendChild(saveRow);
        view.appendChild(llmCard);

        // ---- 联网搜索（可选） ----
        var searchCard = el('div.card', { style: { marginTop: '10px' } });
        var scb = el('div.card-body');
        searchCard.appendChild(scb);
        scb.appendChild(el('div.row-between', {}, [
            el('div', {}, [
                el('div.card-title', { text: '联网搜索（可选）' }),
                el('div.field-hint', { text: '开启后分析时会带新闻/公告/业绩消息，结论更准，但会额外消耗 Token。' })
            ]),
            el('label.switch', {}, [
                el('input', {
                    type: 'checkbox', checked: !!st.searchEnabled,
                    onchange: function (e) {
                        DSA.store.set({ searchEnabled: e.target.checked });
                        renderSettings();
                    }
                })
            ])
        ]));
        if (st.searchEnabled) {
            var spSel = el('select.select', { style: { marginTop: '10px' } });
            [['tavily', 'Tavily（推荐，有免费额度）'], ['bocha', '博查民营搜索']].forEach(function (o) {
                spSel.appendChild(el('option', { value: o[0], text: o[1], selected: st.searchProvider === o[0] }));
            });
            spSel.addEventListener('change', function () { DSA.store.set({ searchProvider: spSel.value }); });
            scb.appendChild(spSel);
            var sk = el('input.input', { value: st.searchKey || '', placeholder: '搜索服务 API Key', style: { marginTop: '8px' } });
            sk.addEventListener('change', function () { DSA.store.set({ searchKey: sk.value.trim() }); });
            scb.appendChild(sk);
        }
        view.appendChild(searchCard);

        // ---- 自选股管理 ----
        var wlCard = el('div.card', { style: { marginTop: '10px' } });
        var wlb = el('div.card-body');
        wlCard.appendChild(wlb);
        wlb.appendChild(el('div.row-between', {}, [
            el('div.card-title', { text: '自选股管理' }),
            el('button.btn.btn-sm', { text: '＋ 添加', onclick: function () { openAddSheet(); } })
        ]));
        DSA.store.watchlist.forEach(function (s, i) {
            wlb.appendChild(el('div.row-between', {
                style: { padding: '8px 0', borderBottom: '1px solid var(--border-2)' }
            }, [
                el('div', {}, [
                    el('div', { style: { fontSize: '14px' }, text: s.name }),
                    el('div.muted', { style: { fontSize: '11px' }, text: s.code.toUpperCase() })
                ]),
                el('div.btn-row', {}, [
                    el('button.btn.btn-sm', { text: '↑', onclick: function () { DSA.store.moveStock(s.id, -1); renderSettings(); } }),
                    el('button.btn.btn-sm', { text: '↓', onclick: function () { DSA.store.moveStock(s.id, 1); renderSettings(); } }),
                    el('button.btn.btn-sm.btn-danger', {
                        text: '删', onclick: function () {
                            DSA.store.removeStock(s.id);
                            delete state.quotes[s.code];
                            renderSettings();
                        }
                    })
                ])
            ]));
        });
        view.appendChild(wlCard);

        // ---- 外观与行为 ----
        var uiCard = el('div.card', { style: { marginTop: '10px' } });
        var ub = el('div.card-body');
        uiCard.appendChild(ub);
        ub.appendChild(el('div.card-title', { text: '外观与行为' }));
        ub.appendChild(el('div.row-between', { style: { marginTop: '10px' } }, [
            el('span', { text: '深色主题' }),
            el('label.switch', {}, [el('input', {
                type: 'checkbox', checked: st.theme === 'dark',
                onchange: function (e) {
                    DSA.store.set({ theme: e.target.checked ? 'dark' : 'light' });
                    DSA.store.applyTheme();
                    if (state.detail && state.detail.render) state.detail.render();
                    renderCurrent(true);
                }
            })])
        ]));
        ub.appendChild(el('div.row-between', { style: { marginTop: '10px' } }, [
            el('span', { text: '自选页自动刷新' }),
            el('label.switch', {}, [el('input', {
                type: 'checkbox', checked: st.autoRefresh,
                onchange: function (e) {
                    DSA.store.set({ autoRefresh: e.target.checked });
                    if (e.target.checked) startAutoRefresh(); else stopAutoRefresh();
                }
            })])
        ]));
        if (st.autoRefresh) {
            var secSel = el('select.select', { style: { marginTop: '8px' } });
            [5, 10, 15, 30, 60].forEach(function (s2) {
                secSel.appendChild(el('option', { value: s2, text: '每 ' + s2 + ' 秒', selected: st.refreshSec === s2 }));
            });
            secSel.addEventListener('change', function () {
                DSA.store.set({ refreshSec: parseInt(secSel.value, 10) });
                startAutoRefresh();
            });
            ub.appendChild(secSel);
        }
        var rtSel = el('select.select', { style: { marginTop: '10px' } });
        [['detailed', '完整报告（推荐）'], ['brief', '精简报告（省 Token）']].forEach(function (o) {
            rtSel.appendChild(el('option', { value: o[0], text: o[1], selected: st.reportType === o[0] }));
        });
        rtSel.addEventListener('change', function () { DSA.store.set({ reportType: rtSel.value }); });
        ub.appendChild(el('div.field-label', { style: { marginTop: '10px' }, text: '报告详细程度' }));
        ub.appendChild(rtSel);
        view.appendChild(uiCard);

        // ---- 关于 ----
        view.appendChild(el('div.card', { style: { marginTop: '10px' } }, [el('div.card-body', {}, [
            el('div.card-title', { text: '关于' }),
            el('div.md-p', { text: '本应用为 ZhuLinsen/daily_stock_analysis 的手机端移植版本，决策报告结构与该项目的 AnalysisReportSchema 保持一致。' }),
            el('div.md-p', { text: '行情数据来自腾讯财经与东方财富公开接口，仅用于个人研究，请勿用于商业用途。' }),
            el('div.btn-row', { style: { marginTop: '8px' } }, [
                el('button.btn.btn-sm', {
                    text: '导出配置备份',
                    onclick: function () {
                        var dump = { config: DSA.store.get(), watchlist: DSA.store.watchlist };
                        var ta = el('textarea.input', { style: { minHeight: '140px' } });
                        ta.value = JSON.stringify(dump, null, 2);
                        openSheet(function (b) {
                            b.appendChild(el('div.card', {}, [el('div.card-body', {}, [
                                el('div.card-title', { text: '配置备份（不含 API Key 之外的敏感信息）' }),
                                ta,
                                el('button.btn.btn-primary.btn-block', {
                                    style: { marginTop: '8px' }, text: '复制',
                                    onclick: function () { U.copyText(ta.value); }
                                })
                            ])]));
                        }, { title: '配置备份' });
                    }
                }),
                el('button.btn.btn-sm.btn-danger', {
                    text: '清空全部数据',
                    onclick: function () {
                        if (!confirm('清空所有自选股、报告与配置？此操作不可恢复。')) return;
                        ['dsa.config.v1', 'dsa.watchlist.v1', 'dsa.report.v1', 'dsa.tasks.v1'].forEach(function (k) { U.LS.del(k); });
                        location.reload();
                    }
                })
            ])
        ])]));
        view.appendChild(el('div.tagline', { text: '投资有风险，所有结论仅供参考，不构成投资建议。' }));
    }

    // ==========================================================
    // 路由
    // ==========================================================
    function renderCurrent(keepScroll) {
        var y = keepScroll ? window.scrollY : 0;
        if (state.tab === 'watch') renderWatch();
        else if (state.tab === 'market') renderMarket();
        else if (state.tab === 'tasks') renderTasks();
        else renderSettings();
        if (keepScroll) window.scrollTo(0, y);
    }

    function setTab(tab) {
        if (state.tab === tab) {
            if (tab === 'watch') refreshWatch(true);
            else if (tab === 'market') renderMarket(true);
            else if (tab === 'tasks') renderTasks();
            return;
        }
        stopAutoRefresh();
        state.tab = tab;
        $$('.tab').forEach(function (t) { t.classList.toggle('active', t.dataset.tab === tab); });
        window.scrollTo(0, 0);
        renderCurrent();
    }

    // ==========================================================
    // 下拉刷新
    // ==========================================================
    function bindPullToRefresh() {
        var startY = 0, pulling = false, container = document.body;
        container.addEventListener('touchstart', function (e) {
            if (window.scrollY > 0 || document.querySelector('.sheet')) return;
            startY = e.touches[0].clientY;
            pulling = true;
        }, { passive: true });
        container.addEventListener('touchmove', function (e) {
            if (!pulling) return;
            var dy = e.touches[0].clientY - startY;
            if (dy < 0) { pulling = false; return; }
        }, { passive: true });
        container.addEventListener('touchend', function (e) {
            if (!pulling) return;
            pulling = false;
            var dy = (e.changedTouches[0] || {}).clientY - startY;
            if (dy > 70 && window.scrollY <= 0 && !document.querySelector('.sheet')) {
                if (state.tab === 'watch') refreshWatch(true);
                else if (state.tab === 'market') renderMarket(true);
            }
        });
    }

    // ==========================================================
    // 初始化
    // ==========================================================
    function init() {
        DSA.store.applyTheme();
        $$('.tab').forEach(function (t) {
            t.addEventListener('click', function () { setTab(t.dataset.tab); });
        });
        bindPullToRefresh();

        document.addEventListener('visibilitychange', function () {
            if (!document.hidden && state.tab === 'watch') refreshWatch();
        });

        if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
            navigator.serviceWorker.register('sw.js').catch(function () { });
        }

        // 恢复内存报告缓存
        var bag = DSA.store.allReports();
        Object.keys(bag).forEach(function (k) { state.reports[k] = bag[k].data; });

        $$('.tab').forEach(function (t) { t.classList.toggle('active', t.dataset.tab === 'watch'); });
        renderWatch();

        // 首次使用引导
        if (!DSA.store.llmReady() && !U.LS.get('dsa.guided', false)) {
            U.LS.set('dsa.guided', true);
            setTimeout(function () {
                U.toast('首次使用请先到「设置」填写大模型 API Key', 'warn', 4000);
            }, 900);
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    // Android 返回键桥：有浮层时关闭浮层，无浮层时交给原生处理
    root.__dsaBack = function () {
        var close = state.sheetStack[state.sheetStack.length - 1];
        if (close) { close(); return true; }
        return false;
    };

    DSA.app = { setTab: setTab, refreshWatch: refreshWatch, state: state, renderCurrent: renderCurrent };
})(window);
