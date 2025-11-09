import * as BABYLON from "babylonjs";

const DEFAULT_WIDTH = 0.9;
const DEFAULT_HEIGHT = 0.55;
const MIN_WIDTH = 0.4;
const MIN_HEIGHT = 0.25;
const MAX_WIDTH = 2.2;
const MAX_HEIGHT = 1.5;
const MIN_VIEWPORT_SIZE = 0.06;

const BASE_AREA = DEFAULT_WIDTH * DEFAULT_HEIGHT;

const CANVAS_DIFFUSE = new BABYLON.Color3(0.1, 0.1, 0.1);
const CANVAS_EMISSIVE = new BABYLON.Color3(0.35, 0.35, 0.35);

const HANDLE_SPECS = [
    { name: "topLeft", signX: -1, signY: 1 },
    { name: "topRight", signX: 1, signY: 1 },
    { name: "bottomLeft", signX: -1, signY: -1 },
    { name: "bottomRight", signX: 1, signY: -1 }
];

class MinimapVisualization {
    constructor(layout, scene) {
        this.layout = layout;
        this.scene = scene;
        this._mode = "heatmap";
        this._visible = false;
        this._width = DEFAULT_WIDTH;
        this._height = DEFAULT_HEIGHT;
        this._lastViewportInput = null;
        this._userResized = false;
        this._datasetMetrics = this._resolveDatasetMetrics();

        this.root = new BABYLON.TransformNode("minimapRoot", scene);
        this.root.rotationQuaternion = BABYLON.Quaternion.Identity();

        this.mainMesh = BABYLON.MeshBuilder.CreatePlane("minimapPlane", { width: 1, height: 1, sideOrientation: BABYLON.Mesh.DOUBLESIDE }, scene);
        this.mainMesh.parent = this.root;
        this.mainMesh.isPickable = true;
        this.mainMesh.metadata = { minimap: true, kind: "main" };

        this._material = new BABYLON.StandardMaterial("minimapMaterial", scene);
        this._material.disableLighting = true;
        this._material.backFaceCulling = false;
        this._material.specularColor = new BABYLON.Color3(0, 0, 0);
        this._material.diffuseColor = CANVAS_DIFFUSE;
        this._material.emissiveColor = CANVAS_EMISSIVE;
        this.mainMesh.material = this._material;

        this.viewportMesh = BABYLON.MeshBuilder.CreatePlane("minimapViewport", { width: 1, height: 1 }, scene);
        this.viewportMesh.parent = this.root;
        this.viewportMesh.isPickable = true;
        this.viewportMesh.metadata = { minimap: true, kind: "viewport" };
        const viewportMat = new BABYLON.StandardMaterial("minimapViewportMat", scene);
        viewportMat.diffuseColor = new BABYLON.Color3(0.2, 0.6, 1.0);
        viewportMat.alpha = 0.35;
        viewportMat.disableLighting = true;
        viewportMat.backFaceCulling = false;
        this.viewportMesh.material = viewportMat;

        this.handles = HANDLE_SPECS.map(spec => {
            const mesh = BABYLON.MeshBuilder.CreateBox(`minimapHandle_${spec.name}`, { size: 0.05 }, scene);
            mesh.parent = this.root;
            mesh.isPickable = true;
            mesh.metadata = { minimap: true, kind: "handle", handle: spec.name, signX: spec.signX, signY: spec.signY };
            const mat = new BABYLON.StandardMaterial(`minimapHandleMat_${spec.name}`, scene);
            mat.diffuseColor = new BABYLON.Color3(0.9, 0.9, 0.9);
            mat.specularColor = new BABYLON.Color3(0, 0, 0);
            mat.emissiveColor = new BABYLON.Color3(0.2, 0.2, 0.2);
            mat.disableLighting = true;
            mesh.material = mat;
            return mesh;
        });

        this.root.setEnabled(false);

        this.refreshCanvasDimensions();
        this._applyDimensions();
    }

    setVisible(visible) {
        this._visible = !!visible;
        this.root.setEnabled(this._visible);
    }

    isVisible() {
        return this._visible;
    }

    setMode(mode) {
        if (mode !== "heatmap" && mode !== "twotone") return;
        if (this._mode === mode) return;
        this._mode = mode;
    }

    setRootPosition(position) {
        if (!position) return;
        this.root.position.copyFrom(position);
    }

