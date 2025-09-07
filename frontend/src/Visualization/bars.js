
import * as BABYLON from "babylonjs";

export const barsConfig = {
    minValue: 0,
    maxValue: 1,
    barMaxHeight: 1, // relative to cellHeight
    barWidthRatio: 0.8, // fraction of cell width
    columnColors: [
        [0.8, 0.2, 0.2], // red
        [0.2, 0.6, 0.8], // blue
        [0.2, 0.8, 0.4], // green
        [0.8, 0.6, 0.2], // orange
        [0.6, 0.2, 0.8], // purple
        [0.8, 0.4, 0.6]  // pink
    ]
};

export class BarsVisualization {
    constructor(layout, { barsConfig }, scene) {
        const { positionMatrix, dataArray } = layout.computeCellPositions();
        this.positionMatrix = positionMatrix;
        this.dataArray = dataArray;
        this.config = barsConfig;
        this.scene = scene;

        this.cellWidth = layout.cellWidth;
        this.cellHeight = layout.cellHeight;
        this.numCols = layout.numCols;
        this.numRows = layout.numRows;

        // Base plane mesh (unit height = 1)
        this.basePlane = BABYLON.MeshBuilder.CreatePlane(
            "barPlane",
            {
                width: this.cellWidth * this.config.barWidthRatio,
                height: 1,
                sideOrientation: BABYLON.Mesh.DOUBLESIDE
            },
            scene
        );

        // --- Custom Shader ---
        BABYLON.Effect.ShadersStore["barsVertexShader"] = `
            precision highp float;
            attribute vec3 position;
            attribute vec2 uv;
            attribute vec4 world0;
            attribute vec4 world1;
            attribute vec4 world2;
            attribute vec4 world3;
            attribute float instanceScale;
            attribute vec4 instanceColor;
            uniform mat4 viewProjection;
            varying vec2 vUV;
            varying vec4 vColor;
            void main(void) {
                vUV = uv;
                vColor = instanceColor;
                mat4 world = mat4(world0, world1, world2, world3);
                // scale in Y around bottom edge
                vec3 scaledPos = position;
                scaledPos.y *= instanceScale;
                scaledPos.y -= 0.5; // move pivot to bottom
                scaledPos.y += instanceScale / 2.0;
                gl_Position = viewProjection * world * vec4(scaledPos, 1.0);
            }
        `;

        BABYLON.Effect.ShadersStore["barsFragmentShader"] = `
            precision highp float;
            varying vec2 vUV;
            varying vec4 vColor;
            void main(void) {
                gl_FragColor = vColor;
            }
        `;

        const shaderMat = new BABYLON.ShaderMaterial("barsMat", scene, {
            vertex: "bars",
            fragment: "bars"
        }, {
            attributes: ["position", "uv", "world0", "world1", "world2", "world3", "instanceScale", "instanceColor"],
            uniforms: ["viewProjection"]
        });

        this.basePlane.material = shaderMat;
        this.basePlane.isVisible = false;
    }

    render() {
        const matrixData = [];
        const scaleData = [];
        const colorData = [];

        for (let i = 0; i < this.dataArray.length; i++) {
            const raw = this.dataArray[i];

            // Clamp and normalize
            const v = Math.max(this.config.minValue, Math.min(this.config.maxValue, raw));
            const norm = (v - this.config.minValue) / (this.config.maxValue - this.config.minValue);

            // Scale height relative to cell height (in world units)
            const scaleY = norm * this.config.barMaxHeight * this.cellHeight;

            // Extract original transform from layout
            const world = BABYLON.Matrix.FromArray(this.positionMatrix, i * 16);

            // Push original world matrix (no scaling baked in)
            matrixData.push(...world.asArray());

            // Per-instance scale factor (relative to base height=1)
            scaleData.push(scaleY);

            // Assign color based on column index
            const colIndex = i % this.numCols;
            const colColor = this.config.columnColors[colIndex % this.config.columnColors.length];
            colorData.push(colColor[0], colColor[1], colColor[2], 1);
        }

        this.basePlane.thinInstanceSetBuffer("matrix", matrixData, 16);
        this.basePlane.thinInstanceSetBuffer("instanceScale", scaleData, 1);
        this.basePlane.thinInstanceSetBuffer("instanceColor", colorData, 4);
    }
}
