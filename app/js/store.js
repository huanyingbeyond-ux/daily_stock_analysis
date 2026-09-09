/* ============================================================
 * DSA Mobile - store.js
 * 本地配置 / 自选股 / 报告缓存（localStorage）
 * ============================================================ */
(function (root) {
    'use strict';

    var DSA = root.DSA = root.DSA || {};
    var U = DSA.util;

    var KEY_CFG = 'dsa.config.v1';
    var KEY_WL = 'dsa.watchlist.v1';
    var KEY_REPORT = 'dsa.report.v1';   // { 'sh600519': {ts, data} }
    var KEY_TASK = 'dsa.tasks.v1';

    var LLM_PRESETS = {
        deepseek: { label: 'DeepSeek', provider: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
        openai: { label: 'OpenAI', provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
        qwen: { label: '通义千问', provider: 'openai', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
        moonshot: { label: 'Moonshot Kimi', provider: 'openai', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-32k' },
        doubao: { label: '火山方舟豆包', provider: 'openai', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-pro-32k' },
        aihubmix: { label: 'AIHubMix', provider: 'openai', baseUrl: 'https://aihubmix.com/v1', model: 'gpt-4o-mini' },
        anspire: { label: 'Anspire', provider: 'openai', baseUrl: 'https://api.anspire.cn/v1', model: 'gpt-4o-mini' },
        gemini: { label: 'Google Gemini', provider: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.0-flash' },
        anthropic: { label: 'Anthropic Claude', provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-3-5-sonnet-latest' },
        ollama: { label: 'Ollama 本地', provider: 'openai', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:7b' },
        custom: { label: '自定义 OpenAI 兼容', provider: 'openai', baseUrl: '', model: '' }
    };

    var DEFAULT_WATCHLIST = [
        { code: 'sh688525', name: '长鑫科技' },
        { code: 'sz301189', name: '奥尼电子' },
        { code: 'sh688215', name: '瑞晟智能' },
        { code: 'sh688155', name: '先惠技术' },
        { code: 'bj833284', name: '灵鸽科技' }
    ];

    var DEFAULTS = {
        mode: 'direct',                 // direct | server
        serverBase: '',
        serverToken: '',
        llm: {
            preset: 'deepseek',
            label: 'DeepSeek',
            provider: 'openai',
            baseUrl: 'https://api.deepseek.com/v1',
            apiKey: '',
            model: 'deepseek-chat',
            temperature: 0.3
        },
        searchEnabled: false,
        searchProvider: 'tavily',       // tavily | bocha
        searchKey: '',
        theme: 'light',                 // light | dark
        reportType: 'detailed',         // detailed | brief
        autoRefresh: true,
        refreshSec: 15,
        klinePeriod: 'day'
    };

    var cfg = loadCfg();

    function loadCfg() {
        var c = U.LS.get(KEY_CFG, {});
        var merged = JSON.parse(JSON.stringify(DEFAULTS));
        Object.keys(c).forEach(function (k) {
            if (k === 'llm') merged.llm = Object.assign(merged.llm, c.llm || {});
            else merged[k] = c[k];
        });
        return merged;
    }

    function save() { U.LS.set(KEY_CFG, cfg); }
    function serverBase() { return (cfg.serverBase || '').replace(/\/+$/, ''); }
    function set(patch) { Object.assign(cfg, patch); save(); }
    function llmReady() { return !!(cfg.llm && cfg.llm.apiKey && cfg.llm.model); }

    // ---------------------------------------------------------
    // 自选股
    // ---------------------------------------------------------
    var watchlist = U.LS.get(KEY_WL, null);
    if (!watchlist || !watchlist.length) {
        watchlist = DEFAULT_WATCHLIST.map(function (s) {
            return { id: U.uid('s'), code: s.code, name: s.name, addedAt: Date.now() };
        });
        U.LS.set(KEY_WL, watchlist);
    }

    function saveWatchlist() { U.LS.set(KEY_WL, watchlist); }
    function addStock(code, name) {
        code = String(code || '').trim().toLowerCase();
        if (!code) return false;
        if (watchlist.some(function (s) { return s.code === code; })) return false;
        watchlist.push({ id: U.uid('s'), code: code, name: name || code, addedAt: Date.now() });
        saveWatchlist();
        return true;
    }
    function removeStock(id) {
        var i = watchlist.findIndex(function (s) { return s.id === id || s.code === id; });
        if (i < 0) return false;
        watchlist.splice(i, 1);
        saveWatchlist();
        return true;
    }
    function moveStock(id, delta) {
        var i = watchlist.findIndex(function (s) { return s.id === id; });
        if (i < 0) return false;
        var j = i + delta;
        if (j < 0 || j >= watchlist.length) return false;
        var tmp = watchlist[i]; watchlist[i] = watchlist[j]; watchlist[j] = tmp;
        saveWatchlist();
        return true;
    }

    // ---------------------------------------------------------
    // 报告缓存
    // ---------------------------------------------------------
    function reportKey(code) { return String(code).toLowerCase(); }
    function getReport(code) { return U.LS.get(KEY_REPORT, {})[reportKey(code)] || null; }
    function allReports() { return U.LS.get(KEY_REPORT, {}); }
    function setReport(code, data) {
        var bag = U.LS.get(KEY_REPORT, {});
        // 最多缓存 60 条，超出淘汰最旧的
        var keys = Object.keys(bag);
        if (keys.length > 60) {
            keys.sort(function (a, b) { return (bag[a].ts || 0) - (bag[b].ts || 0); });
            keys.slice(0, keys.length - 60).forEach(function (k) { delete bag[k]; });
        }
        bag[reportKey(code)] = { ts: Date.now(), data: data };
        U.LS.set(KEY_REPORT, bag);
    }
    function delReport(code) {
        var bag = U.LS.get(KEY_REPORT, {});
        delete bag[reportKey(code)];
        U.LS.set(KEY_REPORT, bag);
    }

    // ---------------------------------------------------------
    // 任务记录（直连模式下的分析任务流水）
    // ---------------------------------------------------------
    function getTasks() { return U.LS.get(KEY_TASK, []); }
    function pushTask(t) {
        var list = getTasks();
        list.unshift(Object.assign({ id: U.uid('t'), ts: Date.now(), status: 'processing' }, t));
        U.LS.set(KEY_TASK, list.slice(0, 80));
        return list[0];
    }
    function updateTask(id, patch) {
        var list = getTasks();
        var t = list.filter(function (x) { return x.id === id; })[0];
        if (t) { Object.assign(t, patch); U.LS.set(KEY_TASK, list); }
        return t;
    }
    function clearTasks() { U.LS.set(KEY_TASK, []); }

    function applyTheme() {
        document.documentElement.setAttribute('data-theme', cfg.theme || 'light');
        var meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', cfg.theme === 'dark' ? '#0f1115' : '#ffffff');
    }

    DSA.store = {
        get: function () { return cfg; },
        set: set, save: save,
        serverBase: serverBase, llmReady: llmReady,
        LLM_PRESETS: LLM_PRESETS,
        get watchlist() { return watchlist; },
        addStock: addStock, removeStock: removeStock, moveStock: moveStock, saveWatchlist: saveWatchlist,
        getReport: getReport, setReport: setReport, delReport: delReport, allReports: allReports,
        getTasks: getTasks, pushTask: pushTask, updateTask: updateTask, clearTasks: clearTasks,
        applyTheme: applyTheme
    };
})(window);
