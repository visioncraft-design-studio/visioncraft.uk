import * as THREE from "three";
import { VRButton } from "three/addons/webxr/VRButton.js";

const FACE_LABELS = ["+X", "-X", "+Y", "-Y", "+Z", "-Z"];
const DEFAULT_PRESET_KEY = "visioncraftVrayCorrected";
const FACE_PRESETS = {
  visioncraftVrayCorrected: {
    label: "VisionCraft / V-Ray Corrected",
    faceOrder: ["-Z", "+Z", "-Y", "+Y", "-X", "+X"],
    faceRotations: [0, 0, 180, 180, 0, 0],
  },
  reverseStrip: {
    label: "reverseStrip",
    faceOrder: ["-Z", "+Z", "-Y", "+Y", "-X", "+X"],
    faceRotations: [0, 0, 0, 0, 0, 0],
  },
  yzSwapped: {
    label: "yzSwapped",
    faceOrder: ["+X", "-X", "+Z", "-Z", "+Y", "-Y"],
    faceRotations: [0, 0, 0, 0, 0, 0],
  },
  zFirst: {
    label: "zFirst",
    faceOrder: ["+Z", "-Z", "+X", "-X", "+Y", "-Y"],
    faceRotations: [0, 0, 0, 0, 0, 0],
  },
};

const LAYER_LEFT = 1;
const LAYER_RIGHT = 2;
const DEMO_SCENE_ID = "demo-scene";
const DB_NAME = "visioncraft-stereo-cubemap-db";
const STORE_NAME = "scenes";

const state = {
  db: null,
  scenes: [],
  currentScene: null,
  currentMeta: null,
  faceCanvases: { left: [], right: [] },
  faceTextures: { left: [], right: [] },
  swapEyes: false,
  viewYawOffset: 0,
  previewMode: "left",
  dragActive: false,
  dragControllerIndex: 0,
  dragLastX: 0,
  desktopDrag: {
    active: false,
    pointerId: null,
    yaw: 0,
    pitch: 0,
    lastX: 0,
    lastY: 0,
  },
  resetButtonLatch: false,
  vrMenuVisible: false,
  vrMenuButtonLatch: false,
};

const ui = {
  webglRoot: document.getElementById("webglRoot"),
  enterVrButton: document.getElementById("enterVrButton"),
  resetViewButton: document.getElementById("resetViewButton"),
  uploadSceneButton: document.getElementById("uploadSceneButton"),
  loadDemoButton: document.getElementById("loadDemoButton"),
  refreshScenesButton: document.getElementById("refreshScenesButton"),
  nextSceneFaceButton: document.getElementById("nextSceneFaceButton"),
  previousSceneFaceButton: document.getElementById("previousSceneFaceButton"),
  swapEyesButton: document.getElementById("swapEyesButton"),
  rotate90Button: document.getElementById("rotate90Button"),
  rotate180Button: document.getElementById("rotate180Button"),
  viewerResetButton: document.getElementById("viewerResetButton"),
  sceneNameInput: document.getElementById("sceneNameInput"),
  sceneFileInput: document.getElementById("sceneFileInput"),
  sceneLibraryList: document.getElementById("sceneLibraryList"),
  currentSceneName: document.getElementById("currentSceneName"),
  currentSceneMeta: document.getElementById("currentSceneMeta"),
  renderState: document.getElementById("renderState"),
  renderStateMeta: document.getElementById("renderStateMeta"),
  messageTray: document.getElementById("messageTray"),
  errorBanner: document.getElementById("errorBanner"),
  imageStatusPill: document.getElementById("imageStatusPill"),
  faceConfigGrid: document.getElementById("faceConfigGrid"),
  presetSelect: document.getElementById("presetSelect"),
  applyPresetButton: document.getElementById("applyPresetButton"),
  previewEyeSelect: document.getElementById("previewEyeSelect"),
  sceneCardTemplate: document.getElementById("sceneCardTemplate"),
};

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf3f1ed);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(ui.webglRoot.clientWidth, ui.webglRoot.clientHeight);
renderer.xr.enabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
ui.webglRoot.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 200);
camera.position.set(0, 0, 0);
camera.rotation.order = "YXZ";
scene.add(camera);

const worldRoot = new THREE.Group();
scene.add(worldRoot);

const contentRoot = new THREE.Group();
worldRoot.add(contentRoot);

const leftCubemapGroup = new THREE.Group();
leftCubemapGroup.userData.layerId = LAYER_LEFT;
leftCubemapGroup.layers.set(LAYER_LEFT);
const rightCubemapGroup = new THREE.Group();
rightCubemapGroup.userData.layerId = LAYER_RIGHT;
rightCubemapGroup.layers.set(LAYER_RIGHT);
contentRoot.add(leftCubemapGroup);
contentRoot.add(rightCubemapGroup);

const ambient = new THREE.AmbientLight(0xffffff, 0.55);
scene.add(ambient);

const raycaster = new THREE.Raycaster();
const controllerTempMatrix = new THREE.Matrix4();
const controllerLines = [];
const xrControllers = [];
const vrButtons = [];

const vrUiGroup = new THREE.Group();
vrUiGroup.position.set(0, -0.28, -2.2);
vrUiGroup.visible = false;
camera.add(vrUiGroup);

const viewIndicator = createDirectionIndicator();
scene.add(viewIndicator);

