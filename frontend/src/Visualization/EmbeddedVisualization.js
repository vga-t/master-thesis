import * as BABYLON from "babylonjs";

const DEFAULT_CHART_COLORS = [
    "#4F46E5",
    "#14B8A6",
    "#F97316",
    "#EC4899",
    "#22D3EE",
    "#84CC16"
];

const MAX_LINE_SERIES = 4;
const MAX_PARALLEL_AXES = 6;
const TEXTURE_WIDTH = 1024;
const TEXTURE_HEIGHT = 512;
const SURFACE_OFFSET = 0.02;

export default class EmbeddedVisualization {
    constructor(scene) {
        this.scene = scene;
        this._material = new BABYLON.StandardMaterial("embeddedVizMaterial", scene);
        this._material.backFaceCulling = false;
        this._material.alpha = 0.98;
        this._material.disableDepthWrite = true;
        this._material.emissiveColor = new BABYLON.Color3(1, 1, 1);
        this._material.useAlphaFromDiffuseTexture = true;

        this._texture = new BABYLON.DynamicTexture("embeddedVizTexture", {
            width: TEXTURE_WIDTH,
            height: TEXTURE_HEIGHT
        }, scene, false, BABYLON.Texture.TRILINEAR_SAMPLINGMODE);
        this._texture.hasAlpha = true;
        this._texture.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
        this._texture.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
        this._material.diffuseTexture = this._texture;

        this._planeMesh = null;
        this._ribbonMesh = null;
        this._lastRibbonPointCount = 0;
        this._ctx = this._texture.getContext();
        this._clearTexture();
    }

    show({ layout, rowIndices, colIndices, geometry, mode = "auto" }) {
        if (!layout || !Array.isArray(rowIndices) || !rowIndices.length || !Array.isArray(colIndices) || !colIndices.length) {
            this.hide();
            return;
        }

        const columnKeys = colIndices
            .map(idx => layout.columnKeys?.[idx])
            .filter(key => typeof key === "string");
        const rowData = rowIndices.map(idx => layout.csvData?.[idx]).filter(Boolean);

        const numericCols = columnKeys.filter(key => {
            const meta = layout.columnMetadata?.[key];
            return meta?.type === "numeric" || meta?.type === "date";
        });

        let chartType = mode;
        if (mode === "auto" || !["line", "parallel"].includes(mode)) {
            chartType = numericCols.length > MAX_LINE_SERIES ? "parallel" : "line";
            if (numericCols.length === 0) {
                chartType = "parallel";
            }
        }

        switch (chartType) {
            case "line":
                this._renderLineChart({ layout, rowData, numericCols, rowIndices });
                break;
            case "parallel":
            default:
                this._renderParallelCoordinates({ layout, rowData, columnKeys });
                break;
        }

        this._texture.update(false);
        this._applyGeometry(geometry);
    }

    hide() {
        this._planeMesh?.setEnabled(false);
        this._ribbonMesh?.setEnabled(false);
    }

    dispose() {
        this.hide();
        this._planeMesh?.dispose();
        this._planeMesh = null;
        this._ribbonMesh?.dispose();
        this._ribbonMesh = null;
        this._texture?.dispose();
        this._texture = null;
        this._ctx = null;
    }

