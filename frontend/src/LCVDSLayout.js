import * as BABYLON from "babylonjs";

class LCVDSLayout {
    constructor(csvData, { arcAngle, radius, height, groundOffset = 10 }) {
        this.csvData = csvData;
        this.arcAngle = arcAngle;
        this.radius = radius;
        this.height = height;
        this.groundOffset = groundOffset;
        console.log("first row:", csvData[0]);
        this.numRows = csvData.length;
        this.numCols = Object.keys(csvData[0]).length;
        this.positionMatrix = [];
        this.originalPositionMatrix = null; // will hold a copy of the initial layout for restoration
        this.dataArray = [];
        this.originalDataArray = [];

        this.arcLength = this.radius * this.arcAngle;

        this.cellWidth = this.arcLength / this.numCols;
        this.cellHeight = this.height / this.numRows;

        this.columnKeys = Object.keys(csvData[0]);
        console.log("Column Keys:", this.columnKeys);
        this.columnMetadata = this._inferColumnMetadata();
        console.log("Column Metadata:", this.columnMetadata);

    }


    _inferColumnMetadata() {
        const meta = {};
        for (const key of this.columnKeys) {
            const values = this.csvData.map(r => r[key]);
            const analyzed = this._analyzeColumn(values);
            meta[key] = analyzed;
        }
        console.log("Inferred Column Metadata:", meta);
        return meta;
    }

    _analyzeColumn(values) {
        const cleaned = values.map(v => (v === null || v === undefined ? "" : v));
        let numericParsed = cleaned.map(v => {
            const n = typeof v === "number" ? v : parseFloat(v);
            return Number.isFinite(n) ? n : NaN;
        });
        const numericValid = numericParsed.filter(v => !Number.isNaN(v));
        const numericRatio = numericValid.length / cleaned.length;

        // Date detection
        const dateParsed = cleaned.map(v => {
            const t = Date.parse(v);
            return Number.isFinite(t) ? t : NaN;
        });
        const dateValid = dateParsed.filter(v => !Number.isNaN(v));
        const dateRatio = dateValid.length / cleaned.length;

        const unique = Array.from(new Set(cleaned));
        // Decide type
        let type;
        if (numericRatio >= 0.9) type = "numeric";
        else if (dateRatio >= 0.9) type = "date";
        else if (unique.length <= 1) type = "constant";
        else type = "categorical";

        if (type === "numeric") {
            const min = Math.min(...numericValid);
            const max = Math.max(...numericValid);
            const span = max - min || 1;
            return {
                type,
                min,
                max,
                normalize: v => {
                    const n = typeof v === "number" ? v : parseFloat(v);
                    if (!Number.isFinite(n)) return 0;
                    return (n - min) / span;
                }
            };
        }

        if (type === "date") {
            const min = Math.min(...dateValid);
            const max = Math.max(...dateValid);
            const span = max - min || 1;
            return {
                type,
                min: new Date(min),
                max: new Date(max),
                normalize: v => {
                    const t = Date.parse(v);
                    if (!Number.isFinite(t)) return 0;
                    return (t - min) / span;
                }
            };
        }

        if (type === "categorical") {

            const freq = {};
            cleaned.forEach(v => { freq[v] = (freq[v] || 0) + 1; });
            const categories = Array.from(new Set(cleaned))
                .sort((a, b) => {
                    if (freq[b] === freq[a]) return a.localeCompare(b);
                    return freq[b] - freq[a];
                });
            const denom = Math.max(categories.length - 1, 1);
            const indexMap = new Map(categories.map((c, i) => [c, i]));
            return {
                type,
                categories,
                indexMap,
                normalize: v => (indexMap.has(v) ? indexMap.get(v) / denom : 0)
            };
        }

        return {
            type: "constant",
            normalize: () => 0.5
        };
    }

