import * as BABYLON from "babylonjs";

export class InteractionManager {
    constructor(layout, { heatMap, twoTone, curvedHeat, curvedTwoTone, cartesian }, xrHelper, scene) {
        this.xrHelper = xrHelper;
        this.scene = scene;
        this.layout = layout;
        this.heatMap = heatMap;
        this.twoTone = twoTone;
        this.curvedHeat = curvedHeat;
        this.curvedTwoTone = curvedTwoTone;
        this.cartesian = cartesian; // optional controller
        this.fisheyeAxis = 'column'; // 'column' or 'row'

        if (this.heatMap?.basePlane) {
            this.heatMap.basePlane.isPickable = true;
            this.heatMap.basePlane.thinInstanceEnablePicking = true;
        }

        if (this.twoTone?.basePlane) {
            this.twoTone.basePlane.isPickable = true;
            this.twoTone.basePlane.thinInstanceEnablePicking = true;
        }

        this.curvedHeat?.mesh && (this.curvedHeat.mesh.isPickable = true);
        this.curvedTwoTone?.mesh && (this.curvedTwoTone.mesh.isPickable = true);



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
                    let cartesianActive = false;
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

                    const disableCartesian = () => {
                        if (this.cartesian && cartesianActive) {
                            this.cartesian.setEnabled(false);
                            cartesianActive = false;
                        }
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
                                        // Prefer currently visible curved meshes; else fallback to instanced
                                        const visibleCurved = (this.curvedTwoTone?.mesh?.isVisible ? this.curvedTwoTone.mesh : null)
                                            || (this.curvedHeat?.mesh?.isVisible ? this.curvedHeat.mesh : null);
                                        if (visibleCurved) {
                                            pickInfo = this.scene.pickWithRay(ray, mesh => mesh === visibleCurved);
                                        }
                                        if (!pickInfo || !pickInfo.hit) {
                                            const targetMesh = this.twoTone.basePlane.isVisible ? this.twoTone.basePlane : this.heatMap.basePlane;
                                            pickInfo = this.scene.pickWithRay(ray, mesh => mesh === targetMesh);
                                        }
                                    }
                                }
                                if (pickInfo && pickInfo.hit) {
                                    const hitMesh = pickInfo.pickedMesh;
                                    const isCurved = (this.curvedHeat && hitMesh === this.curvedHeat.mesh) || (this.curvedTwoTone && hitMesh === this.curvedTwoTone.mesh);
                                    if (isCurved) {
                                        // compute normalized (u,v) from picked point on curved cylinder
                                        const p = pickInfo.pickedPoint;
                                        if (p && this.cartesian) {
                                            const R = this.layout.radius;
                                            const angle = Math.atan2(p.x, p.z + R); // sin= x/R, cos=(z+R)/R
                                            const u = (angle / this.layout.arcAngle) + 0.5; // [-0.5..0.5] -> [0..1]
                                            const visualRows = this.layout.numRows - 1;
                                            const h = visualRows * this.layout.cellHeight;
                                            const centerYOffset = this.layout.groundOffset + (visualRows / 2 + 0.5) * this.layout.cellHeight;
                                            const zOrig = p.y - centerYOffset; // original ground z
                                            const v = (zOrig + h / 2) / h;
                                            const uClamped = Math.max(0, Math.min(1, u));
                                            const vClamped = Math.max(0, Math.min(1, v));
                                            this.cartesian.setFocus(uClamped, vClamped);
                                            if (!cartesianActive) {
                                                this.cartesian.setEnabled(true);
                                                cartesianActive = true;
                                            }
                                        }
                                        // while in curved mode, ensure fisheye is off
                                        if (fisheyeActive) restore();
                                    } else {
                                        const idx = pickInfo.thinInstanceIndex ?? pickInfo.instanceIndex;
                                        if (idx !== lastIndex && idx != null) {
                                            lastIndex = idx;
                                            applyFisheye(idx);
                                            fisheyeActive = true;
                                            // turn off cartesian if was on
                                            disableCartesian();
                                        }
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
                            disableCartesian();
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
