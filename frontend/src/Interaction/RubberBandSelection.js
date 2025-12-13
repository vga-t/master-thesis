import * as BABYLON from "babylonjs";
import EmbeddedParallelCoordinates from "../Visualization/EmbeddedParallelCoordinates.js";

const DOUBLE_EPSILON = 1e-5;
const FILL_OFFSET = 0.004;

const CORNER_LUT = {
    topLeft: new BABYLON.Vector3(-0.5, 0.5, 0),
    topRight: new BABYLON.Vector3(0.5, 0.5, 0),
    bottomRight: new BABYLON.Vector3(0.5, -0.5, 0),
    bottomLeft: new BABYLON.Vector3(-0.5, -0.5, 0)
};

export default class RubberBandSelection {
    constructor({ scene, layout, camera, getActivePlane, heatMap = null, twoTone = null } = {}) {
        this.scene = scene;
        this.layout = layout;
        this._cameraProvider = typeof camera === "function" ? camera : () => (camera ?? this.scene?.activeCamera ?? null);
        this._getActivePlane = typeof getActivePlane === "function" ? getActivePlane : () => null;

        // Store references to visualizations for cell hiding
        this._heatMap = heatMap;
        this._twoTone = twoTone;

        // Support for multiple parallel coordinate plots
        this._embeddedPCPs = []; // Array of EmbeddedParallelCoordinates instances
        this._activePCPIndex = -1; // Currently active PCP for resize operations
        this._allHiddenCellIndices = new Set(); // Combined hidden cells from all PCPs

        this._latestSnapshot = this.layout?.getVisibleSnapshot() ?? null;
        this._layoutObserver = this.layout?.addObserver(snapshot => {
            this._latestSnapshot = snapshot;
            if (!snapshot || !this._activeSelection) return;
            this._applyPreview(this._activeSelection, { force: true });
        });

        this._fillMesh = null;
        this._outlineMesh = null;
        this._fillPointCount = 0;
        this._fillMaterial = null;
        this._tempMatrix = new BABYLON.Matrix();

        this._dragState = null;
        this._activeSelection = null;
        this._renderObserver = null;
        this._resizeState = null; // For resize handle dragging
        this._lastPreviewHash = null;
    }

    /**
     * Set visualization references (call this if they weren't available at construction)
     */
    setVisualizations(heatMap, twoTone) {
        this._heatMap = heatMap;
        this._twoTone = twoTone;
    }

    beginDrag(controller) {
        if (!controller || this._dragState) return false;

        // First check if clicking on a resize handle from any PCP
        if (this._embeddedPCPs.length > 0) {
            const ray = this._buildForwardRay(controller);
            if (ray) {
                const pickInfo = this.scene.pickWithRay(ray, mesh => {
                    return mesh?.metadata?.embeddedPCPHandle === true;
                }, false);

                if (pickInfo?.hit && pickInfo.pickedMesh) {
                    // Find which PCP owns this handle
                    for (let i = 0; i < this._embeddedPCPs.length; i++) {
                        const pcp = this._embeddedPCPs[i];
                        const handleId = pcp.getResizeHandleId(pickInfo.pickedMesh);
                        if (handleId && pickInfo.pickedPoint) {
                            this._activePCPIndex = i;
                            this._resizeState = {
                                controller,
                                handleId,
                                startPoint: pickInfo.pickedPoint.clone()
                            };
                            pcp.beginResize(handleId, pickInfo.pickedPoint);
                            this._ensureResizeObserver();
                            return true;
                        }
                    }
                }
            }
        }

        const pick = this._pickActivePlane(controller);
        if (!pick || pick.thinInstanceIndex == null) return false;
        const indices = this._indicesFromThinInstance(pick.thinInstanceIndex);
        if (!indices) return false;

        this._dragState = {
            controller,
            startIndices: indices,
            lastIndices: indices
        };
        this._ensureRenderObserver();
        const selection = this._computeSelection(indices, indices);
        this._applyPreview(selection, { force: true });
        return true;
    }

