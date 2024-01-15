(function main() {
  /** @type {HTMLElement} */
  const inputBox = document.getElementById("userInputBox");
  /** @type {HTMLElement} */
  const userInput = document.getElementById("userInput");
  /** @type {HTMLElement} */
  const nodata = document.getElementById("nodata");
  /** @type {SVGElement} */
  const visualisation = document.getElementById("visualisation");
  /** @type {{ts: Date, pos: number}[]} */
  const data = [];
  /** @type {number | null} */
  let userEnteredPos = null;

  /**
   * Creates or updates an SVG element within a given parent element. If an
   * element with the specified ID does not exist, a new SVG element with that
   * ID and the specified tag name is created. If it exists, the existing
   * element is updated with the provided attributes. This function ensures
   * that the created or updated element is compliant with SVG standards by
   * using the appropriate namespace.
   *
   * @param {SVGElement} parent
   * @param {string} id
   * @param {string} tagName
   * @param {Object.<string, string>} attributes
   * @returns {SVGElement}
   */
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
  /**
   * Returns a human-readable string for a given date, either as a relative time difference for past dates
   * or as a detailed ETA for future dates. For past dates, it shows only the largest time unit greater than zero
   * (e.g., "3h ago"). For future dates, it provides a detailed ETA with the exact time (e.g., "ETA: 3h 20m 15s @ 15:45").
   *
   * @param {Date} date - The date to be converted into a human-readable string.
   * @param {boolean} ETA - If true, the string will be formatted as a detailed ETA.
   * @returns {string} A string representing the relative time difference or detailed ETA.
   */
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

  /**
   * Calculate the Estimated Time of Arrival (ETA) based on the last n data points
   * @param {{ts: Date, pos: number}[]} data - Array of data points with timestamp and position
   * @param {number} n - Number of data points to consider (default is 5)
   * @returns {{nextPoint: {ts: Date, pos: number}, message: string}}
   */
  function calculateETA(data, n = 5) {
    const now = new Date();

    // Get the most recent n points
    const recentPoints = data.slice(-n).map((d) => ({
      x: (d.ts.getTime() - now.getTime()) / 1000,
      y: d.pos,
    }));

    const lastPoint = recentPoints[recentPoints.length - 1];

    // Calculate average speeds
    let averageSpeeds = [];
    for (let i = 0; i < recentPoints.length - 1; i++) {
      const { x, y } = recentPoints[i];
      averageSpeeds.push((lastPoint.y - y) / (lastPoint.x - x));
    }

    // Calculate weighted average speed
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

    // Calculate next point
    const point = {
      ts: now,
      pos: Math.min(
        100,
        lastPoint.y + weightedAverageSpeed * (0 - lastPoint.x),
      ),
    };
    let message = "";
    if (point.pos == 100) {
      message = "Done!";
    } else if (weightedAverageSpeed > 0) {
      const etaTime =
        ((100 - lastPoint.y) / weightedAverageSpeed + lastPoint.x) * 1000 +
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
    height: 200,
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
    LAYOUT.width = visualisation.clientWidth;
    LAYOUT.height = Math.max(
      visualisation.style.maxHeight,
      visualisation.clientHeight,
    );
    LAYOUT.plotHeight =
      LAYOUT.height -
      LAYOUT.timeAxisHeight -
      LAYOUT.paddingBottom -
      LAYOUT.paddingTop;
    LAYOUT.plotWidth = LAYOUT.width - 2 * LAYOUT.paddingHorizontal;

    const vbWidth = visualisation.viewBox.baseVal.width;
    const vbHeight = visualisation.viewBox.baseVal.height;
    if (vbWidth == LAYOUT.width && vbHeight == LAYOUT.height) return;

    visualisation.setAttribute(
      "viewBox",
      `0 0 ${LAYOUT.width} ${LAYOUT.height}`,
    );
    setElement(visualisation, "background", "rect", {
      x: 0,
      y: 0,
      width: LAYOUT.width,
      height: LAYOUT.height,
      fill: "var(--elements-bg-color)",
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
  /**
   * Update the graph
   * @param {{ts: Date, pos: number}[]} data - Array of data points with timestamp and position
   */
  function updateGraph(data) {
    if (data.length == 0) {
      return;
    }

    data = [...data];
    let ETAMessage = "";
    let nextPoint = null;
    if (data.length > 1) {
      const { point, message } = calculateETA(data);
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

    let maxPos = 10;
    for (let index = 0; index < getPointCount(); index++) {
      maxPos = Math.max(maxPos, getPoint(index).pos);
    }
    const maxTs = new Date().getTime();
    const minTs = Math.min(
      maxTs - 1,
      Math.max(data[0].ts.getTime(), maxTs - 1000 * 30 * 1),
    );
    const timeSpan = maxTs - minTs;

    function getPointCoordinates(ts, pos) {
      return {
        x:
          LAYOUT.paddingHorizontal +
          (LAYOUT.plotWidth * (ts.getTime() - minTs)) / timeSpan,
        y: LAYOUT.paddingTop + LAYOUT.plotHeight * (1 - pos / maxPos),
      };
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
        }).textContent = pos.toFixed(2);
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

  // Prevent non-numeric input
  userInput.addEventListener("input", (e) => {
    let numerical = e.target.value.replace(/[^0-9\.]/g, "");
    numerical = numerical.replace(/^0+/, "0");

    let parsedValue = Number(numerical);
    if (parsedValue > 100) {
      numerical = userEnteredPos;
      parsedValue = userEnteredPos;
    }
    if (userEnteredPos != parsedValue || e.target.value != numerical) {
      e.target.value = numerical;
      userEnteredPos = parsedValue;
    }
  });

  /**
   * Show user input
   */
  function showInput() {
    inputBox.style.display = "flex";
    userInput.focus();
    update();
  }

  /**
   * Hide user input
   */
  function hideInput() {
    inputBox.style.display = "none";
    userInput.blur();
    userEnteredPos = null;
    userInput.value = "";
    window.scrollTo(0, 0);
    update();
  }

  // Event listeners

  addEventListener("keydown", (e) => {
    const dismiss = e.key == "Escape";
    const enter = e.key == "Enter";
    const reset = e.key.toUpperCase() == "R";
    const inputBoxVisible = inputBox.style.display != "none";

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
      if (userEnteredPos != null) {
        data.push({ ts: new Date(), pos: userEnteredPos });
        update();
      }
      hideInput();
    }
  });

  addEventListener("click", (e) => {
    if (e.target.tagName != "A") {
      showInput();
      e.preventDefault();
    }
  });

  addEventListener("resize", () => {
    update();
  });
  addEventListener("load", () => {
    update();
  });
  update();

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
          100,
          last + (delta / 1000) * v * (1 + (Math.random() - 0.5) / 2),
        ),
      });
      let newDelta = 3000 + Math.random() * 2000;
      setTimeout(() => generateArtificialDataPoint(newDelta), newDelta);
    }
    generateArtificialDataPoint(1000);
  }
})();
