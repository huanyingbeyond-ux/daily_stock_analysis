/* ============================================================
 * DSA Mobile - server.js
 * 服务器模式：连接上游 daily_stock_analysis 的 FastAPI 服务
 * 目标地址形如 http://192.168.1.20:8000（电脑上 python main.py --webui）
 * ============================================================ */
(function (root) {
    'use strict';

    var DSA = root.DSA = root.DSA || {};
    var U = DSA.util;

    var BASE = '/api/v1';

    function enabled() {
        var st = DSA.store.get();
        return st.mode === 'server' && !!st.serverBase;
    }

    /** 健康检查：返回 {ok, detail} */
    function ping(baseOverride) {
        var st = DSA.store.get();
        var base = baseOverride || U.http && DSA.store.serverBase();
        if (!base) return Promise.resolve({ ok: false, detail: '未填写服务器地址' });
        var url = base.replace(/\/+$/, '') + BASE + '/health';
        var old = DSA.store.get().serverBase;
        if (baseOverride) DSA.store.set({ serverBase: base });
        return U.http(BASE + '/health', { timeout: 8000 })
            .then(function (res) {
                if (baseOverride) DSA.store.set({ serverBase: old });
                return { ok: true, detail: (res && res.status) || 'ok' };
            })
            .catch(function (err) {
                if (baseOverride) DSA.store.set({ serverBase: old });
                return { ok: false, detail: err.message };
            });
    }

    /**
     * 触发分析。服务器模式下分析在服务端执行，这里只负责下发与轮询。
     * @param {string[]} codes
     * @param {object} opts {async, reportType, phase}
     */
    function analyze(codes, opts) {
        opts = opts || {};
        var payload = {
            stock_codes: codes,
            report_type: opts.reportType || DSA.store.get().reportType || 'detailed',
            async_mode: opts.async !== false,
            notify: false
        };
        if (opts.phase) payload.analysis_phase = opts.phase;
        return U.http(BASE + '/analysis/analyze', { method: 'POST', body: payload });
    }

    function analyzeOne(code, opts) {
        return analyze([code], opts);
    }

    /** 任务状态 */
    function taskStatus(taskId) {
        return U.http(BASE + '/analysis/status/' + encodeURIComponent(taskId));
    }

    /** 任务列表 */
    function tasks(status, limit) {
        var qs = [];
        if (status) qs.push('status=' + encodeURIComponent(status));
        qs.push('limit=' + (limit || 20));
        return U.http(BASE + '/analysis/tasks?' + qs.join('&'));
    }

    /** 触发大盘复盘（服务端执行） */
    function marketReview(payload) {
        return U.http(BASE + '/analysis/market-review', {
            method: 'POST',
            body: Object.assign({ send_notification: false }, payload || {})
        });
    }

    /** 自选股（服务端） */
    function watchlist() { return U.http(BASE + '/stocks/watchlist'); }
    function watchlistAdd(codes) {
        return U.http(BASE + '/stocks/watchlist/add', { method: 'POST', body: { codes: codes } });
    }
    function watchlistRemove(codes) {
        return U.http(BASE + '/stocks/watchlist/remove', { method: 'POST', body: { codes: codes } });
    }

    /** 历史报告（可选，失败不影响主流程） */
    function historyByCode(code, limit) {
        return U.http(BASE + '/history/by-code/' + encodeURIComponent(code) + '?limit=' + (limit || 10));
    }

    /**
     * 轮询任务直到终态
     * @param {string} taskId
     * @param {function} onUpdate
     */
    function waitTask(taskId, onUpdate, timeoutMs) {
        timeoutMs = timeoutMs || 10 * 60 * 1000;
        var deadline = Date.now() + timeoutMs;
        function step() {
            return taskStatus(taskId).then(function (st) {
                var status = st.status || st.state || '';
                if (onUpdate) onUpdate(st, status);
                var done = ['completed', 'failed', 'cancelled'].indexOf(status) >= 0;
                if (done) return st;
                if (Date.now() > deadline) throw new Error('任务超时未完成');
                return U.sleep(2500).then(step);
            });
        }
        return step();
    }

    /**
     * 把服务端返回的任务结果规整成手机端统一报告结构
     */
    function normalizeServerResult(raw) {
        if (!raw) return null;
        var rep = raw.report || raw.result || raw;
        var body = rep.dashboard ? rep : (rep.summary && rep.summary.dashboard ? rep.summary : null) || rep;
        if (!body) return null;
        var flat = Object.assign({}, rep, {
            sentiment_score: body.sentiment_score != null ? body.sentiment_score : (rep.summary || {}).sentiment_score,
            dashboard: body.dashboard || (rep.summary || {}).dashboard || body
        });
        var out = Object.assign({}, flat);
        out._ctx = {
            code: raw.stock_code || '',
            name: raw.stock_name || flat.stock_name || '',
            market: 'cn',
            quote: {},
            ts: raw.created_at ? new Date(raw.created_at).getTime() : Date.now(),
            server: true
        };
        out.signal = DSA.analyzer.resolveSignal(out);
        return out;
    }

    DSA.server = {
        enabled: enabled,
        ping: ping,
        analyze: analyze,
        analyzeOne: analyzeOne,
        taskStatus: taskStatus,
        tasks: tasks,
        waitTask: waitTask,
        marketReview: marketReview,
        watchlist: watchlist,
        watchlistAdd: watchlistAdd,
        watchlistRemove: watchlistRemove,
        historyByCode: historyByCode,
        normalizeServerResult: normalizeServerResult
    };
})(window);