    endDrag() {
        // Handle resize end
        if (this._resizeState) {
            if (this._activePCPIndex >= 0 && this._activePCPIndex < this._embeddedPCPs.length) {
                this._embeddedPCPs[this._activePCPIndex].endResize();
            }
            this._clearResizeObserver();
            this._resizeState = null;
            this._activePCPIndex = -1;
            return;
        }

        if (!this._dragState) return;
        const finalSelection = this._computeSelection(this._dragState.startIndices, this._dragState.lastIndices);
        this._clearRenderObserver();
        this._dragState = null;

        if (!finalSelection) {
            this._applyPreview(null, { force: true });
            return;
        }

        // Clear the preview immediately before showing embedded visualization
        // This prevents the blue tint from appearing when the embedded visualization replaces it
        this._applyPreview(null, { force: true });
        this._activeSelection = null;
        this._showEmbeddedVisualization(finalSelection);
    }

    cancelDrag() {
        this._clearRenderObserver();
        this._clearResizeObserver();
        this._dragState = null;
        this._resizeState = null;
        this._activePCPIndex = -1;
        this._applyPreview(null, { force: true });
    }

    /**
     * Clear all parallel coordinate plots and restore cell visibility
     */
    clearAllPCPs() {
        for (const pcp of this._embeddedPCPs) {
            pcp.dispose();
        }
        this._embeddedPCPs = [];
        this._activePCPIndex = -1;
        this._allHiddenCellIndices.clear();
        this._clearCellVisibility();
    }

    reset() {
        this._activeSelection = null;
        this._dragState = null;
        this._resizeState = null;
        this._activePCPIndex = -1;
        this._clearRenderObserver();
        this._clearResizeObserver();
        this._applyPreview(null, { force: true });
        // Note: reset() doesn't clear PCPs - use clearAllPCPs() for that
    }

    dispose() {
        this.clearAllPCPs();
        this._layoutObserver?.();
        this._layoutObserver = null;
        this._fillMesh?.dispose();
        this._fillMesh = null;
        this._fillMaterial?.dispose?.();
        this._fillMaterial = null;
        this._outlineMesh?.dispose();
        this._outlineMesh = null;
    }

    /**
     * Get all embedded parallel coordinates instances
     */
    getEmbeddedVisualizations() {
        return this._embeddedPCPs;
    }

    /**
     * Update combined cell visibility from all PCPs
     */
    _updateAllHiddenCells() {
        this._allHiddenCellIndices.clear();
        for (const pcp of this._embeddedPCPs) {
            const hidden = pcp.getHiddenCellIndices();
            for (const idx of hidden) {
                this._allHiddenCellIndices.add(idx);
            }
        }
        this._updateCellVisibility(this._allHiddenCellIndices);
    }

    /**
     * Update cell visibility on HeatMap and TwoTone visualizations
     */
    _updateCellVisibility(hiddenIndices) {
        if (this._heatMap) {
            this._heatMap.setHiddenCells(hiddenIndices);
        }
        if (this._twoTone) {
            this._twoTone.setHiddenCells(hiddenIndices);
        }
    }

    /**
     * Clear all hidden cells (restore visibility)
     */
    _clearCellVisibility() {
        if (this._heatMap) {
            this._heatMap.clearHiddenCells();
        }
        if (this._twoTone) {
            this._twoTone.clearHiddenCells();
        }
    }

    _ensureRenderObserver() {
        if (this._renderObserver || !this.scene) {
            return;
        }
        this._renderObserver = this.scene.onBeforeRenderObservable.add(() => {
            if (!this._dragState) return;
            const pick = this._pickActivePlane(this._dragState.controller);
            if (!pick || pick.thinInstanceIndex == null) return;
            const indices = this._indicesFromThinInstance(pick.thinInstanceIndex);
            if (!indices) return;
            this._dragState.lastIndices = indices;
            const selection = this._computeSelection(this._dragState.startIndices, indices);
            this._applyPreview(selection);
        });
    }

