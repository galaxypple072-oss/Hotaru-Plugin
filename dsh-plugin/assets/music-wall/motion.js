  // The scene owns tab motion; the wall owns the selected-song camera.
  // Library polling must never reset either animation.
  var ORDER=['original','cover','found'],rebuildId=0,switching=false,requestedTab=S.tab;
  var remembered={original:null,cover:null,found:null};
  var scene=$('#scene'),emptyPanel=$('#empty-panel');
  function reducedMotion(){return window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches}
  function emptyState(){
    var empty=!S.items[S.tab].length;
    emptyPanel.hidden=!empty;
    emptyPanel.querySelector('h2').textContent=S.tab==='found'?'讓萤陪你找下一首歌':'這一頁，留給下一段旋律';
    emptyPanel.querySelector('p').textContent=S.tab==='found'?'Apple Music 搜歌尚未接入。接好之後，推薦的歌曲會出現在這裡。':'和萤聊聊今天的心情，把它寫成一段鋼琴小品。';
    $('#stage').dataset.board=S.tab;
  }
  function rebuild(dir,target){
    var id=++rebuildId,st=$('#stage'),reduce=reducedMotion(),travel=dir*62;
    switching=true;
    scene.dataset.phase='exit';
    scene.style.transition=reduce?'none':'transform 220ms cubic-bezier(.55,0,.9,.45), opacity 200ms ease-in';
    scene.style.transform='translateX('+(-travel)+'vw) scale(1.06)';
    scene.style.opacity='0';st.style.setProperty('--blur',reduce?'0px':'12px');
    setTimeout(function(){
      if(id!==rebuildId)return;
      S.tab=target||S.tab;S.playing=false;
      $('#ask').hidden=S.tab!=='found';
      scene.dataset.phase='prepare';scene.style.transition='none';
      scene.style.transform='translateX('+travel+'vw) scale(.94)';
      buildWall();
      var index=S.items[S.tab].findIndex(function(it){return it.id===remembered[S.tab]});
      select(Math.max(0,index),{instant:true});emptyState();
      // Commit the new scene offscreen, then animate on a separate painted frame.
      void scene.offsetWidth;
      requestAnimationFrame(function(){requestAnimationFrame(function(){
        if(id!==rebuildId)return;
        scene.dataset.phase='enter';
        scene.style.transition=reduce?'none':'transform 650ms cubic-bezier(.16,1,.3,1), opacity 450ms ease-out';
        scene.style.transform='translateX(0) scale(1)';scene.style.opacity='1';
        st.style.setProperty('--blur','0px');
        setTimeout(function(){if(id!==rebuildId)return;switching=false;scene.dataset.phase='idle'},reduce?0:650);
      })});
    },reduce?0:220);
  }
  function switchTab(n){
    if(n===requestedTab)return;
    if(!switching&&cur())remembered[S.tab]=cur().id;
    var dir=ORDER.indexOf(n)>ORDER.indexOf(requestedTab)?1:-1;
    requestedTab=n;stopAudio();S.playing=false;syncPlay();
    document.querySelectorAll('.tab').forEach(function(b){b.setAttribute('aria-selected',b.dataset.tab===n?'true':'false')});
    rebuild(dir,n);
  }