    computeCellPositions(instanceIndex = null, foucsWidth = 5, foucsHeight = 5) {

        const startAngle = -this.arcAngle / 2;
        const colStepAngle = this.arcAngle / this.numCols;

        const bottomRowY = ((this.numRows - 1 - (this.numRows - 1)) - this.numRows / 2 + 0.5) * this.cellHeight;
        const yShift = this.groundOffset - bottomRowY;
        if (instanceIndex == null) {
            // Prevent recomputation if already computed
            if (this.positionMatrix.length === 0) {
                for (let row = 1; row < this.csvData.length; row++) {
                    const rowData = this.csvData[row];
                    const y = ((this.numRows - 1 - (row - 1)) - this.numRows / 2 + 0.5) * this.cellHeight + yShift;
                    for (let c = 0; c < this.numCols; c++) {
                        const key = this.columnKeys[c];
                        const originalValue = rowData[key];
                        const normalizedValue = this.columnMetadata[key].normalize(originalValue);

                        const cellAngle = startAngle + (c * colStepAngle) + (colStepAngle / 2);
                        const x = this.radius * Math.sin(cellAngle);
                        const z = this.radius * Math.cos(cellAngle) - this.radius;
                        const scaling = new BABYLON.Vector3(1, 1, 1);
                        const rotationQuaternion = BABYLON.Quaternion.RotationYawPitchRoll(cellAngle, 0, 0);
                        const translation = new BABYLON.Vector3(x, y, z);
                        const composedMatrix = BABYLON.Matrix.Compose(scaling, rotationQuaternion, translation);
                        this.positionMatrix.push(...composedMatrix.asArray());

                        this.originalDataArray.push(originalValue);
                        this.dataArray.push(normalizedValue);
                    }
                }
                // store immutable copy
                this.originalPositionMatrix = this.positionMatrix.slice();
            }
            return {
                positionMatrix: this.positionMatrix,
                dataArray: this.dataArray,
                originalDataArray: this.originalDataArray,
                columnMetadata: this.columnMetadata
            };
        } else {
            // future: compute single instance
        }
    }

    getCellValue(row, col, { normalized = true } = {}) {
        const idx = row * this.numCols + col;
        return normalized ? this.dataArray[idx] : this.originalDataArray[idx];
    }

    getOriginalPositionMatrix() {
        return this.originalPositionMatrix ? this.originalPositionMatrix.slice() : this.positionMatrix.slice();
    }