    _clearRenderObserver() {
        if (this._renderObserver && this.scene) {
            this.scene.onBeforeRenderObservable.remove(this._renderObserver);
        }
        this._renderObserver = null;
    }

    /**
     * Observer for resize handle dragging
     */
    _ensureResizeObserver() {
        if (this._resizeObserver || !this.scene) return;

        this._resizeObserver = this.scene.onBeforeRenderObservable.add(() => {
            if (!this._resizeState || this._activePCPIndex < 0) return;
            if (this._activePCPIndex >= this._embeddedPCPs.length) return;

            const pcp = this._embeddedPCPs[this._activePCPIndex];
            if (!pcp) return;

            const ray = this._buildForwardRay(this._resizeState.controller);
            if (!ray) return;

            // Use the PCP's selection geometry for the plane
            const selection = pcp._selection;
            if (!selection?.geometry) return;

            const { normal, center } = selection.geometry;
            const plane = BABYLON.Plane.FromPositionAndNormal(center, normal);
            const distance = ray.intersectsPlane(plane);

            if (distance !== null && distance > 0) {
                const hitPoint = ray.origin.add(ray.direction.scale(distance));
                pcp.updateResize(hitPoint);
                this._updateAllHiddenCells();
            }
        });
    }

    _clearResizeObserver() {
        if (this._resizeObserver && this.scene) {
            this.scene.onBeforeRenderObservable.remove(this._resizeObserver);
        }
        this._resizeObserver = null;
    }

    /**
     * Fast O(1) mathematical picking using layout geometry.
     * Falls back to thin instance picking if layout method unavailable.
     */
    _pickActivePlane(controller) {
        if (!controller || !this.scene) return null;
        const ray = this._buildForwardRay(controller);
        if (!ray) return null;

        // Try fast mathematical picking first (O(1))
        if (this.layout?.pickCellFromRay) {
            const mathResult = this.layout.pickCellFromRay(ray);
            if (mathResult) {
                // Return a compatible object with thinInstanceIndex computed from row/col
                const snapshot = this._latestSnapshot ?? this.layout?.getVisibleSnapshot();
                if (snapshot && snapshot.colCount > 0) {
                    const thinInstanceIndex = mathResult.localRow * snapshot.colCount + mathResult.localCol;
                    return {
                        hit: true,
                        pickedPoint: mathResult.hitPoint,
                        distance: mathResult.distance,
                        thinInstanceIndex,
                        ray,
                        _mathPick: mathResult // Store original for direct access
                    };
                }
            }
        }

        // Fallback to thin instance picking (O(n)) if math picking fails
        const targetMesh = this._getActivePlane?.();
        if (!targetMesh) return null;
        return this.scene.pickWithRay(ray, mesh => mesh === targetMesh, false);
    }

    _buildForwardRay(controller, length = 200) {
        const pointer = controller?.pointer || controller?.grip || controller;
        if (!pointer?.getAbsolutePosition) return null;
        const origin = pointer.getAbsolutePosition();
        let direction = null;

        if (typeof pointer.getDirection === "function") {
            try {
                direction = pointer.getDirection(BABYLON.Axis.Z).clone();
            } catch (_) {
                direction = null;
            }
        }
        if (!direction && pointer.forward) {
            direction = pointer.forward.clone();
        }
        if (!direction && typeof pointer.getWorldMatrix === "function") {
            const world = pointer.getWorldMatrix();
            if (world) {
                direction = BABYLON.Vector3.TransformNormal(BABYLON.Axis.Z, world);
            }
        }
        if (!direction && pointer.absoluteRotationQuaternion) {
            direction = BABYLON.Vector3.TransformNormal(
                BABYLON.Axis.Z,
                BABYLON.Matrix.FromQuaternion(pointer.absoluteRotationQuaternion)
            );
        }
        if (!direction) {
            direction = this.scene?.activeCamera?.getDirection(BABYLON.Axis.Z)?.clone() ?? BABYLON.Axis.Z.clone();
        }
        if (direction.lengthSquared() <= DOUBLE_EPSILON) {
            direction = BABYLON.Axis.Z.clone();
        }
        direction.normalize();
        return new BABYLON.Ray(origin, direction, length);
    }

