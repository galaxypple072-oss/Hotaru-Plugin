import { Live2DCubismModel } from "live2d-renderer";

const CORE_URL = new URL("./assets/vendor/live2dcubismcore.min.js", window.location.href).href;

const STATE_MOTIONS = Object.freeze({
  idle: Object.freeze({ group: "Idle", index: 0 }),
  // Bundled Think motions use worried brows and a downturned mouth.
  // The alternate Idle motions keep a thoughtful head/gaze movement with a neutral face.
  thinking: Object.freeze({ group: "Idle", index: 1 }),
  speaking: Object.freeze({ group: "Talk", index: 0 }),
  working: Object.freeze({ group: "Idle", index: 2 }),
  listening: Object.freeze({ group: "Listen", index: 0 }),
});
const CUE_MOTIONS = Object.freeze({
  nod: Object.freeze({ group: "Nod", index: 0 }),
  smile: Object.freeze({ group: "Smile", index: 1 }),
  question: Object.freeze({ group: "Question", index: 0 }),
  denial: Object.freeze({ group: "Denial", index: 0 }),
  greeting: Object.freeze({ group: "Greeting", index: 0 }),
  goodbye: Object.freeze({ group: "Goodbye", index: 0 }),
  serious: Object.freeze({ group: "Serious", index: 0 }),
});

const VIEW_PRESETS = Object.freeze({
  half: Object.freeze({ scale: 1.875, x: 0, y: 184 }),
  full: Object.freeze({ scale: 0.92, x: 0, y: 0 }),
});

function createRenderer(canvas, outfit) {
  const renderer = new Live2DCubismModel(canvas, {
    // live2d-renderer 0.6.6 stores its RAF id at module scope. During an
    // outfit swap an old model can therefore keep rendering after destroy()
    // and touch released Cubism objects. Drive the loop per pet instead.
    autoAnimate: false,
    autoInteraction: false,
    tapInteraction: false,
    randomMotion: false,
    keepAspect: false,
    cubismCorePath: CORE_URL,
    zoomEnabled: false,
    enablePan: false,
    checkMocConsistency: true,
    premultipliedAlpha: true,
    // The bundled renderer selects a mipmap filter even for 1500px textures,
    // but only generates mipmaps for power-of-two dimensions. New character
    // atlases are mostly 1500px; resize them to 1024px before upload.
    maxTextureSize: ["emilia", "hotaru"].includes(outfit.id) ? 2048 : 1024,
    enablePhysics: outfit.id === "hotaru",
    // These archive models show their irises above the eyelids when the
    // generic Cubism blink drives eye-open all the way to zero.
    enableEyeblink: outfit.id === "emilia",
    enableBreath: true,
    enableLipsync: ["emilia", "hotaru"].includes(outfit.id),
    // We choose state motions ourselves. The library otherwise starts Idle_1
    // after every clip ends, which is a closed-eye sigh for the new characters.
    enableMotion: outfit.id === "emilia",
    scale: 1,
  });
  if (outfit.id !== "emilia") {
    const loadMotion = renderer.loadMotion.bind(renderer);
    renderer.loadMotion = (...args) => {
      const motion = loadMotion(...args);
      motion?.setLoop(["Idle", "Think", "Listen"].includes(args[6]));
      return motion;
    };
    const updateMotion = renderer.motionController.update;
    renderer.motionController.update = deltaTime => {
      const updated = updateMotion(deltaTime);
      const cubismModel = renderer.model;
      if (!cubismModel) return updated;
      for (const id of ["ParamEyeLOpen", "ParamEyeROpen"]) {
        const index = renderer.parameters.ids.indexOf(id);
        if (index < 0) continue;
        cubismModel.setParameterValueByIndex(index,
          Math.max(0.8, cubismModel.getParameterValueByIndex(index)));
      }
      cubismModel.saveParameters();
      return updated;
    };
  }
  return renderer;
}

