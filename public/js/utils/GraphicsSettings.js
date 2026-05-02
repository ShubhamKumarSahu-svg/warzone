/**
 * GraphicsSettings - Quality presets for Babylon.js
 */
class GraphicsSettings {
  constructor(scene, engine) {
    this.scene = scene;
    this.engine = engine;
    this.quality = 'medium';
  }

  apply(quality) {
    this.quality = quality;
    const scene = this.scene;
    const engine = this.engine;

    switch (quality) {
      case 'low':
        engine.setHardwareScalingLevel(1.5);
        scene.shadowsEnabled = false;
        scene.particlesEnabled = false;
        scene.postProcessesEnabled = false;
        scene.lensFlaresEnabled = false;
        if (scene.fogMode !== BABYLON.Scene.FOGMODE_NONE) scene.fogMode = BABYLON.Scene.FOGMODE_NONE;
        break;

      case 'medium':
        engine.setHardwareScalingLevel(1.0);
        scene.shadowsEnabled = true;
        scene.particlesEnabled = true;
        scene.postProcessesEnabled = false;
        scene.lensFlaresEnabled = false;
        break;

      case 'high':
        engine.setHardwareScalingLevel(1.0);
        scene.shadowsEnabled = true;
        scene.particlesEnabled = true;
        scene.postProcessesEnabled = true;
        scene.lensFlaresEnabled = true;
        break;
    }
  }
}