    _indicesFromThinInstance(idx) {
        const snapshot = this._latestSnapshot;
        if (!snapshot || snapshot.colCount <= 0 || snapshot.rowCount <= 0) return null;
        const row = Math.floor(idx / snapshot.colCount);
        const col = idx % snapshot.colCount;
        if (row < 0 || row >= snapshot.rowCount || col < 0 || col >= snapshot.colCount) return null;
        const globalRow = snapshot.rowIndices?.[row];
        const globalCol = snapshot.columnIndices?.[col];
        if (globalRow == null || globalCol == null) return null;
        return {
            localRow: row,
            localCol: col,
            globalRow,
            globalCol
        };
    }

    _computeSelection(startIndices, endIndices) {
        if (!startIndices || !endIndices || !this._latestSnapshot) {
            return null;
        }

        const snapshot = this._latestSnapshot;
        const rowCount = snapshot.rowCount ?? 0;
        const colCount = snapshot.colCount ?? 0;
        if (rowCount <= 0 || colCount <= 0) return null;

        const rowBounds = this._computeAxisBounds(startIndices.localRow, endIndices.localRow, rowCount);
        const colBounds = this._computeAxisBounds(startIndices.localCol, endIndices.localCol, colCount);

        const rowRange = this._buildRangeFromBounds(rowBounds.localStart, rowBounds.localEnd, snapshot.rowIndices);
        const colRange = this._buildRangeFromBounds(colBounds.localStart, colBounds.localEnd, snapshot.columnIndices);
        if (!rowRange || !colRange) return null;

        const geometry = this._buildSelectionGeometry(rowRange, colRange);
        if (!geometry) return null;

        return {
            rowRange,
            colRange,
            geometry,
            anchor: geometry.center ?? null
        };
    }

    _buildSelectionGeometry(rowRange, colRange) {
        const snapshot = this._latestSnapshot;
        if (!snapshot) return null;
        const rowStart = rowRange.localStart;
        const rowEnd = rowRange.localEnd;
        const colStart = colRange.localStart;
        const colEnd = colRange.localEnd;

        const topEdge = this._buildEdgePath(rowStart, colStart, colEnd, true);
        const bottomEdge = this._buildEdgePath(rowEnd, colStart, colEnd, false);
        if (!topEdge?.length || !bottomEdge?.length) return null;

        const corners = {
            topLeft: this._getCorner(rowStart, colStart, "topLeft"),
            topRight: this._getCorner(rowStart, colEnd, "topRight"),
            bottomRight: this._getCorner(rowEnd, colEnd, "bottomRight"),
            bottomLeft: this._getCorner(rowEnd, colStart, "bottomLeft")
        };
        if (!corners.topLeft || !corners.topRight || !corners.bottomLeft || !corners.bottomRight) {
            return null;
        }

        const widthVec = corners.topRight.subtract(corners.topLeft);
        const heightVec = corners.bottomLeft.subtract(corners.topLeft);
        const normal = BABYLON.Vector3.Cross(widthVec, heightVec);
        if (normal.lengthSquared() <= DOUBLE_EPSILON) {
            return null;
        }
        normal.normalize();
        const center = corners.topLeft.add(widthVec.scale(0.5)).add(heightVec.scale(0.5));

        return {
            topEdge,
            bottomEdge,
            corners,
            widthVec,
            heightVec,
            normal,
            center
        };
    }

