import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { STLExporter } from "three/addons/exporters/STLExporter.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { PLYLoader } from "three/addons/loaders/PLYLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { ThreeMFLoader } from "three/addons/loaders/3MFLoader.js";

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
const errorFlash = document.getElementById("error-flash");
const repairModal = document.getElementById("repair-modal");
const repairMessage = document.getElementById("repair-message");
const repairConfirm = document.getElementById("repair-confirm");
const repairCancel = document.getElementById("repair-cancel");

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

const stlLoader = new STLLoader();
const stlExporter = new STLExporter();
const objLoader = new OBJLoader();
const plyLoader = new PLYLoader();
const gltfLoader = new GLTFLoader();
const threeMfLoader = new ThreeMFLoader();
const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

const FORMAT_LABELS = {
  stl: "STL",
  obj: "OBJ",
  ply: "PLY",
  off: "OFF",
  gltf: "glTF",
  glb: "GLB",
  "3mf": "3MF",
  scad: "SCAD",
};

let currentObject = null;
let currentName = "model.stl";
let currentSize = null;
let pendingRepairText = null;
let scadCompilerPromise = null;

function triggerErrorFlash() {
  if (!errorFlash) {
    return;
  }
  errorFlash.classList.remove("is-active");
  void errorFlash.offsetWidth;
  errorFlash.classList.add("is-active");
}

function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle("error", isError);
  if (isError) {
    triggerErrorFlash();
  }
}

function showRepairPrompt(message, originalText) {
  if (!repairModal || typeof originalText !== "string") {
    return;
  }
  pendingRepairText = originalText;
  if (repairMessage) {
    repairMessage.textContent = message;
  }
  repairModal.hidden = false;
}

function hideRepairPrompt() {
  if (!repairModal) {
    return;
  }
  repairModal.hidden = true;
  pendingRepairText = null;
}

function repairStlText(input) {
  let text = input.replace(/\r\n?/g, "\n");
  text = text.replace(/,/g, " ");
  text = text.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "");
  text = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");

  if (!/^solid\b/i.test(text)) {
    text = `solid model\n${text}`;
  }
  if (!/endsolid\b/i.test(text)) {
    text = `${text}\nendsolid model`;
  }

  return text;
}

function resetTransforms() {
  modelGroup.position.set(0, 0, 0);
  modelGroup.rotation.set(0, 0, 0);
  modelGroup.scale.set(1, 1, 1);
}

function disposeObject(object) {
  object.traverse((child) => {
    if (!child.isMesh) {
      return;
    }
    if (child.geometry) {
      child.geometry.dispose();
    }
    if (child.material) {
      if (Array.isArray(child.material)) {
        child.material.forEach((material) => material.dispose());
      } else {
        child.material.dispose();
      }
    }
  });
}

function clearModel(message, isError = false) {
  if (currentObject) {
    modelGroup.remove(currentObject);
    disposeObject(currentObject);
  }

  currentObject = null;
  currentName = "model.stl";
  currentSize = null;
  placeholder.style.display = "grid";
  stats.textContent = "No model loaded.";
  downloadButton.disabled = true;
  resetTransforms();

  if (message) {
    setStatus(message, isError);
  }
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

function computeObjectStats(object) {
  const bounds = new THREE.Box3();
  bounds.makeEmpty();
  let triangles = 0;

  object.updateWorldMatrix(true, true);
  object.traverse((child) => {
    if (!child.isMesh || !child.geometry) {
      return;
    }
    const position = child.geometry.getAttribute("position");
    if (position) {
      triangles += position.count / 3;
    }
    if (!child.geometry.boundingBox) {
      child.geometry.computeBoundingBox();
    }
    if (child.geometry.boundingBox) {
      const childBox = child.geometry.boundingBox.clone();
      childBox.applyMatrix4(child.matrixWorld);
      bounds.union(childBox);
    }
  });

  const size = bounds.getSize(new THREE.Vector3());
  return { bounds, size, triangles };
}

function updateStats(object) {
  const { size, triangles } = computeObjectStats(object);
  stats.textContent = `${currentName} | ${triangles.toLocaleString()} triangles | ${formatBytes(
    currentSize
  )} | ${size.x.toFixed(2)} x ${size.y.toFixed(2)} x ${size.z.toFixed(2)}`;
}

function fitModel() {
  if (!currentObject) {
    return;
  }
  const { bounds, size } = computeObjectStats(currentObject);
  if (bounds.isEmpty()) {
    return;
  }
  const center = bounds.getCenter(new THREE.Vector3());
  modelGroup.position.sub(center);
  const maxDim = Math.max(size.x, size.y, size.z);
  if (maxDim > 0) {
    modelGroup.scale.setScalar(1 / maxDim);
  }
}

function frameCamera(target) {
  const box = new THREE.Box3().setFromObject(target);
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
  if (!currentObject) {
    return;
  }
  resetTransforms();
  if (autoFit.checked) {
    fitModel();
  }
  frameCamera(modelGroup);
}

function createPreviewMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0xff9a6a,
    metalness: 0.2,
    roughness: 0.45,
  });
}

