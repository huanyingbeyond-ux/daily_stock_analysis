/* ============================================================
 * DSA Mobile - quote.js
 * 行情数据源：腾讯（实时 / K线 / 分时）+ 东方财富（搜索 / 指数 / 板块）
 * 全部通过 JSONP 获取，手机端与 WebView 均可直连，无需服务器。
 * ============================================================ */
(function (root) {
    'use strict';

    var DSA = root.DSA = root.DSA || {};
    var U = DSA.util;

    var TX_REALTIME = 'https://qt.gtimg.cn/q=';
    var TX_KLINE = 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get';
    var TX_MINUTE = 'https://web.ifzq.gtimg.cn/appstock/app/minute/query';
    var EM_SEARCH = 'https://searchapi.eastmoney.com/api/suggest/get';
    // push2 主域会拒绝浏览器跨站 script，delay 镜像对网页端开放（行情延迟约1分钟，复盘场景无碍）
    var EM_ULIST = 'https://push2delay.eastmoney.com/api/qt/ulist.np/get';
    var EM_CLIST = 'https://push2delay.eastmoney.com/api/qt/clist/get';
    var EM_ZTPOOL = 'https://push2ex.eastmoney.com/getTopicZTPool';
    var EM_DTPOOL = 'https://push2ex.eastmoney.com/getTopicDTPool';
    var EM_TOKEN = 'D43BF722C8E33BDC906FB84D85E326E8';

    // ---------------------------------------------------------
    // 代码标准化
    // ---------------------------------------------------------
    /** 市场归属：cn / hk / us / bj */
    function marketOf(code) {
        var c = String(code || '').toLowerCase();
        if (c.indexOf('hk') === 0) return 'hk';
        if (c.indexOf('us') === 0) return 'us';
        if (c.indexOf('bj') === 0) return 'bj';
        return 'cn';
    }

    /**
     * 把任意输入规范成「腾讯代码 + 展示代码 + 市场」
     * 支持：600519 / sh600519 / 000001 / sz399006 / 833284 / hk00700 / 00700
     *       AAPL / usAAPL / usAAPL.OQ
     */
    function normalize(input) {
        var raw = String(input || '').trim().toLowerCase().replace(/\s+/g, '');
        if (!raw) return null;

        // 已带前缀
        var m = /^(sh|sz|bj|hk|us)([a-z0-9.]+)$/.exec(raw);
        if (m) {
            var prefix = m[1], body = m[2];
            var tencent = prefix + body;
            // 美股若不带交易所后缀，自动补 .OQ（纳斯达克最常见）
            if (prefix === 'us' && body.indexOf('.') < 0) tencent = 'us' + body.toUpperCase() + '.OQ';
            if (prefix === 'us') tencent = 'us' + tencent.slice(2).toUpperCase();
            return { input: raw, code: prefix === 'us' ? body.toUpperCase() : body, tencent: tencent, market: prefix === 'bj' ? 'bj' : prefix };
        }

        // 纯数字
        if (/^\d{6}$/.test(raw)) {
            var pfx;
            var head = raw[0];
            if (raw.indexOf('8') === 0 || raw.indexOf('4') === 0 || raw.indexOf('92') === 0) pfx = 'bj';
            else if (head === '6') pfx = 'sh';
            else pfx = 'sz';
            return { input: raw, code: raw, tencent: pfx + raw, market: pfx === 'bj' ? 'bj' : pfx };
        }
        if (/^\d{5}$/.test(raw)) return { input: raw, code: raw, tencent: 'hk' + raw, market: 'hk' };
        if (/^[a-z][a-z0-9.]{0,7}$/.test(raw)) {
            var up = raw.toUpperCase();
            return { input: raw, code: up, tencent: 'us' + up + (up.indexOf('.') >= 0 ? '' : '.OQ'), market: 'us' };
        }
        return { input: raw, code: raw, tencent: raw, market: marketOf(raw) };
    }

    /** 美股市代码有多个后缀候选，取不到数据时退避尝试 */
    function tencentCandidates(t) {
        var list = [t];
        if (/^us/.test(t) && t.indexOf('.') < 0) {
            list = ['us' + t.slice(2).toUpperCase() + '.OQ', 'us' + t.slice(2).toUpperCase() + '.N', t];
        }
        return list;
    }

    // ---------------------------------------------------------
    // 腾讯实时行情
    // ---------------------------------------------------------
    function parseTimeField(s, market) {
        if (!s) return Date.now();
        // A股：20260909141654
        if (/^\d{14}$/.test(s)) {
            return new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8),
                +s.slice(8, 10), +s.slice(10, 12), +s.slice(12, 14)).getTime();
        }
        // 港股：2026/09/09 13:55:18  美股：2026-09-08 16:00:02
        return new Date(s.replace(/\//g, '-').replace(' ', 'T')).getTime() || Date.now();
    }

    function parseTencentQt(text, market) {
        var f = text.split('~');
        if (f.length < 35) return null;
        var amountRaw = parseFloat(f[37]);
        var amount = (market === 'cn' || market === 'bj') && !isNaN(amountRaw) ? amountRaw * 10000 : amountRaw;
        return {
            name: f[1],
            code: f[2],
            price: parseFloat(f[3]),
            prevClose: parseFloat(f[4]),
            open: parseFloat(f[5]),
            volume: parseFloat(f[6]),                 // A股单位：手
            ts: parseTimeField(f[30], market),
            timeText: formatStamp(f[30]),
            change: parseFloat(f[31]),
            changePct: parseFloat(f[32]),
            high: parseFloat(f[33]),
            low: parseFloat(f[34]),
            amount: amount,
            turnoverRate: market === 'cn' ? parseFloat(f[38]) : NaN,     // 换手率 %
            pe: market === 'cn' ? parseFloat(f[39]) : NaN,
            amplitude: market === 'cn' ? parseFloat(f[43]) : NaN,        // 振幅 %
            floatCap: market === 'cn' ? parseFloat(f[44]) : NaN,         // 流通市值（亿）
            totalCap: market === 'cn' ? parseFloat(f[45]) : NaN,         // 总市值（亿）
            pb: market === 'cn' ? parseFloat(f[46]) : NaN,
            limitUp: market === 'cn' ? parseFloat(f[47]) : NaN,
            limitDown: market === 'cn' ? parseFloat(f[48]) : NaN,
            volumeRatio: market === 'cn' ? parseFloat(f[49]) : NaN,      // 量比
            avgPrice: market === 'cn' ? parseFloat(f[51]) : NaN,
            market: market
        };
    }

    function formatStamp(s) {
        if (!s) return '--';
        if (/^\d{14}$/.test(s)) return s.slice(8, 10) + ':' + s.slice(10, 12) + ':' + s.slice(12, 14);
        return String(s).replace(/^\d{4}[-/]\d{2}[-/]\d{2}\s*/, '');
    }

    /**
     * 批量实时行情
     * @param {string[]} inputs 任意格式代码
     * @param {object} opts { prefer: 'tencent'|'em' }
     */
    function realtime(inputs, opts) {
        opts = opts || {};
        // 东方财富通道（备用，A股/港股/美股统一 secid）
        if (opts.prefer === 'em') return realtimeEM(inputs);

        var metas = inputs.map(normalize).filter(Boolean);
        if (!metas.length) return Promise.resolve([]);

        // 腾讯一次请求最多 60 个，且请求串过长会被截断，这里按 30 切片
        var chunks = [];
        for (var i = 0; i < metas.length; i += 30) chunks.push(metas.slice(i, i + 30));

        return Promise.all(chunks.map(function (chunk) {
            var varNames = chunk.map(function (m) { return 'v_' + m.tencent; });
            var url = TX_REALTIME + chunk.map(function (m) { return m.tencent; }).join(',');
            return U.jsonpVar(url, varNames, { timeout: 15000 }).then(function (bag) {
                var out = [];
                chunk.forEach(function (m) {
                    var text = bag['v_' + m.tencent];
                    var hasData = typeof text === 'string' && text.length > 30 && text.split('~').length > 30;
                    if (hasData) {
                        var q = parseTencentQt(text, m.market);
                        if (q) { q.tencent = m.tencent; q.src = 'tencent'; out.push(q); return; }
                    }
                    // 美股后缀退避：补齐 .OQ / .N 再试
                    if (m.market === 'us') return null;
                    out.push(null);
                });
                return out;
            }).catch(function (err) {
                return chunk.map(function () { return null; });
            });
        })).then(function (groups) {
            var results = [];
            groups.forEach(function (g) { results = results.concat(g); });
            // 逐个补齐美股候选后缀
            var pending = [];
            metas.forEach(function (m, i) {
                if (results[i]) return;
                if (m.market !== 'us') { results[i] = null; return; }
                pending.push({ index: i, meta: m });
            });
            if (!pending.length) return results.map(function (r, i) { return r ? attachMeta(r, metas[i]) : r; });
            return Promise.all(pending.map(function (p) {
                return tryUs(p.meta);
            })).then(function (fixes) {
                fixes.forEach(function (f, k) {
                    var idx = pending[k].index;
                    results[idx] = f ? attachMeta(f, pending[k].meta) : attachMeta(emptyQuote(pending[k].meta), pending[k].meta);
                });
                return results.map(function (r, i) { return r ? attachMeta(r, metas[i]) : r; });
            });
        });
    }

    function attachMeta(q, meta) {
        if (!q) return q;
        q.tencent = q.tencent || meta.tencent;
        q.norm = meta;
        q.market = meta.market;
        return q;
    }

    function emptyQuote(meta) {
        return {
            name: meta.code, code: meta.code, price: NaN, prevClose: NaN, open: NaN,
            volume: NaN, change: NaN, changePct: NaN, high: NaN, low: NaN, amount: NaN,
            ts: Date.now(), timeText: '--', market: meta.market
        };
    }

    function tryUs(meta) {
        var cands = tencentCandidates(meta.tencent);
        var i = 0;
        function next() {
            if (i >= cands.length) return Promise.resolve(null);
            var code = cands[i++];
            return U.jsonpVar(TX_REALTIME + code, ['v_' + code], { timeout: 10000 })
                .then(function (bag) {
                    var text = bag['v_' + code];
                    if (typeof text === 'string' && text.split('~').length > 30) {
                        var q = parseTencentQt(text, 'us');
                        if (q && !isNaN(q.price)) { q.tencent = code; return q; }
                    }
                    return next();
                })
                .catch(next);
        }
        return next();
    }

    // ---------------------------------------------------------
    // 东方财富实时行情（备用通道）
    // ---------------------------------------------------------
    function toEMSecid(meta) {
        if (meta.market === 'hk') return '116.' + meta.code;
        if (meta.market === 'us') return '105.' + meta.code;
        if (meta.market === 'bj') return '0.' + meta.code;
        if (meta.market === 'sh') return '1.' + meta.code;
        return '0.' + meta.code;
    }

    function realtimeEM(inputs) {
        var metas = inputs.map(normalize).filter(Boolean);
        if (!metas.length) return Promise.resolve([]);
        var secids = metas.map(toEMSecid).join(',');
        var url = EM_ULIST + '?fltt=2&invt=2&secids=' + encodeURIComponent(secids) +
            '&fields=f2,f3,f4,f5,f6,f12,f13,f14,f15,f16,f17,f18,f20,f21&_=' + Date.now();
        return U.jsonp(url, { paramName: 'cb', timeout: 15000 }).then(function (res) {
            var map = {};
            ((res.data && res.data.diff) || []).forEach(function (r) {
                map[r.f13 + '.' + r.f12] = r;
            });
            return metas.map(function (m) {
                var r = map[toEMSecid(m).split('.')[0] + '.' + m.code];
                if (!r) return null;
                return attachMeta({
                    name: r.f14, code: r.f12, price: r.f2, prevClose: r.f18, open: r.f17,
                    volume: r.f5, amount: r.f6, change: r.f4, changePct: r.f3,
                    high: r.f15, low: r.f16, turnoverRate: r.f8, ts: Date.now(), timeText: '',
                    src: 'em'
                }, m);
            });
        });
    }

    // ---------------------------------------------------------
    // K 线
    // ---------------------------------------------------------
    var PERIOD_MAP = {
        day: { key: 'day', count: 120 },
        week: { key: 'week', count: 80 },
        month: { key: 'month', count: 60 },
        m30: { key: 'm30', count: 200 },
        m60: { key: 'm60', count: 200 }
    };

    function kline(input, period, count) {
        var meta = normalize(input);
        if (!meta) return Promise.resolve([]);
        period = period || 'day';
        var conf = PERIOD_MAP[period] || PERIOD_MAP.day;
        count = count || conf.count;
        var param = meta.tencent + ',' + conf.key + ',,,' + count + ',qfq';
        var cbVar = 'kl' + Date.now();
        var url = TX_KLINE + '?_var=' + cbVar + '&param=' + encodeURIComponent(param);

        return U.jsonpVar(url, [cbVar], { timeout: 15000, charset: 'UTF-8' }).then(function (bag) {
            var payload = bag[cbVar];
            if (!payload || !payload.data) return [];
            var node = payload.data[meta.tencent] || payload.data[Object.keys(payload.data)[0]];
            if (!node) return [];
            var arr = node['qfq' + conf.key] || node[conf.key] || [];
            return arr.map(function (r) {
                // [date, open, close, high, low, volume, ...]
                return {
                    date: r[0],
                    open: parseFloat(r[1]),
                    close: parseFloat(r[2]),
                    high: parseFloat(r[3]),
                    low: parseFloat(r[4]),
                    volume: parseFloat(r[5])
                };
            }).filter(function (k) { return !isNaN(k.close); });
        }).catch(function (e) {
            throw e;
        });
    }

    // ---------------------------------------------------------
    // 分时
    // ---------------------------------------------------------
    function minute(input) {
        var meta = normalize(input);
        if (!meta) return Promise.resolve(null);
        var cbVar = 'md' + Date.now();
        var url = TX_MINUTE + '?_var=' + cbVar + '&code=' + meta.tencent;
        return U.jsonpVar(url, [cbVar], { timeout: 15000, charset: 'UTF-8' }).then(function (bag) {
            var payload = bag[cbVar];
            if (!payload || !payload.data) return null;
            var node = payload.data[meta.tencent];
            var rows = (node && node.data && node.data.data) || [];
            var prevClose = NaN;
            try { prevClose = parseFloat(node.qt[meta.tencent][4]); } catch (e) { }
            var points = [], cumAmount = 0, lastAmount = 0;
            rows.forEach(function (r) {
                var p = String(r).trim().split(/\s+/);
                if (p.length < 3) return;
                var price = parseFloat(p[1]);
                var vol = parseFloat(p[2]);                       // 累计成交量（手）
                var amt = p[3] != null ? parseFloat(p[3]) : NaN;   // 累计成交额（元）
                if (isNaN(amt)) amt = lastAmount;
                var dAmt = Math.max(0, amt - cumAmount);
                cumAmount = amt; lastAmount = amt;
                var cumVolPrev = points.length ? points[points.length - 1].vol : 0;
                var dVol = Math.max(0, vol - cumVolPrev);
                var avg = vol > 0 ? (amt / (vol * 100)) : NaN;
                points.push({
                    time: p[0].slice(0, 2) + ':' + p[0].slice(2, 4),
                    price: price,
                    avg: isNaN(avg) ? price : avg,
                    vol: vol,          // 累计量
                    dVol: dVol,        // 分钟增量
                    amount: amt,
                    dAmount: dAmt
                });
            });
            return { prevClose: prevClose, points: points, market: meta.market, date: node.data.date };
        });
    }

    // ---------------------------------------------------------
    // 搜索补全
    // ---------------------------------------------------------
    function search(keyword) {
        var kw = String(keyword || '').trim();
        if (!kw) return Promise.resolve([]);
        var url = EM_SEARCH + '?input=' + encodeURIComponent(kw) + '&type=14&token=' + EM_TOKEN +
            '&count=12&_=' + Date.now();
        return U.jsonp(url, { paramName: 'cb', timeout: 12000 }).then(function (res) {
            var data = (((res || {}).QuotationCodeTable || {}).Data) || [];
            var allowType = { '沪A': 'sh', '深A': 'sz', '京A': 'bj', '北A': 'bj', '港股': 'hk', '美股': 'us' };
            var out = [];
            data.forEach(function (d) {
                var pfx = allowType[d.SecurityTypeName];
                if (!pfx) return;
                if (pfx === 'hk') {
                    out.push({ code: 'hk' + d.Code, name: d.Name, market: 'hk', raw: d.Code, type: d.SecurityTypeName });
                } else if (pfx === 'us') {
                    out.push({ code: 'us' + d.Code, name: d.Name, market: 'us', raw: d.Code, type: '美股' });
                } else {
                    out.push({ code: pfx + d.Code, name: d.Name, market: pfx, raw: d.Code, type: d.SecurityTypeName });
                }
            });
            return out.slice(0, 12);
        }).catch(function () { return []; });
    }

    // ---------------------------------------------------------
    // 大盘：指数 / 板块 / 涨跌停
    // ---------------------------------------------------------
    var EM_INDICES = [
        { secid: '1.000001', name: '上证指数' },
        { secid: '0.399001', name: '深证成指' },
        { secid: '0.399006', name: '创业板指' },
        { secid: '1.000688', name: '科创50' },
        { secid: '1.000300', name: '沪深300' },
        { secid: '1.000016', name: '上证50' },
        { secid: '1.000852', name: '中证1000' },
        { secid: '100.HSI', name: '恒生指数' },
        { secid: '100.DJIA', name: '道琼斯' },
        { secid: '100.NDX', name: '纳斯达克' }
    ];

    function indices() {
        var secids = EM_INDICES.map(function (i) { return i.secid; }).join(',');
        var url = EM_ULIST + '?fltt=2&invt=2&secids=' + encodeURIComponent(secids) +
            '&fields=f2,f3,f4,f12,f13,f14,f15,f16&_=' + Date.now();
        return U.jsonp(url, { paramName: 'cb', timeout: 15000 }).then(function (res) {
            var map = {};
            ((res.data && res.data.diff) || []).forEach(function (r) { map[r.f13 + '.' + r.f12] = r; });
            return EM_INDICES.map(function (i) {
                var key = i.secid.split('.');
                var r = map[key[0] + '.' + key[1]];
                if (!r) return Object.assign({ missing: true }, i);
                return {
                    name: r.f14 || i.name,
                    code: r.f12,
                    price: r.f2,
                    change: r.f4,
                    changePct: r.f3,
                    high: r.f15,
                    low: r.f16
                };
            }).filter(function (x) { return !x.missing; });
        });
    }

    /** 行业板块排行：取涨跌幅前 N 与后 N */
    function sectors(topN) {
        topN = topN || 8;
        function fetchPart(direction) {
            var url = EM_CLIST + '?pn=1&pz=50&po=' + direction + '&np=1&fltt=2&invt=2&fid=f3&_=' + Date.now() +
                '&fs=' + encodeURIComponent('m:90+t:2') + '&fields=f3,f12,f14,f104,f105';
            return U.jsonp(url, { paramName: 'cb', timeout: 15000 }).catch(function () { return null; });
        }
        // po=1 降序拿涨幅榜，po=0 升序拿跌幅榜
        return Promise.all([fetchPart(1), fetchPart(0)]).then(function (pair) {
            function mapWD(res) {
                return ((res && res.data && res.data.diff) || []).map(function (r) {
                    return { code: r.f12, name: r.f14, changePct: r.f3, up: r.f104, down: r.f105 };
                });
            }
            var desc = mapWD(pair[0]);
            var asc = mapWD(pair[1]);
            return {
                leaders: desc.slice(0, topN),
                laggards: asc.slice(0, topN),
                all: desc
            };
        });
    }

    function todayStr() {
        var d = new Date();
        return '' + d.getFullYear() + U.pad(d.getMonth() + 1) + U.pad(d.getDate());
    }

    /** 涨停家数 */
    function limitUpCount(date) {
        var url = EM_ZTPOOL + '?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&Pageindex=0&pagesize=1&sort=fbt%3Aasc&date=' +
            (date || todayStr());
        return U.jsonp(url, { paramName: 'cb', timeout: 12000 }).then(function (res) {
            return (res && res.data && res.data.tc) || 0;
        }).catch(function () { return null; });
    }

    /** 跌停家数 */
    function limitDownCount(date) {
        var url = EM_DTPOOL + '?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztgt&Pageindex=0&pagesize=1&sort=fund%3Aasc&date=' +
            (date || todayStr());
        return U.jsonp(url, { paramName: 'cb', timeout: 12000 }).then(function (res) {
            return (res && res.data && res.data.tc) || 0;
        }).catch(function () { return null; });
    }

    // ---------------------------------------------------------
    // 技术指标
    // ---------------------------------------------------------
    function ma(list, n, field) {
        var out = [];
        var key = field || 'close';
        for (var i = 0; i < list.length; i++) {
            if (i < n - 1) { out.push(null); continue; }
            var s = 0;
            for (var j = i - n + 1; j <= i; j++) s += list[j][key];
            out.push(s / n);
        }
        return out;
    }

    /** MACD (12,26,9) */
    function macd(list) {
        function ema(arr, n) {
            var k = 2 / (n + 1), res = [], prev = null;
            arr.forEach(function (v, i) {
                prev = prev == null ? v : v * k + prev * (1 - k);
                res.push(prev);
            });
            return res;
        }
        var closes = list.map(function (k) { return k.close; });
        var e12 = ema(closes, 12), e26 = ema(closes, 26);
        var dif = closes.map(function (_, i) { return e12[i] - e26[i]; });
        var dea = ema(dif, 9);
        var macdBar = dif.map(function (v, i) { return (v - dea[i]) * 2; });
        return { dif: dif, dea: dea, macd: macdBar };
    }

    /** KDJ(9,3,3) */
    function kdj(list, n) {
        n = n || 9;
        var k = 50, d = 50, outK = [], outD = [], outJ = [];
        for (var i = 0; i < list.length; i++) {
            var start = Math.max(0, i - n + 1);
            var high = -Infinity, low = Infinity;
            for (var j = start; j <= i; j++) {
                if (list[j].high > high) high = list[j].high;
                if (list[j].low < low) low = list[j].low;
            }
            var rsv = (high - low) === 0 ? 50 : (list[i].close - low) / (high - low) * 100;
            k = (2 / 3) * k + (1 / 3) * rsv;
            d = (2 / 3) * d + (1 / 3) * k;
            outK.push(k); outD.push(d); outJ.push(3 * k - 2 * d);
        }
        return { k: outK, d: outD, j: outJ };
    }

    /** RSI(14) */
    function rsi(list, n) {
        n = n || 14;
        var out = [], up = 0, down = 0;
        for (var i = 0; i < list.length; i++) {
            if (i === 0) { out.push(null); continue; }
            var diff = list[i].close - list[i - 1].close;
            var gain = Math.max(diff, 0), loss = Math.max(-diff, 0);
            if (i <= n) {
                up += gain; down += loss;
                if (i === n) { out.push(down === 0 ? 100 : 100 - 100 / (1 + up / down)); }
                else out.push(null);
                continue;
            }
            up = (up * (n - 1) + gain) / n;
            down = (down * (n - 1) + loss) / n;
            out.push(down === 0 ? 100 : 100 - 100 / (1 + up / down));
        }
        return out;
    }

    /** 生成给 LLM 的技术面摘要 */
    function technicalSummary(list) {
        if (!list || list.length < 20) return null;
        var last = list[list.length - 1];
        var ma5 = ma(list, 5), ma10 = ma(list, 10), ma20 = ma(list, 20), ma60 = ma(list, 60);
        var i = list.length - 1;
        var m = macd(list);
        var kd = kdj(list);
        var prevVol = list.slice(-6, -1).reduce(function (s, x) { return s + x.volume; }, 0) / 5;
        return {
            last: last.date,
            close: last.close,
            open: last.open,
            high: last.high,
            low: last.low,
            ma5: ma5[i], ma10: ma10[i], ma20: ma20[i], ma60: ma60[i],
            bias5: ((last.close - ma5[i]) / ma5[i] * 100),
            volumeRatioPrev5: prevVol > 0 ? last.volume / prevVol : NaN,
            high20: Math.max.apply(null, list.slice(-20).map(function (x) { return x.high; })),
            low20: Math.min.apply(null, list.slice(-20).map(function (x) { return x.low; })),
            macdDif: m.dif[i], macdDea: m.dea[i], macdBar: m.macd[i],
            kdjK: kd.k[i], kdjD: kd.d[i], kdjJ: kd.j[i],
            recent10: list.slice(-10).map(function (x) {
                return x.date + ' O' + x.open.toFixed(2) + ' H' + x.high.toFixed(2) +
                    ' L' + x.low.toFixed(2) + ' C' + x.close.toFixed(2) + ' V' + Math.round(x.volume);
            })
        };
    }

    DSA.quote = {
        normalize: normalize,
        marketOf: marketOf,
        realtime: realtime,
        kline: kline,
        minute: minute,
        search: search,
        indices: indices,
        sectors: sectors,
        limitUpCount: limitUpCount,
        limitDownCount: limitDownCount,
        EM_INDICES: EM_INDICES,
        ma: ma, macd: macd, kdj: kdj, rsi: rsi,
        technicalSummary: technicalSummary,
        tencentCandidates: tencentCandidates
    };
})(window);
