/**
 * PlayerController — Enhanced Feel Edition
 *
 * WHAT'S NEW vs original:
 *  ✅ Head bob   — vertical + lateral, symmetric L/R, smooth in/out
 *  ✅ Camera lean — strafe tilt SYMMETRIC both sides (same angle L = R)
 *  ✅ Coyote time — jump still works ~0.12s after walking off a ledge
 *  ✅ Jump buffer — pre-press buffer so "early" Space still fires
 *  ✅ Jump kick   — tiny camera dip on liftoff for weight/feel
 *  ✅ Slide burst  — instant speed burst then exponential decay
 *                   slide NOW covers real distance instead of barely moving
 *  ✅ Slide tilt   — camera rolls in slide direction for drama
 *  ✅ Crouch depth — 0.55× height instead of 0.5× — feels correct, not pancake
 *  ✅ Gravity      — slightly stronger pull for snappier arcs
 *  ✅ All numbers labeled — tweak anything below without guessing
 *
 * HOW TO TWEAK — READ THIS ONCE, THANK YOURSELF LATER:
 *
 *  jumpForce       → bigger = higher jump. Try 12–20.
 *  gravity         → more negative = falls faster. Try -22 to -35.
 *  slideSpeed      → initial burst speed. Try 16–22.
 *  slideMinSpeed   → speed at end of slide. Try 3–6.
 *  slideDuration   → how long slide lasts (seconds). Try 0.5–1.0.
 *  crouchHeight    → multiplier on playerHeight. 0.5 = half height, 0.6 = less deep.
 *  bobAmplitudeY   → vertical head bob strength. Try 0.03–0.09.
 *  bobAmplitudeX   → lateral bob roll strength. Try 0.01–0.05.
 *  bobFrequency    → bob speed (cycles/sec). 8=slow walk, 12=brisk.
 *  leanMaxAngle    → how far camera rolls on strafe (radians). Try 0.03–0.10.
 *  leanSpeed       → how fast lean snaps in/out. Try 6–14.
 *  slideTilt       → extra camera roll during slide. Try 0.10–0.25.
 *  coyoteTime      → grace window after ledge (sec). Try 0.08–0.20.
 *  jumpBufferTime  → pre-press jump buffer (sec). Try 0.08–0.18.
 */