const faceConfigControls = [];
const cubeHalfSize = 18;
const cubeResolution = 1024;
const pointerSensitivity = 0.0055;
const vrRotateSensitivity = 0.075;

buildFaceConfigurationPanel();
buildPresetOptions();
buildVrMenu();
buildControllers();
setupEvents();

await initializeApp();

async function initializeApp() {
  state.db = await openDatabase();
  await refreshSceneLibrary();
  await loadDemoScene();
  setupVrButton();
  onResize();
  renderer.setAnimationLoop(renderFrame);
}

function setupVrButton() {
  const oldButton = document.getElementById("threeVrButton");
  if (oldButton) {
    oldButton.remove();
  }

  const vrSessionInit = {
    optionalFeatures: ["local-floor", "bounded-floor"],
  };

  const vrButton = VRButton.createButton(renderer, vrSessionInit);

  vrButton.id = "threeVrButton";

  // Do not use display:none.
  // Quest Browser may not reliably trigger a VR button that is display:none.
  // Keep it in the DOM but visually hidden off-screen.
  vrButton.style.position = "fixed";
  vrButton.style.left = "-9999px";
  vrButton.style.bottom = "0";
  vrButton.style.opacity = "0";
  vrButton.style.pointerEvents = "none";

  document.body.appendChild(vrButton);

  ui.enterVrButton.addEventListener("click", async () => {
    if (!navigator.xr) {
      showError("WebXR is not available here. Open this app in Meta Quest Browser over HTTPS or localhost.");
      return;
    }

    try {
      const supported = await navigator.xr.isSessionSupported("immersive-vr");
      if (!supported) {
        showError("Immersive VR is not supported in this browser. Open this page inside Meta Quest Browser on the headset.");
        return;
      }

      const session = await navigator.xr.requestSession("immersive-vr", vrSessionInit);
      await renderer.xr.setSession(session);
    } catch (error) {
      console.error(error);
      showError(`Failed to enter VR: ${error.message || "Open this page inside Meta Quest Browser on the headset."}`);
    }
  });

  renderer.xr.addEventListener("sessionstart", () => {
    // Keep the VR menu hidden by default.
    if (state) {
      state.vrMenuVisible = false;
    }

    if (typeof vrUiGroup !== "undefined") {
      vrUiGroup.visible = false;
    }

    // Both cubemap groups must be visible in VR.
    leftCubemapGroup.visible = true;
    rightCubemapGroup.visible = true;

    setRenderState("Immersive VR", "Stereo left/right cubemaps are being isolated per XR eye.");
    pushToast("Entered immersive VR.", "info");
  });

  renderer.xr.addEventListener("sessionend", () => {
    updateNonVrVisibility();
    setRenderState("Desktop Preview", `Previewing ${state.previewMode} eye cubemap.`);
    pushToast("Exited immersive VR.", "info");
  });
}

function setupEvents() {
  window.addEventListener("resize", onResize);

  ui.uploadSceneButton.addEventListener("click", handleSceneUpload);
  ui.loadDemoButton.addEventListener("click", async () => {
    await loadDemoScene();
  });
  ui.refreshScenesButton.addEventListener("click", refreshSceneLibrary);
  ui.nextSceneFaceButton.addEventListener("click", () => rotateStoredScene(1));
  ui.previousSceneFaceButton.addEventListener("click", () => rotateStoredScene(-1));
  ui.swapEyesButton.addEventListener("click", () => {
    if (!state.currentMeta) {
      return;
    }
    state.currentMeta.settings.swapEyes = !state.currentMeta.settings.swapEyes;
    applyCurrentMeta();
    persistCurrentSceneSettings();
    pushToast(`Eye order ${state.currentMeta.settings.swapEyes ? "swapped" : "restored"}.`, "info");
  });
  ui.rotate90Button.addEventListener("click", () => rotateViewOffset(Math.PI / 2));
  ui.rotate180Button.addEventListener("click", () => rotateViewOffset(Math.PI));
  ui.viewerResetButton.addEventListener("click", resetView);
  ui.resetViewButton.addEventListener("click", resetView);

  ui.previewEyeSelect.addEventListener("change", () => {
    state.previewMode = ui.previewEyeSelect.value;
    updateNonVrVisibility();
    if (!renderer.xr.isPresenting) {
      setRenderState("Desktop Preview", `Previewing ${state.previewMode} eye cubemap.`);
    }
  });

  ui.applyPresetButton.addEventListener("click", () => {
    if (!state.currentMeta) {
      return;
    }

    const presetKey = ui.presetSelect.value;
    const preset = FACE_PRESETS[presetKey];
    if (!preset) {
      return;
    }

    state.currentMeta.settings.faceOrder = [...preset.faceOrder];
    state.currentMeta.settings.faceRotations = [...preset.faceRotations];
    syncFaceConfigUi();
    rebuildCurrentSceneFromMeta();
    persistCurrentSceneSettings();
    pushToast(`Applied face order preset: ${preset.label}.`, "info");
  });

  renderer.domElement.addEventListener("pointerdown", handlePointerDown);
  renderer.domElement.addEventListener("pointermove", handlePointerMove);
  renderer.domElement.addEventListener("pointerup", handlePointerUp);
  renderer.domElement.addEventListener("pointercancel", handlePointerUp);
  renderer.domElement.addEventListener("pointerleave", handlePointerUp);

  window.addEventListener("keydown", (event) => {
    if (event.repeat) {
      return;
    }

    if (event.key === "ArrowLeft" || event.key.toLowerCase() === "a") {
      contentRoot.rotation.y += 0.08;
    }

    if (event.key === "ArrowRight" || event.key.toLowerCase() === "d") {
      contentRoot.rotation.y -= 0.08;
    }

    if (event.key.toLowerCase() === "r") {
      resetView();
    }
  });
}

