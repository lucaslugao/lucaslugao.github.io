// This code is licensed under CC-BY-NC 4.0
// https://creativecommons.org/licenses/by-nc/4.0/

class BitBuffer {
    constructor(base64String) {
        this.data = Array.from(this.base64ToUint8Array(base64String));
        this.bitIndex = 0;
    }

    base64ToUint8Array(base64String) {
        const binaryString = atob(base64String); //atob decodes base64
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes;
    }

    readBits(numBits) {
        let result = 0;
        let readBits = 0;
        let remainingBits = numBits;

        while (remainingBits > 0) {
            const byteIndex = Math.floor(this.bitIndex / 8);
            const bitOffset = this.bitIndex % 8;

            const availableBits = 8 - bitOffset;
            const readAmount = Math.min(remainingBits, availableBits);

            if (byteIndex >= this.data.length) {
                return 0;
            }

            const mask = (1 << readAmount) - 1;
            const readVal = (this.data[byteIndex] >> bitOffset) & mask;

            result |= readVal << readBits;
            readBits += readAmount;
            remainingBits -= readAmount;
            this.bitIndex += readAmount;
        }

        return result;
    }

    writeBits(value, numBits) {
        let remainingBits = numBits;
        let remainingValue = value & ((1 << remainingBits) - 1);

        while (remainingBits > 0) {
            const byteIndex = Math.floor(this.bitIndex / 8);
            const bitOffset = this.bitIndex % 8;

            if (byteIndex >= this.data.length) {
                this.data.push(0);
            }

            const availableBits = 8 - bitOffset;
            const writeBits = Math.min(remainingBits, availableBits);

            const mask = ((1 << writeBits) - 1) << bitOffset;
            const writeVal = remainingValue << bitOffset;

            this.data[byteIndex] = (this.data[byteIndex] & ~mask) | (writeVal & mask);

            remainingValue >>= writeBits;
            remainingBits -= writeBits;
            this.bitIndex += writeBits;
        }
    }
}
class MaskedBitset {
    constructor(value = 0, mask = 0) {
        this.value = value;
        this.mask = mask;
    }

    set(k, v) {
        const bit = 1 << k;
        this.value = (this.value & ~bit) | ((-v & bit) >>> 0);
        this.mask |= bit;
    }

    has(k) {
        return (this.mask >> k) & (1 !== 0);
    }

    at(k) {
        return (this.value >> k) & 1;
    }

    get(k) {
        return [this.at(k), this.has(k)];
    }

    delete(k) {
        const bit = 1 << k;
        this.mask &= ~bit;
    }

    allSet() {
        return this.mask === 0b111111;
    }
}
class Tango {
    constructor(
        container,
        undoButton,
        clearButton,
        redoButton,
        confettiButton,
        cellSize = 60,
    ) {
        this.container = container;
        this.undoButton = undoButton;
        this.clearButton = clearButton;
        this.redoButton = redoButton;
        this.confettiButton = confettiButton;
        this.cellSize = cellSize;
        this.history = [];
        this.future = [];
        this.rows = Array(6)
            .fill(null)
            .map(() => new MaskedBitset());
        this.cols = Array(6)
            .fill(null)
            .map(() => new MaskedBitset());
        this.rowsConstr = Array(6)
            .fill(null)
            .map(() => new MaskedBitset());
        this.colsConstr = Array(6)
            .fill(null)
            .map(() => new MaskedBitset());

        this.puzzle = null;
    }