    setForward(direction) {
        if (!direction) return;
        const forward = direction.clone();
        if (forward.lengthSquared() < 1e-6) forward.copyFrom(BABYLON.Axis.Z);
        forward.normalize();
        const up = BABYLON.Axis.Y.clone();
        let right = BABYLON.Vector3.Cross(up, forward);
        if (right.lengthSquared() < 1e-6) {
            // Forward is parallel to up; adjust up vector slightly
            up.x += 0.0001;
            right = BABYLON.Vector3.Cross(up, forward);
        }
        right.normalize();
        const adjustedUp = BABYLON.Vector3.Cross(forward, right).normalize();
        const orientation = BABYLON.Quaternion.FromLookDirectionLH(forward, adjustedUp);
        if (orientation) {
            this.root.rotationQuaternion = orientation;
        }
    }

    getRootPosition() {
        return this.root.getAbsolutePosition().clone();
    }

    getPlaneMesh() {
        return this.mainMesh;
    }

    getDimensions() {
        return { width: this._width, height: this._height };
    }

    updateViewport(scrollState, dimensions = {}) {
        if (!scrollState) return;
        const visibleRows = dimensions.visibleRows ?? this.layout.visibleRows ?? 1;
        const visibleCols = dimensions.visibleCols ?? this.layout.visibleCols ?? 1;
        const totalRows = Math.max(visibleRows, dimensions.totalRows ?? this.layout.totalRows ?? visibleRows);
        const totalCols = Math.max(visibleCols, dimensions.totalCols ?? this.layout.totalCols ?? visibleCols);

        const viewportWidthRatio = totalCols > 0 ? visibleCols / totalCols : 1;
        const viewportHeightRatio = totalRows > 0 ? visibleRows / totalRows : 1;

        const viewportWidth = Math.max(MIN_VIEWPORT_SIZE, viewportWidthRatio * this._width);
        const viewportHeight = Math.max(MIN_VIEWPORT_SIZE, viewportHeightRatio * this._height);

        this.viewportMesh.scaling.x = viewportWidth;
        this.viewportMesh.scaling.y = viewportHeight;

        const maxRowOffset = Math.max(0, scrollState.maxRowOffset ?? totalRows - visibleRows);
        const maxColOffset = Math.max(0, scrollState.maxColOffset ?? totalCols - visibleCols);

        const rowNorm = maxRowOffset > 0 ? (scrollState.rowOffset ?? 0) / maxRowOffset : 0;
        // const colNorm = maxColOffset > 0 ? (scrollState.colOffset ?? 0) / maxColOffset : 0;
        const colNorm = maxColOffset > 0 ? (maxColOffset - (scrollState.colOffset ?? 0)) / maxColOffset : 0;

        const halfWidth = this._width / 2;
        const halfHeight = this._height / 2;
        const availableWidth = Math.max(0, this._width - viewportWidth);
        const availableHeight = Math.max(0, this._height - viewportHeight);

        const centerX = -halfWidth + (viewportWidth / 2) + availableWidth * colNorm;
        const centerY = halfHeight - (viewportHeight / 2) - availableHeight * rowNorm;

        this.viewportMesh.position.x = centerX;
        this.viewportMesh.position.y = centerY;
        this.viewportMesh.position.z = 0.003;

        this._lastViewportInput = {
            scrollState: { ...scrollState },
            dimensions: { visibleRows, visibleCols, totalRows, totalCols }
        };
    }

