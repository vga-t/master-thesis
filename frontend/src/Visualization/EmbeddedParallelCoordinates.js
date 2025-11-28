import * as BABYLON from "babylonjs";

const AXIS_RADIUS = 0.006;
const AXIS_COLOR = new BABYLON.Color3(0.4, 0.4, 0.4);
const CONE_HEIGHT = 0.02;
const CONE_DIAMETER = 0.015;
const LINE_ALPHA = 0.7;
const SURFACE_OFFSET = 0.012; // Offset from cylinder surface
const RESIZE_HANDLE_SIZE = 0.025;
const MARGIN_RATIO = 0.08; // 8% margin inside the bounds

/**
 * Embedded Parallel Coordinates Visualization
 * Renders parallel coordinate plots directly in the LCVDS cylindrical space.
 * Axes follow the cylinder curve, and the visualization stays within hidden cell bounds.
 */
export default class EmbeddedParallelCoordinates {
    constructor(scene, layout) {
        this.scene = scene;
        this.layout = layout;

        // Visualization state
        this._visible = false;
        this._selection = null;
        this._hiddenCellIndices = new Set();

        // Current bounds (row/col ranges that are hidden)
        this._currentRowRange = null;
        this._currentColRange = null;

        // 3D elements
        this._axisContainer = null;
        this._axisCylinders = [];
        this._axisCones = []; // Arrow cones for axis ends
        this._polylineSystem = null;
        this._axisLabels = [];

        // Corner resize handles (4 corners)
        this._resizeHandles = {
            topLeft: null,
            topRight: null,
            bottomLeft: null,
            bottomRight: null
        };
        this._resizeState = null;

        // Materials
        this._axisMaterial = this._createAxisMaterial();
        this._handleMaterial = this._createHandleMaterial();
        this._handleHoverMaterial = this._createHandleHoverMaterial();

        // Color palettes for polylines
        this._colorPalettes = [
            [0.12, 0.47, 0.71], // Blue
            [1.0, 0.5, 0.05],   // Orange
            [0.17, 0.63, 0.17], // Green
            [0.84, 0.15, 0.16], // Red
            [0.58, 0.40, 0.74], // Purple
            [0.55, 0.34, 0.29], // Brown
            [0.89, 0.47, 0.76], // Pink
            [0.50, 0.50, 0.50], // Gray
            [0.74, 0.74, 0.13], // Olive
            [0.09, 0.75, 0.81]  // Cyan
        ];

        // Callbacks
        this.onCellVisibilityChange = null;
    }

    /**
     * Show embedded parallel coordinates for the given selection
     */
    show({ selection, rowIndices, colIndices, geometry }) {
        if (!selection || !rowIndices?.length || !colIndices?.length || !geometry) {
            this.hide();
            return;
        }

        this._selection = selection;
        this._visible = true;

        // Store the current hidden cell range
        this._currentRowRange = { ...selection.rowRange };
        this._currentColRange = { ...selection.colRange };

        // Update hidden cells
        this._updateHiddenCells();

        // Build visualization that follows the cylinder curve
        this._buildVisualization();

        // Create corner resize handles
        this._createResizeHandles();
    }

    /**
     * Hide the visualization and restore cell visibility
     */
    hide() {
        this._visible = false;
        this._selection = null;
        this._currentRowRange = null;
        this._currentColRange = null;
        this._hiddenCellIndices.clear();

        this._disposeAxes();
        this._disposePolylines();
        this._disposeResizeHandles();
        this._disposeLabels();

        if (this.onCellVisibilityChange) {
            this.onCellVisibilityChange(this._hiddenCellIndices);
        }
    }

    isVisible() {
        return this._visible;
    }

    getHiddenCellIndices() {
        return this._hiddenCellIndices;
    }

    /**
     * Handle resize interaction start
     */
    beginResize(handleId, startPoint) {
        if (!this._resizeHandles[handleId]) return false;

        this._resizeState = {
            handleId,
            startPoint: startPoint.clone(),
            originalRowRange: { ...this._currentRowRange },
            originalColRange: { ...this._currentColRange }
        };

        this._resizeHandles[handleId].material = this._handleHoverMaterial;
        return true;
    }

