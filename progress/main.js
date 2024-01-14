(function main() {
    /** @type {HTMLElement} */
    const inputBox = document.getElementById("userInputBox");
    /** @type {HTMLElement} */
    const userInput = document.getElementById("userInput");
    /** @type {HTMLElement} */
    const nodata = document.getElementById("nodata");
    /** @type {SVGElement} */
    const visualisation = document.getElementById("visualisation");
  
    /**
     * @type {{ts: Date, pos: number}[]}
     */
    const data = [];
  
    /** @type {number | null} */
    let userEnteredPos = null;
  
    /**
     * Create an SVG element with the given tag name and attributes
     * @param {string} tagName
     * @param {Object.<string, string>} attributes
     * @returns {SVGElement}
     */
    function createSVGElement(tagName, attributes) {
      const element = document.createElementNS(
        "http://www.w3.org/2000/svg",
        tagName,
      );
      for (const key in attributes) {
        element.setAttribute(key, attributes[key]);
      }
      return element;
    }
  
    /**
     * Create an SVG element with the given tag name and attributes, or update an existing element with the same ID
     * @param {SVGElement} parent
     * @param {string} id
     * @param {string} tagName
     * @param {Object.<string, string>} attributes
     * @returns {SVGElement}
     */
    function createOrUpdateElement(parent, id, tagName, attributes) {
      let currentElement = parent.querySelector(`#${id}`);
      if (currentElement == undefined) {
        currentElement = createSVGElement(tagName, attributes);
        currentElement.id = id;
        parent.appendChild(currentElement);
      } else {
        for (const key in attributes) {
          currentElement.setAttribute(key, attributes[key]);
        }
      }
      return currentElement;
    }
  
    /**
     * Return a human-readable string for the given date relative to now
     * @param {Date} date
     * @returns {string}
     */
    function friendlyDate(date) {
      // return a text line like "ETA: 3m 20s"
      const now = new Date();
      const diff = date.getTime() - now.getTime();
      const sign = diff < 0 ? "-" : "";
      const abs = Math.abs(diff);
      const seconds = Math.floor(abs / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);
  
      if (seconds == 0) {
        return "N";
      }
      if (seconds < 60) {
        return `${sign}${seconds}s`;
      }
      if (minutes < 60) {
        return `${sign}${minutes}m`;
      }
      if (hours < 24) {
        return `${sign}${hours}h`;
      }
      return `${sign}${days}d ${hours % 24}h`;
    }
  
    /**
     * Return a human-readable string for a give ETA date
     * @param {Date} date
     * @returns {string}
     */
    function friendlyETA(date) {
      const now = new Date();
      const diff = date.getTime() - now.getTime();
      const at = date.toLocaleTimeString([], { seconds: "numeric" });
  
      if (diff < 0) {
        return `Done @ ${at}!`;
      }
      const seconds = Math.floor(diff / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);
  
      if (seconds < 60) {
        return `${seconds}s @ ${at}`;
      }
      if (minutes < 60) {
        return `${minutes}m ${seconds % 60}s @ ${at}`;
      }
      if (hours < 24) {
        return `${hours}h ${minutes % 60}m @ ${at}`;
      }
      return `${days}d ${hours % 24}h ${minutes % 60}m ${seconds % 60}s @ ${at}`;
    }
  
    /**
     * Calculate the ETA based on the last 5 data points
     * @returns {{nextPoint: {ts: Date, pos: number}, message: string}}
     */
    function calculateETA() {
      // ETA Algorithm based on weighted average of last 5 speeds
      const now = new Date();
      const points = data
        .filter((_, i) => i > data.length - 6)
        .map((d) => ({
          x: (d.ts.getTime() - now.getTime()) / 1000,
          y: d.pos,
        }));
  
      // calculate average speed between last point and each other point
      const last = points[points.length - 1];
      const averageSpeeds = points
        .filter((_, i) => i < points.length - 1)
        .map(({ x, y }) => {
          return (last.y - y) / (last.x - x);
        });
  
      let weightedAverageSpeed = 0;
      let denominator = 0;
      for (
        let i = Math.max(0, averageSpeeds.length - 5);
        i < averageSpeeds.length;
        i++
      ) {
        if (averageSpeeds[i] < 0) continue;
        const weight = 0.5 ** i;
        weightedAverageSpeed += weight * averageSpeeds[i];
        denominator += weight;
      }
  
      if (denominator == 0) {
        weightedAverageSpeed = 0;
      } else {
        weightedAverageSpeed /= denominator;
        weightedAverageSpeed = Math.max(0, weightedAverageSpeed);
      }
  
      const point = {
        ts: now,
        pos: Math.min(100, last.y + weightedAverageSpeed * (0 - last.x)),
      };
      let message = "";
      if (weightedAverageSpeed > 0) {
        const compl =
          ((100 - last.y) / weightedAverageSpeed + last.x) * 1000 + now.getTime();
        message = "ETA: " + friendlyETA(new Date(compl));
      }
      return { point, message };
    }
  
    /**
     * Update the graph
     */
    function updateGraph() {
      let width = visualisation.clientWidth;
      let height = Math.max(
        visualisation.style.maxHeight,
        visualisation.clientHeight,
      );
      visualisation.setAttribute("viewBox", `0 0 ${width} ${height}`);
      createOrUpdateElement(visualisation, "background", "rect", {
        x: 0,
        y: 0,
        width: width,
        height: height,
        fill: "var(--elements-bg-color)",
      });
  
      if(data.length == 0){
        nodata.style.display = "block";
        return;
      }
      nodata.style.display = "none";
  
      const timeAxisHeight = 30;
      const paddingTop = 40;
      const paddingBottom = 20;
      const paddingHorizontal = 30;
      const plotHeight = height - timeAxisHeight - paddingBottom - paddingTop;
      const plotWidth = width - 2 * paddingHorizontal;
  
      createOrUpdateElement(visualisation, "axis", "line", {
        x1: 0,
        y1: height - timeAxisHeight,
        x2: width,
        y2: height - timeAxisHeight,
        stroke: "white",
      });
  
      let localData = [...data];
      let ETAMessage = "";
      if (data.length > 1) {
        const { point, message } = calculateETA();
        localData.push(point);
        ETAMessage = message;
      }
      createOrUpdateElement(visualisation, "eta", "text", {
        x: paddingHorizontal,
        y: paddingTop,
        fill: "white",
        "text-anchor": "start",
      }).textContent = ETAMessage;
      document.title = `${ETAMessage} - Progress Tracker`;
  
      const maxPos = Math.max(10, Math.max(...localData.map((d) => d.pos)));
      let minTs = localData[0].ts.getTime();
      let maxTs = new Date().getTime();
      let timeSpan = maxTs - minTs;
      if (timeSpan == 0) {
        timeSpan = 1;
      }
      if (timeSpan > 1000 * 60 * 10) {
        minTs = maxTs - 1000 * 60;
        timeSpan = maxTs - minTs;
      }
  
      function getPointCoordinates(ts, pos) {
        return {
          x: paddingHorizontal + (plotWidth * (ts.getTime() - minTs)) / timeSpan,
          y: paddingTop + plotHeight * (1 - pos / maxPos),
        };
      }
  
      let lastTickX = null;
      for (let index of [...localData.keys()].reverse()) {
        const { ts, pos } = localData[index];
        const { x, y } = getPointCoordinates(ts, pos);
  
        if (index == localData.length - 1) {
          createOrUpdateElement(visualisation, `e${index}-circle`, "circle", {
            cx: x,
            cy: y,
            r: 5,
            fill: "white",
          });
          createOrUpdateElement(visualisation, `e${index}-circle-text`, "text", {
            x: x,
            y: y - 10,
            fill: "white",
            "text-anchor": "middle",
          }).textContent = pos.toFixed(2);
        } else {
          createOrUpdateElement(visualisation, `e${index}-circle`, "circle", {
            cx: x,
            cy: y,
            r: 3,
            fill: "none",
            stroke: "white",
          });
          createOrUpdateElement(
            visualisation,
            `e${index}-circle-text`,
            "text",
            {},
          ).textContent = "";
        }
  
        if (lastTickX === null || lastTickX - x > 30) {
          lastTickX = x;
          createOrUpdateElement(visualisation, `e${index}-tick-text`, "text", {
            x: x,
            y: height - timeAxisHeight + 10,
            fill: "white",
            "dominant-baseline": "hanging",
            "text-anchor": "middle",
          }).textContent = friendlyDate(ts);
          createOrUpdateElement(visualisation, `e${index}-tick`, "line", {
            x1: x,
            y1: height - timeAxisHeight,
            x2: x,
            y2: height - timeAxisHeight + 8,
            stroke: "white",
          });
        } else {
          createOrUpdateElement(visualisation, `e${index}-tick-text`, "text", {
            fill: "none",
          }).textContent = "";
          createOrUpdateElement(visualisation, `e${index}-tick`, "line", {
            x1: x,
            y1: height - timeAxisHeight,
            x2: x,
            y2: height - timeAxisHeight + 5,
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
     * Show the overlay
     */
    function showInput() {
      inputBox.style.display = "flex";
      userInput.focus();
    }
  
    /**
     * Hide the overlay
     */
    function hideInput() {
      inputBox.style.display = "none";
      userInput.blur();
      userEnteredPos = null;
      userInput.value = "";
      window.scrollTo(0, 0);
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
        updateGraph();
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
          updateGraph();
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
  
    addEventListener("resize", updateGraph);
    addEventListener("load", updateGraph);
    requestAnimationFrame(updateGraph);
    setInterval(updateGraph, 1000);
  
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
  