    /**
     * Non-overlapping column magnification layout.
     * @param {number} focusCol index of focused column
     * @param {number} divisor focused column occupies arcAngle/divisor
     * @param {number} sigma Gaussian falloff (in column units)
     * @param {number} minFactor optional minimum width factor vs original (0 => allow arbitrarily small)
     * @returns {number[]} matrices buffer
     */
    computeColumnFocusLayout(focusCol, divisor = 5, sigma = 1.6, minFactor = 0.15, edgeSafety = 0.96) {
        if (focusCol < 0 || focusCol >= this.numCols) return this.getOriginalPositionMatrix();

        const totalAngle = this.arcAngle;
        const baselineAngle = totalAngle / this.numCols; // original per-column angle
        const focusAngle = totalAngle / divisor;

        const remainingAngle = totalAngle - focusAngle;
        if (remainingAngle <= 0) return this.getOriginalPositionMatrix();

        // Weights for non-focus columns
        const weights = [];
        let weightSum = 0;
        for (let c = 0; c < this.numCols; c++) {
            if (c === focusCol) {
                weights.push(0);
                continue;
            }
            const d = Math.abs(c - focusCol);
            const w = Math.exp(-0.5 * (d / sigma) ** 2);
            weights.push(w);
            weightSum += w;
        }

        // Allocate angles
        const colAngles = new Array(this.numCols);
        for (let c = 0; c < this.numCols; c++) {
            if (c === focusCol) {
                colAngles[c] = focusAngle;
            } else {
                const w = weights[c];
                const a = (remainingAngle * (w / (weightSum || 1)));
                colAngles[c] = a;
            }
        }

        // Optional min clamp & renormalize (prevents too thin columns)
        if (minFactor > 0) {
            const minAngle = baselineAngle * minFactor;
            let deficit = 0;
            // First enforce minimum
            for (let c = 0; c < this.numCols; c++) {
                if (c === focusCol) continue; // focus already large
                if (colAngles[c] < minAngle) {
                    deficit += (minAngle - colAngles[c]);
                    colAngles[c] = minAngle;
                }
            }
            if (deficit > 0) {
                // Take deficit proportionally from remaining (excluding focus)
                let adjustableSum = 0;
                for (let c = 0; c < this.numCols; c++) {
                    if (c === focusCol) continue;
                    adjustableSum += (colAngles[c] - baselineAngle * minFactor);
                }
                if (adjustableSum > 0) {
                    for (let c = 0; c < this.numCols; c++) {
                        if (c === focusCol) continue;
                        const excess = colAngles[c] - baselineAngle * minFactor;
                        const give = deficit * (excess / adjustableSum);
                        colAngles[c] -= give;
                    }
                }
            }
            // Re-normalize to totalAngle (including focus)
            const currentTotal = colAngles.reduce((a, b) => a + b, 0);
            const renorm = totalAngle / currentTotal;
            for (let c = 0; c < this.numCols; c++) colAngles[c] *= renorm;
        }

        // Enforce focus dominance: ensure focus column wider than any neighbor
        {
            let maxOther = 0;
            for (let c = 0; c < this.numCols; c++) {
                if (c === focusCol) continue;
                if (colAngles[c] > maxOther) maxOther = colAngles[c];
            }
            if (maxOther >= colAngles[focusCol]) {
                const epsilon = baselineAngle * 0.001; // tiny separation
                const oldFocus = colAngles[focusCol];
                const newFocus = maxOther + epsilon;
                const sumOthersBefore = colAngles.reduce((a, b, idx) => idx === focusCol ? a : a + b, 0);
                const sumOthersAfter = totalAngle - newFocus;
                if (sumOthersAfter > 0 && sumOthersBefore > 0) {
                    const scaleOthers = sumOthersAfter / sumOthersBefore;
                    for (let c = 0; c < this.numCols; c++) {
                        if (c === focusCol) continue;
                        colAngles[c] *= scaleOthers;
                    }
                    colAngles[focusCol] = newFocus;
                }
            }
        }

        // Compute center angles (after dominance enforcement)
        const startEdge = -totalAngle / 2;
        const centerAngles = [];
        let accum = 0;
        for (let c = 0; c < this.numCols; c++) {
            const width = colAngles[c];
            const center = startEdge + accum + width / 2;
            centerAngles.push(center);
            accum += width;
        }

        // Width scale factors vs original baseline (apply edge safety to reduce chord overlap)
        const scaleX = colAngles.map(a => (a / baselineAngle) * edgeSafety);

        // Row Y positions (unchanged from original)
        const bottomRowY = ((this.numRows - 1 - (this.numRows - 1)) - this.numRows / 2 + 0.5) * this.cellHeight;
        const yShift = this.groundOffset - bottomRowY;

        const matrices = [];
        for (let row = 1; row < this.csvData.length; row++) {
            const y = ((this.numRows - 1 - (row - 1)) - this.numRows / 2 + 0.5) * this.cellHeight + yShift;
            for (let c = 0; c < this.numCols; c++) {
                const ang = centerAngles[c];
                const x = this.radius * Math.sin(ang);
                const z = this.radius * Math.cos(ang) - this.radius;
                const scaling = new BABYLON.Vector3(scaleX[c], 1, 1);
                const rot = BABYLON.Quaternion.RotationYawPitchRoll(ang, 0, 0);
                const trans = new BABYLON.Vector3(x, y, z);
                const m = BABYLON.Matrix.Compose(scaling, rot, trans);
                matrices.push(...m.asArray());
            }
        }
        return matrices;
    }

