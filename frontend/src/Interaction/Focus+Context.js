import * as BABYLON from "babylonjs";

// Each share below expresses the relative weight for a *single* focused index.
// Example: rowFocusShare=0.7 means every focused row is allotted weight 0.7,
// while each context row receives minRowContextShare (0.05) before normalization.
const DEFAULT_CONFIG = {
    rowFocusShare: 0.2,
    columnFocusShare: 0.2,
    minRowContextShare: 0.05,
    minColumnContextShare: 0.05
};

export default class FocusPlusContext {
    constructor({ layout, scene, twoTone, heatMap, config = {} } = {}) {
        this.layout = layout;
        this.scene = scene;
        this.twoTone = twoTone;
        this.heatMap = heatMap;
        this.config = { ...DEFAULT_CONFIG, ...config };

        this.focusBlock = null;
        this._latestSnapshot = this.layout?.getVisibleSnapshot() ?? null;

        this._currentStroke = null;
        this._strokeObserver = null;
        this._panObserver = null;
        this._panState = null;

        this._layoutObserver = this.layout?.addObserver(snapshot => {
            this._latestSnapshot = snapshot;
        });
    }

    dispose() {
        this._layoutObserver?.();
        this._layoutObserver = null;
        this._stopStrokeTracking();
        this._stopPanTracking();
    }

    handleTriggerPress(controller) {
        if (!controller) return;
        this._startStrokeTracking(controller);
    }

    handleTriggerRelease() {
        if (!this._currentStroke) {
            return;
        }
        const stroke = this._currentStroke;
        this._stopStrokeTracking();
        this._currentStroke = null;

        const touchedRows = stroke.rowsTouched.size;
        const touchedCols = stroke.colsTouched.size;
        const hasMovement = touchedRows > 0 || touchedCols > 0;

        if (!hasMovement) {
            return;
        }

        this._finalizeLinearSelection(stroke);
    }

    handlePanStart(controller) {
        if (!controller || !this.focusBlock) return;
        const pick = this._pickActivePlane(controller);
        if (!pick || pick.thinInstanceIndex == null) return;
        const indices = this._indicesFromThinInstance(pick.thinInstanceIndex);
        if (!indices) return;
        this._panState = {
            controller,
            anchorRow: indices.globalRow,
            anchorCol: indices.globalCol,
            initialRowStart: this.focusBlock.row?.start ?? null,
            initialColStart: this.focusBlock.col?.start ?? null
        };
        this._startPanTracking();
    }

    handlePanEnd() {
        this._panState = null;
        this._stopPanTracking();
    }

    clearFocus() {
        this.focusBlock = null;
        this.layout?.setRowFocusStrategy(null);
        this.layout?.setColumnFocusStrategy(null);
    }

    _startStrokeTracking(controller) {
        this._stopStrokeTracking();
        this._currentStroke = {
            controller,
            rowsTouched: new Set(),
            colsTouched: new Set(),
            minRow: Infinity,
            maxRow: -Infinity,
            minCol: Infinity,
            maxCol: -Infinity
        };
        if (this.scene) {
            this._strokeObserver = this.scene.onBeforeRenderObservable.add(() => this._sampleStroke());
        }
    }

    _stopStrokeTracking() {
        if (this._strokeObserver && this.scene) {
            this.scene.onBeforeRenderObservable.remove(this._strokeObserver);
        }
        this._strokeObserver = null;
        this._currentStroke = null;
    }

    _startPanTracking() {
        if (!this.scene || !this._panState) return;
        this._stopPanTracking();
        this._panObserver = this.scene.onBeforeRenderObservable.add(() => this._samplePan());
    }

    _stopPanTracking() {
        if (this._panObserver && this.scene) {
            this.scene.onBeforeRenderObservable.remove(this._panObserver);
        }
        this._panObserver = null;
    }

    _sampleStroke() {
        if (!this._currentStroke) return;
        const pick = this._pickActivePlane(this._currentStroke.controller);
        if (!pick || pick.thinInstanceIndex == null) return;
        const indices = this._indicesFromThinInstance(pick.thinInstanceIndex);
        if (!indices) return;
        const stroke = this._currentStroke;
        stroke.rowsTouched.add(indices.localRow);
        stroke.colsTouched.add(indices.localCol);
        stroke.minRow = Math.min(stroke.minRow, indices.localRow);
        stroke.maxRow = Math.max(stroke.maxRow, indices.localRow);
        stroke.minCol = Math.min(stroke.minCol, indices.localCol);
        stroke.maxCol = Math.max(stroke.maxCol, indices.localCol);
    }

