import * as BABYLON from "babylonjs";
import MinimapVisualization from "../Visualization/Minimap.js";

export class InteractionManager {
    constructor(layout, { heatMap, twoTone }, xrHelper, scene) {
        this.xrHelper = xrHelper;
        this.scene = scene;
        this.layout = layout;
        this.heatMap = heatMap;
        this.twoTone = twoTone;

        if (this.heatMap?.basePlane) {
            this.heatMap.basePlane.isPickable = true;
            this.heatMap.basePlane.thinInstanceEnablePicking = true;
        }

        if (this.twoTone?.basePlane) {
            this.twoTone.basePlane.isPickable = true;
            this.twoTone.basePlane.thinInstanceEnablePicking = true;
        }

        this._rowScrollSpeed = Math.max(6, Math.round(this.layout.visibleRows / 1.5));
        this._colScrollSpeed = Math.max(3, Math.round(Math.max(1, this.layout.visibleCols) / 2));
        this._leftScrollVelocity = { row: 0, col: 0 };
        this._scrollAccumulator = { row: 0, col: 0 };
        this._scrollObserver = null;
        this._leftThumbstickComponent = null;
        this._leftThumbstickObserver = null;

        this._ensureScrollObserver();

        this.minimap = new MinimapVisualization(layout, scene);
        this.minimap.setVisible(false);
        this._minimapVisible = false;
        this._minimapPlaced = false;
        // this._minimapMode = "twotone";
        this._minimapInteraction = null;
        this._rightController = null;
        this._minimapUpdateObserver = this.scene.onBeforeRenderObservable.add(() => {
            this._syncMinimap();
        });
        this.minimap.updateViewport(this.layout.getScrollState(), {
            visibleRows: this.layout.visibleRows,
            visibleCols: this.layout.visibleCols,
            totalRows: this.layout.totalRows,
            totalCols: this.layout.totalCols
        });
        // this.minimap.setMode(this._minimapMode);


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
                    this._rightController = controller;

                    let hoverObserver = null;
                    let lastIndex = null;

                    const startPicking = () => {
                        if (hoverObserver) return;
                        hoverObserver = this.scene.onBeforeRenderObservable.add(() => {
                            const ray = this._buildForwardRay(rightController);
                            if (!ray) return;
                            const targetMesh = this.twoTone.basePlane?.isVisible ? this.twoTone.basePlane : this.heatMap.basePlane;
                            if (!targetMesh) return;
                            const pickInfo = this.scene.pickWithRay(ray, mesh => mesh === targetMesh);
                            if (pickInfo?.hit) {
                                const idx = pickInfo.thinInstanceIndex ?? pickInfo.instanceIndex;
                                if (idx !== lastIndex && idx != null) {
                                    lastIndex = idx;
                                    console.log("Picked thin-instance index:", idx);
                                }
                            }
                        });
                    };

                    const stopPicking = () => {
                        if (hoverObserver) {
                            this.scene.onBeforeRenderObservable.remove(hoverObserver);
                            hoverObserver = null;
                        }
                        lastIndex = null;
                    };

                    triggerComponent.onButtonStateChangedObservable.add(component => {
                        if (!component.changes.pressed) return;

                        if (component.pressed) {
                            startPicking();
                        } else {
                            stopPicking();
                        }
                    });

                    if (bComponent) {
                        bComponent.onButtonStateChangedObservable.add(component => {
                            if (!component.changes.pressed) return;
                            if (component.pressed) {
                                this._toggleMinimap(rightController);
                            }
                        });
                    }

                    if (squeezeComponent) {
                        squeezeComponent.onButtonStateChangedObservable.add(component => {
                            if (!component.changes.pressed) return;
                            if (component.pressed) {
                                this._startMinimapInteraction(rightController);
                            } else {
                                this._endMinimapInteraction();
                            }
                        });
                    }
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
                this._leftScrollVelocity.row = y;
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

    setVisualizationMode(mode) {
        if (mode !== "heatmap" && mode !== "twotone") return;
        this._minimapMode = mode;
        this.minimap?.setMode(mode);
    }

    _buildForwardRay(ctrl, length = 100) {
        if (!ctrl) return null;
        const pointer = ctrl.pointer || ctrl.grip || ctrl;
        if (!pointer?.getAbsolutePosition) return null;
        const origin = pointer.getAbsolutePosition();
        const fwd = pointer.forward ? pointer.forward.clone() : new BABYLON.Vector3(0, 0, 1);
        return new BABYLON.Ray(origin, fwd, length);
    }

    _toggleMinimap(controller) {
        if (!this.minimap) return;
        const visible = !this._minimapVisible;
        this._minimapVisible = visible;
        this.minimap.setVisible(visible);
        if (visible) {
            this.minimap.refreshCanvasDimensions({
                totalRows: this.layout.totalRows,
                totalCols: this.layout.totalCols
            });
            if (!this._minimapPlaced) {
                this._placeMinimap(controller);
                this._minimapPlaced = true;
            }
            this.minimap.updateViewport(this.layout.getScrollState(), {
                visibleRows: this.layout.visibleRows,
                visibleCols: this.layout.visibleCols,
                totalRows: this.layout.totalRows,
                totalCols: this.layout.totalCols
            });
        } else {
            this._endMinimapInteraction();
        }
    }

    _placeMinimap(controller) {
        const camera = this.scene?.activeCamera;
        const ref = controller?.grip || controller?.pointer;
        let position;
        let forward;

        if (ref?.getAbsolutePosition) {
            const origin = ref.getAbsolutePosition();
            const dir = ref.forward ? ref.forward.clone() : BABYLON.Axis.Z.clone();
            dir.normalize();
            position = origin.add(dir.scale(0.8));
            position.y += 0.15;
            forward = dir;
        } else if (camera) {
            const camForward = camera.getDirection(BABYLON.Axis.Z).normalize();
            position = camera.globalPosition.add(camForward.scale(1.5));
            forward = camForward;
        } else {
            position = new BABYLON.Vector3(0, 1.4, 1);
            forward = BABYLON.Axis.Z.clone();
        }

        this.minimap.setRootPosition(position);
        this.minimap.setForward(forward);
    }

    _startMinimapInteraction(controller) {
        if (!this.minimap || !this._minimapVisible) return;
        const ray = this._buildForwardRay(controller);
        if (!ray) return;

        const pickInfo = this.scene.pickWithRay(ray, mesh => mesh?.metadata?.minimap === true, false);
        if (!pickInfo || !pickInfo.hit) return;

        const target = pickInfo.pickedMesh;
        if (!target?.metadata) return;

        const metadata = target.metadata;
        if (metadata.kind === "main") {
            const grip = controller?.grip || controller?.pointer;
            if (grip?.getAbsolutePosition) {
                const gripPos = grip.getAbsolutePosition();
                const rootPos = this.minimap.getRootPosition();
                const offset = rootPos.subtract(gripPos);
                this._minimapInteraction = { type: "move", controller, offset };
            }
        } else if (metadata.kind === "handle") {
            const local = this.minimap.worldToLocal(pickInfo.pickedPoint);
            this._minimapInteraction = { type: "resize", controller, handle: metadata, local };
        } else if (metadata.kind === "viewport") {
            const local = this.minimap.worldToLocal(pickInfo.pickedPoint);
            this._minimapInteraction = { type: "viewport", controller };
            const normalized = this.minimap.normalizeLocalPoint(local);
            this.minimap.previewViewportFromNormalized(normalized.row, normalized.col);
            this._applyViewportDrag(normalized);
        }
    }

    _endMinimapInteraction() {
        this._minimapInteraction = null;
    }

    _updateMinimapInteraction() {
        if (!this._minimapInteraction) return;
        const state = this._minimapInteraction;
        const controller = state.controller;
        if (!controller) return;

        if (state.type === "move") {
            const grip = controller.grip || controller.pointer;
            if (grip?.getAbsolutePosition) {
                const newPos = grip.getAbsolutePosition().add(state.offset);
                this.minimap.setRootPosition(newPos);
            }
            return;
        }

        const ray = this._buildForwardRay(controller);
        if (!ray) return;
        const plane = this.minimap.getPlane();
        const distance = ray.intersectsPlane(plane);
        if (distance === null) return;
        const worldPoint = ray.origin.add(ray.direction.scale(distance));
        const localPoint = this.minimap.worldToLocal(worldPoint);

        if (state.type === "resize") {
            this.minimap.resizeFromHandle(state.handle, localPoint);
        } else if (state.type === "viewport") {
            const normalized = this.minimap.normalizeLocalPoint(localPoint);
            this.minimap.previewViewportFromNormalized(normalized.row, normalized.col);
            this._applyViewportDrag(normalized);
        }
    }

    _applyViewportDrag(normalized) {
        const scrollState = this.layout.getScrollState();
        const maxRow = Math.max(0, scrollState.maxRowOffset ?? 0);
        const maxCol = Math.max(0, scrollState.maxColOffset ?? 0);
        const sensitivity = typeof this.minimap?.getScrollSensitivity === "function"
            ? this.minimap.getScrollSensitivity()
            : { row: 1, col: 1 };

        const adjustedRowNorm = this._adjustViewportSensitivity(normalized.row, sensitivity.row);
        const adjustedColNorm = this._adjustViewportSensitivity(normalized.col, sensitivity.col);

        const targetRow = maxRow > 0 ? Math.round(adjustedRowNorm * maxRow) : 0;
        const targetCol = maxCol > 0 ? Math.round((1 - adjustedColNorm) * maxCol) : 0;
        const changed = this.layout.setScrollOffsets(targetRow, targetCol);
        if (changed) {
            this.minimap.updateViewport(this.layout.getScrollState(), {
                visibleRows: this.layout.visibleRows,
                visibleCols: this.layout.visibleCols,
                totalRows: this.layout.totalRows,
                totalCols: this.layout.totalCols
            });
        }
    }

    _adjustViewportSensitivity(value, factor) {
        const clampedValue = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
        const safeFactor = Math.max(0.4, Math.min(2.5, Number.isFinite(factor) && factor > 0 ? factor : 1));
        if (Math.abs(safeFactor - 1) < 1e-3) {
            return clampedValue;
        }
        const powValue = Math.pow(clampedValue, safeFactor);
        const powInverse = Math.pow(1 - clampedValue, safeFactor);
        const denominator = powValue + powInverse;
        if (!Number.isFinite(denominator) || denominator <= 0) {
            return clampedValue;
        }
        return powValue / denominator;
    }

    _syncMinimap() {
        if (!this.minimap) return;
        this.minimap.updateViewport(this.layout.getScrollState(), {
            visibleRows: this.layout.visibleRows,
            visibleCols: this.layout.visibleCols,
            totalRows: this.layout.totalRows,
            totalCols: this.layout.totalCols
        });
        if (this._minimapInteraction && this._minimapVisible) {
            this._updateMinimapInteraction();
        }
    }


}
