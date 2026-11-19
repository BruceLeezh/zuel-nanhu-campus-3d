// 全局可调参数（单一来源，便于集中调优）
export const CFG = {
  seed: 20261109,
  world: {
    sizeX: 1900, sizeZ: 1500,      // 地形网格覆盖范围（米）
    gridX: 220, gridZ: 180,        // 地形细分
    waterLevel: -1.6,
  },
  render: {
    fov: 62,
    near: 0.3,
    far: 3000,
    maxPixelRatio: 2,
    shadows: true,
    shadowMapSize: 2048,
    fogNear: 520, fogFar: 3600,
  },
  sky: {
    // 秋日午后（武汉 11 月），略带雾霾
    top: 0x6d9fce, mid: 0xbcd2e4, bottom: 0xeee6d6,
    sunAzimuth: Math.PI * 0.72, sunElevation: 0.47,
    sunColor: 0xffe9cc, sunIntensity: 2.2,
    hemiSky: 0xbcd6ee, hemiGround: 0x9a8f78, hemiIntensity: 0.85,
    ambient: 0x6f7d8c, ambientIntensity: 0.35,
    fogColor: 0xcddde7, fogNear: 300, fogFar: 3600,
    cloudCover: 0.42,
  },
  player: {
    radius: 0.34, height: 1.72, eye: 1.6,
    walk: 2.3, run: 6.0, sprint: 8.2,
    accel: 12, decel: 16, airControl: 0.3,
    gravity: 22, jump: 6.6, jumpHold: 0.16,
    climbSpeed: 1.5, climbReach: 0.75,
    grabReach: 2.2, grabForce: 22,
    turnRate: 12,
    mass: 62,
  },
  camera: {
    dist: 5.6, minDist: 1.8, maxDist: 12.0,
    minPolar: 0.12, maxPolar: 1.45,
    pivotHeight: 1.25,
    damp: 9,
    collide: true,
  },
  physics: {
    fixedStep: 1 / 120,
    maxSubSteps: 4,
    gravity: -22,
  },
  quality: {
    low: { dpr: 1, shadows: 1024, shadowEvery: 3, trees: 0.45, props: 0.5, grass: 0 },
    mid: { dpr: 1.5, shadows: 2048, shadowEvery: 2, trees: 0.75, props: 0.8, grass: 1 },
    high: { dpr: 2, shadows: 2048, shadowEvery: 1, trees: 1.0, props: 1.0, grass: 1 },
  },
  keys: {
    forward: ['KeyW', 'ArrowUp'], back: ['KeyS', 'ArrowDown'],
    left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
    jump: ['Space'], run: ['ShiftLeft', 'ShiftRight'],
    grab: ['KeyE'], climb: ['KeyF'], interact: ['KeyQ'],
    camera: ['KeyC'], respawn: ['KeyR'], help: ['KeyH'], quality: ['KeyP'],
    map: ['KeyM'], screenshot: ['KeyX'],
  },
};

export default CFG;