    /**
     * Update resize during drag - expand/contract the hidden cell region
     */
    updateResize(currentPoint) {
        if (!this._resizeState || !this._currentRowRange || !this._currentColRange) return;

        const { handleId, startPoint, originalRowRange, originalColRange } = this._resizeState;
        const snapshot = this.layout?.getVisibleSnapshot();
        if (!snapshot) return;

        // Calculate how many rows/cols to expand based on drag distance
        const delta = currentPoint.subtract(startPoint);

        // Get layout parameters
        const params = this.layout.getLayoutParameters();
        const cellHeight = snapshot.cellHeight || (params.height / snapshot.rowCount);
        const cellAngle = params.arcAngle / snapshot.colCount;

        // Determine row/col changes based on handle and drag direction
        let rowStartDelta = 0, rowEndDelta = 0, colStartDelta = 0, colEndDelta = 0;

        // For corner handles, we need to determine movement in both directions
        const heightMovement = -delta.y / cellHeight; // Negative because Y is up
        const arcMovement = this._calculateArcMovement(delta, currentPoint, params);
        const colMovement = arcMovement / cellAngle;

        switch (handleId) {
            case "topLeft":
                rowStartDelta = -Math.round(heightMovement);
                colStartDelta = -Math.round(colMovement);
                break;
            case "topRight":
                rowStartDelta = -Math.round(heightMovement);
                colEndDelta = Math.round(colMovement);
                break;
            case "bottomLeft":
                rowEndDelta = Math.round(heightMovement);
                colStartDelta = -Math.round(colMovement);
                break;
            case "bottomRight":
                rowEndDelta = Math.round(heightMovement);
                colEndDelta = Math.round(colMovement);
                break;
        }

        // Apply deltas with clamping
        const newRowStart = Math.max(0, Math.min(
            originalRowRange.localStart + rowStartDelta,
            originalRowRange.localEnd - 1
        ));
        const newRowEnd = Math.max(newRowStart + 1, Math.min(
            originalRowRange.localEnd + rowEndDelta,
            snapshot.rowCount - 1
        ));
        const newColStart = Math.max(0, Math.min(
            originalColRange.localStart + colStartDelta,
            originalColRange.localEnd - 1
        ));
        const newColEnd = Math.max(newColStart + 1, Math.min(
            originalColRange.localEnd + colEndDelta,
            snapshot.colCount - 1
        ));

        // Update ranges
        this._currentRowRange.localStart = newRowStart;
        this._currentRowRange.localEnd = newRowEnd;
        this._currentColRange.localStart = newColStart;
        this._currentColRange.localEnd = newColEnd;

        // Rebuild everything
        this._updateHiddenCells();
        this._buildVisualization();
        this._createResizeHandles();
    }

    /**
     * End resize interaction
     */
    endResize() {
        if (!this._resizeState) return;

        const { handleId } = this._resizeState;
        if (this._resizeHandles[handleId]) {
            this._resizeHandles[handleId].material = this._handleMaterial;
        }

        this._resizeState = null;
    }

    /**
     * Check if a mesh is a resize handle
     */
    getResizeHandleId(mesh) {
        if (!mesh?.metadata?.embeddedPCPHandle) return null;
        return mesh.metadata.handleId;
    }

    dispose() {
        this.hide();
        this._axisMaterial?.dispose();
        this._handleMaterial?.dispose();
        this._handleHoverMaterial?.dispose();
    }

    // ==================== Private Methods ====================

    _createAxisMaterial() {
        const mat = new BABYLON.StandardMaterial("pcpAxisMat", this.scene);
        mat.diffuseColor = AXIS_COLOR;
        mat.emissiveColor = AXIS_COLOR.scale(0.3);
        mat.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
        mat.backFaceCulling = false;
        return mat;
    }

    _createHandleMaterial() {
        const mat = new BABYLON.StandardMaterial("pcpHandleMat", this.scene);
        mat.diffuseColor = new BABYLON.Color3(0.3, 0.6, 1.0);
        mat.emissiveColor = new BABYLON.Color3(0.15, 0.3, 0.5);
        mat.alpha = 0.85;
        return mat;
    }

