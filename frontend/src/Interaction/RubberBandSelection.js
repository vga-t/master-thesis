import * as BABYLON from "babylonjs";
import EmbeddedVisualization from "../Visualization/EmbeddedVisualization.js";

const DOUBLE_EPSILON = 1e-5;
const FILL_OFFSET = 0.004;

const CORNER_LUT = {
    topLeft: new BABYLON.Vector3(-0.5, 0.5, 0),
    topRight: new BABYLON.Vector3(0.5, 0.5, 0),
    bottomRight: new BABYLON.Vector3(0.5, -0.5, 0),
    bottomLeft: new BABYLON.Vector3(-0.5, -0.5, 0)
};

export default class RubberBandSelection {
    constructor({ scene, layout, camera, getActivePlane, embeddedVisualization = null } = {}) {
        this.scene = scene;
        this.layout = layout;
        this._cameraProvider = typeof camera === "function" ? camera : () => (camera ?? this.scene?.activeCamera ?? null);
        this._getActivePlane = typeof getActivePlane === "function" ? getActivePlane : () => null;
        this._embeddedViz = embeddedVisualization || new EmbeddedVisualization(scene);

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
        this._preferredVizMode = "auto"; // auto | line | parallel
        this._lastPreviewHash = null;
    }

    beginDrag(controller) {
        if (!controller || this._dragState) return false;
        const pick = this._pickActivePlane(controller);
        if (!pick || pick.thinInstanceIndex == null) return false;
        const indices = this._indicesFromThinInstance(pick.thinInstanceIndex);
        if (!indices) return false;

        const hitPoint = this._extractPickedPoint(pick);
        this._dragState = {
            controller,
            startIndices: indices,
            lastIndices: indices,
            startPoint: hitPoint,
            lastPoint: hitPoint
        };
        this._ensureRenderObserver();
        const selection = this._computeSelection(indices, indices, {
            startPoint: hitPoint,
            endPoint: hitPoint,
            preview: true
        });
        this._applyPreview(selection, { force: true, usePreviewGeometry: true });
        return true;
    }

    endDrag() {
        if (!this._dragState) return;
        const finalSelection = this._computeSelection(this._dragState.startIndices, this._dragState.lastIndices);
        this._clearRenderObserver();
        this._dragState = null;

        if (!finalSelection) {
            this.reset();
            return;
        }

        this._activeSelection = finalSelection;
        this._applyPreview(finalSelection, { force: true });
        this._showEmbeddedVisualization(finalSelection);
    }

    cancelDrag() {
        this._clearRenderObserver();
        this._dragState = null;
        this._applyPreview(null, { force: true });
    }

    reset() {
        this._activeSelection = null;
        this._dragState = null;
        this._clearRenderObserver();
        this._applyPreview(null, { force: true });
        this._embeddedViz?.hide();
    }

    dispose() {
        this.reset();
        this._layoutObserver?.();
        this._layoutObserver = null;
        this._fillMesh?.dispose();
        this._fillMesh = null;
        this._fillMaterial?.dispose?.();
        this._fillMaterial = null;
        this._outlineMesh?.dispose();
        this._outlineMesh = null;
        this._embeddedViz?.dispose();
        this._embeddedViz = null;
    }

    setVisualizationMode(mode) {
        if (!mode || !["line", "parallel", "auto"].includes(mode)) return;
        this._preferredVizMode = mode;
        if (this._activeSelection) {
            this._showEmbeddedVisualization(this._activeSelection);
        }
    }

