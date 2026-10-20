window.__ModuleLoader__.load({
  id: '@emilia/companion-loop',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { createPortal } = require('react-dom');
    // Electron composes draggable rectangles in document order, ignoring the
    // dialog's top-layer stacking. Mount after the shell's drag rows as well.
    const renderDialog = (props, ...children) => createPortal(h('dialog', { role: 'dialog', ...props,
      style: { ...props.style, WebkitAppRegion: 'no-drag' } }, ...children), document.body);
    const baseUrl = 'http://127.0.0.1:37471';
    const colors = {
      text: 'var(--dsw-alias-label-primary)',
      muted: 'var(--dsw-alias-label-tertiary)',
      border: 'var(--dsw-alias-border-l3)',
      error: 'var(--dsw-alias-state-error-primary)',
    };
    const typography = { color: colors.text, fontFamily: 'var(--dsw-font-family)', fontSize: 14, lineHeight: '22px' };
    const heading = { margin: '0 0 8px', color: colors.text, fontSize: 16, lineHeight: '24px', fontWeight: 500 };
    const intro = { margin: '0 0 16px', color: colors.muted, fontSize: 14, lineHeight: '22px' };
    const button = { height: 36, padding: '0 14px', border: `1px solid ${colors.border}`, borderRadius: 8,
      background: 'transparent', color: colors.text, font: 'inherit', fontSize: 14, lineHeight: '22px', cursor: 'pointer' };
    const field = { padding: '8px 10px', border: `1px solid ${colors.border}`, borderRadius: 8,
      background: 'var(--dsw-alias-bg-layer-2)', color: colors.text, font: 'inherit', fontSize: 14,
      lineHeight: '22px', width: 'min(100%, 540px)', boxSizing: 'border-box' };
    const section = { borderTop: `1px solid ${colors.border}`, marginTop: 24, paddingTop: 20 };
    const disclosure = { ...section, color: colors.text };
    const summary = { ...heading, cursor: 'pointer', padding: '2px 0', listStylePosition: 'inside' };
    const mobileStyle = `.emilia-reply-identity {
      display: flex; align-items: center; gap: 9px; margin: 0 0 10px;
      color: var(--dsw-alias-label-secondary); font-family: var(--dsw-font-family);
    }
    .emilia-reply-avatar {
      position: relative; display: inline-flex; align-items: center; justify-content: center;
      width: 34px; height: 34px; flex: 0 0 34px; overflow: hidden; border-radius: 50%;
      background: var(--dsw-alias-bg-layer-2, #eef1f9); color: #526ab5;
      box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l3); font-size: 12px; font-weight: 600;
    }
    .emilia-reply-name { font-size: 12px; line-height: 18px; font-weight: 500; }
    @media (max-width: 600px) {
      .emilia-reply-avatar { width: 30px; height: 30px; flex-basis: 30px; }
      .emilia-reply-identity { margin-bottom: 8px; gap: 8px; }
    }
    @media (max-width: 900px) and (pointer: coarse) {
      [data-composer-input][contenteditable="true"],
      input,
      textarea,
      select {
        font-size: 16px !important;
      }
    }
    @media (max-width: 600px) {
      [data-shortcut-modal="settings"] {
        width: calc(100vw - 16px) !important;
        max-width: none !important;
        height: calc(100dvh - 16px - env(safe-area-inset-top) - env(safe-area-inset-bottom)) !important;
        flex-direction: column !important;
      }
      [data-shortcut-modal="settings"] > nav {
        width: 100% !important;
        padding: 12px 12px 0 !important;
        gap: 8px !important;
      }
      [data-shortcut-modal="settings"] > nav > div:nth-child(2) {
        flex-direction: row !important;
        overflow-x: auto !important;
        overflow-y: hidden !important;
        flex: none !important;
        scrollbar-width: none;
      }
      [data-shortcut-modal="settings"] > nav > div:nth-child(2) > button {
        flex: none !important;
        width: auto !important;
      }
      [data-shortcut-modal="settings"] > div:last-child {
        min-height: 0 !important;
      }
      [data-shortcut-modal="settings"] > div:last-child > div:first-child {
        position: absolute !important;
        top: 8px;
        right: 8px;
        height: 32px !important;
        padding: 0 !important;
      }
      [data-shortcut-modal="settings"] > div:last-child > div:last-child {
        padding: 12px 16px calc(24px + env(safe-area-inset-bottom)) !important;
      }
    }`;
    async function api(path, method = 'GET', body) {
      const web = /^https?:$/.test(window.location.protocol);
      const response = await fetch(web ? '/api/emilia' : `${baseUrl}${path}`, web
        ? { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path, method, body }) }
        : { method, headers: { 'Content-Type': 'application/json' },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const value = response.status === 204 ? {} : await response.json();
      if (!response.ok) throw Error(value.error || `HTTP ${response.status}`);
      return value;
    }
    async function voiceAudio(text, signal, speakerId, sessionId) {
      const web = /^https?:$/.test(window.location.protocol);
      const response = await fetch(web ? '/api/emilia' : `${baseUrl}/voice/synthesize`, web
        ? { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: '/voice/synthesize', method: 'POST', body: { text, speakerId, sessionId } }), signal }
        : { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, speakerId, sessionId }), signal });
      if (!response.ok) {
        let error = `HTTP ${response.status}`;
        try { error = (await response.json()).error || error; } catch { /* The service can return plain text. */ }
        throw Error(error);
      }
      if (!/^audio\/(?:wav|x-wav|wave)(?:;|$)/iu.test(response.headers.get('content-type') || '')) {
        throw Error('手机收到的不是语音文件，请检查登录状态后刷新页面');
      }
      const wav = await response.blob();
      if (!wav.size) throw Error('语音文件为空，请再试一次');
      return wav;
    }






















    // BEGIN MUSIC WALL DOCUMENT
    const musicWallDocument = "<!doctype html><html><head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: https://*.mzstatic.com;\"><meta charset=utf8><meta name=viewport content=\"width=device-width,initial-scale=1,viewport-fit=cover\"><style>:root{color-scheme:light;box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}html{scroll-padding-top:env(safe-area-inset-top,0px)}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#fff;color:#000}img{max-width:100%}[hidden]:not([hidden=until-found i]){display:none!important}</style></head><body>\n<title>音樂日記封面牆</title>\n<meta name=\"claude:viewport-fit-sides\" content=\"cover\">\n<style>\n/* Layout: one full-screen stage. A slab of mixed-size covers is tilted in 3D, and the camera glides to whichever cover is selected. */\n:root{\n  --bg:#06080c;\n  --slab:#0c1016;\n  --fg:#eef2f7;\n  --muted:#8c96a6;\n  --accent:#8fd3ff;\n  --line:rgba(255,255,255,.14);\n  --font-display:'Bricolage Grotesque','Noto Sans TC',system-ui,sans-serif;\n  --font-body:'Noto Sans TC',system-ui,-apple-system,'PingFang TC','Microsoft JhengHei',sans-serif;\n  --font-mono:'JetBrains Mono',ui-monospace,Menlo,Consolas,monospace;\n  --u:116px;\n  --gap:4px;\n  --ease:cubic-bezier(.22,.8,.2,1);\n  color-scheme:dark;\n}\nhtml,body{height:100%}\nbody{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 var(--font-body);overflow:hidden}\nbutton,input{font:inherit;color:inherit}\n\n.bg{position:fixed;inset:-12%;background-size:cover;background-position:center;filter:blur(70px) saturate(1.4) brightness(.5);opacity:0;transition:opacity 1.1s ease}\n.bg.on{opacity:1}\n\n.stage{position:fixed;inset:0;perspective:1500px;perspective-origin:50% 38%;overflow:hidden;\n  -webkit-mask-image:radial-gradient(ellipse 88% 82% at 50% 46%,#000 52%,transparent 100%);\n  mask-image:radial-gradient(ellipse 88% 82% at 50% 46%,#000 52%,transparent 100%);\n  filter:blur(var(--blur,0px));transition:filter .8s var(--ease)}\n.stage.warp{transition:filter .27s ease-in}\n.wall{position:absolute;left:50%;top:44%;transform-origin:0 0;transform-style:preserve-3d;\n  display:grid;grid-template-columns:repeat(var(--cols,9),var(--u));grid-auto-rows:var(--u);grid-auto-flow:dense;gap:var(--gap);\n  padding:var(--gap);background:var(--slab);border-radius:6px;box-shadow:0 90px 150px rgba(0,0,0,.7);\n  translate:var(--tx,0px) 0;scale:var(--sc,1);opacity:var(--op,1);\n  transition:transform 1.1s var(--ease),translate .8s cubic-bezier(.16,1,.3,1),scale .8s cubic-bezier(.16,1,.3,1),opacity .5s ease-out}\n.wall.warp{transition:transform 1.1s var(--ease),translate .27s cubic-bezier(.55,0,.9,.45),scale .27s cubic-bezier(.55,0,.9,.45),opacity .22s ease-in}\n.wall.snap{transition:none!important}\n\n.tile{position:relative;display:block;border:0;padding:0;margin:0;text-align:left;cursor:pointer;overflow:hidden;border-radius:2px;\n  background:#111 center/cover no-repeat;transform:translateZ(0);\n  filter:blur(var(--b,0px)) brightness(.5);\n  transition:filter .7s var(--ease),transform .9s var(--ease),box-shadow .7s var(--ease)}\n.tile.miss{filter:blur(var(--b,0px)) brightness(.28)}\n.tile:hover{filter:blur(0) brightness(.9)}\n.tile:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}\n.tile.on{filter:none;transform:translateZ(46px) scale(1.035);box-shadow:0 0 0 2px rgba(255,255,255,.92),0 36px 80px rgba(0,0,0,.65)}\n.tile .badge{position:absolute;left:8px;top:8px;padding:1px 7px;border-radius:2px;background:rgba(0,0,0,.55);font:400 10px/1.6 var(--font-mono);letter-spacing:.04em}\n.tile .meta{position:absolute;left:0;right:0;bottom:0;padding:30px 9px 8px;background:linear-gradient(transparent,rgba(0,0,0,.74));display:block}\n.tile .t{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font:700 14px/1.2 var(--font-display);text-shadow:0 1px 6px rgba(0,0,0,.5)}\n.tile.big .t{font-size:21px}\n.tile .y{display:block;margin-top:2px;font:400 10px/1.4 var(--font-mono);color:rgba(255,255,255,.62)}\n\nheader{position:fixed;top:0;left:0;right:0;z-index:5;\n  padding:calc(env(safe-area-inset-top,0px) + 14px) max(16px,env(safe-area-inset-right,0px)) 14px max(16px,env(safe-area-inset-left,0px));\n  background:linear-gradient(rgba(6,8,12,.88),transparent)}\n.bar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px 20px}\n.brand{font:700 15px/1 var(--font-display);letter-spacing:.02em}\n.brand span{margin-left:8px;color:var(--muted);font:400 11px var(--font-mono);letter-spacing:.08em}\n.tabs{display:flex;gap:4px;min-width:0}\n.tab{border:0;background:none;cursor:pointer;padding:6px 12px;border-radius:999px;color:var(--muted);transition:color .2s,background .2s}\n.tab b{margin-left:6px;font:400 11px var(--font-mono);opacity:.7}\n.tab:hover{color:var(--fg)}\n.tab[aria-selected=\"true\"]{color:#06080c;background:var(--fg)}\n.tab:focus-visible,.seg button:focus-visible,.ib:focus-visible,#add:focus-visible,.chip:focus-visible,#q:focus-visible{outline:2px solid var(--accent);outline-offset:2px}\n.seg{display:flex;padding:3px;border-radius:999px;background:rgba(255,255,255,.08);border:1px solid var(--line);backdrop-filter:blur(12px)}\n.seg button{border:0;background:none;cursor:pointer;padding:3px 12px;border-radius:999px;color:var(--muted);font-size:12px}\n.seg button[aria-pressed=\"true\"]{background:rgba(255,255,255,.18);color:var(--fg)}\n\n.ask{margin-top:12px;max-width:620px}\n#askf{display:flex;gap:8px}\n#q{flex:1;min-width:0;padding:9px 16px;border-radius:999px;border:1px solid var(--line);background:rgba(14,18,24,.7);backdrop-filter:blur(14px)}\n#q::placeholder{color:var(--muted)}\n#askf button{border:0;cursor:pointer;padding:0 20px;border-radius:999px;background:var(--accent);color:#06080c;font-weight:700}\n.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}\n.chip{border:1px solid var(--line);background:rgba(14,18,24,.55);backdrop-filter:blur(10px);cursor:pointer;padding:2px 11px;border-radius:999px;font-size:12px;color:var(--muted)}\n.chip:hover{color:var(--fg)}\n.trace{margin-top:8px;font:400 12px/1.5 var(--font-mono);color:var(--accent);min-height:18px}\n\nfooter{position:fixed;left:0;right:0;bottom:0;z-index:5;display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:end;gap:16px;\n  padding:56px max(16px,env(safe-area-inset-right,0px)) calc(env(safe-area-inset-bottom,0px) + 16px) max(16px,env(safe-area-inset-left,0px));\n  background:linear-gradient(transparent,rgba(6,8,12,.82));pointer-events:none}\nfooter>*{pointer-events:auto}\n.now{min-width:0;max-width:440px}\n.nk{font:400 11px/1.4 var(--font-mono);letter-spacing:.1em;color:var(--accent)}\n.nt{margin-top:2px;font:700 clamp(20px,2.4vw,30px)/1.15 var(--font-display);text-wrap:balance}\n.ns{margin-top:2px;color:var(--muted);font-size:12px}\n.nx{margin:8px 0 0;font-size:13px;color:rgba(238,242,247,.82);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}\n.pill{display:flex;align-items:center;gap:10px;padding:8px 20px 8px 10px;border-radius:999px;min-width:min(480px,100%);box-sizing:border-box;\n  background:rgba(18,22,28,.62);border:1px solid var(--line);backdrop-filter:blur(18px)}\n.ib{display:grid;place-items:center;width:34px;height:34px;flex:none;border:0;border-radius:50%;background:none;cursor:pointer;color:var(--fg)}\n.ib:hover{background:rgba(255,255,255,.12)}\n.ib svg{width:18px;height:18px;fill:currentColor}\n.ib.play{width:42px;height:42px;background:var(--fg);color:#06080c}\n.ib.play:hover{background:#fff}\n.time{font:400 11px var(--font-mono);font-variant-numeric:tabular-nums;color:var(--muted);flex:none}\n#bar{position:relative;flex:1;min-width:60px;height:22px;cursor:pointer;display:flex;align-items:center}\n#bar::before{content:\"\";position:absolute;left:0;right:0;height:4px;border-radius:2px;background:rgba(255,255,255,.2)}\n#fill{position:relative;display:block;height:4px;border-radius:2px;background:var(--fg);width:0}\n.side{justify-self:end;display:flex;flex-direction:column;align-items:flex-end;gap:8px;text-align:right;min-width:0}\n#add{border:1px solid var(--line);background:rgba(18,22,28,.62);backdrop-filter:blur(14px);cursor:pointer;padding:7px 16px;border-radius:999px;font-size:13px}\n#add:hover{background:rgba(255,255,255,.14)}\n#add[data-done=\"1\"]{color:var(--accent);cursor:default}\n.hint{font-size:11px;line-height:1.5;color:var(--muted)}\n\n#toast{position:fixed;left:50%;top:calc(env(safe-area-inset-top,0px) + 72px);transform:translate(-50%,-8px);z-index:8;max-width:calc(100% - 32px);padding:8px 16px;border-radius:999px;\n  background:rgba(238,242,247,.94);color:#06080c;font-size:13px;opacity:0;pointer-events:none;transition:opacity .25s,transform .25s}\n#toast.on{opacity:1;transform:translate(-50%,0)}\n\n@media (max-width:760px){\n  :root{--u:84px}\n  footer{grid-template-columns:minmax(0,1fr);gap:12px}\n  .pill{min-width:0;justify-self:stretch}\n  .side{justify-self:stretch;flex-direction:row;justify-content:space-between;align-items:center;text-align:left}\n  .hint span{display:none}\n  .nx{-webkit-line-clamp:1}\n}\n@media (prefers-reduced-motion:reduce){\n  .wall,.wall.warp,.stage,.stage.warp,.tile,.bg,#toast{transition-duration:.01s}\n}\n\n.scene{position:absolute;inset:0;transform-origin:50% 44%;will-change:transform,opacity}\n.empty-panel{position:absolute;left:50%;top:44%;transform:translate(-50%,-50%);width:min(460px,calc(100% - 48px));box-sizing:border-box;padding:32px;border:1px solid var(--line);border-radius:20px;background:rgba(14,18,24,.8);backdrop-filter:blur(20px)}\n.empty-panel h2{font:700 26px/1.3 var(--font-display);margin:12px 0}.empty-panel p{color:var(--muted);line-height:1.8;margin:0}\n#apple-region{max-width:100px;border:1px solid var(--line);border-radius:24px;background:#171c24;color:var(--text);padding:0 10px;font:inherit}#askf{flex-wrap:wrap}#askf input{min-width:140px;flex:1}header{padding-right:90px}.tile:disabled{cursor:default}button:disabled{opacity:.45;cursor:default}\n#apple-playlist{min-width:220px;max-width:65vw;border:1px solid var(--line);border-radius:30px;background:#171c24;color:var(--fg);padding:14px 22px;font:inherit}#askf input[hidden]{display:none}\n@media(max-width:760px){header{padding-right:72px}.bar{gap:12px}.brand span{display:none}.tabs{order:3;width:100%}.stage{perspective:1000px}.wall{top:43%}.hint{display:none}.nt{font-size:22px}.now{max-width:100%}}\n</style>\n\n<div class=\"bg\" id=\"bgA\"></div>\n<div class=\"bg\" id=\"bgB\"></div>\n\n<header>\n  <div class=\"bar\">\n    <div class=\"brand\">音樂日記<span>COVER WALL</span></div>\n    <div class=\"tabs\" role=\"tablist\" aria-label=\"板塊\">\n      <button class=\"tab\" role=\"tab\" id=\"tab-original\" data-tab=\"original\" aria-selected=\"false\">純音樂<b id=\"n-original\"></b></button>\n      <button class=\"tab\" role=\"tab\" id=\"tab-cover\" data-tab=\"cover\" aria-selected=\"false\">萤的翻唱<b id=\"n-cover\"></b></button>\n      <button class=\"tab\" role=\"tab\" id=\"tab-found\" data-tab=\"found\" aria-selected=\"true\">我的歌單<b id=\"n-found\"></b></button>\n    </div>\n    <div class=\"seg\" role=\"group\" aria-label=\"檢視方式\">\n      <button type=\"button\" id=\"v-flat\" aria-pressed=\"false\">平鋪</button>\n      <button type=\"button\" id=\"v-tilt\" aria-pressed=\"true\">斜視角</button>\n    </div>\n  </div>\n  <div class=\"ask\" id=\"ask\" hidden>\n    <form id=\"askf\">\n      <input id=\"q\" type=\"text\" placeholder=\"告訴 AI 你想聽什麼，例如：適合下雨天的鋼琴曲\" autocomplete=\"off\" aria-label=\"描述想找的歌\">\n      <button type=\"submit\">找歌</button>\n    </form>\n    <div class=\"chips\">\n      <button type=\"button\" class=\"chip\">適合下雨天的鋼琴曲</button>\n      <button type=\"button\" class=\"chip\">深夜回家路上聽的</button>\n      <button type=\"button\" class=\"chip\">咖啡店的爵士背景音樂</button>\n    </div>\n    <div class=\"trace\" id=\"trace\" aria-live=\"polite\"></div>\n  </div>\n</header>\n\n<main class=\"stage\" id=\"stage\">\n  <div class=\"scene\" id=\"scene\" data-phase=\"idle\"><div class=\"wall\" id=\"wall\"></div><section id=\"empty-panel\" class=\"empty-panel\" hidden><div class=\"nk\">MUSIC DIARY</div><h2></h2><p></p></section></div>\n</main>\n\n<footer>\n  <div class=\"now\">\n    <div class=\"nk\" id=\"nk\"></div>\n    <div class=\"nt\" id=\"nt\"></div>\n    <div class=\"ns\" id=\"ns\"></div>\n    <p class=\"nx\" id=\"nx\"></p>\n  </div>\n  <div class=\"pill\">\n    <button class=\"ib\" id=\"prev\" type=\"button\" aria-label=\"上一首\"><svg viewBox=\"0 0 24 24\"><path d=\"M6 5h2v14H6zM20 5v14L9.5 12z\"/></svg></button>\n    <button class=\"ib play\" id=\"play\" type=\"button\" aria-label=\"播放\"></button>\n    <button class=\"ib\" id=\"next\" type=\"button\" aria-label=\"下一首\"><svg viewBox=\"0 0 24 24\"><path d=\"M16 5h2v14h-2zM4 5l10.5 7L4 19z\"/></svg></button>\n    <span class=\"time\" id=\"cur\">00:00</span>\n    <div id=\"bar\" role=\"slider\" aria-label=\"播放進度\" tabindex=\"0\"><span id=\"fill\"></span></div>\n    <span class=\"time\" id=\"tot\">00:00</span>\n  </div>\n  <div class=\"side\">\n    <button id=\"add\" type=\"button\" hidden>加入日記</button>\n    <div class=\"hint\"><span>方向鍵切換 · 空格播放 · </span>示例數據，音頻為瀏覽器即時合成</div>\n  </div>\n</footer>\n<div id=\"toast\" role=\"status\"></div>\n\n<script>\n(function(){\n  var $=function(s,r){return (r||document).querySelector(s)};\n  function rng(seed){var t=seed>>>0;return function(){t+=0x6D2B79F5;var r=Math.imul(t^(t>>>15),1|t);r^=r+Math.imul(r^(r>>>7),61|r);return((r^(r>>>14))>>>0)/4294967296}}\n  var pad=function(n){return String(n).padStart(2,'0')};\n  var fmt=function(s){s=Math.max(0,Math.floor(s));return pad(Math.floor(s/60))+':'+pad(s%60)};\n\n  var ORIG=[], COVER=[], CATALOG=[];\n  /* ---------- generated covers ---------- */\n  var IMG={};\n  function cover(it){\n    var key=it.kind+it.seed;if(IMG[key])return IMG[key];\n    var c=document.createElement('canvas');c.width=c.height=320;var x=c.getContext('2d');\n    var r=rng(it.seed*7+3),h=it.hue,N=320,i,j,g;\n    if(it.kind==='original'){\n      g=x.createLinearGradient(0,0,0,N);\n      g.addColorStop(0,'hsl('+h+',45%,'+(10+r()*10)+'%)');g.addColorStop(.6,'hsl('+((h+25)%360)+',55%,'+(30+r()*15)+'%)');g.addColorStop(1,'hsl('+((h+50)%360)+',60%,'+(55+r()*15)+'%)');\n      x.fillStyle=g;x.fillRect(0,0,N,N);\n      var sx=60+r()*200,sy=50+r()*110,sr=24+r()*36;\n      g=x.createRadialGradient(sx,sy,0,sx,sy,sr*4);g.addColorStop(0,'hsla('+((h+40)%360)+',90%,85%,.55)');g.addColorStop(1,'hsla('+h+',90%,85%,0)');\n      x.fillStyle=g;x.fillRect(0,0,N,N);\n      x.fillStyle='hsla('+((h+40)%360)+',80%,90%,.95)';x.beginPath();x.arc(sx,sy,sr,0,7);x.fill();\n      for(i=0;i<4;i++){\n        x.fillStyle='hsl('+((h+10*i)%360)+',35%,'+(24-i*5)+'%)';x.beginPath();x.moveTo(0,N);\n        var base=170+i*38,a1=10+r()*22,f=.012+r()*.012,p=r()*6;\n        for(j=0;j<=N;j+=8)x.lineTo(j,base+Math.sin(j*f+p)*a1);\n        x.lineTo(N,N);x.closePath();x.fill();\n      }\n    }else if(it.kind==='cover'){\n      x.fillStyle='hsl('+h+',28%,90%)';x.fillRect(0,0,N,N);\n      var s=N/3;\n      for(i=0;i<3;i++)for(j=0;j<3;j++){\n        var px=i*s,py=j*s,col='hsl('+((h+r()*90)%360)+','+(55+r()*25)+'%,'+(52+r()*22)+'%)',m=Math.floor(r()*4);\n        x.fillStyle=col;x.beginPath();\n        if(m===0)x.rect(px,py,s,s);\n        else if(m===1)x.arc(px+s/2,py+s/2,s*.42,0,7);\n        else if(m===2){x.moveTo(px,py+s);x.arc(px,py+s,s,-Math.PI/2,0);x.lineTo(px,py+s)}\n        else{x.moveTo(px+s/2,py+s*.1);x.lineTo(px+s*.92,py+s*.9);x.lineTo(px+s*.08,py+s*.9)}\n        x.fill();\n      }\n    }else{\n      x.fillStyle='hsl('+h+',50%,14%)';x.fillRect(0,0,N,N);\n      var y0=0;\n      while(y0<N){var bh=18+r()*46;x.fillStyle='hsl('+((h+r()*70-20+360)%360)+',55%,'+(22+r()*28)+'%)';x.fillRect(0,y0,N,bh*.8);y0+=bh}\n      var cx=N*(.35+r()*.3),cy=N*(.35+r()*.3);\n      x.fillStyle='#0b0d11';x.beginPath();x.arc(cx,cy,108,0,7);x.fill();\n      for(i=0;i<9;i++){x.strokeStyle='rgba(255,255,255,'+(.05+r()*.07)+')';x.lineWidth=1;x.beginPath();x.arc(cx,cy,34+i*8,0,7);x.stroke()}\n      x.fillStyle='hsl('+((h+160)%360)+',70%,62%)';x.beginPath();x.arc(cx,cy,26,0,7);x.fill();\n      x.fillStyle='#0b0d11';x.beginPath();x.arc(cx,cy,4,0,7);x.fill();\n    }\n    for(i=0;i<260;i++){x.fillStyle='rgba(255,255,255,'+(r()*.06)+')';x.fillRect(r()*N,r()*N,1.5,1.5)}\n    IMG[key]=c.toDataURL('image/jpeg',.82);return IMG[key];\n  }\n\n\n  function send(type, extra){parent.postMessage(Object.assign({channel:'hotaru-wall',type:type},extra||{}),'*')}\n  function stopAudio(){send('pause')}\n  function startAudio(it){if(it)send('play',{id:it.id,time:S.t})}\n  /* ---------- state & view ---------- */\n  var S={tab:'found',sel:0,playing:false,t:0,view:'tilt',items:{original:ORIG,cover:COVER,found:CATALOG.slice()},tags:[]};\n  try{var sv=localStorage.getItem('wall-view');if(sv==='flat'||sv==='tilt')S.view=sv}catch(e){}\n  var wall=$('#wall'),tiles=[],bgi=0;\n  var cur=function(){return S.items[S.tab][S.sel]};\n  var U=function(){return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--u'))||116};\n  var cxy=function(t){return [t.offsetLeft+t.offsetWidth/2,t.offsetTop+t.offsetHeight/2]};\n\n  var PLAY='<svg viewBox=\"0 0 24 24\"><path d=\"M8 5v14l11-7z\"/></svg>',PAUSE='<svg viewBox=\"0 0 24 24\"><path d=\"M6 5h4v14H6zM14 5h4v14h-4z\"/></svg>';\n  function syncPlay(){var b=$('#play');b.innerHTML=S.playing?PAUSE:PLAY;b.setAttribute('aria-label',S.playing?'暫停':'播放')}\n  function progress(){var it=cur();if(!it){$('#cur').textContent='00:00';$('#tot').textContent='00:00';$('#fill').style.width='0%';$('#bar').setAttribute('aria-valuemin','0');$('#bar').setAttribute('aria-valuemax','0');$('#bar').setAttribute('aria-valuenow','0');$('#bar').setAttribute('aria-valuetext','00:00');return}$('#fill').style.width=Math.min(100,S.t/it.dur*100)+'%';$('#cur').textContent=fmt(S.t);$('#bar').setAttribute('aria-valuemin','0');$('#bar').setAttribute('aria-valuemax',it.dur);$('#bar').setAttribute('aria-valuenow',Math.floor(S.t));$('#bar').setAttribute('aria-valuetext',fmt(S.t));$('#tot').textContent=fmt(Math.round(it.dur))}\n  function info(){\n    var it=cur();if(!it){$('#nk').textContent=S.tab==='found'?'AI 找歌':'音樂日記';$('#nt').textContent=S.tab==='found'?'一起找下一首歌':'還沒有留下曲子';$('#ns').textContent='';$('#nx').textContent=S.tab==='found'?'找歌功能尚未接入，現在可以聽鋼琴與翻唱。':'對萤說「為今天的心情彈一小段」，留下第一段旋律。';$('#add').hidden=true;return}\n    $('#nk').textContent=it.kind==='original'?'AI 純音樂':it.kind==='cover'?'AI 翻唱':(it.hit?'AI 找到 · 匹配':'示例目錄');\n    $('#nt').textContent=it.title;\n    $('#ns').textContent=[it.sub,it.date].filter(Boolean).join(' · ');\n    $('#nx').textContent=it.text||'';\n    var add=$('#add');add.hidden=S.tab!=='found';\n    add.textContent=it.added?'已加入日記':'加入日記';add.dataset.done=it.added?'1':'';\n  }\n  function bgset(){\n    if(!cur())return;var a=$('#bgA'),b=$('#bgB'),next=bgi?a:b,prev=bgi?b:a;bgi^=1;\n    next.style.backgroundImage='url('+cover(cur())+')';next.classList.add('on');prev.classList.remove('on');\n  }\n  function depth(){\n    var s=tiles[S.sel];if(!s)return;var c=cxy(s),u=U()+4;\n    tiles.forEach(function(t){\n      var p=cxy(t),d=Math.hypot(p[0]-c[0],p[1]-c[1])/u;\n      var b=S.view==='tilt'?Math.min(4,Math.max(0,(d-1.6)*.55)):0;\n      t.style.setProperty('--b',b.toFixed(2)+'px');\n    });\n  }\n  function camera(instant){\n    var t=tiles[S.sel];if(!t)return;var c=cxy(t);\n    if(instant)wall.style.transition='none';\n    wall.style.transform=S.view==='tilt'\n      ?'rotateX(56deg) rotateZ(-36deg) translate3d('+(-c[0])+'px,'+(-c[1])+'px,0)'\n      :'translate3d('+(-c[0])+'px,'+(-c[1])+'px,0)';\n    if(instant){void wall.offsetWidth;wall.style.transition=''}\n  }\n  function select(i,o){\n    o=o||{};if(switching&&!o.instant)return;var n=tiles.length;if(!n){S.sel=0;S.t=0;S.playing=false;info();syncPlay();progress();return}i=((i%n)+n)%n;S.sel=i;S.t=0;\n    tiles.forEach(function(t,k){t.classList.toggle('on',k===i);t.setAttribute('aria-pressed',k===i?'true':'false')});\n    depth();camera(o.instant);info();bgset();\n    if(o.play)S.playing=!!cur().available;\n    if(S.playing)startAudio(cur());\n    syncPlay();progress();\n  }\n  function buildWall(){\n    var items=S.items[S.tab];wall.hidden=!items.length;wall.innerHTML='';tiles=[];\n    wall.style.setProperty('--cols',Math.max(2,Math.min(9,Math.ceil(Math.sqrt(items.length*2)))));\n    var r=rng(S.tab.length*131+items.length),P=[[1,1],[1,1],[1,1],[1,1],[1,1],[1,1],[1,2],[2,1],[2,2],[2,2],[3,2]];\n    var filtering=S.tab==='found'&&S.tags.length>0;\n    items.forEach(function(it,i){\n      var sp=items.length<5?[2,2]:i===0?[2,2]:P[Math.floor(r()*P.length)];\n      var b=document.createElement('button');b.type='button';\n      b.className='tile'+(sp[0]*sp[1]>=4?' big':'')+(filtering&&!it.hit?' miss':'');\n      b.style.gridColumn='span '+sp[0];b.style.gridRow='span '+sp[1];\n      b.style.backgroundImage='url('+cover(it)+')';b.dataset.i=i;b.dataset.id=it.id;b.setAttribute('aria-label',it.title);\n      var bd=document.createElement('span');bd.className='badge';bd.textContent=it.kind==='found'?'Apple Music':it.badge;\n      var m=document.createElement('span');m.className='meta';\n      var t=document.createElement('span');t.className='t';t.textContent=it.title;\n      var y=document.createElement('span');y.className='y';y.textContent=it.date||it.sub;\n      m.appendChild(t);m.appendChild(y);b.appendChild(bd);b.appendChild(m);\n      wall.appendChild(b);tiles.push(b);\n    });\n  }\n  // The scene owns tab motion; the wall owns the selected-song camera.\n  // Library polling must never reset either animation.\n  var ORDER=['original','cover','found'],rebuildId=0,switching=false,requestedTab=S.tab;\n  var remembered={original:null,cover:null,found:null};\n  var scene=$('#scene'),emptyPanel=$('#empty-panel');\n  function reducedMotion(){return window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches}\n  function emptyState(){\n    var empty=!S.items[S.tab].length;\n    emptyPanel.hidden=!empty;\n    emptyPanel.querySelector('h2').textContent=S.tab==='found'?'讓萤陪你找下一首歌':'這一頁，留給下一段旋律';\n    emptyPanel.querySelector('p').textContent=S.tab==='found'?'Apple Music 搜歌尚未接入。接好之後，推薦的歌曲會出現在這裡。':'和萤聊聊今天的心情，把它寫成一段鋼琴小品。';\n    $('#stage').dataset.board=S.tab;\n  }\n  function rebuild(dir,target){\n    var id=++rebuildId,st=$('#stage'),reduce=reducedMotion(),travel=dir*62;\n    switching=true;\n    scene.dataset.phase='exit';\n    scene.style.transition=reduce?'none':'transform 220ms cubic-bezier(.55,0,.9,.45), opacity 200ms ease-in';\n    scene.style.transform='translateX('+(-travel)+'vw) scale(1.06)';\n    scene.style.opacity='0';st.style.setProperty('--blur',reduce?'0px':'12px');\n    setTimeout(function(){\n      if(id!==rebuildId)return;\n      S.tab=target||S.tab;S.playing=false;\n      $('#ask').hidden=S.tab!=='found';\n      scene.dataset.phase='prepare';scene.style.transition='none';\n      scene.style.transform='translateX('+travel+'vw) scale(.94)';\n      buildWall();\n      var index=S.items[S.tab].findIndex(function(it){return it.id===remembered[S.tab]});\n      select(Math.max(0,index),{instant:true});emptyState();\n      // Commit the new scene offscreen, then animate on a separate painted frame.\n      void scene.offsetWidth;\n      requestAnimationFrame(function(){requestAnimationFrame(function(){\n        if(id!==rebuildId)return;\n        scene.dataset.phase='enter';\n        scene.style.transition=reduce?'none':'transform 650ms cubic-bezier(.16,1,.3,1), opacity 450ms ease-out';\n        scene.style.transform='translateX(0) scale(1)';scene.style.opacity='1';\n        st.style.setProperty('--blur','0px');\n        setTimeout(function(){if(id!==rebuildId)return;switching=false;scene.dataset.phase='idle'},reduce?0:650);\n      })});\n    },reduce?0:220);\n  }\n  function switchTab(n){\n    if(n===requestedTab)return;\n    if(!switching&&cur())remembered[S.tab]=cur().id;\n    var dir=ORDER.indexOf(n)>ORDER.indexOf(requestedTab)?1:-1;\n    requestedTab=n;stopAudio();S.playing=false;syncPlay();\n    document.querySelectorAll('.tab').forEach(function(b){b.setAttribute('aria-selected',b.dataset.tab===n?'true':'false')});\n    rebuild(dir,n);\n  }\n\n  /* brief blur pulse when flipping between flat and tilted */\n  function pulse(){\n    var st=$('#stage');st.classList.add('warp');st.style.setProperty('--blur','7px');\n    setTimeout(function(){st.classList.remove('warp');st.style.setProperty('--blur','0px')},240);\n  }\n\n  /* ---------- interactions ---------- */\n  function toggle(){if(switching)return;if(!cur()||!cur().available)return;S.playing=!S.playing;if(S.playing)startAudio(cur());else stopAudio();syncPlay()}\n  wall.addEventListener('click',function(e){\n    var t=e.target.closest('.tile');if(!t)return;var i=+t.dataset.i;\n    if(S.tab==='found'){select(i);return}if(i===S.sel)toggle();else select(i,{play:true});\n  });\n  $('#play').addEventListener('click',toggle);\n  $('#prev').addEventListener('click',function(){select(S.sel-1)});\n  $('#next').addEventListener('click',function(){select(S.sel+1)});\n  $('#bar').addEventListener('click',function(e){var b=this.getBoundingClientRect();if(!cur())return;S.t=Math.max(0,Math.min(1,(e.clientX-b.left)/b.width))*cur().dur;send('seek',{id:cur().id,time:S.t});progress()});\n  function setView(v){\n    S.view=v;try{localStorage.setItem('wall-view',v)}catch(e){}\n    $('#v-flat').setAttribute('aria-pressed',v==='flat'?'true':'false');$('#v-tilt').setAttribute('aria-pressed',v==='tilt'?'true':'false');\n    depth();camera();pulse();\n  }\n  $('#v-flat').addEventListener('click',function(){setView('flat')});\n  $('#v-tilt').addEventListener('click',function(){setView('tilt')});\n  document.querySelectorAll('.tab').forEach(function(b){b.addEventListener('click',function(){switchTab(b.dataset.tab)})});\n  var toastT;\n  function toast(m){var t=$('#toast');t.textContent=m;t.classList.add('on');clearTimeout(toastT);toastT=setTimeout(function(){t.classList.remove('on')},2600)}\n  $('#add').addEventListener('click',function(){if(cur())send('details',{id:cur().id})});\n  function move(dx,dy){\n    if(S.view==='tilt'){var a=36*Math.PI/180,ux=dx*Math.cos(a)-dy*Math.sin(a),uy=dx*Math.sin(a)+dy*Math.cos(a);dx=ux;dy=uy}\n    var s=tiles[S.sel];if(!s)return;var c=cxy(s),best=-1,bs=1e9;\n    tiles.forEach(function(t,k){\n      if(k===S.sel)return;var p=cxy(t),vx=p[0]-c[0],vy=p[1]-c[1],along=vx*dx+vy*dy;\n      if(along<=4)return;var across=Math.abs(vx*dy-vy*dx),sc=along+across*2;\n      if(sc<bs){bs=sc;best=k}\n    });\n    if(best>=0)select(best);\n  }\n  document.addEventListener('keydown',function(e){\n    if(e.key==='Escape'){send('close');return}if(e.target&&(/INPUT|TEXTAREA|BUTTON|SELECT/.test(e.target.tagName)||e.target.isContentEditable))return;\n    var k=e.key;\n    if(k==='ArrowLeft'){move(-1,0)}else if(k==='ArrowRight'){move(1,0)}else if(k==='ArrowUp'){move(0,-1)}else if(k==='ArrowDown'){move(0,1)}\n    else if(k===' '){toggle()}else return;\n    e.preventDefault();\n  });\n  var rz;window.addEventListener('resize',function(){clearTimeout(rz);rz=setTimeout(function(){depth();camera(true)},120)});\n\n\n  $('#bar').addEventListener('keydown',function(e){if(!cur())return;var delta=e.key==='ArrowRight'?5:e.key==='ArrowLeft'?-5:null;if(delta===null)return;e.preventDefault();e.stopPropagation();S.t=Math.max(0,Math.min(cur().dur,S.t+delta));send('seek',{id:cur().id,time:S.t});progress()});\n  var libraryLoaded=false;\n  var oldInfo=info;info=function(){oldInfo();if(cur()){$('#add').hidden=false;$('#add').textContent='日記與聽後感';$('#add').dataset.done='';$('#play').disabled=!cur().available;$('#nx').textContent=cur().text||cur().statusText||''}else{$('#play').disabled=true}};\n  window.addEventListener('message',function(e){\n    if(e.source!==parent||!e.data||e.data.channel!=='hotaru-host')return;var m=e.data;\n    if(m.type==='songs'){\n      var oldId=tiles[S.sel]&&tiles[S.sel].dataset.id;\n      function map(s,i){var hash=0;for(var k=0;k<s.id.length;k++)hash=(hash*31+s.id.charCodeAt(k))>>>0;\n        return {id:s.id,createdAt:s.createdAt||0,kind:s.kind==='cover'?'cover':'original',title:s.title,sub:s.kind==='cover'?'汐見螢 · 翻唱':'汐見螢 · 鋼琴小品',date:s.diaryDate||new Date(s.createdAt).toLocaleDateString(),dur:s.seconds||0,seed:hash,hue:hash%360,text:s.diaryText||s.reason||'',available:s.status==='completed'&&s.audioAvailable,statusText:s.status==='failed'?'創作未完成，打開日記可重試。':'音頻準備中或已清理。',badge:s.kind==='cover'?'翻唱':'鋼琴'}\n      }\n      var rows=m.songs.map(map).sort(function(a,b){return b.createdAt-a.createdAt||a.id.localeCompare(b.id)});S.items.original=rows.filter(function(s){return s.kind==='original'});S.items.cover=rows.filter(function(s){return s.kind==='cover'});\n      $('#n-original').textContent=S.items.original.length;$('#n-cover').textContent=S.items.cover.length;\n      if(S.tab!=='found'&&!libraryLoaded&&!oldId&&!S.items[S.tab].length&&rows.length){S.tab=rows[0].kind;requestedTab=S.tab}\n      if(rows.length)libraryLoaded=true;\n      if(switching)return;\n      document.querySelectorAll('.tab').forEach(function(b){b.setAttribute('aria-selected',b.dataset.tab===S.tab?'true':'false')});$('#ask').hidden=S.tab!=='found';\n      var idx=S.items[S.tab].findIndex(function(s){return s.id===oldId});\n      var before=tiles.map(function(t){return t.dataset.id}).join('|'),after=S.items[S.tab].map(function(s){return s.id}).join('|');\n      if(before!==after){\n        if(oldId&&idx<0){stopAudio();S.playing=false;S.t=0;syncPlay()}\n        buildWall();S.sel=idx>=0?idx:0;tiles.forEach(function(t,i){t.classList.toggle('on',i===S.sel)});depth();camera(!oldId);\n        if(!oldId||idx<0)bgset();\n      }\n      tiles.forEach(function(t,i){var it=S.items[S.tab][i];if(it){t.querySelector('.t').textContent=it.title;t.querySelector('.y').textContent=it.date||it.sub;t.setAttribute('aria-label',it.title);t.setAttribute('aria-pressed',i===S.sel?'true':'false')}});\n      info();progress();emptyState();\n    }else if(m.type==='state'){\n      if(cur()&&m.id===cur().id){S.playing=m.playing;S.t=m.time||0;syncPlay();progress();$('#bar').setAttribute('aria-valuenow',Math.floor(S.t));$('#bar').setAttribute('aria-valuemax',cur().dur)}\n    }else if(m.type==='error'){S.playing=false;syncPlay();toast(m.message)}\n    else if(m.type==='ended'){S.playing=false;syncPlay()}\n  });\n  $('#askf').addEventListener('submit',function(e){e.preventDefault()});\n  // A stable snapshot of one real playlist; playback never replaces its songs.\n  var playlistRequest=0,playlistId=null,playlistName='',playlistLoaded=false,libraryError='',playlistArtwork={};\n  var playlistSelect=document.createElement('select');playlistSelect.id='apple-playlist';playlistSelect.setAttribute('aria-label','Apple Music 歌單');\n  var loadingOption=document.createElement('option');loadingOption.textContent='正在讀取心水歌曲…';playlistSelect.appendChild(loadingOption);\n  $('#q').hidden=true;$('#askf button').hidden=true;$('.chips').hidden=true;$('#askf').appendChild(playlistSelect);\n  var refreshButton=document.createElement('button');refreshButton.type='button';refreshButton.textContent='刷新歌單';$('#askf').appendChild(refreshButton);\n  var suggestButton=document.createElement('button');suggestButton.type='button';suggestButton.textContent='讓萤推薦';$('#askf').appendChild(suggestButton);\n  suggestButton.addEventListener('click',function(){send('apple-suggest')});\n  playlistSelect.addEventListener('change',function(){requestPlaylist(playlistSelect.value)});\n  refreshButton.addEventListener('click',function(){if(playlistId)requestPlaylist(playlistId)});\n  function requestPlaylist(id){libraryError='';$('#trace').textContent='正在讀取歌單…';send('apple-playlist',{id:id,requestId:++playlistRequest})}\n  $('#trace').textContent='正在讀取心水歌曲…';\n  $('#ask').hidden=S.tab!=='found';\n  var diaryCover=cover;\n  cover=function(it){return it&&it.kind==='found'&&it.artworkUrl?it.artworkUrl:diaryCover(it)};\n  var diaryInfo=info;\n  info=function(){\n    diaryInfo();if(S.tab!=='found')return;$('#add').hidden=true;\n    if(cur()){$('#nk').textContent=playlistName||'我的歌單';$('#ns').textContent=cur().sub;$('#nx').textContent='來自 Apple Music · '+S.items.found.length+' 首歌曲'}\n    else{$('#nk').textContent='我的歌單';$('#nt').textContent=playlistName||'心水歌曲';$('#ns').textContent='';$('#nx').textContent=libraryError||'正在讀取你的歌單…'}\n  };\n  var diaryEmptyState=emptyState;\n  emptyState=function(){\n    diaryEmptyState();if(S.tab!=='found'||S.items.found.length)return;\n    emptyPanel.querySelector('h2').textContent=libraryError?'歌單暫時載入不了':playlistLoaded?'這張歌單還沒有歌曲':'正在讀取心水歌曲…';\n    emptyPanel.querySelector('p').textContent=libraryError||(playlistLoaded?'讓萤推薦幾首，選好後加入這張歌單。':'歌曲和封面會一起留在這裡。');\n  };\n  function wallItem(t,i){return {id:t.id,kind:'found',title:t.title,sub:t.artist+' · '+t.album,date:'',dur:t.duration||0,\n    artworkUrl:t.artworkUrl||playlistArtwork[t.id],seed:9000+i,hue:i*31,available:true,hit:true,badge:playlistName}}\n  var libraryRevision='',libraryRenderTurn=0;\n  var diarySelect=select,diaryStart=startAudio;\n  startAudio=function(it){if(it&&it.kind==='found'){S.playing=false;syncPlay()}diaryStart(it)};\n  function renderLibrary(m,turn){\n    if(turn!==libraryRenderTurn)return;\n    if(switching){setTimeout(function(){renderLibrary(m,turn)},80);return}\n    var old=cur(),same=playlistId===m.playlist.id,oldTime=S.t,wasPlaying=S.playing;\n    playlistId=m.playlist.id;playlistName=m.playlist.name;playlistSelect.value=playlistId;playlistLoaded=true;libraryError='';\n    var revision=playlistId+':'+m.tracks.map(function(t){return t.id}).join('|');\n    S.items.found=m.tracks.map(wallItem);$('#n-found').textContent=S.items.found.length;\n    if(S.tab==='found'){\n      if(revision!==libraryRevision){\n        S.playing=false;buildWall();var index=same&&old?S.items.found.findIndex(function(t){return t.id===old.id}):0;\n        diarySelect(Math.max(0,index),{instant:true});\n        if(same&&index>=0){S.t=oldTime;S.playing=wasPlaying}syncPlay();progress();\n      }\n      info();emptyState();\n    }\n    libraryRevision=revision;$('#trace').textContent=playlistName+' · 共 '+S.items.found.length+' 首';\n  }\n  function showCurrent(m){\n    if(S.tab!=='found'||!m.current)return;\n    var index=S.items.found.findIndex(function(t){return t.id===m.current.id});if(index<0)return;\n    S.playing=false;diarySelect(index,{instant:false});S.playing=Boolean(m.playing);S.t=m.time||0;syncPlay();progress();\n  }\n  window.addEventListener('message',function(e){\n    if(e.source!==parent||!e.data||e.data.channel!=='hotaru-host')return;var m=e.data;\n    if(m.type==='apple-playlists'){\n      playlistSelect.innerHTML='';(m.playlists||[]).forEach(function(p){var o=document.createElement('option');o.value=p.id;o.textContent=p.name;playlistSelect.appendChild(o)});\n      if(m.defaultId)playlistSelect.value=m.defaultId;\n    }else if(m.type==='apple-library'&&m.requestId===playlistRequest){renderLibrary(m,++libraryRenderTurn)}\n    else if(m.type==='apple-library-error'&&m.requestId===playlistRequest){libraryError=m.message;$('#trace').textContent=m.message;emptyState();info()}\n    else if(m.type==='apple-artwork'){\n      if(m.artworkUrl)playlistArtwork[m.id]=m.artworkUrl;\n      var item=S.items.found.find(function(t){return t.id===m.id});if(!item||!m.artworkUrl)return;item.artworkUrl=m.artworkUrl;\n      if(S.tab==='found'){var i=S.items.found.indexOf(item);if(tiles[i])tiles[i].style.backgroundImage='url(\"'+m.artworkUrl+'\")';if(cur()&&cur().id===m.id)bgset()}\n    }else if(m.type==='apple-current'){showCurrent(m)}\n    else if(m.type==='apple-notice'){$('#trace').textContent=/失败|失敗|未能|無法|无法|暂时|暂未|尚未|超时|未完成/.test(m.message||'')?m.message:playlistName+' · 共 '+S.items.found.length+' 首'}\n  });\n\n  $('.hint').textContent='方向鍵切換 · 空格播放 · 把心情留在旋律裡';\n  $('#v-flat').setAttribute('aria-pressed',S.view==='flat'?'true':'false');$('#v-tilt').setAttribute('aria-pressed',S.view==='tilt'?'true':'false');\n  $('#n-found').textContent='';buildWall();select(0,{instant:true});send('ready');\n})();\n</script></body></html>\n";
    // END MUSIC WALL DOCUMENT
    const pageOpenedAt = Date.now();
    const characterChoices = [
      ['emilia', '爱蜜莉雅'], ['rem', '雷姆'], ['ram', '拉姆'],
      ['beatrice', '贝蒂'], ['felt', '菲鲁特'], ['crusch', '库珥修'],
      ['anastasia', '安娜塔西亚'], ['echidna', '爱姬多娜'],
    ];
    const avatarNames = Object.fromEntries([...characterChoices, ['hotaru', '汐见萤']]);
    const speakerCache = new Map();
    function ReplyAvatar({ node, sessionId, directory, useChat }) {
      const selection = React.useSyncExternalStore(listener => directory.subscribe(listener), () => directory.getSnapshot());
      const initialSelection = React.useRef(selection.current);
      const tailMessage = useChat(snapshot => snapshot.timeline.turns.get(node.data?.turn)?.data.get('turn-tail')?.closing?.finalNode);
      const message = node.data?.finalNode || tailMessage;
      const messageId = message?.messageId;
      const cacheKey = `${sessionId}:${messageId}`;
      const [saved, setSaved] = React.useState(() => speakerCache.get(cacheKey) || null);
      const [failedImage, setFailedImage] = React.useState(false);
      React.useEffect(() => {
        if (!messageId) return;
        let active = true;
        setSaved(speakerCache.get(cacheKey) || null);
        void api(`/companion/reply-speaker?sessionId=${encodeURIComponent(sessionId)}&messageId=${encodeURIComponent(messageId)}`)
          .then(value => {
            if (value.speaker) speakerCache.set(cacheKey, value.speaker);
            if (active) setSaved(value.speaker);
          }).catch(() => {});
        return () => { active = false; };
      }, [sessionId, messageId]);
      const route = saved || message?.requestConfig || message?.providerMetadata
        || (node.data?.status === 'running' ? initialSelection.current : null) || {};
      const character = saved ? saved.character || (saved.mode === 'unknown' && saved.model === 'emilia-x1' ? 'emilia' : null) : route.provider === 'emilia-character'
        ? route.model === 'hotaru-v0.1' ? 'hotaru' : ['emilia-x1', 'emilia-companion'].includes(route.model) ? 'emilia' : null : null;
      const modelName = route.model === 'hotaru-v0.1' ? 'Hotaru V0.1' : route.model === 'emilia-x1' ? 'Emilia X1'
        : route.model === 'emilia-companion' ? 'Emilia' : route.model || '助手';
      const name = character && saved?.mode !== 'unknown' ? avatarNames[character] : modelName;
      const label = character && name !== modelName ? `${name} · ${modelName}` : saved?.mode === 'work' && route.model === 'emilia-x1'
        ? 'Emilia X1 · 工作模式' : modelName;
      const monogram = /deepseek/iu.test(`${route.provider} ${route.model}`) || saved?.mode === 'work' && route.model === 'emilia-x1' ? 'DS'
        : /qwen/iu.test(`${route.provider} ${route.model}`) ? 'Q' : name.slice(0, 1);
      const web = /^https?:$/.test(window.location.protocol);
      const src = character ? web ? `/api/emilia/avatar?id=${character}` : `${baseUrl}/companion/avatars/${character}` : '';
      React.useEffect(() => { setFailedImage(false); }, [src]);
      const illustration = character === 'emilia' ? { width: '200%', height: '200%', left: '-65%', top: '-35%', objectPosition: '50% 20%' }
        : character === 'hotaru' ? { width: '200%', height: '200%', left: '-70%', top: '-15%', objectPosition: '50% 15%' }
        : { width: '100%', height: '100%', left: 0, top: 0, objectPosition: 'center' };
      return h('div', { className: 'emilia-reply-identity', title: label },
        h('span', { className: 'emilia-reply-avatar', 'aria-label': `${name}头像`, role: 'img' },
          src && !failedImage ? h('img', { src, alt: '', loading: 'lazy', decoding: 'async', draggable: false,
            onError: () => setFailedImage(true), style: { position: 'absolute', objectFit: 'cover', ...illustration } }) : monogram),
        h('span', { className: 'emilia-reply-name' }, name));
    }
    const autoPlayedMessages = new Set();
    let currentVoice = null;
    let voiceContext = null;
    let currentMusic = null;

    async function musicAudio(id) {
      const path = `/companion/music/${id}/audio`;
      const web = /^https?:$/.test(window.location.protocol);
      const response = await fetch(web ? '/api/emilia' : `${baseUrl}${path}`, web
        ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, method: 'GET' }) }
        : { method: 'GET' });
      if (!response.ok || !/^audio\//u.test(response.headers.get('content-type') || '')) {
        let error = '音乐暂时无法播放'; try { error = (await response.json()).error || error; } catch { /* use default */ }
        throw new Error(error);
      }
      const blob = await response.blob();
      if (!blob.size) throw new Error('音乐文件为空');
      return blob;
    }

    function diaryMouth() {
      let id = null, generation = 0;
      return {
        stop() { generation++; const old = id; id = null; if (old) void api('/voice/lipsync/stop', 'POST', { id: old }).catch(() => {}); },
        heartbeat() { if (id) void api('/voice/lipsync/heartbeat', 'POST', { id }).catch(() => {}); },
        async start(player, prepare) {
          this.stop();
          if (/^https?:$/.test(window.location.protocol)) return;
          const turn = generation;
          try {
            const value = await prepare();
            if (turn !== generation || player.paused || player.ended) {
              void api('/voice/lipsync/stop', 'POST', { id: value.id }).catch(() => {}); return;
            }
            id = value.id;
            await api('/voice/lipsync/start', 'POST', { id, startedAt: Date.now() - player.currentTime * 1000 });
          } catch (e) { console.warn('[music-diary] mouth sync unavailable:', e.message); }
        },
      };
    }

    function DiaryVoice({ text, sessionId }) {
      const [src, setSrc] = React.useState(''), [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
      const audio = React.useRef(null), mouth = React.useRef(null), owner = React.useRef(null), pending = React.useRef(null);
      if (!mouth.current) mouth.current = diaryMouth();
      React.useEffect(() => () => { pending.current?.abort(); audio.current?.pause(); mouth.current.stop();
        if (currentVoice === owner.current) currentVoice = null; }, [text, sessionId]);
      React.useEffect(() => () => { if (src) URL.revokeObjectURL(src); }, [src]);
      return h('div', null,
        h('button', { type: 'button', style: { ...button, height: 28, fontSize: 12 }, disabled: busy,
          onClick: async () => { setBusy(true); setError(''); try {
            if (src) { await audio.current.play(); return; }
            currentMusic?.pause(); currentVoice?.stop();
            const controller = new AbortController(); pending.current = controller;
            const loadingOwner = { sessionId, stop: () => { controller.abort(); audio.current?.pause(); mouth.current.stop(); setBusy(false);
              if (currentVoice === loadingOwner) currentVoice = null; } };
            owner.current = loadingOwner; currentVoice = loadingOwner;
            const blob = await voiceAudio(text, controller.signal, 'hotaru', sessionId);
            if (!controller.signal.aborted && currentVoice === loadingOwner) setSrc(URL.createObjectURL(blob));
          } catch (e) { if (e.name !== 'AbortError') setError(e.message); } finally { setBusy(false); } } }, busy ? '准备语音…' : '听萤的寄语'),
        src && h('audio', { ref: audio, controls: true, src, autoPlay: true, style: { width: '100%', marginTop: 8 },
          onPlay: e => { currentMusic?.pause(); if (currentVoice !== owner.current) currentVoice?.stop(); const player = e.currentTarget;
            owner.current = { sessionId, stop: () => { player.pause(); mouth.current.stop(); } }; currentVoice = owner.current; },
          onPlaying: e => { void mouth.current.start(e.currentTarget, () => api('/voice/lipsync/prepare', 'POST', { text, speakerId: 'hotaru', sessionId })); },
          onSeeking: () => mouth.current.stop(), onSeeked: e => { if (!e.currentTarget.paused) void mouth.current.start(e.currentTarget,
            () => api('/voice/lipsync/prepare', 'POST', { text, speakerId: 'hotaru', sessionId })); },
          onPause: () => { mouth.current.stop(); if (currentVoice === owner.current) currentVoice = null; }, onEnded: () => { mouth.current.stop(); if (currentVoice === owner.current) currentVoice = null; } }),
        error && h('p', { role: 'alert', style: { color: colors.error } }, error));
    }

    function MusicCard({ song, onChange, sessionId }) {
      const [src, setSrc] = React.useState('');
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState('');
      const mouth = React.useRef(null);
      if (!mouth.current) mouth.current = diaryMouth();
      const [editing, setEditing] = React.useState(false);
      const [draft, setDraft] = React.useState({});
      const cover = song.kind === 'cover';
      function syncMouth(player) {
        if (cover && song.vocalAvailable) void mouth.current.start(player,
          () => api('/voice/lipsync/prepare-music', 'POST', { songId: song.id, sessionId }));
      }
      const audio = React.useRef(null);
      const played = React.useRef(false);
      const playbackToken = React.useRef(null);
      if (!playbackToken.current) playbackToken.current = crypto.randomUUID();
      const playbackQueue = React.useRef(Promise.resolve());
      function reportPlayback(phase) {
        playbackQueue.current = playbackQueue.current.catch(() => {}).then(() =>
          api(`/companion/music/${song.id}/playback`, 'POST', { phase, token: playbackToken.current, sessionId })).catch(() => {});
      }
      React.useEffect(() => {
        const player = audio.current;
        const heartbeat = setInterval(() => { if (player && !player.paused && !player.ended) { reportPlayback('playing'); mouth.current.heartbeat(); } }, 5000);
        return () => { clearInterval(heartbeat); player?.pause(); mouth.current.stop(); if (src) reportPlayback('stopped');
          if (currentMusic === player) currentMusic = null; if (src) URL.revokeObjectURL(src); };
      }, [src]);
      React.useEffect(() => {
        const stop = () => { audio.current?.pause(); mouth.current.stop(); };
        window.addEventListener('emilia-character-selected', stop);
        return () => { window.removeEventListener('emilia-character-selected', stop); stop(); };
      }, [sessionId]);
      React.useEffect(() => { if (src) void audio.current?.play().catch(() => {}); }, [src]);
      async function run(task) {
        setBusy(true); setError('');
        try { await task(); } catch (e) { setError(e.message); } finally { setBusy(false); }
      }
      const pending = ['planning', 'queued', 'generating'].includes(song.status);
      const status = { planning: '萤在构思这段旋律…', queued: '准备演奏…', generating: '正在写成钢琴小品…', failed: '这次创作没有完成' }[song.status];
      const smallButton = { ...button, height: 30, padding: '0 10px', fontSize: 12 };
      return h('article', { style: { border: `1px solid ${colors.border}`, borderRadius: 12, padding: 16, marginBottom: 12 } },
        h('div', { style: { display: 'flex', gap: 8, justifyContent: 'space-between', flexWrap: 'wrap' } },
          h('strong', { style: { fontSize: 15 } }, song.title),
          h('span', { style: { color: colors.muted, fontSize: 12 } }, `${song.diaryDate || new Date(song.createdAt).toLocaleDateString()} · ${cover ? '翻唱' : '钢琴小品'} · ${Math.floor(song.seconds / 60)}:${String(Math.round(song.seconds % 60)).padStart(2, '0')}`)),
        song.reason && h('p', { style: { margin: '10px 0', whiteSpace: 'pre-wrap' } }, song.reason),
        song.mood && h('p', { style: { ...intro, margin: '4px 0 12px', fontSize: 12 } }, song.mood),
        song.credits && h('p', { style: { ...intro, fontSize: 11 } }, song.credits),
        song.diaryText && h('div', { style: { margin: '10px 0' } },
          h('p', { style: { whiteSpace: 'pre-wrap' } }, `萤的寄语：${song.diaryText}`),
          h(DiaryVoice, { key: song.diaryText, text: song.diaryText, sessionId })),
        song.feedback && h('p', { style: { whiteSpace: 'pre-wrap' } }, `我的听后感：${song.feedback}`),
        pending && h('p', { role: 'status', style: intro }, status),
        song.status === 'failed' && h('p', { style: { color: colors.error } }, song.error || status),
        song.status === 'completed' && !song.audioAvailable && h('p', { style: intro }, cover ? '日记还在，翻唱音频暂不可用，请重新导入。' : '这段回忆还在，音频已清理。可以重新生成后重听。'),
        src && h('audio', { ref: audio, controls: true, src, preload: 'metadata', style: { width: '100%', marginBottom: 12 },
          onPlaying: event => { reportPlayback('playing'); syncMouth(event.currentTarget); },
          onSeeking: () => { mouth.current.stop(); reportPlayback('stopped'); },
          onSeeked: event => { if (!event.currentTarget.paused) { reportPlayback('playing'); syncMouth(event.currentTarget); } },
          onPause: () => { mouth.current.stop(); reportPlayback('stopped'); },
          onEnded: () => { mouth.current.stop(); reportPlayback('stopped'); },
          onWaiting: () => { mouth.current.stop(); reportPlayback('stopped'); },
          onPlay: event => {
            if (currentMusic && currentMusic !== event.currentTarget) currentMusic.pause();
            currentVoice?.stop(); currentMusic = event.currentTarget;
            if (!played.current) { played.current = true; void api(`/companion/music/${song.id}/played`, 'POST').then(onChange).catch(() => {}); }
          } }),
        h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
          song.status === 'completed' && song.audioAvailable && !src && h('button', { type: 'button', style: smallButton, disabled: busy,
            onClick: () => run(async () => { setSrc(URL.createObjectURL(await musicAudio(song.id))); }) }, busy ? '正在载入…' : '▶ 试听'),
          !cover && (song.status === 'failed' || song.status === 'completed' && !song.audioAvailable) && h('button', {
            type: 'button', style: smallButton, disabled: busy, onClick: () => run(async () => onChange(await api(`/companion/music/${song.id}/retry`, 'POST'))) }, '重新生成'),
          song.status === 'completed' && h('button', { type: 'button', style: smallButton, disabled: busy,
            onClick: () => run(async () => onChange(await api(`/companion/music/${song.id}`, 'PUT', { liked: !song.liked }))) }, song.liked ? '♥ 喜欢这首' : '♡ 喜欢这首'),
          song.status === 'completed' && h('button', { type: 'button', style: smallButton, disabled: busy,
            onClick: () => run(async () => onChange(await api(`/companion/music/${song.id}`, 'PUT', { pinned: !song.pinned }))) }, song.pinned ? '已收藏' : '收藏音频'),
          !pending && h('button', { type: 'button', style: smallButton, disabled: busy, onClick: () => {
            setDraft({ title: song.title, diaryDate: song.diaryDate || new Date(song.createdAt).toLocaleDateString('en-CA'), diaryText: song.diaryText || '', feedback: song.feedback || '' }); setEditing(true);
          } }, '编辑日记 / 写听后感'),
          h('button', { type: 'button', style: smallButton, disabled: busy, onClick: () => run(async () => {
            await api(`/companion/music/${song.id}`, 'DELETE'); onChange({ ...song, status: 'forgotten' });
          }) }, pending ? '取消创作' : '移除')),
        editing && h('form', { onSubmit: event => { event.preventDefault(); void run(async () => {
          const updated = await api(`/companion/music/${song.id}`, 'PUT', draft); onChange(updated); setEditing(false);
        }); }, style: { display: 'grid', gap: 8, marginTop: 12 } },
          ...[['title', '标题', 'text', 80], ['diaryDate', '日记日期', 'date', 10]].map(([key, label, type, maxLength]) => h('label', { key }, label,
            h('input', { type, required: true, maxLength, value: draft[key] || '', style: { ...field, width: '100%', boxSizing: 'border-box' }, onChange: e => setDraft(d => ({ ...d, [key]: e.target.value })) }))),
          ...[['diaryText', '萤的寄语', 1000], ['feedback', '我的听后感', 2000]].map(([key, label, maxLength]) => h('label', { key }, label,
            h('textarea', { maxLength, rows: 3, value: draft[key] || '', style: { ...field, height: 'auto', width: '100%', boxSizing: 'border-box' }, onChange: e => setDraft(d => ({ ...d, [key]: e.target.value })) }))),
          h('div', null, h('button', { type: 'submit', style: smallButton, disabled: busy }, '保存日记'),
            h('button', { type: 'button', style: smallButton, onClick: () => setEditing(false) }, '取消'))),
        error && h('p', { role: 'alert', style: { color: colors.error, marginBottom: 0 } }, error));
    }

    function MusicRecommendationDialog({ sessionId, reply = null, initialTracks = [], onClose }) {
      const ref = React.useRef(null);
      const [tracks, setTracks] = React.useState(initialTracks);
      const [sourceReply, setSourceReply] = React.useState(reply);
      const [lists, setLists] = React.useState([]), [playlistId, setPlaylistId] = React.useState('');
      const [selected, setSelected] = React.useState(null), [prompt, setPrompt] = React.useState('');
      const [busy, setBusy] = React.useState(false), [error, setError] = React.useState(''), [notice, setNotice] = React.useState('');
      const [added, setAdded] = React.useState({});
      React.useEffect(() => { ref.current?.showModal(); return () => ref.current?.close(); }, []);
      React.useEffect(() => {
        let active = true;
        void api('/companion/music/apple/playlists').then(data => {
          if (!active) return; setLists(data.playlists.filter(p => p.writable));
          setPlaylistId(data.playlists.find(p => p.writable && p.id === data.defaultId)?.id || data.playlists.find(p => p.writable)?.id || '');
        }).catch(e => { if (active) setError(e.message); });
        return () => { active = false; };
      }, []);
      async function suggest(event) {
        event.preventDefault(); setBusy(true); setError(''); setNotice(''); setSelected(null);
        try { const data = await api('/companion/music/apple/suggest', 'POST', { prompt }); setTracks(data.tracks); setSourceReply(null); }
        catch (e) { setError(e.message); } finally { setBusy(false); }
      }
      async function add() {
        if (!selected || !playlistId) return;
        setBusy(true); setError(''); setNotice('');
        try {
          const result = await api('/companion/music/apple/playlist-add', 'POST', { id: selected, playlistId, sessionId, reply: sourceReply });
          if (!result.added) throw new Error('Apple Music 尚未确认加入，请稍后重试。');
          setAdded(value => ({ ...value, [selected + ':' + playlistId]: true }));
          setNotice(`${result.alreadyPresent ? '已经在' : '已加入'}「${result.playlist.name}」`);
          window.dispatchEvent(new CustomEvent('hotaru-playlist-updated', { detail: { playlistId } }));
        } catch (e) { setError(e.message); } finally { setBusy(false); }
      }
      const popupButton = { ...button, border: '1px solid #ffffff30', background: '#26344b', color: '#eff5ff' };
      return renderDialog({ ref, onCancel: onClose, onClose, 'aria-label': '萤的歌曲推荐', style: {
        ...typography, position: 'fixed', inset: 0, margin: 'auto', width: 'min(820px, calc(100vw - 32px))',
        maxHeight: '82dvh', overflowY: 'auto', boxSizing: 'border-box', padding: 24, borderRadius: 22,
        border: '1px solid #ffffff28', background: '#111824', color: '#eff5ff', boxShadow: '0 24px 100px #0009', WebkitAppRegion: 'no-drag',
      } },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center' } },
          h('h2', { style: { margin: 0, fontSize: 23 } }, '萤的推荐'), h('button', { type: 'button', style: popupButton, onClick: onClose }, '关闭')),
        h('p', { style: { color: '#aebbd0' } }, '选一首，再加入你想收藏的 Apple Music 歌单。'),
        h('form', { onSubmit: suggest, style: { display: 'flex', gap: 10, marginBottom: 18 } },
          h('input', { value: prompt, required: true, maxLength: 500, disabled: busy, placeholder: '想听什么？例如，适合夜晚散步的日语歌',
            'aria-label': '告诉萤你想听什么', onChange: e => setPrompt(e.target.value), style: { ...field, flex: 1, minWidth: 100, color: '#eff5ff', background: '#1c283b' } }),
          h('button', { type: 'submit', style: popupButton, disabled: busy }, busy ? '正在整理…' : '帮我推荐')),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 12 } },
          ...tracks.map(track => h('button', { key: track.id, type: 'button', disabled: busy, 'aria-pressed': selected === track.id,
            onClick: () => { setSelected(track.id); setNotice(''); }, style: { display: 'flex', gap: 12, textAlign: 'left', alignItems: 'flex-start',
              padding: 14, borderRadius: 14, cursor: 'pointer', color: '#eff5ff', background: selected === track.id ? '#243b54' : '#192434',
              border: `1px solid ${selected === track.id ? '#8fd3ff' : '#ffffff20'}` } },
            track.artworkUrl && h('img', { src: track.artworkUrl, alt: '', width: 66, height: 66, style: { borderRadius: 9, objectFit: 'cover' } }),
            h('span', null, h('strong', null, track.title), h('span', { style: { display: 'block', color: '#acbdd4', marginTop: 3 } }, track.artist),
              h('span', { style: { display: 'block', color: '#b4c9df', fontSize: 12, marginTop: 7 } }, track.recommendationReason || track.album))))),
        h('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 20, alignItems: 'center' } },
          h('label', null, '加入歌单 ', h('select', { value: playlistId, disabled: busy, 'aria-label': '加入哪个 Apple Music 歌单', onChange: e => { setPlaylistId(e.target.value); setNotice(''); },
            style: { ...field, width: 'auto', color: '#eff5ff', background: '#1c283b' } }, ...lists.map(list => h('option', { key: list.id, value: list.id }, list.name)))),
          h('button', { type: 'button', style: { ...popupButton, background: '#8fd3ff', color: '#0b192a' },
            disabled: busy || !selected || !playlistId || added[selected + ':' + playlistId], onClick: add }, busy ? '正在处理…' : added[selected + ':' + playlistId] ? '已加入' : '加入歌单')),
        error && h('p', { role: 'alert', style: { color: '#ffaaaa' } }, error),
        notice && h('p', { role: 'status', style: { color: '#a1e3c2' } }, notice));
    }

    function MusicWall({ songs, sessionId, onChange, onClose }) {
      const frame = React.useRef(null), latest = React.useRef(songs), player = React.useRef(null);
      const playbackOwner = React.useRef(null);
      const [detailId, setDetailId] = React.useState(null);
      const [recommendOpen, setRecommendOpen] = React.useState(false);
      latest.current = songs;
      const send = value => frame.current?.contentWindow?.postMessage({ channel: 'hotaru-host', ...value }, '*');
      React.useEffect(() => { send({ type: 'songs', songs }); }, [songs]);
      React.useEffect(() => {
        const audio = new Audio(); player.current = audio;
        const mouth = diaryMouth();
        let active = true, generation = 0, song = null, src = '', token = '', counted = false;
        let found = [], searchGeneration = 0, external = null, externalPosition = 0, externalGeneration = 0, checkingExternal = false, externalVerified = false;
        let recommendationsStarted = false, followingApple = false;
        let libraryId = null, libraryGeneration = 0, libraryRequestId = 0;
        const artworkCache = new Map();
        let pendingExternalStop = Promise.resolve();
        async function loadPlaylist(id, requestId = 0) {
          const turn = ++libraryGeneration; libraryRequestId = requestId;
          if (libraryId && libraryId !== id) stopExternal();
          libraryId = id;
          try {
            const result = await api(`/companion/music/apple/playlist-tracks?id=${encodeURIComponent(id)}`);
            if (!active || turn !== libraryGeneration) return;
            found = result.tracks.map(t => ({ ...t, artworkUrl: artworkCache.get(t.id) || t.artworkUrl }));
            send({ type: 'apple-library', ...result, tracks: found, requestId });
            const rows = found; let cursor = 0;
            await Promise.all(Array.from({ length: 3 }, async () => {
              while (active && turn === libraryGeneration && cursor < rows.length) {
                const item = rows[cursor++]; if (item.artworkUrl) continue;
                try {
                  const image = await api('/companion/music/apple/artwork', 'POST', { id: item.id });
                  if (!active || turn !== libraryGeneration) return;
                  if (image.artworkUrl) { artworkCache.set(item.id, image.artworkUrl); item.artworkUrl = image.artworkUrl; send({ type: 'apple-artwork', ...image }); }
                } catch { /* Keep the track visible when artwork is unavailable. */ }
              }
            }));
          } catch (e) { if (active && turn === libraryGeneration) send({ type: 'apple-library-error', requestId, message: e.message }); }
        }
        async function initializeLibrary() {
          try {
            const lists = await api('/companion/music/apple/playlists');
            if (!active) return; send({ type: 'apple-playlists', ...lists });
            if (lists.defaultId) void loadPlaylist(lists.defaultId);
            else send({ type: 'apple-library-error', requestId: 0, message: '没有可读取的 Apple Music 歌单。' });
          } catch (e) { if (active) send({ type: 'apple-library-error', requestId: 0, message: e.message }); }
        }
        async function searchApple(value) {
          const turn = ++searchGeneration, recommended = value.type === 'apple-recommend';
          if (recommended) send({ type: 'apple-loading', requestId: value.requestId });
          try {
            const result = await api(`/companion/music/apple/${recommended ? 'recommend' : 'search'}`, 'POST',
              { query: value.query, country: value.country });
            if (!active || turn !== searchGeneration) return;
            stopExternal(); found = result.tracks;
            send({ type: 'apple-results', tracks: found, requestId: value.requestId, country: value.country,
              mode: recommended ? 'recommendations' : 'search', basis: result.basis, partial: result.partial });
          } catch (e) { if (active && turn === searchGeneration) send({ type: 'apple-results', error: e.message,
            requestId: value.requestId, mode: recommended ? 'recommendations' : 'search' }); }
        }
        const externalOwner = { pause: () => stop() };
        function stopExternal() {
          const previous = external; external = null; externalGeneration++;
          externalVerified = false;
          followingApple = false;
          if (currentMusic === externalOwner) currentMusic = null;
          if (previous) {
            send({ type: 'state', id: previous.id, playing: false, time: externalPosition });
            pendingExternalStop = pendingExternalStop.catch(() => {}).then(() =>
              api('/companion/music/apple/control', 'POST', { id: previous.id, action: 'pause' })).catch(() => {});
          }
        }
        async function externalState() {
          if (!active || !external || checkingExternal || pendingExternalId) return;
          checkingExternal = true; const target = external;
          try {
            const state = await api(`/companion/music/apple/session?id=${encodeURIComponent(target.id)}&follow=${followingApple ? 1 : 0}`);
            if (active && external === target) {
              if (target.playlistId && externalVerified && state.state === 'stopped'
                  && (!state.track || state.matched) && target.duration > 0 && externalPosition >= target.duration - 3) {
                // Music plays each library track with once=true, so it cannot
                // fall through into its old queue. Only this snapshot advances.
                externalVerified = false; followingApple = false;
                const index = found.findIndex(item => item.id === target.id);
                const next = index >= 0 ? found[index + 1] : null;
                if (next && next.playlistId === target.playlistId) {
                  send({ type: 'apple-current', current: next, playing: false, time: 0 });
                  await openExternal(next); return;
                }
              }
              if (followingApple && state.current && state.current.id !== target.id) {
                external = state.current;
                send({ type: 'apple-current', current: external, playing: state.state === 'playing', time: state.position || 0 });
              }
              const matched = Boolean(state.current && state.current.id === external.id) || state.matched;
              externalPosition = matched ? state.position || 0 : 0;
              if (matched && state.state === 'playing' && !externalVerified) {
                externalVerified = true;
                followingApple = true;
                send({ type: 'apple-notice', message: '已核對：正在官方 Apple Music 背景播放。' });
              }
              send({ type: 'state', id: external.id, playing: Boolean(matched && state.state === 'playing'), time: externalPosition });
            }
          } catch (e) { if (active && external === target) send({ type: 'apple-notice', message: e.message }); }
          finally { checkingExternal = false; }
        }
        let pendingExternalId = null;
        async function openExternal(item, time = 0, forceOpen = false) {
          if (pendingExternalId === item.id) return;
          const same = external?.id === item.id;
          generation++; audio.pause(); mouth.stop(); report('stopped');
          if (!same) stopExternal();
          if (currentMusic && currentMusic !== externalOwner && currentMusic !== audio) currentMusic.pause();
          currentVoice?.stop(); currentMusic = externalOwner;
          external = item; externalVerified = false; followingApple = false; pendingExternalId = item.id; const turn = ++externalGeneration;
          send({ type: 'apple-notice', message: forceOpen ? '正在開啟 Apple Music…' : '正在播放…' });
          try {
            await pendingExternalStop;
            if (!active || turn !== externalGeneration) return;
            const state = forceOpen
              ? await api('/companion/music/apple/open', 'POST', { id: item.id, foreground: true })
              : await api('/companion/music/apple/play', 'POST', { id: item.id, position: time });
            if (!active || turn !== externalGeneration) return;
            externalVerified = Boolean(state.verified); followingApple = Boolean(state.verified);
            externalPosition = state.verified ? state.position || 0 : 0;
            send({ type: 'state', id: item.id, playing: Boolean(state.verified), time: state.verified ? state.position || 0 : 0 });
            send({ type: 'apple-notice', message: state.verified ? '已核對：正在官方 Apple Music 背景播放。'
              : forceOpen ? '已在「音樂」定位歌曲，請在官方客戶端點播放；此頁會同步進度。'
              : state.needsClient || state.running === false
                ? state.message || '原生接口暫時無法播放此曲；需要時點「在 Apple Music 開啟」，不會自動彈窗。'
                : '已送出背景播放請求，正在等待官方播放器確認…' });
          } catch (e) {
            if (active && turn === externalGeneration) send({ type: 'apple-notice', message: e.message });
          } finally { if (pendingExternalId === item.id) { pendingExternalId = null; void externalState(); } }
        }
        let queue = Promise.resolve();
        function report(phase) {
          if (!song) return;
          const id = song.id, playback = token;
          queue = queue.catch(() => {}).then(() => api(`/companion/music/${id}/playback`, 'POST', { phase, token: playback, sessionId })).catch(() => {});
        }
        function state() { if (song) send({ type: 'state', id: song.id, playing: !audio.paused && !audio.ended, time: audio.currentTime }); }
        function stop() { generation++; audio.pause(); mouth.stop(); stopExternal(); report('stopped'); state(); }
        playbackOwner.current = { get id() { return song?.id; }, stop };
        function sync() { if (song?.kind === 'cover' && song.vocalAvailable) {
          const id = song.id;
          void mouth.start(audio, () => api('/voice/lipsync/prepare-music', 'POST', { songId: id, sessionId }));
        } }
        audio.onplay = () => {
          if (currentMusic && currentMusic !== audio) currentMusic.pause();
          currentVoice?.stop(); currentMusic = audio;
          if (!counted && song) { counted = true; void api(`/companion/music/${song.id}/played`, 'POST').then(value => { if (active) onChange(value); }).catch(() => {}); }
          state();
        };
        audio.onplaying = () => { report('playing'); sync(); state(); };
        audio.onpause = () => { mouth.stop(); report('stopped'); state(); };
        audio.onwaiting = () => { mouth.stop(); report('stopped'); };
        audio.onseeking = () => { mouth.stop(); report('stopped'); };
        audio.onseeked = () => { if (!audio.paused) { report('playing'); sync(); } state(); };
        audio.ontimeupdate = state;
        audio.onended = () => { mouth.stop(); report('stopped'); state(); send({ type: 'ended' }); };
        audio.onerror = () => { mouth.stop(); report('stopped'); send({ type: 'error', message: '音頻播放失敗，請重試。' }); };
        async function message(event) {
          if (event.source !== frame.current?.contentWindow || event.data?.channel !== 'hotaru-wall') return;
          const value = event.data;
          if (value.type === 'close') { onClose(); return; }
          if (value.type === 'ready') {
            send({ type: 'songs', songs: latest.current });
            if (!recommendationsStarted) { recommendationsStarted = true; void initializeLibrary(); }
            return;
          }
          if (value.type === 'apple-playlist') { void loadPlaylist(value.id, value.requestId); return; }
          if (value.type === 'apple-suggest') { setRecommendOpen(true); return; }
          if (value.type === 'pause') { stop(); return; }
          if (value.type === 'apple-follow') {
            try {
              const state = await api('/companion/music/apple/session?follow=1');
              if (!active) return;
              if (!state.current) throw new Error('官方播放器当前没有可同步的歌曲。');
              found = [state.current, ...found.filter(t => t.id !== state.current.id)];
              send({ type: 'apple-current', current: state.current, playing: state.state === 'playing', time: state.position || 0 });
              await openExternal(state.current, state.position || 0);
            } catch (e) { if (active) send({ type: 'apple-notice', message: e.message }); }
            return;
          }
          if (value.type === 'apple-search' || value.type === 'apple-recommend') { await searchApple(value); return; }
          if (value.type === 'apple-control' && external?.id === value.id && ['next', 'previous'].includes(value.action)) {
            try {
              await api('/companion/music/apple/control', 'POST', { id: value.id, action: value.action });
              void externalState();
            } catch (e) { if (active) send({ type: 'apple-notice', message: e.message }); }
            return;
          }
          const externalItem = found.find(item => item.id === value.id);
          if (externalItem) {
            if (value.type === 'details' || value.type === 'apple-open') { await openExternal(externalItem, 0, true); return; }
            const position = Number(value.time);
            if (!Number.isFinite(position)) return;
            if (value.type === 'play') await openExternal(externalItem, Math.max(0, Math.min(externalItem.duration, position)));
            else if (value.type === 'seek' && external?.id === externalItem.id) {
              try { await api('/companion/music/apple/control', 'POST', { id: externalItem.id, action: 'seek', position: Math.max(0, Math.min(externalItem.duration, position)) }); void externalState(); }
              catch (e) { if (active) send({ type: 'apple-notice', message: e.message }); }
            }
            return;
          }
          const item = latest.current.find(s => s.id === value.id);
          if (!item) return;
          if (value.type === 'details') { stop(); setDetailId(item.id); return; }
          const time = Number(value.time);
          if (!Number.isFinite(time)) return;
          if (value.type === 'seek') { if (song?.id === item.id && src) audio.currentTime = Math.max(0, Math.min(item.seconds, time)); return; }
          if (value.type !== 'play' || item.status !== 'completed' || !item.audioAvailable) return;
          const turn = ++generation;
          try {
            if (external) {
              const previous = external; external = null; externalGeneration++;
              if (currentMusic === externalOwner) currentMusic = null;
              await api('/companion/music/apple/control', 'POST', { id: previous.id, action: 'pause' });
              if (!active || turn !== generation) return;
            }
            if (song?.id !== item.id || !src) {
              audio.pause(); mouth.stop(); report('stopped');
              song = item; token = crypto.randomUUID(); counted = false;
              if (src) URL.revokeObjectURL(src); src = ''; audio.removeAttribute('src');
              const blob = await musicAudio(item.id);
              if (!active || turn !== generation) return;
              src = URL.createObjectURL(blob); audio.src = src;
            }
            if (!active || turn !== generation) return;
            audio.currentTime = Math.max(0, Math.min(item.seconds, time));
            await audio.play();
          } catch (e) { if (active && turn === generation) send({ type: 'error', message: e.message }); }
        }
        window.addEventListener('message', message);
        const playlistChanged = event => { if (active && event.detail?.playlistId === libraryId) void loadPlaylist(libraryId, libraryRequestId); };
        window.addEventListener('hotaru-playlist-updated', playlistChanged);
        window.addEventListener('emilia-character-selected', stop);
        const timer = setInterval(() => { if (!audio.paused && !audio.ended) { report('playing'); mouth.heartbeat(); } }, 5000);
        const appleTimer = setInterval(() => { void externalState(); }, 2000);
        return () => {
          active = false; stop(); clearInterval(timer); clearInterval(appleTimer);
          window.removeEventListener('message', message); window.removeEventListener('emilia-character-selected', stop);
          window.removeEventListener('hotaru-playlist-updated', playlistChanged);
          audio.removeAttribute('src'); audio.load(); if (src) URL.revokeObjectURL(src);
          if (currentMusic === audio) currentMusic = null;
          playbackOwner.current = null;
        };
      }, [sessionId]);
      React.useEffect(() => {
        // A refresh may remove the active item while audio is already loaded.
        if (detailId && !songs.some(s => s.id === detailId)) setDetailId(null);
        if (playbackOwner.current?.id && !songs.some(s => s.id === playbackOwner.current.id)) playbackOwner.current.stop();
      }, [songs, detailId]);
      const detail = songs.find(s => s.id === detailId);
      return h(React.Fragment, null,
        h('iframe', { ref: frame, title: '音樂日記封面牆', srcDoc: musicWallDocument,
          style: { display: 'block', border: 0, width: '100%', height: '100%', background: '#06080c', WebkitAppRegion: 'no-drag' } }),
        recommendOpen && h(MusicRecommendationDialog, { sessionId, onClose: () => setRecommendOpen(false) }),
        detail && h('section', { role: 'region', 'aria-label': '歌曲日記', style: {
          position: 'absolute', right: 12, top: 64, bottom: 12, width: 'min(520px, calc(100% - 24px))', overflowY: 'auto',
          zIndex: 2, padding: 18, boxSizing: 'border-box', borderRadius: 16, background: '#12161cf5', color: '#eef2f7',
          border: '1px solid #ffffff24', boxShadow: '0 20px 80px #0009',
          '--dsw-alias-label-primary': '#eef2f7', '--dsw-alias-label-tertiary': '#a5afbf',
          '--dsw-alias-border-l3': '#ffffff30', '--dsw-alias-bg-layer-2': '#202630',
        } }, h('button', { type: 'button', autoFocus: true, style: { ...button, marginBottom: 12 }, onClick: () => setDetailId(null) }, '返回封面牆'),
          h(MusicCard, { key: detail.id, song: detail, sessionId, onChange })));
    }

    function MusicDialog({ onClose, initialSong = null, source = null, sessionId, onSongChange }) {
      const ref = React.useRef(null);
      const [songs, setSongs] = React.useState(initialSong ? [initialSong] : []);
      const [seconds, setSeconds] = React.useState(30);
      const [kind, setKind] = React.useState('all');
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState('');
      React.useEffect(() => { ref.current?.showModal(); return () => { ref.current?.close(); }; }, []);
      React.useEffect(() => {
        let active = true;
        const refresh = async () => {
          try {
            let rows;
            if (initialSong) rows = [await api(`/companion/music/${initialSong.id}`)];
            else if (source) { const value = await api('/companion/music/source', 'POST', { sessionId, reply: source });
              rows = value.song ? [value.song] : [];
              if (active) setError(value.intent?.status === 'failed' ? value.intent.error : ''); }
            else rows = await api('/companion/music');
            if (active) setSongs(rows.filter(s => s.status !== 'forgotten'));
          } catch (e) { if (active) setError(e.message); }
        };
        void refresh();
        const timer = setInterval(() => { void refresh(); }, 1800);
        return () => { active = false; clearInterval(timer); };
      }, [initialSong?.id, source, sessionId]);
      function changed(song) {
        onSongChange?.(song.status === 'forgotten' ? null : song);
        if (song.status === 'forgotten' && initialSong) { onClose(); return; }
        setSongs(rows => song.status === 'forgotten' ? rows.filter(s => s.id !== song.id)
          : rows.some(s => s.id === song.id) ? rows.map(s => s.id === song.id ? song : s) : [song, ...rows]);
      }
      async function compose() {
        setBusy(true); setError('');
        try { changed(await api('/companion/music', 'POST', { sessionId, reply: source, seconds })); }
        catch (e) { setError(e.message); } finally { setBusy(false); }
      }
      if (!initialSong && !source) return renderDialog({ ref, onCancel: onClose, onClose,
        'aria-label': '萤的音乐日记', style: { ...typography, position: 'fixed', inset: 0, margin: 'auto',
          width: 'calc(100vw - 24px)', height: 'calc(100dvh - 24px)', maxWidth: 'none', maxHeight: 'none',
          padding: 0, overflow: 'hidden', border: '1px solid #ffffff24', borderRadius: 16, background: '#06080c' } },
        h(MusicWall, { songs, sessionId, onChange: changed, onClose }),
        h('button', { type: 'button', onClick: onClose, 'aria-label': '关闭音乐日记', style: {
          position: 'absolute', zIndex: 3, top: 12, right: 12, border: '1px solid #ffffff30', borderRadius: 24,
          background: '#1b2029dd', color: '#eef2f7', padding: '6px 12px', cursor: 'pointer', fontSize: 12,
        } }, '關閉'),
        error && h('p', { role: 'alert', style: { position: 'absolute', top: 72, left: 24, color: '#ffabab' } }, error));
      return renderDialog({ ref, onCancel: onClose, onClose, style: {
        ...typography, width: 'min(600px, calc(100vw - 32px))', maxHeight: '78dvh', overflowY: 'auto',
        boxSizing: 'border-box', border: `1px solid ${colors.border}`, borderRadius: 16, padding: 22,
        background: 'var(--dsw-alias-bg-layer-1, #fff)', color: colors.text,
      } },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 12 } },
          h('h2', { style: { ...heading, margin: 0 } }, '萤的音乐日记'),
          h('button', { type: 'button', style: button, onClick: onClose, 'aria-label': '关闭音乐日记' }, '关闭')),
        h('p', { style: intro }, '把聊过的心情留在旋律里。钢琴、翻唱、萤的寄语和你的听后感，都留在同一本日记里。'),
        source && !initialSong && h('div', { style: { display: 'flex', gap: 10, marginBottom: 18, flexWrap: 'wrap' } },
          h('select', { value: seconds, onChange: e => setSeconds(Number(e.target.value)), style: { ...field, width: 120 }, 'aria-label': '钢琴小品时长' },
            ...[30, 60, 120].map(n => h('option', { key: n, value: n }, `${n} 秒`))),
          h('button', { type: 'button', style: button, disabled: busy, onClick: compose }, busy ? '准备创作…' : '把这段心情写成钢琴小品')),
        error && h('p', { role: 'alert', style: { color: colors.error } }, error),
        !initialSong && !source && h('div', { style: { display: 'flex', gap: 8, marginBottom: 12 } },
          ...[['all', '全部'], ['piano', '钢琴'], ['cover', '翻唱']].map(([id, label]) => h('button', { key: id, type: 'button', style: button, 'aria-pressed': kind === id, onClick: () => setKind(id) }, label))),
        ...songs.filter(song => kind === 'all' || (song.kind || 'piano') === kind).map(song => h(MusicCard, { key: song.id, song, sessionId, onChange: changed })),
        !songs.length && !source && h('p', { style: intro }, '还没有留下曲子。可以对萤说“为今天的心情弹一小段”，或点击回复旁的音符。'),
        h('p', { style: { ...intro, fontSize: 12, marginBottom: 0 } }, '翻唱保留到手动移除；未收藏钢琴音频最多保留 30 天。清理音频后仍保留日记与听后感。'));
    }

    function MusicAction({ messageId, sessionId, useChat, directory }) {
      const selection = React.useSyncExternalStore(listener => directory.subscribe(listener), () => directory.getSnapshot());
      const message = useChat(snapshot => {
        for (const turn of snapshot.timeline.turns.values()) {
          const candidate = turn.data.get('turn-tail')?.closing?.finalNode;
          if (candidate?.messageId === messageId) return candidate;
        }
        return null;
      });
      const hotaru = selection.current?.provider === 'emilia-character' && selection.current?.model === 'hotaru-v0.1';
      const reply = message?.blocks.filter(b => b.kind === 'text').map(b => b.text).join('').trim() || '';
      const [song, setSong] = React.useState(null);
      const [available, setAvailable] = React.useState(false);
      const [error, setError] = React.useState('');
      const [intent, setIntent] = React.useState(null);
      const [recommendOpen, setRecommendOpen] = React.useState(false);
      const recommendationShown = React.useRef(false);
      const [open, setOpen] = React.useState(false);
      React.useEffect(() => {
        if (!hotaru || !reply) return;
        let active = true;
        let timer;
        let attempts = 0;
        const refresh = () => api('/companion/music/source', 'POST', { sessionId, reply })
          .then(v => {
            if (!active) return;
            setAvailable(v.available);
            setSong(v.song);
            setIntent(v.intent);
            if (v.intent?.action === 'recommend' && v.intent.status === 'done' && v.intent.recommendations?.length && !v.intent.presented && !recommendationShown.current) {
              recommendationShown.current = true; setRecommendOpen(true);
              void api('/companion/music/apple/recommendation-seen', 'POST', { sessionId, reply }).catch(() => {});
            }
            setError('');
            if (v.intent?.status !== 'checking' && (v.song && !['planning', 'queued', 'generating'].includes(v.song.status)
                || !v.song && ++attempts >= 3)) clearInterval(timer);
          }).catch(e => { if (active) setError(e.message); if (++attempts >= 3) clearInterval(timer); });
        timer = setInterval(refresh, 3000); void refresh();
        return () => { active = false; clearInterval(timer); };
      }, [hotaru, reply, sessionId, song?.id]);
      if (!hotaru || !reply || !available && !error) return null;
      const pending = song && ['planning', 'queued', 'generating'].includes(song.status);
      const status = { planning: '构思中…', queued: '等待生成…', generating: '钢琴生成中…', completed: song?.audioAvailable ? '钢琴已生成 · 试听' : '音频已清理', failed: '创作失败 · 重试' }[song?.status]
        || (intent?.status === 'checking' ? '正在理解音乐请求…' : intent?.status === 'failed' ? '音乐请求未完成' : intent?.action === 'cancel' ? '已取消待处理创作' : '');
      return h(React.Fragment, null,
        intent?.action === 'recommend' && intent.recommendations?.some(t => t.id) && h('button', { type: 'button', style: { ...button, height: 28 },
          onClick: () => setRecommendOpen(true) }, '查看萤的推荐'),
        recommendOpen && h(MusicRecommendationDialog, { sessionId, reply, initialTracks: intent?.recommendations || [], onClose: () => setRecommendOpen(false) }),
        h('button', { type: 'button', className: 'emilia-voice-action', title: song ? '查看这段音乐记忆' : '把这段心情写成钢琴小品',
          'aria-label': song ? '查看这段音乐记忆' : '把这段心情写成钢琴小品', onClick: () => setOpen(true) }, pending ? '◌' : '♫'),
        (status || error) && h('button', { type: 'button', onClick: () => setOpen(true),
          style: { border: 0, background: 'transparent', padding: '0 4px', font: 'inherit', fontSize: 12,
            cursor: 'pointer', color: song?.status === 'failed' || error ? colors.error : colors.muted },
          title: song?.error || intent?.error || error || status,
          'aria-label': error ? '音乐服务暂不可用' : status, 'aria-live': 'polite' },
          error ? '音乐服务暂不可用' : song?.status === 'completed' && song.audioAvailable ? '▶' : status),
        open && h(MusicDialog, { sessionId, source: reply, initialSong: song, onSongChange: setSong, onClose: () => setOpen(false) }));
    }

    function MusicDiaryButton({ sessionId, directory }) {
      const selection = React.useSyncExternalStore(listener => directory.subscribe(listener), () => directory.getSnapshot());
      const [open, setOpen] = React.useState(false);
      if (selection.current?.provider !== 'emilia-character' || selection.current?.model !== 'hotaru-v0.1') return null;
      return h(React.Fragment, null,
        h('button', { type: 'button', style: { ...button, height: 30, border: 0, padding: '0 8px' }, onClick: () => setOpen(true) }, '♫ 音乐日记'),
        open && h(MusicDialog, { sessionId, onClose: () => setOpen(false) }));
    }
    function VoiceAction({ messageId, sessionId, useChat, directory }) {
      const modelState = React.useSyncExternalStore(
        listener => directory.subscribe(listener), () => directory.getSnapshot());
      const message = useChat(snapshot => {
        for (const turn of snapshot.timeline.turns.values()) {
          const candidate = turn.data.get('turn-tail')?.closing?.finalNode;
          if (candidate?.messageId === messageId) return candidate;
        }
        return null;
      });
      const [status, setStatus] = React.useState('idle');
      const [error, setError] = React.useState('');
      const [fallbackUrl, setFallbackUrl] = React.useState('');
      const [characterId, setCharacterId] = React.useState(null);
      React.useEffect(() => () => { if (fallbackUrl) URL.revokeObjectURL(fallbackUrl); }, [fallbackUrl]);
      React.useEffect(() => {
        let active = true;
        let changed = false;
        const selected = event => {
          if (event.detail?.sessionId !== sessionId) return;
          changed = true;
          if (currentVoice?.sessionId === sessionId) currentVoice.stop();
          setCharacterId(event.detail.id);
        };
        window.addEventListener('emilia-character-selected', selected);
        api(`/companion/character?sessionId=${encodeURIComponent(sessionId)}`)
          .then(value => { if (active && !changed) setCharacterId(value.id); })
          .catch(() => { if (active && !changed) setCharacterId(null); });
        return () => { active = false; window.removeEventListener('emilia-character-selected', selected); };
      }, [sessionId]);
      const speakerId = modelState.current?.provider !== 'emilia-character' ? null
        : modelState.current?.model === 'hotaru-v0.1' ? 'hotaru'
        : modelState.current?.model === 'emilia-x1' && characterId === 'emilia' ? 'emilia' : null;
      const isEmiliaX1 = Boolean(speakerId);
      React.useEffect(() => {
        setFallbackUrl(''); setError('');
        return () => { if (currentVoice?.sessionId === sessionId) currentVoice.stop(); };
      }, [sessionId, speakerId]);
      const text = message?.blocks.filter(block => block.kind === 'text').map(block => block.text).join('').trim() || '';
      const canSpeak = text.length > 0 && text.length <= 1200;
      function stop() {
        if (currentVoice?.messageId === messageId && currentVoice.sessionId === sessionId) currentVoice.stop();
      }
      async function play(manual = false) {
        if (!canSpeak) return;
        currentMusic?.pause();
        if (currentVoice?.messageId === messageId && currentVoice.sessionId === sessionId) { stop(); return; }
        currentVoice?.stop();
        setFallbackUrl('');
        const controller = new AbortController();
        let source = null;
        let stopped = false;
        let wav = null;
        let lipSyncId = null;
        const owner = { messageId, sessionId, stop: () => {
          if (stopped) return;
          stopped = true;
          controller.abort();
          if (source) {
            source.onended = null;
            try { source.stop(); } catch { /* Already ended. */ }
            source.disconnect();
          }
          if (lipSyncId) void api('/voice/lipsync/stop', 'POST', { id: lipSyncId }).catch(() => {});
          if (currentVoice === owner) currentVoice = null;
          setStatus('idle');
        } };
        currentVoice = owner;
        setStatus('loading'); setError('');
        try {
          const AudioContext = window.AudioContext || window.webkitAudioContext;
          if (!AudioContext) {
            wav = await voiceAudio(text, controller.signal, speakerId, sessionId);
            if (stopped) return;
            setFallbackUrl(URL.createObjectURL(wav));
            owner.stop();
            setError('请点旁边的播放器播放');
            return;
          }
          const context = voiceContext?.state === 'closed' || !voiceContext
            ? (voiceContext = new AudioContext()) : voiceContext;
          // iOS needs an audio source to start during the tap, before the network request.
          const unlockSource = context.createBufferSource();
          unlockSource.buffer = context.createBuffer(1, 1, context.sampleRate);
          unlockSource.connect(context.destination);
          unlockSource.start();
          const unlocked = context.resume().catch(error => error);
          wav = await voiceAudio(text, controller.signal, speakerId, sessionId);
          if (stopped) return;
          if (/^https?:$/.test(window.location.protocol)) setFallbackUrl(URL.createObjectURL(wav));
          const buffer = await context.decodeAudioData(await wav.arrayBuffer());
          const unlockError = await Promise.race([
            unlocked,
            new Promise(resolve => window.setTimeout(() => resolve(Error('手机音频未解锁，请再点一次小喇叭')), 8000)),
          ]);
          if (unlockError instanceof Error) throw unlockError;
          if (stopped) return;
          if (context.state !== 'running') throw Error('请点击小喇叭启动音频播放');
          if (!/^https?:$/.test(window.location.protocol)) {
            try {
              const prepared = await api('/voice/lipsync/prepare', 'POST', { text, speakerId, sessionId });
              lipSyncId = prepared.id;
            } catch (cause) {
              console.warn('[emilia-loop] lip sync preparation failed', cause);
            }
          }
          if (stopped) {
            if (lipSyncId) void api('/voice/lipsync/stop', 'POST', { id: lipSyncId }).catch(() => {});
            return;
          }
          source = context.createBufferSource();
          source.buffer = buffer;
          source.connect(context.destination);
          source.onended = owner.stop;
          source.start();
          if (lipSyncId) void api('/voice/lipsync/start', 'POST', { id: lipSyncId, startedAt: Date.now() })
            .catch(cause => console.warn('[emilia-loop] lip sync start failed', cause));
          setStatus('playing');
        } catch (cause) {
          if (!stopped) {
            owner.stop();
            if (wav && /^https?:$/.test(window.location.protocol)) {
              setError('请点旁边的播放器播放');
            } else {
              const detail = cause.message || '语音服务暂时不可用';
              setError(detail);
              if (manual && /^https?:$/.test(window.location.protocol)) window.alert(`语音获取失败：${detail}`);
            }
          }
        }
      }
      React.useEffect(() => {
        if (!isEmiliaX1 || !canSpeak || message.time < pageOpenedAt || Date.now() - message.time > 15000
            || document.visibilityState !== 'visible' || !document.hasFocus()) return;
        const key = `${sessionId}:${messageId}`;
        if (autoPlayedMessages.has(key)) return;
        autoPlayedMessages.add(key);
        let active = true;
        api('/companion/settings').then(settings => {
          if (active && settings.autoPlayVoice && document.visibilityState === 'visible' && document.hasFocus()) void play();
        }).catch(() => {});
        return () => { active = false; };
      }, [messageId, message?.time, isEmiliaX1, speakerId]);
      if (!isEmiliaX1) return null;
      return h(React.Fragment, null, h('button', {
        type: 'button', className: 'emilia-voice-action', disabled: !canSpeak,
        style: error || status === 'loading'
          ? { width: 'auto', maxWidth: 'min(70vw, 300px)', ...(error ? { color: colors.error } : {}) }
          : undefined,
        title: error || (!canSpeak ? '语音文本为空或超过 1200 字' : status === 'loading' ? '正在准备日语语音' : status === 'playing' ? '停止播放' : '播放日语语音'),
        'aria-label': error || (status === 'playing' || status === 'loading' ? '停止播放语音' : '播放语音'),
        'aria-busy': status === 'loading' || undefined,
        onClick: () => play(true),
      }, h('svg', { viewBox: '0 0 24 24', width: 17, height: 17, style: { flexShrink: 0 }, fill: 'none', stroke: 'currentColor',
        strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
      h('path', { d: 'M4 9v6h4l5 4V5L8 9H4Z' }),
      status === 'playing' ? h('path', { d: 'M18 8v8M21 8v8' }) : h('path', { d: 'M17 9a5 5 0 0 1 0 6m3-9a9 9 0 0 1 0 12' })),
      (error || status === 'loading') && h('span', { style: { marginLeft: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 } }, error || '正在准备语音…')),
      fallbackUrl && h('audio', { controls: true, preload: 'auto', src: fallbackUrl,
        style: { order: 1, width: 175, height: 28, maxWidth: '45vw' },
        onPlay: () => { stop(); setStatus('idle'); },
        onEnded: () => { setFallbackUrl(''); setError(''); } }));
    }
    function installCharacterSubmenu(sessionId, selectedId, onSelected, selectModel) {
      const menu = document.createElement('div');
      menu.className = 'emilia-character-submenu';
      menu.setAttribute('role', 'menu');
      menu.setAttribute('aria-label', 'Emilia X1 角色');
      const rows = new Map();
      let activeRow = null;
      let closeTimer = null;
      let activeIndex = 0;
      function cancelClose() {
        if (closeTimer !== null) window.clearTimeout(closeTimer);
        closeTimer = null;
      }
      function close() {
        cancelClose();
        activeRow?.setAttribute('aria-expanded', 'false');
        activeRow = null;
        menu.remove();
      }
      function scheduleClose() {
        cancelClose();
        closeTimer = window.setTimeout(close, 180);
      }
      function position() {
        if (!activeRow?.isConnected) { close(); return; }
        const rect = activeRow.getBoundingClientRect();
        const width = menu.offsetWidth || 180;
        const height = menu.offsetHeight || 300;
        menu.style.left = `${rect.right + width + 6 < window.innerWidth ? rect.right + 6 : Math.max(8, rect.left - width - 6)}px`;
        menu.style.top = `${Math.max(8, Math.min(rect.top, window.innerHeight - height - 8))}px`;
      }
      function highlight(index) {
        activeIndex = (index + characterChoices.length) % characterChoices.length;
        for (const [at, button] of [...menu.querySelectorAll('button')].entries()) {
          button.dataset.highlighted = at === activeIndex ? 'true' : 'false';
        }
      }
      async function choose(id, row) {
        for (const button of menu.querySelectorAll('button')) button.disabled = true;
        try {
          const character = await api(`/companion/character?sessionId=${encodeURIComponent(sessionId)}`, 'PUT', { id });
          onSelected(character);
          close();
          if (row.isConnected) row.click();
          else void selectModel({ provider: 'emilia-character', model: 'emilia-x1' });
        } catch (cause) {
          for (const button of menu.querySelectorAll('button')) button.disabled = false;
          const error = document.createElement('div');
          error.className = 'emilia-character-error';
          error.setAttribute('role', 'alert');
          error.textContent = cause.message || '角色切换失败';
          menu.appendChild(error);
          position();
        }
      }
      function show(row) {
        cancelClose();
        if (activeRow === row && menu.isConnected) return;
        activeRow?.setAttribute('aria-expanded', 'false');
        activeRow = row;
        row.setAttribute('aria-expanded', 'true');
        menu.replaceChildren();
        for (const [id, name] of characterChoices) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'emilia-character-option';
          button.setAttribute('role', 'menuitemradio');
          button.setAttribute('aria-checked', String(id === selectedId));
          button.textContent = name;
          if (id === selectedId) button.textContent += '  ✓';
          button.addEventListener('mousedown', event => { event.preventDefault(); event.stopPropagation(); });
          button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); void choose(id, row); });
          menu.appendChild(button);
        }
        document.body.appendChild(menu);
        highlight(Math.max(0, characterChoices.findIndex(([id]) => id === selectedId)));
        position();
      }
      menu.addEventListener('mouseenter', cancelClose);
      menu.addEventListener('mouseleave', scheduleClose);
      function attachRows() {
        for (const [row, listeners] of rows) {
          if (row.isConnected) continue;
          row.removeEventListener('mouseenter', listeners.enter);
          row.removeEventListener('mouseleave', listeners.leave);
          row.removeEventListener('focus', listeners.focus);
          row.removeEventListener('pointerdown', listeners.touch, true);
          row.removeEventListener('keydown', listeners.key);
          rows.delete(row);
        }
        for (const row of document.querySelectorAll('[role="menuitemradio"][title="Emilia X1"]')) {
          if (rows.has(row)) continue;
          const enter = () => show(row);
          const leave = scheduleClose;
          const focus = () => show(row);
          const touch = event => {
            if (event.pointerType !== 'touch') return;
            event.preventDefault(); event.stopPropagation(); show(row);
          };
          const key = event => {
            if (event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); show(row); }
            else if (activeRow === row && menu.isConnected && ['ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'ArrowLeft'].includes(event.key)) {
              event.preventDefault(); event.stopPropagation();
              if (event.key === 'ArrowDown') highlight(activeIndex + 1);
              else if (event.key === 'ArrowUp') highlight(activeIndex - 1);
              else if (event.key === 'Enter') void choose(characterChoices[activeIndex][0], row);
              else close();
            }
          };
          row.addEventListener('mouseenter', enter);
          row.addEventListener('mouseleave', leave);
          row.addEventListener('focus', focus);
          row.addEventListener('pointerdown', touch, true);
          row.addEventListener('keydown', key);
          rows.set(row, { enter, leave, focus, touch, key });
        }
        if (activeRow && !activeRow.isConnected) close();
      }
      const observer = new MutationObserver(records => {
        const target = '[role="menuitemradio"][title="Emilia X1"]';
        const addedRow = records.some(record => [...record.addedNodes].some(node =>
          node.nodeType === 1 && (node.matches?.(target) || node.querySelector?.(target))));
        if (addedRow || (activeRow && !activeRow.isConnected)) attachRows();
      });
      observer.observe(document.body, { childList: true, subtree: true });
      attachRows();
      window.addEventListener('scroll', position, true);
      window.addEventListener('resize', position);
      return () => {
        observer.disconnect();
        window.removeEventListener('scroll', position, true);
        window.removeEventListener('resize', position);
        for (const [row, listeners] of rows) {
          row.removeEventListener('mouseenter', listeners.enter);
          row.removeEventListener('mouseleave', listeners.leave);
          row.removeEventListener('focus', listeners.focus);
          row.removeEventListener('pointerdown', listeners.touch, true);
          row.removeEventListener('keydown', listeners.key);
        }
        close();
      };
    }
    function ModeSwitch({ sessionId, directory, selectModel }) {
      const state = React.useSyncExternalStore(
        listener => directory.subscribe(listener), () => directory.getSnapshot());
      const [mode, setMode] = React.useState(null);
      const [character, setCharacter] = React.useState({ id: 'emilia', name: '爱蜜莉雅' });
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState('');
      React.useEffect(() => {
        let active = true;
        Promise.all([
          api(`/companion/mode?sessionId=${encodeURIComponent(sessionId)}`),
          api(`/companion/character?sessionId=${encodeURIComponent(sessionId)}`),
        ]).then(([value, selected]) => { if (active) { setMode(value.mode); setCharacter(selected); } })
          .catch(cause => { if (active) setError(cause.message); });
        return () => { active = false; };
      }, [sessionId]);
      React.useEffect(() => installCharacterSubmenu(sessionId, character.id, selected => {
        setCharacter(selected);
        setMode('companion');
        window.dispatchEvent(new CustomEvent('emilia-character-selected', {
          detail: { sessionId, id: selected.id },
        }));
      }, selectModel), [sessionId, character.id, selectModel]);
      if (state.current?.provider !== 'emilia-character' || state.current?.model !== 'emilia-x1') return null;
      async function choose(next) {
        if (busy || next === mode) return;
        setBusy(true); setError('');
        try {
          const value = await api(`/companion/mode?sessionId=${encodeURIComponent(sessionId)}`, 'PUT', { mode: next });
          setMode(value.mode);
        } catch (cause) { setError(cause.message); }
        finally { setBusy(false); }
      }
      return h('div', { title: error || 'Emilia X1 模式', style: { display: 'flex', alignItems: 'center', gap: 6, marginRight: 8 } },
        h('div', { role: 'group', 'aria-label': 'Emilia X1 模式', style: { position: 'relative', display: 'flex',
          width: 112, height: 30, padding: 2, boxSizing: 'border-box', borderRadius: 8,
          background: 'var(--dsw-alias-interactive-bg-hover)' } },
          mode && h('span', { 'aria-hidden': true, style: { position: 'absolute', top: 2,
            left: mode === 'companion' ? 2 : '50%', width: 'calc(50% - 2px)', height: 26,
            borderRadius: 6, background: 'var(--dsw-alias-bg-layer-2)',
            boxShadow: '0 1px 4px rgba(0,0,0,.12)', transition: 'left 160ms ease' } }),
          ...[['companion', '陪伴'], ['work', '工作']].map(([value, label]) => h('button', {
            key: value, type: 'button', disabled: busy || !mode,
            'aria-pressed': mode === value, onClick: () => choose(value),
            style: { position: 'relative', zIndex: 1, flex: 1, padding: 0, border: 0,
              background: 'transparent', color: colors.text, cursor: 'pointer',
              font: 'inherit', fontSize: 12, lineHeight: '18px' },
          }, label))),
        character.id !== 'emilia' && h('span', { style: { color: colors.muted, fontSize: 12, whiteSpace: 'nowrap' } }, character.name));
    }
    function PetSettings() {
      const [config, setConfig] = React.useState(null);
      const [draftSize, setDraftSize] = React.useState(1);
      const [error, setError] = React.useState('');
      const [busy, setBusy] = React.useState(false);
      React.useEffect(() => {
        api('/pet')
          .then(value => { setConfig(value); setDraftSize(value.size); })
          .catch(() => setError('无法连接桌宠控制服务。请重启 DSH 后再试。'));
      }, []);
      async function update(patch) {
        const next = { ...config, ...patch };
        setBusy(true);
        setError('');
        try {
          const saved = await api('/pet', 'PUT', next);
          setConfig(saved);
          setDraftSize(saved.size);
        } catch (cause) { setDraftSize(config.size); setError(`保存失败：${cause.message}`); }
        finally { setBusy(false); }
      }
      return h('div', { style: typography },
        h('h2', { style: heading }, '桌面 Live2D'),
        h('p', { style: intro }, '控制 Mac 桌面的透明立绘。Emilia X1 显示所选角色，Hotaru V0.1 显示汐见萤；下方显示选项由这些角色共用。'),
        config && h('div', { style: { display: 'grid', gap: 24, marginTop: 24 } },
          h('div', null, h('div', { style: { marginBottom: 10, fontWeight: 600 } }, '显示'),
            h('p', { style: { ...intro, margin: '0 0 10px' } }, '显示或隐藏 Mac 桌面上的当前角色立绘。'),
            h('button', { type: 'button', style: button, disabled: busy, onClick: () => update({ visible: !config.visible }) }, config.visible ? '隐藏桌宠' : '显示桌宠')),
          h('div', null, h('div', { style: { marginBottom: 10, fontWeight: 600 } }, '画面'),
            h('p', { style: { ...intro, margin: '0 0 10px' } }, '半身突出角色上半身；全身显示完整立绘。'),
            h('div', { style: { display: 'flex', gap: 8 } },
              ...[['half', '半身'], ['full', '全身']].map(([value, label]) => h('button', {
                key: value, type: 'button', disabled: busy, onClick: () => update({ view: value }),
                style: { ...button, background: config.view === value ? 'var(--dsw-alias-interactive-bg-hover)' : 'transparent',
                  borderColor: config.view === value ? 'var(--dsw-alias-state-business-primary)' : colors.border }
              }, label)))),
          h('div', null,
            h('label', { htmlFor: 'emilia-pet-size', style: { display: 'block', marginBottom: 10, fontWeight: 600 } }, `立绘大小 · ${Math.round(draftSize * 100)}%`),
            h('p', { style: { ...intro, margin: '0 0 10px' } }, '调整当前角色在桌面上的显示比例。'),
            h('input', { id: 'emilia-pet-size', type: 'range', min: 0.6, max: 1, step: 0.05,
              value: draftSize, disabled: busy, style: { width: 'min(100%, 280px)' },
              onChange: event => setDraftSize(Number(event.target.value)),
              onPointerUp: event => update({ size: Number(event.target.value) }),
              onKeyUp: event => update({ size: Number(event.target.value) }),
            })),
          h('div', null,
            h('div', { style: { marginBottom: 10, fontWeight: 600 } }, '位置'),
            h('p', { style: { ...intro, margin: '0 0 10px' } }, '在 Mac 桌面拖动立绘调整位置；不同角色沿用同一位置。'),
            h('button', { type: 'button', style: button, disabled: busy, onClick: () => update({ position: null }) }, '重置到右下角')),
          h('div', null,
            h('div', { style: { marginBottom: 10, fontWeight: 600 } }, '头顶浮窗'),
            h('p', { style: { ...intro, margin: '0 0 10px' } }, '在当前角色头顶显示运行状态和回复预览；不拦截鼠标，约 6 秒后自动消失。'),
            h('label', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
              h('input', { type: 'checkbox', checked: config.bubbleEnabled, disabled: busy,
                onChange: event => update({ bubbleEnabled: event.target.checked }) }), '显示头顶浮窗')),
          h('div', null,
            h('div', { style: { marginBottom: 10, fontWeight: 600 } }, '鼠标跟踪'),
            h('p', { style: { ...intro, margin: '0 0 10px' } }, '让当前角色的视线轻微跟随鼠标；移远后回到正面，透明区域仍可点击穿透。'),
            h('label', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
              h('input', { type: 'checkbox', checked: config.mouseTracking, disabled: busy,
                onChange: event => update({ mouseTracking: event.target.checked }) }), '跟随鼠标'))),
        error && h('p', { role: 'alert', style: { color: colors.error, marginTop: 20 } }, error));
    }

    function CompanionSettings() {
      const [settings, setSettings] = React.useState(null);
      const [qwenKey, setQwenKey] = React.useState(null);
      const [keyDraft, setKeyDraft] = React.useState('');
      const [endpointDraft, setEndpointDraft] = React.useState('');
      const [basePersona, setBasePersona] = React.useState('');
      const [personaDraft, setPersonaDraft] = React.useState('');
      const [memories, setMemories] = React.useState([]);
      const [memoryOwner, setMemoryOwner] = React.useState('hotaru');
      const memoryName = memoryOwner === 'hotaru' ? '汐见萤' : '爱蜜莉雅';
      const memoryApi = memoryOwner === 'hotaru' ? '/companion/hotaru' : '/companion';
      const [topics, setTopics] = React.useState([]);
      const [knowledge, setKnowledge] = React.useState([]);
      const [memoryDraft, setMemoryDraft] = React.useState('');
      const [memoryEdit, setMemoryEdit] = React.useState(null);
      const [knowledgeDraft, setKnowledgeDraft] = React.useState({ title: '', triggers: '', content: '', source: '', enabled: true });
      const [error, setError] = React.useState('');
      const [busy, setBusy] = React.useState(false);
      React.useEffect(() => {
        Promise.all([
          api('/companion/settings'), api('/companion/knowledge'), api('/companion/content'), api('/companion/qwen-key'),
        ]).then(([config, savedKnowledge, content, keyInfo]) => {
          setSettings(config); setPersonaDraft(config.extraPersona); setEndpointDraft(config.qwenEndpoint); setQwenKey(keyInfo);
          setKnowledge(savedKnowledge); setBasePersona(content.persona);
        }).catch(cause => setError(`无法读取陪伴设置：${cause.message}`));
      }, []);
      React.useEffect(() => {
        let active = true;
        setMemories([]); setTopics([]); setMemoryEdit(null); setMemoryDraft('');
        Promise.all([api(`${memoryApi}/memories`), api(`${memoryApi}/topics`)]).then(([saved, history]) => {
          if (active) { setMemories(saved); setTopics(history); }
        }).catch(cause => { if (active) setError(`无法读取${memoryName}记忆：${cause.message}`); });
        return () => { active = false; };
      }, [memoryOwner]);
      async function run(task) {
        setBusy(true); setError('');
        try { await task(); } catch (cause) { setError(`保存失败：${cause.message}`); }
        finally { setBusy(false); }
      }
      async function changeSettings(patch) {
        await run(async () => {
          const saved = await api('/companion/settings', 'PUT', patch);
          setSettings(saved); setPersonaDraft(saved.extraPersona); setEndpointDraft(saved.qwenEndpoint);
        });
      }
      async function refreshMemories() { setMemories(await api(`${memoryApi}/memories`)); }
      async function refreshTopics() { setTopics(await api(`${memoryApi}/topics`)); }
      async function refreshKnowledge() { setKnowledge(await api('/companion/knowledge')); }
      const note = text => h('span', { style: { ...intro, display: 'block', margin: 0, fontSize: 12, lineHeight: '18px' } }, text);
      const toggle = (key, label, description) => h('div', { key, style: { display: 'grid', gap: 4 } },
        h('label', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('input', { type: 'checkbox', checked: settings[key], disabled: busy,
            onChange: event => changeSettings({ [key]: event.target.checked }) }), label),
        note(description));
      const numberSetting = (key, label, description) => h('label', { key, style: { display: 'grid', gap: 6 } }, label,
        h('select', { value: settings[key], disabled: busy, style: { ...field, width: 180 },
          onChange: event => changeSettings({ [key]: Number(event.target.value) }) },
        ...Array.from({ length: 11 }, (_, index) => h('option', { key: index, value: index }, String(index)))),
        note(description));
      return h('div', { style: { ...typography, paddingBottom: 24 } },
        h('div', { style: section },
          h('h2', { style: heading }, 'Agents-Time 模型'),
          h('p', { style: intro }, '模型列表提供 Emilia X1 与 Hotaru V0.1。标注「共用」的 Qwen 设置会同时影响两个模型；DeepSeek 和爱蜜莉雅的陪伴功能有各自的作用范围。'),
          h('p', { style: { ...intro, marginBottom: 8 } }, 'Emilia X1：从模型右侧选择角色；输入栏可切换陪伴（Qwen Character）与工作（DeepSeek）。'),
          h('p', { style: intro }, 'Hotaru V0.1：选择后直接与汐见萤对话，支持 Live2D 动作、日语语音与口型、钢琴创作、音乐日记和独立长期记忆。音乐日记支持已收录翻唱的播放、日记寄语、听后感与演唱口型；翻唱制作目前在本地完成。'),
          settings && h('div', { style: { display: 'grid', gap: 16 } },
            h('label', { style: { display: 'grid', gap: 6 } }, 'Emilia X1 · 工作模式 DeepSeek 模型',
              h('select', { value: settings.backendModel, disabled: busy, style: { ...field, width: 240 },
                onChange: event => changeSettings({ backendModel: event.target.value }) },
              h('option', { value: 'deepseek-flash' }, 'DeepSeek Flash'),
              h('option', { value: 'deepseek-pro' }, 'DeepSeek Pro')),
              note('用于 Emilia X1 的工作回复，也用于爱蜜莉雅和汐见萤的话题与长期记忆整理。')),
            h('label', { style: { display: 'grid', gap: 6 } }, '共用 · Qwen Character 模型',
              h('select', { value: settings.qwenModel, disabled: busy, style: { ...field, width: 240 },
                onChange: event => changeSettings({ qwenModel: event.target.value }) },
              h('option', { value: 'qwen-plus-character' }, 'Qwen Plus Character'),
              h('option', { value: 'qwen-flash-character' }, 'Qwen Flash Character')),
              note('用于 Emilia X1 的陪伴对话和 Hotaru V0.1 对话；爱蜜莉雅日语语音翻译也使用它。')),
            h('label', { style: { display: 'grid', gap: 6 } }, '共用 · Qwen Chat Completions 地址',
              h('input', { type: 'url', value: endpointDraft, style: field,
                onChange: event => setEndpointDraft(event.target.value) }),
              note('两个模型共用阿里云百炼接口地址；修改后点击下方按钮保存。')),
            h('div', null, h('button', { type: 'button', style: button,
              disabled: busy || endpointDraft === settings.qwenEndpoint,
              onClick: () => changeSettings({ qwenEndpoint: endpointDraft }) }, '保存接口地址')),
            h('label', { style: { display: 'grid', gap: 6 } }, `共用 · Qwen API Key · ${qwenKey?.configured ? '已配置' : '未配置'}`,
              h('input', { type: 'password', value: keyDraft, autoComplete: 'off', style: field,
                placeholder: '输入阿里云百炼 API Key',
                onChange: event => setKeyDraft(event.target.value) }),
              note('Emilia X1 陪伴模式、Hotaru V0.1 对话和爱蜜莉雅日语翻译均使用这把 Key。')),
            h('div', { style: { display: 'flex', gap: 8 } },
              h('button', { type: 'button', style: button, disabled: busy || !keyDraft.trim(),
                onClick: () => run(async () => {
                  setQwenKey(await api('/companion/qwen-key', 'PUT', { key: keyDraft })); setKeyDraft('');
                }) }, '保存 API Key'),
              qwenKey?.configured && h('button', { type: 'button', style: button, disabled: busy,
                onClick: () => run(async () => { setQwenKey(await api('/companion/qwen-key', 'DELETE')); setKeyDraft(''); }) }, '移除 API Key')),
            h('div', { style: section },
              h('h3', { style: heading }, '共用 · 陪伴记忆设置'),
              note('话题跟踪、自动记忆和召回数量同时作用于爱蜜莉雅与汐见萤；两位角色的记忆和话题分别保存。原作知识与补充设定仍只用于爱蜜莉雅。')),
            toggle('topicTracking', '跟踪当前话题与暂停的话题', '分别保存爱蜜莉雅与汐见萤的当前话题，转题后可续接。关闭后不再更新话题记录。'),
            toggle('autoMemory', '自动记录稳定事实', '仅从用户明确说出的内容提取长期记忆；关系和承诺需先确认。'),
            toggle('knowledgeEnabled', '使用原作知识条目', '按触发词把下方《Re:从零开始的异世界生活》知识条目提供给爱蜜莉雅。'),
            numberSetting('memoryRecallLimit', '每轮最多召回的长期记忆', '各角色每次回复可参考的自身记忆条数；设为 0 则不召回。'),
            numberSetting('episodeRecallLimit', '每轮最多召回的过去话题', '各角色每次回复可参考的自身历史话题条数；设为 0 则不召回。'),
            numberSetting('knowledgeRecallLimit', '每轮最多召回的原作知识条目', '爱蜜莉雅每次回复可参考的原作知识条数；设为 0 则不召回。'),
            h('div', { style: section },
              h('h3', { style: heading }, '共用 · 日语语音'),
              note('Emilia X1 的爱蜜莉雅与 Hotaru V0.1 的汐见萤使用各自音色；其他角色暂不提供语音。')),
            toggle('autoPlayVoice', '自动播放新回复', '爱蜜莉雅和汐见萤回复完成后会预先合成各自的日语语音；中文先经共用 Qwen 接口翻译。开启后仅在当前页面可见且有焦点时自动播放。语音缓存最多保留 7 天、256 MiB 和 200 条。'))),
        h('details', { style: disclosure },
          h('summary', { style: summary }, '爱蜜莉雅角色设定'),
          h('p', { style: intro }, '这里显示爱蜜莉雅的基础设定。补充设定只影响 Emilia X1 中爱蜜莉雅的陪伴对话，不修改 Hotaru V0.1 或其他角色。'),
          h('div', { style: { marginBottom: 16, padding: 12, border: '1px solid var(--dsw-alias-settings-card-stroke)',
            borderRadius: 10, background: 'var(--dsw-alias-settings-card-fill)', color: colors.text,
            whiteSpace: 'pre-wrap', maxHeight: 260, overflowY: 'auto' } }, basePersona),
          settings && h('div', { style: { display: 'grid', gap: 8 } },
            h('label', { style: { display: 'grid', gap: 6 } }, '爱蜜莉雅补充设定',
              h('textarea', { value: personaDraft, rows: 4, maxLength: 4000, style: field,
                onChange: event => setPersonaDraft(event.target.value) })),
            h('div', null, h('button', { type: 'button', style: button, disabled: busy || personaDraft === settings.extraPersona,
              onClick: () => changeSettings({ extraPersona: personaDraft }) }, '保存补充设定')))),
        h('div', { style: section },
          h('label', { style: { display: 'grid', gap: 8 } }, '管理角色的记忆与话题',
            h('select', { value: memoryOwner, disabled: busy, style: { ...field, width: 200 },
              onChange: event => setMemoryOwner(event.target.value) },
              h('option', { value: 'hotaru' }, '汐见萤 · Hotaru V0.1'), h('option', { value: 'emilia' }, '爱蜜莉雅 · Emilia X1'))),
          h('p', { style: { ...intro, marginTop: 8 } }, '角色之间的记忆独立；同一角色可以在不同会话中回忆已记录的事实。')),
        h('details', { style: disclosure },
          h('summary', { style: summary }, `${memoryName}长期记忆${memories.length ? ` · ${memories.length}` : ''}`),
          h('p', { style: intro }, `供${memoryName}陪伴对话使用。自动抽取的关系与承诺会先作为候选，确认后才生效；你也可以手动添加、修改或遗忘。`),
          h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
            h('input', { type: 'text', value: memoryDraft, maxLength: 500, placeholder: '例如：我不吃香菜', style: field,
              onChange: event => setMemoryDraft(event.target.value) }),
            h('button', { type: 'button', style: button, disabled: busy || !memoryDraft.trim(),
              onClick: () => run(async () => {
                await api(`${memoryApi}/memories`, 'POST', { content: memoryDraft, kind: 'other', subject: '用户', key: memoryDraft.slice(0, 40), pinned: true });
                setMemoryDraft(''); await refreshMemories();
              }) }, '添加记忆')),
          h('div', { style: { display: 'grid', gap: 10, marginTop: 16 } },
            ...memories.map(item => h('div', { key: item.id, style: { border: '1px solid var(--dsw-alias-settings-card-stroke)', borderRadius: 10, padding: 12 } },
              h('div', { style: { fontSize: 12, lineHeight: '18px', color: colors.muted, marginBottom: 5 } }, `${item.status === 'candidate' ? '待确认' : '已生效'} · ${item.scope === 'relationship' ? '关系' : '用户'} · ${item.provenance === 'explicit' ? '手动' : '自动'}`),
              memoryEdit?.id === item.id
                ? h('textarea', { rows: 3, value: memoryEdit.content, style: field,
                  onChange: event => setMemoryEdit({ ...memoryEdit, content: event.target.value }) })
                : h('div', null, item.content),
              h('div', { style: { display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' } },
                item.status === 'candidate' && h('button', { type: 'button', style: button, disabled: busy,
                  onClick: () => run(async () => { await api(`${memoryApi}/memories/${item.id}/approve`, 'POST'); await refreshMemories(); }) }, '确认'),
                h('button', { type: 'button', style: button, disabled: busy,
                  onClick: () => memoryEdit?.id === item.id
                    ? run(async () => { await api(`${memoryApi}/memories/${item.id}`, 'PUT', { content: memoryEdit.content, status: 'active' }); setMemoryEdit(null); await refreshMemories(); })
                    : setMemoryEdit({ id: item.id, content: item.content }) }, memoryEdit?.id === item.id ? '保存修改' : '编辑'),
                h('button', { type: 'button', style: button, disabled: busy,
                  onClick: () => run(async () => { await api(`${memoryApi}/memories/${item.id}`, 'DELETE'); await refreshMemories(); }) }, '遗忘')))))),
        h('details', { style: disclosure },
          h('summary', { style: summary }, `${memoryName}话题${topics.length ? ` · ${topics.length}` : ''}`),
          h('p', { style: intro }, `记录${memoryName}的陪伴对话；每个会话的话题可以暂停和续接，结束操作只作用于该会话。`),
          h('button', { type: 'button', style: button, disabled: busy, onClick: () => run(refreshTopics) }, '刷新话题'),
          h('div', { style: { display: 'grid', gap: 10, marginTop: 16 } },
            ...topics.map(item => h('div', { key: item.id, style: { border: '1px solid var(--dsw-alias-settings-card-stroke)', borderRadius: 10, padding: 12 } },
              h('div', { style: { fontWeight: 600 } }, item.title),
              h('div', { style: { color: colors.muted, fontSize: 12, lineHeight: '18px' } }, `${item.status === 'active' ? '进行中' : item.status === 'paused' ? '已暂停' : '已结束'} · 会话 ${item.sessionId.slice(0, 12)}`),
              item.summary && h('div', { style: { marginTop: 6 } }, item.summary),
              item.status === 'active' && h('button', { type: 'button', style: { ...button, marginTop: 8 }, disabled: busy,
                onClick: () => run(async () => { await api(`${memoryApi}/topics/reset`, 'POST', { sessionId: item.sessionId }); await refreshTopics(); }) }, '结束当前话题'))))),
        h('details', { style: disclosure },
          h('summary', { style: summary }, `爱蜜莉雅原作知识${knowledge.length ? ` · ${knowledge.length}` : ''}`),
          h('p', { style: intro }, '供爱蜜莉雅陪伴对话按触发词检索人物、事件和世界设定；请在来源中写明依据。'),
          h('div', { style: { display: 'grid', gap: 10 } },
            ...[['title', '标题'], ['triggers', '触发词，用逗号分隔'], ['source', '来源']].map(([key, label]) =>
              h('input', { key, type: 'text', value: knowledgeDraft[key], placeholder: label, style: field,
                onChange: event => setKnowledgeDraft({ ...knowledgeDraft, [key]: event.target.value }) })),
            h('textarea', { value: knowledgeDraft.content, rows: 4, placeholder: '原作设定内容', style: field,
              onChange: event => setKnowledgeDraft({ ...knowledgeDraft, content: event.target.value }) }),
            h('div', null, h('button', { type: 'button', style: button,
              disabled: busy || !knowledgeDraft.title.trim() || !knowledgeDraft.content.trim() || !knowledgeDraft.source.trim(),
              onClick: () => run(async () => {
                await api(knowledgeDraft.id ? `/companion/knowledge/${knowledgeDraft.id}` : '/companion/knowledge',
                  knowledgeDraft.id ? 'PUT' : 'POST', knowledgeDraft);
                setKnowledgeDraft({ title: '', triggers: '', content: '', source: '', enabled: true });
                await refreshKnowledge();
              }) }, knowledgeDraft.id ? '保存条目' : '添加条目'))),
          h('div', { style: { display: 'grid', gap: 10, marginTop: 16 } },
            ...knowledge.map(item => h('div', { key: item.id, style: { border: '1px solid var(--dsw-alias-settings-card-stroke)', borderRadius: 10, padding: 12 } },
              h('div', { style: { fontWeight: 600 } }, item.title),
              h('div', { style: { color: colors.muted, fontSize: 12, lineHeight: '18px' } }, `触发词：${item.triggers || '无'}${item.source ? ` · 来源：${item.source}` : ''}`),
              h('div', { style: { marginTop: 6, whiteSpace: 'pre-wrap' } }, item.content),
              h('div', { style: { display: 'flex', gap: 8, marginTop: 8 } },
                h('button', { type: 'button', style: button, disabled: busy,
                  onClick: () => setKnowledgeDraft(item) }, '编辑'),
                h('button', { type: 'button', style: button, disabled: busy,
                  onClick: () => run(async () => { await api(`/companion/knowledge/${item.id}`, 'PUT', { ...item, enabled: !item.enabled }); await refreshKnowledge(); }) }, item.enabled ? '停用' : '启用'),
                h('button', { type: 'button', style: button, disabled: busy,
                  onClick: () => run(async () => { await api(`/companion/knowledge/${item.id}`, 'DELETE'); await refreshKnowledge(); }) }, '删除')))))),
        error && h('p', { role: 'alert', style: { color: colors.error, marginTop: 20 } }, error));
    }

    function EmiliaSettings() {
      return h('div', null, h(PetSettings), h(CompanionSettings), h(RemoteAccessSettings));
    }
    function RemoteAccessSettings() {
      const [url, setUrl] = React.useState('');
      const [homeUrl, setHomeUrl] = React.useState('');
      const [error, setError] = React.useState('');
      if (window.location.protocol !== 'dsh-app:') return null;
      async function makeLink() {
        setUrl(''); setHomeUrl(''); setError('');
        try {
          const response = await fetch('/api/emilia', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'pairing' }),
          });
          const value = await response.json();
          if (!response.ok) throw Error(value.error || `HTTP ${response.status}`);
          setUrl(value.url);
          setHomeUrl(new URL('/emilia/mobile', value.url).href);
        } catch (cause) { setError(cause.message); }
      }
      return h('section', { style: { ...typography, ...section, marginBottom: 24 } },
        h('h2', { style: heading }, '手机远程访问'),
        h('p', { style: intro }, '手机可使用 Emilia X1 和 Hotaru V0.1 聊天。首次在普通浏览器标签打开配对链接；配对后收藏不含令牌的日常地址。DSH 登录 Cookie 默认有效 30 天，清除网站数据或使用无痕模式后需要重新配对。'),
        h('button', { type: 'button', style: button, onClick: makeLink }, '生成手机登录链接'),
        url && h('p', { style: { ...intro, margin: '12px 0 4px' } }, '首次配对链接（包含私有令牌）'),
        url && h('input', { type: 'text', readOnly: true, value: url, 'aria-label': '手机登录链接',
          onFocus: event => event.target.select(), style: { ...field, display: 'block', marginTop: 10 } }),
        homeUrl && h('p', { style: { ...intro, margin: '12px 0 4px' } }, '日常访问地址（请收藏这个地址）'),
        homeUrl && h('input', { type: 'text', readOnly: true, value: homeUrl, 'aria-label': '手机日常访问地址',
          onFocus: event => event.target.select(), style: { ...field, display: 'block', marginTop: 10 } }),
        error && h('p', { role: 'alert', style: { color: colors.error } }, error));
    }
    return {
      inject: ['slots', 'modelDirectories'],
      apply(ctx) {
        if (typeof document !== 'undefined' && !document.getElementById('emilia-mobile-settings-style')) {
          const style = document.createElement('style');
          style.id = 'emilia-mobile-settings-style';
          style.textContent = mobileStyle;
          document.head.appendChild(style);
        }
        if (typeof document !== 'undefined' && !document.getElementById('emilia-voice-action-style')) {
          const style = document.createElement('style');
          style.id = 'emilia-voice-action-style';
          style.textContent = `.emilia-voice-action { order: 1; display: inline-flex; align-items: center; justify-content: center;
            width: 28px; height: 28px; padding: 5px; border: 0; border-radius: var(--dsw-radius-sm);
            background: transparent; color: var(--dsw-alias-label-tertiary); cursor: pointer; }
            .emilia-voice-action:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); }
            .emilia-voice-action:disabled { opacity: .4; cursor: default; }
            [data-clock="end"] > span { order: 2; }
            [role="menuitemradio"][title="Emilia X1"]::after {
              content: '›'; margin-left: auto; padding-left: 16px; opacity: .6;
            }
            .emilia-character-submenu {
              position: fixed; z-index: 2147483000; isolation: isolate;
              box-sizing: border-box; min-width: 166px;
              max-height: min(420px, calc(100dvh - 16px)); overflow-y: auto;
              padding: 4px; border: 0; border-radius: var(--dsw-radius-lg);
              --dsw-elevation-stroke-color: var(--dsw-alias-border-l1);
              box-shadow: var(--dsw-elevation-prominent); color: var(--dsw-alias-label-primary);
              font-family: var(--dsw-font-family);
            }
            .emilia-character-submenu::before {
              content: ''; position: absolute; inset: 0; z-index: -1;
              border-radius: inherit; background: var(--dsw-menu-surface-fill);
              backdrop-filter: var(--dsw-menu-backdrop-filter); pointer-events: none;
            }
            .emilia-character-option {
              display: block; width: 100%; min-height: 34px; padding: 5px 7px;
              border: 0; border-radius: var(--dsw-radius-md);
              text-align: left; white-space: nowrap; font: inherit; font-size: 14px;
              background: transparent; color: inherit; cursor: pointer;
            }
            .emilia-character-option:hover, .emilia-character-option:focus-visible,
            .emilia-character-option[data-highlighted="true"] {
              background: var(--dsw-alias-interactive-bg-hover);
            }
            .emilia-character-option:disabled { opacity: .55; cursor: wait; }
            .emilia-character-error { max-width: 240px; padding: 8px 12px; font-size: 12px;
              white-space: normal; color: var(--dsw-alias-state-error-primary); }`;
          document.head.appendChild(style);
        }
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section', id: 'emilia-pet', order: 60, label: '角色与桌宠'
        }, EmiliaSettings));
        ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
          name: 'conversation.input.right', id: 'emilia-x1-mode',
          inject: sessionId => {
            const modelDirectory = ctx.modelDirectories.directoryFor(sessionId);
            return { sessionId, directory: modelDirectory.store, selectModel: selection => modelDirectory.select(selection) };
          },
        }, ModeSwitch));
        ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
          name: 'conversation.chat.assistant-actions', id: 'emilia-voice', order: 20,
          inject: sessionId => ({ directory: ctx.modelDirectories.directoryFor(sessionId).store }),
        }, VoiceAction));
        ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
          name: 'conversation.chat.assistant-actions', id: 'hotaru-music', order: 25,
          inject: sessionId => ({ directory: ctx.modelDirectories.directoryFor(sessionId).store }),
        }, MusicAction));
        ctx.slots.inject('conversation.chat.node', () => {
          const original = ctx.slots.entries('conversation.chat.node').find(entry => entry.options.key === 'assistant-step');
          if (!original?.component) return;
          function AssistantWithAvatar(props) {
            return h(React.Fragment, null,
              h(ReplyAvatar, { node: props.node, sessionId: props.sessionId, directory: props.directory, useChat: props.useChat }),
              h(original.component, props));
          }
          return ctx.slots.register({ name: 'conversation.chat.node', key: 'assistant-step',
            priority: (original.options.priority || 0) - 1, locale: original.locale, children: original.children,
            ...(original.store ? { store: original.store } : {}),
            inject: (sessionId, ...args) => ({ ...original.inject?.(sessionId, ...args), sessionId,
              directory: ctx.modelDirectories.directoryFor(sessionId).store }),
          }, AssistantWithAvatar);
        });
        ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
          name: 'conversation.input.right', id: 'hotaru-music-diary',
          inject: sessionId => ({ sessionId, directory: ctx.modelDirectories.directoryFor(sessionId).store }),
        }, MusicDiaryButton));
      }
    };
  }
});
