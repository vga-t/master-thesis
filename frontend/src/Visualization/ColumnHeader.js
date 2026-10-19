import * as BABYLON from "babylonjs";
import * as GUI from "babylonjs-gui";

export default class ColumnHeaders {
    constructor(layout, scene) {
        this.layout = layout;
        this.scene = scene;
        this.headers = [];
        this.lastKeys = [];
        this.layoutObserver = this.layout.addObserver((snapshot, changeType) => {
            this.render(snapshot, changeType);
        });
    }

    createHeader() {
        const plane = BABYLON.MeshBuilder.CreatePlane("header_pool", {
            width: 1,
            height: 0.6
        }, this.scene);

        const advancedTexture = GUI.AdvancedDynamicTexture.CreateForMesh(plane, 512, 256);
        const textBlock = new GUI.TextBlock();

        textBlock.textWrapping = GUI.TextWrapping.WordWrap;
        textBlock.color = "white";
        textBlock.fontSize = 80;
        textBlock.fontWeight = "bold";
        textBlock.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        textBlock.textVerticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;

        advancedTexture.addControl(textBlock);

        return { mesh: plane, texture: advancedTexture, textBlock: textBlock };
    }

    render(snapshot, changeType) {
        if (!snapshot || snapshot.colCount === 0) {
            this.headers.forEach(h => h.mesh.setEnabled(false));
            return;
        }

        const currentKeys = snapshot.columnKeys;
        const keysChanged = !this.lastKeys ||
            this.lastKeys.length !== currentKeys.length ||
            !this.lastKeys.every((k, i) => k === currentKeys[i]);

        if (changeType === 'data_only' && !keysChanged) {
            return;
        }

        this.lastKeys = [...currentKeys];

        const radius = this.layout.radius;
        const totalArc = this.layout.arcAngle;
        const HEADER_PADDING = 0.3;
        const topY = this.layout.groundOffset + this.layout.height + HEADER_PADDING;

        const startAngle = -totalArc / 2;
        let angleCursor = startAngle;

        // Ensure pool size
        while (this.headers.length < snapshot.colCount) {
            this.headers.push(this.createHeader());
        }

        for (let i = 0; i < snapshot.colCount; i++) {
            const header = this.headers[i];
            header.mesh.setEnabled(true);

            const colKey = snapshot.columnKeys[i];
            const weight = snapshot.colWeights[i] || (1 / snapshot.colCount);
            const spanAngle = weight * totalArc;
            const centerAngle = angleCursor + (spanAngle / 2);
            const chordWidth = 2 * radius * Math.sin(spanAngle / 2);

            const x = radius * Math.sin(centerAngle);
            const z = radius * Math.cos(centerAngle) - radius;

            header.mesh.position.set(x, topY, z);
            if (!header.mesh.rotationQuaternion) {
                header.mesh.rotationQuaternion = BABYLON.Quaternion.RotationYawPitchRoll(centerAngle, 0, 0);
            } else {
                BABYLON.Quaternion.RotationYawPitchRollToRef(centerAngle, 0, 0, header.mesh.rotationQuaternion);
            }
            header.mesh.scaling.x = chordWidth * 0.95;

            if (header.textBlock.text !== colKey) {
                header.textBlock.text = colKey;
            }

            angleCursor += spanAngle;
        }

        // Hide unused
        for (let i = snapshot.colCount; i < this.headers.length; i++) {
            this.headers[i].mesh.setEnabled(false);
        }
    }

    dispose() {
        if (this.layoutObserver) {
            this.layoutObserver();
        }
        this.headers.forEach(h => {
            h.mesh.dispose();
            h.texture.dispose();
        });
        this.headers = [];
    }
}