function buildFaceConfigurationPanel() {
  ui.faceConfigGrid.innerHTML = "";

  FACE_LABELS.forEach((label, index) => {
    const card = document.createElement("div");
    card.className = "face-card";

    const title = document.createElement("h3");
    title.textContent = `Target Face ${label}`;

    const orderLabel = document.createElement("label");
    orderLabel.className = "field-label";
    orderLabel.textContent = "Source Face";

    const faceSelect = document.createElement("select");
    faceSelect.className = "select-input";

    FACE_LABELS.forEach((sourceLabel) => {
      const option = document.createElement("option");
      option.value = sourceLabel;
      option.textContent = sourceLabel;
      faceSelect.appendChild(option);
    });

    const rotationLabel = document.createElement("label");
    rotationLabel.className = "field-label";
    rotationLabel.textContent = "Rotation";

    const rotationSelect = document.createElement("select");
    rotationSelect.className = "select-input";

    [0, 90, 180, 270].forEach((deg) => {
      const option = document.createElement("option");
      option.value = String(deg);
      option.textContent = `${deg}°`;
      rotationSelect.appendChild(option);
    });

    faceSelect.addEventListener("change", () => {
      if (!state.currentMeta) {
        return;
      }

      state.currentMeta.settings.faceOrder[index] = faceSelect.value;
      rebuildCurrentSceneFromMeta();
      persistCurrentSceneSettings();
    });

    rotationSelect.addEventListener("change", () => {
      if (!state.currentMeta) {
        return;
      }

      state.currentMeta.settings.faceRotations[index] = Number(rotationSelect.value);
      rebuildCurrentSceneFromMeta();
      persistCurrentSceneSettings();
    });

    card.append(title, orderLabel, faceSelect, rotationLabel, rotationSelect);
    ui.faceConfigGrid.appendChild(card);

    faceConfigControls.push({ faceSelect, rotationSelect });
  });
}

function buildPresetOptions() {
  Object.entries(FACE_PRESETS).forEach(([key, preset]) => {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = preset.label;
    ui.presetSelect.appendChild(option);
  });

  ui.presetSelect.value = DEFAULT_PRESET_KEY;
}

function buildVrMenu() {
  const buttons = [
    { label: "Reset View", action: resetView },
    { label: "Next Image", action: () => rotateStoredScene(1) },
    { label: "Previous Image", action: () => rotateStoredScene(-1) },
    { label: "Exit VR", action: exitVrSession },
  ];

  buttons.forEach((config, index) => {
    const button = createVrButtonMesh(config.label, config.action);
    button.position.set(0, 0.26 - index * 0.19, 0);
    vrUiGroup.add(button);
    vrButtons.push(button);
  });
}

function createVrButtonMesh(label, action) {
  const width = 0.92;
  const height = 0.12;
  const radius = 20;
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;

  const context = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const geometry = new THREE.PlaneGeometry(width, height);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData = { label, action, canvas, context, texture, highlighted: false };
  drawVrButton(mesh, false);
  return mesh;
}

function drawVrButton(mesh, highlighted) {
  const { canvas, context, texture, label } = mesh.userData;

  context.clearRect(0, 0, canvas.width, canvas.height);
  const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, highlighted ? "rgba(30, 30, 30, 0.98)" : "rgba(251, 250, 247, 0.98)");
  gradient.addColorStop(1, highlighted ? "rgba(45, 45, 45, 0.98)" : "rgba(243, 239, 233, 0.98)");
  context.fillStyle = gradient;
  roundRect(context, 8, 8, canvas.width - 16, canvas.height - 16, 34);
  context.fill();

  context.lineWidth = 3;
  context.strokeStyle = highlighted ? "rgba(255,255,255,0.92)" : "rgba(17,17,17,0.12)";
  roundRect(context, 8, 8, canvas.width - 16, canvas.height - 16, 34);
  context.stroke();

  context.font = "600 36px Space Grotesk, sans-serif";
  context.fillStyle = highlighted ? "#ffffff" : "#111111";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label, canvas.width / 2, canvas.height / 2);

  texture.needsUpdate = true;
}

function buildControllers() {
  for (let i = 0; i < 2; i += 1) {
    const controller = renderer.xr.getController(i);
    controller.userData.index = i;
    controller.addEventListener("connected", (event) => {
      controller.userData.gamepad = event.data.gamepad ?? null;
      controller.userData.handedness = event.data.handedness ?? "unknown";
    });

    controller.addEventListener("selectstart", () => handleSelectStart(i));
    controller.addEventListener("selectend", () => handleSelectEnd(i));
    controller.addEventListener("squeezestart", () => startControllerDrag(i));
    controller.addEventListener("squeezeend", () => stopControllerDrag(i));
    scene.add(controller);
    xrControllers.push(controller);

    const lineGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, -1),
    ]);
    const line = new THREE.Line(
      lineGeometry,
      new THREE.LineBasicMaterial({ color: 0x857d72, transparent: true, opacity: 0.85 }),
    );
    line.name = "controllerRay";
    line.scale.z = 2.4;
    controller.add(line);
    controllerLines.push(line);
  }
}