    resizeFromHandle(handleMeta, localPoint) {
        if (!handleMeta || !localPoint) return;
        const affectsX = true;
        const affectsY = true;
        let width = this._width;
        let height = this._height;

        if (affectsX) {
            const newHalfWidth = Math.max(MIN_WIDTH / 2, Math.min(MAX_WIDTH / 2, Math.abs(localPoint.x)));
            width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, newHalfWidth * 2));
        }
        if (affectsY) {
            const newHalfHeight = Math.max(MIN_HEIGHT / 2, Math.min(MAX_HEIGHT / 2, Math.abs(localPoint.y)));
            height = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, newHalfHeight * 2));
        }

        this.setDimensions(width, height);
    }

    setDimensions(width, height) {
        const clampedWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, width));
        const clampedHeight = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, height));
        this._userResized = true;
        this._width = clampedWidth;
        this._height = clampedHeight;
        this._applyDimensions();
        if (this._lastViewportInput) {
            this.updateViewport(this._lastViewportInput.scrollState, this._lastViewportInput.dimensions);
        }
    }

    refreshCanvasDimensions(metrics = {}) {
        const totalRows = Math.max(1, metrics.totalRows ?? this._datasetMetrics.totalRows ?? 1);
        const totalCols = Math.max(1, metrics.totalCols ?? this._datasetMetrics.totalCols ?? 1);
        this._datasetMetrics = { totalRows, totalCols };
        if (this._userResized) return;
        const { width, height } = this._computeAutoDimensions(totalRows, totalCols);
        this._width = width;
        this._height = height;
        this._applyDimensions();
        if (this._lastViewportInput) {
            this.updateViewport(this._lastViewportInput.scrollState, this._lastViewportInput.dimensions);
        }
    }

    worldToLocal(point) {
        if (!point) return BABYLON.Vector3.Zero();
        const invWorld = this.mainMesh.getWorldMatrix().clone().invert();
        return BABYLON.Vector3.TransformCoordinates(point, invWorld);
    }

    normalizeLocalPoint(local) {
        const halfWidth = this._width / 2;
        const halfHeight = this._height / 2;
        const clampedX = Math.max(-halfWidth, Math.min(halfWidth, local.x));
        const clampedY = Math.max(-halfHeight, Math.min(halfHeight, local.y));
        const colNorm = (clampedX + halfWidth) / (this._width || 1);
        const rowNorm = (halfHeight - clampedY) / (this._height || 1);
        return {
            row: Math.max(0, Math.min(1, rowNorm)),
            col: Math.max(0, Math.min(1, colNorm))
        };
    }

    getPlane() {
        const worldMatrix = this.mainMesh.getWorldMatrix();
        const origin = BABYLON.Vector3.TransformCoordinates(BABYLON.Vector3.Zero(), worldMatrix);
        const normal = BABYLON.Vector3.TransformNormal(BABYLON.Axis.Z.clone(), worldMatrix).normalize();
        return BABYLON.Plane.FromPositionAndNormal(origin, normal);
    }

    previewViewportFromNormalized(rowNorm, colNorm) {
        const halfWidth = this._width / 2;
        const halfHeight = this._height / 2;
        const viewportWidth = this.viewportMesh.scaling.x;
        const viewportHeight = this.viewportMesh.scaling.y;
        const availableWidth = Math.max(0, this._width - viewportWidth);
        const availableHeight = Math.max(0, this._height - viewportHeight);
        const centerX = -halfWidth + (viewportWidth / 2) + availableWidth * colNorm;
        const centerY = halfHeight - (viewportHeight / 2) - availableHeight * rowNorm;
        this.viewportMesh.position.x = centerX;
        this.viewportMesh.position.y = centerY;
    }

    _applyDimensions() {
        this.mainMesh.scaling.x = this._width;
        this.mainMesh.scaling.y = this._height;
        this.handles.forEach(handle => {
            const { signX, signY } = handle.metadata;
            handle.position.x = signX * this._width / 2;
            handle.position.y = signY * this._height / 2;
            handle.position.z = 0.002;
        });
        this.viewportMesh.position.z = 0.003;
    }

    _computeAutoDimensions(totalRows, totalCols) {
        const rows = Math.max(1, totalRows || 1);
        const cols = Math.max(1, totalCols || 1);
        const aspect = cols / rows;

        let width = Math.sqrt(BASE_AREA * aspect);
        let height = width / aspect;

        if (!Number.isFinite(width) || width <= 0) width = DEFAULT_WIDTH;
        if (!Number.isFinite(height) || height <= 0) height = DEFAULT_HEIGHT;

        const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

        width = clamp(width, MIN_WIDTH, MAX_WIDTH);
        height = clamp(height, MIN_HEIGHT, MAX_HEIGHT);

        const adjustedAspect = width / height;
        if (adjustedAspect > aspect && height < MAX_HEIGHT) {
            const candidateHeight = clamp(width / aspect, MIN_HEIGHT, MAX_HEIGHT);
            width = clamp(candidateHeight * aspect, MIN_WIDTH, MAX_WIDTH);
            height = candidateHeight;
        } else if (adjustedAspect < aspect && width < MAX_WIDTH) {
            const candidateWidth = clamp(height * aspect, MIN_WIDTH, MAX_WIDTH);
            height = clamp(candidateWidth / aspect, MIN_HEIGHT, MAX_HEIGHT);
            width = candidateWidth;
        }

        return { width, height };
    }

    _resolveDatasetMetrics() {
        const totalRows = Math.max(1, this.layout?.totalRows ?? 1);
        const totalCols = Math.max(1, this.layout?.totalCols ?? 1);
        return { totalRows, totalCols };
    }

    getScrollSensitivity() {
        const row = this._height / DEFAULT_HEIGHT;
        const col = this._width / DEFAULT_WIDTH;
        return {
            row: Number.isFinite(row) && row > 0 ? row : 1,
            col: Number.isFinite(col) && col > 0 ? col : 1
        };
    }

    dispose() {
        this.root.dispose();
    }
}

export default MinimapVisualization;
