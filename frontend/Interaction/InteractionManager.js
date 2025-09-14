import { FocusContext } from "./FocusContext";

export class InteractionManager {
    constructor(layout, { heatMap, twoTone }, xrHelper) {
        this.xrHelper = xrHelper;
        this.heatMap = heatMap;
        this.twoTone = twoTone;
        heatMap.basePlane.isPickable = true;
        twoTone.basePlane.isPickable = true;
        this.leftTriggerComponent = null;
        this.rightTriggerComponent = null;
        this.leftSqueezeComponent = null;
        this.rightSqueezeComponent = null;
        this.leftXButtonComponent = null;
        this.leftYButtonComponent = null;
        this.rightAButtonComponent = null;
        this.rightBButtonComponent = null;
        this.menuButtonComponent = null;
        this._setupVRControllers();


    }
    // _setupVRControllers() {
    //     if (this.xrHelper) {
    //         console.log("Browser supports WebXR");
    //         this.xrHelper.input.onControllerAddedObservable.add((controller) => {
    //             console.log("Controller added:", controller);
    //             controller.onMotionControllerInitObservable.add((motionController) => {
    //                 console.log("Motion controller initialized:", motionController);
    //                 const triggerComponent = motionController.getComponentOfType("xr-standard-trigger");
    //                 const squeezeComponent = motionController.getComponentOfType("xr-standard-squeeze");
    //                 const aComponent = motionController.getComponentOfType("a-button");
    //                 const bComponent = motionController.getComponentOfType("b-button");
    //                 const xComponent = motionController.getComponentOfType("x-button");
    //                 const yComponent = motionController.getComponentOfType("y-button");
    //                 const menuComponent = motionController.getComponentOfType("menu-button");
    //                 // This code is not the correct way to test which buttons are not supported.
    //                 // It checks if ALL components exist (truthy), which is not useful for detecting unsupported buttons.
    //                 // Instead, you should check each component individually and log which ones are missing:

    //                 const unsupportedButtons = [];
    //                 if (!triggerComponent) unsupportedButtons.push("trigger");
    //                 if (!squeezeComponent) unsupportedButtons.push("squeeze");
    //                 if (!aComponent) unsupportedButtons.push("a");
    //                 if (!bComponent) unsupportedButtons.push("b");
    //                 if (!xComponent) unsupportedButtons.push("x");
    //                 if (!yComponent) unsupportedButtons.push("y");
    //                 if (!menuComponent) unsupportedButtons.push("menu");

    //                 if (unsupportedButtons.length > 0) {
    //                     console.log("Buttons not supported:", unsupportedButtons.join(", "));
    //                 } else {
    //                     console.log("All standard buttons are supported.");
    //                 }
    //             })
    //         })

    //     }

    // }
    _setupVRControllers() {

        if (this.xrHelper) {
            console.log("Browser supports WebXR");
            this.xrHelper.input.onControllerAddedObservable.add((controller) => {
                controller.onMotionControllerInitObservable.add((motionController) => {
                    if (motionController.handness === "left") {
                        const xr_ids = motionController.getComponentIds();
                        console.log("Showing left controller components:", xr_ids);
                        this.leftTriggerComponent = motionController.getComponent(xr_ids[0]);
                        this.leftSqueezeComponent = motionController.getComponent(xr_ids[1]);
                        this.leftXButtonComponent = motionController.getComponent(xr_ids[3]);
                        this.leftYButtonComponent = motionController.getComponent(xr_ids[4]);
                        this.menuButtonComponent = motionController.getComponent(xr_ids[6]);

                    }
                    if (motionController.handness === "right") {
                        const xr_ids = motionController.getComponentIds();
                        console.log("Showing righ controller components:", xr_ids);
                        this.rightTriggerComponent = motionController.getComponent(xr_ids[0]);
                        this.rightSqueezeComponent = motionController.getComponent(xr_ids[1]);
                        this.rightAButtonComponent = motionController.getComponent(xr_ids[3]);
                        this.rightBButtonComponent = motionController.getComponent(xr_ids[4]);

                    }
                })
            })
        }
    }

}