async function handleSceneUpload() {
  clearError();

  const file = ui.sceneFileInput.files?.[0];
  if (!file) {
    showError("Choose a JPG or PNG stereo cubemap image before uploading.");
    return;
  }

  const sceneName = ui.sceneNameInput.value.trim() || file.name.replace(/\.[^.]+$/, "");

  try {
    const imageBitmap = await createImageBitmap(file);
    const meta = validateStereoCubemapImage(imageBitmap.width, imageBitmap.height);

    const record = {
      id: crypto.randomUUID(),
      name: sceneName,
      fileName: file.name,
      width: imageBitmap.width,
      height: imageBitmap.height,
      faceSize: meta.faceSize,
      blob: file,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      settings: createDefaultSettings(),
    };

    await saveSceneRecord(record);
    await refreshSceneLibrary(record.id);
    await loadSceneRecord(record);

    ui.sceneFileInput.value = "";
    ui.sceneNameInput.value = sceneName;
    pushToast(`Stored "${sceneName}" locally and loaded it into the viewer.`, "info");
  } catch (error) {
    console.error(error);
    showError(error.message || "Unable to load the uploaded image.");
  }
}

function createDefaultSettings() {
  const preset = FACE_PRESETS[DEFAULT_PRESET_KEY];
  return {
    faceOrder: [...preset.faceOrder],
    faceRotations: [...preset.faceRotations],
    swapEyes: false,
    viewYawOffset: 0,
  };
}

function validateStereoCubemapImage(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error("Image dimensions could not be read.");
  }

  if (height % 2 !== 0) {
    throw new Error("Stereo cubemap format error: image height must split cleanly into top and bottom eye rows.");
  }

  const eyeRowHeight = height / 2;
  if (width % 6 !== 0) {
    throw new Error("Stereo cubemap format error: each eye row must contain exactly 6 horizontal square faces.");
  }

  const faceSize = width / 6;
  if (faceSize !== eyeRowHeight) {
    throw new Error(
      `Stereo cubemap format error: expected square faces. Detected width/6 = ${faceSize} and height/2 = ${eyeRowHeight}.`,
    );
  }

  return { faceSize, eyeRowHeight };
}

async function refreshSceneLibrary(loadSceneId = null) {
  state.scenes = await getAllSceneRecords();
  renderSceneLibrary();

  if (loadSceneId) {
    const match = state.scenes.find((item) => item.id === loadSceneId);
    if (match) {
      await loadSceneRecord(match);
    }
  }
}

function renderSceneLibrary() {
  ui.sceneLibraryList.innerHTML = "";

  if (state.scenes.length === 0) {
    const empty = document.createElement("article");
    empty.className = "scene-card empty-card";
    empty.innerHTML = "<p class=\"scene-card-meta\">No local scenes stored yet. Upload a stereo cubemap to build your library.</p>";
    ui.sceneLibraryList.appendChild(empty);
    return;
  }

  state.scenes
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .forEach((sceneRecord) => {
      const fragment = ui.sceneCardTemplate.content.cloneNode(true);
      const card = fragment.querySelector(".scene-card");
      const title = fragment.querySelector(".scene-card-title");
      const meta = fragment.querySelector(".scene-card-meta");
      const loadButton = fragment.querySelector(".load-scene-button");
      const deleteButton = fragment.querySelector(".delete-scene-button");

      title.textContent = sceneRecord.name;
      meta.textContent = `${sceneRecord.width} × ${sceneRecord.height} • ${sceneRecord.fileName}`;

      if (state.currentScene?.id === sceneRecord.id) {
        card.style.borderColor = "rgba(17, 17, 17, 0.16)";
        card.style.background = "#f3efe9";
      }

      loadButton.addEventListener("click", () => loadSceneRecord(sceneRecord));
      deleteButton.addEventListener("click", async () => {
        await deleteSceneRecord(sceneRecord.id);
        pushToast(`Deleted "${sceneRecord.name}" from local storage.`, "info");
        if (state.currentScene?.id === sceneRecord.id) {
          await loadDemoScene();
        }
        await refreshSceneLibrary();
      });

      ui.sceneLibraryList.appendChild(fragment);
    });
}

async function loadDemoScene() {
  const demoMeta = {
    id: DEMO_SCENE_ID,
    name: "Demo Lobby",
    fileName: "Generated Demo",
    width: 6144,
    height: 2048,
    faceSize: 1024,
    settings: createDefaultSettings(),
  };

  const stereoFaces = createDemoStereoFaces();
  await applyStereoFacesToViewer(stereoFaces, demoMeta);
  state.currentScene = { ...demoMeta };
  state.currentMeta = structuredClone(demoMeta);
  updateSceneDetails();
  syncFaceConfigUi();
  ui.imageStatusPill.textContent = "Demo Scene Active";
  clearError();
}

function createDemoStereoFaces() {
  const left = FACE_LABELS.map((label, index) => createLabeledFaceCanvas(label, index, "left"));
  const right = FACE_LABELS.map((label, index) => createLabeledFaceCanvas(label, index, "right"));
  return { left, right };
}