    _renderLineChart({ layout, rowData, numericCols, rowIndices }) {
        const ctx = this._ctx;
        if (!ctx) return;
        this._clearTexture();

        const cols = numericCols.slice(0, MAX_LINE_SERIES);
        const padding = 80;
        const innerWidth = TEXTURE_WIDTH - padding * 2;
        const innerHeight = TEXTURE_HEIGHT - padding * 2;

        ctx.strokeStyle = "#1F2937";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(padding, TEXTURE_HEIGHT - padding);
        ctx.lineTo(TEXTURE_WIDTH - padding / 2, TEXTURE_HEIGHT - padding);
        ctx.moveTo(padding, TEXTURE_HEIGHT - padding);
        ctx.lineTo(padding, padding / 2);
        ctx.stroke();

        if (!rowData.length || !cols.length) {
            this._drawMessage("No numeric data available");
            return;
        }

        cols.forEach((key, idx) => {
            const meta = layout.columnMetadata?.[key];
            const color = DEFAULT_CHART_COLORS[idx % DEFAULT_CHART_COLORS.length];
            ctx.beginPath();
            ctx.lineWidth = 3;
            ctx.strokeStyle = color;
            rowData.forEach((row, rowIdx) => {
                const normalized = this._normalizeValue(meta, row?.[key]);
                const x = padding + (innerWidth * (rowIdx / Math.max(1, rowData.length - 1)));
                const y = padding + (innerHeight * (1 - normalized));
                if (rowIdx === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            });
            ctx.stroke();
            ctx.fillStyle = color;
            ctx.font = "28px Segoe UI";
            ctx.fillText(key, TEXTURE_WIDTH - padding - 160, padding + idx * 32);
        });

        ctx.fillStyle = "#F3F4F6";
        ctx.font = "30px Segoe UI";
        ctx.fillText(`${rowIndices.length} rows • ${cols.length} series`, padding, padding - 20);
    }

    _renderParallelCoordinates({ layout, rowData, columnKeys }) {
        const ctx = this._ctx;
        if (!ctx) return;
        this._clearTexture();

        const axes = columnKeys.slice(0, MAX_PARALLEL_AXES);
        if (!axes.length || !rowData.length) {
            this._drawMessage("Selection too small to plot");
            return;
        }

        const paddingX = 100;
        const paddingY = 60;
        const innerWidth = TEXTURE_WIDTH - paddingX * 2;
        const innerHeight = TEXTURE_HEIGHT - paddingY * 2;

        axes.forEach((key, axisIdx) => {
            const x = paddingX + (innerWidth * (axisIdx / Math.max(1, axes.length - 1)));
            ctx.strokeStyle = "rgba(255,255,255,0.6)";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x, paddingY);
            ctx.lineTo(x, paddingY + innerHeight);
            ctx.stroke();
            ctx.fillStyle = "#E5E7EB";
            ctx.font = "26px Segoe UI";
            ctx.textAlign = "center";
            ctx.fillText(key, x, paddingY - 12);
        });

        rowData.forEach((row, rowIdx) => {
            const color = DEFAULT_CHART_COLORS[rowIdx % DEFAULT_CHART_COLORS.length];
            ctx.beginPath();
            axes.forEach((key, axisIdx) => {
                const meta = layout.columnMetadata?.[key];
                const normalized = this._normalizeValue(meta, row?.[key]);
                const x = paddingX + (innerWidth * (axisIdx / Math.max(1, axes.length - 1)));
                const y = paddingY + innerHeight * (1 - normalized);
                if (axisIdx === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            });
            ctx.strokeStyle = `${color}CC`;
            ctx.globalAlpha = 0.9;
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.globalAlpha = 1;
        });

        ctx.fillStyle = "#F3F4F6";
        ctx.font = "30px Segoe UI";
        ctx.textAlign = "left";
        ctx.fillText(`${rowData.length} rows • ${axes.length} axes`, paddingX, TEXTURE_HEIGHT - paddingY / 2);
    }

    _normalizeValue(meta, value) {
        if (!meta) {
            return 0.5;
        }
        if (typeof meta.normalize === "function") {
            const normalized = meta.normalize(value);
            if (Number.isFinite(normalized)) {
                return Math.max(0, Math.min(1, normalized));
            }
        }
        if (value == null) return 0.5;
        const num = Number(value);
        if (Number.isFinite(num)) {
            return Math.max(0, Math.min(1, num));
        }
        return 0.5;
    }

    _drawMessage(message) {
        const ctx = this._ctx;
        if (!ctx) return;
        this._clearTexture();
        ctx.fillStyle = "#E5E7EB";
        ctx.font = "34px Segoe UI";
        ctx.textAlign = "center";
        ctx.fillText(message, TEXTURE_WIDTH / 2, TEXTURE_HEIGHT / 2);
    }

    _clearTexture() {
        const ctx = this._ctx;
        if (!ctx) return;
        ctx.fillStyle = "rgba(15, 23, 42, 0.92)";
        ctx.fillRect(0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT);
        ctx.textAlign = "left";
    }

    _applyGeometry(geometry) {
        if (!geometry) {
            this.hide();
            return;
        }

        const canUseRibbon = geometry.topEdge?.length >= 2 && geometry.bottomEdge?.length >= 2;
        if (canUseRibbon) {
            this._applyCurvedGeometry(geometry);
        } else {
            this._applyPlanarGeometry(geometry);
        }
    }

    _applyCurvedGeometry(geometry) {
        const topPath = geometry.topEdge.map(point => point.add(geometry.normal.scale(SURFACE_OFFSET)));
        const bottomPath = geometry.bottomEdge.map(point => point.add(geometry.normal.scale(SURFACE_OFFSET)));
        const pathArray = [bottomPath, topPath];

        if (!this._ribbonMesh || this._lastRibbonPointCount !== topPath.length) {
            this._ribbonMesh?.dispose();
            this._ribbonMesh = BABYLON.MeshBuilder.CreateRibbon("embeddedVizRibbon", {
                pathArray,
                sideOrientation: BABYLON.Mesh.DOUBLESIDE,
                updatable: true
            }, this.scene);
            this._ribbonMesh.isPickable = false;
            this._ribbonMesh.renderingGroupId = 2;
            this._ribbonMesh.material = this._material;
            this._lastRibbonPointCount = topPath.length;
        } else {
            BABYLON.MeshBuilder.CreateRibbon(null, {
                pathArray,
                instance: this._ribbonMesh
            });
        }
        this._ribbonMesh.setEnabled(true);
        this._planeMesh?.setEnabled(false);
    }

    _applyPlanarGeometry(geometry) {
        const widthLen = geometry.widthVec?.length() ?? 0;
        const heightLen = geometry.heightVec?.length() ?? 0;
        if (widthLen <= 0 || heightLen <= 0) {
            this.hide();
            return;
        }

        const plane = this._ensurePlaneMesh();
        const basisX = geometry.widthVec.clone().normalize();
        const basisY = geometry.heightVec.clone().normalize();
        const basisZ = geometry.normal.clone().normalize();
        const rotation = BABYLON.Quaternion.FromLookDirectionLH(basisZ, basisY);
        plane.rotationQuaternion = rotation;
        plane.scaling.x = widthLen;
        plane.scaling.y = heightLen;
        plane.position = geometry.center.add(basisZ.scale(SURFACE_OFFSET));
        plane.setEnabled(true);
        this._ribbonMesh?.setEnabled(false);
    }

    _ensurePlaneMesh() {
        if (this._planeMesh) return this._planeMesh;
        this._planeMesh = BABYLON.MeshBuilder.CreatePlane("embeddedVizPlane", {
            width: 1,
            height: 1,
            sideOrientation: BABYLON.Mesh.DOUBLESIDE
        }, this.scene);
        this._planeMesh.billboardMode = BABYLON.Mesh.BILLBOARDMODE_NONE;
        this._planeMesh.isPickable = false;
        this._planeMesh.renderingGroupId = 2;
        this._planeMesh.material = this._material;
        this._planeMesh.setEnabled(false);
        return this._planeMesh;
    }
}
