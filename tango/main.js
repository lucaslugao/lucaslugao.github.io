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

        while (numBits > 0) {
            const byteIndex = Math.floor(this.bitIndex / 8);
            const bitOffset = this.bitIndex % 8;

            const availableBits = 8 - bitOffset;
            const readAmount = Math.min(numBits, availableBits);

            if (byteIndex >= this.data.length) {
                return 0;
            }

            const mask = (1 << readAmount) - 1;
            const readVal = (this.data[byteIndex] >> bitOffset) & mask;

            result |= readVal << readBits;
            readBits += readAmount;
            numBits -= readAmount;
            this.bitIndex += readAmount;
        }

        return result;
    }

    writeBits(value, numBits) {
        value &= (1 << numBits) - 1;

        while (numBits > 0) {
            const byteIndex = Math.floor(this.bitIndex / 8);
            const bitOffset = this.bitIndex % 8;

            if (byteIndex >= this.data.length) {
                this.data.push(0);
            }

            const availableBits = 8 - bitOffset;
            const writeBits = Math.min(numBits, availableBits);

            const mask = ((1 << writeBits) - 1) << bitOffset;
            const writeVal = (value << bitOffset);

            this.data[byteIndex] = (this.data[byteIndex] & ~mask) | (writeVal & mask);

            value >>= writeBits;
            numBits -= writeBits;
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
        return (this.mask >> k) & 1 !== 0;
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
    constructor(container, undoButton, clearButton, redoButton, confettiButton, cellSize = 60) {
        this.undoButton = undoButton;
        this.redoButton = redoButton;
        this.confettiButton = confettiButton;
        this.cellSize = cellSize;
        this.history = [];
        this.future = [];
        this.rows = Array(6).fill(null).map(() => new MaskedBitset());
        this.cols = Array(6).fill(null).map(() => new MaskedBitset());
        this.rowsConstr = Array(6).fill(null).map(() => new MaskedBitset());
        this.colsConstr = Array(6).fill(null).map(() => new MaskedBitset());

        const urlParams = new URLSearchParams(window.location.search);
        this.puzzle = urlParams.get('puzzle');

        if (!this.puzzle) {
            window.location.search = `?puzzle=CIMgAEAQACAIAAAAAAAQAgAhIQAAAKAQ`;
            return;
        }
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
        this.setState(decodeURIComponent(window.location.hash.substring(1)) || this.puzzle);
        container.appendChild(this.svgElement);

        this.undoButton.addEventListener("click", () => {
            this.undo();
        });
        this.undoButton.disabled = true;
        this.redoButton.addEventListener("click", () => {
            this.redo();
        });
        this.redoButton.disabled = true;
        clearButton.addEventListener("click", () => {
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
            const newState = decodeURIComponent(window.location.hash.substring(1)) || this.puzzle;
            if (this.getState() !== newState) {
                this.setState(newState);
            }
        });
    }

    updateConfettiButton() {
        localStorage.setItem("confetti", this.confetti);
        this.confettiButton.innerText = this.confetti ? "Confetti On" : "Confetti Off";
        if (this.confetti) {
            this.confettiButton.classList.remove("dark");
        }
        else {
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
            this.setRow(k, new MaskedBitset(stateBuf.readBits(6), stateBuf.readBits(6)));
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
        window.history.replaceState(undefined, undefined, `#${encodeURIComponent(this.getState())}`);
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
                    spread: 70,
                    origin: { y: 1 }
                });
            }
        } else {
            document.body.dataset.state = "playing";
        }
    }

    handleClick(x, y, right) {
        if (this.cells[y][x].dataset.base == "1") return;
        this.history.push(this.getState());
        this.future = [];
        this.redoButton.disabled = true;
        this.undoButton.disabled = false;
        const [value, ok] = this.get(x, y);
        const next = right ? (ok ? value + 2 : 1) % 3 : (ok ? value : 2) % 3;

        if (next == 0) {
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
        const xCoord = x * this.cellSize + (this.cellSize - size) / 2
        const yCoord = y * this.cellSize + (this.cellSize - size) / 2

        const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        use.setAttribute('x', xCoord);
        use.setAttribute('y', yCoord);
        use.setAttribute('width', size);
        use.setAttribute('height', size);
        use.setAttribute('href', `#${symbol}`);
        use.classList.add(`symbol-${symbol}`);
        use.classList.add(`symbol`);
        use.setAttribute('pointer-events', 'none');
        if (rotated) {
            use.setAttribute('transform', `rotate(90 ${xCoord + size / 2} ${yCoord + size / 2})`);
        }
        return use;
    };

    createBoard() {
        const cells = Array.from({ length: 6 }, () => Array(6).fill(null));

        const widthSize = this.cellSize * 6;
        const heightSize = this.cellSize * 6;

        this.svgElement = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        this.svgElement.setAttribute('width', widthSize + 2);
        this.svgElement.setAttribute('height', heightSize + 2);
        this.svgElement.setAttribute('viewBox', `-1 -1 ${widthSize + 2} ${heightSize + 2}`);
        this.svgElement.setAttribute('version', '1.1');

        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        this.svgElement.appendChild(defs);

        const symbols = {
            sun: `<circle fill="#ffb31e" stroke="black" stroke-width="0.05" cx="0.5" cy="0.5" r="0.5"/>`,
            moon: `<path fill="#82afed" stroke="black" stroke-width="0.05" d="m 0.7056 0.0444 a 0.5 0.5 90 0 1 0.0444 0.2056 a 0.5 0.5 90 0 1 -0.5 0.5 a 0.5 0.5 90 0 1 -0.2056 -0.0444 a 0.5 0.5 90 0 0 0.4556 0.2944 a 0.5 0.5 90 0 0 0.5 -0.5 a 0.5 0.5 90 0 0 -0.2944 -0.4556 z"/>`,
            equal: `<path fill="black" stroke="#fff" stroke-width="0.1" stroke-linecap="round" paint-order="stroke" d="m 0.2 0.3 l 0.6 0 l 0 0.1 l -0.6 0 z m 0 0.3 l 0.6 0 l 0 0.1 l -0.6 0 z"/>`,
            cross: `<path fill="black" stroke="#fff" stroke-width="0.1" stroke-linecap="round" paint-order="stroke" d="m 0.3232 0.2525 l 0.4243 0.4243 l -0.0707 0.0707 l -0.4243 -0.4243 z m -0.0707 0.4243 l 0.4243 -0.4243 l 0.0707 0.0707 l -0.4243 0.4243 z"/>`,
        };

        for (const [id, path] of Object.entries(symbols)) {
            const symbol = document.createElementNS('http://www.w3.org/2000/svg', 'symbol');
            symbol.setAttribute('id', id);
            symbol.setAttribute('viewBox', '-1 -1 3 3');
            symbol.innerHTML = path;
            defs.appendChild(symbol);
        }


        for (let y = 0; y < 6; y++) {
            for (let x = 0; x < 6; x++) {
                const xCoord = x * this.cellSize;
                const yCoord = y * this.cellSize;

                const cellGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                cellGroup.setAttribute('data-x', x);
                cellGroup.setAttribute('data-y', y);
                cellGroup.setAttribute('transform', `translate(${xCoord} ${yCoord})`);
                this.svgElement.appendChild(cellGroup);

                const fill = "white";
                const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                rect.setAttribute('width', this.cellSize);
                rect.setAttribute('height', this.cellSize);
                rect.setAttribute('fill', fill);
                rect.setAttribute('stroke', 'black');
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
                    this.svgElement.appendChild(this.createSymbol(x + 0.5, y, 0.8, symbol, false));
                }

                const [colValue, colOk] = this.colsConstr[x].get(y);
                if (colOk) {
                    const symbol = ["equal", "cross"][colValue];
                    this.svgElement.appendChild(this.createSymbol(x, y + 0.5, 0.8, symbol, true));
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
        return (((validA ^ validS ^ constr.value) & constr.mask) === 0);
    }

    countCompletions(line, constr) {
        let count = 0;
        for (const valid of [11, 13, 19, 21, 22, 25, 26, 37, 38, 41, 42, 44, 50, 52]) {
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
        return type === null
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
new Tango(
    document.querySelector(".game"),
    document.querySelector(".undo"),
    document.querySelector(".clear-board"),
    document.querySelector(".redo"),
    document.querySelector(".confetti"),
);