function createLabeledFaceCanvas(label, index, eye) {
  const canvas = document.createElement("canvas");
  canvas.width = cubeResolution;
  canvas.height = cubeResolution;
  const ctx = canvas.getContext("2d");

  const palettes = eye === "left"
    ? [
        ["#1d315f", "#54b4ff"],
        ["#10213e", "#866dff"],
        ["#213772", "#5bd7ff"],
        ["#081326", "#4a82f7"],
        ["#0f2444", "#8e7dff"],
        ["#17365f", "#4de7d0"],
      ]
    : [
        ["#482064", "#ff8fb2"],
        ["#1f184f", "#c68cff"],
        ["#3b235f", "#70c2ff"],
        ["#18113d", "#7f94ff"],
        ["#251a53", "#ff7fdf"],
        ["#12305a", "#86ebff"],
      ];

  const [c1, c2] = palettes[index % palettes.length];
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, c1);
  gradient.addColorStop(1, c2);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 18;
  ctx.strokeRect(20, 20, canvas.width - 40, canvas.height - 40);

  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 4;
  for (let step = 0; step <= canvas.width; step += 128) {
    ctx.beginPath();
    ctx.moveTo(step, 0);
    ctx.lineTo(step, canvas.height);
    ctx.stroke();
  }
  for (let step = 0; step <= canvas.height; step += 128) {
    ctx.beginPath();
    ctx.moveTo(0, step);
    ctx.lineTo(canvas.width, step);
    ctx.stroke();
  }

  ctx.fillStyle = "#f7fbff";
  ctx.font = "700 118px Space Grotesk, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(label, canvas.width / 2, canvas.height / 2 - 18);

  ctx.font = "500 40px Manrope, sans-serif";
  ctx.fillText(eye === "left" ? "LEFT EYE" : "RIGHT EYE", canvas.width / 2, canvas.height / 2 + 68);
  return canvas;
}

async function loadSceneRecord(sceneRecord) {
  try {
    clearError();

    const imageBitmap = await createImageBitmap(sceneRecord.blob);
    const meta = validateStereoCubemapImage(imageBitmap.width, imageBitmap.height);
    const settings = {
      ...createDefaultSettings(),
      ...(sceneRecord.settings || {}),
    };

    const parsedMeta = {
      ...sceneRecord,
      width: imageBitmap.width,
      height: imageBitmap.height,
      faceSize: meta.faceSize,
      settings,
    };

    const stereoFaces = splitStereoCubemapImage(imageBitmap, parsedMeta);
    await applyStereoFacesToViewer(stereoFaces, parsedMeta);

    state.currentScene = { ...sceneRecord };
    state.currentMeta = structuredClone(parsedMeta);
    updateSceneDetails();
    syncFaceConfigUi();
    ui.imageStatusPill.textContent = `${meta.faceSize}px Faces Detected`;
    clearError();
  } catch (error) {
    console.error(error);
    showError(error.message || `Failed to load scene "${sceneRecord.name}".`);
  }
}

function splitStereoCubemapImage(imageSource, sceneMeta) {
  const { width, height } = imageSource;
  const { faceSize } = validateStereoCubemapImage(width, height);

  const leftEyeRowY = 0;
  const rightEyeRowY = faceSize;

  // This is the key stereo split:
  // top half of the uploaded image becomes the left-eye strip,
  // bottom half becomes the right-eye strip.
  const rawLeftFaces = extractFaceRow(imageSource, leftEyeRowY, faceSize);
  const rawRightFaces = extractFaceRow(imageSource, rightEyeRowY, faceSize);

  const order = sceneMeta.settings.faceOrder;
  const rotations = sceneMeta.settings.faceRotations;

  // This is where the face-order correction panel is applied.
  // For each target cubemap direction (+X, -X, +Y, -Y, +Z, -Z),
  // we choose which source strip face to use and what extra 90° rotation to apply.
  const left = FACE_LABELS.map((targetLabel, index) => {
    const sourceLabel = order[index];
    const sourceIndex = FACE_LABELS.indexOf(sourceLabel);
    return rotateCanvasByDegrees(rawLeftFaces[sourceIndex], rotations[index]);
  });

  const right = FACE_LABELS.map((targetLabel, index) => {
    const sourceLabel = order[index];
    const sourceIndex = FACE_LABELS.indexOf(sourceLabel);
    return rotateCanvasByDegrees(rawRightFaces[sourceIndex], rotations[index]);
  });

  return { left, right };
}

function extractFaceRow(imageSource, sourceY, faceSize) {
  const faces = [];

  for (let index = 0; index < 6; index += 1) {
    const canvas = document.createElement("canvas");
    canvas.width = faceSize;
    canvas.height = faceSize;
    const context = canvas.getContext("2d");

    // This is where the 6×1 cubemap strip is sliced into six square faces.
    context.drawImage(
      imageSource,
      index * faceSize,
      sourceY,
      faceSize,
      faceSize,
      0,
      0,
      faceSize,
      faceSize,
    );

    faces.push(canvas);
  }

  return faces;
}

