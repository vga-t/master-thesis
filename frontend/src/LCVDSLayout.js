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

        // Buffer cache to avoid frequent allocations
        this._buffers = {
            positionMatrix: new Float32Array(0),
            normalizedData: new Float32Array(0),
            rawData: []
        };

        // Precomputed normalized data for entire dataset (computed once)
        this._precomputedNormalizedData = null;
        this._precomputeFullDataset();

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
        this.setFocusStrategies(strategy, this._colFocusStrategy);
    }

    setColumnFocusStrategy(strategy = null) {
        this.setFocusStrategies(this._rowFocusStrategy, strategy);
    }

    setFocusStrategies(rowStrategy, colStrategy) {
        if (Array.isArray(rowStrategy)) {
            this._rowFocusStrategy = rowStrategy.length > 0 ? rowStrategy.map(s => ({ ...s })) : null;
        } else {
            this._rowFocusStrategy = rowStrategy ? { ...rowStrategy } : null;
        }
        this._colFocusStrategy = colStrategy ? { ...colStrategy } : null;
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

    setVisibleViewport(visibleRows, visibleCols, rowOffset = null, colOffset = null) {
        const targetRows = Math.max(1, Math.min(Math.round(visibleRows), this.totalRows));
        const targetCols = Math.max(1, Math.min(Math.round(visibleCols), this.totalCols));

        const viewportChanged = (targetRows !== this.visibleRows || targetCols !== this.visibleCols);

        // If nothing changed and no offsets provided, return
        if (!viewportChanged && rowOffset === null && colOffset === null) {
            return false;
        }

        this.visibleRows = targetRows;
        this.visibleCols = targetCols;

        // Recalculate cell dimensions based on new viewport
        this.cellWidth = this.visibleCols > 0 ? this.arcLength / this.visibleCols : 0;
        this.cellHeight = this.visibleRows > 0 ? this.height / this.visibleRows : 0;

        // Clamp scroll offsets
        const rowMax = Math.max(0, this.totalRows - this.visibleRows);
        const colMax = Math.max(0, this.totalCols - this.visibleCols);

        let newRowOffset = this.scrollRowOffset;
        let newColOffset = this.scrollColOffset;

        if (rowOffset !== null) {
            newRowOffset = Math.max(0, Math.min(rowOffset, rowMax));
        } else {
            newRowOffset = Math.min(newRowOffset, rowMax);
        }

        if (colOffset !== null) {
            newColOffset = Math.max(0, Math.min(colOffset, colMax));
        } else {
            newColOffset = Math.min(newColOffset, colMax);
        }

        const offsetsChanged = (newRowOffset !== this.scrollRowOffset || newColOffset !== this.scrollColOffset);

        this.scrollRowOffset = newRowOffset;
        this.scrollColOffset = newColOffset;

        if (viewportChanged) {
            // Notify observers about the cell dimension change
            this._notifyObservers("cell_size_changed");
            // Full update
            this._updateGeometry();
            this._updateData({ changeType: "geometry_and_data" });
        } else if (offsetsChanged) {
            // Just data update if only offsets changed (and geometry didn't need resize)
            // But wait, scrolling changes geometry too because of focus+context (weights depend on indices)
            // So we usually need geometry update on scroll too if focus+context is active.
            // However, the original code only called _updateData on scroll. 
            // Let's check _updateGeometry: it uses scrollRowOffset/scrollColOffset to determine indices.
            // So yes, geometry MUST be updated on scroll if we want focus+context to work correctly with scrolling.
            // But the original code: setScrollOffsets -> _updateData({ changeType: "data_only" })
            // Wait, if I scroll, the indices change. _updateData recalculates normalizedData based on indices.
            // But _updateGeometry calculates positions based on indices.
            // If I scroll, the positions of the cells (the grid) might stay the same in "uniform" mode, 
            // but in "focus+context" mode, the grid distorts based on WHICH rows are visible.
            // So _updateGeometry IS needed on scroll for Focus+Context.
            // The original code might have been optimized for uniform grid where geometry is static relative to the container?
            // No, _updateGeometry uses this.scrollRowOffset.

            // Let's stick to the safe side: update geometry if offsets change.
            // But to keep original behavior if it was intentional:
            // Original setScrollOffsets called _updateData("data_only").
            // _updateData uses scrollRowOffset.
            // _updateGeometry uses scrollRowOffset.
            // If we don't call _updateGeometry, the positions won't update.
            // If the grid is uniform, positions are just a grid. 
            // If we scroll, the data shifts through the grid.
            // So "data_only" implies the grid mesh stays static, and we just swap the colors/values on it.
            // This is correct for uniform grids.
            // For Focus+Context, the grid SHAPE depends on the row indices (if focus is absolute to data indices).
            // If focus is relative to viewport (e.g. "center of screen"), then grid is static.
            // LCVDSLayout _buildAxisWeights uses indices: `indices.map(...)`.
            // And indices depend on scrollOffset.
            // So if focus is attached to specific data rows (data-driven focus), geometry changes on scroll.
            // If focus is attached to screen coordinates (lens), geometry is static (relative to scroll).
            // The current implementation: `focusFlags = indices.map(...)`.
            // `focusStrategy.start` / `end` seem to be data indices.
            // So geometry DOES change on scroll if focus is active.

            // Optimization: Check if focus is active.
            const hasFocus = this._rowFocusStrategy || this._colFocusStrategy;
            if (hasFocus) {
                this._updateGeometry();
                this._updateData({ changeType: "geometry_and_data" });
            } else {
                this._updateData({ changeType: "data_only" });
            }
        }

        return true;
    }

    /**
     * Update layout parameters (arc angle, radius, height) dynamically.
     * This is optimized to avoid full reconstruction of the visualization.
     * @param {Object} params - { arcAngle?, radius?, height? } - arcAngle in radians
     * @returns {boolean} - true if any parameter changed
     */
    setLayoutParameters({ arcAngle, radius, height }) {
        let changed = false;

        if (arcAngle !== undefined && arcAngle !== this.arcAngle) {
            this.arcAngle = arcAngle;
            changed = true;
        }

        if (radius !== undefined && radius !== this.radius) {
            this.radius = radius;
            changed = true;
        }

        if (height !== undefined && height !== this.height) {
            this.height = height;
            changed = true;
        }

        if (!changed) return false;

        // Recalculate derived values
        this.arcLength = this.radius * this.arcAngle;
        this.cellWidth = this.visibleCols > 0 ? this.arcLength / this.visibleCols : 0;
        this.cellHeight = this.visibleRows > 0 ? this.height / this.visibleRows : 0;

        // Update visible snapshot with new values
        if (this._visibleSnapshot) {
            this._visibleSnapshot.cellWidth = this.cellWidth;
            this._visibleSnapshot.cellHeight = this.cellHeight;
            this._visibleSnapshot.arcAngle = this.arcAngle;
            this._visibleSnapshot.arcLength = this.arcLength;
        }

        // Full geometry and data update
        this._updateGeometry();
        this._updateData({ changeType: "geometry_and_data" });

        return true;
    }

    /**
     * Get current layout parameters
     * @returns {Object} - { arcAngle, radius, height, arcLength }
     */
    getLayoutParameters() {
        return {
            arcAngle: this.arcAngle,
            radius: this.radius,
            height: this.height,
            arcLength: this.arcLength
        };
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

    /**
     * Precompute normalized data for the entire dataset.
     * This is called once during initialization and allows fast slicing during scroll.
     */
    _precomputeFullDataset() {
        if (!this.totalRows || !this.totalCols || !this.csvData.length) {
            this._precomputedNormalizedData = null;
            return;
        }

        const totalSize = this.totalRows * this.totalCols;
        this._precomputedNormalizedData = new Float32Array(totalSize);

        // Pre-cache normalizers for all columns
        const normalizers = this.columnKeys.map(key => this.columnMetadata[key]?.normalize);

        let dataIndex = 0;
        for (let r = 0; r < this.totalRows; r++) {
            const rowData = this.csvData[r] ?? {};
            for (let c = 0; c < this.totalCols; c++) {
                const key = this.columnKeys[c];
                const originalValue = rowData[key];
                const normalizer = normalizers[c];
                let normalizedValue = 0;
                if (normalizer) {
                    const val = normalizer(originalValue);
                    normalizedValue = Number.isFinite(val) ? val : 0;
                }
                this._precomputedNormalizedData[dataIndex++] = normalizedValue;
            }
        }
    }

    /**
     * Get precomputed normalized data for the entire dataset.
     * Returns null if not available.
     */
    getPrecomputedNormalizedData() {
        return this._precomputedNormalizedData;
    }

    _updateGeometry() {
        if (!this.totalRows || !this.totalCols) {
            // ... (reset snapshot)
            return;
        }

        const rowCount = Math.min(this.visibleRows, this.totalRows);
        const colCount = Math.min(this.visibleCols, this.totalCols);
        const requiredSize = rowCount * colCount * 16;

        // Reuse buffer if possible
        if (this._buffers.positionMatrix.length < requiredSize) {
            this._buffers.positionMatrix = new Float32Array(requiredSize);
        }
        const matrix = this._buffers.positionMatrix.subarray(0, requiredSize);

        const rowIndices = Array.from({ length: rowCount }, (_, idx) => this.scrollRowOffset + idx);
        const columnIndices = Array.from({ length: colCount }, (_, idx) => this.scrollColOffset + idx);

        const rowWeightInfo = this._buildAxisWeights({
            indices: rowIndices,
            focusStrategy: this._rowFocusStrategy,
            totalSpan: this.height,
            baseSpan: rowCount > 0 ? this.height / rowCount : this.height,
            minContextShare: (Array.isArray(this._rowFocusStrategy)
                ? this._rowFocusStrategy[0]?.minContextShare
                : this._rowFocusStrategy?.minContextShare) ?? 0.05
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
            const sy = rowWeightInfo.scaleFactors[r] ?? 1;

            for (let c = 0; c < colCount; c++) {
                const angle = colAngles[c] ?? startAngle;
                const sx = colWeightInfo.scaleFactors[c] ?? 1;

                const sinA = Math.sin(angle);
                const cosA = Math.cos(angle);

                const x = this.radius * sinA;
                const z = this.radius * cosA - this.radius;

                // Manual matrix construction: Scale * RotationY * Translation
                // Row-major storage for Babylon (but math is usually column-vector P' = M*P? No, Babylon is P' = P*M)
                // If P' = P * M, then M = S * R * T

                // Row 0
                matrix[matrixOffset + 0] = sx * cosA;
                matrix[matrixOffset + 1] = 0;
                matrix[matrixOffset + 2] = sx * -sinA; // Babylon Left-Handed Y-rotation
                matrix[matrixOffset + 3] = 0;

                // Row 1
                matrix[matrixOffset + 4] = 0;
                matrix[matrixOffset + 5] = sy;
                matrix[matrixOffset + 6] = 0;
                matrix[matrixOffset + 7] = 0;

                // Row 2
                matrix[matrixOffset + 8] = sinA;
                matrix[matrixOffset + 9] = 0;
                matrix[matrixOffset + 10] = cosA;
                matrix[matrixOffset + 11] = 0;

                // Row 3 (Translation)
                matrix[matrixOffset + 12] = x;
                matrix[matrixOffset + 13] = y;
                matrix[matrixOffset + 14] = z;
                matrix[matrixOffset + 15] = 1;

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

        this._updateCollisionSurface();
    }

    createCollisionSurface(scene) {
        this._collisionScene = scene;
        this._collisionKey = null;
        this._collisionMesh = null;
        this._updateCollisionSurface();
    }

    _updateCollisionSurface() {
        if (!this._collisionScene) return;
        const key = `${this.radius}_${this.arcAngle}_${this.height}_${this.groundOffset}`;
        if (key === this._collisionKey) return;
        this._collisionKey = key;

        if (this._collisionMesh) this._collisionMesh.dispose();

        const R = this.radius - 0.001;
        const half = this.arcAngle / 2;
        const segments = 64;
        const top = [], bottom = [];
        for (let i = 0; i <= segments; i++) {
            const a = -half + this.arcAngle * i / segments;
            const x = R * Math.sin(a);
            const z = R * Math.cos(a) - this.radius;
            top.push(new BABYLON.Vector3(x, this.groundOffset + this.height, z));
            bottom.push(new BABYLON.Vector3(x, this.groundOffset, z));
        }
        this._collisionMesh = BABYLON.MeshBuilder.CreateRibbon(
            "lcvdsCollision", { pathArray: [top, bottom], sideOrientation: BABYLON.Mesh.DOUBLESIDE },
            this._collisionScene
        );
        this._collisionMesh.visibility = 0;
        this._collisionMesh.isPickable = true;
    }

    _updateData({ changeType = "data_only" } = {}) {
        if (!this._visibleSnapshot) return;

        const rowCount = this._visibleSnapshot.rowCount ?? 0;
        const colCount = this._visibleSnapshot.colCount ?? 0;

        if (!this.totalRows || !this.totalCols || rowCount === 0 || colCount === 0) {
            // ... (reset snapshot)
            this._notifyObservers("geometry_and_data");
            return;
        }

        const requiredSize = rowCount * colCount;
        if (this._buffers.normalizedData.length < requiredSize) {
            this._buffers.normalizedData = new Float32Array(requiredSize);
        }
        // rawData is Array, not TypedArray, so we just resize or clear
        if (this._buffers.rawData.length < requiredSize) {
            this._buffers.rawData = new Array(requiredSize);
        }

        const normalizedData = this._buffers.normalizedData.subarray(0, requiredSize);
        const rawData = this._buffers.rawData; // We'll just use indices up to requiredSize

        const rowIndices = [];
        const columnIndices = [];

        // Pre-calculate active column keys and normalizers to avoid repeated lookups
        const activeKeys = [];
        const activeNormalizers = [];
        for (let c = 0; c < colCount; c++) {
            const globalCol = this.scrollColOffset + c;
            const key = this.columnKeys[globalCol];
            activeKeys.push(key);
            activeNormalizers.push(this.columnMetadata[key]?.normalize);
            columnIndices.push(globalCol);
        }
        const columnKeys = activeKeys; // Reuse the array we just built

        for (let r = 0; r < rowCount; r++) {
            rowIndices.push(this.scrollRowOffset + r);
        }

        let dataIndex = 0;
        for (let r = 0; r < rowCount; r++) {
            const globalRow = this.scrollRowOffset + r;
            const rowData = this.csvData[globalRow] ?? {};

            for (let c = 0; c < colCount; c++) {
                const originalValue = rowData[activeKeys[c]];
                const normalizer = activeNormalizers[c];

                // Inline normalization check
                const normalizedValue = normalizer ? (Number.isFinite(val = normalizer(originalValue)) ? val : 0) : 0;
                var val; // Hoisted var for the inline check

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
            rawData // Note: rawData might contain stale data beyond requiredSize, but consumers should use rowCount*colCount
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

        // Normalize to array of strategies
        const strategies = !focusStrategy ? [] :
            Array.isArray(focusStrategy) ? focusStrategy : [focusStrategy];

        if (strategies.length === 0) {
            const normalizedWeight = 1 / count;
            const normalized = new Array(count).fill(normalizedWeight);
            const spans = normalized.map(weight => weight * totalSpan);
            const scaleFactors = spans.map(span => {
                if (!Number.isFinite(baseSpan) || baseSpan === 0) return 1;
                return span / baseSpan;
            });
            return { normalized, spans, scaleFactors };
        }

        const focusWeight = this._sanitizeWeight(strategies[0]?.focusShare, 0.65);
        const contextWeight = this._sanitizeWeight(
            typeof strategies[0]?.contextShare === "number" ? strategies[0].contextShare : minContextShare,
            minContextShare
        );

        const focusFlags = indices.map(idx => {
            return strategies.some(s => {
                const start = s.start ?? s.focusStart;
                const end = s.end ?? s.focusEnd;
                return start != null && end != null && idx >= start && idx <= end;
            });
        });
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

    /**
     * Fast O(1) ray picking for the LCVDS cylindrical surface.
     * Instead of checking every thin instance, this uses mathematical
     * ray-cylinder intersection to find which cell is hit.
     * 
     * @param {BABYLON.Ray} ray - The ray to test (from controller)
     * @returns {Object|null} - { localRow, localCol, globalRow, globalCol, hitPoint, distance } or null if no hit
     */
    pickCellFromRay(ray) {
        if (!ray || !this._visibleSnapshot) return null;

        const snapshot = this._visibleSnapshot;
        const { rowCount, colCount, rowIndices, columnIndices } = snapshot;
        if (rowCount <= 0 || colCount <= 0) return null;

        // Cylinder parameters:
        // Center axis runs vertically at (0, y, -radius)
        // Cylinder has radius = this.radius
        // The LCVDS is the inner surface facing the user

        const cylinderCenterX = 0;
        const cylinderCenterZ = -this.radius;
        const R = this.radius;

        // Ray: P(t) = origin + t * direction
        const ox = ray.origin.x;
        const oy = ray.origin.y;
        const oz = ray.origin.z;
        const dx = ray.direction.x;
        const dy = ray.direction.y;
        const dz = ray.direction.z;

        // Transform to cylinder's local XZ (centered at cylinder axis)
        const localOx = ox - cylinderCenterX;
        const localOz = oz - cylinderCenterZ;

        // Quadratic equation for ray-cylinder intersection (infinite cylinder along Y):
        // (localOx + t*dx)^2 + (localOz + t*dz)^2 = R^2
        // Expanding: (dx^2 + dz^2)*t^2 + 2*(localOx*dx + localOz*dz)*t + (localOx^2 + localOz^2 - R^2) = 0
        const a = dx * dx + dz * dz;
        const b = 2 * (localOx * dx + localOz * dz);
        const c = localOx * localOx + localOz * localOz - R * R;

        // Handle degenerate case (ray parallel to cylinder axis)
        if (Math.abs(a) < 1e-10) return null;

        const discriminant = b * b - 4 * a * c;
        if (discriminant < 0) return null; // No intersection

        const sqrtDisc = Math.sqrt(discriminant);
        const t1 = (-b - sqrtDisc) / (2 * a);
        const t2 = (-b + sqrtDisc) / (2 * a);

        // We want the inner surface (user is inside or outside looking at concave side)
        // For LCVDS, user is typically in front (z > -radius) looking at the curved display
        // t2 is the farther hit (going through the cylinder)
        // t1 is the closer hit
        // We want the hit where the normal points toward the user (concave surface)

        let t = null;
        // Check both intersections, prefer the one that hits the visible arc range
        for (const candidate of [t1, t2]) {
            if (candidate < 0.001) continue; // Behind the ray origin
            if (candidate > ray.length) continue; // Beyond ray length

            const hitX = ox + candidate * dx;
            const hitY = oy + candidate * dy;
            const hitZ = oz + candidate * dz;

            // Check if within height range
            if (hitY < this.groundOffset || hitY > this.groundOffset + this.height) continue;

            // Check if within arc angle range
            // Angle from center of cylinder to hit point (in XZ plane)
            const relX = hitX - cylinderCenterX;
            const relZ = hitZ - cylinderCenterZ;
            const angle = Math.atan2(relX, relZ); // atan2(x, z) for angle from +Z axis

            const halfArc = this.arcAngle / 2;
            if (angle < -halfArc || angle > halfArc) continue;

            t = candidate;
            break;
        }

        if (t === null) return null;

        // Calculate hit point
        const hitX = ox + t * dx;
        const hitY = oy + t * dy;
        const hitZ = oz + t * dz;
        const hitPoint = new BABYLON.Vector3(hitX, hitY, hitZ);

        // Convert hit point to row/col indices
        const relX = hitX - cylinderCenterX;
        const relZ = hitZ - cylinderCenterZ;
        const hitAngle = Math.atan2(relX, relZ);

        // Map angle to column index
        // startAngle = -arcAngle/2, angles go from left to right
        const halfArc = this.arcAngle / 2;
        const normalizedAngle = (hitAngle + halfArc) / this.arcAngle; // 0 to 1

        // Account for focus+context column spacing if weights are available
        let localCol;
        if (snapshot.colWeights && snapshot.colWeights.length === colCount) {
            // Use cumulative weights to find column
            let cumWeight = 0;
            localCol = colCount - 1;
            for (let c = 0; c < colCount; c++) {
                cumWeight += snapshot.colWeights[c];
                if (normalizedAngle <= cumWeight) {
                    localCol = c;
                    break;
                }
            }
        } else {
            localCol = Math.floor(normalizedAngle * colCount);
        }
        localCol = Math.max(0, Math.min(localCol, colCount - 1));

        // Map height to row index (top is row 0)
        const relHeight = hitY - this.groundOffset;
        const normalizedHeight = 1 - (relHeight / this.height); // Invert: top is row 0

        // Account for focus+context row spacing if weights are available
        let localRow;
        if (snapshot.rowWeights && snapshot.rowWeights.length === rowCount) {
            // Use cumulative weights to find row
            let cumWeight = 0;
            localRow = rowCount - 1;
            for (let r = 0; r < rowCount; r++) {
                cumWeight += snapshot.rowWeights[r];
                if (normalizedHeight <= cumWeight) {
                    localRow = r;
                    break;
                }
            }
        } else {
            localRow = Math.floor(normalizedHeight * rowCount);
        }
        localRow = Math.max(0, Math.min(localRow, rowCount - 1));

        const globalRow = rowIndices?.[localRow] ?? (this.scrollRowOffset + localRow);
        const globalCol = columnIndices?.[localCol] ?? (this.scrollColOffset + localCol);

        return {
            localRow,
            localCol,
            globalRow,
            globalCol,
            hitPoint,
            distance: t
        };
    }
}

export default LCVDSLayout;