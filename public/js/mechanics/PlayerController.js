class PlayerController {
  constructor(game) {
    this.game = game;
    
    // Movement configuration
    this.maxMoveSpeed = 8;
    this.acceleration = 10;
    this.deceleration = 12;
    this.jumpForce = 12;
    this.gravity = -25;
    this.playerHeight = 1.8;
    this.playerRadius = 0.5;

    // Slide configuration
    this.slideDuration = 0.6;
    this.slideSpeed = 14;

    // State
    this.yaw = 0;
    this.pitch = 0;
    this.velocity = new BABYLON.Vector3(0, 0, 0);
    this.moveVelocity = new BABYLON.Vector3(0, 0, 0);
    this.grounded = false;
    this.crouching = false;
    
    this.sliding = false;
    this.slideDir = { x: 0, z: 0 };
    this.slideTimer = 0;
    this.slideCooldown = 0;
  }

  update(dt) {
    if (!this.game.alive || !this.game.input.locked) return;

    // Mouse look
    const mouseDelta = this.game.input.getMouseDelta();
    this.yaw += mouseDelta.dx;
    this.pitch += mouseDelta.dy;
    this.pitch = Math.max(-Math.PI / 2.1, Math.min(Math.PI / 2.1, this.pitch));

    // Apply recoil offset
    const recoilOffset = this.game.weapons.recoilOffset;
    this.pitch -= recoilOffset.y;
    this.yaw += recoilOffset.x;

    this.game.camera.rotation.y = this.yaw;
    this.game.camera.rotation.x = this.pitch;

    // Movement
    const move = this.game.input.getMovement();
    const isMoving = move.forward !== 0 || move.right !== 0;

    // Calculate absolute world vectors directly from camera
    const camForward = this.game.camera.getDirection(new BABYLON.Vector3(0, 0, 1));
    camForward.y = 0; camForward.normalize();
    const camRight = this.game.camera.getDirection(new BABYLON.Vector3(1, 0, 0));
    camRight.y = 0; camRight.normalize();

    let dirX = camForward.x * move.forward + camRight.x * move.right;
    let dirZ = camForward.z * move.forward + camRight.z * move.right;

    if (isMoving) {
      const len = Math.sqrt(dirX * dirX + dirZ * dirZ);
      dirX /= len;
      dirZ /= len;
    }

    // Slide initiation
    if (this.game.input.isKeyDown('ShiftLeft') && this.grounded && isMoving && !this.sliding && this.slideCooldown <= 0) {
      this.sliding = true;
      this.slideTimer = this.slideDuration;
      this.slideCooldown = 1.0;
      this.slideDir = { x: dirX, z: dirZ };
    }

    if (!this.sliding) {
      if (isMoving) {
        const targetVx = dirX * this.maxMoveSpeed;
        const targetVz = dirZ * this.maxMoveSpeed;
        const t = 1 - Math.exp(-this.acceleration * dt);
        this.moveVelocity.x += (targetVx - this.moveVelocity.x) * t;
        this.moveVelocity.z += (targetVz - this.moveVelocity.z) * t;
      } else {
        const t = 1 - Math.exp(-this.deceleration * dt);
        this.moveVelocity.x *= (1 - t);
        this.moveVelocity.z *= (1 - t);
      }
    }

    const speedMult = this.crouching ? 0.5 : 1.0;

    // Jump
    if (this.game.input.isKeyDown('Space') && this.grounded) {
      this.velocity.y = this.jumpForce;
      this.grounded = false;
    }

    // Gravity
    this.velocity.y += this.gravity * dt;

    // Movement with AABB collision
    let nextX = this.game.camera.position.x + this.moveVelocity.x * speedMult * dt;
    let nextZ = this.game.camera.position.z + this.moveVelocity.z * speedMult * dt;
    let canMoveX = true;
    let canMoveZ = true;

    if (this.game.mapData && this.game.mapData.obstacles) {
      const padding = this.playerRadius;
      for (const obs of this.game.mapData.obstacles) {
        if (nextX > obs.min.x - padding && nextX < obs.max.x + padding &&
          this.game.camera.position.z > obs.min.z - padding && this.game.camera.position.z < obs.max.z + padding) {
          canMoveX = false;
        }
        if (this.game.camera.position.x > obs.min.x - padding && this.game.camera.position.x < obs.max.x + padding &&
          nextZ > obs.min.z - padding && nextZ < obs.max.z + padding) {
          canMoveZ = false;
        }
      }
    }

    if (canMoveX) this.game.camera.position.x = nextX;
    if (canMoveZ) this.game.camera.position.z = nextZ;
    this.game.camera.position.y += this.velocity.y * dt;

    if (this.game.camera.position.y <= this.playerHeight) {
      this.game.camera.position.y = this.playerHeight;
      this.velocity.y = 0;
      this.grounded = true;
    }

    // Crouch (also crouching during slide)
    this.crouching = this.sliding || this.game.input.isKeyDown('KeyC') || this.game.input.isKeyDown('ControlLeft');

    // Clamp to map bounds
    const halfX = (this.game.mapData?.size?.x || 60) / 2 - 1;
    const halfZ = (this.game.mapData?.size?.z || 60) / 2 - 1;
    this.game.camera.position.x = Math.max(-halfX, Math.min(halfX, this.game.camera.position.x));
    this.game.camera.position.z = Math.max(-halfZ, Math.min(halfZ, this.game.camera.position.z));

    this.updateSlideState(dt);
  }

  updateSlideState(dt) {
    if (this.slideCooldown > 0) {
      this.slideCooldown -= dt;
    }

    if (this.sliding) {
      this.slideTimer -= dt;
      // Exponential decay of slide speed
      const currentSlideSpeed = this.slideSpeed * (this.slideTimer / this.slideDuration);
      this.moveVelocity.x = this.slideDir.x * Math.max(currentSlideSpeed, this.maxMoveSpeed);
      this.moveVelocity.z = this.slideDir.z * Math.max(currentSlideSpeed, this.maxMoveSpeed);

      if (this.slideTimer <= 0) {
        this.sliding = false;
        this.crouching = true;
      }
    }

    // Camera height interpolation (Crouch / Slide)
    const targetHeight = this.crouching ? this.playerHeight * 0.5 : this.playerHeight;
    this.game.camera.position.y += (targetHeight - this.game.camera.position.y) * 10 * dt;
  }

  getState() {
    const move = this.game.input.getMovement();
    const isMoving = move.forward !== 0 || move.right !== 0;
    return {
      position: { x: this.game.camera.position.x, y: this.game.camera.position.y, z: this.game.camera.position.z },
      rotation: { x: this.pitch, y: this.yaw },
      moving: isMoving,
      crouching: this.crouching,
      grounded: this.grounded,
      jumping: !this.grounded
    };
  }
}