function rotateCanvasByDegrees(sourceCanvas, degrees) {
  const rotation = ((degrees % 360) + 360) % 360;
  if (rotation === 0) {
    return sourceCanvas;
  }

  const result = document.createElement("canvas");
  result.width = sourceCanvas.width;
  result.height = sourceCanvas.height;
  const ctx = result.getContext("2d");

  ctx.translate(result.width / 2, result.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(sourceCanvas, -sourceCanvas.width / 2, -sourceCanvas.height / 2);
  return result;
}

async function applyStereoFacesToViewer(stereoFaces, sceneMeta) {
  state.faceCanvases = stereoFaces;
  state.currentMeta = structuredClone(sceneMeta);

  clearCubemapGroup(leftCubemapGroup);
  clearCubemapGroup(rightCubemapGroup);
  disposeFaceTextures();

  const leftFaceTextures = stereoFaces.left.map((canvas) => createFaceTexture(canvas));
  const rightFaceTextures = stereoFaces.right.map((canvas) => createFaceTexture(canvas));

  state.faceTextures.left = leftFaceTextures;
  state.faceTextures.right = rightFaceTextures;

  // These two groups are the actual stereo cubemap environments.
  // In immersive VR, only the left XR eye camera sees the left group,
  // and only the right XR eye camera sees the right group.
  buildCubemapGroup(leftCubemapGroup, leftFaceTextures);
  buildCubemapGroup(rightCubemapGroup, rightFaceTextures);

  applyCurrentMeta();
  updateNonVrVisibility();
}

function applyCurrentMeta() {
  if (!state.currentMeta) {
    return;
  }

  state.swapEyes = Boolean(state.currentMeta.settings.swapEyes);
  state.viewYawOffset = Number(state.currentMeta.settings.viewYawOffset || 0);
  contentRoot.rotation.y = state.viewYawOffset;

  setGroupLayer(leftCubemapGroup, state.swapEyes ? LAYER_RIGHT : LAYER_LEFT);
  setGroupLayer(rightCubemapGroup, state.swapEyes ? LAYER_LEFT : LAYER_RIGHT);
  updateNonVrVisibility();
  updateSceneDetails();
}

function buildCubemapGroup(group, textures) {
  const layerId = group.userData.layerId ?? 0;
  const faceConfigs = [
    { position: [cubeHalfSize, 0, 0], rotation: [0, -Math.PI / 2, 0] },
    { position: [-cubeHalfSize, 0, 0], rotation: [0, Math.PI / 2, 0] },
    { position: [0, cubeHalfSize, 0], rotation: [Math.PI / 2, 0, 0] },
    { position: [0, -cubeHalfSize, 0], rotation: [-Math.PI / 2, 0, 0] },
    { position: [0, 0, cubeHalfSize], rotation: [0, Math.PI, 0] },
    { position: [0, 0, -cubeHalfSize], rotation: [0, 0, 0] },
  ];

  textures.forEach((texture, index) => {
    const pivot = new THREE.Group();
    pivot.position.set(...faceConfigs[index].position);
    pivot.rotation.set(...faceConfigs[index].rotation);
    pivot.layers.set(layerId);

    const geometry = new THREE.PlaneGeometry(cubeHalfSize * 2.01, cubeHalfSize * 2.01);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.FrontSide,
      toneMapped: false,
    });

    const plane = new THREE.Mesh(geometry, material);
    plane.layers.set(layerId);
    pivot.add(plane);
    group.add(pivot);
  });
}

function createFaceTexture(canvas) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function clearCubemapGroup(group) {
  while (group.children.length > 0) {
    const child = group.children[0];
    group.remove(child);
    child.traverse((node) => {
      if (node.geometry) {
        node.geometry.dispose();
      }
      if (node.material) {
        node.material.dispose();
      }
    });
  }
}

function disposeFaceTextures() {
  [...state.faceTextures.left, ...state.faceTextures.right].forEach((texture) => texture.dispose());
  state.faceTextures.left = [];
  state.faceTextures.right = [];
}

function syncFaceConfigUi() {
  if (!state.currentMeta) {
    return;
  }

  faceConfigControls.forEach((controls, index) => {
    controls.faceSelect.value = state.currentMeta.settings.faceOrder[index];
    controls.rotationSelect.value = String(state.currentMeta.settings.faceRotations[index]);
  });

  const matchedPresetEntry = Object.entries(FACE_PRESETS).find(([, preset]) => {
    return JSON.stringify(preset.faceOrder) === JSON.stringify(state.currentMeta.settings.faceOrder)
      && JSON.stringify(preset.faceRotations) === JSON.stringify(state.currentMeta.settings.faceRotations);
  });

  ui.presetSelect.value = matchedPresetEntry ? matchedPresetEntry[0] : DEFAULT_PRESET_KEY;
}

function updateSceneDetails() {
  const sceneName = state.currentMeta?.name || "No Scene Loaded";
  const sceneMeta = state.currentMeta
    ? `${state.currentMeta.width} × ${state.currentMeta.height} • ${state.currentMeta.fileName}`
    : "Upload a stereo cubemap to begin.";

  ui.currentSceneName.textContent = sceneName;
  ui.currentSceneMeta.textContent = sceneMeta;

  if (!renderer.xr.isPresenting) {
    setRenderState("Desktop Preview", `Previewing ${state.previewMode} eye cubemap.`);
  }
}

function setRenderState(title, meta) {
  ui.renderState.textContent = title;
  ui.renderStateMeta.textContent = meta;
}

function rotateStoredScene(direction) {
  if (state.currentScene?.id === DEMO_SCENE_ID) {
    pushToast("The demo placeholder contains one generated stereo scene. Upload local scenes to switch between client renders.", "info");
    return;
  }

  if (state.scenes.length === 0 || !state.currentScene) {
    return;
  }

  const ordered = state.scenes.slice().sort((a, b) => b.updatedAt - a.updatedAt);
  const currentIndex = ordered.findIndex((item) => item.id === state.currentScene.id);
  if (currentIndex === -1) {
    return;
  }

  const nextIndex = (currentIndex + direction + ordered.length) % ordered.length;
  loadSceneRecord(ordered[nextIndex]);
}

