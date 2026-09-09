/* ============================================================
 * DSA Mobile - chart.js
 * 零依赖 Canvas 图表：K线（蜡烛+均线+成交量/MACD）与分时（价格+均价+量）
 * 支持触摸拖动平移、双指缩放、长按十字光标。
 * ============================================================ */
(function (root) {
    'use strict';

    var DSA = root.DSA = root.DSA || {};

    var COLOR = {
        light: {
            up: '#e03131', down: '#0ca678', flat: '#868e96',
            grid: '#eceff3', axis: '#98a2ad', text: '#5c6470',
            ma5: '#f08c00', ma10: '#1c7ed6', ma20: '#ae3ec9', avg: '#f08c00',
            line: '#adb5bd', cross: '#495057', period: 'rgba(73,80,87,0.10)'
        },
        dark: {
            up: '#ff6b6b', down: '#38d9a9', flat: '#868e96',
            grid: '#22262e', axis: '#5c6470', text: '#98a2ad',
            ma5: '#ffc078', ma10: '#74c0fc', ma20: '#da77f2', avg: '#ffc078',
            line: '#495057', cross: '#dee2e6', period: 'rgba(222,226,230,0.10)'
        }
    };

    function palette() {
        var theme = document.documentElement.getAttribute('data-theme');
        return theme === 'dark' ? COLOR.dark : COLOR.light;
    }

    function setupCanvas(canvas, height) {
        var dpr = root.devicePixelRatio || 1;
        var w = canvas.clientWidth || canvas.parentNode.clientWidth || 320;
        var h = height || canvas.clientHeight || 220;
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';
        var ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        return { ctx: ctx, w: w, h: h };
    }

    function niceStep(range, count) {
        var step = range / count;
        var mag = Math.pow(10, Math.floor(Math.log(step) / Math.LN10));
        var norm = step / mag;
        if (norm < 1.5) return mag;
        if (norm < 3) return mag * 2;
        if (norm < 7) return mag * 5;
        return mag * 10;
    }

    // ==========================================================
    // K 线图
    // ==========================================================
    function klineChart(canvas, data, opts) {
        opts = opts || {};
        var PAD = { l: 6, r: 54, t: 10, b: 16 };
        var subRatio = 0.24;
        var state = {
            data: data || [],
            end: (data || []).length,       // 右端索引（不含）
            span: Math.min(opts.span || 60, (data || []).length),
            sub: opts.sub || 'volume',      // volume | macd
            cursor: null,
            onChange: opts.onChange || function () { }
        };
        var macdData = null;
        var destroyed = false;

        function visible() {
            var start = Math.max(0, state.end - state.span);
            return state.data.slice(start, state.end);
        }

        function render(height) {
            if (destroyed) return;
            var list = visible();
            var surface = setupCanvas(canvas, height || opts.height || 240);
            var ctx = surface.ctx, W = surface.w, H = surface.h;
            var c = palette();
            if (!list.length) {
                ctx.fillStyle = c.text;
                ctx.font = '12px system-ui, sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('暂无K线数据', W / 2, H / 2);
                return;
            }

            var mainH = (H - PAD.t - PAD.b - 10) * (1 - subRatio);
            var mainTop = PAD.t;
            var mainBottom = PAD.t + mainH;
            var subTop = mainBottom + 10;
            var subBottom = H - PAD.b;
            var plotW = W - PAD.l - PAD.r;

            // 价格极值
            var hi = -Infinity, lo = Infinity;
            list.forEach(function (k) {
                if (k.high > hi) hi = k.high;
                if (k.low < lo) lo = k.low;
            });
            var ma5 = DSA.quote.ma(state.data, 5);
            var ma10 = DSA.quote.ma(state.data, 10);
            var ma20 = DSA.quote.ma(state.data, 20);
            var startIdx = state.end - list.length;
            [ma5, ma10, ma20].forEach(function (series) {
                for (var i = startIdx; i < state.end; i++) {
                    var v = series[i];
                    if (v == null || isNaN(v)) continue;
                    if (v > hi) hi = v;
                    if (v < lo) lo = v;
                }
            });
            var pad = (hi - lo) * 0.06 || Math.abs(hi) * 0.01 || 1;
            hi += pad; lo -= pad;

            function priceY(p) { return mainBottom - (p - lo) / (hi - lo) * mainH; }
            function idxX(i) {
                var n = list.length;
                var candleW = Math.max(1.2, Math.min(plotW / n * 0.68, 14));
                return PAD.l + (i + 0.5) * (plotW / n);
            }

            var maxVol = 0;
            list.forEach(function (k) { if (k.volume > maxVol) maxVol = k.volume; });

            if (state.sub === 'macd' && !macdData) macdData = DSA.quote.macd(state.data);

            // 网格与右侧价格刻度
            ctx.strokeStyle = c.grid;
            ctx.fillStyle = c.text;
            ctx.lineWidth = 1;
            ctx.font = '10px system-ui, sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            var steps = 4;
            var step = niceStep(hi - lo, steps);
            var startTick = Math.ceil(lo / step) * step;
            for (var p = startTick; p <= hi; p += step) {
                var y = priceY(p);
                if (y < mainTop || y > mainBottom) continue;
                ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(W - PAD.r, y); ctx.stroke();
                ctx.fillText(p.toFixed(2), W - PAD.r + 4, y);
            }

            // 零轴（副图）
            if (state.sub === 'macd') {
                var mSlice = { dif: [], dea: [], macd: [] };
                for (var mi = startIdx; mi < state.end; mi++) {
                    mSlice.dif.push(macdData.dif[mi]);
                    mSlice.dea.push(macdData.dea[mi]);
                    mSlice.macd.push(macdData.macd[mi]);
                }
                var mAmp = Math.max.apply(null, mSlice.dif.concat(mSlice.dea, mSlice.macd).map(Math.abs)) || 1;
                function macdY(v) { return (subTop + subBottom) / 2 - v / mAmp * ((subBottom - subTop) / 2) * 0.9; }
                var zeroY = macdY(0);
                ctx.strokeStyle = c.line;
                ctx.beginPath(); ctx.moveTo(PAD.l, zeroY); ctx.lineTo(W - PAD.r, zeroY); ctx.stroke();
                // MACD 柱
                var bw = Math.max(1.2, Math.min(plotW / list.length * 0.6, 10));
                mSlice.macd.forEach(function (v, i) {
                    var x = idxX(i);
                    ctx.fillStyle = v >= 0 ? c.up : c.down;
                    var y0 = macdY(0), y1 = macdY(v);
                    ctx.fillRect(x - bw / 2, Math.min(y0, y1), bw, Math.max(1, Math.abs(y1 - y0)));
                });
                ctx.lineWidth = 1;
                drawLine(ctx, mSlice.dif.map(function (v, i) { return [idxX(i), macdY(v)]; }), c.ma5);
                drawLine(ctx, mSlice.dea.map(function (v, i) { return [idxX(i), macdY(v)]; }), c.ma10);
            } else {
                // 成交量
                var volMax = maxVol * 1.1 || 1;
                list.forEach(function (k, i) {
                    var x = idxX(i);
                    var bw = Math.max(1.2, Math.min(plotW / list.length * 0.62, 12));
                    var hgt = k.volume / volMax * (subBottom - subTop);
                    var up = k.close >= k.open;
                    ctx.fillStyle = up ? c.up : c.down;
                    ctx.fillRect(x - bw / 2, subBottom - hgt, bw, Math.max(1, hgt));
                });
                ctx.fillStyle = c.text;
                ctx.font = '10px system-ui, sans-serif';
                ctx.fillText(shortVol(maxVol), W - PAD.r + 4, subTop + 4);
            }

            // 蜡烛
            var bodyW = Math.max(1.4, Math.min(plotW / list.length * 0.62, 12));
            list.forEach(function (k, i) {
                var x = idxX(i);
                var up = k.close >= k.open;
                var col = up ? c.up : c.down;
                ctx.strokeStyle = col;
                ctx.fillStyle = col;
                ctx.lineWidth = 1;
                var yH = priceY(k.high), yL = priceY(k.low);
                ctx.beginPath(); ctx.moveTo(x, yH); ctx.lineTo(x, yL); ctx.stroke();
                var yO = priceY(k.open), yC = priceY(k.close);
                var top = Math.min(yO, yC);
                var bodyH = Math.max(1, Math.abs(yC - yO));
                if (up) {
                    ctx.fillRect(x - bodyW / 2, top, bodyW, bodyH);
                } else {
                    ctx.fillRect(x - bodyW / 2, top, bodyW, bodyH);
                }
            });

            // 均线
            drawMa(ctx, ma5, startIdx, state.end, idxX, priceY, c.ma5);
            drawMa(ctx, ma10, startIdx, state.end, idxX, priceY, c.ma10);
            drawMa(ctx, ma20, startIdx, state.end, idxX, priceY, c.ma20);

            // 底部日期
            ctx.fillStyle = c.text;
            ctx.font = '10px system-ui, sans-serif';
            ctx.textBaseline = 'bottom';
            ctx.textAlign = 'left';
            ctx.fillText(list[0].date, PAD.l, H - 2);
            ctx.textAlign = 'right';
            ctx.fillText(list[list.length - 1].date, W - PAD.r, H - 2);

            // 图例
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.font = '10px system-ui, sans-serif';
            var lx = PAD.l + 2, ly = PAD.t + 2;
            [['MA5', c.ma5], ['MA10', c.ma10], ['MA20', c.ma20]].forEach(function (pair) {
                ctx.fillStyle = pair[1];
                ctx.fillText(pair[0], lx, ly);
                lx += ctx.measureText(pair[0]).width + 8;
            });

            // 十字光标
            if (state.cursor) drawCross(ctx, {
                W: W, H: H, PAD: PAD, mainTop: mainTop, mainBottom: mainBottom,
                subTop: subTop, subBottom: subBottom, list: list, idxX: idxX, priceY: priceY,
                ma5: ma5, ma10: ma10, ma20: ma20, startIdx: startIdx, c: c
            });
        }

        function drawMa(ctx, series, startIdx, endIdx, idxX, priceY, color) {
            var pts = [];
            for (var i = startIdx; i < endIdx; i++) {
                var v = series[i];
                if (v == null || isNaN(v)) continue;
                pts.push([idxX(i - startIdx), priceY(v)]);
            }
            drawLine(ctx, pts, color);
        }

        function drawCross(ctx, s) {
            var ci = Math.max(0, Math.min(s.list.length - 1, Math.round(state.cursor.x / ((s.W - s.PAD.l - s.PAD.r) / s.list.length) - 0.5)));
            var k = s.list[ci];
            if (!k) return;
            var x = s.idxX(ci);
            var up = k.close >= k.open;
            var col = up ? s.c.up : s.c.down;
            // 竖线
            ctx.save();
            ctx.strokeStyle = s.c.cross;
            ctx.setLineDash([3, 3]);
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(x, s.mainTop); ctx.lineTo(x, s.H - s.PAD.b); ctx.stroke();
            // 横线
            var y = s.priceY(k.close);
            ctx.beginPath(); ctx.moveTo(s.PAD.l, y); ctx.lineTo(s.W - s.PAD.r, y); ctx.stroke();
            ctx.restore();
            // 价格标签
            ctx.fillStyle = s.c.cross;
            ctx.fillRect(s.W - s.PAD.r, y - 8, s.PAD.r, 16);
            ctx.fillStyle = '#fff';
            ctx.font = '10px system-ui, sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(k.close.toFixed(2), s.W - s.PAD.r + 3, y);
            // 浮动信息卡
            var lines = [
                s.list[ci].date,
                '开 ' + k.open.toFixed(2) + '  高 ' + k.high.toFixed(2),
                '收 ' + k.close.toFixed(2) + '  低 ' + k.low.toFixed(2),
                '涨跌 ' + (((k.close - s.list[Math.max(0, ci - 1)].close) / s.list[Math.max(0, ci - 1)].close) * 100).toFixed(2) + '%',
                '量 ' + shortVol(k.volume)
            ];
            ctx.fillStyle = s.c.period;
            var gi = s.startIdx + ci;
            var ma5v = s.ma5[gi], ma10v = s.ma10[gi], ma20v = s.ma20[gi];
            var boxW = 128, boxH = lines.length * 14 + (ma5v ? 14 : 0) + 8;
            var bx = Math.min(x + 8, s.W - s.PAD.r - boxW - 4);
            var by = Math.max(s.mainTop, Math.min(y - boxH / 2, s.mainBottom - boxH));
            ctx.setLineDash([]);
            ctx.fillStyle = s.c.period === 'rgba(73,80,87,0.10)' ? 'rgba(255,255,255,0.94)' : 'rgba(28,30,34,0.94)';
            ctx.fillRect(bx, by, boxW, boxH);
            ctx.fillStyle = s.c.text;
            ctx.font = '10px system-ui, sans-serif';
            ctx.textBaseline = 'top';
            lines.forEach(function (t, i) {
                ctx.fillStyle = i === 2 ? (up ? s.c.up : s.c.down) : s.c.text;
                ctx.fillText(t, bx + 6, by + 5 + i * 14);
            });
            if (ma5v) {
                ctx.fillStyle = s.c.text;
                ctx.fillText('MA5 ' + ma5v.toFixed(2) + '  MA10 ' + (ma10v || 0).toFixed(2) + '  MA20 ' + (ma20v || 0).toFixed(2), bx + 6, by + 5 + lines.length * 14);
            }
        }

        function drawLine(ctx, pts, color) {
            if (pts.length < 2) return;
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.beginPath();
            pts.forEach(function (p, i) { i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); });
            ctx.stroke();
        }

        function shortVol(v) {
            if (!v || isNaN(v)) return '--';
            if (v >= 1e8) return (v / 1e8).toFixed(2) + '亿';
            if (v >= 1e4) return (v / 1e4).toFixed(2) + '万';
            return Math.round(v) + '';
        }

        // ---- 交互 ----
        var drag = null, pinch = null;
        function onDown(e) { drag = { x: touchX(e), y: touchY(e), end: state.end, moved: false }; clearCursor(); }
        function onMove(e) {
            if (!drag) return;
            var dx = touchX(e) - drag.x;
            if (Math.abs(dx) > 3) drag.moved = true;
            var perBar = (canvas.clientWidth - PAD.l - PAD.r) / state.span;
            var shift = Math.round(-dx / perBar);
            var newEnd = Math.max(state.span, Math.min(state.data.length, drag.end + shift));
            if (newEnd !== state.end) { state.end = newEnd; render(); }
        }
        function onUp() {
            if (drag && !drag.moved) setCursor(drag.x, drag.y);
            drag = null;
        }
        function setCursor(x, y) { state.cursor = { x: x, y: y }; render(); state.onChange && state.onChange(visible(), state.cursor); }
        function clearCursor() { if (state.cursor) { state.cursor = null; render(); } }

        function touchX(e) { return e.touches ? e.touches[0].clientX : e.clientX; }
        function touchY(e) { return e.touches ? e.touches[0].clientY : e.clientY; }

        function onWheel(e) {
            e.preventDefault();
            zoom(e.deltaY > 0 ? 1.1 : 0.9);
        }
        function zoom(factor) {
            var next = Math.round(state.span * factor);
            next = Math.max(15, Math.min(state.data.length, next));
            state.end = Math.min(state.data.length, Math.max(next, state.end));
            state.span = next;
            render();
        }

        canvas.addEventListener('touchstart', function (e) {
            if (e.touches.length === 2) {
                pinch = { d: dist(e.touches), span: state.span };
                drag = null;
                return;
            }
            onDown(e);
        }, { passive: true });
        canvas.addEventListener('touchmove', function (e) {
            if (pinch && e.touches.length === 2) {
                var d = dist(e.touches);
                var next = Math.round(pinch.span * (pinch.d / d));
                state.span = Math.max(15, Math.min(state.data.length, next));
                render();
                e.preventDefault();
                return;
            }
            onMove(e);
        }, { passive: false });
        canvas.addEventListener('touchend', function (e) {
            if (pinch) { pinch = null; return; }
            onUp(e);
        });
        canvas.addEventListener('mousedown', onDown);
        canvas.addEventListener('mousemove', function (e) { if (drag) onMove(e); });
        canvas.addEventListener('mouseup', onUp);
        canvas.addEventListener('mouseleave', function () { drag = null; });
        canvas.addEventListener('wheel', onWheel, { passive: false });

        function dist(t) {
            var dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY;
            return Math.sqrt(dx * dx + dy * dy) || 1;
        }

        render(opts.height);
        return {
            render: render,
            setData: function (d) { state.data = d; state.end = d.length; macdData = null; render(); },
            setSub: function (s) { state.sub = s; if (s === 'macd') macdData = DSA.quote.macd(state.data); render(); },
            zoom: zoom,
            destroy: function () { destroyed = true; }
        };
    }

    // ==========================================================
    // 分时图
    // ==========================================================
    function minuteChart(canvas, data, opts) {
        opts = opts || {};
        var PAD = { l: 6, r: 54, t: 10, b: 16 };
        var state = { cursor: null };
        var destroyed = false;

        function render(height) {
            if (destroyed) return;
            var surface = setupCanvas(canvas, height || opts.height || 200);
            var ctx = surface.ctx, W = surface.w, H = surface.h;
            var c = palette();
            var pts = (data && data.points) || [];
            if (!pts.length) {
                ctx.fillStyle = c.text;
                ctx.font = '12px system-ui, sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('暂无分时数据', W / 2, H / 2);
                return;
            }
            var mainH = (H - PAD.t - PAD.b - 10) * 0.76;
            var mainTop = PAD.t, mainBottom = PAD.t + mainH;
            var subTop = mainBottom + 10, subBottom = H - PAD.b;
            var plotW = W - PAD.l - PAD.r;
            var prevClose = data.prevClose;

            var hi = -Infinity, lo = Infinity;
            pts.forEach(function (p) {
                if (p.price > hi) hi = p.price;
                if (p.price < lo) lo = p.price;
                if (p.avg > hi) hi = p.avg;
                if (p.avg < lo) lo = p.avg;
            });
            if (isFinite(prevClose)) { hi = Math.max(hi, prevClose); lo = Math.min(lo, prevClose); }
            var base = Math.max(Math.abs(hi - prevClose || 0), Math.abs(prevClose - lo || 0));
            var amp = Math.max(base, (hi - lo) / 2) * 1.08 || Math.abs(prevClose) * 0.02;
            var top = prevClose + amp, bottom = prevClose - amp;

            function priceY(p) { return mainBottom - (p - bottom) / (top - bottom) * mainH; }
            function idxX(i) { return PAD.l + i * (plotW / Math.max(1, pts.length - 1)); }

            // 网格
            ctx.strokeStyle = c.grid;
            ctx.fillStyle = c.text;
            ctx.font = '10px system-ui, sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            var step = niceStep(top - bottom, 4);
            var tk = Math.ceil(bottom / step) * step;
            for (var p2 = tk; p2 <= top; p2 += step) {
                var y = priceY(p2);
                if (y < mainTop || y > mainBottom) continue;
                ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(W - PAD.r, y); ctx.stroke();
                var pctVal = prevClose ? ((p2 - prevClose) / prevClose * 100) : 0;
                ctx.fillStyle = Math.abs(pctVal) < 0.001 ? c.flat : (pctVal > 0 ? c.up : c.down);
                ctx.fillText(p2.toFixed(2), W - PAD.r + 4, y - 5);
                ctx.fillStyle = c.axis;
                ctx.fillText(pctVal.toFixed(2) + '%', W - PAD.r + 4, y + 6);
            }
            // 昨收中轴
            ctx.save();
            ctx.strokeStyle = c.line;
            ctx.setLineDash([4, 3]);
            var yPrev = priceY(prevClose);
            ctx.beginPath(); ctx.moveTo(PAD.l, yPrev); ctx.lineTo(W - PAD.r, yPrev); ctx.stroke();
            ctx.restore();

            // 成交量柱
            var volMax = 0;
            pts.forEach(function (p) { if (p.dVol > volMax) volMax = p.dVol; });
            volMax = volMax * 1.2 || 1;
            var lastNextPrice = prevClose;
            pts.forEach(function (p, i) {
                var x = idxX(i);
                var bw = Math.max(1, plotW / pts.length * 0.7);
                var hgt = (p.dVol || 0) / volMax * (subBottom - subTop);
                ctx.fillStyle = p.price >= (i ? pts[i - 1].price : prevClose) ? c.up : c.down;
                ctx.fillRect(x - bw / 2, subBottom - Math.max(1, hgt), bw, Math.max(1, hgt));
            });

            // 价格面积 + 线
            var last = pts[pts.length - 1];
            var lineColor = last.price >= prevClose ? c.up : c.down;
            ctx.beginPath();
            pts.forEach(function (p, i) {
                var x = idxX(i), y = priceY(p.price);
                i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
            });
            ctx.strokeStyle = lineColor;
            ctx.lineWidth = 1.2;
            ctx.stroke();
            ctx.lineTo(idxX(pts.length - 1), mainBottom);
            ctx.lineTo(idxX(0), mainBottom);
            ctx.closePath();
            ctx.fillStyle = hexToRgba(lineColor, 0.10);
            ctx.fill();

            // 均价线
            ctx.beginPath();
            pts.forEach(function (p, i) {
                var x = idxX(i), y = priceY(p.avg);
                i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
            });
            ctx.strokeStyle = c.avg;
            ctx.lineWidth = 1;
            ctx.stroke();

            // 时间刻度
            ctx.fillStyle = c.text;
            ctx.font = '10px system-ui, sans-serif';
            ctx.textBaseline = 'bottom';
            ctx.textAlign = 'left';
            ctx.fillText(pts[0].time, PAD.l, H - 2);
            if (data.market === 'cn' || data.market === 'bj') {
                ctx.textAlign = 'center';
                ctx.fillText('11:30/13:00', PAD.l + plotW / 2, H - 2);
            }
            ctx.textAlign = 'right';
            ctx.fillText(pts[pts.length - 1].time, W - PAD.r, H - 2);

            // 图例
            ctx.textAlign = 'left'; ctx.textBaseline = 'top';
            ctx.fillStyle = c.avg;
            ctx.fillText('均价', PAD.l + 2, PAD.t + 2);
            ctx.fillStyle = lineColor;
            ctx.fillText('价格', PAD.l + 30, PAD.t + 2);

            if (state.cursor) {
                var ci = Math.max(0, Math.min(pts.length - 1, Math.round(state.cursor.x / (plotW / Math.max(1, pts.length - 1)))));
                var pt = pts[ci];
                var x = idxX(ci), y = priceY(pt.price);
                ctx.save();
                ctx.strokeStyle = c.cross;
                ctx.setLineDash([3, 3]);
                ctx.beginPath(); ctx.moveTo(x, mainTop); ctx.lineTo(x, H - PAD.b); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(W - PAD.r, y); ctx.stroke();
                ctx.restore();
                ctx.fillStyle = c.cross;
                ctx.fillRect(surfRight(W, PAD), y - 8, PAD.r, 16);
                ctx.fillStyle = '#fff';
                ctx.textBaseline = 'middle';
                ctx.fillText(pt.price.toFixed(2), surfRight(W, PAD) + 3, y);
                ctx.fillStyle = c.text;
                ctx.textBaseline = 'top';
                var txt = pt.time + '  价 ' + pt.price.toFixed(2) + '  均 ' + pt.avg.toFixed(2);
                ctx.fillText(txt, Math.max(PAD.l, Math.min(x + 6, W - PAD.r - 130)), PAD.t + 14);
            }
        }

        function surfRight(W, PAD) { return W - PAD.r; }

        function hexToRgba(hex, a) {
            var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
            if (!m) return hex;
            return 'rgba(' + parseInt(m[1], 16) + ',' + parseInt(m[2], 16) + ',' + parseInt(m[3], 16) + ',' + a + ')';
        }

        var dragPt = null;
        canvas.addEventListener('touchstart', function (e) {
            dragPt = { x: e.touches[0].clientX - canvas.getBoundingClientRect().left, moved: false };
        }, { passive: true });
        canvas.addEventListener('touchmove', function (e) {
            if (!dragPt) return;
            dragPt.moved = true;
            state.cursor = { x: e.touches[0].clientX - canvas.getBoundingClientRect().left };
            render();
        }, { passive: true });
        canvas.addEventListener('touchend', function () {
            if (dragPt && !dragPt.moved) state.cursor = { x: dragPt.x };
            dragPt = null;
            render();
        });
        canvas.addEventListener('mousemove', function (e) {
            state.cursor = { x: e.clientX - canvas.getBoundingClientRect().left };
            render();
        });
        canvas.addEventListener('mouseleave', function () { state.cursor = null; render(); });

        render(opts.height);
        return { render: render, destroy: function () { destroyed = true; } };
    }

    DSA.chart = { kline: klineChart, minute: minuteChart, palette: palette };
})(window);
