import * as THREE from "https://unpkg.com/three@0.158.0/build/three.module.js";
import { OrbitControls } from "https://unpkg.com/three@0.158.0/examples/jsm/controls/OrbitControls.js";
import { STLLoader } from "https://unpkg.com/three@0.158.0/examples/jsm/loaders/STLLoader.js";
import { STLExporter } from "https://unpkg.com/three@0.158.0/examples/jsm/exporters/STLExporter.js";

const fileInput = document.getElementById("file-input");
const dropZone = document.getElementById("drop-zone");
const stlText = document.getElementById("stl-text");
const loadTextButton = document.getElementById("load-text");
const autoFit = document.getElementById("auto-fit");
const autoRotate = document.getElementById("auto-rotate");
const binaryExport = document.getElementById("binary-export");
const downloadButton = document.getElementById("download");
const resetViewButton = document.getElementById("reset-view");
const stats = document.getElementById("stats");
const status = document.getElementById("status");
const viewer = document.getElementById("viewer");
const placeholder = document.getElementById("viewer-placeholder");

const scene = new THREE.Scene();
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0);
viewer.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 0.2;
controls.maxDistance = 200;

const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
keyLight.position.set(5, 8, 6);
scene.add(keyLight);
scene.add(new THREE.AmbientLight(0xffffff, 0.6));

const modelGroup = new THREE.Group();
scene.add(modelGroup);

const loader = new STLLoader();
const exporter = new STLExporter();

let currentMesh = null;
let currentGeometry = null;
let currentName = "model.stl";
let currentSize = null;

function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle("error", isError);
}

function formatBytes(bytes) {
  if (bytes === null || bytes === undefined) {
    return "size unknown";
  }
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unitIndex]}`;
}

function updateStats(geometry) {
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  const size = bounds.getSize(new THREE.Vector3());
  const triangles = geometry.attributes.position.count / 3;
  stats.textContent = `${currentName} | ${triangles.toLocaleString()} triangles | ${formatBytes(
    currentSize
  )} | ${size.x.toFixed(2)} x ${size.y.toFixed(2)} x ${size.z.toFixed(2)}`;
}

function resetTransforms() {
  if (!currentMesh) {
    return;
  }
  currentMesh.position.set(0, 0, 0);
  currentMesh.rotation.set(0, 0, 0);
  currentMesh.scale.set(1, 1, 1);
}

function fitMesh(mesh) {
  const box = new THREE.Box3().setFromObject(mesh);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  mesh.position.sub(center);
  const maxDim = Math.max(size.x, size.y, size.z);
  if (maxDim > 0) {
    mesh.scale.setScalar(1 / maxDim);
  }
}

function frameCamera(mesh) {
  const box = new THREE.Box3().setFromObject(mesh);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 1);
  const distance = maxDim * 2.4;

  camera.position.set(center.x + distance, center.y + distance * 0.8, center.z + distance);
  camera.near = Math.max(maxDim / 100, 0.01);
  camera.far = Math.max(maxDim * 100, 10);
  camera.updateProjectionMatrix();

  controls.target.copy(center);
  controls.update();
}

function resetView() {
  if (!currentMesh) {
    return;
  }
  resetTransforms();
  if (autoFit.checked) {
    fitMesh(currentMesh);
  }
  frameCamera(currentMesh);
}

function showMesh(geometry) {
  if (currentMesh) {
    modelGroup.remove(currentMesh);
    currentMesh.material.dispose();
    if (currentMesh.geometry !== geometry) {
      currentMesh.geometry.dispose();
    }
  }

  const material = new THREE.MeshStandardMaterial({
    color: 0xff9a6a,
    metalness: 0.2,
    roughness: 0.45,
  });

  currentMesh = new THREE.Mesh(geometry, material);
  modelGroup.add(currentMesh);
  placeholder.style.display = "none";
  resetView();
}

function loadStl(data, name, size) {
  let geometry;
  try {
    geometry = loader.parse(data);
  } catch (error) {
    setStatus("Could not parse STL. Check the file format.", true);
    return;
  }

  geometry.computeVertexNormals();
  currentGeometry = geometry;
  currentName = name || "model.stl";
  currentSize = size ?? null;
  showMesh(geometry);
  updateStats(geometry);
  downloadButton.disabled = false;
  setStatus("Model loaded.");
}

function handleFile(file) {
  if (!file) {
    return;
  }
  if (!file.name.toLowerCase().endsWith(".stl")) {
    setStatus("Please choose an STL file.", true);
    return;
  }
  const reader = new FileReader();
  reader.onload = (event) => {
    loadStl(event.target.result, file.name, file.size);
  };
  reader.onerror = () => {
    setStatus("Could not read the file.", true);
  };
  reader.readAsArrayBuffer(file);
}

function handleText() {
  const text = stlText.value.trim();
  if (!text) {
    setStatus("Paste STL text before loading.", true);
    return;
  }
  loadStl(text, "pasted-model.stl", new Blob([text]).size);
}

function downloadStl() {
  if (!currentGeometry) {
    return;
  }

  const exportMesh = new THREE.Mesh(
    currentGeometry,
    new THREE.MeshStandardMaterial()
  );
  const result = exporter.parse(exportMesh, { binary: binaryExport.checked });

  const blob = binaryExport.checked
    ? new Blob([result], { type: "application/sla" })
    : new Blob([result], { type: "text/plain" });

  const anchor = document.createElement("a");
  const baseName = currentName.replace(/\.stl$/i, "") || "model";
  anchor.download = `${baseName}-export.stl`;
  anchor.href = URL.createObjectURL(blob);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 0);
  setStatus("Download started.");
}

function onResize() {
  const { width, height } = viewer.getBoundingClientRect();
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function animate() {
  requestAnimationFrame(animate);
  if (autoRotate.checked && currentMesh) {
    modelGroup.rotation.y += 0.004;
  }
  controls.update();
  renderer.render(scene, camera);
}

fileInput.addEventListener("change", (event) => {
  const [file] = event.target.files;
  handleFile(file);
  event.target.value = "";
});

loadTextButton.addEventListener("click", handleText);

downloadButton.addEventListener("click", downloadStl);
resetViewButton.addEventListener("click", resetView);

autoFit.addEventListener("change", () => {
  if (currentMesh) {
    resetView();
  }
});

dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropZone.classList.add("is-dragover");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("is-dragover");
});

dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropZone.classList.remove("is-dragover");
  const [file] = event.dataTransfer.files;
  handleFile(file);
});

window.addEventListener("resize", onResize);

onResize();
frameCamera(modelGroup);
animate();
