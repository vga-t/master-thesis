




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
        this.camera = new BABYLON.FreeCamera("camera1", new BABYLON.Vector3(-173.63484490600206, 11.256337394162186, 58.70632204919238), this.scene);
        this.camera.attachControl(this.canvas, true);
        this.camera.setTarget(new BABYLON.Vector3(-170.53427625384904, 5.705425371571549, 77.66875419526477));
        this.camera.rotation = new BABYLON.Vector3(0.28123839653642263, 0.16207686419985148, 0);
    }

    setupLight() {
        this.light = new BABYLON.HemisphericLight("light1", new BABYLON.Vector3(0, 10, 0), this.scene);
        this.light.intensity = 0.7;
    }
    async setupXR() {
        const ground = BABYLON.MeshBuilder.CreateGround("ground", {
            height: 500,
            width: 500, subdivisions: 1
        }, this.scene);

        const groundMaterial = new BABYLON.StandardMaterial("groundMaterial", this.scene);
        groundMaterial.diffuseColor = new BABYLON.Color3(1, 1, 1); // Gray color
        ground.material = groundMaterial;
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