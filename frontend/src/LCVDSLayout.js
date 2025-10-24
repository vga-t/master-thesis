import * as BABYLON from "babylonjs";

const DEFAULT_VISIBLE_ROWS = 48;
const DEFAULT_VISIBLE_COLS = 12;

class LCVDSLayout {
    constructor(csvData, {
        arcAngle,
        radius,
        height,
        groundOffset = 10,
        viewportRows = DEFAULT_VISIBLE_ROWS,
        viewportCols = DEFAULT_VISIBLE_COLS
    }) {
        this.csvData = Array.isArray(csvData) ? csvData : [];
        this.arcAngle = arcAngle;
        this.radius = radius;
        this.height = height;
        this.groundOffset = groundOffset;

        this.arcLength = this.radius * this.arcAngle;

        this.columnKeys = this.csvData.length > 0 ? Object.keys(this.csvData[0]) : [];
        this.totalRows = this.csvData.length;
        this.totalCols = this.columnKeys.length;

        const targetRows = viewportRows ?? DEFAULT_VISIBLE_ROWS;
        const targetCols = viewportCols ?? DEFAULT_VISIBLE_COLS;
        this.visibleRows = Math.max(1, Math.min(targetRows, Math.max(1, this.totalRows)));
        this.visibleCols = Math.max(1, Math.min(targetCols, Math.max(1, this.totalCols)));

        this.cellWidth = this.visibleCols > 0 ? this.arcLength / this.visibleCols : 0;
        this.cellHeight = this.visibleRows > 0 ? this.height / this.visibleRows : 0;

        this.scrollRowOffset = 0;
        // this.scrollColOffset = 0;
        this.scrollColOffset = Math.max(0, this.totalCols - this.visibleCols);

        this.columnMetadata = this._inferColumnMetadata();

        this._observers = new Set();
        this._visibleSnapshot = null;

        this._recomputeVisibleData();
    }

    addObserver(callback, { immediate = true } = {}) {
        if (typeof callback !== "function") return () => { };
        this._observers.add(callback);
        if (immediate) {
            const snapshot = this.getVisibleSnapshot();
            if (snapshot) callback(snapshot);
        }
        return () => {
            this._observers.delete(callback);
        };
    }

    getVisibleSnapshot() {
        return this._visibleSnapshot;
    }

    getScrollState() {
        return {
            rowOffset: this.scrollRowOffset,
            colOffset: this.scrollColOffset,
            maxRowOffset: Math.max(0, this.totalRows - this.visibleRows),
            maxColOffset: Math.max(0, this.totalCols - this.visibleCols)
        };
    }

    getVisibleRowCount() {
        return this._visibleSnapshot?.rowCount ?? 0;
    }

    getVisibleColCount() {
        return this._visibleSnapshot?.colCount ?? 0;
    }

    setScrollOffsets(rowOffset, colOffset) {
        const rowMax = Math.max(0, this.totalRows - this.visibleRows);
        const colMax = Math.max(0, this.totalCols - this.visibleCols);

        const clampedRow = Math.max(0, Math.min(rowOffset, rowMax));
        const clampedCol = Math.max(0, Math.min(colOffset, colMax));

        if (clampedRow === this.scrollRowOffset && clampedCol === this.scrollColOffset) {
            return false;
        }

        this.scrollRowOffset = clampedRow;
        this.scrollColOffset = clampedCol;
        this._recomputeVisibleData();
        return true;
    }

    scrollBy(rowDelta = 0, colDelta = 0) {
        if (rowDelta === 0 && colDelta === 0) return false;
        const targetRow = this.scrollRowOffset + rowDelta;
        const targetCol = this.scrollColOffset + colDelta;
        return this.setScrollOffsets(targetRow, targetCol);
    }

    _inferColumnMetadata() {
        const meta = {};
        for (const key of this.columnKeys) {
            const values = this.csvData.map(row => (row ? row[key] : undefined));
            meta[key] = this._analyzeColumn(values);
        }
        return meta;
    }

