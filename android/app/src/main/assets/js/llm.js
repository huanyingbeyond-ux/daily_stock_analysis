/* ============================================================
 * DSA Mobile - llm.js
 * 大模型客户端：OpenAI 兼容 / Gemini / Anthropic / 可选联网搜索
 * ============================================================ */
(function (root) {
    'use strict';

    var DSA = root.DSA = root.DSA || {};

    function cfg() { return DSA.store.get().llm; }

    function trimSlash(u) { return String(u || '').replace(/\/+$/, ''); }

    function request(url, init, timeoutMs) {
        var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        var timer = null;
        if (ctrl) {
            init.signal = ctrl.signal;
            timer = setTimeout(function () { ctrl.abort(); }, timeoutMs || 180000);
        }
        return fetch(url, init).then(function (res) {
            if (timer) clearTimeout(timer);
            return res.text().then(function (text) {
                if (!res.ok) {
                    var msg = '';
                    try {
                        var j = JSON.parse(text);
                        msg = (j.error && (j.error.message || j.error.code)) || j.message || j.msg || '';
                    } catch (e) { msg = text.slice(0, 200); }
                    throw new Error('HTTP ' + res.status + ' ' + (msg || res.statusText));
                }
                try { return JSON.parse(text); }
                catch (e) { throw new Error('响应不是合法 JSON：' + text.slice(0, 160)); }
            });
        }, function (err) {
            if (timer) clearTimeout(timer);
            if (err && err.name === 'AbortError') throw new Error('请求超时，请稍后重试');
            throw new Error('网络请求失败：' + (err.message || '无法连接大模型服务，请检查地址与网络'));
        });
    }

    /**
     * 统一对话接口
     * @param {Array<{role,content}>} messages
     * @param {object} opts {temperature, maxTokens, timeoutMs, jsonMode}
     * @returns Promise<string>
     */
    function chat(messages, opts) {
        opts = opts || {};
        var c = cfg();
        if (!c.apiKey) throw new Error('尚未配置大模型 API Key，请到「设置」中填写');
        if (!c.model) throw new Error('尚未配置模型名称');

        var sys = '', convo = [];
        messages.forEach(function (m) {
            if (m.role === 'system') sys += (sys ? '\n\n' : '') + m.content;
            else convo.push(m);
        });

        if (c.provider === 'gemini') return gemini(sys, convo, opts);
        if (c.provider === 'anthropic') return anthropic(sys, convo, opts);
        return openaiCompatible(sys, convo, opts);
    }

    function openaiCompatible(sys, convo, opts) {
        var c = cfg();
        var body = {
            model: c.model,
            messages: (sys ? [{ role: 'system', content: sys }] : []).concat(convo),
            temperature: opts.temperature != null ? opts.temperature : (c.temperature || 0.3),
            stream: false
        };
        if (opts.maxTokens) body.max_tokens = opts.maxTokens;
        if (opts.jsonMode) body.response_format = { type: 'json_object' };
        return request(trimSlash(c.baseUrl) + '/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + c.apiKey
            },
            body: JSON.stringify(body)
        }, opts.timeoutMs).then(function (j) {
            var choices = j.choices || [];
            if (!choices.length) throw new Error('大模型未返回内容');
            return choices[0].message && choices[0].message.content || '';
        });
    }

    function gemini(sys, convo, opts) {
        var c = cfg();
        var url = trimSlash(c.baseUrl) + '/models/' + encodeURIComponent(c.model) +
            ':generateContent?key=' + encodeURIComponent(c.apiKey);
        var contents = convo.map(function (m) {
            return { role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] };
        });
        var body = {
            contents: contents,
            generationConfig: {
                temperature: opts.temperature != null ? opts.temperature : (c.temperature || 0.3)
            }
        };
        if (opts.jsonMode) body.generationConfig.responseMimeType = 'application/json';
        if (sys) body.systemInstruction = { parts: [{ text: sys }] };
        return request(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        }, opts.timeoutMs).then(function (j) {
            var cand = (j.candidates || [])[0];
            if (!cand || !cand.content) throw new Error('Gemini 未返回内容');
            return (cand.content.parts || []).map(function (p) { return p.text || ''; }).join('');
        });
    }

    function anthropic(sys, convo, opts) {
        var c = cfg();
        var body = {
            model: c.model,
            max_tokens: opts.maxTokens || 4096,
            temperature: opts.temperature != null ? opts.temperature : (c.temperature || 0.3),
            messages: convo.map(function (m) { return { role: m.role, content: m.content }; })
        };
        if (sys) body.system = sys;
        return request(trimSlash(c.baseUrl) + '/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': c.apiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true'
            },
            body: JSON.stringify(body)
        }, opts.timeoutMs).then(function (j) {
            var blocks = j.content || [];
            return blocks.filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('');
        });
    }

    /** 连通性自检：返回 {ok, detail} */
    function test() {
        return chat([{ role: 'user', content: '回复两个字：正常' }], { maxTokens: 16, timeoutMs: 30000 })
            .then(function (t) { return { ok: true, detail: String(t).trim().slice(0, 40) || '已连通（无返回内容）' }; })
            .catch(function (e) { return { ok: false, detail: e.message }; });
    }

    // ---------------------------------------------------------
    // 可选联网搜索（Tavily / 博查）
    // ---------------------------------------------------------
    function webSearch(query, maxResults) {
        var st = DSA.store.get();
        if (!st.searchEnabled || !st.searchKey) return Promise.resolve(null);
        maxResults = maxResults || 6;

        if (st.searchProvider === 'tavily') {
            return request('https://api.tavily.com/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    api_key: st.searchKey,
                    query: query,
                    max_results: maxResults,
                    search_depth: 'basic'
                })
            }, 30000).then(function (j) {
                return (j.results || []).map(function (r) {
                    return { title: r.title, url: r.url, snippet: (r.content || '').slice(0, 300) };
                });
            }).catch(function () { return null; });
        }

        // 博查
        return request('https://api.bochaai.com/v1/web-search', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + st.searchKey
            },
            body: JSON.stringify({ query: query, count: maxResults, summary: true })
        }, 30000).then(function (j) {
            var pages = (((j.data || {}).webPages || {}).value) || [];
            return pages.map(function (r) {
                return { title: r.name, url: r.url, snippet: (r.summary || r.snippet || '').slice(0, 300) };
            });
        }).catch(function () { return null; });
    }

    DSA.llm = { chat: chat, test: test, webSearch: webSearch };
})(window);