    _createHandleHoverMaterial() {
        const mat = new BABYLON.StandardMaterial("pcpHandleHoverMat", this.scene);
        mat.diffuseColor = new BABYLON.Color3(1.0, 0.7, 0.2);
        mat.emissiveColor = new BABYLON.Color3(0.5, 0.35, 0.1);
        mat.alpha = 0.95;
        return mat;
    }

    /**
     * Calculate arc movement from a drag delta
     */
    _calculateArcMovement(delta, currentPoint, params) {
        // Project movement onto the horizontal plane and calculate angle change
        const horizontalDelta = new BABYLON.Vector3(delta.x, 0, delta.z);
        const magnitude = horizontalDelta.length();
        if (magnitude < 0.001) return 0;

        // Use the sign based on x movement (positive x = positive angle)
        return delta.x > 0 ? magnitude : -magnitude;
    }

    /**
     * Update hidden cells based on current row/col range
     */
    _updateHiddenCells() {
        this._hiddenCellIndices.clear();

        const snapshot = this.layout?.getVisibleSnapshot();
        if (!snapshot || !this._currentRowRange || !this._currentColRange) return;

        const { rowCount, colCount } = snapshot;

        for (let r = this._currentRowRange.localStart; r <= this._currentRowRange.localEnd; r++) {
            for (let c = this._currentColRange.localStart; c <= this._currentColRange.localEnd; c++) {
                if (r >= 0 && r < rowCount && c >= 0 && c < colCount) {
                    const thinIndex = r * colCount + c;
                    this._hiddenCellIndices.add(thinIndex);
                }
            }
        }

        if (this.onCellVisibilityChange) {
            this.onCellVisibilityChange(this._hiddenCellIndices);
        }
    }

    /**
     * Build the visualization following the cylinder curve
     */
    _buildVisualization() {
        this._disposeAxes();
        this._disposePolylines();
        this._disposeLabels();

        if (!this._currentRowRange || !this._currentColRange) return;

        const snapshot = this.layout?.getVisibleSnapshot();
        if (!snapshot) return;

        const params = this.layout.getLayoutParameters();
        const data = this._extractData();
        if (!data || data.rows.length === 0 || data.columns.length === 0) return;

        // Calculate the cylindrical bounds for the visualization
        const bounds = this._calculateCylindricalBounds(params, snapshot);
        if (!bounds) return;

        this._axisContainer = new BABYLON.TransformNode("pcpAxisContainer", this.scene);

        // Build axes following the cylinder curve
        this._buildCurvedAxes(data.columns, bounds, params);

        // Build polylines
        this._buildPolylines(data, bounds, params);

        // Build labels
        this._buildAxisLabels(data.columns, bounds, params);
    }

    /**
     * Extract data for the currently hidden cells
     */
    _extractData() {
        const snapshot = this.layout?.getVisibleSnapshot();
        if (!snapshot || !this._currentRowRange || !this._currentColRange) return null;

        const columns = [];
        const rows = [];

        // Get columns in the hidden range
        for (let c = this._currentColRange.localStart; c <= this._currentColRange.localEnd; c++) {
            if (c >= 0 && c < snapshot.columnKeys.length) {
                const key = snapshot.columnKeys[c];
                const meta = this.layout.columnMetadata[key];
                columns.push({
                    key,
                    localIndex: c,
                    type: meta?.type ?? "unknown",
                    min: meta?.min ?? 0,
                    max: meta?.max ?? 1
                });
            }
        }

        // Get rows in the hidden range
        for (let r = this._currentRowRange.localStart; r <= this._currentRowRange.localEnd; r++) {
            if (r >= 0 && r < snapshot.rowCount) {
                const rowData = [];
                for (let i = 0; i < columns.length; i++) {
                    const col = columns[i];
                    const dataIndex = r * snapshot.colCount + col.localIndex;
                    const normalizedValue = snapshot.normalizedData[dataIndex] ?? 0;
                    rowData.push(normalizedValue);
                }
                rows.push({
                    localIndex: r,
                    values: rowData
                });
            }
        }

        return { columns, rows };
    }

