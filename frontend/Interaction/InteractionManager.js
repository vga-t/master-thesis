export class InteractionManager {
    constructor(layout, { heatMap, twoTone }, xrHelper, scene) {
        this.xrHelper = xrHelper;
        this.scene = scene;
        this.layout = layout;
        this.heatMap = heatMap;
        this.twoTone = twoTone;
        this.fisheyeAxis = 'column'; // 'column' or 'row'
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
                    let lastIndex = null; // thin instance index
                    let fisheyeActive = false;
                    const originalMatrix = this.layout.getOriginalPositionMatrix();

                    const applyFisheye = (flatIndex) => {
                        if (flatIndex == null) return;
                        // parameters could be dynamic later (e.g., trigger pressure -> divisor)
                        // Smaller divisors -> larger focused span (dominance is enforced in layout functions)
                        const colDivisor = 12; // focused column spans 1/colDivisor of arc
                        const rowDivisor = 2; // focused row spans 1/rowDivisor of vertical span
                        const sigma = 1.4;     // neighborhood falloff
                        const minFactor = 0.1; // min relative size for distant segments
                        const edgeSafety = 0.94; // shrink a bit to avoid grazing
                        let distorted;
                        if (this.fisheyeAxis === 'column') {
                            const focusCol = flatIndex % this.layout.numCols;
                            distorted = this.layout.computeColumnFocusLayout(focusCol, colDivisor, sigma, minFactor, edgeSafety);
                        } else {
                            const focusRow = Math.floor(flatIndex / this.layout.numCols);
                            distorted = this.layout.computeRowFocusLayout(focusRow, rowDivisor, sigma, minFactor, edgeSafety);
                        }
                        if (!distorted) return;
                        if (this.heatMap && this.heatMap.basePlane) {
                            this.heatMap.basePlane.thinInstanceSetBuffer("matrix", distorted, 16);
                        }
                        if (this.twoTone && this.twoTone.basePlane) {
                            this.twoTone.basePlane.thinInstanceSetBuffer("matrix", distorted, 16);
                        }
                    };

                    const restore = () => {
                        if (!fisheyeActive) return;
                        if (this.heatMap && this.heatMap.basePlane) {
                            this.heatMap.basePlane.thinInstanceSetBuffer("matrix", originalMatrix, 16);
                        }
                        if (this.twoTone && this.twoTone.basePlane) {
                            this.twoTone.basePlane.thinInstanceSetBuffer("matrix", originalMatrix, 16);
                        }
                        fisheyeActive = false;
                    };

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
                                        // try pick against whichever basePlane is currently visible; fallback to twoTone
                                        const targetMesh = this.twoTone.basePlane.isVisible ? this.twoTone.basePlane : this.heatMap.basePlane;
                                        pickInfo = this.scene.pickWithRay(ray, mesh => mesh === targetMesh);
                                    }
                                }
                                if (pickInfo && pickInfo.hit) {
                                    const idx = pickInfo.thinInstanceIndex ?? pickInfo.instanceIndex;
                                    if (idx !== lastIndex && idx != null) {
                                        lastIndex = idx;
                                        applyFisheye(idx);
                                        fisheyeActive = true;
                                    }
                                }
                            });
                        } else {
                            // stop and restore on release
                            if (hoverObserver) {
                                this.scene.onBeforeRenderObservable.remove(hoverObserver);
                                hoverObserver = null;
                            }
                            lastIndex = null;
                            restore();
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


    setFisheyeAxis(axis) {
        if (axis === 'column' || axis === 'row') {
            this.fisheyeAxis = axis;
            const originalMatrix = this.layout.getOriginalPositionMatrix();
            if (this.heatMap && this.heatMap.basePlane) this.heatMap.basePlane.thinInstanceSetBuffer("matrix", originalMatrix, 16);
            if (this.twoTone && this.twoTone.basePlane) this.twoTone.basePlane.thinInstanceSetBuffer("matrix", originalMatrix, 16);
            console.log(`Fisheye axis switched to ${axis}`);
        }
    }
}