    init(puzzle) {
        this.puzzle = puzzle;
        window.dataLayer = window.dataLayer || [];
        window.dataLayer.push({
            event: "puzzle",
            hash: this.puzzle,
        });
        const buf = new BitBuffer(this.puzzle);
        for (let k = 0; k < 6; k++) {
            this.setRow(k, new MaskedBitset(buf.readBits(6), buf.readBits(6)));
        }
        for (let k = 0; k < 6; k++) {
            this.rowsConstr[k].value = buf.readBits(5);
            this.rowsConstr[k].mask = buf.readBits(5);
            this.colsConstr[k].value = buf.readBits(5);
            this.colsConstr[k].mask = buf.readBits(5);
        }
        this.cells = this.createBoard();
        this.setState(
            decodeURIComponent(window.location.hash.substring(1)) || this.puzzle,
        );

        this.undoButton.addEventListener("click", () => {
            this.undo();
        });
        this.undoButton.disabled = true;
        this.redoButton.addEventListener("click", () => {
            this.redo();
        });
        this.redoButton.disabled = true;
        this.clearButton.addEventListener("click", () => {
            this.clear();
        });

        const confetti = localStorage.getItem("confetti");
        this.confetti = true;

        if (confetti) {
            this.confetti = confetti === "true";
        }

        this.updateConfettiButton();
        this.confettiButton.addEventListener("click", () => {
            this.confetti = !this.confetti;
            this.updateConfettiButton();
        });

        this.persistState();
        window.addEventListener("hashchange", () => {
            const newState =
                decodeURIComponent(window.location.hash.substring(1)) || this.puzzle;
            if (this.getState() !== newState) {
                this.setState(newState);
            }
        });
    }
    updateConfettiButton() {
        localStorage.setItem("confetti", this.confetti);
        this.confettiButton.innerText = this.confetti
            ? "Confetti On"
            : "Confetti Off";
        if (this.confetti) {
            this.confettiButton.classList.remove("dark");
        } else {
            this.confettiButton.classList.add("dark");
        }
    }

    set(x, y, c) {
        this.cols[x].set(y, c);
        this.rows[y].set(x, c);

        this.drawCell(x, y);
    }

    setRow(y, row) {
        this.rows[y] = row;

        for (let x = 0; x < 6; x++) {
            const [v, ok] = row.get(x);
            if (ok) {
                this.cols[x].set(y, v);
            }
            this.drawCell(x, y);
        }
    }

    delete(x, y) {
        this.rows[y].delete(x);
        this.cols[x].delete(y);

        this.drawCell(x, y);
    }

    get(x, y) {
        return this.rows[y].get(x);
    }

    has(x, y) {
        return this.rows[y].has(x);
    }

    setState(state) {
        const stateBuf = new BitBuffer(state);
        for (let k = 0; k < 6; k++) {
            this.setRow(
                k,
                new MaskedBitset(stateBuf.readBits(6), stateBuf.readBits(6)),
            );
        }
    }

    getState() {
        const buf = new BitBuffer("");
        for (let k = 0; k < 6; k++) {
            buf.writeBits(this.rows[k].value, 6);
            buf.writeBits(this.rows[k].mask, 6);
        }
        return btoa(String.fromCharCode(...buf.data));
    }

    persistState() {
        this.hint();
        window.history.replaceState(
            undefined,
            undefined,
            `#${encodeURIComponent(this.getState())}`,
        );
    }

    drawCell(x, y) {
        if (this.cells === undefined) return;
        const [value, ok] = this.get(x, y);
        this.cells[y][x].dataset.value = value;
        this.cells[y][x].dataset.ok = ok;
    }

    hint() {
        if (this.isSolved()) {
            document.body.dataset.state = "solved";
            if (this.confetti) {
                confetti({
                    particleCount: 100,
                    startVelocity: 15,
                    spread: 360,
                    origin: { y: 0.5 },
                });
            }
        } else {
            document.body.dataset.state = "playing";
        }
    }

    handleClick(x, y, right) {
        if (this.cells[y][x].dataset.base === "1") return;
        this.history.push(this.getState());
        this.future = [];
        this.redoButton.disabled = true;
        this.undoButton.disabled = false;
        const [value, ok] = this.get(x, y);
        const next = right ? (ok ? value + 2 : 1) % 3 : (ok ? value : 2) % 3;

        if (next === 0) {
            this.delete(x, y);
        } else {
            this.set(x, y, next - 1);
        }
        this.persistState();
    }

    undo() {
        if (this.history.length > 0) {
            this.future.push(this.getState());
            this.redoButton.disabled = false;
            this.setState(this.history.pop());
            this.persistState();
        }
    }

    clear() {
        this.history.push(this.getState());
        this.future = [];
        this.undoButton.disabled = false;
        this.redoButton.disabled = true;
        this.setState(this.puzzle);
        this.persistState();
    }