function hideSourceArtifacts(renderer, outfit) {
  const hotaruLive = outfit.id === "hotaru" && outfit.model.includes("/hotaru/live/");
  const hotaruCasual = outfit.id === "hotaru" && outfit.model.includes("/hotaru/casual/");
  if (hotaruLive || hotaruCasual) {
    // Both outfits clip their front hair against masks that discard most of
    // the fringe in this renderer. The meshes have transparent edges and can
    // be drawn directly. The two outfits use different drawable IDs.
    const ids = renderer.model?._model?.drawables?.ids;
    const clipping = renderer.getRenderer()?._clippingManager
      ?.getClippingContextListForDraw?.();
    if (ids && clipping) {
      const fringe = hotaruLive
        ? ["ArtMesh58", "ArtMesh59", "ArtMesh64", "ArtMesh65", "ArtMesh68", "ArtMesh69", "ArtMesh70"]
        : ["ArtMesh217", "ArtMesh218", "ArtMesh222", "ArtMesh224", "ArtMesh226", "ArtMesh227", "ArtMesh229"];
      for (const id of fringe) {
        const index = ids.indexOf(id);
        if (index >= 0) clipping.set(index, null);
      }
    }
  }
  const hidden = outfit.id === "crusch" ? ["ArtMesh34", "ArtMesh35"]
    : outfit.id === "hotaru" ? [
      "ArtMesh88", "ArtMesh403", "ArtMesh400", "ArtMesh376",
      "ArtMesh143", "ArtMesh144", "ArtMesh145", "ArtMesh148", "ArtMesh150", "ArtMesh151",
      "ArtMesh83", "ArtMesh84", "ArtMesh85",
      // The spring outfit has three forehead overlays whose atlas regions
      // produce a pink slab and a jagged white patch over otherwise clean hair.
      ...(hotaruCasual ? ["ArtMesh86", "ArtMesh87", "ArtMesh223", "ArtMesh225", "ArtMesh228", "ArtMesh458", "ArtMesh454"] : []),
    ] : [];
  if (!hidden.length) return;
  // Crusch's teeth protrude around her closed mouth. This Hotaru pack also
  // renders blush, cheek and open-mouth overlays outside their intended masks.
  const ids = renderer.model?._model?.drawables?.ids;
  if (!ids) return;
  const hiddenIndices = new Set(hidden
    .map(id => ids.indexOf(id)).filter(index => index >= 0));
  if (!hiddenIndices.size) return;
  const getOpacity = renderer.model.getDrawableOpacity.bind(renderer.model);
  renderer.model.getDrawableOpacity = index => hiddenIndices.has(index) ? 0 : getOpacity(index);
}

