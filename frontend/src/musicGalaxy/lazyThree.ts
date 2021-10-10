import * as THREE from 'three';

import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer';
import * as Stats from 'three/examples/jsm/libs/stats.module';

export default {
  THREE,
  PointerLockControls,
  OrbitControls,
  RenderPass,
  ShaderPass,
  UnrealBloomPass,
  EffectComposer,
  Stats,
};