    _samplePan() {
        if (!this._panState || !this.focusBlock) return;
        const pick = this._pickActivePlane(this._panState.controller);
        if (!pick || pick.thinInstanceIndex == null) return;
        const indices = this._indicesFromThinInstance(pick.thinInstanceIndex);
        if (!indices) return;
        let changed = false;

        if (this.focusBlock.row && Number.isFinite(indices.globalRow) && Number.isFinite(this._panState.anchorRow)) {
            const deltaRow = indices.globalRow - this._panState.anchorRow;
            if (deltaRow !== 0) {
                const newStart = this._clampRangeStart(
                    this._panState.initialRowStart ?? this.focusBlock.row.start,
                    this.focusBlock.row.count,
                    this.layout.totalRows,
                    deltaRow
                );
                if (newStart !== this.focusBlock.row.start) {
                    this.focusBlock.row.start = newStart;
                    this.focusBlock.row.end = newStart + this.focusBlock.row.count - 1;
                    changed = true;
                }
            }
        }

        if (this.focusBlock.col && Number.isFinite(indices.globalCol) && Number.isFinite(this._panState.anchorCol)) {
            const deltaCol = indices.globalCol - this._panState.anchorCol;
            if (deltaCol !== 0) {
                const newStart = this._clampRangeStart(
                    this._panState.initialColStart ?? this.focusBlock.col.start,
                    this.focusBlock.col.count,
                    this.layout.totalCols,
                    deltaCol
                );
                if (newStart !== this.focusBlock.col.start) {
                    this.focusBlock.col.start = newStart;
                    this.focusBlock.col.end = newStart + this.focusBlock.col.count - 1;
                    changed = true;
                }
            }
        }

        if (changed) {
            this._applyFocusBlock();
        }
    }

    _finalizeLinearSelection(stroke) {
        const snapshot = this._latestSnapshot ?? this.layout?.getVisibleSnapshot();
        if (!snapshot) return;
        const rowSpan = stroke.maxRow - stroke.minRow + 1;
        const colSpan = stroke.maxCol - stroke.minCol + 1;
        if (!Number.isFinite(rowSpan) || !Number.isFinite(colSpan)) return;

        if (rowSpan >= colSpan) {
            const range = this._rangeFromSnapshot(snapshot.rowIndices, stroke.minRow, stroke.maxRow);
            if (!range) return;
            this.focusBlock = {
                row: range,
                col: null
            };
        } else {
            const range = this._rangeFromSnapshot(snapshot.columnIndices, stroke.minCol, stroke.maxCol);
            if (!range) return;
            this.focusBlock = {
                row: null,
                col: range
            };
        }

        this._applyFocusBlock();
    }

    _applyFocusBlock() {
        if (!this.focusBlock) {
            this.layout?.setRowFocusStrategy(null);
            this.layout?.setColumnFocusStrategy(null);
            return;
        }

        if (this.focusBlock.row) {
            this.layout?.setRowFocusStrategy({
                start: this.focusBlock.row.start,
                end: this.focusBlock.row.end,
                focusShare: this._resolveRowShare(),
                minContextShare: this.config.minRowContextShare
            });
        } else {
            this.layout?.setRowFocusStrategy(null);
        }

        if (this.focusBlock.col) {
            this.layout?.setColumnFocusStrategy({
                start: this.focusBlock.col.start,
                end: this.focusBlock.col.end,
                focusShare: this._resolveColumnShare(),
                minContextShare: this.config.minColumnContextShare
            });
        } else {
            this.layout?.setColumnFocusStrategy(null);
        }

        this._ensureBlockVisible();
    }

    _resolveRowShare() {
        return this.config.rowFocusShare;
    }

    _resolveColumnShare() {
        return this.config.columnFocusShare;
    }

