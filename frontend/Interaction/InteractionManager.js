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
                        const pointer = ctrl.pointer || ctrl.grip || ctrl;
                        if (!pointer.getAbsolutePosition) return null;
                        const origin = pointer.getAbsolutePosition();
                        const fwd = pointer.forward ? pointer.forward.clone() : new BABYLON.Vector3(0, 0, 1);
                        return new BABYLON.Ray(origin, fwd, length);
                    };

                    let hoverObserver = null;
                    let lastIndex = null;

                    triggerComponent.onButtonStateChangedObservable.add(component => {
                        // only react to state changes on the pressed flag
                        if (!component.changes.pressed) return;

                        if (component.pressed) {
                            // start continuous per-frame picking while held
                            hoverObserver = this.scene.onBeforeRenderObservable.add(() => {
                                let pickInfo = null;
                                const ps = this.xrHelper.pointerSelection;
                                if (ps && typeof ps.getMeshUnderPointer === 'function') {
                                    pickInfo = ps.getMeshUnderPointer(rightController.uniqueId);
                                }
                                if (!pickInfo || !pickInfo.hit) {
                                    const ray = buildForwardRay(rightController);
                                    if (ray) {
                                        pickInfo = this.scene.pickWithRay(ray, mesh => mesh === this.twoTone.basePlane);
                                    }
                                }
                                if (pickInfo && pickInfo.hit) {
                                    const idx = pickInfo.thinInstanceIndex ?? pickInfo.instanceIndex;
                                    if (idx !== lastIndex) {
                                        console.log("Hovering over instance #", idx);
                                        lastIndex = idx;
                                    }
                                }
                            });
                        } else {
                            // stop logging on release
                            if (hoverObserver) {
                                this.scene.onBeforeRenderObservable.remove(hoverObserver);
                                hoverObserver = null;
                                lastIndex = null;
                            }
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
