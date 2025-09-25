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
        this.cartesian = cartesian; 
        this.fisheyeAxis = 'column';

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

                    const buildForwardRay = (ctrl, length = 100) => {
                        const pointer = ctrl.pointer || ctrl.grip || ctrl;
                        if (!pointer.getAbsolutePosition) return null;
                        const origin = pointer.getAbsolutePosition();
                        const fwd = pointer.forward ? pointer.forward.clone() : new BABYLON.Vector3(0, 0, 1);
                        return new BABYLON.Ray(origin, fwd, length);
                    };

                    let hoverObserver = null;
                    let lastIndex = null; 
                    let cartesianActive = false;
                    const originalMatrix = this.layout.getOriginalPositionMatrix();

                    const disableCartesian = () => {
                        if (this.cartesian && cartesianActive) {
                            this.cartesian.setEnabled(false);
                            cartesianActive = false;
                        }
                    };

                    triggerComponent.onButtonStateChangedObservable.add(component => {
                        if (!component.changes.pressed) return;

                        if (component.pressed) {
                            hoverObserver = this.scene.onBeforeRenderObservable.add(() => {
                                let pickInfo = null;
                                const ps = this.xrHelper.pointerSelection;
                                if (ps && typeof ps.getMeshUnderPointer === 'function') {
                                    pickInfo = ps.getMeshUnderPointer(rightController.uniqueId);
                                    // console.log("pickInfo from getMeshUnderPointer, pickInfo:", pickInfo);
                                    // console.log("Thin instance index of picked mesh:", pickInfo.thinInstanceIndex);
                                }
                                if (!pickInfo || !pickInfo.hit) {
                                    const ray = buildForwardRay(rightController);
                                    if (ray) {

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
                                        const p = pickInfo.pickedPoint;
                                        if (p && this.cartesian) {
                                            // console.log(`Picked point in 3D ${p}`);
                                            const R = this.layout.radius;
                                            const angle = Math.atan2(p.x, p.z + R); 
                                            const u = (angle / this.layout.arcAngle) + 0.5; 
                                            const visualRows = this.layout.numRows - 1;
                                            const h = visualRows * this.layout.cellHeight;
                                            const centerYOffset = this.layout.groundOffset + (visualRows / 2 + 0.5) * this.layout.cellHeight;
                                            const zOrig = p.y - centerYOffset; 
                                            const v = (zOrig + h / 2) / h;
                                            const uClamped = Math.max(0, Math.min(1, u));
                                            const vClamped = Math.max(0, Math.min(1, v));
                                            this.cartesian.setFocus(uClamped, vClamped);
                                            if (!cartesianActive) {
                                                this.cartesian.setEnabled(true);
                                                cartesianActive = true;
                                            }
                                        }
                                    } else {
                                        const idx = pickInfo.thinInstanceIndex ?? pickInfo.instanceIndex;
                                        if (idx !== lastIndex && idx != null) {
                                            lastIndex = idx;
                                            console.log("Picked thin-instance index:", idx);
                                            disableCartesian();
                                        }
                                    }
                                }
                            });
                        } else {
                            if (hoverObserver) {
                                this.scene.onBeforeRenderObservable.remove(hoverObserver);
                                hoverObserver = null;
                            }
                            lastIndex = null;
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


}