    _ensureBlockVisible() {
        if (!this.focusBlock) return;
        const scrollState = this.layout?.getScrollState();
        if (!scrollState) return;

        let targetRowOffset = scrollState.rowOffset;
        let targetColOffset = scrollState.colOffset;

        if (this.focusBlock.row) {
            targetRowOffset = this._ensureAxisVisibility({
                currentOffset: scrollState.rowOffset,
                visibleCount: this.layout.visibleRows,
                totalCount: this.layout.totalRows,
                range: this.focusBlock.row
            });
        }

        if (this.focusBlock.col) {
            targetColOffset = this._ensureAxisVisibility({
                currentOffset: scrollState.colOffset,
                visibleCount: this.layout.visibleCols,
                totalCount: this.layout.totalCols,
                range: this.focusBlock.col
            });
        }

        this.layout?.setScrollOffsets(targetRowOffset, targetColOffset);
    }

    _ensureAxisVisibility({ currentOffset, visibleCount, totalCount, range }) {
        if (!range || !Number.isFinite(range.start) || !Number.isFinite(range.end)) {
            return currentOffset;
        }
        const maxOffset = Math.max(0, totalCount - visibleCount);
        let offset = Math.max(0, Math.min(currentOffset, maxOffset));
        if (range.start < offset) {
            offset = range.start;
        }
        if (range.end >= offset + visibleCount) {
            offset = range.end - visibleCount + 1;
        }
        return Math.max(0, Math.min(offset, maxOffset));
    }

    _pickActivePlane(controller) {
        if (!controller || !this.scene) return null;
        const ray = this._buildForwardRay(controller);
        if (!ray) return null;
        const targetMesh = this._resolveActivePlane();
        if (!targetMesh) return null;
        return this.scene.pickWithRay(ray, mesh => mesh === targetMesh, false);
    }

    _buildForwardRay(controller, length = 100) {
        if (!controller) return null;
        const pointer = controller.pointer || controller.grip || controller;
        if (!pointer?.getAbsolutePosition) return null;
        const origin = pointer.getAbsolutePosition();
        const direction = pointer.forward ? pointer.forward.clone() : BABYLON.Axis.Z.clone();
        direction.normalize();
        return new BABYLON.Ray(origin, direction, length);
    }

    _resolveActivePlane() {
        if (this.twoTone?.basePlane?.isVisible) return this.twoTone.basePlane;
        if (this.heatMap?.basePlane?.isVisible) return this.heatMap.basePlane;
        return this.twoTone?.basePlane ?? this.heatMap?.basePlane ?? null;
    }

    _indicesFromThinInstance(idx) {
        const snapshot = this._latestSnapshot ?? this.layout?.getVisibleSnapshot();
        if (!snapshot || snapshot.colCount <= 0) return null;
        const row = Math.floor(idx / snapshot.colCount);
        const col = idx % snapshot.colCount;
        if (row < 0 || row >= snapshot.rowCount) return null;
        if (col < 0 || col >= snapshot.colCount) return null;
        const globalRow = snapshot.rowIndices?.[row] ?? (this.layout?.scrollRowOffset ?? 0) + row;
        const globalCol = snapshot.columnIndices?.[col] ?? (this.layout?.scrollColOffset ?? 0) + col;
        return {
            localRow: row,
            localCol: col,
            globalRow,
            globalCol
        };
    }

    _rangeFromSnapshot(indices, minIdx, maxIdx) {
        if (!indices || !indices.length) return null;
        const safeMin = Math.max(0, Math.min(indices.length - 1, Math.floor(minIdx)));
        const safeMax = Math.max(0, Math.min(indices.length - 1, Math.floor(maxIdx)));
        const start = Math.min(indices[safeMin], indices[safeMax]);
        const end = Math.max(indices[safeMin], indices[safeMax]);
        if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
        return {
            start,
            end,
            count: Math.max(1, end - start + 1)
        };
    }

    _clampRangeStart(originalStart, count, total, delta) {
        if (!Number.isFinite(originalStart) || !Number.isFinite(count) || !Number.isFinite(total)) {
            return originalStart;
        }
        const candidate = originalStart + delta;
        const maxStart = Math.max(0, total - count);
        if (candidate < 0) return 0;
        if (candidate > maxStart) return maxStart;
        return candidate;
    }

}