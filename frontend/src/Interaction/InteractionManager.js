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

        this._rowScrollSpeed = Math.max(6, Math.round(this.layout.visibleRows / 1.5));
        this._colScrollSpeed = Math.max(3, Math.round(Math.max(1, this.layout.visibleCols) / 2));
        this._leftScrollVelocity = { row: 0, col: 0 };
        this._scrollAccumulator = { row: 0, col: 0 };
        this._scrollObserver = null;
        this._leftThumbstickComponent = null;
        this._leftThumbstickObserver = null;

        this._ensureScrollObserver();


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
                if (!motionController) return;
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

                    const disableCartesian = () => {
                        if (this.cartesian && cartesianActive) {
                            this.cartesian.setEnabled(false);
                            cartesianActive = false;
                        }
                    };

                    triggerComponent.onButtonStateChangedObservable.add(component => {
                        if (!component.changes.pressed) return;

                        if (component.pressed) {
                            if (this.twoTone.basePlane?.isVisible) {
                                this.curvedTwoTone.render(7);
                                this.twoTone.basePlane.isVisible = false;
                                this.curvedTwoTone.mesh.isVisible = true;
                            } else if (this.heatMap.basePlane?.isVisible) {
                                this.heatMap.basePlane.isVisible = false;
                                this.curvedHeat.mesh.isVisible = true;
                            }
                            hoverObserver = this.scene.onBeforeRenderObservable.add(() => {
                                let pickInfo = null;
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
                                            const visibleRows = Math.max(1, this.layout.visibleRows);
                                            // const bottom = this.layout.groundOffset + this.layout.cellHeight / 2;
                                            // const top = bottom + Math.max(0, (visibleRows - 1) * this.layout.cellHeight);
                                            // const span = Math.max(1e-6, top - bottom);
                                            // const v = (p.y - bottom) / span;
                                            const bottom = this.layout.groundOffset;
                                            const top = bottom + this.layout.height;
                                            const span = Math.max(1e-6, top - bottom);
                                            const v = 1.0 - ((p.y - bottom) / span);
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
                            // On trigger release: revert back to flat visualization
                            if (hoverObserver) {
                                this.scene.onBeforeRenderObservable.remove(hoverObserver);
                                hoverObserver = null;
                            }
                            lastIndex = null;
                            disableCartesian();
                            // Hide curved and restore flat
                            if (this.curvedTwoTone.mesh?.isVisible) {
                                this.curvedTwoTone.mesh.isVisible = false;
                                this.twoTone.basePlane.isVisible = true;
                            }
                            if (this.curvedHeat.mesh?.isVisible) {
                                this.curvedHeat.mesh.isVisible = false;
                                this.heatMap.basePlane.isVisible = true;
                            }
                        }
                    });
                }
                else if (motionController.handness === "left") {
                    this._attachLeftController(motionController);

                }


            })
        })

    }

    // _attachLeftController(motionController) {
    //     const thumbstick = motionController.getComponent('xr-standard-thumbstick')
    //         || motionController.getComponent('xr-standard-touchpad');

    //     if (thumbstick) {
    //         this._detachLeftThumbstick();
    //         this._leftThumbstickComponent = thumbstick;
    //         this._leftThumbstickObserver = thumbstick.onAxisValueChangedObservable.add(component => {
    //             const axes = component?.axes ?? [0, 0];
    //             const x = Array.isArray(axes) ? axes[0] ?? 0 : 0;
    //             const y = Array.isArray(axes) ? axes[1] ?? 0 : 0;
    //             this._leftScrollVelocity.col = this._applyDeadzone(x);
    //             this._leftScrollVelocity.row = -this._applyDeadzone(y);
    //         });
    //     }

    //     if (motionController.getComponent('xr-standard-trigger')) {
    //         motionController.getComponent('xr-standard-trigger').onButtonStateChangedObservable.add(component => {
    //             if (component.pressed) {
    //                 console.log("Left trigger pressed");
    //             }
    //         });
    //     }
    // }
    _attachLeftController(motionController) {
        const thumbstick = motionController.getComponent('xr-standard-thumbstick')
            || motionController.getComponent('xr-standard-touchpad');

        if (thumbstick) {
            this._detachLeftThumbstick();
            this._leftThumbstickComponent = thumbstick;
            this._leftThumbstickObserver = thumbstick.onAxisValueChangedObservable.add(axes => {
                const x = this._applyDeadzone(axes.x);
                const y = this._applyDeadzone(axes.y);
                this._leftScrollVelocity.col = x;
                this._leftScrollVelocity.row = -y;
            });
        }

        if (motionController.getComponent('xr-standard-trigger')) {
            motionController.getComponent('xr-standard-trigger').onButtonStateChangedObservable.add(component => {
                if (component.pressed) {
                    console.log("Left trigger pressed");
                }
            });
        }
    }
    _applyDeadzone(value, deadZone = 0.1) {
        return Math.abs(value) < deadZone ? 0 : value;
    }

    _detachLeftThumbstick() {
        if (this._leftThumbstickComponent && this._leftThumbstickObserver) {
            this._leftThumbstickComponent.onAxisValueChangedObservable.remove(this._leftThumbstickObserver);
        }
        this._leftThumbstickComponent = null;
        this._leftThumbstickObserver = null;
        this._leftScrollVelocity.row = 0;
        this._leftScrollVelocity.col = 0;
    }

    _ensureScrollObserver() {
        if (this._scrollObserver || !this.scene) return;
        this._scrollObserver = this.scene.onBeforeRenderObservable.add(() => {
            const engine = this.scene.getEngine();
            if (!engine) return;
            const dt = engine.getDeltaTime() / 1000;
            if (!Number.isFinite(dt) || dt <= 0) return;

            const rowDelta = this._leftScrollVelocity.row * this._rowScrollSpeed * dt;
            const colDelta = this._leftScrollVelocity.col * this._colScrollSpeed * dt;

            this._scrollAccumulator.row += rowDelta;
            this._scrollAccumulator.col += colDelta;

            const rowSteps = Math.trunc(this._scrollAccumulator.row);
            if (rowSteps !== 0) {
                const scrolled = this.layout.scrollBy(rowSteps, 0);
                if (scrolled) {
                    this._scrollAccumulator.row -= rowSteps;
                } else {
                    this._scrollAccumulator.row = 0;
                }
            }

            const colSteps = Math.trunc(this._scrollAccumulator.col);
            if (colSteps !== 0) {
                const scrolled = this.layout.scrollBy(0, colSteps);
                if (scrolled) {
                    this._scrollAccumulator.col -= colSteps;
                } else {
                    this._scrollAccumulator.col = 0;
                }
            }
        });

        if (this.xrHelper) {
            this.xrHelper.input.onControllerRemovedObservable.add(controller => {
                if (controller?.motionController?.handness === "left") {
                    this._detachLeftThumbstick();
                }
            });
        }
    }


}