function applyPreviewMaterial(object) {
  object.traverse((child) => {
    if (!child.isMesh || !child.geometry) {
      return;
    }
    if (child.material) {
      if (Array.isArray(child.material)) {
        child.material.forEach((material) => material.dispose());
      } else {
        child.material.dispose();
      }
    }
    if (!child.geometry.getAttribute("normal")) {
      child.geometry.computeVertexNormals();
    }
    child.material = createPreviewMaterial();
  });
}

function showObject(object) {
  if (currentObject) {
    modelGroup.remove(currentObject);
    disposeObject(currentObject);
  }
  resetTransforms();
  currentObject = object;
  modelGroup.add(object);
  placeholder.style.display = "none";
}

function validateObject(object) {
  const { bounds, size, triangles } = computeObjectStats(object);
  if (!Number.isFinite(triangles) || triangles <= 0) {
    return "No triangles found. Check that the data is valid.";
  }
  if (bounds.isEmpty()) {
    return "Could not compute geometry bounds. Check the data.";
  }
  if (![size.x, size.y, size.z].every(Number.isFinite)) {
    return "Invalid geometry values detected. Check the data.";
  }
  return null;
}

function finalizeLoad(object, name, size, label) {
  currentName = name || "model.stl";
  currentSize = size ?? null;
  showObject(object);
  updateStats(object);
  downloadButton.disabled = false;
  resetView();
  setStatus(`${label} loaded. Ready to download.`);
}

