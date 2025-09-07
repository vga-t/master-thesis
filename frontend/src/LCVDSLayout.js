import * as BABYLON from "babylonjs"; // new import

class LCVDSLayout {
    constructor(csvData, { arcAngle, radius, height, groundOffset = 10 }) { // added groundOffset param
        this.csvData = csvData;
        this.arcAngle = arcAngle;
        this.radius = radius;
        this.height = height;
        this.groundOffset = groundOffset; // store groundOffset

        this.numRows = csvData.length;
        this.numCols = Object.keys(csvData[0]).length;
        this.positionMatrix = [];
        this.dataArray = [];
        this.rawDataArray = [];            // store original (unnormalized) values

        this.arcLength = this.radius * this.arcAngle;

        this.cellWidth = this.arcLength / this.numCols;
        this.cellHeight = this.height / this.numRows;
        // --- added: infer column metadata & normalization functions ---
        this.columnKeys = Object.keys(csvData[0]);
        this.columnMetadata = this._inferColumnMetadata();
        // --------------------------------------------------------------
    }

    // --- new: infer types & build normalization per column ---
    _inferColumnMetadata() {
        const meta = {};
        for (const key of this.columnKeys) {
            const values = this.csvData.map(r => r[key]);
            const analyzed = this._analyzeColumn(values);
            meta[key] = analyzed;
        }
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
            // Sort categories by frequency (descending), then alphabetically
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

        // constant
        return {
            type: "constant",
            normalize: () => 0.5
        };
    }
    // --------------------------------------------------------

    computeCellPositions() {
        const startAngle = -this.arcAngle / 2;
        const colStepAngle = this.arcAngle / this.numCols;
        // Compute the Y position of the bottom row (last CSV row)
        // In the new mapping, the CSV last row (index = numRows - 1) becomes the bottom.
        const bottomRowY = ((this.numRows - 1 - (this.numRows - 1)) - this.numRows / 2 + 0.5) * this.cellHeight;
        const yShift = this.groundOffset - bottomRowY;

        for (let row = 0; row < this.numRows; row++) {
            const rowData = this.csvData[row];
            // Reverse the row index so that CSV row 0 is at the top.
            const y = ((this.numRows - 1 - row) - this.numRows / 2 + 0.5) * this.cellHeight + yShift;
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

                this.rawDataArray.push(originalValue);
                this.dataArray.push(normalizedValue);
            }
        }
        return {
            positionMatrix: this.positionMatrix,
            dataArray: this.dataArray,
            rawDataArray: this.rawDataArray,
            columnMetadata: this.columnMetadata
        };
    }

    // --- helper to access cell values later (row/col) ---
    getCellValue(row, col, { normalized = true } = {}) {
        const idx = row * this.numCols + col;
        return normalized ? this.dataArray[idx] : this.rawDataArray[idx];
    }
}

export default LCVDSLayout;