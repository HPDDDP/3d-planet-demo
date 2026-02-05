import * as THREE from "https://esm.sh/three@0.160.0";
import { GLTFLoader } from "https://esm.sh/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";

const canvas = document.getElementById("scene");
const video = document.getElementById("video");
const cameraToggle = document.getElementById("cameraToggle");
const cameraStatus = document.getElementById("cameraStatus");
const handStatus = document.getElementById("handStatus");
const pinchValue = document.getElementById("pinchValue");
const modelInput = document.getElementById("modelInput");
const resetPlanet = document.getElementById("resetPlanet");

const scene = new THREE.Scene();
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
});
renderer.setPixelRatio(window.devicePixelRatio || 1);
renderer.setClearColor(0x000000, 0);
if (renderer.outputColorSpace !== undefined) {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
} else if (renderer.outputEncoding !== undefined) {
  renderer.outputEncoding = THREE.sRGBEncoding;
}

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
camera.position.set(0, 0, 3.2);

const pivot = new THREE.Group();
const content = new THREE.Group();
pivot.add(content);
scene.add(pivot);

const ambient = new THREE.AmbientLight(0xffffff, 0.55);
const directional = new THREE.DirectionalLight(0xffffff, 1.1);
directional.position.set(3, 2, 4);
const rim = new THREE.DirectionalLight(0x8cc7ff, 0.6);
rim.position.set(-4, -2, -2);
scene.add(ambient, directional, rim);

const loader = new GLTFLoader();

let cloudMesh = null;
let targetRotationX = 0;
let targetRotationY = 0;
let targetScale = 1;
let handDetected = false;

const smoothedPalm = { x: 0.5, y: 0.5 };
let smoothedPinch = 0.12;

const maxRotX = Math.PI * 0.35;
const maxRotY = Math.PI * 0.6;

let mpHands = null;
let mpCamera = null;
let cameraRunning = false;

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function mapRange(value, inMin, inMax, outMin, outMax) {
  const t = clamp((value - inMin) / (inMax - inMin), 0, 1);
  return outMin + (outMax - outMin) * t;
}

function resizeRenderer() {
  const { clientWidth, clientHeight } = canvas;
  if (!clientWidth || !clientHeight) {
    return;
  }
  const needResize =
    canvas.width !== Math.floor(clientWidth * renderer.getPixelRatio()) ||
    canvas.height !== Math.floor(clientHeight * renderer.getPixelRatio());

  if (needResize) {
    renderer.setSize(clientWidth, clientHeight, false);
    camera.aspect = clientWidth / clientHeight;
    camera.updateProjectionMatrix();
  }
}