function detectFormatFromText(text) {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  if (/^\s*\{/.test(trimmed) && /"asset"\s*:\s*\{/.test(trimmed)) {
    return "gltf";
  }
  if (/^solid\b/i.test(trimmed) && /facet\s+normal/i.test(trimmed)) {
    return "stl";
  }
  if (/^ply\b/i.test(trimmed)) {
    return "ply";
  }
  if (/^(?:c?off)\b/i.test(trimmed)) {
    return "off";
  }
  if (/^(?:#.*\n)?\s*(o|g|v|vn|vt|f)\s+/im.test(trimmed)) {
    return "obj";
  }
  if (/\b(module|difference|union|intersection|translate|rotate|scale|cube|sphere|cylinder)\b/i.test(trimmed)) {
    return "scad";
  }
  return null;
}

function detectFormatFromFile(name, headerText) {
  const extension = name.split(".").pop().toLowerCase();
  const known = ["stl", "obj", "ply", "off", "gltf", "glb", "3mf", "scad"];
  if (known.includes(extension)) {
    return extension;
  }

  if (headerText.includes("glTF")) {
    return "glb";
  }
  return detectFormatFromText(headerText);
}

function isLikelyAsciiStl(headerText) {
  return /^solid\b/i.test(headerText) && /facet\b/i.test(headerText);
}

async function parseGltf(data) {
  return new Promise((resolve, reject) => {
    gltfLoader.parse(
      data,
      "",
      (gltf) => {
        resolve(gltf.scene || gltf.scenes[0]);
      },
      (error) => {
        reject(error);
      }
    );
  });
}

async function getScadCompiler() {
  if (!scadCompilerPromise) {
    scadCompilerPromise = import(
      "https://unpkg.com/openscad-wasm-prebuilt@1.2.0/dist/openscad.js"
    ).then((mod) => mod.createOpenSCAD());
  }
  return scadCompilerPromise;
}

async function parseScad(text) {
  setStatus("Loading SCAD engine...");
  const compiler = await getScadCompiler();
  setStatus("Compiling SCAD...");
  const stlText = await compiler.renderToStl(text);
  if (!stlText || !/solid\\b/i.test(stlText)) {
    throw new Error("SCAD compile failed. Check the syntax.");
  }
  return parseStlData(stlText);
}

function parseStlData(data) {
  const geometry = stlLoader.parse(data);
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, createPreviewMaterial());
}

function parseOff(text) {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  if (lines.length === 0) {
    throw new Error("OFF file is empty.");
  }

  const header = lines.shift();
  if (!/^(?:C?OFF)/i.test(header)) {
    throw new Error("Invalid OFF header.");
  }

  let countsLine = header.replace(/^(?:C?OFF)\s*/i, "").trim();
  if (!countsLine) {
    countsLine = lines.shift();
  }
  if (!countsLine) {
    throw new Error("OFF vertex count missing.");
  }
  const [vertexCount, faceCount] = countsLine
    .split(/\s+/)
    .slice(0, 2)
    .map(Number);

  if (!Number.isFinite(vertexCount) || !Number.isFinite(faceCount)) {
    throw new Error("OFF counts are invalid.");
  }

  const vertices = [];
  for (let i = 0; i < vertexCount; i += 1) {
    const line = lines.shift();
    if (!line) {
      throw new Error("OFF vertex data is incomplete.");
    }
    const parts = line.split(/\s+/).map(Number);
    if (parts.length < 3) {
      throw new Error("OFF vertex entry is invalid.");
    }
    vertices.push(parts[0], parts[1], parts[2]);
  }

  const indices = [];
  for (let i = 0; i < faceCount; i += 1) {
    const line = lines.shift();
    if (!line) {
      throw new Error("OFF face data is incomplete.");
    }
    const parts = line.split(/\s+/).map(Number);
    if (parts.length < 4) {
      continue;
    }
    const faceVertices = parts[0];
    if (!Number.isFinite(faceVertices) || faceVertices < 3) {
      continue;
    }
    const faceIndices = parts.slice(1, 1 + faceVertices);
    for (let j = 1; j < faceIndices.length - 1; j += 1) {
      indices.push(faceIndices[0], faceIndices[j], faceIndices[j + 1]);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(vertices, 3)
  );
  if (indices.length) {
    geometry.setIndex(indices);
  }
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, createPreviewMaterial());
}

async function parseByFormat(format, data) {
  switch (format) {
    case "stl":
      return parseStlData(data);
    case "obj":
      return objLoader.parse(data);
    case "ply":
      return new THREE.Mesh(
        plyLoader.parse(
          typeof data === "string" ? textEncoder.encode(data).buffer : data
        ),
        createPreviewMaterial()
      );
    case "off":
      return parseOff(data);
    case "gltf":
    case "glb":
      return await parseGltf(data);
    case "3mf":
      return threeMfLoader.parse(data);
    case "scad":
      return await parseScad(data);
    default:
      throw new Error("Unsupported format.");
  }
}

async function loadInput({ format, data, name, size, allowRepair }) {
  const label = FORMAT_LABELS[format] || format.toUpperCase();
  setStatus(`Loading ${label}...`);
  downloadButton.disabled = true;

  let object;
  try {
    object = await parseByFormat(format, data);
  } catch (error) {
    const fallbackMessage = `Could not parse ${label}.`;
    const message = error?.message || fallbackMessage;
    clearModel(message, true);
    if (allowRepair && typeof data === "string") {
      showRepairPrompt("Formatting issues found. Try to auto-fix the STL text?", data);
    }
    return;
  }

  if (!object || !object.isObject3D) {
    clearModel(`${label} did not contain any renderable geometry.`, true);
    return;
  }

  applyPreviewMaterial(object);
  const validationMessage = validateObject(object);
  if (validationMessage) {
    disposeObject(object);
    clearModel(validationMessage, true);
    if (allowRepair && typeof data === "string") {
      showRepairPrompt("Issues found. Try to auto-fix the STL text?", data);
    }
    return;
  }

  finalizeLoad(object, name, size, label);
}

async function handleText() {
  const text = stlText.value.replace(/^\uFEFF/, "").trim();
  if (!text) {
    clearModel("Paste model code before loading.", true);
    return;
  }

  const format = detectFormatFromText(text);
  if (!format) {
    clearModel("Unrecognized format. Paste STL, OBJ, PLY, OFF, glTF JSON, or SCAD.", true);
    return;
  }

  const size = new Blob([text]).size;
  const name = `pasted.${format}`;
  const allowRepair = format === "stl";
  await loadInput({ format, data: text, name, size, allowRepair });
}

async function handleFile(file) {
  if (!file) {
    return;
  }

  const buffer = await file.arrayBuffer();
  const headerText = textDecoder.decode(buffer.slice(0, 512));
  const format = detectFormatFromFile(file.name, headerText);

  if (!format) {
    clearModel("Unrecognized file format. Use STL, OBJ, PLY, OFF, glTF/GLB, 3MF, or SCAD.", true);
    return;
  }

  let data = buffer;
  let allowRepair = false;
  if (format === "stl") {
    if (isLikelyAsciiStl(headerText)) {
      data = textDecoder.decode(buffer);
      allowRepair = true;
    }
  } else if (["obj", "off", "gltf", "scad"].includes(format)) {
    data = textDecoder.decode(buffer);
  } else if (format === "ply") {
    data = buffer;
  } else if (format === "glb" || format === "3mf") {
    data = buffer;
  }

  await loadInput({
    format,
    data,
    name: file.name,
    size: file.size,
    allowRepair,
  });
}

function downloadStl() {
  if (!currentObject) {
    return;
  }

  const saved = {
    position: modelGroup.position.clone(),
    rotation: modelGroup.rotation.clone(),
    scale: modelGroup.scale.clone(),
  };
  resetTransforms();
  modelGroup.updateMatrixWorld(true);
  const result = stlExporter.parse(currentObject, { binary: binaryExport.checked });
  modelGroup.position.copy(saved.position);
  modelGroup.rotation.copy(saved.rotation);
  modelGroup.scale.copy(saved.scale);

  const blob = binaryExport.checked
    ? new Blob([result], { type: "application/sla" })
    : new Blob([result], { type: "text/plain" });

  const anchor = document.createElement("a");
  const baseName = currentName.replace(/\.[^/.]+$/, "") || "model";
  anchor.download = `${baseName}-export.stl`;
  anchor.href = URL.createObjectURL(blob);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 0);
  setStatus("Download started.");
}

function applyRepair() {
  if (!pendingRepairText) {
    hideRepairPrompt();
    return;
  }
  const repaired = repairStlText(pendingRepairText);
  hideRepairPrompt();
  if (!repaired || repaired === pendingRepairText) {
    setStatus("No fixable issues found in the STL text.", true);
    return;
  }
  stlText.value = repaired;
  loadInput({
    format: "stl",
    data: repaired,
    name: "repaired-model.stl",
    size: new Blob([repaired]).size,
    allowRepair: false,
  });
}

function onResize() {
  const { width, height } = viewer.getBoundingClientRect();
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function animate() {
  requestAnimationFrame(animate);
  if (autoRotate.checked && currentObject) {
    modelGroup.rotation.y += 0.004;
  }
  controls.update();
  renderer.render(scene, camera);
}

fileInput.addEventListener("change", (event) => {
  const [file] = event.target.files;
  handleFile(file).catch((error) => {
    clearModel(error?.message || "Could not read the file.", true);
  });
  event.target.value = "";
});

loadTextButton.addEventListener("click", () => {
  handleText().catch((error) => {
    clearModel(error?.message || "Could not parse the text.", true);
  });
});

downloadButton.addEventListener("click", downloadStl);
resetViewButton.addEventListener("click", resetView);

if (repairConfirm && repairCancel) {
  repairConfirm.addEventListener("click", applyRepair);
  repairCancel.addEventListener("click", hideRepairPrompt);
}

if (errorFlash) {
  errorFlash.addEventListener("animationend", () => {
    errorFlash.classList.remove("is-active");
  });
}

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
  handleFile(file).catch((error) => {
    clearModel(error?.message || "Could not read the file.", true);
  });
});

autoFit.addEventListener("change", () => {
  if (currentObject) {
    resetView();
  }
});

window.addEventListener("resize", onResize);

onResize();
frameCamera(modelGroup);
animate();