    getVisualizationMode() {
        return this._preferredVizMode;
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
            const hitPoint = this._extractPickedPoint(pick);
            if (hitPoint) {
                this._dragState.lastPoint = hitPoint;
                if (!this._dragState.startPoint) {
                    this._dragState.startPoint = hitPoint.clone();
                }
            }
            const selection = this._computeSelection(this._dragState.startIndices, indices, {
                startPoint: this._dragState.startPoint,
                endPoint: this._dragState.lastPoint,
                preview: true
            });
            this._applyPreview(selection, { usePreviewGeometry: true });
        });
    }

    _clearRenderObserver() {
        if (this._renderObserver && this.scene) {
            this.scene.onBeforeRenderObservable.remove(this._renderObserver);
        }
        this._renderObserver = null;
    }

    _pickActivePlane(controller) {
        if (!controller || !this.scene) return null;
        const ray = this._buildForwardRay(controller);
        const targetMesh = this._getActivePlane?.();
        if (!ray || !targetMesh) return null;
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

    _extractPickedPoint(pickInfo) {
        if (!pickInfo) return null;
        if (pickInfo.pickedPoint) {
            return pickInfo.pickedPoint.clone ? pickInfo.pickedPoint.clone() : pickInfo.pickedPoint;
        }
        const ray = pickInfo.ray;
        if (!ray || !Number.isFinite(pickInfo.distance)) return null;
        const dir = ray.direction.clone();
        if (dir.lengthSquared() <= DOUBLE_EPSILON) return null;
        dir.normalize();
        return ray.origin.add(dir.scale(pickInfo.distance));
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

    _computeSelection(startIndices, endIndices, { startPoint = null, endPoint = null, preview = false } = {}) {
        if (!startIndices || !endIndices || !this._latestSnapshot) {
            return null;
        }

        const snapshot = this._latestSnapshot;
        const rowCount = snapshot.rowCount ?? 0;
        const colCount = snapshot.colCount ?? 0;
        if (rowCount <= 0 || colCount <= 0) return null;

        const startContinuous = this._computeContinuousCoordinates(startIndices, startPoint);
        const endContinuous = this._computeContinuousCoordinates(endIndices, endPoint);

        const rowBounds = this._computeAxisBounds(startContinuous.row, endContinuous.row, rowCount);
        const colBounds = this._computeAxisBounds(startContinuous.col, endContinuous.col, colCount);

        const rowRange = this._buildRangeFromBounds(rowBounds.localStart, rowBounds.localEnd, snapshot.rowIndices);
        const colRange = this._buildRangeFromBounds(colBounds.localStart, colBounds.localEnd, snapshot.columnIndices);
        if (!rowRange || !colRange) return null;

        const geometry = this._buildSelectionGeometry(rowRange, colRange);
        if (!geometry) return null;

        const previewGeometry = preview
            ? this._buildPreviewGeometry(geometry, startPoint, endPoint)
            : null;

        return {
            rowRange,
            colRange,
            geometry,
            previewGeometry,
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
        const localCorner = CORNER_LUT[cornerKey];
        if (!localCorner) return null;
        return BABYLON.Vector3.TransformCoordinates(localCorner, this._tempMatrix);
    }

    _applyPreview(selection, { force = false, usePreviewGeometry = false } = {}) {
        if (!selection) {
            this._disableFill();
            if (this._outlineMesh) {
                this._outlineMesh.setEnabled(false);
            }
            this._lastPreviewHash = null;
            return;
        }

        const geometry = usePreviewGeometry && selection.previewGeometry
            ? selection.previewGeometry
            : selection.geometry;
        if (!geometry) {
            this._disableFill();
            if (this._outlineMesh) {
                this._outlineMesh.setEnabled(false);
            }
            this._lastPreviewHash = null;
            return;
        }

        const previewTag = usePreviewGeometry && selection.previewGeometry?.previewRatios
            ? `p:${selection.previewGeometry.previewRatios.topRatio?.toFixed(3)}:${selection.previewGeometry.previewRatios.bottomRatio?.toFixed(3)}`
            : "f";
        const hash = `${selection.rowRange.localStart}:${selection.rowRange.localEnd}:${selection.colRange.localStart}:${selection.colRange.localEnd}:${previewTag}`;
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
        if (!selection || !this._embeddedViz) return;
        const rowIndices = selection.rowRange.globalIndices ?? [];
        const colIndices = selection.colRange.globalIndices ?? [];
        if (!rowIndices.length || !colIndices.length) {
            this._embeddedViz.hide();
            return;
        }

        const geometry = selection.geometry;
        this._embeddedViz.show({
            layout: this.layout,
            rowIndices,
            colIndices,
            geometry,
            mode: this._preferredVizMode
        });
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

    _computeContinuousCoordinates(indices, point) {
        if (!indices) {
            return { row: 0, col: 0 };
        }
        if (!point) {
            return {
                row: indices.localRow,
                col: indices.localCol
            };
        }

        const topLeft = this._getCorner(indices.localRow, indices.localCol, "topLeft");
        const topRight = this._getCorner(indices.localRow, indices.localCol, "topRight");
        const bottomLeft = this._getCorner(indices.localRow, indices.localCol, "bottomLeft");
        if (!topLeft || !topRight || !bottomLeft) {
            return {
                row: indices.localRow,
                col: indices.localCol
            };
        }

        const widthVec = topRight.subtract(topLeft);
        const heightVec = bottomLeft.subtract(topLeft);
        const widthLen = widthVec.length();
        const heightLen = heightVec.length();
        const rel = point.subtract(topLeft);

        const widthDir = widthLen > DOUBLE_EPSILON ? widthVec.scale(1 / widthLen) : null;
        const heightDir = heightLen > DOUBLE_EPSILON ? heightVec.scale(1 / heightLen) : null;

        const clamp01 = value => Math.max(0, Math.min(1, value));

        const colFrac = widthDir ? clamp01(BABYLON.Vector3.Dot(rel, widthDir) / widthLen) : 0;
        const rowFrac = heightDir ? clamp01(BABYLON.Vector3.Dot(rel, heightDir) / heightLen) : 0;

        return {
            row: indices.localRow + rowFrac,
            col: indices.localCol + colFrac
        };
    }

    _computeAxisBounds(startValue, endValue, maxCount) {
        const maxContinuous = Math.max(0, maxCount - 1e-4);
        const clamp = value => Math.max(0, Math.min(maxContinuous, value));
        const a = clamp(startValue);
        const b = clamp(endValue);
        const minVal = Math.min(a, b);
        const maxVal = Math.max(a, b);
        const localStart = Math.floor(minVal);
        const localEnd = Math.max(localStart, Math.floor(maxVal));
        return {
            localStart,
            localEnd,
            minValue: minVal,
            maxValue: maxVal
        };
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

    _buildPreviewGeometry(baseGeometry, startPoint, endPoint) {
        if (!baseGeometry) return null;
        const origin = baseGeometry.corners?.topLeft;
        const heightVec = baseGeometry.heightVec;
        if (!origin || !heightVec) return null;
        const totalHeight = heightVec.length();
        if (totalHeight <= DOUBLE_EPSILON) return null;
        const heightDir = heightVec.clone().normalize();
        const ratios = [];
        const pushRatio = point => {
            if (!point) return;
            ratios.push(this._projectRatioAlongHeight(point, origin, heightDir, totalHeight));
        };
        pushRatio(startPoint);
        pushRatio(endPoint);
        if (!ratios.length) return null;
        let topRatio = Math.max(0, Math.min(...ratios));
        let bottomRatio = Math.min(1, Math.max(...ratios));
        if (bottomRatio - topRatio < 1e-3) {
            const padding = 5e-4;
            topRatio = Math.max(0, topRatio - padding);
            bottomRatio = Math.min(1, bottomRatio + padding);
        }
        const topEdge = this._lerpEdges(baseGeometry.topEdge, baseGeometry.bottomEdge, topRatio);
        const bottomEdge = this._lerpEdges(baseGeometry.topEdge, baseGeometry.bottomEdge, bottomRatio);
        if (!topEdge || !bottomEdge) return null;
        const corners = {
            topLeft: topEdge[0],
            topRight: topEdge[topEdge.length - 1],
            bottomLeft: bottomEdge[0],
            bottomRight: bottomEdge[bottomEdge.length - 1]
        };
        const widthVec = corners.topRight.subtract(corners.topLeft);
        const heightVecNew = corners.bottomLeft.subtract(corners.topLeft);
        const normal = BABYLON.Vector3.Cross(widthVec, heightVecNew).normalize();
        const center = corners.topLeft
            .add(widthVec.scale(0.5))
            .add(heightVecNew.scale(0.5));
        return {
            ...baseGeometry,
            topEdge,
            bottomEdge,
            corners,
            widthVec,
            heightVec: heightVecNew,
            normal,
            center,
            previewRatios: { topRatio, bottomRatio }
        };
    }

    _projectRatioAlongHeight(point, origin, heightDir, totalHeight) {
        if (!point || !origin) return 0;
        const rel = point.subtract(origin);
        const distance = BABYLON.Vector3.Dot(rel, heightDir);
        return Math.max(0, Math.min(1, distance / totalHeight));
    }

    _lerpEdges(topEdge, bottomEdge, ratio) {
        if (!Array.isArray(topEdge) || !Array.isArray(bottomEdge)) return null;
        if (topEdge.length !== bottomEdge.length) return null;
        return topEdge.map((point, idx) => {
            const target = bottomEdge[idx];
            if (!point || !target) return point;
            return BABYLON.Vector3.Lerp(point, target, ratio);
        });
    }
}