    /**
     * Calculate the cylindrical bounds for the PCP area
     */
    _calculateCylindricalBounds(params, snapshot) {
        const rowStart = this._currentRowRange.localStart;
        const rowEnd = this._currentRowRange.localEnd;
        const colStart = this._currentColRange.localStart;
        const colEnd = this._currentColRange.localEnd;

        const numRows = rowEnd - rowStart + 1;
        const numCols = colEnd - colStart + 1;
        if (numRows < 1 || numCols < 1) return null;

        // Calculate angle range
        const startAngle = -params.arcAngle / 2;
        const anglePerCol = params.arcAngle / snapshot.colCount;

        // The hidden cells span from colStart to colEnd
        const angleStart = startAngle + colStart * anglePerCol;
        const angleEnd = startAngle + (colEnd + 1) * anglePerCol;
        const angleSpan = angleEnd - angleStart;

        // Calculate height range
        const heightPerRow = params.height / snapshot.rowCount;
        const topY = params.height - rowStart * heightPerRow + this.layout.groundOffset;
        const bottomY = params.height - (rowEnd + 1) * heightPerRow + this.layout.groundOffset;
        const heightSpan = topY - bottomY;

        // Apply margin
        const margin = MARGIN_RATIO;
        const marginAngle = angleSpan * margin;
        const marginHeight = heightSpan * margin;

        return {
            angleStart: angleStart + marginAngle,
            angleEnd: angleEnd - marginAngle,
            angleSpan: angleSpan - 2 * marginAngle,
            topY: topY - marginHeight,
            bottomY: bottomY + marginHeight,
            heightSpan: heightSpan - 2 * marginHeight,
            radius: params.radius,
            // Corner angles and heights for resize handles (no margin)
            fullAngleStart: angleStart,
            fullAngleEnd: angleEnd,
            fullTopY: topY,
            fullBottomY: bottomY
        };
    }

    /**
     * Build axes that follow the cylinder curve, with arrow cones at both ends
     */
    _buildCurvedAxes(columns, bounds, params) {
        const numAxes = columns.length;
        if (numAxes === 0) return;

        for (let i = 0; i < numAxes; i++) {
            // Calculate angle for this axis
            const t = numAxes > 1 ? i / (numAxes - 1) : 0.5;
            const angle = bounds.angleStart + t * bounds.angleSpan;

            // Calculate position on cylinder surface
            const x = params.radius * Math.sin(angle);
            const z = params.radius * Math.cos(angle) - params.radius;

            // Axis goes from bottom to top at this angle
            const bottomPos = new BABYLON.Vector3(x, bounds.bottomY, z);
            const topPos = new BABYLON.Vector3(x, bounds.topY, z);

            // Offset from surface
            const normal = new BABYLON.Vector3(Math.sin(angle), 0, Math.cos(angle));
            const offset = normal.scale(SURFACE_OFFSET);

            const axisBottom = bottomPos.add(offset);
            const axisTop = topPos.add(offset);
            const axisHeight = bounds.heightSpan;

            // Create cylinder for axis (slightly shorter to make room for cones)
            const cylinderHeight = axisHeight - CONE_HEIGHT * 2;
            const cylinder = BABYLON.MeshBuilder.CreateCylinder(`pcpAxis_${i}`, {
                height: cylinderHeight,
                diameter: AXIS_RADIUS * 2,
                tessellation: 8
            }, this.scene);

            // Position at center of axis
            cylinder.position = axisBottom.add(axisTop).scale(0.5);

            // Axis is vertical (along Y), no rotation needed
            cylinder.material = this._axisMaterial;
            cylinder.isPickable = false;
            cylinder.parent = this._axisContainer;

            // Create top cone (arrow pointing up)
            const topCone = BABYLON.MeshBuilder.CreateCylinder(`pcpAxisTopCone_${i}`, {
                height: CONE_HEIGHT,
                diameterTop: 0,
                diameterBottom: CONE_DIAMETER,
                tessellation: 8
            }, this.scene);
            topCone.position = axisTop.add(new BABYLON.Vector3(0, CONE_HEIGHT / 2, 0));
            topCone.material = this._axisMaterial;
            topCone.isPickable = false;
            topCone.parent = this._axisContainer;

            // Create bottom cone (arrow pointing down)
            const bottomCone = BABYLON.MeshBuilder.CreateCylinder(`pcpAxisBottomCone_${i}`, {
                height: CONE_HEIGHT,
                diameterTop: CONE_DIAMETER,
                diameterBottom: 0,
                tessellation: 8
            }, this.scene);
            bottomCone.position = axisBottom.subtract(new BABYLON.Vector3(0, CONE_HEIGHT / 2, 0));
            bottomCone.material = this._axisMaterial;
            bottomCone.isPickable = false;
            bottomCone.parent = this._axisContainer;

            this._axisCones.push(topCone, bottomCone);

            this._axisCylinders.push({
                mesh: cylinder,
                column: columns[i],
                angle,
                basePosition: axisBottom,
                topPosition: axisTop,
                height: axisHeight,
                normal
            });
        }
    }