    _buildEdgePath(row, colStart, colEnd, isTop) {
        const points = [];
        for (let col = colStart; col <= colEnd; col++) {
            const leftCorner = this._getCorner(row, col, isTop ? "topLeft" : "bottomLeft");
            const rightCorner = this._getCorner(row, col, isTop ? "topRight" : "bottomRight");
            if (col === colStart && leftCorner) {
                points.push(leftCorner);
            }
            if (rightCorner) {
                points.push(rightCorner);
            }
        }
        return points;
    }

    _getCorner(localRow, localCol, cornerKey) {
        const snapshot = this._latestSnapshot;
        if (!snapshot) return null;
        if (localRow < 0 || localRow >= snapshot.rowCount || localCol < 0 || localCol >= snapshot.colCount) {
            return null;
        }
        const thinIndex = localRow * snapshot.colCount + localCol;
        const matrixOffset = thinIndex * 16;
        BABYLON.Matrix.FromArrayToRef(snapshot.positionMatrix, matrixOffset, this._tempMatrix);
        const sign = CORNER_LUT[cornerKey];
        if (!sign) return null;
        const halfW = (snapshot.cellWidth ?? 1) / 2;
        const halfH = (snapshot.cellHeight ?? 1) / 2;
        const localCorner = new BABYLON.Vector3(
            sign.x > 0 ? halfW : -halfW,
            sign.y > 0 ? halfH : -halfH,
            0
        );
        return BABYLON.Vector3.TransformCoordinates(localCorner, this._tempMatrix);
    }

    _applyPreview(selection, { force = false } = {}) {
        if (!selection) {
            this._disableFill();
            if (this._outlineMesh) {
                this._outlineMesh.setEnabled(false);
            }
            this._lastPreviewHash = null;
            return;
        }

        const geometry = selection.geometry;
        if (!geometry) {
            this._disableFill();
            if (this._outlineMesh) {
                this._outlineMesh.setEnabled(false);
            }
            this._lastPreviewHash = null;
            return;
        }

        const hash = `${selection.rowRange.localStart}:${selection.rowRange.localEnd}:${selection.colRange.localStart}:${selection.colRange.localEnd}`;
        if (!force && this._lastPreviewHash === hash) {
            return;
        }
        this._lastPreviewHash = hash;

        this._updateFillGeometry(geometry);
        this._updateOutline(geometry);
    }

    _updateOutline(geometry) {
        if (!geometry?.topEdge?.length || !geometry.bottomEdge?.length) {
            if (this._outlineMesh) {
                this._outlineMesh.setEnabled(false);
            }
            return;
        }

        const outlinePoints = [...geometry.topEdge];
        for (let i = geometry.bottomEdge.length - 1; i >= 0; i--) {
            outlinePoints.push(geometry.bottomEdge[i]);
        }
        outlinePoints.push(geometry.topEdge[0]);

        if (!this._outlineMesh) {
            this._outlineMesh = BABYLON.MeshBuilder.CreateLines("rubberBandOutline", {
                points: outlinePoints,
                updatable: true
            }, this.scene);
            this._outlineMesh.color = new BABYLON.Color3(0.8, 0.95, 1);
            this._outlineMesh.alpha = 0.9;
            this._outlineMesh.renderingGroupId = 2;
            this._outlineMesh.isPickable = false;
            this._outlineMesh.alwaysSelectAsActiveMesh = true;
        } else {
            BABYLON.MeshBuilder.CreateLines(null, {
                points: outlinePoints,
                instance: this._outlineMesh
            });
            this._outlineMesh.setEnabled(true);
        }
    }

