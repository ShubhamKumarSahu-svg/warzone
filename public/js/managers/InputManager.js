/**
 * InputManager - Handles keyboard/mouse for FPS controls
 *
 * FIXES:
 * B7 - Added consumeKey(code) method. Game.js calls this on every one-shot key
 *      (R, Q, T, Escape, Digit1, Digit2). Without it, the call threw a TypeError
 *      that silently swallowed the entire handleInput() frame, so nothing moved.
 */
class InputManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = {};
    this.mouse = { x: 0, y: 0, dx: 0, dy: 0, buttons: {} };
    this.sensitivity = 0.002;
    this.locked = false;
    this.enabled = false;
    this.inputSeq = 0;

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseDown = this._onMouseDown.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);
    this._onPointerLock = this._onPointerLock.bind(this);
  }

  enable() {
    this.enabled = true;
    document.addEventListener('keydown', this._onKeyDown);
    document.addEventListener('keyup', this._onKeyUp);
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('mousedown', this._onMouseDown);
    document.addEventListener('mouseup', this._onMouseUp);
    document.addEventListener('pointerlockchange', this._onPointerLock);
  }

  disable() {
    this.enabled = false;
    document.removeEventListener('keydown', this._onKeyDown);
    document.removeEventListener('keyup', this._onKeyUp);
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('mousedown', this._onMouseDown);
    document.removeEventListener('mouseup', this._onMouseUp);
    document.removeEventListener('pointerlockchange', this._onPointerLock);
    this.keys = {};
  }

  requestPointerLock() {
    this.canvas.requestPointerLock();
  }

  exitPointerLock() {
    document.exitPointerLock();
  }

  _onPointerLock() {
    this.locked = document.pointerLockElement === this.canvas;
  }

  _onKeyDown(e) {
    if (!this.enabled) return;
    this.keys[e.code] = true;
  }

  _onKeyUp(e) {
    if (!this.enabled) return;
    this.keys[e.code] = false;
  }

  _onMouseMove(e) {
    if (!this.locked) return;
    this.mouse.dx += e.movementX;
    this.mouse.dy += e.movementY;
  }

  _onMouseDown(e) {
    if (!this.enabled) return;
    this.mouse.buttons[e.button] = true;
    if (!this.locked) this.requestPointerLock();
  }

  _onMouseUp(e) {
    if (!this.enabled) return;
    this.mouse.buttons[e.button] = false;
  }

  isKeyDown(code) { return !!this.keys[code]; }
  isMouseDown(btn) { return !!this.mouse.buttons[btn]; }

  /**
   * B7 FIX: consumeKey — returns true once then clears the key.
   * Used for one-shot actions (reload, ability, weapon switch, pause, chat).
   * Previously missing, which caused a TypeError that broke the entire
   * handleInput() call every frame — killing movement, shooting, everything.
   */
  consumeKey(code) {
    if (!this.keys[code]) return false;
    this.keys[code] = false;
    return true;
  }

  getMovement() {
    let forward = 0, right = 0;
    if (this.keys['KeyW']) forward += 1;
    if (this.keys['KeyS']) forward -= 1;
    if (this.keys['KeyA']) right -= 1;
    if (this.keys['KeyD']) right += 1;
    return { forward, right };
  }

  getMouseDelta() {
    const dx = this.mouse.dx * this.sensitivity;
    const dy = this.mouse.dy * this.sensitivity;
    this.mouse.dx = 0;
    this.mouse.dy = 0;
    return { dx, dy };
  }

  consumeInputSeq() { return ++this.inputSeq; }
}