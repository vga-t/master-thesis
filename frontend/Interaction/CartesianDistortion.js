// Central controller for enabling/disabling cartesian distortion on curved visualizations
// Expects targets to expose setCartesianEnabled(bool), setCartesianFocus(x,y), setCartesianAlpha(a)

export class CartesianDistortionController {
    constructor(targets = []) {
        this.targets = targets; // array of visualizations
        this.enabled = false;
        this.focus = { x: 0.5, y: 0.5 };
        this.alpha = 0.00;
        this.D = .0; // degree of magnification for cartesian lens
    }

    addTarget(target) { this.targets.push(target); }

    setEnabled(enabled) {
        this.enabled = enabled;
        this.targets.forEach(t => t?.setCartesianEnabled?.(enabled));
    }

    toggle() { this.setEnabled(!this.enabled); }

    setFocus(xNorm, yNorm) {
        this.focus = { x: Math.max(0, Math.min(1, xNorm)), y: Math.max(0, Math.min(1, yNorm)) };
        this.targets.forEach(t => t?.setCartesianFocus?.(this.focus.x, this.focus.y));
    }

    setAlpha(a) {
        this.alpha = Math.max(0.05, Math.min(0.95, a));
        this.targets.forEach(t => t?.setCartesianAlpha?.(this.alpha));
    }

    setD(d) {
        this.D = Math.max(0.1, d);
        this.targets.forEach(t => t?.setCartesianD?.(this.D));
    }

    nudgeD(delta) {
        this.setD(this.D + delta);
    }
}

export default CartesianDistortionController;
