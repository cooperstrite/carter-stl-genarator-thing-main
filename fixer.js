const input = document.getElementById("fix-input");
const output = document.getElementById("fix-output");
const formatSelect = document.getElementById("fix-format");
const fixButton = document.getElementById("fix-button");
const copyButton = document.getElementById("copy-fixed");
const status = document.getElementById("fix-status");
const details = document.getElementById("fix-details");

let scadCompilerPromise = null;
let isRunning = false;
const scadErrors = [];

function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle("error", isError);
}

function setDetails(message) {
  details.textContent = message;
}

function recordScadError(message) {
  if (message === undefined || message === null) {
    return;
  }
  scadErrors.push(String(message));
}

function getScadErrorMessage() {
  if (!scadErrors.length) {
    return null;
  }
  const normalized = scadErrors.map((line) => line.replace(/\s+/g, " ").trim());
  const errorLine = [...normalized].reverse().find((line) => /error/i.test(line));
  const warningLine = [...normalized].reverse().find((line) => /warning/i.test(line));
  return errorLine || warningLine || null;
}

function detectFormat(text) {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  if (/^solid\b/i.test(trimmed) && /facet\s+normal/i.test(trimmed)) {
    return "stl";
  }
  if (/\b(module|difference|union|intersection|translate|rotate|scale|cube|sphere|cylinder|polyhedron)\b/i.test(trimmed)) {
    return "scad";
  }
  return null;
}

function repairStlText(inputText) {
  let text = inputText.replace(/\r\n?/g, "\n");
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

function normalizeScadText(inputText) {
  return inputText
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00A0/g, " ")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
}

function repairScadText(inputText) {
  const lines = inputText.replace(/\r\n?/g, "\n").split("\n");
  let changed = false;
  const fixedLines = lines.map((line, index) => {
    let working = line;
    if (index === 0) {
      working = working.replace(/^\uFEFF/, "");
    }
    const match = working.match(
      /^(\s*)([A-Za-z_][\w]*)\s*=\s*(sphere|cube|cylinder|polyhedron|text|import|linear_extrude|rotate_extrude)\b/i
    );
    if (match) {
      working = working.replace(/^(\s*)[A-Za-z_][\w]*\s*=\s*/, "$1");
      changed = true;
    }
    return working;
  });

  return { text: fixedLines.join("\n"), changed };
}

async function getScadCompiler() {
  if (!scadCompilerPromise) {
    scadCompilerPromise = import(
      "https://unpkg.com/openscad-wasm-prebuilt@1.2.0/dist/openscad.js"
    ).then((mod) =>
      mod.createOpenSCAD({
        print: recordScadError,
        printErr: recordScadError,
      })
    );
  }
  return scadCompilerPromise;
}

async function compileScad(text) {
  scadErrors.length = 0;
  const compiler = await getScadCompiler();
  scadErrors.length = 0;
  const cleaned = normalizeScadText(text);
  let stlOutput;
  try {
    stlOutput = await compiler.renderToStl(cleaned);
  } catch (error) {
    const message =
      getScadErrorMessage() || error?.message || "SCAD compile failed.";
    throw new Error(message);
  }
  if (stlOutput === null || stlOutput === undefined) {
    const message = getScadErrorMessage() || "SCAD produced no output.";
    throw new Error(message);
  }
  if (typeof stlOutput === "string" && !stlOutput.trim()) {
    const message = getScadErrorMessage() || "SCAD produced empty output.";
    throw new Error(message);
  }
  return stlOutput;
}

async function fixScad(text) {
  try {
    await compileScad(text);
    return { fixed: text, changed: false, ok: true };
  } catch (error) {
    const result = repairScadText(text);
    if (!result.changed) {
      return {
        fixed: text,
        changed: false,
        ok: false,
        errorMessage: error?.message,
      };
    }
    try {
      await compileScad(result.text);
      return { fixed: result.text, changed: true, ok: true };
    } catch (retryError) {
      return {
        fixed: result.text,
        changed: true,
        ok: false,
        errorMessage: retryError?.message,
      };
    }
  }
}

function getSelectedFormat(text) {
  const choice = formatSelect.value;
  if (choice === "auto") {
    return detectFormat(text);
  }
  return choice;
}

async function fixCode() {
  const raw = input.value;
  const text = raw.replace(/^\uFEFF/, "").trim();
  if (!text) {
    output.value = "";
    copyButton.disabled = true;
    setDetails("Waiting for input.");
    setStatus("Paste code before fixing.", true);
    return;
  }

  const format = getSelectedFormat(text);
  if (!format) {
    output.value = "";
    copyButton.disabled = true;
    setDetails("Auto-detect could not identify the format.");
    setStatus("Choose SCAD or STL in the format menu.", true);
    return;
  }

  output.value = "";
  copyButton.disabled = true;

  if (format === "stl") {
    const fixed = repairStlText(text);
    output.value = fixed;
    copyButton.disabled = false;
    setDetails(
      fixed === text
        ? "No changes detected."
        : "Normalized whitespace, removed non-printables, and ensured solid/endsolid."
    );
    setStatus(
      fixed === text
        ? "STL looks valid. No changes needed."
        : "Applied STL fixes."
    );
    return;
  }

  if (format === "scad") {
    setDetails("Loading SCAD engine and checking syntax...");
    setStatus("Checking SCAD...", false);
    const result = await fixScad(text);
    output.value = result.fixed;
    copyButton.disabled = false;
    if (result.ok && !result.changed) {
      setDetails("SCAD compiled successfully. No changes needed.");
      setStatus("SCAD looks valid.");
      return;
    }
    if (result.ok && result.changed) {
      setDetails("Removed invalid geometry assignment and recompiled.");
      setStatus("Fixed SCAD and it now compiles.");
      return;
    }
    setDetails(
      result.errorMessage || "Auto-fix applied, but SCAD still fails to compile."
    );
    setStatus("Fixer could not fully repair the SCAD.", true);
    return;
  }

  setDetails("This fixer only supports SCAD and ASCII STL.");
  setStatus("Unsupported format.", true);
}

async function copyFixed() {
  const text = output.value;
  if (!text) {
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    setStatus("Fixed code copied to clipboard.");
  } catch (error) {
    output.focus();
    output.select();
    const succeeded = document.execCommand("copy");
    setStatus(
      succeeded ? "Fixed code copied to clipboard." : "Copy failed. Select and copy manually.",
      !succeeded
    );
  }
}

fixButton.addEventListener("click", () => {
  if (isRunning) {
    return;
  }
  isRunning = true;
  fixButton.disabled = true;
  fixCode()
    .catch((error) => {
      setDetails("Unexpected error. Check the console.");
      setStatus(error?.message || "Fixer failed.", true);
    })
    .finally(() => {
      isRunning = false;
      fixButton.disabled = false;
    });
});

copyButton.addEventListener("click", copyFixed);
