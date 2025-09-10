import * as BABYLON from "babylonjs";

export class BarsVisualization {
    constructor(layout, scene) {
        const { positionMatrix, dataArray } = layout.computeCellPositions();
        this.positionMatrix = positionMatrix;
        this.dataArray = dataArray;
        this.layout = layout;
        this.scene = scene;
        this.cellWidth = layout.cellWidth;
        this.cellHeight = layout.cellHeight;
        this.numCols = layout.numCols;
        this.numRows = layout.numRows;

        // 1) Create one template plane
        this.basePlane = BABYLON.MeshBuilder.CreatePlane("barPlane", {
            width: this.cellWidth,
            height: this.cellHeight,
            sideOrientation: BABYLON.Mesh.DOUBLESIDE
        }, scene);

        // 2) Inject custom shaders
        BABYLON.Effect.ShadersStore["barsVertexShader"] = `
            precision highp float;
            attribute vec3 position;
            attribute vec2 uv;
            attribute vec4 world0;
            attribute vec4 world1;
            attribute vec4 world2;
            attribute vec4 world3;
            attribute float split;
            uniform mat4 viewProjection;
            varying vec2 vUV;
            varying float vSplit;
            void main() {
                vUV    = uv;
                vSplit = split;
                mat4 world = mat4(world0, world1, world2, world3);
                gl_Position = viewProjection * world * vec4(position, 1.0);
            }
        `;
        BABYLON.Effect.ShadersStore["barsFragmentShader"] = `
            precision highp float;
            varying vec2 vUV;
            varying float vSplit;
            void main() {
                if (vUV.x < vSplit) {
                    
                    gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);
                } else {
                    gl_FragColor = vec4(0.827, 0.827, 0.827, 1);
                }
            }
        `;

        // 3) Create ShaderMaterial
        const mat = new BABYLON.ShaderMaterial("barsMat", scene, {
            vertex: "bars",
            fragment: "bars"
        }, {
            attributes: ["position", "uv", "world0", "world1", "world2", "world3", "split"],
            uniforms: ["viewProjection"]
        });
        // mat.backFaceCulling = false;
        // mat.needAlphaBlending = true;
        this.basePlane.material = mat;
    }

    render() {
        // build one float per instance for "split"
        const splitArr = new Float32Array(this.dataArray.length);
        for (let i = 0; i < splitArr.length; i++) {
            // normalize 0..1 (clamp)
            let t = this.dataArray[i];
            if (t == null || isNaN(t)) { t = 1.0; }           // categorical/constant → full
            t = Math.max(0, Math.min(1, t));
            splitArr[i] = t;
        }

        // feed instance buffers
        this.basePlane.thinInstanceSetBuffer("matrix", this.positionMatrix, 16);
        this.basePlane.thinInstanceSetBuffer("split", splitArr, 1);
    }

    dispose() {
        this.basePlane.dispose();
    }
}

export default BarsVisualization;