    redo() {
        if (this.future.length > 0) {
            this.history.push(this.getState());
            this.undoButton.disabled = false;
            this.setState(this.future.pop());
            this.persistState();
        }
    }

    createSymbol(x, y, scale, symbol, rotated) {
        const size = this.cellSize * scale;
        const xCoord = x * this.cellSize + (this.cellSize - size) / 2;
        const yCoord = y * this.cellSize + (this.cellSize - size) / 2;

        const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
        use.setAttribute("x", xCoord);
        use.setAttribute("y", yCoord);
        use.setAttribute("width", size);
        use.setAttribute("height", size);
        use.setAttribute("href", `#${symbol}`);
        use.classList.add(`symbol-${symbol}`);
        use.classList.add("symbol");
        use.setAttribute("pointer-events", "none");
        if (rotated) {
            use.setAttribute(
                "transform",
                `rotate(90 ${xCoord + size / 2} ${yCoord + size / 2})`,
            );
        }
        return use;
    }

    createBoard() {
        const cells = Array.from({ length: 6 }, () => Array(6).fill(null));

        const widthSize = this.cellSize * 6;
        const heightSize = this.cellSize * 6;

        this.svgElement = this.container.querySelector("svg");
        this.svgElement.setAttribute("width", widthSize + 2);
        this.svgElement.setAttribute("height", heightSize + 2);
        this.svgElement.setAttribute(
            "viewBox",
            `-1 -1 ${widthSize + 2} ${heightSize + 2}`,
        );

        for (let y = 0; y < 6; y++) {
            for (let x = 0; x < 6; x++) {
                const xCoord = x * this.cellSize;
                const yCoord = y * this.cellSize;

                const cellGroup = document.createElementNS(
                    "http://www.w3.org/2000/svg",
                    "g",
                );
                cellGroup.setAttribute("data-x", x);
                cellGroup.setAttribute("data-y", y);
                cellGroup.setAttribute("transform", `translate(${xCoord} ${yCoord})`);
                this.svgElement.appendChild(cellGroup);

                const fill = "white";
                const rect = document.createElementNS(
                    "http://www.w3.org/2000/svg",
                    "rect",
                );
                rect.setAttribute("width", this.cellSize);
                rect.setAttribute("height", this.cellSize);
                rect.setAttribute("fill", fill);
                rect.setAttribute("stroke", "black");
                cellGroup.appendChild(rect);

                const [value, ok] = this.get(x, y);
                cellGroup.dataset.value = value;
                cellGroup.dataset.ok = ok;
                cellGroup.dataset.base = ok;

                cellGroup.appendChild(this.createSymbol(0, 0, 1.0, "sun", false));
                cellGroup.appendChild(this.createSymbol(0, 0, 1.0, "moon", false));

                cellGroup.addEventListener("contextmenu", (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.handleClick(x, y, true);
                });
                cellGroup.addEventListener("click", (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.handleClick(x, y, false);
                });

                cells[y][x] = cellGroup;
            }
        }

        for (let y = 0; y < 6; y++) {
            for (let x = 0; x < 6; x++) {
                const [rowValue, rowOk] = this.rowsConstr[y].get(x);
                if (rowOk) {
                    const symbol = ["equal", "cross"][rowValue];
                    this.svgElement.appendChild(
                        this.createSymbol(x + 0.5, y, 0.8, symbol, false),
                    );
                }

                const [colValue, colOk] = this.colsConstr[x].get(y);
                if (colOk) {
                    const symbol = ["equal", "cross"][colValue];
                    this.svgElement.appendChild(
                        this.createSymbol(x, y + 0.5, 0.8, symbol, true),
                    );
                }
            }
        }
        return cells;
    }

    checkConstraint(line, constr) {
        if (constr.mask === 0) {
            return true;
        }
        const validA = line & 0b011111;
        const validS = line >> 1;
        return ((validA ^ validS ^ constr.value) & constr.mask) === 0;
    }

    countCompletions(line, constr) {
        let count = 0;
        for (const valid of [
            11, 13, 19, 21, 22, 25, 26, 37, 38, 41, 42, 44, 50, 52,
        ]) {
            if (((line.value ^ valid) & line.mask) !== 0) {
                continue;
            }
            if (!this.checkConstraint(valid, constr)) {
                continue;
            }
            count++;
        }
        return count;
    }

