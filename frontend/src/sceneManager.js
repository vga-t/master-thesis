

class SceneManager {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.engine = new BABYLON.Engine(this.canvas, true);
        this.scene = new BABYLON.Scene(this.engine);
        this.light = null;
        this.camera = null;
        this.xrHelper = null;

        this.setupCamera();
        this.setupLight();
        this.setupXR();
        this.runRenderLoop();

    }

    setupCamera() {
        this.camera = new BABYLON.FreeCamera("camera1", new BABYLON.Vector3(0, 0, -20), this.scene);
        this.camera.attachControl(this.canvas, true);
        this.camera.setTarget(BABYLON.Vector3.Zero());
    }

    setupLight() {
        this.light = new BABYLON.HemisphericLight("light1", new BABYLON.Vector3(0, 10, 0), scene);
        this.light.intensity = 0.7;
    }
    async setupXR() {
        const ground = BABYLON.MeshBuilder.CreateGround("ground", {
            height: 500,
            width: 500, subdivisions: 1
        }, this.scene);

        this.xrHelper = await this.scene.createDefaultXRExperienceAsync({
            floorMeshes: [ground]
        });

    }

    runRenderLoop() {
        this.engine.runRenderLoop(() => {
            this.scene.render();
        });
    }

}


export default SceneManager;