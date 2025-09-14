import { FocusContext } from "./FocusContext";

export class InteractionManager {
    constructor(layout, { heatMap, twoTone }, xrHelper, scene) {
        this.xrHelper = xrHelper;
        this.scene = scene;
        this.heatMap = heatMap;
        this.twoTone = twoTone;
        this.heatMap.basePlane.isPickable = true;
        this.twoTone.basePlane.isPickable = true;

        this.heatMap.basePlane.thinInstanceEnablePicking = true;
        this.twoTone.basePlane.thinInstanceEnablePicking = true;

        // this.leftController = null;
        // this.rightController = null;
        // this.leftControllerId = null;
        // this.rightControllerId = null;
        // this.leftTriggerComponent = null;
        // this.rightTriggerComponent = null;
        // this.leftSqueezeComponent = null;
        // this.rightSqueezeComponent = null;
        // this.leftXButtonComponent = null;
        // this.leftYButtonComponent = null;
        // this.rightAButtonComponent = null;
        // this.rightBButtonComponent = null;
        // this.menuButtonComponent = null;
        this._setupVRControllers();


    }
    _setupVRControllers() {


        if (!this.xrHelper) {
            console.warn("The browser doesn't support WebXR, therefore XR experience can't be initiated")
        }
        this.xrHelper.input.onControllerAddedObservable.add((controller) => {

            controller.onMotionControllerInitObservable.add((motionController) => {
                const triggerComponent = motionController.getComponent('xr-standard-trigger');
                const squeezeComponent = motionController.getComponent('xr-standard-squeeze');
                const xComponent = motionController.getComponent('x-button');
                const yComponent = motionController.getComponent('y-button');
                const aComponent = motionController.getComponent('a-button');
                const bComponent = motionController.getComponent('b-button');
                const menuComponent = motionController.getComponent('menu');

                if (motionController.handness === "right") {
                    const rightController = controller;

                    // helper to build a forward ray manually if pointerSelection forward ray unavailable
                    const buildForwardRay = (ctrl, length = 100) => {
                        const pointer = ctrl.pointer || ctrl.grip || ctrl; // TransformNode
                        if (!pointer.getAbsolutePosition) return null;
                        const origin = pointer.getAbsolutePosition();
                        // forward is a getter vector3 in Babylon; clone to avoid mutation
                        const fwd = pointer.forward ? pointer.forward.clone() : new BABYLON.Vector3(0, 0, 1);
                        return new BABYLON.Ray(origin, fwd, length);
                    };

                    triggerComponent.onButtonStateChangedObservable.add(() => {
                        if (!(triggerComponent.changes.pressed && triggerComponent.pressed)) return;
                        console.log("Right trigger pressed");

                        // 1) Try Babylon’s XR pointer‐selection “mesh under pointer” (if feature exists)
                        const ps = this.xrHelper.pointerSelection;
                        let pickInfo = ps && ps.getMeshUnderPointer ? ps.getMeshUnderPointer(rightController.uniqueId) : null;

                        if (pickInfo && pickInfo.hit && pickInfo.pickedMesh === this.twoTone.basePlane) {
                            const idx = pickInfo.thinInstanceIndex ?? pickInfo.instanceIndex;
                            console.log("Selected thin-instance index:", idx);
                            return;
                        }

                        // 2) Fallback: use pointerSelection forward ray if available
                        let ray = null;
                        if (ps && typeof ps.getForwardRay === 'function') {
                            try {
                                ray = ps.getForwardRay(rightController.uniqueId);
                            } catch { /* ignore and build manually */ }
                        }
                        if (!ray) {
                            ray = buildForwardRay(rightController);
                        }
                        if (!ray) {
                            console.warn('Unable to construct forward ray for controller');
                            return;
                        }
                        const pick = this.scene.pickWithRay(ray, mesh => mesh === this.twoTone.basePlane);
                        if (pick && pick.hit) {
                            const idx = pick.thinInstanceIndex ?? pick.instanceIndex;
                            console.log("Selected thin-instance index (ray fallback):", idx);
                        }
                    });
                }
                else if (motionController.handness === "left") {

                    triggerComponent.onButtonStateChangedObservable.add(() => {
                        if (triggerComponent.pressed) {
                            console.log("You just clicked left trigger");
                        }
                    });

                }


            })
        })

    }


}
