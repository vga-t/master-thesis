class SceneManager {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.engine = new BABYLON.Engine(this.canvas, true);
        this.scene = new BABYLON.Scene(this.engine);
        this.light = null;
        this.camera = null;
        // this.xrHelper = null;
        this.scene.clearColor = new BABYLON.Color4(0, 0, 0, .8);

        this._setupCamera();
        this._setupLight();

        this._runRenderLoop();

    }

    _setupCamera() {
        this.camera = new BABYLON.UniversalCamera("camera1", new BABYLON.Vector3(-8.06, 13.38, -96.64), this.scene);
        this.camera.attachControl(this.canvas, true);
        this.camera.position = new BABYLON.Vector3(0.6, 0.5, -5.5);
        this.camera.setTarget(new BABYLON.Vector3(-1.0, 5.1, 13.9));
        this.camera.rotation = new BABYLON.Vector3(-0.2, -0.1, 0.0);


    }

    _setupLight() {
        this.light = new BABYLON.HemisphericLight("light1", new BABYLON.Vector3(0, 10, 0), this.scene);
        this.light.intensity = 0.7;
    }
    async setupXR() {
        const ground = BABYLON.MeshBuilder.CreateGround("ground", {
            height: 500,
            width: 500, subdivisions: 1
        }, this.scene);

        ground.position.y = .1;

        const groundMaterial = new BABYLON.StandardMaterial("groundMaterial", this.scene);
        groundMaterial.diffuseColor = new BABYLON.Color3(1, 1, 1); // Gray color
        ground.material = groundMaterial;
        const xrHelper = await this.scene.createDefaultXRExperienceAsync({
            floorMeshes: [ground]
        });
        return xrHelper;



    }



    _runRenderLoop() {
        this.engine.runRenderLoop(() => {
            this.scene.render();
        });
    }

}


export default SceneManager;