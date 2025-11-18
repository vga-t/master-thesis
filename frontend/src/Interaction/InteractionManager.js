import * as BABYLON from "babylonjs";
import MinimapVisualization from "../Visualization/Minimap.js";
import FocusPlusContext from "./Focus+Context.js";
import RubberBandSelection from "./RubberBandSelection.js";

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
        this._leftStickInput = { x: 0, y: 0 };
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
        this._leftController = null;
        this._minimapAnchorOffsetLocal = new BABYLON.Vector3(0, 0.08, 0.14);
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
        this.focusContext = new FocusPlusContext({
            layout,
            scene,
            twoTone,
            heatMap
        });
        this.rubberBandSelection = new RubberBandSelection({
            scene,
            layout,
            camera: () => this.scene?.activeCamera,
            getActivePlane: () => this._resolveActiveSelectionPlane()
        });
        this._lastTriggerReleaseTime = 0;
        this._rightTriggerClickTimer = null;
        this._activeSqueezeMode = null;
        this._lastViewportResizeTime = 0;
        this._viewportResizeThrottleMs = 32; // ~30fps limit for heavy layout updates

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

                    if (triggerComponent) {
                        triggerComponent.onButtonStateChangedObservable.add(component => {
                            if (!component.changes.pressed) return;
                            if (component.pressed) {
                                this.rubberBandSelection?.beginDrag(rightController);
                            } else {
                                this.rubberBandSelection?.endDrag();
                                this._registerRightTriggerRelease();
                            }
                        });
                    }

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
                                const minimapHandled = this._startMinimapInteraction(rightController);
                                if (minimapHandled) {
                                    this._activeSqueezeMode = "minimap";
                                } else {
                                    this._activeSqueezeMode = "focus";
                                    this.focusContext?.handleTriggerPress(rightController);
                                }
                            } else {
                                if (this._activeSqueezeMode === "minimap") {
                                    this._endMinimapInteraction();
                                } else if (this._activeSqueezeMode === "focus") {
                                    this.focusContext?.handleTriggerRelease();
                                }
                                this._activeSqueezeMode = null;
                            }
                        });
                    }

                    if (aComponent) {
                        aComponent.onButtonStateChangedObservable.add(component => {
                            if (!component.changes.pressed) return;
                            if (component.pressed) {
                                this.focusContext?.handlePanStart(rightController);
                            } else {
                                this.focusContext?.handlePanEnd();
                            }
                        });
                    }
                }
                else if (motionController.handness === "left") {
                    this._attachLeftController(motionController, controller);

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
    _attachLeftController(motionController, controller) {
        this._leftController = controller;
        const thumbstick = motionController.getComponent('xr-standard-thumbstick')
            || motionController.getComponent('xr-standard-touchpad');

        if (thumbstick) {
            this._detachLeftThumbstick();
            this._leftThumbstickComponent = thumbstick;
            this._leftThumbstickObserver = thumbstick.onAxisValueChangedObservable.add(axes => {
                const x = this._applyDeadzone(axes.x);
                const y = this._applyDeadzone(axes.y);
                this._leftStickInput.x = x;
                this._leftStickInput.y = y;
            });
        }

        if (motionController.getComponent('xr-standard-trigger')) {
            motionController.getComponent('xr-standard-trigger').onButtonStateChangedObservable.add(component => {
                if (component.pressed) {
                    console.log("Left trigger pressed");
                }
            });
        }

        const xButton = motionController.getComponent('x-button');
        const yButton = motionController.getComponent('y-button');
        if (xButton) {
            xButton.onButtonStateChangedObservable.add(component => {
                if (!component.changes.pressed) return;
                if (component.pressed) {
                    this.rubberBandSelection?.setVisualizationMode("line");
                }
            });
        }
        if (yButton) {
            yButton.onButtonStateChangedObservable.add(component => {
                if (!component.changes.pressed) return;
                if (component.pressed) {
                    this.rubberBandSelection?.setVisualizationMode("parallel");
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
        this._leftStickInput.x = 0;
        this._leftStickInput.y = 0;
    }

    _ensureScrollObserver() {
        if (this._scrollObserver || !this.scene) return;
        this._scrollObserver = this.scene.onBeforeRenderObservable.add(() => {
            const engine = this.scene.getEngine();
            if (!engine) return;
            const dt = engine.getDeltaTime() / 1000;
            if (!Number.isFinite(dt) || dt <= 0) return;

            if (this.focusContext && this.focusContext.focusBlock) {
                // Distortion Mode
                const distortionSpeed = 0.5;
                // Stick Y (up/down) controls Row Height (rowFocusShare)
                // Stick X (left/right) controls Column Width (columnFocusShare)
                // Invert Y because stick up is usually negative, and we want up to increase height (or maybe down to increase? let's try -y for up=increase)
                const rowDelta = -this._leftStickInput.y * distortionSpeed * dt;
                const colDelta = this._leftStickInput.x * distortionSpeed * dt;

                this.focusContext.adjustFocusDistortion(rowDelta, colDelta);
            } else {
                // Scroll Mode
                const rowDelta = this._leftStickInput.y * this._rowScrollSpeed * dt;
                const colDelta = this._leftStickInput.x * this._colScrollSpeed * dt;

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
            }
        });

        if (this.xrHelper) {
            this.xrHelper.input.onControllerRemovedObservable.add(controller => {
                if (controller?.motionController?.handness === "left") {
                    this._detachLeftThumbstick();
                    this._leftController = null;
                } else if (controller?.motionController?.handness === "right") {
                    if (this._activeSqueezeMode === "focus") {
                        this.focusContext?.handleTriggerRelease?.();
                    }
                    this.focusContext?.handlePanEnd?.();
                    this.rubberBandSelection?.cancelDrag?.();
                    this._activeSqueezeMode = null;
                }
            });
        }
    }

    _registerRightTriggerRelease() {
        const DOUBLE_CLICK_MS = 350;
        const now = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
        if (now - this._lastTriggerReleaseTime <= DOUBLE_CLICK_MS) {
            if (this._rightTriggerClickTimer) {
                clearTimeout(this._rightTriggerClickTimer);
                this._rightTriggerClickTimer = null;
            }
            this._lastTriggerReleaseTime = 0;
            this._handleRightTriggerDoubleClick();
        } else {
            this._lastTriggerReleaseTime = now;
            if (this._rightTriggerClickTimer) {
                clearTimeout(this._rightTriggerClickTimer);
            }
            this._rightTriggerClickTimer = setTimeout(() => {
                this._rightTriggerClickTimer = null;
            }, DOUBLE_CLICK_MS);
        }
    }

    _handleRightTriggerDoubleClick() {
        this.rubberBandSelection?.reset();
        this.focusContext?.resetToDefault?.();
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
        const anchorPose = this._getControllerPose(this._leftController);
        if (anchorPose) {
            const offset = this._minimapAnchorOffsetLocal ?? BABYLON.Vector3.Zero();
            const anchoredPos = anchorPose.position.add(this._offsetFromBasis(offset, anchorPose));
            this.minimap.setRootPosition(anchoredPos);
            if (camera?.globalPosition) {
                this.minimap.setForward(camera.globalPosition.subtract(anchoredPos));
            } else {
                this.minimap.setForward(anchorPose.forward.scale(-1));
            }
            return;
        }
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
        if (!this.minimap || !this._minimapVisible) return false;
        const ray = this._buildForwardRay(controller);
        if (!ray) return false;

        const pickInfo = this.scene.pickWithRay(ray, mesh => mesh?.metadata?.minimap === true, false);
        if (!pickInfo || !pickInfo.hit) return false;

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
        } else if (metadata.kind === "viewportHandle") {
            const local = this.minimap.worldToLocal(pickInfo.pickedPoint);
            this._minimapInteraction = { type: "viewportResize", controller, handle: metadata, anchorLocal: local };
        } else if (metadata.kind === "viewport") {
            const local = this.minimap.worldToLocal(pickInfo.pickedPoint);
            this._minimapInteraction = { type: "viewport", controller };
            const normalized = this.minimap.normalizeLocalPoint(local);
            this.minimap.previewViewportFromNormalized(normalized.row, normalized.col);
            this._applyViewportDrag(normalized);
        }
        return !!this._minimapInteraction;
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
                const desiredPos = grip.getAbsolutePosition().add(state.offset);
                const anchorPose = this._getControllerPose(this._leftController);
                if (anchorPose) {
                    const worldOffset = desiredPos.subtract(anchorPose.position);
                    this._minimapAnchorOffsetLocal = this._projectOffsetToBasis(worldOffset, anchorPose);
                    const nextPos = anchorPose.position.add(this._offsetFromBasis(this._minimapAnchorOffsetLocal, anchorPose));
                    this.minimap.setRootPosition(nextPos);
                } else {
                    this.minimap.setRootPosition(desiredPos);
                }
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
        } else if (state.type === "viewportResize") {
            const result = this.minimap.resizeViewportFromHandle(state.handle, localPoint, state.anchorLocal);
            if (result) {
                this._applyViewportResize(result);
            }
        }
    }

    _applyViewportResize(result) {
        if (!result) return;

        const now = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
        if (now - this._lastViewportResizeTime < this._viewportResizeThrottleMs) {
            return;
        }
        this._lastViewportResizeTime = now;

        const { visibleRows, visibleCols, rowOffset, colOffset } = result;

        // Apply the new visible viewport size and scroll offsets in one go
        // This prevents double updates (one for size, one for scroll)
        this.layout.setVisibleViewport(visibleRows, visibleCols, rowOffset, colOffset);
    }

    _applyViewportDrag(normalized) {
        const now = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
        if (now - this._lastViewportResizeTime < this._viewportResizeThrottleMs) {
            return;
        }
        this._lastViewportResizeTime = now;

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
        this.layout.setScrollOffsets(targetRow, targetCol);
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

        this._updateMinimapAnchor();

        const isInteracting = this._minimapInteraction && (
            this._minimapInteraction.type === "viewport" ||
            this._minimapInteraction.type === "viewportResize"
        );

        if (!isInteracting) {
            this.minimap.updateViewport(this.layout.getScrollState(), {
                visibleRows: this.layout.visibleRows,
                visibleCols: this.layout.visibleCols,
                totalRows: this.layout.totalRows,
                totalCols: this.layout.totalCols
            });
        }

        if (this._minimapInteraction && this._minimapVisible) {
            this._updateMinimapInteraction();
        }
    }

    _updateMinimapAnchor() {
        if (!this.minimap || !this._minimapVisible) return;
        const pose = this._getControllerPose(this._leftController);
        const camera = this.scene?.activeCamera;

        if (pose) {
            const offsetLocal = this._minimapAnchorOffsetLocal ?? BABYLON.Vector3.Zero();
            const offsetWorld = this._offsetFromBasis(offsetLocal, pose);
            const targetPos = pose.position.add(offsetWorld);
            this.minimap.setRootPosition(targetPos);

            if (camera?.globalPosition) {
                this.minimap.setForward(camera.globalPosition.subtract(targetPos));
            } else {
                this.minimap.setForward(pose.forward.scale(-1));
            }
            return;
        }

        if (camera?.globalPosition) {
            const currentPos = this.minimap.getRootPosition();
            this.minimap.setForward(camera.globalPosition.subtract(currentPos));
        }
    }

    _getControllerPose(controller) {
        if (!controller) return null;
        const node = controller.grip || controller.pointer;
        if (!node?.getWorldMatrix) return null;
        const world = node.getWorldMatrix();
        const position = node.getAbsolutePosition
            ? node.getAbsolutePosition()
            : BABYLON.Vector3.TransformCoordinates(BABYLON.Vector3.Zero(), world);
        const forward = BABYLON.Vector3.TransformNormal(BABYLON.Axis.Z, world).normalize();
        const up = BABYLON.Vector3.TransformNormal(BABYLON.Axis.Y, world).normalize();
        let right = BABYLON.Vector3.Cross(up, forward);
        if (right.lengthSquared() < 1e-6) {
            right = BABYLON.Axis.X.clone();
        } else {
            right.normalize();
        }
        return { position, forward, up, right };
    }

    _offsetFromBasis(localOffset, basis) {
        if (!basis) return BABYLON.Vector3.Zero();
        const x = basis.right ? basis.right.scale(localOffset.x) : BABYLON.Vector3.Zero();
        const y = basis.up ? basis.up.scale(localOffset.y) : BABYLON.Vector3.Zero();
        const z = basis.forward ? basis.forward.scale(localOffset.z) : BABYLON.Vector3.Zero();
        return x.add(y).add(z);
    }

    _projectOffsetToBasis(worldOffset, basis) {
        if (!basis) return BABYLON.Vector3.Zero();
        const { right, up, forward } = basis;
        return new BABYLON.Vector3(
            right ? BABYLON.Vector3.Dot(worldOffset, right) : 0,
            up ? BABYLON.Vector3.Dot(worldOffset, up) : 0,
            forward ? BABYLON.Vector3.Dot(worldOffset, forward) : 0
        );
    }

    dispose() {
        if (this._scrollObserver) {
            this.scene.onBeforeRenderObservable.remove(this._scrollObserver);
            this._scrollObserver = null;
        }
        if (this._minimapUpdateObserver) {
            this.scene.onBeforeRenderObservable.remove(this._minimapUpdateObserver);
            this._minimapUpdateObserver = null;
        }
        if (this._leftThumbstickComponent && this._leftThumbstickObserver) {
            this._leftThumbstickComponent.onAxisValueChangedObservable.remove(this._leftThumbstickObserver);
        }
        if (this.minimap) {
            this.minimap.dispose();
        }
        if (this._rightTriggerClickTimer) {
            clearTimeout(this._rightTriggerClickTimer);
            this._rightTriggerClickTimer = null;
        }
        this.rubberBandSelection?.dispose();
    }

    _resolveActiveSelectionPlane() {
        if (this.twoTone?.basePlane?.isVisible) return this.twoTone.basePlane;
        if (this.heatMap?.basePlane?.isVisible) return this.heatMap.basePlane;
        return this.twoTone?.basePlane ?? this.heatMap?.basePlane ?? null;
    }
}