    /**
     * Build polylines connecting values across axes
     */
    _buildPolylines(data, bounds, params) {
        if (data.rows.length === 0 || this._axisCylinders.length === 0) return;

        const lines = [];
        const colors = [];

        for (let rowIdx = 0; rowIdx < data.rows.length; rowIdx++) {
            const row = data.rows[rowIdx];
            const linePoints = [];
            const lineColors = [];

            const paletteIdx = rowIdx % this._colorPalettes.length;
            const rgb = this._colorPalettes[paletteIdx];
            const color = new BABYLON.Color4(rgb[0], rgb[1], rgb[2], LINE_ALPHA);

            for (let axisIdx = 0; axisIdx < this._axisCylinders.length; axisIdx++) {
                const axis = this._axisCylinders[axisIdx];
                const value = row.values[axisIdx] ?? 0;

                // Map value (0-1) to position on axis
                const clampedValue = Math.max(0, Math.min(1, value));
                const point = axis.basePosition.add(
                    new BABYLON.Vector3(0, clampedValue * axis.height, 0)
                ).add(axis.normal.scale(SURFACE_OFFSET * 0.5)); // Slightly in front

                linePoints.push(point);
                lineColors.push(color);
            }

            if (linePoints.length >= 2) {
                lines.push(linePoints);
                colors.push(lineColors);
            }
        }

        if (lines.length > 0) {
            this._polylineSystem = BABYLON.MeshBuilder.CreateLineSystem("pcpLines", {
                lines,
                colors,
                updatable: false
            }, this.scene);
            this._polylineSystem.isPickable = false;
        }
    }

    /**
     * Build axis labels above each axis
     */
    _buildAxisLabels(columns, bounds, params) {
        const labelHeight = 0.035;

        for (let i = 0; i < this._axisCylinders.length; i++) {
            const axis = this._axisCylinders[i];
            const column = columns[i];

            // Position label above axis top
            const labelPos = axis.topPosition.add(new BABYLON.Vector3(0, 0.02, 0))
                .add(axis.normal.scale(SURFACE_OFFSET * 2));

            const label = this._createTextPlane(column.key, labelHeight, labelPos, axis.normal);
            if (label) {
                this._axisLabels.push(label);
            }
        }
    }

    _createTextPlane(text, height, position, normal) {
        const planeWidth = Math.max(0.08, text.length * height * 0.5);
        const plane = BABYLON.MeshBuilder.CreatePlane(`pcpLabel_${text}`, {
            width: planeWidth,
            height: height
        }, this.scene);

        const texture = new BABYLON.DynamicTexture(`pcpLabelTex_${text}`, {
            width: 256,
            height: 64
        }, this.scene, false);

        texture.hasAlpha = true;
        const ctx = texture.getContext();
        ctx.clearRect(0, 0, 256, 64);
        ctx.font = "bold 42px Arial";
        ctx.fillStyle = "white";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        const displayText = text.length > 10 ? text.substring(0, 8) + "..." : text;
        ctx.fillText(displayText, 128, 32);
        texture.update();

        const mat = new BABYLON.StandardMaterial(`pcpLabelMat_${text}`, this.scene);
        mat.diffuseTexture = texture;
        mat.emissiveColor = new BABYLON.Color3(1, 1, 1);
        mat.disableLighting = true;
        mat.backFaceCulling = false;
        mat.useAlphaFromDiffuseTexture = true;

        plane.material = mat;
        plane.position = position;
        plane.isPickable = false;

        // Orient to face outward from cylinder
        const lookTarget = position.add(normal);
        plane.lookAt(lookTarget);

        return plane;
    }