export async function createLive2DPet(canvas, { outfit: initialOutfit } = {}) {
  if (!initialOutfit?.model) throw new Error("缺少初始 Live2D 服装");
  const renderScale = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
  canvas.style.setProperty("--render-scale", String(renderScale));
  // Keep the renderer's coordinates fixed while the native window clips the
  // lower part for half view. Otherwise resizing the WebView reframes the model.
  canvas.style.width = `${340 * renderScale}px`;
  canvas.style.height = `${470 * renderScale}px`;
  canvas.style.transform = `scale(${1 / renderScale})`;
  canvas.style.transformOrigin = "top left";

  let model = null;
  let neutral = Object.freeze({ x: 0, y: 0 });
  let currentView = "half";
  let currentSize = 1;
  let currentFraming = null;
  let currentState = "idle";
  let currentOutfit = null;
  let neutralPartOpacities = [];
  let outfitQueue = Promise.resolve();
  let animationFrame = 0;
  let renderGeneration = 0;
  let cueTimer = null;

  function stopRenderLoop() {
    renderGeneration += 1;
    if (animationFrame) window.cancelAnimationFrame(animationFrame);
    animationFrame = 0;
  }

  function startRenderLoop(candidate) {
    stopRenderLoop();
    const generation = renderGeneration;
    const render = () => {
      if (generation !== renderGeneration || candidate !== model || !candidate.loaded) return;
      try {
        candidate.update();
      } catch (error) {
        stopRenderLoop();
        console.error("[live2d] render loop stopped safely", error);
        return;
      }
      animationFrame = window.requestAnimationFrame(render);
    };
    animationFrame = window.requestAnimationFrame(render);
  }

  function destroyModel(candidate) {
    if (!candidate) return;
    try {
      candidate.paused = true;
      candidate.stopMotions();
      candidate.destroy();
    } catch (error) {
      console.warn("[live2d] renderer cleanup was incomplete", error);
    }
  }

  function applyFraming(framing) {
    const scale = Number(framing?.scale);
    const x = Number(framing?.x);
    const y = Number(framing?.y);
    if (!model || ![scale, x, y].every(Number.isFinite) || scale < 0.4 || scale > 4) return false;
    model.scale = scale;
    model.x = neutral.x + x * renderScale;
    model.y = neutral.y + y * renderScale;
    currentFraming = Object.freeze({ scale, x, y });
    return true;
  }

  function setView(view = "half") {
    const preset = VIEW_PRESETS[view];
    if (!preset || !applyFraming({
      scale: preset.scale * currentSize,
      x: preset.x,
      y: preset.y + preset.scale * (currentSize - 1) * 250,
    })) return false;
    currentView = view;
    return true;
  }

  function setSize(size = 1) {
    const next = Number(size);
    if (!Number.isFinite(next) || next < 0.6 || next > 1) return false;
    currentSize = next;
    return setView(currentView);
  }

  async function play(group, index = null, priority = 3) {
    if (!model) return null;
    try {
      const count = model.settings?.getMotionCount(group) || 0;
      if (!count) return null;
      if (index === null) return await model.startRandomMotion(group, priority);
      return await model.startMotion(group, Math.min(index, count - 1), priority);
    } catch (error) {
      console.warn(`[live2d] motion ${group} failed`, error);
      return null;
    }
  }

  function resetPose() {
    if (!model?.loaded) return;
    model.stopMotions();
    // The renderer saves every parameter as the next motion's starting pose.
    // Idle and Talk do not animate the extra eye/face parameters in Surprise,
    // so those values otherwise survive even after the motion is replaced.
    const cubismModel = model.model;
    for (let index = 0; index < cubismModel.getParameterCount(); index += 1) {
      cubismModel.setParameterValueByIndex(index, cubismModel.getParameterDefaultValue(index));
    }
    for (let index = 0; index < neutralPartOpacities.length; index += 1) {
      cubismModel.setPartOpacityByIndex(index, neutralPartOpacities[index]);
    }
    cubismModel.saveParameters();
  }

  function setState(state, { restart = false } = {}) {
    const next = STATE_MOTIONS[state] ? state : "idle";
    if (next === currentState && !restart) return false;
    if (cueTimer !== null) window.clearTimeout(cueTimer);
    cueTimer = null;
    currentState = next;
    resetPose();
    // The new character packs' Talk clips contain only a mouth curve. Playing
    // one after resetPose would leave all eye and brow parameters at raw moc
    // defaults, which do not form the character's intended neutral face.
    const { group, index } = currentOutfit?.id === "hotaru" && ["thinking", "working"].includes(next)
      ? { group: "Think", index: 0 }
      : next === "speaking" && currentOutfit?.id !== "emilia"
        ? STATE_MOTIONS.idle : STATE_MOTIONS[next];
    // All bundled motions loop. Force priority is required to leave a
    // previous state (including Surprise) and return to a neutral idle.
    void play(group, index, 3);
    return true;
  }

  function playCue(name) {
    const cue = CUE_MOTIONS[name];
    if (!cue || !model?.loaded) return false;
    if (cueTimer !== null) window.clearTimeout(cueTimer);
    resetPose();
    void play(cue.group, cue.index, 3);
    const duration = currentOutfit?.id === 'hotaru' ? 3600 : 1250;
    cueTimer = window.setTimeout(() => {
      cueTimer = null;
      setState(currentState, { restart: true });
    }, duration);
    return true;
  }

  async function loadOutfit(outfit) {
    if (!outfit?.model) throw new Error("服装资源无效");
    if (currentOutfit?.id === outfit.id && model) return currentOutfit;
    const previousOutfit = currentOutfit;
    const previousModel = model;
    stopRenderLoop();
    model = null;
    destroyModel(previousModel);
    let candidate = createRenderer(canvas, outfit);
    try {
      await candidate.load(outfit.model);
    } catch (error) {
      destroyModel(candidate);
      candidate = null;
      if (previousOutfit?.model && previousOutfit.id !== outfit.id) {
        candidate = createRenderer(canvas, previousOutfit);
        await candidate.load(previousOutfit.model);
        hideSourceArtifacts(candidate, previousOutfit);
        model = candidate;
        model.lipsync = ["emilia", "hotaru"].includes(previousOutfit.id);
        currentOutfit = previousOutfit;
        startRenderLoop(model);
      }
      throw error;
    }
    hideSourceArtifacts(candidate, outfit);
    model = candidate;
    // Only characters with a configured voice use the audio RMS mouth driver.
    model.lipsync = ["emilia", "hotaru"].includes(outfit.id);
    model.scale = 1;
    model.appendYOffset = 0;
    model.centerModel();
    neutral = Object.freeze({ x: model.x, y: model.y });
    neutralPartOpacities = Array.from({ length: model.model.getPartCount() }, (_, index) =>
      model.model.getPartOpacityByIndex(index));
    currentOutfit = outfit;
    setView(currentView);
    setState(currentState, { restart: true });
    startRenderLoop(model);
    return outfit;
  }

  function setOutfit(outfit) {
    outfitQueue = outfitQueue.catch(() => undefined).then(() => loadOutfit(outfit));
    return outfitQueue;
  }

  function motion(group, index = null) {
    return play(group, index, 3);
  }

  // live2d-renderer calculates RMS from this same audio buffer in its render
  // loop and applies it to ParamMouthOpenY.  Keep this behind the pet
  // controller so callers never need to reach into a particular renderer.
  async function startLipSync(audioData, offsetSeconds = 0, startedAt = null) {
    if (!model?.loaded || !model.lipsync || !(audioData instanceof ArrayBuffer)) return false;
    try {
      // decodeAudioData may detach its input buffer in some WebViews; use a
      // private copy so the playback path can continue using its own bytes.
      await model.inputAudio(audioData.slice(0));
      const controller = model.wavController;
      const duration = controller.samplesPerChannel / controller.sampleRate;
      const offset = Math.max(0, Number.isFinite(startedAt) ? (Date.now() - startedAt) / 1000 : Number(offsetSeconds) || 0);
      if (offset >= duration) {
        stopLipSync();
        return false;
      }
      controller.userTime = offset;
      controller.sampleOffset = Math.min(Math.floor(offset * controller.sampleRate), controller.samplesPerChannel);
      return duration - offset;
    } catch (error) {
      console.warn("[live2d] lip sync audio could not be decoded", error);
      return false;
    }
  }

  function stopLipSync() {
    if (!model?.loaded) return;
    const mouthIndex = model.parameters.ids.indexOf("ParamMouthOpenY");
    if (mouthIndex >= 0) {
      model.model.setParameterValueByIndex(mouthIndex, 0);
      model.model.saveParameters();
    }
    model.wavController.samples = null;
    model.wavController.rms = 0;
    model.wavController.previousRms = 0;
    void model.stopAudio().catch((error) => {
      console.warn("[live2d] lip sync cleanup was incomplete", error);
    });
  }

  function lookAt(x, y) {
    if (!model) return;
    const horizontal = Math.min(Math.max(Number(x) || 0, -0.48), 0.48);
    const vertical = Math.min(Math.max(Number(y) || 0, -0.34), 0.34);
    model.setDragging(horizontal, vertical);
  }

  function destroy() {
    if (cueTimer !== null) window.clearTimeout(cueTimer);
    cueTimer = null;
    stopRenderLoop();
    const candidate = model;
    model = null;
    destroyModel(candidate);
  }

  await loadOutfit(initialOutfit);
  return Object.freeze({
    setState,
    setView,
    setSize,
    setFraming: applyFraming,
    setOutfit,
    lookAt,
    motion,
    playCue,
    startLipSync,
    stopLipSync,
    destroy,
    groups: Object.freeze([...new Set(Object.values(STATE_MOTIONS).map(({ group }) => group))]),
    views: Object.freeze(Object.keys(VIEW_PRESETS)),
    get model() {
      return model;
    },
    get view() {
      return currentView;
    },
    get framing() {
      return currentFraming;
    },
    get outfit() {
      return currentOutfit;
    },
    renderScale,
  });
}