    _analyzeColumn(values) {
        const cleaned = values.map(v => (v === null || v === undefined ? "" : v));
        const numericParsed = cleaned.map(v => {
            const n = typeof v === "number" ? v : parseFloat(v);
            return Number.isFinite(n) ? n : NaN;
        });
        const numericValid = numericParsed.filter(v => !Number.isNaN(v));
        const numericRatio = cleaned.length ? numericValid.length / cleaned.length : 0;

        const dateParsed = cleaned.map(v => {
            const t = typeof v === "string" || v instanceof Date ? Date.parse(v) : NaN;
            return Number.isFinite(t) ? t : NaN;
        });
        const dateValid = dateParsed.filter(v => !Number.isNaN(v));
        const dateRatio = cleaned.length ? dateValid.length / cleaned.length : 0;

        const unique = Array.from(new Set(cleaned));
        let type;
        if (numericRatio >= 0.9) type = "numeric";
        else if (dateRatio >= 0.9) type = "date";
        else if (unique.length <= 1) type = "constant";
        else type = "categorical";

        if (type === "numeric") {
            const min = numericValid.length ? Math.min(...numericValid) : 0;
            const max = numericValid.length ? Math.max(...numericValid) : 1;
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
            const min = dateValid.length ? Math.min(...dateValid) : Date.now();
            const max = dateValid.length ? Math.max(...dateValid) : min + 1;
            const span = max - min || 1;
            return {
                type,
                min: new Date(min),
                max: new Date(max),
                normalize: v => {
                    const t = typeof v === "string" || v instanceof Date ? Date.parse(v) : NaN;
                    if (!Number.isFinite(t)) return 0;
                    return (t - min) / span;
                }
            };
        }

        if (type === "categorical") {
            const freq = {};
            cleaned.forEach(v => {
                const key = String(v);
                freq[key] = (freq[key] || 0) + 1;
            });
            const categories = Object.keys(freq)
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
                normalize: v => {
                    const key = String(v);
                    const idx = indexMap.has(key) ? indexMap.get(key) : 0;
                    return idx / denom;
                }
            };
        }

        return {
            type: "constant",
            normalize: () => 0.5
        };
    }

    _normalizeValue(key, value) {
        const normalizer = this.columnMetadata[key]?.normalize;
        if (!normalizer) return 0;
        const result = normalizer(value);
        return Number.isFinite(result) ? result : 0;
    }

    _recomputeVisibleData() {
        if (!this.totalRows || !this.totalCols) {
            this._visibleSnapshot = {
                rowOffset: this.scrollRowOffset,
                colOffset: this.scrollColOffset,
                rowCount: 0,
                colCount: 0,
                rowIndices: [],
                columnIndices: [],
                columnKeys: [],
                positionMatrix: new Float32Array(0),
                normalizedData: new Float32Array(0),
                rawData: [],
                cellWidth: this.cellWidth,
                cellHeight: this.cellHeight,
                arcAngle: this.arcAngle,
                arcLength: this.arcLength
            };
            this._notifyObservers();
            return;
        }

        const rowCount = Math.min(this.visibleRows, this.totalRows);
        const colCount = Math.min(this.visibleCols, this.totalCols);

        const matrix = new Float32Array(rowCount * colCount * 16);
        const normalizedData = new Float32Array(rowCount * colCount);
        const rawData = new Array(rowCount * colCount);
        const rowIndices = [];
        const columnIndices = [];
        const columnKeys = this.columnKeys.slice(this.scrollColOffset, this.scrollColOffset + colCount);

        for (let r = 0; r < rowCount; r++) {
            rowIndices.push(this.scrollRowOffset + r);
        }
        for (let c = 0; c < colCount; c++) {
            columnIndices.push(this.scrollColOffset + c);
        }

        const startAngle = -this.arcAngle / 2;
        const colStep = colCount > 0 ? this.arcAngle / colCount : 0;
        const scaling = new BABYLON.Vector3(1, 1, 1);

        let matrixOffset = 0;
        let dataIndex = 0;

        for (let r = 0; r < rowCount; r++) {
            const globalRow = this.scrollRowOffset + r;
            const rowData = this.csvData[globalRow] ?? {};
            const y = this.groundOffset + (rowCount - 1 - r) * this.cellHeight + this.cellHeight / 2;

            for (let c = 0; c < colCount; c++) {
                const globalCol = this.scrollColOffset + c;
                const key = this.columnKeys[globalCol];
                const originalValue = rowData[key];
                const normalizedValue = this._normalizeValue(key, originalValue);

                const angle = startAngle + (c + 0.5) * colStep;
                const x = this.radius * Math.sin(angle);
                const z = this.radius * Math.cos(angle) - this.radius;

                const rotation = BABYLON.Quaternion.RotationYawPitchRoll(angle, 0, 0);
                const translation = new BABYLON.Vector3(x, y, z);
                const composed = BABYLON.Matrix.Compose(scaling, rotation, translation).asArray();
                matrix.set(composed, matrixOffset);
                matrixOffset += 16;

                normalizedData[dataIndex] = normalizedValue;
                rawData[dataIndex] = originalValue;
                dataIndex += 1;
            }
        }

        this._visibleSnapshot = {
            rowOffset: this.scrollRowOffset,
            colOffset: this.scrollColOffset,
            rowCount,
            colCount,
            rowIndices,
            columnIndices,
            columnKeys,
            positionMatrix: matrix,
            normalizedData,
            rawData,
            cellWidth: this.cellWidth,
            cellHeight: this.cellHeight,
            arcAngle: this.arcAngle,
            arcLength: this.arcLength
        };

        this._notifyObservers();
    }

    _notifyObservers() {
        if (!this._visibleSnapshot) return;
        this._observers.forEach(callback => {
            try {
                callback(this._visibleSnapshot);
            } catch (error) {
                console.error("LCVDSLayout observer error", error);
            }
        });
    }
}

export default LCVDSLayout;