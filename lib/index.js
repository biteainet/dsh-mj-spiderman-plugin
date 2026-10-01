/**
 * dsh-mj-spiderman · MJ 蜘蛛侠彩蛋插件（设置面板版 v0.3.0）
 *
 * 特性：
 *  - 任意输入框输入 "mj"（不分大小写）→ 随机播放一个特效（视频+json WebGL 合成）
 *  - 悬浮窗：点击穿透（pointer-events:none）、不可拖动，位置/大小由设置面板控制
 *  - 屏幕右侧小圆球 → 设置面板：
 *      特效选择（video1 / video2 参数各自独立）
 *      大小 / 上下 / 左右 / 左右镜像 / 预览
 *  - 每个特效的 {size, x, y, mirror} 独立保存，互不干扰
 *
 * 合成原理（参考 shuliko.zh.kg）：宽帧视频左半 alpha 遮罩 + 右半 RGB 彩图，
 * WebGL 按 json 的 aFrame/rgbFrame 坐标分离采样，输出 vec4(rgb*a, a)。
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    // Node / DSH host 加载：只导出插件函数，不触碰浏览器 API
    module.exports = factory();
  } else if (typeof window !== 'undefined') {
    // 浏览器 <script>：直接启用
    var _fn = factory();
    if (typeof _fn === 'function') _fn(root);
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  if (typeof window === 'undefined') {
    // 非浏览器环境（Node/Cordis 宿主）：返回占位插件函数，宿主在 renderer 注入时再启用
    var __ph = function (ctx) {};
    __ph.__dshMj = { version: '0.4.0', hostOnly: true };
    return __ph;
  }
  if (window.__dshMjInstalled) return function () {};
  window.__dshMjInstalled = true;

  function basePath() {
    var s = document.currentScript && document.currentScript.src;
    if (s) return s.replace(/lib\/index\.js$/, '');
    return '';
  }
  var BASE = basePath();

  var VIDEOS = [
    { key: 'video1', cfg: BASE + 'assets/video1.json', mp4: BASE + 'assets/video1.mp4' },
    { key: 'video2', cfg: BASE + 'assets/video2.json', mp4: BASE + 'assets/video2.mp4' }
  ];
  var FALLBACK_CFG = {
    'video1': { portrait: { v: 1, path: 'output.mp4', align: 8, has_audio: 1, f: 91, aFrame: [0, 0, 1072, 2352], rgbFrame: [1072, 0, 1072, 2352], videoW: 2144, videoH: 2352, w: 1072, h: 2352 } },
    'video2': { portrait: { v: 1, path: 'output.mp4', align: 8, has_audio: 1, f: 90, aFrame: [0, 0, 1172, 2532], rgbFrame: [1172, 0, 1172, 2532], videoW: 2352, videoH: 2544, w: 1172, h: 2532 } }
  };
  var configCache = {};
  var configsReady = Promise.all(VIDEOS.map(function (v) {
    return fetch(v.cfg).then(function (r) { return r.json(); }).then(function (j) {
      configCache[v.cfg] = j;
    }).catch(function () {
      configCache[v.cfg] = FALLBACK_CFG[v.key];
    });
  }));

  /* ================= 每特效独立参数 ================= */
  var DEFAULT_PERF = { size: 220, x: 50, y: 45, mirror: false };
  var PERF = loadPerf();
  function loadPerf() {
    try {
      var s = localStorage.getItem('dsh_mj_perf');
      var o = s ? JSON.parse(s) : {};
      return {
        video1: Object.assign({}, DEFAULT_PERF, o.video1),
        video2: Object.assign({}, DEFAULT_PERF, o.video2)
      };
    } catch (e) { return { video1: Object.assign({}, DEFAULT_PERF), video2: Object.assign({}, DEFAULT_PERF) }; }
  }
  function savePerf() {
    try { localStorage.setItem('dsh_mj_perf', JSON.stringify(PERF)); } catch (e) {}
  }

  var activeKey = 'video1';   // 面板当前选中的特效
  var win = null, canvas = null;
  var mainPlayer = null, playing = false, previewing = false;

  /* ================= 悬浮窗（点击穿透、不可拖动） ================= */
  function ensureWin() {
    if (win) return;
    win = document.createElement('div');
    win.id = 'dshMjWin';
    win.style.cssText = [
      'position:fixed', 'left:0', 'top:0',
      'z-index:999999',
      'background:transparent', 'border-radius:16px',
      'pointer-events:none',            // 点击穿透
      'overflow:hidden', 'display:none'
    ].join(';');
    canvas = document.createElement('canvas');
    canvas.id = 'dshMjCanvas';
    canvas.style.cssText = 'width:100%;height:100%;object-fit:contain;display:block;';
    win.appendChild(canvas);
    document.body.appendChild(win);
  }
  function applyWin(pos) {
    // pos: {w, h, x(0-100), y(0-100), mirror}
    win.style.width = pos.w + 'px';
    win.style.height = pos.h + 'px';
    var px = pos.x / 100 * window.innerWidth;
    var py = pos.y / 100 * window.innerHeight;
    px = Math.max(0, Math.min(px, window.innerWidth - pos.w));
    py = Math.max(0, Math.min(py, window.innerHeight - pos.h));
    win.style.left = px + 'px';
    win.style.top = py + 'px';
    if (mainPlayer && mainPlayer.gl) mainPlayer.setMirror(pos.mirror ? 1 : 0);
  }

  /* ================= WebGL 合成器（移植自站点 VideoRenderer） ================= */
  function VideoRenderer(canvas) {
    this.canvas = canvas; this.gl = null; this.video = null; this.raf = 0;
    this.tex = null; this.prog = null; this.uniforms = {}; this._c = null; this.onEnded = null;
  }
  VideoRenderer.prototype.setup = function (src, opts) {
    var self = this; opts = opts || {};
    this.video = document.createElement('video');
    this.video.src = src; this.video.loop = !!opts.loop; this.video.muted = !!opts.muted;
    this.video.playsInline = true; this.video.setAttribute('webkit-playsinline', '');
    this.video.addEventListener('ended', function () {
      self.stopRender(); if (self.onEnded) self.onEnded();
    }, { once: true });
    var p = this.video.play();
    if (p) p.catch(function () { self.video.muted = true; self.video.play().catch(function () {}); });
  };
  VideoRenderer.prototype.waitFirstFrame = function () {
    if (this.video.readyState >= 2) return Promise.resolve();
    var self = this;
    return new Promise(function (res, rej) {
      self.video.addEventListener('loadeddata', res, { once: true });
      self.video.addEventListener('error', rej, { once: true });
    });
  };
  VideoRenderer.prototype.setContent = function (c) {
    this._c = c; this.canvas.width = c.w; this.canvas.height = c.h; this.initGL(c);
  };
  VideoRenderer.prototype.setMirror = function (m) {
    if (this.gl && this.uniforms.uMirror) glUniform(this, 'uMirror', m);
  };
  VideoRenderer.prototype.initGL = function (c) {
    var gl = this.canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false });
    if (!gl) return; this.gl = gl;
    var vs = 'attribute vec2 aPos;attribute vec2 aUV;varying vec2 vUV;void main(){gl_Position=vec4(aPos,0.,1.);vUV=aUV;}';
    var fs = [
      'precision mediump float;', 'varying vec2 vUV;',
      'uniform sampler2D uTex;', 'uniform vec4 uARect,uRgbRect;',
      'uniform vec2 uVideoSize;', 'uniform float uMirror;',
      'vec2 pxToTex(vec2 px){return vec2(px.x/uVideoSize.x,1.0-px.y/uVideoSize.y);}',
      'void main(){',
      ' vec2 uv=vUV;', ' if(uMirror>0.5) uv.x=1.0-uv.x;',
      ' vec2 rgbPx=uRgbRect.xy+vec2(uv.x*uRgbRect.z,(1.0-uv.y)*uRgbRect.w);',
      ' vec3 rgb=texture2D(uTex,pxToTex(rgbPx)).rgb;',
      ' vec2 aPx=uARect.xy+vec2(uv.x*uARect.z,(1.0-uv.y)*uARect.w);',
      ' float a=texture2D(uTex,pxToTex(aPx)).r;',
      ' gl_FragColor=vec4(rgb*a,a);', '}'
    ].join('\n');
    function compile(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; }
    var prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog); gl.useProgram(prog);
    var quad = new Float32Array([-1,-1,0,0, 1,-1,1,0, -1,1,0,1, 1,1,1,1]);
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    var aPos = gl.getAttribLocation(prog, 'aPos'), aUV = gl.getAttribLocation(prog, 'aUV');
    gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(aUV); gl.vertexAttribPointer(aUV, 2, gl.FLOAT, false, 16, 8);
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.tex = tex;
    this.uniforms = {
      uARect: gl.getUniformLocation(prog, 'uARect'),
      uRgbRect: gl.getUniformLocation(prog, 'uRgbRect'),
      uVideoSize: gl.getUniformLocation(prog, 'uVideoSize'),
      uMirror: gl.getUniformLocation(prog, 'uMirror')
    };
    gl.uniform4f(this.uniforms.uARect, c.aFrame[0], c.aFrame[1], c.aFrame[2], c.aFrame[3]);
    gl.uniform4f(this.uniforms.uRgbRect, c.rgbFrame[0], c.rgbFrame[1], c.rgbFrame[2], c.rgbFrame[3]);
    gl.uniform2f(this.uniforms.uVideoSize, c.videoW, c.videoH);
    gl.uniform1f(this.uniforms.uMirror, 0);
    gl.viewport(0, 0, c.w, c.h);
  };
  function glUniform(r, name, v) {
    try { r.gl.uniform1f(r.uniforms[name], v); } catch (e) {}
  }
  VideoRenderer.prototype.startRender = function () {
    var self = this;
    (function frame() {
      if (!self.gl || !self.video || self.video.ended) return;
      self.raf = requestAnimationFrame(frame);
      if (self.video.readyState >= 2) {
        var gl = self.gl;
        gl.bindTexture(gl.TEXTURE_2D, self.tex);
        try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, self.video); } catch (e) { return; }
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    })();
  };
  VideoRenderer.prototype.stopRender = function () {
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
  };
  VideoRenderer.prototype.destroy = function () {
    this.stopRender();
    if (this.video) { this.video.pause(); this.video.src = ''; this.video = null; }
  };

  /* ================= 特效播放 / 预览 ================= */
  function showFx(key, loop, done) {
    ensureWin();
    if (mainPlayer) { mainPlayer.destroy(); mainPlayer = null; }
    var item = null;
    for (var i = 0; i < VIDEOS.length; i++) if (VIDEOS[i].key === key) item = VIDEOS[i];
    if (!item) return;
    var p = PERF[key];
    win.style.display = 'block';
    var legacy = win.querySelector('video');
    if (legacy) { legacy.remove(); canvas.style.display = 'block'; }
    mainPlayer = new VideoRenderer(canvas);
    mainPlayer.onEnded = function () {
      if (!loop && done) done();
    };
    var c = null;
    configsReady.then(function () {
      c = (configCache[item.cfg] && configCache[item.cfg].portrait) || configCache[item.cfg];
      var w = Math.max(120, Math.min(460, p.size));
      var h = w * (c.h / c.w);
      applyWin({ w: w, h: h, x: p.x, y: p.y, mirror: p.mirror });
      mainPlayer.setup(item.mp4, { muted: false, loop: !!loop });
      return mainPlayer.waitFirstFrame();
    }).then(function () {
      mainPlayer.setContent(c);
      mainPlayer.setMirror(p.mirror ? 1 : 0);
      mainPlayer.startRender();
    }).catch(function () {
      // 降级：窗口内直接播放 mp4
      try {
        var v = document.createElement('video');
        v.src = item.mp4; v.autoplay = true; v.playsInline = true; v.loop = !!loop;
        v.style.cssText = 'width:100%;height:100%;object-fit:contain;display:block;';
        v.onended = function () { if (!loop && done) done(); };
        win.insertBefore(v, canvas);
        canvas.style.display = 'none';
        v.play().catch(function () { hideFx(); });
      } catch (e) { hideFx(); }
    });
  }
  function hideFx() {
    if (!win) return;
    if (mainPlayer) { mainPlayer.destroy(); mainPlayer = null; }
    var lv = win.querySelector('video');
    if (lv) { lv.remove(); canvas.style.display = 'block'; }
    win.style.display = 'none';
    playing = false; previewing = false;
  }

  /* ================= 右侧小圆球 + 设置面板 ================= */
  function buildUI() {
    var ball = document.createElement('div');
    ball.id = 'dshMjBall';
    ball.style.cssText = [
      'position:fixed', 'right:10px', 'top:45%', 'width:46px', 'height:46px',
      'border-radius:50%', 'cursor:pointer', 'z-index:1000000',
      'background:rgba(20,20,35,0.85)', 'border:1px solid rgba(120,170,255,0.45)',
      'box-shadow:0 4px 16px rgba(0,0,0,0.45)', 'overflow:hidden',
      'display:flex', 'align-items:center', 'justify-content:center'
    ].join(';');
    ball.innerHTML =
      '<img src="' + BASE + 'assets/mj.png" style="width:100%;height:100%;object-fit:cover" alt="MJ">';
    document.body.appendChild(ball);

    var panel = document.createElement('div');
    panel.id = 'dshMjPanel';
    panel.style.cssText = [
      'position:fixed', 'right:0', 'top:0', 'bottom:0', 'width:280px',
      'z-index:1000001', 'background:rgba(18,18,30,0.96)',
      'border-left:1px solid rgba(120,170,255,0.25)',
      'box-shadow:-8px 0 24px rgba(0,0,0,0.5)',
      'transform:translateX(100%)', 'transition:transform .25s ease',
      'color:rgba(255,255,255,0.9)', 'font-size:13px',
      'overflow-y:auto', 'box-sizing:border-box', 'padding:16px 14px 40px',
      'font-family:system-ui,-apple-system,sans-serif'
    ].join(';');
    panel.innerHTML = [
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">',
      '  <div style="font-weight:600;font-size:14px;letter-spacing:.5px">MJ 特效设置</div>',
      '  <div id="dshMjPanelClose" style="width:26px;height:26px;border-radius:8px;background:rgba(255,255,255,0.08);cursor:pointer;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.7)">✕</div>',
      '</div>',
      '<div style="font-size:11px;color:rgba(255,255,255,0.4);margin-bottom:12px">特效参数各自独立保存 · 悬浮窗点击穿透</div>',
      '<div style="display:flex;gap:8px;margin-bottom:16px" id="dshMjTabs">',
      '  <div data-k="video1" class="mj-tab" style="flex:1;padding:8px 0;text-align:center;border-radius:10px;cursor:pointer;background:rgba(120,170,255,0.22);border:1px solid rgba(120,170,255,0.4)">特效 1</div>',
      '  <div data-k="video2" class="mj-tab" style="flex:1;padding:8px 0;text-align:center;border-radius:10px;cursor:pointer;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1)">特效 2</div>',
      '</div>'
    ].join('') + sliderRow('大小', 'size', 120, 460, 1, 'px') +
      sliderRow('上下', 'y', 0, 100, 1, '%') +
      sliderRow('左右', 'x', 0, 100, 1, '%') +
      [
        '<div style="display:flex;align-items:center;justify-content:space-between;margin:14px 0 4px">',
        '  <span style="font-size:12px;color:rgba(255,255,255,0.65)">左右镜像</span>',
        '  <div id="dshMjMirror" style="width:44px;height:22px;border-radius:11px;background:rgba(255,255,255,0.12);position:relative;cursor:pointer;transition:background .2s">',
        '    <div style="position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#78aaff;transition:left .2s" id="dshMjMirrorKnob"></div>',
        '  </div>',
        '</div>',
        '<div style="display:flex;gap:8px;margin-top:16px">',
        '  <div id="dshMjPreview" style="flex:1;padding:9px 0;text-align:center;border-radius:10px;background:rgba(120,170,255,0.25);border:1px solid rgba(120,170,255,0.45);cursor:pointer">预览特效</div>',
        '  <div id="dshMjHide" style="flex:1;padding:9px 0;text-align:center;border-radius:10px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.14);cursor:pointer">隐藏</div>',
        '</div>',
        '<div style="font-size:11px;color:rgba(255,255,255,0.3);margin-top:14px;line-height:1.6">',
        '  任意输入框输入 mj（不分大小写）随机触发特效播放。滑块即时调整当前选中特效，参数自动保存。</div>'
      ].join('');
    document.body.appendChild(panel);

    function sliderRow(label, key, min, max, step, unit) {
      return [
        '<div style="margin-top:12px">',
        '  <div style="display:flex;justify-content:space-between;font-size:12px;color:rgba(255,255,255,0.65);margin-bottom:6px">',
        '    <span>' + label + '</span><span id="dshMjVal_' + key + '"></span></div>',
        '  <input type="range" id="dshMj_' + key + '" min="' + min + '" max="' + max + '" step="' + step + '"',
        '    style="width:100%;accent-color:#78aaff;height:22px;background:transparent">',
        '</div>'
      ].join('');
    }

    var ballOpen = false;
    function openPanel(v) {
      ballOpen = v;
      panel.style.transform = v ? 'translateX(0)' : 'translateX(100%)';
      if (v) { refreshPanel(); }
    }
    ball.addEventListener('click', function () { openPanel(!ballOpen); });
    document.getElementById('dshMjPanelClose').addEventListener('click', function () { openPanel(false); });

    // 特效 tab 切换
    var tabs = panel.querySelectorAll('.mj-tab');
    tabs.forEach(function (t) {
      t.addEventListener('click', function () {
        activeKey = t.getAttribute('data-k');
        refreshTabs();
        refreshPanel();
      });
    });
    function refreshTabs() {
      tabs.forEach(function (t) {
        var on = t.getAttribute('data-k') === activeKey;
        t.style.background = on ? 'rgba(120,170,255,0.22)' : 'rgba(255,255,255,0.06)';
        t.style.border = on ? '1px solid rgba(120,170,255,0.4)' : '1px solid rgba(255,255,255,0.1)';
      });
    }

    // 滑块 / 镜像 / 按钮
    ['size', 'y', 'x'].forEach(function (k) {
      var el = document.getElementById('dshMj_' + k);
      el.addEventListener('input', function () {
        PERF[activeKey][k] = parseFloat(el.value);
        savePerf();
        refreshVal(k);
      });
    });
    var mirrorEl = document.getElementById('dshMjMirror');
    mirrorEl.addEventListener('click', function () {
      PERF[activeKey].mirror = !PERF[activeKey].mirror;
      savePerf();
      refreshMirror();
    });
    document.getElementById('dshMjPreview').addEventListener('click', function () { startPreview(); });
    document.getElementById('dshMjHide').addEventListener('click', function () { hideFx(); });

    function refreshVal(k) {
      var el = document.getElementById('dshMj_' + k);
      el.value = PERF[activeKey][k];
      var unit = k === 'size' ? 'px' : '%';
      document.getElementById('dshMjVal_' + k).textContent = PERF[activeKey][k] + unit;
    }
    function refreshMirror() {
      var knob = document.getElementById('dshMjMirrorKnob');
      var on = PERF[activeKey].mirror;
      knob.style.left = on ? '24px' : '2px';
      mirrorEl.style.background = on ? 'rgba(120,170,255,0.55)' : 'rgba(255,255,255,0.12)';
    }
    function refreshPanel() {
      ['size', 'y', 'x'].forEach(refreshVal);
      refreshMirror();
    }
    refreshTabs();

    // 实时预览（loop 循环显示当前选中特效，滑块即时生效）
    function startPreview() {
      if (!ballOpen) return;
      previewing = true;
      showFx(activeKey, true, null);
    }
  }

  /* ================= 任意输入框触发 ================= */
  function mjTrigger() {
    if (playing) return;
    playing = true;
    var idx = Math.floor(Math.random() * VIDEOS.length);
    var key = VIDEOS[idx].key;
    showFx(key, false, function () { playing = false; hideFx(); });
  }
  function watchInput(el) {
    function check() {
      var t = (el.value || '').trim();
      if (t && t.toLowerCase() === 'mj') { el.value = ''; mjTrigger(); }
    }
    el.addEventListener('input', check);
    el.addEventListener('keydown', function (e) { if (e.key === 'Enter') check(); });
  }
  function scanInputs() {
    document.querySelectorAll('input, textarea, [contenteditable="true"]').forEach(function (el) {
      if (el.__dshMjWatched) return;
      el.__dshMjWatched = true;
      watchInput(el);
    });
  }
  function start() {
    buildUI();
    scanInputs();
    if (window.MutationObserver) {
      new MutationObserver(scanInputs).observe(document.body, { childList: true, subtree: true });
    }
  }
  var api = {
    trigger: mjTrigger,
    hide: hideFx,
    start: start,
    openPanel: function () { buildUI(); document.getElementById('dshMjBall').click(); },
    version: '0.4.0'
  };
  function autoStart() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start);
    } else {
      start();
    }
  }
  // Cordis/DSH 插件入口：宿主调用时启用；浏览器 <script> 由顶部 UMD 自动调用
  window.__dshMj = api;
  return function (ctx) {
    if (!window.__dshMjStarted) {
      window.__dshMjStarted = true;
      autoStart();
    }
    return api;
  };
}));