    /**
     * Non-overlapping row magnification layout.
     * @param {number} focusRow visual data row index (0..visualRowCount-1)
     * @param {number} divisor focused row occupies span/divisor
     * @param {number} sigma Gaussian falloff (in row units)
     * @param {number} minFactor minimum height factor vs baseline (optional)
     */
    computeRowFocusLayout(focusRow, divisor = 5, sigma = 1.6, minFactor = 0.15, edgeSafety = 0.96) {
        const visualRowCount = this.numRows - 1;
        if (focusRow < 0 || focusRow >= visualRowCount) return this.getOriginalPositionMatrix();
        if (visualRowCount < 2) return this.getOriginalPositionMatrix();

        // Original Y positions (top->bottom)
        const originalY = [];
        for (let row = 1; row < this.csvData.length; row++) {
            const y = ((this.numRows - 1 - (row - 1)) - this.numRows / 2 + 0.5) * this.cellHeight
                + (this.groundOffset - (((this.numRows - 1 - (this.numRows - 1)) - this.numRows / 2 + 0.5) * this.cellHeight));
            originalY.push(y);
        }
        const topY = originalY[0];
        const bottomY = originalY[visualRowCount - 1];
        const span = topY - bottomY; // positive

        const baselineHeight = span / visualRowCount;
        const focusHeight = span / divisor;
        const remainingHeight = span - focusHeight;
        if (remainingHeight <= 0) return this.getOriginalPositionMatrix();

        // Weights
        const weights = [];
        let weightSum = 0;
        for (let r = 0; r < visualRowCount; r++) {
            if (r === focusRow) {
                weights.push(0);
                continue;
            }
            const d = Math.abs(r - focusRow);
            const w = Math.exp(-0.5 * (d / sigma) ** 2);
            weights.push(w);
            weightSum += w;
        }

        const heights = new Array(visualRowCount);
        for (let r = 0; r < visualRowCount; r++) {
            if (r === focusRow) heights[r] = focusHeight;
            else heights[r] = remainingHeight * (weights[r] / (weightSum || 1));
        }

        // Min clamp and renormalize if requested
        if (minFactor > 0) {
            const minH = baselineHeight * minFactor;
            let deficit = 0;
            for (let r = 0; r < visualRowCount; r++) {
                if (r === focusRow) continue;
                if (heights[r] < minH) {
                    deficit += (minH - heights[r]);
                    heights[r] = minH;
                }
            }
            if (deficit > 0) {
                let adjustableSum = 0;
                for (let r = 0; r < visualRowCount; r++) {
                    if (r === focusRow) continue;
                    adjustableSum += (heights[r] - minH);
                }
                if (adjustableSum > 0) {
                    for (let r = 0; r < visualRowCount; r++) {
                        if (r === focusRow) continue;
                        const excess = heights[r] - minH;
                        const give = deficit * (excess / adjustableSum);
                        heights[r] -= give;
                    }
                }
            }
            // Renormalize to total span
            const totalCurrent = heights.reduce((a, b) => a + b, 0);
            const renorm = span / totalCurrent;
            for (let r = 0; r < visualRowCount; r++) heights[r] *= renorm;
        }

        // Enforce focus dominance for height
        {
            let maxOther = 0;
            for (let r = 0; r < visualRowCount; r++) {
                if (r === focusRow) continue;
                if (heights[r] > maxOther) maxOther = heights[r];
            }
            if (maxOther >= heights[focusRow]) {
                const epsilon = baselineHeight * 0.001;
                const newFocus = maxOther + epsilon;
                const sumOthersBefore = heights.reduce((a, b, idx) => idx === focusRow ? a : a + b, 0);
                const sumOthersAfter = span - newFocus;
                if (sumOthersAfter > 0 && sumOthersBefore > 0) {
                    const scaleOthers = sumOthersAfter / sumOthersBefore;
                    for (let r = 0; r < visualRowCount; r++) {
                        if (r === focusRow) continue;
                        heights[r] *= scaleOthers;
                    }
                    heights[focusRow] = newFocus;
                }
            }
        }

        // Compute center Y positions (top -> bottom) after dominance enforcement
        const centerY = [];
        let offset = 0;
        for (let r = 0; r < visualRowCount; r++) {
            const h = heights[r];
            const cy = topY - (offset + h / 2);
            centerY.push(cy);
            offset += h;
        }

        // Scale factors vs baseline
        const scaleY = heights.map(h => (h / baselineHeight) * edgeSafety);

        // Column center angles unchanged (uniform)
        const startAngle = -this.arcAngle / 2;
        const colStepAngle = this.arcAngle / this.numCols;
        const centerAngles = [];
        for (let c = 0; c < this.numCols; c++) {
            centerAngles.push(startAngle + (c * colStepAngle) + colStepAngle / 2);
        }

        // Build matrices
        const matrices = [];
        for (let r = 0; r < visualRowCount; r++) {
            const y = centerY[r];
            for (let c = 0; c < this.numCols; c++) {
                const ang = centerAngles[c];
                const x = this.radius * Math.sin(ang);
                const z = this.radius * Math.cos(ang) - this.radius;
                const scaling = new BABYLON.Vector3(1, scaleY[r], 1);
                const rot = BABYLON.Quaternion.RotationYawPitchRoll(ang, 0, 0);
                const trans = new BABYLON.Vector3(x, y, z);
                const m = BABYLON.Matrix.Compose(scaling, rot, trans);
                matrices.push(...m.asArray());
            }
        }
        return matrices;
    }
}

export default LCVDSLayout;