function rotateViewOffset(deltaRadians) {
  if (!state.currentMeta) {
    return;
  }

  state.currentMeta.settings.viewYawOffset += deltaRadians;
  applyCurrentMeta();
  persistCurrentSceneSettings();
}

function resetView() {
  contentRoot.rotation.set(0, 0, 0);
  state.desktopDrag.yaw = 0;
  state.desktopDrag.pitch = 0;
  camera.rotation.set(0, 0, 0);

  if (state.currentMeta) {
    state.currentMeta.settings.viewYawOffset = 0;
    persistCurrentSceneSettings();
  }

  pushToast("View rotation reset.", "info");
}

function rebuildCurrentSceneFromMeta() {
  if (!state.currentMeta) {
    return;
  }

  if (state.currentMeta.id === DEMO_SCENE_ID) {
    const demoFaces = createDemoStereoFaces();
    applyStereoFacesToViewer(demoFaces, state.currentMeta);
    return;
  }

  const stored = state.scenes.find((item) => item.id === state.currentMeta.id);
  if (stored) {
    loadSceneRecord({
      ...stored,
      settings: structuredClone(state.currentMeta.settings),
    });
  }
}

async function persistCurrentSceneSettings() {
  if (!state.currentMeta || state.currentMeta.id === DEMO_SCENE_ID) {
    return;
  }

  const record = state.scenes.find((item) => item.id === state.currentMeta.id);
  if (!record) {
    return;
  }

  await saveSceneRecord({
    ...record,
    settings: structuredClone(state.currentMeta.settings),
    updatedAt: Date.now(),
  });

  await refreshSceneLibrary();
}

function setGroupLayer(group, layerId) {
  group.userData.layerId = layerId;
  group.layers.set(layerId);
  group.traverse((node) => {
    node.layers.set(layerId);
  });
}

function updateNonVrVisibility() {
  if (renderer.xr.isPresenting) {
    leftCubemapGroup.visible = true;
    rightCubemapGroup.visible = true;
    return;
  }

  if (state.previewMode === "left") {
    leftCubemapGroup.visible = !state.swapEyes;
    rightCubemapGroup.visible = state.swapEyes;
  } else if (state.previewMode === "right") {
    leftCubemapGroup.visible = state.swapEyes;
    rightCubemapGroup.visible = !state.swapEyes;
  } else {
    leftCubemapGroup.visible = true;
    rightCubemapGroup.visible = true;
  }
}

function handlePointerDown(event) {
  if (renderer.xr.isPresenting) {
    return;
  }

  state.desktopDrag.active = true;
  state.desktopDrag.pointerId = event.pointerId;
  state.desktopDrag.lastX = event.clientX;
  state.desktopDrag.lastY = event.clientY;
  renderer.domElement.setPointerCapture(event.pointerId);
}

function handlePointerMove(event) {
  if (renderer.xr.isPresenting || !state.desktopDrag.active || event.pointerId !== state.desktopDrag.pointerId) {
    return;
  }

  const dx = event.clientX - state.desktopDrag.lastX;
  const dy = event.clientY - state.desktopDrag.lastY;
  state.desktopDrag.lastX = event.clientX;
  state.desktopDrag.lastY = event.clientY;

  state.desktopDrag.yaw -= dx * pointerSensitivity;
  state.desktopDrag.pitch -= dy * pointerSensitivity;
  state.desktopDrag.pitch = THREE.MathUtils.clamp(state.desktopDrag.pitch, -Math.PI / 2 + 0.1, Math.PI / 2 - 0.1);

  camera.rotation.y = state.desktopDrag.yaw;
  camera.rotation.x = state.desktopDrag.pitch;
}

function handlePointerUp(event) {
  if (event.pointerId !== state.desktopDrag.pointerId) {
    return;
  }

  state.desktopDrag.active = false;
  state.desktopDrag.pointerId = null;
}

function handleSelectStart(controllerIndex) {
  const hitButton = getHoveredVrButton(controllerIndex);
  if (hitButton) {
    hitButton.userData.action();
    return;
  }

  startControllerDrag(controllerIndex);
}

function handleSelectEnd(controllerIndex) {
  stopControllerDrag(controllerIndex);
}

function startControllerDrag(controllerIndex) {
  const controller = xrControllers[controllerIndex];
  if (!controller) {
    return;
  }

  controller.updateMatrixWorld();
  const position = new THREE.Vector3().setFromMatrixPosition(controller.matrixWorld);
  state.dragActive = true;
  state.dragControllerIndex = controllerIndex;
  state.dragLastX = position.x;
}

function stopControllerDrag(controllerIndex) {
  if (state.dragControllerIndex === controllerIndex) {
    state.dragActive = false;
  }
}

