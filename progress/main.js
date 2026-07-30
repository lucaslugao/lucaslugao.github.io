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

  /** @type {{ts: Date, pos: number}[]} */
  const data = [];
  /** @type {number | null} */
  let userEnteredPos = null;

  /** Target Denominator State */
  let targetMax = 100;
  let isPercentMode = true;
  let isEditingDenominator = false;

  function updateUnitBtnUI() {
    if (isPercentMode || targetMax === 100) {
      unitBtn.textContent = "%";
      unitBtn.title = "Click or type '/' to set custom target denominator";
    } else {
      unitBtn.textContent = `/ ${targetMax}`;
      unitBtn.title = "Click or type '/' to edit target denominator";
    }
  }

  // Click unit button (%) to start editing denominator
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

    // Dynamic time window maintaining ~5 points in view
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

    // Connect historical points with line path & area fill
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

    // Connect projection line to ETA point
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

    // Draw individual point markers & labels
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

  addEventListener("keydown", (e) => {
    const isTyping = document.activeElement === userInput;
    const inputBoxVisible = inputBox.style.display != "none";

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
      update();
      return;
    }

    if (dismiss) {
      hideInput();
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
    if (e.target.tagName !== "A" && e.target !== unitBtn && !unitBtn.contains(e.target)) {
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
