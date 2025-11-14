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
        this.scrollColOffset = 0;
        // this.scrollColOffset = Math.max(0, this.totalCols - this.visibleCols);

        this.columnMetadata = this._inferColumnMetadata();

        this._observers = new Set();
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
            rowWeights: [],
            colWeights: [],
            rowScaleFactors: [],
            colScaleFactors: [],
            arcAngle: this.arcAngle,
            arcLength: this.arcLength
        };
        this._rowFocusStrategy = null;
        this._colFocusStrategy = null;

        this._updateGeometry();
        this._updateData({ changeType: "geometry_and_data" });
    }

    setRowFocusStrategy(strategy = null) {
        this._rowFocusStrategy = strategy ? { ...strategy } : null;
        this._updateGeometry();
        this._updateData({ changeType: "geometry_and_data" });
    }

    setColumnFocusStrategy(strategy = null) {
        this._colFocusStrategy = strategy ? { ...strategy } : null;
        this._updateGeometry();
        this._updateData({ changeType: "geometry_and_data" });
    }

    addObserver(callback, { immediate = true } = {}) {
        if (typeof callback !== "function") return () => { };
        this._observers.add(callback);
        if (immediate) {
            const snapshot = this.getVisibleSnapshot();
            if (snapshot) callback(snapshot, "geometry_and_data");
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
        this._updateData({ changeType: "data_only" });
        return true;
    }

    scrollBy(rowDelta = 0, colDelta = 0) {
        if (rowDelta === 0 && colDelta === 0) return false;
        const targetRow = this.scrollRowOffset + rowDelta;
        const targetCol = this.scrollColOffset + colDelta;
        return this.setScrollOffsets(targetRow, targetCol);
    }

    setVisibleViewport(visibleRows, visibleCols) {
        const targetRows = Math.max(1, Math.min(Math.round(visibleRows), this.totalRows));
        const targetCols = Math.max(1, Math.min(Math.round(visibleCols), this.totalCols));

        if (targetRows === this.visibleRows && targetCols === this.visibleCols) {
            return false;
        }

        this.visibleRows = targetRows;
        this.visibleCols = targetCols;

        // Recalculate cell dimensions based on new viewport
        this.cellWidth = this.visibleCols > 0 ? this.arcLength / this.visibleCols : 0;
        this.cellHeight = this.visibleRows > 0 ? this.height / this.visibleRows : 0;

        // Clamp scroll offsets to valid range with new viewport size
        const rowMax = Math.max(0, this.totalRows - this.visibleRows);
        const colMax = Math.max(0, this.totalCols - this.visibleCols);
        this.scrollRowOffset = Math.min(this.scrollRowOffset, rowMax);
        this.scrollColOffset = Math.min(this.scrollColOffset, colMax);

        // Notify observers about the cell dimension change
        this._notifyObservers("cell_size_changed");

        // Update geometry and data
        this._updateGeometry();
        this._updateData({ changeType: "geometry_and_data" });

        return true;
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

    _updateGeometry() {
        if (!this.totalRows || !this.totalCols) {
            this._visibleSnapshot = {
                ...this._visibleSnapshot,
                rowCount: 0,
                colCount: 0,
                positionMatrix: new Float32Array(0),
                rowWeights: [],
                colWeights: [],
                rowScaleFactors: [],
                colScaleFactors: []
            };
            return;
        }

        const rowCount = Math.min(this.visibleRows, this.totalRows);
        const colCount = Math.min(this.visibleCols, this.totalCols);
        const matrix = new Float32Array(rowCount * colCount * 16);

        const rowIndices = Array.from({ length: rowCount }, (_, idx) => this.scrollRowOffset + idx);
        const columnIndices = Array.from({ length: colCount }, (_, idx) => this.scrollColOffset + idx);

        const rowWeightInfo = this._buildAxisWeights({
            indices: rowIndices,
            focusStrategy: this._rowFocusStrategy,
            totalSpan: this.height,
            baseSpan: rowCount > 0 ? this.height / rowCount : this.height,
            minContextShare: this._rowFocusStrategy?.minContextShare ?? 0.05
        });

        const colWeightInfo = this._buildAxisWeights({
            indices: columnIndices,
            focusStrategy: this._colFocusStrategy,
            totalSpan: this.arcAngle,
            baseSpan: colCount > 0 ? this.arcAngle / colCount : this.arcAngle,
            minContextShare: this._colFocusStrategy?.minContextShare ?? 0.05
        });

        const startAngle = -this.arcAngle / 2;
        const colAngles = [];
        let angleCursor = startAngle;
        for (let c = 0; c < colCount; c++) {
            const span = colWeightInfo.spans[c] ?? 0;
            const centerAngle = angleCursor + span / 2;
            colAngles.push(centerAngle);
            angleCursor += span;
        }

        const rowCenters = [];
        let heightCursor = this.height;
        for (let r = 0; r < rowCount; r++) {
            const span = rowWeightInfo.spans[r] ?? 0;
            const center = heightCursor - span / 2;
            rowCenters.push(this.groundOffset + center);
            heightCursor -= span;
        }

        let matrixOffset = 0;
        for (let r = 0; r < rowCount; r++) {
            const y = rowCenters[r] ?? (this.groundOffset + (rowCount - 1 - r) * this.cellHeight + this.cellHeight / 2);
            for (let c = 0; c < colCount; c++) {
                const angle = colAngles[c] ?? startAngle;
                const x = this.radius * Math.sin(angle);
                const z = this.radius * Math.cos(angle) - this.radius;

                const scaling = new BABYLON.Vector3(
                    colWeightInfo.scaleFactors[c] ?? 1,
                    rowWeightInfo.scaleFactors[r] ?? 1,
                    1
                );

                const rotation = BABYLON.Quaternion.RotationYawPitchRoll(angle, 0, 0);
                const translation = new BABYLON.Vector3(x, y, z);
                const composed = BABYLON.Matrix.Compose(scaling, rotation, translation).asArray();
                matrix.set(composed, matrixOffset);
                matrixOffset += 16;
            }
        }

        this._visibleSnapshot = {
            ...this._visibleSnapshot,
            rowCount,
            colCount,
            positionMatrix: matrix,
            rowWeights: rowWeightInfo.normalized,
            colWeights: colWeightInfo.normalized,
            rowScaleFactors: rowWeightInfo.scaleFactors,
            colScaleFactors: colWeightInfo.scaleFactors
        };
    }

    _updateData({ changeType = "data_only" } = {}) {
        if (!this._visibleSnapshot) return;

        const rowCount = this._visibleSnapshot.rowCount ?? 0;
        const colCount = this._visibleSnapshot.colCount ?? 0;

        if (!this.totalRows || !this.totalCols || rowCount === 0 || colCount === 0) {
            this._visibleSnapshot = {
                ...this._visibleSnapshot,
                rowOffset: this.scrollRowOffset,
                colOffset: this.scrollColOffset,
                rowIndices: [],
                columnIndices: [],
                columnKeys: [],
                normalizedData: new Float32Array(0),
                rawData: []
            };
            this._notifyObservers("geometry_and_data");
            return;
        }

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

        let dataIndex = 0;
        for (let r = 0; r < rowCount; r++) {
            const globalRow = this.scrollRowOffset + r;
            const rowData = this.csvData[globalRow] ?? {};
            for (let c = 0; c < colCount; c++) {
                const globalCol = this.scrollColOffset + c;
                const key = this.columnKeys[globalCol];
                const originalValue = rowData[key];
                const normalizedValue = this._normalizeValue(key, originalValue);

                normalizedData[dataIndex] = normalizedValue;
                rawData[dataIndex] = originalValue;
                dataIndex += 1;
            }
        }

        this._visibleSnapshot = {
            ...this._visibleSnapshot,
            rowOffset: this.scrollRowOffset,
            colOffset: this.scrollColOffset,
            rowIndices,
            columnIndices,
            columnKeys,
            normalizedData,
            rawData
        };

        this._notifyObservers(changeType);
    }

    _buildAxisWeights({ indices, focusStrategy, totalSpan, baseSpan, minContextShare = 0.05 }) {
        const count = indices.length;
        if (count === 0 || !Number.isFinite(totalSpan) || totalSpan <= 0) {
            return {
                normalized: new Array(count).fill(0),
                spans: new Array(count).fill(0),
                scaleFactors: new Array(count).fill(1)
            };
        }

        if (!focusStrategy) {
            const normalizedWeight = 1 / count;
            const normalized = new Array(count).fill(normalizedWeight);
            const spans = normalized.map(weight => weight * totalSpan);
            const scaleFactors = spans.map(span => {
                if (!Number.isFinite(baseSpan) || baseSpan === 0) return 1;
                return span / baseSpan;
            });
            return { normalized, spans, scaleFactors };
        }

        const focusStart = focusStrategy.start ?? focusStrategy.focusStart;
        const focusEnd = focusStrategy.end ?? focusStrategy.focusEnd;
        const focusWeight = this._sanitizeWeight(focusStrategy.focusShare, 0.65);
        const contextWeight = this._sanitizeWeight(
            typeof focusStrategy.contextShare === "number" ? focusStrategy.contextShare : minContextShare,
            minContextShare
        );

        const focusFlags = indices.map(idx => focusStart != null && focusEnd != null ? (idx >= focusStart && idx <= focusEnd) : false);
        const rawWeights = focusFlags.map(flag => (flag ? focusWeight : contextWeight));
        const totalWeight = rawWeights.reduce((sum, weight) => sum + weight, 0);

        const normalized = totalWeight > 0
            ? rawWeights.map(weight => weight / totalWeight)
            : new Array(count).fill(1 / count);

        const spans = normalized.map(weight => weight * totalSpan);
        const scaleFactors = spans.map(span => {
            if (!Number.isFinite(baseSpan) || baseSpan === 0) return 1;
            return span / baseSpan;
        });

        return {
            normalized,
            spans,
            scaleFactors
        };
    }

    _sanitizeWeight(value, fallback = 0.5) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric) || numeric <= 0) {
            return Math.max(0.01, fallback);
        }
        return Math.max(0.01, numeric);
    }

    _notifyObservers(changeType = "geometry_and_data") {
        if (!this._visibleSnapshot) return;
        this._observers.forEach(callback => {
            try {
                callback(this._visibleSnapshot, changeType);
            } catch (error) {
                console.error("LCVDSLayout observer error", error);
            }
        });
    }
}

export default LCVDSLayout;