function createEarthTexture() {
  const texCanvas = document.createElement("canvas");
  texCanvas.width = 512;
  texCanvas.height = 256;
  const ctx = texCanvas.getContext("2d");

  const ocean = ctx.createLinearGradient(0, 0, 0, texCanvas.height);
  ocean.addColorStop(0, "#0b1c3a");
  ocean.addColorStop(0.5, "#145da8");
  ocean.addColorStop(1, "#0b1c3a");
  ctx.fillStyle = ocean;
  ctx.fillRect(0, 0, texCanvas.width, texCanvas.height);

  for (let i = 0; i < 90; i += 1) {
    const x = Math.random() * texCanvas.width;
    const y = Math.random() * texCanvas.height;
    const w = 18 + Math.random() * 60;
    const h = 10 + Math.random() * 40;
    ctx.fillStyle = i % 3 === 0 ? "#2b8f52" : "#3fa65d";
    ctx.beginPath();
    ctx.ellipse(x, y, w, h, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "rgba(240, 244, 255, 0.85)";
  ctx.fillRect(0, 0, texCanvas.width, 16);
  ctx.fillRect(0, texCanvas.height - 16, texCanvas.width, 16);

  const texture = new THREE.CanvasTexture(texCanvas);
  if (texture.colorSpace !== undefined) {
    texture.colorSpace = THREE.SRGBColorSpace;
  } else if (texture.encoding !== undefined) {
    texture.encoding = THREE.sRGBEncoding;
  }
  return texture;
}

function createCloudTexture() {
  const texCanvas = document.createElement("canvas");
  texCanvas.width = 512;
  texCanvas.height = 256;
  const ctx = texCanvas.getContext("2d");

  ctx.clearRect(0, 0, texCanvas.width, texCanvas.height);

  for (let i = 0; i < 160; i += 1) {
    const x = Math.random() * texCanvas.width;
    const y = Math.random() * texCanvas.height;
    const w = 12 + Math.random() * 40;
    const h = 8 + Math.random() * 28;
    const alpha = 0.1 + Math.random() * 0.3;
    ctx.fillStyle = `rgba(255, 255, 255, ${alpha.toFixed(2)})`;
    ctx.beginPath();
    ctx.ellipse(x, y, w, h, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(texCanvas);
  if (texture.colorSpace !== undefined) {
    texture.colorSpace = THREE.SRGBColorSpace;
  } else if (texture.encoding !== undefined) {
    texture.encoding = THREE.sRGBEncoding;
  }
  return texture;
}

function createEarth() {
  const group = new THREE.Group();

  const surface = new THREE.Mesh(
    new THREE.SphereGeometry(1, 64, 64),
    new THREE.MeshStandardMaterial({
      map: createEarthTexture(),
      roughness: 0.9,
      metalness: 0.05,
    })
  );
  group.add(surface);

  cloudMesh = new THREE.Mesh(
    new THREE.SphereGeometry(1.02, 64, 64),
    new THREE.MeshStandardMaterial({
      map: createCloudTexture(),
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    })
  );
  group.add(cloudMesh);

  return group;
}

function disposeMaterial(material) {
  Object.values(material).forEach((value) => {
    if (value && value.isTexture) {
      value.dispose();
    }
  });
  material.dispose();
}

function disposeObject(object3d) {
  object3d.traverse((node) => {
    if (node.geometry) {
      node.geometry.dispose();
    }
    if (node.material) {
      if (Array.isArray(node.material)) {
        node.material.forEach((material) => disposeMaterial(material));
      } else {
        disposeMaterial(node.material);
      }
    }
  });
}

function setContent(object3d) {
  content.children.forEach((child) => disposeObject(child));
  content.clear();
  cloudMesh = null;

  const box = new THREE.Box3().setFromObject(object3d);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  object3d.position.sub(center);
  const maxDim = Math.max(size.x, size.y, size.z);
  if (maxDim > 0) {
    const scale = 1.4 / maxDim;
    object3d.scale.setScalar(scale);
  }

  content.add(object3d);
}

setContent(createEarth());

function getPalmCenter(landmarks) {
  const wrist = landmarks[0];
  const index = landmarks[5];
  const pinky = landmarks[17];
  return {
    x: (wrist.x + index.x + pinky.x) / 3,
    y: (wrist.y + index.y + pinky.y) / 3,
  };
}

function getPinchDistance(landmarks) {
  const thumbTip = landmarks[4];
  const indexTip = landmarks[8];
  if (!thumbTip || !indexTip) {
    return null;
  }
  return Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y);
}

function onResults(results) {
  const landmarks = results.multiHandLandmarks?.[0];
  if (!landmarks) {
    if (handDetected) {
      handDetected = false;
      handStatus.textContent = "No";
      pinchValue.textContent = "--";
    }
    return;
  }

  handDetected = true;
  handStatus.textContent = "Yes";

  const palm = getPalmCenter(landmarks);
  smoothedPalm.x = lerp(smoothedPalm.x, palm.x, 0.35);
  smoothedPalm.y = lerp(smoothedPalm.y, palm.y, 0.35);

  targetRotationY = mapRange(smoothedPalm.x, 0, 1, -maxRotY, maxRotY);
  targetRotationX = mapRange(smoothedPalm.y, 0, 1, maxRotX, -maxRotX);

  const pinch = getPinchDistance(landmarks);
  if (pinch !== null) {
    smoothedPinch = lerp(smoothedPinch, pinch, 0.35);
    pinchValue.textContent = smoothedPinch.toFixed(3);

    const zoom = mapRange(smoothedPinch, 0.04, 0.25, 0.75, 1.8);
    targetScale = zoom;
  }
}

function ensureHands() {
  if (mpHands) {
    return mpHands;
  }
  if (!window.Hands) {
    cameraStatus.textContent = "Gesture library failed to load";
    return null;
  }

  mpHands = new window.Hands({
    locateFile: (file) =>
      `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
  });
  mpHands.setOptions({
    maxNumHands: 1,
    modelComplexity: 1,
    minDetectionConfidence: 0.7,
    minTrackingConfidence: 0.6,
  });
  mpHands.onResults(onResults);
  return mpHands;
}

async function startCamera() {
  if (cameraRunning) {
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    cameraStatus.textContent = "Camera not supported";
    return;
  }

  const hands = ensureHands();
  if (!hands) {
    return;
  }

  cameraStatus.textContent = "Requesting access...";
  try {
    mpCamera = new window.Camera(video, {
      onFrame: async () => {
        await hands.send({ image: video });
      },
      width: 640,
      height: 480,
    });
    await mpCamera.start();
    cameraRunning = true;
    video.classList.remove("is-hidden");
    cameraStatus.textContent = "Camera on";
    cameraToggle.textContent = "Disable Camera";
  } catch (error) {
    cameraStatus.textContent = "Camera blocked";
    console.error(error);
  }
}

function stopCamera() {
  if (!cameraRunning) {
    return;
  }
  if (mpCamera?.stop) {
    mpCamera.stop();
  }
  if (video.srcObject) {
    video.srcObject.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
  }
  cameraRunning = false;
  handDetected = false;
  handStatus.textContent = "No";
  pinchValue.textContent = "--";
  video.classList.add("is-hidden");
  cameraStatus.textContent = "Camera off";
  cameraToggle.textContent = "Enable Camera";
}

cameraToggle.addEventListener("click", () => {
  if (cameraRunning) {
    stopCamera();
  } else {
    startCamera();
  }
});

modelInput.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  const url = URL.createObjectURL(file);
  loader.load(
    url,
    (gltf) => {
      setContent(gltf.scene);
      URL.revokeObjectURL(url);
    },
    undefined,
    (error) => {
      console.error(error);
      cameraStatus.textContent = "Failed to load model";
      URL.revokeObjectURL(url);
    }
  );
});

resetPlanet.addEventListener("click", () => {
  setContent(createEarth());
});

function animate() {
  requestAnimationFrame(animate);
  resizeRenderer();

  if (!handDetected) {
    targetRotationY += 0.002;
    targetRotationX = lerp(targetRotationX, 0, 0.02);
    targetScale = lerp(targetScale, 1, 0.02);
  }

  pivot.rotation.x = lerp(pivot.rotation.x, targetRotationX, 0.08);
  pivot.rotation.y = lerp(pivot.rotation.y, targetRotationY, 0.08);

  const nextScale = lerp(pivot.scale.x, targetScale, 0.08);
  pivot.scale.setScalar(nextScale);

  if (cloudMesh) {
    cloudMesh.rotation.y += 0.0006;
  }

  renderer.render(scene, camera);
}

window.addEventListener("resize", resizeRenderer);
resizeRenderer();
animate();