class PlayerController {
  constructor(game) {
    this.game = game;

    // ─── Movement ─────────────────────────────────────────────────────────────
    this.maxMoveSpeed = 8;    // world units/sec at full sprint
    this.acceleration = 10;   // how fast we ramp TO maxMoveSpeed
    this.deceleration = 12;   // how fast we bleed off when key released

    // ─── Jump ─────────────────────────────────────────────────────────────────
    this.jumpForce = 15;   // ↑↑ more pop than original 12 — TWEAK THIS
    this.gravity = -28;  // ↑↑ snappier arc than original -25 — TWEAK THIS
    this.coyoteTime = 0.12; // seconds of grace after walking off a ledge
    this.jumpBufferTime = 0.12; // seconds of pre-press buffer before landing

    // ─── Player Geometry ──────────────────────────────────────────────────────
    this.playerHeight = 1.8;
    this.playerRadius = 0.5;

    // ─── Crouch ───────────────────────────────────────────────────────────────
    this.crouchHeight = 0.55;  // fraction of playerHeight when crouched
    // 0.5 = flat pancake | 0.6 = barely bent
    // 0.55 = realistic crouch depth — TWEAK THIS
    this.crouchSpeed = 12;    // how fast camera lerps to crouch/stand height
    this.crouchMoveMultiplier = 0.5; // speed penalty while crouched

    // ─── Slide ────────────────────────────────────────────────────────────────
    this.slideDuration = 0.75;  // seconds — TWEAK THIS (0.5 quick | 1.0 long)
    this.slideSpeed = 18;    // initial burst speed — TWEAK THIS
    this.slideMinSpeed = 4;     // floor speed at end of slide — TWEAK THIS
    this.slideCooldown = 1.0;   // cooldown before next slide (seconds)
    this.slideTilt = 0.18;  // camera roll angle during slide (radians)
    // 0 = none, 0.3 = very dramatic — TWEAK THIS

    // ─── Head Bob ─────────────────────────────────────────────────────────────
    this.bobFrequency = 10;    // steps per second — TWEAK THIS
    this.bobAmplitudeY = 0.055; // vertical bounce strength — TWEAK THIS
    this.bobAmplitudeX = 0.030; // lateral rock roll strength — TWEAK THIS
    // symmetric: same amplitude left AND right

    // ─── Strafe Lean ──────────────────────────────────────────────────────────
    this.leanMaxAngle = 0.05;  // max roll in radians — TWEAK THIS
    // same value applied L and R (symmetric by design)
    this.leanSpeed = 8;     // lerp speed for lean in/out — TWEAK THIS

    // ─── Runtime State (don't touch) ──────────────────────────────────────────
    this.yaw = 0;
    this.pitch = 0;
    this.velocity = new BABYLON.Vector3(0, 0, 0);
    this.moveVelocity = new BABYLON.Vector3(0, 0, 0);
    this.grounded = false;
    this.crouching = false;
    this.sliding = false;
    this.slideDir = { x: 0, z: 0 };
    this.slideTimer = 0;

    // Internal accumulators
    this._slideCooldownTimer = 0;
    this._coyoteTimer = 0;
    this._jumpBufferTimer = 0;
    this._jumpKick = 0;   // camera dip on jump liftoff
    this._bobTime = 0;
    this._bobSmooth = 0;   // 0→1 smooth bob intensity
    this._bobOffsetY = 0;
    this._bobRoll = 0;
    this._leanCurrent = 0;
    this._currentCamHeight = this.playerHeight;
    this._moveRight = 0;   // stashed each frame for lean
    this._isMoving = false;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  //  MAIN UPDATE
  // ══════════════════════════════════════════════════════════════════════════════
  update(dt) {
    if (!this.game.alive || !this.game.input.locked) return;

    this._mouseLook(dt);
    this._handleMovement(dt);   // sets this._moveRight, this._isMoving
    this._updateCrouch(dt);     // must run BEFORE gravity so floor height is ready
    this._handleJump(dt);
    this._applyPhysics(dt);
    this._updateSlide(dt);
    this._updateHeadBob(dt);
    this._updateLean(dt);
    this._clampToMap();
  }

  // ══════════════════════════════════════════════════════════════════════════════
  //  MOUSE LOOK
  // ══════════════════════════════════════════════════════════════════════════════
  _mouseLook(dt) {
    const delta = this.game.input.getMouseDelta();
    this.yaw += delta.dx;
    this.pitch += delta.dy;
    this.pitch = Math.max(-Math.PI / 2.1, Math.min(Math.PI / 2.1, this.pitch));

    const recoil = this.game.weapons?.recoilOffset || { x: 0, y: 0 };
    this.pitch -= recoil.y;
    this.yaw += recoil.x;

    this.game.camera.rotation.y = this.yaw;
    this.game.camera.rotation.x = this.pitch;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  //  HORIZONTAL MOVEMENT + SLIDE INITIATION
  // ══════════════════════════════════════════════════════════════════════════════
  _handleMovement(dt) {
    const move = this.game.input.getMovement();
    this._isMoving = move.forward !== 0 || move.right !== 0;
    this._moveRight = move.right; // stash for lean

    // World-space direction from camera (flatten Y)
    const fwd = this.game.camera.getDirection(new BABYLON.Vector3(0, 0, 1));
    fwd.y = 0; fwd.normalize();
    const right = this.game.camera.getDirection(new BABYLON.Vector3(1, 0, 0));
    right.y = 0; right.normalize();

    let dirX = fwd.x * move.forward + right.x * move.right;
    let dirZ = fwd.z * move.forward + right.z * move.right;

    if (this._isMoving) {
      const len = Math.sqrt(dirX * dirX + dirZ * dirZ);
      dirX /= len; dirZ /= len;
    }

    // ── Slide initiation ────────────────────────────────────────────────────
    const shiftHeld = this.game.input.isKeyDown('ShiftLeft');
    if (shiftHeld && this.grounded && this._isMoving &&
      !this.sliding && this._slideCooldownTimer <= 0) {
      this._startSlide(dirX, dirZ);
    }

    // ── Acceleration / deceleration (only when NOT sliding) ─────────────────
    if (!this.sliding) {
      if (this._isMoving) {
        const t = 1 - Math.exp(-this.acceleration * dt);
        this.moveVelocity.x += (dirX * this.maxMoveSpeed - this.moveVelocity.x) * t;
        this.moveVelocity.z += (dirZ * this.maxMoveSpeed - this.moveVelocity.z) * t;
      } else {
        const t = 1 - Math.exp(-this.deceleration * dt);
        this.moveVelocity.x *= (1 - t);
        this.moveVelocity.z *= (1 - t);
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════
  //  JUMP — coyote time + input buffer + camera kick
  // ══════════════════════════════════════════════════════════════════════════════
  _handleJump(dt) {
    // Coyote: keep a grace window after leaving the ground
    if (this.grounded) {
      this._coyoteTimer = this.coyoteTime;
    } else {
      this._coyoteTimer = Math.max(0, this._coyoteTimer - dt);
    }

    // Buffer: register early Space presses
    if (this.game.input.isKeyDown('Space')) {
      this._jumpBufferTimer = this.jumpBufferTime;
    } else {
      this._jumpBufferTimer = Math.max(0, this._jumpBufferTimer - dt);
    }

    const canJump = this._coyoteTimer > 0 && !this.sliding;
    if (canJump && this._jumpBufferTimer > 0) {
      this.velocity.y = this.jumpForce; // ← TWEAK jumpForce for height
      this.grounded = false;
      this._coyoteTimer = 0;
      this._jumpBufferTimer = 0;
      // Tiny camera downward kick for weight/feedback
      this._jumpKick = -0.07; // negative = camera dips briefly on liftoff
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════
  //  GRAVITY + AABB COLLISION
  // ══════════════════════════════════════════════════════════════════════════════
  _applyPhysics(dt) {
    const speedMult = this.crouching ? this.crouchMoveMultiplier : 1.0;

    // Apply gravity
    this.velocity.y += this.gravity * dt; // ← TWEAK gravity for arc shape

    // Horizontal AABB
    let nextX = this.game.camera.position.x + this.moveVelocity.x * speedMult * dt;
    let nextZ = this.game.camera.position.z + this.moveVelocity.z * speedMult * dt;

    if (this.game.mapData?.obstacles) {
      const pad = this.playerRadius;
      const playerY = this.game.camera.position.y;
      for (const obs of this.game.mapData.obstacles) {
        const obsH = obs.height || 4;
        // Only collide if the player's feet are below the top of the obstacle
        if (playerY > obsH) continue;

        const pz = this.game.camera.position.z;
        const px = this.game.camera.position.x;
        if (nextX > obs.min.x - pad && nextX < obs.max.x + pad &&
          pz > obs.min.z - pad && pz < obs.max.z + pad) {
          nextX = px;
        }
        if (px > obs.min.x - pad && px < obs.max.x + pad &&
          nextZ > obs.min.z - pad && nextZ < obs.max.z + pad) {
          nextZ = pz;
        }
      }
    }

    this.game.camera.position.x = nextX;
    this.game.camera.position.z = nextZ;
    this.game.camera.position.y += this.velocity.y * dt;

    // Floor collision (uses smoothed cam height so crouch works correctly)
    if (this.game.camera.position.y <= this._currentCamHeight) {
      this.game.camera.position.y = this._currentCamHeight;
      this.velocity.y = 0;
      this.grounded = true;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════
  //  SLIDE
  // ══════════════════════════════════════════════════════════════════════════════
  _startSlide(dirX, dirZ) {
    this.sliding = true;
    this.slideTimer = this.slideDuration;
    this._slideCooldownTimer = this.slideCooldown;
    this.slideDir = { x: dirX, z: dirZ };

    // ── INSTANT burst — this is what covers real distance ──────────────────
    // We SET velocity (not add) so it always fires at full slideSpeed
    this.moveVelocity.x = dirX * this.slideSpeed;  // ← TWEAK slideSpeed
    this.moveVelocity.z = dirZ * this.slideSpeed;
  }

  _updateSlide(dt) {
    if (this._slideCooldownTimer > 0) this._slideCooldownTimer -= dt;
    if (!this.sliding) return;

    this.slideTimer -= dt;

    // progress goes 1 → 0 over the slide duration
    const progress = Math.max(this.slideTimer / this.slideDuration, 0);
    // quadratic ease-out: fast start, smooth stop, always > slideMinSpeed
    const currentSpeed = this.slideMinSpeed +
      (this.slideSpeed - this.slideMinSpeed) * (progress * progress);
    // ↑ TWEAK slideMinSpeed for how much you linger at the end

    this.moveVelocity.x = this.slideDir.x * currentSpeed;
    this.moveVelocity.z = this.slideDir.z * currentSpeed;

    if (this.slideTimer <= 0) {
      this.sliding = false;
      this.crouching = true; // remain crouched after slide ends
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════
  //  CROUCH — smooth height interpolation, correct depth
  // ══════════════════════════════════════════════════════════════════════════════
  _updateCrouch(dt) {
    const wantCrouch =
      this.sliding ||
      this.game.input.isKeyDown('KeyC') ||
      this.game.input.isKeyDown('ControlLeft');

    this.crouching = wantCrouch;

    // ── crouchHeight = 0.55 → eyes at 1.8 × 0.55 = 0.99 units ─────────────
    // That's realistic: roughly chin height. TWEAK crouchHeight to taste.
    const targetH = this.crouching
      ? this.playerHeight * this.crouchHeight
      : this.playerHeight;

    // Smooth lerp toward target
    this._currentCamHeight +=
      (targetH - this._currentCamHeight) * this.crouchSpeed * dt;

    // Push camera Y to match only when grounded (airborne crouch = cosmetic only)
    if (this.grounded) {
      this.game.camera.position.y +=
        (this._currentCamHeight - this.game.camera.position.y) * this.crouchSpeed * dt;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════
  //  HEAD BOB — vertical + lateral roll, SYMMETRIC both sides
  // ══════════════════════════════════════════════════════════════════════════════
  _updateHeadBob(dt) {
    const onGround = this.grounded && !this.sliding;
    const shouldBob = this._isMoving && onGround;

    // Smooth bob intensity in/out (0 = still, 1 = full bob)
    const targetIntensity = shouldBob ? 1.0 : 0.0;
    this._bobSmooth += (targetIntensity - this._bobSmooth) * 8 * dt;

    this._bobOffsetY = 0;
    this._bobRoll = 0;

    if (this._bobSmooth > 0.001) {
      // Crouching = slower bob frequency
      const freq = this.crouching
        ? this.bobFrequency * 0.6
        : this.bobFrequency;          // ← TWEAK bobFrequency for step pace

      this._bobTime += freq * dt;

      // Vertical: sin(2t) = two bumps per full cycle (left step + right step)
      this._bobOffsetY =
        Math.sin(this._bobTime * 2) * this.bobAmplitudeY * this._bobSmooth;
      //                            ↑ TWEAK bobAmplitudeY for bounce height

      // Lateral roll: sin(t) = gentle sway — SYMMETRIC (same formula = same L/R)
      this._bobRoll =
        Math.sin(this._bobTime) * this.bobAmplitudeX * this._bobSmooth;
      //                        ↑ TWEAK bobAmplitudeX for sway width
    }

    // Apply vertical bob to camera Y
    this.game.camera.position.y += this._bobOffsetY;

    // Jump kick: tiny camera downward blip on liftoff, decays quickly
    if (this._jumpKick !== 0) {
      this.game.camera.position.y += this._jumpKick;
      this._jumpKick *= Math.pow(0.001, dt); // fast exponential decay
      if (Math.abs(this._jumpKick) < 0.0005) this._jumpKick = 0;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════
  //  CAMERA LEAN — strafe tilt + slide tilt, all as camera roll (rotation.z)
  // ══════════════════════════════════════════════════════════════════════════════
  _updateLean(dt) {
    // Strafe lean: -1 (left strafe) → +leanMaxAngle, +1 (right) → -leanMaxAngle
    // SYMMETRIC: same magnitude both directions because formula is just ×moveRight
    const strafeLean = -this._moveRight * this.leanMaxAngle;
    //                                     ↑ TWEAK leanMaxAngle (radians)

    // Slide adds a dramatic roll in the direction of travel
    let slideLean = 0;
    if (this.sliding) {
      const camRight = this.game.camera.getDirection(new BABYLON.Vector3(1, 0, 0));
      // Dot product tells us how much slide dir aligns with camera right
      const dot = this.slideDir.x * camRight.x + this.slideDir.z * camRight.z;
      slideLean = -dot * this.slideTilt; // ← TWEAK slideTilt for roll drama
    }

    const targetRoll = strafeLean + slideLean + this._bobRoll;

    // Smooth lerp toward target roll
    this._leanCurrent += (targetRoll - this._leanCurrent) * this.leanSpeed * dt;
    //                                                       ↑ TWEAK leanSpeed

    this.game.camera.rotation.z = this._leanCurrent;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  //  MAP BOUNDS CLAMP
  // ══════════════════════════════════════════════════════════════════════════════
  _clampToMap() {
    const halfX = (this.game.mapData?.size?.x || 60) / 2 - 1;
    const halfZ = (this.game.mapData?.size?.z || 60) / 2 - 1;
    this.game.camera.position.x =
      Math.max(-halfX, Math.min(halfX, this.game.camera.position.x));
    this.game.camera.position.z =
      Math.max(-halfZ, Math.min(halfZ, this.game.camera.position.z));
  }

  // ══════════════════════════════════════════════════════════════════════════════
  //  STATE EXPORT (unchanged API — other systems can still call this)
  // ══════════════════════════════════════════════════════════════════════════════
  getState() {
    return {
      position: {
        x: this.game.camera.position.x,
        y: this.game.camera.position.y,
        z: this.game.camera.position.z
      },
      rotation: { x: this.pitch, y: this.yaw },
      moving: this._isMoving,
      crouching: this.crouching,
      grounded: this.grounded,
      jumping: !this.grounded,
      sliding: this.sliding,
    };
  }
}