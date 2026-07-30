(function main() {
  /** @type {HTMLElement} */
  const inputBox = document.getElementById("userInputBox");
  /** @type {HTMLInputElement} */
  const userInput = document.getElementById("userInput");
  /** @type {HTMLButtonElement} */
  const unitBtn = document.getElementById("unitBtn");
  /** @type {HTMLElement} */
  const nodata = document.getElementById("nodata");
  /** @type {SVGElement} */
  const visualisation = document.getElementById("visualisation");

  /** OCR Elements */
  const ocrStatusBadge = document.getElementById("ocrStatusBadge");
  const ocrStatusText = document.getElementById("ocrStatusText");
  const stopOcrBtn = document.getElementById("stopOcrBtn");
  const ocrModal = document.getElementById("ocrModal");
  const ocrVideo = document.getElementById("ocrVideo");
  const ocrCanvas = document.getElementById("ocrCanvas");
  const startOcrTrackingBtn = document.getElementById("startOcrTrackingBtn");
  const cancelOcrModalBtn = document.getElementById("cancelOcrModalBtn");

  /** @type {{ts: Date, pos: number}[]} */
  const data = [];
  /** @type {number | null} */
  let userEnteredPos = null;

  /** Target Denominator State */
  let targetMax = 100;
  let isPercentMode = true;
  let isEditingDenominator = false;

  /** OCR State */
  let ocrStream = null;
  let ocrWorker = null;
  let ocrInterval = null;
  let ocrSelection = null;
  let isOcrScanning = false;
  let isDraggingSelection = false;
  let dragStart = { x: 0, y: 0 };
  let currentSelectionRect = null;

  function updateUnitBtnUI() {
    if (isPercentMode || targetMax === 100) {
      unitBtn.textContent = "%";
      unitBtn.title = "Click or type '/' to set custom target denominator";
    } else {
      unitBtn.textContent = `/ ${targetMax}`;
      unitBtn.title = "Click or type '/' to edit target denominator";
    }
  }

  unitBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    isEditingDenominator = true;
    unitBtn.style.display = "none";

    userInput.value = targetMax.toString();
    userEnteredPos = targetMax;
    userInput.placeholder = "Target";

    setTimeout(() => {
      userInput.focus();
      userInput.select();
    }, 10);
  });

  // SVG helper functions
  function setElement(parent, id, tagName, attributes) {
    let element = parent.querySelector(`#${id}`);
    if (!element) {
      element = document.createElementNS("http://www.w3.org/2000/svg", tagName);
      element.id = id;
      parent.appendChild(element);
    }
    for (const key in attributes) {
      element.setAttribute(key, attributes[key]);
    }
    return element;
  }

  function removeElement(parent, id) {
    let element = parent.querySelector(`#${id}`);
    if (element) {
      element.remove();
    }
  }

  function friendlyDate(date, ETA = false) {
    const now = new Date();
    const diff = Math.floor((date.getTime() - now.getTime()) / 1000);
    const absDiff = Math.abs(diff);

    const units = [60, 60, 24, Number.MAX_SAFE_INTEGER];
    const unitNames = ["s", "m", "h", "d"];
    const values = [];
    let v = absDiff;
    for (let i = 0; i < units.length; i++) {
      let value = Math.floor(v) % units[i];
      if (value > 0) values.unshift(`${value}${unitNames[i]}`);
      v = (v - value) / units[i];
    }
    if (ETA) {
      const eta = absDiff > 0 ? values.join(" ") : "...";
      const atTime = date.toLocaleTimeString([], { seconds: "numeric" });
      return `ETA: ${eta} @ ${atTime}`;
    }

    if (values.length == 0 || absDiff < 2) return "N";
    return "-" + values[0];
  }

  function calculateETA(data, targetMaxVal = 100, n = 5) {
    const now = new Date();

    const recentPoints = data.slice(-n).map((d) => ({
      x: (d.ts.getTime() - now.getTime()) / 1000,
      y: d.pos,
    }));

    const lastPoint = recentPoints[recentPoints.length - 1];

    let averageSpeeds = [];
    for (let i = 0; i < recentPoints.length - 1; i++) {
      const { x, y } = recentPoints[i];
      averageSpeeds.push((lastPoint.y - y) / (lastPoint.x - x));
    }

    let weightedSum = 0;
    let weightTotal = 0;
    for (let i = 0; i < averageSpeeds.length; i++) {
      const speed = averageSpeeds[i];
      if (speed < 0) continue;

      const weight = Math.pow(0.5, averageSpeeds.length - 1 - i);
      weightedSum += weight * speed;
      weightTotal += weight;
    }

    let weightedAverageSpeed = 0;
    if (weightTotal !== 0) {
      weightedAverageSpeed = Math.max(0, weightedSum / weightTotal);
    }

    const point = {
      ts: now,
      pos: Math.min(
        targetMaxVal,
        lastPoint.y + weightedAverageSpeed * (0 - lastPoint.x),
      ),
    };
    let message = "";
    if (point.pos >= targetMaxVal) {
      message = "Done!";
    } else if (weightedAverageSpeed > 0) {
      const etaTime =
        ((targetMaxVal - lastPoint.y) / weightedAverageSpeed + lastPoint.x) * 1000 +
        now.getTime();
      message = friendlyDate(new Date(etaTime), true);
    }

    return { point, message };
  }

  const LAYOUT = {
    timeAxisHeight: 30,
    paddingTop: 40,
    paddingBottom: 20,
    paddingHorizontal: 30,
    width: 800,
    height: 250,
  };

  function update() {
    resizeGraph();
    updateGraph(data);
    updateNoData();

    if (localStorage.getItem("smooth") == "true") {
      requestAnimationFrame(update);
    } else {
      clearInterval(update.interval);
      update.interval = setTimeout(() => update(), 1000);
    }
  }

  function resizeGraph() {
    LAYOUT.width = visualisation.clientWidth || 800;
    LAYOUT.height = visualisation.clientHeight || 250;
    LAYOUT.plotHeight =
      LAYOUT.height -
      LAYOUT.timeAxisHeight -
      LAYOUT.paddingBottom -
      LAYOUT.paddingTop;
    LAYOUT.plotWidth = LAYOUT.width - 2 * LAYOUT.paddingHorizontal;

    visualisation.setAttribute(
      "viewBox",
      `0 0 ${LAYOUT.width} ${LAYOUT.height}`,
    );
    visualisation.setAttribute("preserveAspectRatio", "none");

    setElement(visualisation, "background", "rect", {
      x: 0,
      y: 0,
      width: LAYOUT.width,
      height: LAYOUT.height,
      fill: "var(--elements-bg-color)",
      rx: 8,
      ry: 8,
    });
    setElement(visualisation, "axis", "line", {
      x1: 0,
      y1: LAYOUT.height - LAYOUT.timeAxisHeight,
      x2: LAYOUT.width,
      y2: LAYOUT.height - LAYOUT.timeAxisHeight,
      stroke: "white",
    });
  }

  function updateNoData() {
    nodata.style.display = data.length == 0 ? "block" : "none";
  }

  function updateGraph(data) {
    if (data.length == 0) {
      ["path-history", "area-history", "path-projection", "eta"].forEach((id) =>
        removeElement(visualisation, id)
      );
      return;
    }

    data = [...data];
    let ETAMessage = "";
    let nextPoint = null;
    if (data.length > 1) {
      const { point, message } = calculateETA(data, targetMax);
      nextPoint = point;
      ETAMessage = message;
    }
    function getPointCount() {
      if (nextPoint) {
        return data.length + 1;
      }
      return data.length;
    }
    function getPoint(index) {
      if (index == data.length && nextPoint) {
        return nextPoint;
      }
      return data[index];
    }

    setElement(visualisation, "eta", "text", {
      x: LAYOUT.paddingHorizontal,
      y: LAYOUT.paddingTop,
      fill: "white",
      "text-anchor": "start",
    }).textContent = ETAMessage;
    if (ETAMessage.length > 0)
      document.title = `${ETAMessage} - Progress Tracker`;

    let maxPos = targetMax;
    for (let index = 0; index < getPointCount(); index++) {
      maxPos = Math.max(maxPos, getPoint(index).pos);
    }

    const nowTs = new Date().getTime();
    let maxTs = nowTs;
    if (nextPoint && nextPoint.ts.getTime() > maxTs) {
      maxTs = nextPoint.ts.getTime();
    }

    let minTs = nowTs - 30000;
    if (data.length > 0) {
      if (data.length >= 5) {
        const fifthTs = data[data.length - 5].ts.getTime();
        const span5 = Math.max(5000, maxTs - fifthTs);
        minTs = fifthTs - span5 * 0.1;
      } else {
        const firstTs = data[0].ts.getTime();
        const span = Math.max(10000, maxTs - firstTs);
        minTs = firstTs - span * 0.1;
      }
    }
    const timeSpan = Math.max(1000, maxTs - minTs);

    function getPointCoordinates(ts, pos) {
      return {
        x:
          LAYOUT.paddingHorizontal +
          (LAYOUT.plotWidth * (ts.getTime() - minTs)) / timeSpan,
        y: LAYOUT.paddingTop + LAYOUT.plotHeight * (1 - Math.min(1, Math.max(0, pos / maxPos))),
      };
    }

    const historicalCoords = data.map((d) => getPointCoordinates(d.ts, d.pos));
    if (historicalCoords.length > 1) {
      let pathD = `M ${historicalCoords[0].x.toFixed(1)},${historicalCoords[0].y.toFixed(1)}`;
      for (let i = 1; i < historicalCoords.length; i++) {
        pathD += ` L ${historicalCoords[i].x.toFixed(1)},${historicalCoords[i].y.toFixed(1)}`;
      }
      setElement(visualisation, "path-history", "path", {
        d: pathD,
        fill: "none",
        stroke: "white",
        "stroke-width": "2.5",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      });

      const axisY = LAYOUT.height - LAYOUT.timeAxisHeight;
      const areaD =
        pathD +
        ` L ${historicalCoords[historicalCoords.length - 1].x.toFixed(1)},${axisY}` +
        ` L ${historicalCoords[0].x.toFixed(1)},${axisY} Z`;
      setElement(visualisation, "area-history", "path", {
        d: areaD,
        fill: "rgba(255, 255, 255, 0.08)",
        stroke: "none",
      });
    } else {
      removeElement(visualisation, "path-history");
      removeElement(visualisation, "area-history");
    }

    if (nextPoint && historicalCoords.length > 0) {
      const lastCoord = historicalCoords[historicalCoords.length - 1];
      const etaCoord = getPointCoordinates(nextPoint.ts, nextPoint.pos);
      setElement(visualisation, "path-projection", "line", {
        x1: lastCoord.x,
        y1: lastCoord.y,
        x2: etaCoord.x,
        y2: etaCoord.y,
        stroke: "rgba(255, 255, 255, 0.6)",
        "stroke-width": "2",
        "stroke-dasharray": "6,4",
      });
    } else {
      removeElement(visualisation, "path-projection");
    }

    let lastTickX = null;
    for (let index = getPointCount() - 1; index >= 0; index--) {
      const { ts, pos } = getPoint(index);
      const { x, y } = getPointCoordinates(ts, pos);
      if (x < -200) {
        [
          `e${index}-circle`,
          `e${index}-circle-text`,
          `e${index}-tick`,
          `e${index}-tick-text`,
        ].forEach((id) => removeElement(visualisation, id));
        continue;
      }

      const formattedLabel = isPercentMode
        ? `${pos.toFixed(1)}%`
        : `${pos}/${targetMax}`;

      if (index == getPointCount() - 1) {
        setElement(visualisation, `e${index}-circle`, "circle", {
          cx: x,
          cy: y,
          r: 5,
          fill: "white",
        });
        setElement(visualisation, `e${index}-circle-text`, "text", {
          x: x,
          y: y - 10,
          fill: "white",
          "text-anchor": "middle",
        }).textContent = formattedLabel;
      } else {
        setElement(visualisation, `e${index}-circle`, "circle", {
          cx: x,
          cy: y,
          r: 3,
          fill: "none",
          stroke: "white",
        });
        setElement(
          visualisation,
          `e${index}-circle-text`,
          "text",
          {},
        ).textContent = "";
      }

      if (lastTickX === null || lastTickX - x > 30) {
        lastTickX = x;
        setElement(visualisation, `e${index}-tick-text`, "text", {
          x: x,
          y: LAYOUT.height - LAYOUT.timeAxisHeight + 10,
          fill: "white",
          "dominant-baseline": "hanging",
          "text-anchor": "middle",
        }).textContent = friendlyDate(ts);
        setElement(visualisation, `e${index}-tick`, "line", {
          x1: x,
          y1: LAYOUT.height - LAYOUT.timeAxisHeight,
          x2: x,
          y2: LAYOUT.height - LAYOUT.timeAxisHeight + 8,
          stroke: "white",
        });
      } else {
        setElement(visualisation, `e${index}-tick-text`, "text", {
          fill: "none",
        }).textContent = "";
        setElement(visualisation, `e${index}-tick`, "line", {
          x1: x,
          y1: LAYOUT.height - LAYOUT.timeAxisHeight,
          x2: x,
          y2: LAYOUT.height - LAYOUT.timeAxisHeight + 5,
          stroke: "white",
        });
      }
    }
  }

  // Prevent input numbers from exceeding targetMax during numerator entry
  userInput.addEventListener("input", (e) => {
    let raw = e.target.value.replace(/[^0-9\.]/g, "");
    const parts = raw.split(".");
    if (parts.length > 2) {
      raw = parts[0] + "." + parts.slice(1).join("");
    }
    raw = raw.replace(/^0+([0-9])/, "$1");

    let parsedValue = raw === "" ? null : Number(raw);

    if (!isEditingDenominator && parsedValue !== null && parsedValue > targetMax) {
      raw = userEnteredPos !== null ? userEnteredPos.toString() : "";
      parsedValue = userEnteredPos;
    }

    if (e.target.value !== raw) {
      e.target.value = raw;
    }
    userEnteredPos = parsedValue;
  });

  function showInput() {
    inputBox.style.display = "flex";
    isEditingDenominator = false;
    unitBtn.style.display = "inline-block";
    userInput.placeholder = "0";
    userInput.value = "";
    userEnteredPos = null;
    updateUnitBtnUI();
    userInput.focus();
    update();
  }

  function hideInput() {
    inputBox.style.display = "none";
    userInput.blur();
    isEditingDenominator = false;
    unitBtn.style.display = "inline-block";
    userInput.placeholder = "0";
    userInput.value = "";
    userEnteredPos = null;
    window.scrollTo(0, 0);
    update();
  }

  // ==================== OCR Implementation ====================

  async function startOcrSetup() {
    try {
      ocrStream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: "always" },
        audio: false,
      });

      ocrVideo.srcObject = ocrStream;

      ocrVideo.onloadedmetadata = () => {
        ocrVideo.play();
        const vw = ocrVideo.videoWidth || 800;
        const vh = ocrVideo.videoHeight || 600;

        ocrCanvas.width = vw;
        ocrCanvas.height = vh;

        const ctx = ocrCanvas.getContext("2d");
        ctx.drawImage(ocrVideo, 0, 0, vw, vh);

        ocrModal.style.display = "flex";
        currentSelectionRect = null;
        startOcrTrackingBtn.disabled = true;
      };

      ocrStream.getVideoTracks()[0].addEventListener("ended", () => {
        stopOcrTracking();
      });
    } catch (err) {
      console.warn("Screen share cancelled or failed:", err);
    }
  }

  function drawOcrSelectionFrame() {
    const ctx = ocrCanvas.getContext("2d");
    ctx.drawImage(ocrVideo, 0, 0, ocrCanvas.width, ocrCanvas.height);

    if (currentSelectionRect) {
      const { x, y, w, h } = currentSelectionRect;
      ctx.strokeStyle = "#4cd964";
      ctx.lineWidth = 3;
      ctx.strokeRect(x, y, w, h);

      ctx.fillStyle = "rgba(76, 217, 100, 0.15)";
      ctx.fillRect(x, y, w, h);
    }
  }

  ocrCanvas.addEventListener("mousedown", (e) => {
    const rect = ocrCanvas.getBoundingClientRect();
    const scaleX = ocrCanvas.width / rect.width;
    const scaleY = ocrCanvas.height / rect.height;

    dragStart.x = (e.clientX - rect.left) * scaleX;
    dragStart.y = (e.clientY - rect.top) * scaleY;
    isDraggingSelection = true;
  });

  ocrCanvas.addEventListener("mousemove", (e) => {
    if (!isDraggingSelection) return;
    const rect = ocrCanvas.getBoundingClientRect();
    const scaleX = ocrCanvas.width / rect.width;
    const scaleY = ocrCanvas.height / rect.height;

    const currentX = (e.clientX - rect.left) * scaleX;
    const currentY = (e.clientY - rect.top) * scaleY;

    const x = Math.min(dragStart.x, currentX);
    const y = Math.min(dragStart.y, currentY);
    const w = Math.abs(currentX - dragStart.x);
    const h = Math.abs(currentY - dragStart.y);

    currentSelectionRect = { x, y, w, h };
    drawOcrSelectionFrame();
  });

  ocrCanvas.addEventListener("mouseup", () => {
    if (isDraggingSelection) {
      isDraggingSelection = false;
      if (currentSelectionRect && currentSelectionRect.w > 10 && currentSelectionRect.h > 10) {
        startOcrTrackingBtn.disabled = false;
      }
    }
  });

  cancelOcrModalBtn.addEventListener("click", () => {
    closeOcrModal();
    stopOcrTracking();
  });

  function closeOcrModal() {
    ocrModal.style.display = "none";
  }

  startOcrTrackingBtn.addEventListener("click", () => {
    if (!currentSelectionRect) return;
    ocrSelection = { ...currentSelectionRect };
    closeOcrModal();
    initiateOcrLoop();
  });

  async function initiateOcrLoop() {
    ocrStatusBadge.style.display = "flex";
    ocrStatusText.textContent = "OCR Active: Initializing Tesseract engine...";

    if (!ocrWorker) {
      if (typeof Tesseract !== "undefined") {
        ocrWorker = await Tesseract.createWorker("eng");
      } else {
        ocrStatusText.textContent = "OCR Error: Tesseract.js library not loaded.";
        return;
      }
    }

    ocrStatusText.textContent = "OCR Active: Scanning selected region...";

    if (ocrInterval) clearInterval(ocrInterval);
    ocrInterval = setInterval(performOcrScan, 2500);
    performOcrScan();
  }

  async function performOcrScan() {
    if (!ocrWorker || !ocrSelection || !ocrVideo || ocrVideo.readyState < 2) return;

    try {
      const { x, y, w, h } = ocrSelection;
      const offCanvas = document.createElement("canvas");
      offCanvas.width = Math.max(1, w);
      offCanvas.height = Math.max(1, h);
      const offCtx = offCanvas.getContext("2d");

      offCtx.drawImage(ocrVideo, x, y, w, h, 0, 0, w, h);

      // Pre-processing: Binarize image to sharpen text contrast
      const imgData = offCtx.getImageData(0, 0, w, h);
      const d = imgData.data;
      for (let i = 0; i < d.length; i += 4) {
        const avg = (d[i] + d[i + 1] + d[i + 2]) / 3;
        const v = avg > 140 ? 255 : 0;
        d[i] = v;
        d[i + 1] = v;
        d[i + 2] = v;
      }
      offCtx.putImageData(imgData, 0, 0);

      const res = await ocrWorker.recognize(offCanvas);
      const text = res.data.text ? res.data.text.trim() : "";

      // Regex 1: Match fractions e.g. "15/40"
      const fracMatch = text.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
      if (fracMatch) {
        const num = parseFloat(fracMatch[1]);
        const denom = parseFloat(fracMatch[2]);
        if (!isNaN(denom) && denom > 0) {
          targetMax = denom;
          isPercentMode = false;
          updateUnitBtnUI();
        }
        if (!isNaN(num)) {
          logOcrDataPoint(num);
          ocrStatusText.textContent = `OCR Active: Logged ${num}/${targetMax}`;
          return;
        }
      }

      // Regex 2: Match single percentage or decimal number
      const numMatch = text.match(/(\d+(?:\.\d+)?)/);
      if (numMatch) {
        const num = parseFloat(numMatch[1]);
        if (!isNaN(num)) {
          logOcrDataPoint(num);
          ocrStatusText.textContent = `OCR Active: Logged ${isPercentMode ? num + '%' : num + '/' + targetMax}`;
        }
      }
    } catch (err) {
      console.warn("OCR Scan Error:", err);
    }
  }

  function logOcrDataPoint(val) {
    if (val > targetMax) return;
    const lastPoint = data.length > 0 ? data[data.length - 1].pos : null;
    if (lastPoint !== val) {
      data.push({ ts: new Date(), pos: val });
      update();
    }
  }

  function stopOcrTracking() {
    if (ocrInterval) {
      clearInterval(ocrInterval);
      ocrInterval = null;
    }
    if (ocrStream) {
      ocrStream.getTracks().forEach((track) => track.stop());
      ocrStream = null;
    }
    ocrStatusBadge.style.display = "none";
  }

  stopOcrBtn.addEventListener("click", () => {
    stopOcrTracking();
  });

  // Keybindings listener
  addEventListener("keydown", (e) => {
    const isTyping = document.activeElement === userInput;
    const inputBoxVisible = inputBox.style.display != "none";

    // O key triggers OCR screen setup mode
    if (e.key.toUpperCase() === "O" && !isTyping && ocrModal.style.display === "none") {
      e.preventDefault();
      startOcrSetup();
      return;
    }

    // Slash '/' triggers denominator selector
    if (e.key === "/") {
      if (inputBoxVisible || isTyping) {
        e.preventDefault();
        unitBtn.click();
        return;
      }
    }

    // Backspace deletes the last logged progress point if input field is empty or input box closed
    if (e.key === "Backspace") {
      const isInputEmpty = userInput.value === "";
      if (!inputBoxVisible || (isTyping && isInputEmpty)) {
        if (data.length > 0) {
          e.preventDefault();
          data.pop();
          update();
        }
        return;
      }
    }

    const dismiss = e.key == "Escape";
    const enter = e.key == "Enter";
    const reset = !isTyping && e.key.toUpperCase() == "R";

    if (reset) {
      data.length = 0;
      visualisation.innerHTML = "";
      document.title = "Progress Tracker";
      hideInput();
      stopOcrTracking();
      closeOcrModal();
      update();
      return;
    }

    if (dismiss) {
      hideInput();
      closeOcrModal();
      return;
    }

    if (!inputBoxVisible) {
      showInput();
      return;
    }

    if (enter) {
      if (isEditingDenominator) {
        const newDenom = userEnteredPos;
        if (newDenom !== null && !isNaN(newDenom) && newDenom > 0 && newDenom !== 100) {
          targetMax = newDenom;
          isPercentMode = false;
        } else {
          targetMax = 100;
          isPercentMode = true;
        }
        updateUnitBtnUI();

        isEditingDenominator = false;
        unitBtn.style.display = "inline-block";
        userInput.value = "";
        userInput.placeholder = "0";
        userEnteredPos = null;
        userInput.focus();
        update();
      } else {
        if (userEnteredPos !== null && !isNaN(userEnteredPos)) {
          data.push({ ts: new Date(), pos: userEnteredPos });
          update();
        }
        hideInput();
      }
    }
  });

  addEventListener("click", (e) => {
    if (
      e.target.tagName !== "A" &&
      e.target !== unitBtn &&
      !unitBtn.contains(e.target) &&
      ocrModal.style.display === "none" &&
      e.target !== stopOcrBtn
    ) {
      showInput();
      e.preventDefault();
    }
  });

  addEventListener("resize", () => {
    update();
  });
  addEventListener("load", () => {
    updateUnitBtnUI();
    update();
  });

  updateUnitBtnUI();

  // Fake data for testing
  if (localStorage.getItem("fake") == "true") {
    data.push({ ts: new Date(Date.now() - 55000), pos: 0 });
    data.push({ ts: new Date(Date.now() - 45000), pos: 4 });
    data.push({ ts: new Date(Date.now() - 30000), pos: 9 });
    data.push({ ts: new Date(Date.now() - 20000), pos: 11 });
    function generateArtificialDataPoint(delta, v = 1) {
      let last = 0;
      if (data.length > 0) {
        last = data[data.length - 1].pos;
      }
      data.push({
        ts: new Date(),
        pos: Math.min(
          targetMax,
          last + (delta / 1000) * v * (1 + (Math.random() - 0.5) / 2),
        ),
      });
      let newDelta = 3000 + Math.random() * 2000;
      setTimeout(() => generateArtificialDataPoint(newDelta), newDelta);
    }
    generateArtificialDataPoint(1000);
  }
})();