    /**
     * Create corner resize handles
     */
    _createResizeHandles() {
        this._disposeResizeHandles();

        const params = this.layout?.getLayoutParameters();
        const snapshot = this.layout?.getVisibleSnapshot();
        if (!params || !snapshot || !this._currentRowRange || !this._currentColRange) return;

        const bounds = this._calculateCylindricalBounds(params, snapshot);
        if (!bounds) return;

        // Calculate corner positions (using full bounds, not margined)
        const corners = this._calculateCornerPositions(bounds, params);

        for (const [key, position] of Object.entries(corners)) {
            this._resizeHandles[key] = this._createHandle(key, position);
        }
    }

    _calculateCornerPositions(bounds, params) {
        const corners = {};
        const offset = SURFACE_OFFSET * 1.5;

        // Top-left corner
        const tlAngle = bounds.fullAngleStart;
        const tlNormal = new BABYLON.Vector3(Math.sin(tlAngle), 0, Math.cos(tlAngle));
        corners.topLeft = new BABYLON.Vector3(
            params.radius * Math.sin(tlAngle),
            bounds.fullTopY,
            params.radius * Math.cos(tlAngle) - params.radius
        ).add(tlNormal.scale(offset));

        // Top-right corner
        const trAngle = bounds.fullAngleEnd;
        const trNormal = new BABYLON.Vector3(Math.sin(trAngle), 0, Math.cos(trAngle));
        corners.topRight = new BABYLON.Vector3(
            params.radius * Math.sin(trAngle),
            bounds.fullTopY,
            params.radius * Math.cos(trAngle) - params.radius
        ).add(trNormal.scale(offset));

        // Bottom-left corner
        corners.bottomLeft = new BABYLON.Vector3(
            params.radius * Math.sin(tlAngle),
            bounds.fullBottomY,
            params.radius * Math.cos(tlAngle) - params.radius
        ).add(tlNormal.scale(offset));

        // Bottom-right corner
        corners.bottomRight = new BABYLON.Vector3(
            params.radius * Math.sin(trAngle),
            bounds.fullBottomY,
            params.radius * Math.cos(trAngle) - params.radius
        ).add(trNormal.scale(offset));

        return corners;
    }

    _createHandle(id, position) {
        const handle = BABYLON.MeshBuilder.CreateSphere(`pcpHandle_${id}`, {
            diameter: RESIZE_HANDLE_SIZE,
            segments: 8
        }, this.scene);

        handle.position = position;
        handle.material = this._handleMaterial;
        handle.isPickable = true;
        handle.metadata = {
            embeddedPCPHandle: true,
            handleId: id
        };

        return handle;
    }

    _disposeAxes() {
        for (const axis of this._axisCylinders) {
            axis.mesh?.dispose();
        }
        this._axisCylinders = [];

        // Dispose arrow cones
        for (const cone of this._axisCones) {
            cone?.dispose();
        }
        this._axisCones = [];

        if (this._axisContainer) {
            this._axisContainer.dispose();
            this._axisContainer = null;
        }
    }

    _disposePolylines() {
        if (this._polylineSystem) {
            this._polylineSystem.dispose();
            this._polylineSystem = null;
        }
    }

    _disposeLabels() {
        for (const label of this._axisLabels) {
            if (label.material?.diffuseTexture) {
                label.material.diffuseTexture.dispose();
            }
            label.material?.dispose();
            label.dispose();
        }
        this._axisLabels = [];
    }

    _disposeResizeHandles() {
        for (const key of Object.keys(this._resizeHandles)) {
            if (this._resizeHandles[key]) {
                this._resizeHandles[key].dispose();
                this._resizeHandles[key] = null;
            }
        }
    }
}
