import * as BABYLON from "babylonjs";

class SceneManager {
    constructor(canvasId, radius) {
        this.canvas = document.getElementById(canvasId);
        this.engine = new BABYLON.Engine(this.canvas, true, { xrCompatible: true });
        this.scene = new BABYLON.Scene(this.engine);
        this.light = null;
        this.camera = null;
        this.radius = radius;
        // this.xrHelper = null;
        this.scene.clearColor = new BABYLON.Color4(0, 0, 0, .8);

        this._setupCamera();
        this._setupLight();

        this._runRenderLoop();

    }

    _setupCamera() {
        this.camera = new BABYLON.UniversalCamera("camera1", new BABYLON.Vector3(-8.06, 13.38, -96.64), this.scene);
        this.camera.attachControl(this.canvas, true);
        // this.camera.position = new BABYLON.Vector3(0.6, 0.5, -5.5);
        // this.camera.setTarget(new BABYLON.Vector3(-1.0, 5.1, 13.9));
        this.camera.position = new BABYLON.Vector3(0, 1.6, - this.radius);
        this.camera.setTarget = new BABYLON.Vector3(0, 3.0, 0);
        this.camera.rotation = new BABYLON.Vector3(-0.1, 0, 0.0);


    }

    _setupLight() {
        this.light = new BABYLON.HemisphericLight("light1", new BABYLON.Vector3(0, 10, 0), this.scene);
        this.light.intensity = 0.7;
    }
    async setupXR(radius) {
        const ground = BABYLON.MeshBuilder.CreateGround("ground", {
            height: radius * 200 + 30,
            width: radius * 200 + 30, subdivisions: 1
        }, this.scene);

        ground.position.y = .1;
        const groundMaterial = new BABYLON.StandardMaterial("groundMaterial", this.scene);
        groundMaterial.diffuseColor = new BABYLON.Color3(1, 1, 1); // Gray color
        ground.material = groundMaterial;
        const xrHelper = await this.scene.createDefaultXRExperienceAsync({
            floorMeshes: [ground],
            optionalFeatures: true
        });
        const featuresManager = xrHelper?.baseExperience?.featuresManager;
        if (featuresManager) {
            const teleportation = featuresManager.getEnabledFeature?.(BABYLON.WebXRFeatureName.TELEPORTATION);
            if (teleportation?.detach) {
                teleportation.detach();
            }
            try {
                featuresManager.enableFeature(
                    BABYLON.WebXRFeatureName.TELEPORTATION,
                    "latest",
                    {
                        xrInput: xrHelper.input,
                        floorMeshes: [ground],
                        forceHandedness: "right"
                    }
                );
            } catch (error) {
                console.warn("Unable to reconfigure teleportation feature", error);
            }
        }
        return xrHelper;



    }

    setupMultiRayCasting(xrHelper) {
        if (!xrHelper?.baseExperience?.featuresManager) return;

        xrHelper.baseExperience.featuresManager.enableFeature(
            BABYLON.WebXRFeatureName.POINTER_SELECTION,
            "latest", {
            xrInput: xrHelper.input,
            enablePointerSelectionOnAllControllers: true,
            renderingGroupId: 1
        }
        );
    }



    _runRenderLoop() {
        this.engine.runRenderLoop(() => {
            this.scene.render();
        });
    }

}


export default SceneManager;