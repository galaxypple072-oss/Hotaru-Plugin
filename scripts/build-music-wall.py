"""Adapt the supplied cover-wall artwork; embed it without runtime asset requests."""
from pathlib import Path
import json

root = Path(__file__).resolve().parents[1]
source = (root / 'dsh-plugin/assets/music-wall/source.html').read_text()
# Keep supplied canvas covers, geometry, transitions and controls. Replace all demo
# records/audio/search with a small, source-checked message bridge to the host.
start = source.index('  /* ---------- demo data ---------- */')
end = source.index('  /* ---------- generated covers ---------- */')
source = source[:start] + "  var ORIG=[], COVER=[], CATALOG=[];\n" + source[end:]
start = source.index('  /* ---------- audio (generated')
end = source.index('  /* ---------- state & view ---------- */')
source = source[:start] + '''
  function send(type, extra){parent.postMessage(Object.assign({channel:'hotaru-wall',type:type},extra||{}),'*')}
  function stopAudio(){send('pause')}
  function startAudio(it){if(it)send('play',{id:it.id,time:S.t})}
''' + source[end:]
source = source.replace("var it=cur();$('#fill')", "var it=cur();if(!it){$('#cur').textContent='00:00';$('#tot').textContent='00:00';$('#fill').style.width='0%';$('#bar').setAttribute('aria-valuemin','0');$('#bar').setAttribute('aria-valuemax','0');$('#bar').setAttribute('aria-valuenow','0');$('#bar').setAttribute('aria-valuetext','00:00');return}$('#fill')")
source = source.replace("$('#tot').textContent=fmt(it.dur)", "$('#tot').textContent=fmt(Math.round(it.dur))")
source = source.replace("$('#cur').textContent=fmt(S.t);", "$('#cur').textContent=fmt(S.t);$('#bar').setAttribute('aria-valuemin','0');$('#bar').setAttribute('aria-valuemax',it.dur);$('#bar').setAttribute('aria-valuenow',Math.floor(S.t));$('#bar').setAttribute('aria-valuetext',fmt(S.t));")
source = source.replace("var it=cur();\n    $('#nk')", "var it=cur();if(!it){$('#nk').textContent=S.tab==='found'?'AI 找歌':'音樂日記';$('#nt').textContent=S.tab==='found'?'一起找下一首歌':'還沒有留下曲子';$('#ns').textContent='';$('#nx').textContent=S.tab==='found'?'找歌功能尚未接入，現在可以聽鋼琴與翻唱。':'對萤說「為今天的心情彈一小段」，留下第一段旋律。';$('#add').hidden=true;return}\n    $('#nk')")
source = source.replace("var a=$('#bgA')", "if(!cur())return;var a=$('#bgA')")
source = source.replace("if(!n)return;i=", "if(!n){S.sel=0;S.t=0;S.playing=false;info();syncPlay();progress();return}i=")
source = source.replace("S.tab==='found'?10:9", "Math.max(2,Math.min(9,Math.ceil(Math.sqrt(items.length*2))))")
source = source.replace("var sp=i===0?[2,2]:P[Math.floor(r()*P.length)];", "var sp=items.length<5?[2,2]:i===0?[2,2]:P[Math.floor(r()*P.length)];")
source = source.replace('b.dataset.i=i;', 'b.dataset.i=i;b.dataset.id=it.id;')
source = source.replace("var items=S.items[S.tab];wall.innerHTML='';tiles=[];", "var items=S.items[S.tab];wall.hidden=!items.length;wall.innerHTML='';tiles=[];")
source = source.replace('if(o.play)S.playing=true;', 'if(o.play)S.playing=!!cur().available;')
source = source.replace("function toggle(){S.playing", "function toggle(){if(!cur()||!cur().available)return;S.playing")
source = source.replace("S.t=Math.max(0,Math.min(1,(e.clientX-b.left)/b.width))*cur().dur;progress()", "if(!cur())return;S.t=Math.max(0,Math.min(1,(e.clientX-b.left)/b.width))*cur().dur;send('seek',{id:cur().id,time:S.t});progress()")
start = source.index("  $('#add').addEventListener")
end = source.index('  function move(dx,dy)')
source = source[:start] + "  $('#add').addEventListener('click',function(){if(cur())send('details',{id:cur().id})});\n" + source[end:]
source = source.replace("if(e.target&&(e.target.tagName==='INPUT'))return;", "if(e.key==='Escape'){send('close');return}if(e.target&&(/INPUT|TEXTAREA|BUTTON|SELECT/.test(e.target.tagName)||e.target.isContentEditable))return;")
source = source.replace("var s=tiles[S.sel],c=cxy(s)", "var s=tiles[S.sel];if(!s)return;var c=cxy(s)")
# Keep tab transitions independent of the camera and of host data polling.
start = source.index("  var ORDER=['original'")
end = source.index('  /* brief blur pulse', start)
source = source[:start] + (root / 'dsh-plugin/assets/music-wall/motion.js').read_text() + '\n' + source[end:]
start = source.index("  document.querySelectorAll('.tab').forEach(function(b){", source.index('  /* ---------- interactions'))
end = source.index('  var toastT;', start)
source = source[:start] + "  document.querySelectorAll('.tab').forEach(function(b){b.addEventListener('click',function(){switchTab(b.dataset.tab)})});\n" + source[end:]
source = source.replace("o=o||{};var n=tiles.length;", "o=o||{};if(switching&&!o.instant)return;var n=tiles.length;")
source = source.replace("if(i===S.sel)toggle();else select(i,{play:true});", "if(S.tab==='found'){select(i);return}if(i===S.sel)toggle();else select(i,{play:true});")
source = source.replace("function toggle(){if(!cur()", "function toggle(){if(switching)return;if(!cur()")
start = source.index('  var last=Date.now();')
source = source[:start] + '''
  $('#bar').addEventListener('keydown',function(e){if(!cur())return;var delta=e.key==='ArrowRight'?5:e.key==='ArrowLeft'?-5:null;if(delta===null)return;e.preventDefault();e.stopPropagation();S.t=Math.max(0,Math.min(cur().dur,S.t+delta));send('seek',{id:cur().id,time:S.t});progress()});
  var libraryLoaded=false;
  var oldInfo=info;info=function(){oldInfo();if(cur()){$('#add').hidden=false;$('#add').textContent='日記與聽後感';$('#add').dataset.done='';$('#play').disabled=!cur().available;$('#nx').textContent=cur().text||cur().statusText||''}else{$('#play').disabled=true}};
  window.addEventListener('message',function(e){
    if(e.source!==parent||!e.data||e.data.channel!=='hotaru-host')return;var m=e.data;
    if(m.type==='songs'){
      var oldId=tiles[S.sel]&&tiles[S.sel].dataset.id;
      function map(s,i){var hash=0;for(var k=0;k<s.id.length;k++)hash=(hash*31+s.id.charCodeAt(k))>>>0;
        return {id:s.id,createdAt:s.createdAt||0,kind:s.kind==='cover'?'cover':'original',title:s.title,sub:s.kind==='cover'?'汐見螢 · 翻唱':'汐見螢 · 鋼琴小品',date:s.diaryDate||new Date(s.createdAt).toLocaleDateString(),dur:s.seconds||0,seed:hash,hue:hash%360,text:s.diaryText||s.reason||'',available:s.status==='completed'&&s.audioAvailable,statusText:s.status==='failed'?'創作未完成，打開日記可重試。':'音頻準備中或已清理。',badge:s.kind==='cover'?'翻唱':'鋼琴'}
      }
      var rows=m.songs.map(map).sort(function(a,b){return b.createdAt-a.createdAt||a.id.localeCompare(b.id)});S.items.original=rows.filter(function(s){return s.kind==='original'});S.items.cover=rows.filter(function(s){return s.kind==='cover'});
      $('#n-original').textContent=S.items.original.length;$('#n-cover').textContent=S.items.cover.length;
      if(S.tab!=='found'&&!libraryLoaded&&!oldId&&!S.items[S.tab].length&&rows.length){S.tab=rows[0].kind;requestedTab=S.tab}
      if(rows.length)libraryLoaded=true;
      if(switching)return;
      document.querySelectorAll('.tab').forEach(function(b){b.setAttribute('aria-selected',b.dataset.tab===S.tab?'true':'false')});$('#ask').hidden=S.tab!=='found';
      var idx=S.items[S.tab].findIndex(function(s){return s.id===oldId});
      var before=tiles.map(function(t){return t.dataset.id}).join('|'),after=S.items[S.tab].map(function(s){return s.id}).join('|');
      if(before!==after){
        if(oldId&&idx<0){stopAudio();S.playing=false;S.t=0;syncPlay()}
        buildWall();S.sel=idx>=0?idx:0;tiles.forEach(function(t,i){t.classList.toggle('on',i===S.sel)});depth();camera(!oldId);
        if(!oldId||idx<0)bgset();
      }
      tiles.forEach(function(t,i){var it=S.items[S.tab][i];if(it){t.querySelector('.t').textContent=it.title;t.querySelector('.y').textContent=it.date||it.sub;t.setAttribute('aria-label',it.title);t.setAttribute('aria-pressed',i===S.sel?'true':'false')}});
      info();progress();emptyState();
    }else if(m.type==='state'){
      if(cur()&&m.id===cur().id){S.playing=m.playing;S.t=m.time||0;syncPlay();progress();$('#bar').setAttribute('aria-valuenow',Math.floor(S.t));$('#bar').setAttribute('aria-valuemax',cur().dur)}
    }else if(m.type==='error'){S.playing=false;syncPlay();toast(m.message)}
    else if(m.type==='ended'){S.playing=false;syncPlay()}
  });
  $('#askf').addEventListener('submit',function(e){e.preventDefault()});
  /* APPLE_SEARCH_RUNTIME */
  $('.hint').textContent='方向鍵切換 · 空格播放 · 把心情留在旋律裡';
  $('#v-flat').setAttribute('aria-pressed',S.view==='flat'?'true':'false');$('#v-tilt').setAttribute('aria-pressed',S.view==='tilt'?'true':'false');
  $('#n-found').textContent='';buildWall();select(0,{instant:true});send('ready');
})();
</script></body></html>
'''
source = source.replace('  /* APPLE_SEARCH_RUNTIME */', (root / 'dsh-plugin/assets/music-wall/apple-search.js').read_text())
source = source.replace("(it.hit?'匹配':'目錄')", "'Apple Music'")
# Local system fonts work offline and avoid sending diary UI visits to a font CDN.
source = '\n'.join(line for line in source.split('\n') if 'fonts.googleapis.com' not in line)
source = source.replace('<head>', '<head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data: https://*.mzstatic.com;">')
source = source.replace('我的翻唱', '萤的翻唱')
source = source.replace('var sp=i===0?[2,2]:P[Math.floor(r()*P.length)];', "var tileRandom=r;if(S.tab==='found'){var tileHash=0;for(var hk=0;hk<it.id.length;hk++)tileHash=(tileHash*31+it.id.charCodeAt(hk))>>>0;tileRandom=rng(tileHash)}var sp=i===0?[2,2]:P[Math.floor(tileRandom()*P.length)];")
source = source.replace('AI 找歌<b', '我的歌單<b')
source = source.replace("var S={tab:'original'", "var S={tab:'found'")
source = source.replace('id="tab-original" data-tab="original" aria-selected="true"', 'id="tab-original" data-tab="original" aria-selected="false"')
source = source.replace('id="tab-found" data-tab="found" aria-selected="false"', 'id="tab-found" data-tab="found" aria-selected="true"')
source = source.replace('<div class="wall" id="wall"></div>', '<div class="scene" id="scene" data-phase="idle"><div class="wall" id="wall"></div><section id="empty-panel" class="empty-panel" hidden><div class="nk">MUSIC DIARY</div><h2></h2><p></p></section></div>')
source = source.replace('</style>\n\n<div class="bg"', '''
.scene{position:absolute;inset:0;transform-origin:50% 44%;will-change:transform,opacity}
.empty-panel{position:absolute;left:50%;top:44%;transform:translate(-50%,-50%);width:min(460px,calc(100% - 48px));box-sizing:border-box;padding:32px;border:1px solid var(--line);border-radius:20px;background:rgba(14,18,24,.8);backdrop-filter:blur(20px)}
.empty-panel h2{font:700 26px/1.3 var(--font-display);margin:12px 0}.empty-panel p{color:var(--muted);line-height:1.8;margin:0}
#apple-region{max-width:100px;border:1px solid var(--line);border-radius:24px;background:#171c24;color:var(--text);padding:0 10px;font:inherit}#askf{flex-wrap:wrap}#askf input{min-width:140px;flex:1}header{padding-right:90px}.tile:disabled{cursor:default}button:disabled{opacity:.45;cursor:default}
#apple-playlist{min-width:220px;max-width:65vw;border:1px solid var(--line);border-radius:30px;background:#171c24;color:var(--fg);padding:14px 22px;font:inherit}#askf input[hidden]{display:none}
@media(max-width:760px){header{padding-right:72px}.bar{gap:12px}.brand span{display:none}.tabs{order:3;width:100%}.stage{perspective:1000px}.wall{top:43%}.hint{display:none}.nt{font-size:22px}.now{max-width:100%}}
</style>\n\n<div class="bg"''')
target = root / 'dsh-plugin/client.js'
client = target.read_text()
marker = '    // BEGIN MUSIC WALL DOCUMENT'
if marker in client:
    a=client.index(marker);b=client.index('    // END MUSIC WALL DOCUMENT',a)+len('    // END MUSIC WALL DOCUMENT')
    client=client[:a]+client[b:]
client=client.replace("    const pageOpenedAt =", marker+'\n    const musicWallDocument = '+json.dumps(source,ensure_ascii=False)+';\n    // END MUSIC WALL DOCUMENT\n    const pageOpenedAt =')
target.write_text(client)
(root / 'dsh-plugin/assets/music-wall/adapted.html').write_text(source)
