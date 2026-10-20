  // A stable snapshot of one real playlist; playback never replaces its songs.
  var playlistRequest=0,playlistId=null,playlistName='',playlistLoaded=false,libraryError='',playlistArtwork={};
  var playlistSelect=document.createElement('select');playlistSelect.id='apple-playlist';playlistSelect.setAttribute('aria-label','Apple Music 歌單');
  var loadingOption=document.createElement('option');loadingOption.textContent='正在讀取心水歌曲…';playlistSelect.appendChild(loadingOption);
  $('#q').hidden=true;$('#askf button').hidden=true;$('.chips').hidden=true;$('#askf').appendChild(playlistSelect);
  var refreshButton=document.createElement('button');refreshButton.type='button';refreshButton.textContent='刷新歌單';$('#askf').appendChild(refreshButton);
  var suggestButton=document.createElement('button');suggestButton.type='button';suggestButton.textContent='讓萤推薦';$('#askf').appendChild(suggestButton);
  suggestButton.addEventListener('click',function(){send('apple-suggest')});
  playlistSelect.addEventListener('change',function(){requestPlaylist(playlistSelect.value)});
  refreshButton.addEventListener('click',function(){if(playlistId)requestPlaylist(playlistId)});
  function requestPlaylist(id){libraryError='';$('#trace').textContent='正在讀取歌單…';send('apple-playlist',{id:id,requestId:++playlistRequest})}
  $('#trace').textContent='正在讀取心水歌曲…';
  $('#ask').hidden=S.tab!=='found';
  var diaryCover=cover;
  cover=function(it){return it&&it.kind==='found'&&it.artworkUrl?it.artworkUrl:diaryCover(it)};
  var diaryInfo=info;
  info=function(){
    diaryInfo();if(S.tab!=='found')return;$('#add').hidden=true;
    if(cur()){$('#nk').textContent=playlistName||'我的歌單';$('#ns').textContent=cur().sub;$('#nx').textContent='來自 Apple Music · '+S.items.found.length+' 首歌曲'}
    else{$('#nk').textContent='我的歌單';$('#nt').textContent=playlistName||'心水歌曲';$('#ns').textContent='';$('#nx').textContent=libraryError||'正在讀取你的歌單…'}
  };
  var diaryEmptyState=emptyState;
  emptyState=function(){
    diaryEmptyState();if(S.tab!=='found'||S.items.found.length)return;
    emptyPanel.querySelector('h2').textContent=libraryError?'歌單暫時載入不了':playlistLoaded?'這張歌單還沒有歌曲':'正在讀取心水歌曲…';
    emptyPanel.querySelector('p').textContent=libraryError||(playlistLoaded?'讓萤推薦幾首，選好後加入這張歌單。':'歌曲和封面會一起留在這裡。');
  };
  function wallItem(t,i){return {id:t.id,kind:'found',title:t.title,sub:t.artist+' · '+t.album,date:'',dur:t.duration||0,
    artworkUrl:t.artworkUrl||playlistArtwork[t.id],seed:9000+i,hue:i*31,available:true,hit:true,badge:playlistName}}
  var libraryRevision='',libraryRenderTurn=0;
  var diarySelect=select,diaryStart=startAudio;
  startAudio=function(it){if(it&&it.kind==='found'){S.playing=false;syncPlay()}diaryStart(it)};
  function renderLibrary(m,turn){
    if(turn!==libraryRenderTurn)return;
    if(switching){setTimeout(function(){renderLibrary(m,turn)},80);return}
    var old=cur(),same=playlistId===m.playlist.id,oldTime=S.t,wasPlaying=S.playing;
    playlistId=m.playlist.id;playlistName=m.playlist.name;playlistSelect.value=playlistId;playlistLoaded=true;libraryError='';
    var revision=playlistId+':'+m.tracks.map(function(t){return t.id}).join('|');
    S.items.found=m.tracks.map(wallItem);$('#n-found').textContent=S.items.found.length;
    if(S.tab==='found'){
      if(revision!==libraryRevision){
        S.playing=false;buildWall();var index=same&&old?S.items.found.findIndex(function(t){return t.id===old.id}):0;
        diarySelect(Math.max(0,index),{instant:true});
        if(same&&index>=0){S.t=oldTime;S.playing=wasPlaying}syncPlay();progress();
      }
      info();emptyState();
    }
    libraryRevision=revision;$('#trace').textContent=playlistName+' · 共 '+S.items.found.length+' 首';
  }
  function showCurrent(m){
    if(S.tab!=='found'||!m.current)return;
    var index=S.items.found.findIndex(function(t){return t.id===m.current.id});if(index<0)return;
    S.playing=false;diarySelect(index,{instant:false});S.playing=Boolean(m.playing);S.t=m.time||0;syncPlay();progress();
  }
  window.addEventListener('message',function(e){
    if(e.source!==parent||!e.data||e.data.channel!=='hotaru-host')return;var m=e.data;
    if(m.type==='apple-playlists'){
      playlistSelect.innerHTML='';(m.playlists||[]).forEach(function(p){var o=document.createElement('option');o.value=p.id;o.textContent=p.name;playlistSelect.appendChild(o)});
      if(m.defaultId)playlistSelect.value=m.defaultId;
    }else if(m.type==='apple-library'&&m.requestId===playlistRequest){renderLibrary(m,++libraryRenderTurn)}
    else if(m.type==='apple-library-error'&&m.requestId===playlistRequest){libraryError=m.message;$('#trace').textContent=m.message;emptyState();info()}
    else if(m.type==='apple-artwork'){
      if(m.artworkUrl)playlistArtwork[m.id]=m.artworkUrl;
      var item=S.items.found.find(function(t){return t.id===m.id});if(!item||!m.artworkUrl)return;item.artworkUrl=m.artworkUrl;
      if(S.tab==='found'){var i=S.items.found.indexOf(item);if(tiles[i])tiles[i].style.backgroundImage='url("'+m.artworkUrl+'")';if(cur()&&cur().id===m.id)bgset()}
    }else if(m.type==='apple-current'){showCurrent(m)}
    else if(m.type==='apple-notice'){$('#trace').textContent=/失败|失敗|未能|無法|无法|暂时|暂未|尚未|超时|未完成/.test(m.message||'')?m.message:playlistName+' · 共 '+S.items.found.length+' 首'}
  });