    _showEmbeddedVisualization(selection) {
        if (!selection) return;
        const rowIndices = selection.rowRange.globalIndices ?? [];
        const colIndices = selection.colRange.globalIndices ?? [];
        if (!rowIndices.length || !colIndices.length) {
            return;
        }

        // Create a new PCP instance for this selection
        const pcp = new EmbeddedParallelCoordinates(this.scene, this.layout);
        pcp.onCellVisibilityChange = () => {
            this._updateAllHiddenCells();
        };

        const geometry = selection.geometry;
        pcp.show({
            selection,
            rowIndices,
            colIndices,
            geometry
        });

        // Add to our list of PCPs
        this._embeddedPCPs.push(pcp);
        this._updateAllHiddenCells();

        // Clear the active selection and hide the rubber band overlay completely
        // This ensures the blue tint doesn't reappear when the embedded visualization is used
        this._activeSelection = null;
        this._lastPreviewHash = null;
        this._disableFill();
        if (this._outlineMesh) {
            this._outlineMesh.setEnabled(false);
        }
    }

    _updateFillGeometry(selection) {
        if (!selection?.topEdge?.length || !selection.bottomEdge?.length) {
            this._disableFill();
            return;
        }
        const pointCount = selection.topEdge.length;
        if (selection.bottomEdge.length !== pointCount) {
            this._disableFill();
            return;
        }
        if (!this._fillMaterial) {
            const mat = new BABYLON.StandardMaterial("rubberBandFillMat", this.scene);
            mat.diffuseColor = new BABYLON.Color3(0.1, 0.6, 1);
            mat.alpha = 0.18;
            mat.backFaceCulling = false;
            mat.disableDepthWrite = true;
            mat.emissiveColor = new BABYLON.Color3(0.1, 0.4, 0.8);
            this._fillMaterial = mat;
        }
        const topPath = selection.topEdge.map(point => point.add(selection.normal.scale(FILL_OFFSET)));
        const bottomPath = selection.bottomEdge.map(point => point.add(selection.normal.scale(FILL_OFFSET)));
        const pathArray = [bottomPath, topPath];
        const needsRebuild = !this._fillMesh || this._fillPointCount !== pointCount;
        if (needsRebuild) {
            this._fillMesh?.dispose();
            this._fillMesh = BABYLON.MeshBuilder.CreateRibbon("rubberBandFill", {
                pathArray,
                sideOrientation: BABYLON.Mesh.DOUBLESIDE,
                updatable: true
            }, this.scene);
            this._fillMesh.material = this._fillMaterial;
            this._fillMesh.renderingGroupId = 2;
            this._fillMesh.isPickable = false;
            this._fillPointCount = pointCount;
        } else {
            BABYLON.MeshBuilder.CreateRibbon(null, {
                pathArray,
                instance: this._fillMesh
            });
        }
        this._fillMesh.setEnabled(true);
    }

    _disableFill() {
        if (this._fillMesh) {
            this._fillMesh.setEnabled(false);
        }
    }

    _clampIndex(value, length) {
        if (!Number.isFinite(value)) return 0;
        return Math.max(0, Math.min(length - 1, value));
    }

    _computeAxisBounds(startValue, endValue, maxCount) {
        const a = Math.max(0, Math.min(maxCount - 1, startValue));
        const b = Math.max(0, Math.min(maxCount - 1, endValue));
        const localStart = Math.min(a, b);
        const localEnd = Math.max(a, b);
        return { localStart, localEnd };
    }

    _buildRangeFromBounds(localStart, localEnd, indices) {
        if (!indices || !indices.length) return null;
        const safeStart = Math.max(0, Math.min(indices.length - 1, localStart));
        const safeEnd = Math.max(0, Math.min(indices.length - 1, localEnd));
        const lo = Math.min(safeStart, safeEnd);
        const hi = Math.max(safeStart, safeEnd);
        const globals = [];
        for (let i = lo; i <= hi; i++) {
            const idx = indices[i];
            if (idx != null) globals.push(idx);
        }
        if (!globals.length) return null;
        return {
            localStart: lo,
            localEnd: hi,
            globalIndices: globals,
            globalStart: globals[0],
            globalEnd: globals[globals.length - 1],
            count: globals.length
        };
    }
}