    checkValidity() {
        for (let i = 0; i < 6; i++) {
            if (this.countCompletions(this.rows[i], this.rowsConstr[i]) === 0) {
                return ["row", i];
            }
            if (this.countCompletions(this.cols[i], this.colsConstr[i]) === 0) {
                return ["col", i];
            }
        }
        return [null, null];
    }

    isValid() {
        const [type, index] = this.checkValidity();
        return type === null;
    }

    isSolved() {
        for (let y = 0; y < 6; y++) {
            if (!this.rows[y].allSet()) {
                return false;
            }
        }
        return this.isValid();
    }
}

const puzzleSets = [
    [
        "Single Piece",
        [
            ["1", "AAAAAAAAAABAAAAAAABChAggAAAAARAA"],
            ["2", "AAAAgAAAAAAAQAAAAAAgAAEQAAAgBAQA"],
            ["3", "AAAAAACAAAAAQgAAAAggAAAQAACAAABA"],
            ["4", "AAAAACAIAAAAQgAAgBAgAAEgAAAABAAA"],
            ["5", "AAAAAACCAAAAAAAAAAAggAAQAAAAIgRA"],
            ["6", "AAAAAAAIAAAAAABACAAAgAAUAAAAAgBA"],
            ["7", "AAAAAAAgAAAAAAAAgBAggAAQAAAgBQAA"],
            ["8", "AAAAAAIAAAAAAAAAAAggAAEgAAAQAgBA"],
            ["9", "AAAAAAAAABAEQgAAAAggAAAQAAAAAgQA"],
            ["10", "AAAAAACCAAAAIAAAAAAgAAAEAIAgBQAA"],
            ["11", "ACAIAAAAAAAAIQAACBAAhAghAAAAAAAA"],
            ["12", "AAAAAAAAAAAQIAAAAAghAAAgAAAABAQA"],
        ],
    ],
    [
        "Linkedin",
        [
            ["161", "wQyGAAAAYAjPAAAACFIAAAAAAIQABQAA"],
            ["160", "BAEQhDEMQAAEAAAAAAAAAAAAxAAAAkAY"],
            ["159", "AAgAAAEgAAAEAAAAAIgxhhhijADACAAA"],
            ["158", "AAAAgATJlocwAABACAAAAAEACAAAAAAA"],
            ["157", "RAUAACQIACCoAGA8BgAAAAAAABgDAIAY"],
            ["156", "CCNJgAQADAMAAAAAAIQAACAUAAAACAAA"],
            ["155", "AAAAAAMAgsQwQAkDAAAAAAAAAAAAAIAw"],
            ["154", "IIqiGA4AAAAAACAMAAAAQCwGAAAAAAAA"],
            ["153", "AAAADEMwAAAASAECIwAAAAAAACACoBQh"],
            ["152", "AAAADIMwAAAAygEAAIwAAAAAAACAyBwA"],
            ["151", "gAQAAAAAggQAABADCACEAAGjEAAAAAgx"],
            ["150", "AACAAAAAQQAAAAhjDgAAQAgACIwDAABj"],
            ["149", "kgQwABCGAABIAAAAAAAhAkQIQoAAAAAA"],
            ["148", "wgAIMI6gMA4ACDEGAABjMAYAAGOAAAAA"],
            ["147", "gAEMQAAAAAAAAAAAAACUIw4AABADwDmE"],
            ["146", "ACB5AAAAAAAAAAAAACAAEAIAIUARAggA"],
            ["145", "wyAMAAAAAAzCAAAAAAAQIzzGGAAAAAAA"],
            ["144", "RIUoQSEIQAAAAAAAAAAAAAAAAIQQghRS"],
            ["143", "AAgAAAAAABAECHFuDAAgQAhhCIgBEIYx"],
            ["142", "AAAADEMwAAAAAABACCEggAAhhIQAAgAA"],
            ["141", "AEAYggFhCAYAAAAASAghEAIgIYQACAAA"],
            ["140", "AAAAAACGwwwwgAABIgAAAAAAAAAAAAAQ"],
            ["139", "AAAACAMwAAAAAAAAY4wAAAAAADDCCAAA"],
            ["138", "YQgAAAAAAACGAACgnHGEEEIIIcwxBwAA"],
            ["137", "AAgAAAEgABAEoAABAAAAAAAAAAAAQChA"],
            ["136", "AAMAAAAAAAAAAIQIQIggKgWiUgDACEiI"],
            ["135", "wwEETQcQBAEAAAAgjDAAAIAxxgAAAAAA"],
            ["134", "GC6qEA4AEAQAACAMAAAAIBwGAAAAIAYA"],
            ["133", "AAAACBOEkMQwIYIAYwgAAAAAAACEAAAI"],
            ["132", "AAAAAEAwkBSGgAgBYwgAAAAAAACEAIAQ"],
            ["131", "YShJAAAAkASGAAACAAAAKAUAUAAAAAAh"],
            ["130", "wQEIxgEAAAAAAAAAAAAAAIAwxAAAAADE"],
            ["129", "AGB9ABAcAAAEpAIAAACgAAAAACAAAAAA"],
            ["128", "ADAMwwDCAAwACAMAAIQAAAAAAACEMAYA"],
            ["127", "AAAACAMwDIMwAAAgFKUAAAAAAABACgAA"],
            ["126", "AABZgAEAgAAAAAAAAAAAAIAQQgABBAAA"],
            ["125", "QDAMQQCAIAyCAADAOAAAAAAAAOcAAAAA"],
            ["124", "QShJAAAAkBSGAAAAAAAAAAIAIAAAAAAA"],
            ["123", "CAJAIAgEggAQIAAAAgAgAAAhABACACEA"],
            ["122", "YQgggABBAAGGCAEAAgAAAAAAAAACIAQA"],
            ["121", "ilpUggIUgAAEAAAAAAAAAAAAAAAAACGA"],
            ["120", "QRiGAAAAAAAAAADAGGMAGEMIIc45BwAA"],
            ["119", "oFpUggoAAAAAABACACEAEAIAIbUSohQh"],
            ["118", "Zcu2AAAAAAAAAAAIAAAAQAgAgAAAAACE"],
            ["117", "ggKGAAAAYQhQAAAAACAAAAIAIAAQAgAA"],
            ["116", "AAjiCEIQxhEEQgAQwhgAAAAAABAijBAA"],
            ["115", "BCMIYBiEEAQwEEIIAAAAAAAAAAAAEEII"],
            ["114", "AAAAAAAAAADAxgEAQP8AAGAcAACYAwAA"],
            ["113", "AAIAAAgEQSAcAAIAAAAIAQQEEAAAAEAI"],
            ["112", "AGBYECQIgAYAQqYEAAAAAAAAAAAAgJKQ"],
            ["111", "IAzAAAAAwCAMAAAgBBBCAAEQQAghBAAA"],
            ["110", "UQQgAAAABCGKAAAIAgAAAQAEABACAAAI"],
            ["109", "wyAMwQAMAAAAAAAAAAAAAgAgAAAyDiHn"],
            ["108", "AAAAAIMwAAAAAIRICCEAAAAAAIQAAkCI"],
            ["107", "KApAIAgAAAAAABACAISAICQEICEAAAgA"],
            ["106", "AAAIAAAAAABAAAAABACACAEQIQAiBCCE"],
            ["105", "w6M8QQAAAAAAAAAAAAAAIIw4QIwDBABA"],
            ["104", "wgAIgoFgEATBAACEMAAAQAgACGMAAAAQ"],
            ["103", "AAzCAAAAwCAMIYQQQgiEEAIIIBBCCCCA"],
            ["102", "gAAMAAAAMAxBEAIAIQBAAIEQQiAAAAIA"],
            ["101", "VAWAQACAQICoAABACFIAAAAAAIQIBQAA"],
            ["100", "AAAQgoFgAAIAMcIIAAAAISSEEAAAAGOM"],
            ["99", "AABAkgZZggAAxAAAAAAAhAAAgAAAgBgA"],
            ["98", "UCSKQQSIUCSIAAAACAAAAAAAAIQAAAAA"],
            ["97", "BAEQxYHgAIIgCCMMAAAAAAAAAAAAIMYY"],
            ["96", "AABBAEYYggAAEAMBAAAAAAAAAAAAIAZA"],
            ["95", "hhEMAAAAAAxhACAEIYQAAAAAACCAAIAQ"],
            ["94", "ACEoRIWoAAUgACEEAAAAAAAAAAAAIAQQ"],
            ["93", "AIB4BAEQAAAAAAAAAAAAAAAAYsQBAAAA"],
            ["92", "BCNJQBiGgEQwAAAAAAAAASAEAAAAAAAA"],
            ["91", "gpFkQACApAlhAAAkBABCAAAQAAABAIAQ"],
            ["90", "MAyAAIMgwwAIIQAAQAgAAAAAAAACAACA"],
            ["89", "wwAYAAAAEAbCAAAIIUIAAAAAACAAAQAI"],
            ["88", "AADBICwMwQAAQgAgRAiAhEIIoQABCBAA"],
            ["87", "ACAIiKKoAAqCAIwBAAAACAMAAAAgBgAA"],
            ["86", "ACAIwgAIxQEAAAAAAAAAAQAAAAgrBwAA"],
            ["85", "8AzOAAAAAAAAAEAIAICEAEAIADFCCCOE"],
            ["84", "gqMoAAAAEEVwADAGIQAhAAAhACEAAAAx"],
            ["83", "AAgAAAEgAAAEY4wBIYAAAAAAACGAADHC"],
            ["82", "AMAwACAYAAAMAAEAAACEAAAAAEAAAAAA"],
            ["81", "AIBoggBBlAUAkAoBAAAAAAAAAAAAQApA"],
            ["80", "BAEYwADCEIYgEAIIAAAAAAAAAAAAAEII"],
            ["79", "EAQEAAAAIAgIAABAHADMAcAcAMYBAAAA"],
            ["78", "AIMwDEMwCEMwIQIAAAAhAgAiAAAAACIA"],
            ["77", "AAAIxSXrAAQAAABAGAAAYAxAGMYAAAAA"],
            ["76", "AACCIAxhDCMYQggRAggAAAAAAAAAACCE"],
            ["75", "gAQgQACAAAFIAAAAgBAAAAEAQgAABAAA"],
            ["74", "gkEYAAAAEIZhACAEIUAAAhACACAIAQAQ"],
            ["73", "QBAECAYAggAIQEAIBAAAAAgQAAAAAAAh"],
            ["72", "VAWoAAAAQYWqAAAAACEAAAAAAAAQAgAA"],
            ["71", "BAWGCAIQQYgohChFiHKEKEWIUoQoR4hS"],
            ["70", "AIB4gCRJhgcAAAAAAAAQQghCCAAAAAAA"],
            ["69", "igKAQACCQABRAAAAAEJAAIAQAAAAAQAA"],
            ["68", "AAAAAIEgAAAAgAAIIAggAAAgAIAACAAA"],
            ["67", "ghBtoghIoohgCAMAAAAAAAAAAAAAIAYA"],
            ["66", "mAcAAAAAAGB5AAAAFABAAAAQAEABAAAA"],
            ["65", "gAAAAAAAAABBgAAQAoQACSEEQACCQAgA"],
            ["64", "oAoAECUoABBVhEAIQAgQChECQgBASEgI"],
            ["63", "8AwABEMwADDMAAAAAAAgAAAgAAAAAAAA"],
            ["62", "gAAAIAiAAAAIABACIgCEAAAIACDCCAAA"],
            ["61", "AAAAAAAAkES0AIQCAAgAhAIAKQCAAAAo"],
            ["60", "AEIQgBAEAAAAIcKIEECEAAIAAAAAAAAA"],
            ["59", "BINhAAAAgoEwAAAQAhBCAAAQAAAiBAAA"],
            ["58", "AAAAAACiAIAgYoQBAABihAEQQgAAACGA"],
            ["57", "wAAMAAAAAAAAAAAAAACAAAIIIBBCCCGE"],
            ["56", "AAEQwgDBAIIgAAAAQggAAAAAABBCCAAA"],
            ["55", "QAAAAAAAIAjBAAIYQggAAAAAAAAAAAII"],
            ["54", "AASCAAAAQAAIAIQAghBCEEIIQAgBCCEA"],
            ["53", "VYWqAAAAAAAAACAEAIQAAAQAgAAgBACE"],
            ["52", "AAhACEpQqApVIIAAAAAAAAAAAAAAAAAA"],
            ["51", "AABhIAgEgoFhQAAAAABAAAAQAAAAAAAA"],
            ["50", "ACCIBIUoQQQAgAAAAAAAIASAEAAAAAgA"],
            ["49", "AIIgSQ4EQcA8AAAAoVIAkAIoAEqFAAAA"],
            ["48", "RYWoRAUAAAAAAEAIAIAAAAAAAABACACA"],
            ["47", "ACCaAAgESQYAAIYAAACAAEAIAAAAEAKA"],
            ["46", "IChIAAAAkgQEAABACCCEAAAIAIQQAgAA"],
            ["45", "IAwQggBBABIMIIAAAAAAAAAAAAAAACGE"],
            ["44", "wAAEBAEAIAhBAADgnHMAAAAAAM45BwAA"],
            ["43", "BAMAaRqUAIAwAAAAYAgAAAAAACFACAAA"],
            ["42", "AGAcQBEcAAAAAAAAAAAIAQAAQBACAAAh"],
            ["41", "AADBMCwMwQAAQAAgBAgAhAAAhAhBiBAA"],
            ["40", "QQAQECQICAKAQgAAAACAAEAIAAAAgBAA"],
            ["39", "AAAYggBhAAIAAAIIAAAAAAAAACGAAAAA"],
            ["38", "QQAIBAEgEASASAEAAAAIASAEAAAAgBQA"],
            ["37", "UIQoBAEoUAQAAAAAAAAAAAAAAAAAEGKI"],
            ["36", "iAIAgkJRAEBQACAlFAAAAAAAAEIBAIBQ"],
            ["35", "AAAA4TzNAAAAgAAACAAAhAhAjIQAAAgA"],
            ["34", "QQSIAIEgQQSKAAAAAAAAAhhCCAAAAAAA"],
            ["33", "ABAEAAAAAAgAEAIABCCAAEAIAAgRAgIA"],
            ["32", "AEAYCCYYGAYAAAEBAAAAAAAAAAAAAARC"],
            ["31", "ghTNAAAA0wxIAAAAAABACAEQQgAAAAAA"],
            ["30", "iFJVggIAAAAAAAAAAAAAACAUAKECoBQA"],
            ["29", "kiTPAAAAQYh4AAAAAACAEAIIIQAAAAAA"],
            ["28", "giIoAAAABAVRAAACACEAEAIAIAAQAgAh"],
            ["27", "ACCoAICqAKCotZIKAAAAAAAAAAAAAAAA"],
            ["26", "gghIAEIQkhRFAAgBAAAAAAAAAAAAAABA"],
            ["25", "AIAwkiRIBAMAMcYIAAAAAAAAAAAAAGKI"],
            ["24", "AAAIgABBEAQAABCCEAAAASAEAEAAAAAg"],
            ["23", "wWAYCANhIAyCACIEAIQAAAAAACEAIAQI"],
            ["22", "AEAYCCYYGAYAAAEBAAAAAAAAAAAAAARC"],
            ["21", "AAAAAAAAAAxAAAAAAABCCBFKKKSEEkoo"],
            ["20", "gBAUgkJQCApAACEEIYAAAAAAACGAAIQQ"],
            ["19", "AAgEIAgEABgEjAFADACMAWAMAIQBYAwA"],
            ["18", "AEAQgoFhAAIAAAAAIIAAAAAAACCEAAAA"],
            ["17", "ECWoQCAIQQAIAAAAAAAAAIAQQAAAACGA"],
            ["16", "iEMQQQAMQQAAAAAAAAAQAgAAhAAAQJgw"],
            ["15", "AAsIQAAEgACyAACAEACEAEAIUggBAAAA"],
            ["14", "BGEYgABACAYgACAEIYAAAAAAACGEAAAQ"],
            ["13", "AACgECUoRQEAQgABQggAAAAAABBCCBBA"],
            ["12", "ACIYggAEAAAAAAAAAAAAAAAggIRSCgAA"],
            ["11", "YQhJCEMwgBSEhBACAAAAAAAAAAAAAAgg"],
            ["10", "CIIgEG4cAAEQEEIYAggAAAAAABACGEII"],
            ["9", "AAQgAEIQBCEIQgAQAgAhAAAgAAACABAA"],
            ["8", "ACAoBIUoBAUAMQICAAAAAAAAAAAAECIh"],
            ["7", "AKAoAAEgBAUAShEGAAAIAQAEAAAAABQx"],
            ["6", "giIoAAAABAVRAAACACEAEAIAIAAQAgAh"],
            ["5", "QQEIQACAEASgAEAIIUAIEQKIEEKAAAIA"],
            ["4", "AABAhIFhgAAAcsIIAAAAAAAAAAAAEDOI"],
            ["3", "AGh5CEMwAAMAhAAFAAAAAAAAAAAAAIhS"],
            ["2", "DAMAQQiGAEAwAABAiFCEAEAIAIAgBQAA"],
            ["tutorial 2", "AAEgQQiGBIEgQAGgFAAgAAAgAEABoBQA"],
            ["tutorial 1", "wwCGEAzjDG/6kFKqFFKEAAIAAAAAAAAA"],
            ["1d", "wxyEDEMwQQjPIEAIAoQwwghijACGACAI"],
            ["1b", "RYG2YNu0aQugAAAAAAAAAAAAAAAAAAAA"],
            ["1", "RQEAQQUABAUACCEECCEAACCEECCAAAAA"],
        ],
    ],
];

