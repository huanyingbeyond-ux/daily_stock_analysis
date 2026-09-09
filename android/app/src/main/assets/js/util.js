/* ============================================================
 * DSA Mobile - util.js
 * 基础设施：选择器、DOM 构造、JSONP、请求、格式化、Toast、存储
 * ============================================================
 * 说明：全站不使用 ES Module，改成「传统 script + 全局命名空间」
 *       目的是让页面在 Android WebView 的 file:///android_asset/
 *       协议下也能正常运行（module 会被跨源策略拦截）。
 * ============================================================ */
(function (root) {
    'use strict';

    var DSA = root.DSA = root.DSA || {};

    // ---------------------------------------------------------
    // DOM 快捷方法
    // ---------------------------------------------------------
    function $(sel, ctx) { return (ctx || document).querySelector(sel); }
    function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }

    /**
     * 构造元素：el('div.card', {onclick: fn}, [child, '文本'])
     * selector 支持 "tag#id.class1.class2"
     */
    function el(selector, attrs, children) {
        var parts = String(selector).split(/(?=[.#])/);
        var node = document.createElement(parts[0] || 'div');
        for (var i = 1; i < parts.length; i++) {
            var p = parts[i];
            if (p[0] === '#') node.id = p.slice(1);
            else if (p[0] === '.') node.classList.add(p.slice(1));
        }
        if (attrs) {
            Object.keys(attrs).forEach(function (k) {
                var v = attrs[k];
                if (v == null || v === false) return;
                if (k === 'text') node.textContent = v;
                else if (k === 'html') node.innerHTML = v;
                else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
                else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2), v);
                else if (k === 'dataset') Object.assign(node.dataset, v);
                else node.setAttribute(k, v === true ? '' : v);
            });
        }
        appendAll(node, children);
        return node;
    }

    function appendAll(node, children) {
        if (children == null) return node;
        if (!Array.isArray(children)) children = [children];
        children.forEach(function (c) {
            if (c == null || c === false) return;
            node.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
        });
        return node;
    }

    function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); return node; }

    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    /** 极简 Markdown 渲染（标题/列表/粗体/代码块/段落），用于报告正文 */
    function markdown(src) {
        if (!src) return '';
        var lines = String(src).split(/\r?\n/);
        var out = [], inList = false, inCode = false;
        lines.forEach(function (raw) {
            var line = raw;
            if (/^```/.test(line.trim())) {
                if (!inCode) { out.push('<pre class="md-pre">'); inCode = true; }
                else { out.push('</pre>'); inCode = false; }
                return;
            }
            if (inCode) { out.push(escapeHtml(line) + '\n'); return; }
            var t = line.trim();
            if (!t) { closeList(); return; }
            var h = /^(#{1,6})\s+(.*)$/.exec(t);
            if (h) { closeList(); out.push('<h' + (h[1].length + 2) + ' class="md-h">' + inline(h[2]) + '</h' + (h[1].length + 2) + '>'); return; }
            if (/^([-*+]|\d+\.)\s+/.test(t)) {
                if (!inList) { out.push('<ul class="md-ul">'); inList = true; }
                out.push('<li>' + inline(t.replace(/^([-*+]|\d+\.)\s+/, '')) + '</li>');
                return;
            }
            closeList();
            out.push('<p class="md-p">' + inline(t) + '</p>');
        });
        closeList();
        if (inCode) out.push('</pre>');
        function closeList() { if (inList) { out.push('</ul>'); inList = false; } }
        function inline(s) {
            return escapeHtml(s)
                .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
                .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
                .replace(/`([^`]+)`/g, '<code class="md-code">$1</code>');
        }
        return out.join('');
    }

    // ---------------------------------------------------------
    // JSONP：手机端直连行情/搜索的唯一可行方案
    // 浏览器 script 标签不受同源策略限制，且腾讯接口返回 GBK，
    // 通过 script.charset 指定编码即可自动解码。
    // ---------------------------------------------------------
    var jsonpSeq = 0;
    function jsonp(url, opts) {
        opts = opts || {};
        var timeout = opts.timeout || 12000;
        var cbName = opts.callback || ('__dsacb' + (++jsonpSeq) + '_' + Date.now());
        var sep = url.indexOf('?') >= 0 ? '&' : '?';
        return new Promise(function (resolve, reject) {
            var script = document.createElement('script');
            var timer = setTimeout(function () { cleanup(); reject(new Error('请求超时')); }, timeout);
            function cleanup() {
                clearTimeout(timer);
                try { delete root[cbName]; } catch (e) { root[cbName] = undefined; }
                if (script.parentNode) script.parentNode.removeChild(script);
            }
            root[cbName] = function (data) { cleanup(); resolve(data); };
            script.charset = opts.charset || 'UTF-8';
            script.src = url + sep + encodeURIComponent(opts.paramName || 'cb').replace(/%20/g, '') + '=' + cbName;
            if (opts.paramName) script.src = url + sep + opts.paramName + '=' + cbName;
            script.onerror = function () { cleanup(); reject(new Error('网络请求失败')); };
            document.head.appendChild(script);
        });
    }

    /**
     * 腾讯行情专用：接口把结果写进全局变量 v_xxxx，不需要 cb 参数。
     * 返回整段文本由调用方解析。
     */
    function jsonpVar(url, varNames, opts) {
        opts = opts || {};
        return new Promise(function (resolve, reject) {
            var script = document.createElement('script');
            var timer = setTimeout(function () { cleanup(); reject(new Error('行情请求超时')); }, opts.timeout || 12000);
            function cleanup() {
                clearTimeout(timer);
                if (script.parentNode) script.parentNode.removeChild(script);
            }
            script.charset = 'GBK';
            script.onload = function () {
                var bag = {};
                varNames.forEach(function (n) { bag[n] = root[n]; });
                cleanup();
                resolve(bag);
            };
            script.onerror = function () { cleanup(); reject(new Error('行情加载失败')); };
            script.src = url;
            document.head.appendChild(script);
        });
    }

    // ---------------------------------------------------------
    // HTTP：给服务器模式（FastAPI）使用
    // ---------------------------------------------------------
    function http(path, opts) {
        opts = opts || {};
        var url = /^https?:\/\//.test(path) ? path : (DSA.store.serverBase() + path);
        var init = {
            method: opts.method || 'GET',
            headers: Object.assign({ 'Accept': 'application/json' }, opts.headers || {}),
            cache: 'no-store'
        };
        if (opts.body != null) {
            init.headers['Content-Type'] = 'application/json';
            init.body = JSON.stringify(opts.body);
        }
        var token = DSA.store.get().serverToken;
        if (token) init.headers['Authorization'] = 'Bearer ' + token;
        return fetch(url, init).then(function (res) {
            if (!res.ok) {
                return res.text().then(function (t) {
                    throw new Error('HTTP ' + res.status + ' ' + (t || '').slice(0, 200));
                });
            }
            var ct = res.headers.get('content-type') || '';
            if (ct.indexOf('json') >= 0) return res.json();
            return res.text();
        });
    }

    // ---------------------------------------------------------
    // 格式化
    // ---------------------------------------------------------
    function num(v, digits) {
        var n = parseFloat(v);
        if (isNaN(n)) return '--';
        return n.toFixed(digits == null ? 2 : digits);
    }

    function thousands(v, digits) {
        var n = parseFloat(v);
        if (isNaN(n)) return '--';
        var s = Math.abs(n).toFixed(digits == null ? 2 : digits);
        var parts = s.split('.');
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return (n < 0 ? '-' : '') + parts.join('.');
    }

    /** 成交额：元 -> 万/亿 */
    function amount(v) {
        var n = parseFloat(v);
        if (isNaN(n)) return '--';
        if (Math.abs(n) >= 1e8) return (n / 1e8).toFixed(2) + '亿';
        if (Math.abs(n) >= 1e4) return (n / 1e4).toFixed(2) + '万';
        return n.toFixed(0);
    }

    function pct(v, withSign) {
        var n = parseFloat(v);
        if (isNaN(n)) return '--';
        var s = n.toFixed(2) + '%';
        return (withSign !== false && n > 0) ? '+' + s : s;
    }

    /** 涨跌方向：1 涨 / -1 跌 / 0 平 */
    function dir(v) {
        var n = parseFloat(v);
        if (isNaN(n) || Math.abs(n) < 1e-9) return 0;
        return n > 0 ? 1 : -1;
    }

    function pad(n) { return n < 10 ? '0' + n : '' + n; }

    function timeText(ts) {
        var d = new Date(ts);
        if (isNaN(d.getTime())) return '--';
        return pad(d.getHours()) + ':' + pad(d.getMinutes());
    }

    function dateText(ts) {
        var d = new Date(ts);
        if (isNaN(d.getTime())) return '--';
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }

    // ---------------------------------------------------------
    // Toast / 加载遮罩
    // ---------------------------------------------------------
    function toast(msg, type, ms) {
        var wrap = $('#toast-layer');
        if (!wrap) {
            wrap = el('div#toast-layer.toast-layer');
            document.body.appendChild(wrap);
        }
        var node = el('div.toast' + (type ? '.toast-' + type : ''), { text: msg });
        wrap.appendChild(node);
        requestAnimationFrame(function () { node.classList.add('show'); });
        setTimeout(function () {
            node.classList.remove('show');
            setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 260);
        }, ms || 2200);
        return node;
    }

    // ---------------------------------------------------------
    // 存储
    // ---------------------------------------------------------
    var LS = {
        get: function (k, dflt) {
            try {
                var raw = localStorage.getItem(k);
                return raw == null ? dflt : JSON.parse(raw);
            } catch (e) { return dflt; }
        },
        set: function (k, v) {
            try { localStorage.setItem(k, JSON.stringify(v)); return true; }
            catch (e) { return false; }
        },
        del: function (k) { try { localStorage.removeItem(k); } catch (e) { } }
    };

    // ---------------------------------------------------------
    // 杂项
    // ---------------------------------------------------------
    function debounce(fn, ms) {
        var t;
        return function () {
            var args = arguments, self = this;
            clearTimeout(t);
            t = setTimeout(function () { fn.apply(self, args); }, ms || 200);
        };
    }

    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

    function uid(prefix) {
        return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    }

    function copyText(text) {
        var ok = false;
        try {
            var ta = el('textarea', { style: { position: 'fixed', left: '-9999px' } });
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            ta.setSelectionRange(0, text.length);
            ok = document.execCommand('copy');
            document.body.removeChild(ta);
        } catch (e) { ok = false; }
        if (!ok && root.navigator && root.navigator.clipboard) {
            root.navigator.clipboard.writeText(text).then(function () { toast('已复制'); }, function () { toast('复制失败', 'warn'); });
            return true;
        }
        toast(ok ? '已复制到剪贴板' : '复制失败', ok ? '' : 'warn');
        return ok;
    }

    DSA.util = {
        $: $, $$: $$, el: el, clear: clear, escapeHtml: escapeHtml, markdown: markdown,
        jsonp: jsonp, jsonpVar: jsonpVar, http: http,
        num: num, thousands: thousands, amount: amount, pct: pct, dir: dir,
        timeText: timeText, dateText: dateText, pad: pad,
        toast: toast, LS: LS, debounce: debounce, sleep: sleep, uid: uid, copyText: copyText
    };
})(window);