function updateVrInteractions() {
  if (!renderer.xr.isPresenting) {
    vrButtons.forEach((button) => {
      if (button.userData.highlighted) {
        button.userData.highlighted = false;
        drawVrButton(button, false);
      }
    });
    return;
  }

  pollVrMenuToggleButton();

  if (!state.vrMenuVisible) {
    vrButtons.forEach((button) => {
      if (button.userData.highlighted) {
        button.userData.highlighted = false;
        drawVrButton(button, false);
      }
    });
  } else {
    const hoveredButtons = new Set(
      xrControllers
        .map((controller, index) => getHoveredVrButton(index))
        .filter(Boolean),
    );

    vrButtons.forEach((button) => {
      const shouldHighlight = hoveredButtons.has(button);
      if (button.userData.highlighted !== shouldHighlight) {
        button.userData.highlighted = shouldHighlight;
        drawVrButton(button, shouldHighlight);
      }
    });
  }

  if (state.dragActive) {
    const controller = xrControllers[state.dragControllerIndex];
    if (controller) {
      controller.updateMatrixWorld();
      const position = new THREE.Vector3().setFromMatrixPosition(controller.matrixWorld);
      const deltaX = position.x - state.dragLastX;
      state.dragLastX = position.x;
      contentRoot.rotation.y -= deltaX / vrRotateSensitivity;
    }
  }

  pollControllerResetButton();
}

function getHoveredVrButton(controllerIndex) {
  if (!state.vrMenuVisible) {
    return null;
  }

  const controller = xrControllers[controllerIndex];
  if (!controller) {
    return null;
  }

  controllerTempMatrix.identity().extractRotation(controller.matrixWorld);
  raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
  raycaster.ray.direction.set(0, 0, -1).applyMatrix4(controllerTempMatrix);

  const intersects = raycaster.intersectObjects(vrButtons, false);
  return intersects.length > 0 ? intersects[0].object : null;
}

function pollControllerResetButton() {
  const controller = xrControllers[0];
  const gamepad = controller?.userData?.gamepad;
  if (!gamepad?.buttons?.length) {
    return;
  }

  // Many Quest controller profiles expose the primary face button near index 4.
  // This remains a best-effort fallback to complement the floating VR reset button.
  const resetPressed = Boolean(gamepad.buttons[4]?.pressed);
  if (resetPressed && !state.resetButtonLatch) {
    resetView();
  }
  state.resetButtonLatch = resetPressed;
}

function pollVrMenuToggleButton() {
  const rightController = xrControllers.find((controller) => controller?.userData?.handedness === "right");
  const gamepad = rightController?.userData?.gamepad;
  if (!gamepad?.buttons?.length) {
    return;
  }

  // Button index 5 is usually the B button on the right Quest controller.
  const menuTogglePressed = Boolean(gamepad.buttons[5]?.pressed);
  if (menuTogglePressed && !state.vrMenuButtonLatch) {
    state.vrMenuVisible = !state.vrMenuVisible;
    vrUiGroup.visible = state.vrMenuVisible;
  }
  state.vrMenuButtonLatch = menuTogglePressed;
}

function exitVrSession() {
  const session = renderer.xr.getSession();
  if (session) {
    session.end();
  }
}

function updateStereoEyeLayers() {
  if (!renderer.xr.isPresenting) {
    camera.layers.enableAll();
    return;
  }

  const xrCamera = renderer.xr.getCamera(camera);
  if (!xrCamera?.cameras || xrCamera.cameras.length < 2) {
    return;
  }

  // This is the eye separation for true stereo cubemap VR:
  // left XR sub-camera only renders the left-eye cubemap layer,
  // right XR sub-camera only renders the right-eye cubemap layer.
  const [leftEyeCamera, rightEyeCamera] = xrCamera.cameras;
  leftEyeCamera.layers.disableAll();
  rightEyeCamera.layers.disableAll();
  leftEyeCamera.layers.enable(0);
  rightEyeCamera.layers.enable(0);
  leftEyeCamera.layers.enable(LAYER_LEFT);
  rightEyeCamera.layers.enable(LAYER_RIGHT);
}

function renderFrame() {
  updateVrInteractions();
  updateStereoEyeLayers();
  viewIndicator.visible = !renderer.xr.isPresenting;
  renderer.render(scene, camera);
}

function createDirectionIndicator() {
  const group = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.05, 0.012, 12, 64),
    new THREE.MeshBasicMaterial({ color: 0xb7afa3, transparent: true, opacity: 0.5 }),
  );
  ring.rotation.x = Math.PI / 2;
  group.add(ring);

  const arrow = new THREE.Mesh(
    new THREE.ConeGeometry(0.06, 0.22, 16),
    new THREE.MeshBasicMaterial({ color: 0x6b6258, transparent: true, opacity: 0.82 }),
  );
  arrow.position.set(0, 0, -1.05);
  arrow.rotation.x = Math.PI / 2;
  group.add(arrow);

  return group;
}

function onResize() {
  const width = ui.webglRoot.clientWidth || window.innerWidth;
  const height = ui.webglRoot.clientHeight || window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

function pushToast(message, type = "info") {
  const toast = document.createElement("div");
  toast.className = `toast ${type === "error" ? "error" : ""}`;
  toast.textContent = message;
  ui.messageTray.appendChild(toast);

  window.setTimeout(() => {
    toast.remove();
  }, 3600);
}

function showError(message) {
  ui.errorBanner.textContent = message;
  ui.errorBanner.classList.remove("hidden");
  pushToast(message, "error");
}

function clearError() {
  ui.errorBanner.textContent = "";
  ui.errorBanner.classList.add("hidden");
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getAllSceneRecords() {
  return new Promise((resolve, reject) => {
    const transaction = state.db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function saveSceneRecord(record) {
  return new Promise((resolve, reject) => {
    const transaction = state.db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(record);
    request.onsuccess = () => resolve(record);
    request.onerror = () => reject(request.error);
  });
}

function deleteSceneRecord(id) {
  return new Promise((resolve, reject) => {
    const transaction = state.db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