const puzzleLibrary = [];
for (const [set, puzzles] of puzzleSets) {
    for (const [name, puzzle] of puzzles) {
        puzzleLibrary.push({
            puzzle,
            set,
            name,
            link: `/?puzzle=${puzzle}&set=${set}&name=${name}`,
        });
    }
}

(() => {
    const t = new Tango(
        document.querySelector(".game"),
        document.querySelector(".undo"),
        document.querySelector(".clear-board"),
        document.querySelector(".redo"),
        document.querySelector(".confetti"),
    );

    const urlParams = new URLSearchParams(window.location.search);
    let currentPuzzle = urlParams.get("puzzle");
    let currentSet = urlParams.get("set");
    let currentName = "";
    if (currentSet) {
        currentName = urlParams.get("name");
    }
    let listed = false;

    if (!currentPuzzle) {
        const r = puzzleLibrary[Math.floor(Math.random() * puzzleLibrary.length)];
        currentPuzzle = r.puzzle;
        currentSet = r.set;
        currentName = r.name;
        window.history.replaceState(undefined, undefined, r.link);
    }

    t.init(currentPuzzle);
    const select = document.getElementById("puzzles");
    for (const [set, puzzles] of puzzleSets) {
        const optgroup = document.createElement("optgroup");
        optgroup.label = set;
        select.appendChild(optgroup);
        for (const [name, puzzle] of puzzles) {
            const option = document.createElement("option");
            option.value = puzzle;
            option.innerText = `${set} - ${name}`;
            if (set === currentSet && name === currentName) {
                option.selected = true;
                listed = true;
            }
            optgroup.appendChild(option);
        }
    }

    if (currentSet) {
        if (listed) {
            document.title = `Tango Player | ${currentSet} - ${currentName}`;
        } else {
            document.title = `Tango Player | ${currentSet} - ${currentName} (unlisted)`;
        }
    }

    const loadButton = document.querySelector(".load");
    loadButton.addEventListener("click", () => {
        const s = puzzleLibrary[select.selectedIndex];
        if (s.puzzle !== t.puzzle) {
            if (
                document.querySelector(".undo").disabled ||
                confirm(
                    "Loading a new puzzle will erase your current progress. Do you want to continue?",
                )
            ) {
                window.location.href = s.link;
            }
        }
    });

    const randomButton = document.querySelector(".random");
    randomButton.addEventListener("click", () => {
        let r = null;
        while (r === null || r.puzzle === t.puzzle) {
            r = puzzleLibrary[Math.floor(Math.random() * puzzleLibrary.length)];
        }

        if (
            document.querySelector(".undo").disabled ||
            confirm(
                "Loading a new puzzle will erase your current progress. Do you want to continue?",
            )
        ) {
            window.location.href = r.link;
        }
    });
})();
