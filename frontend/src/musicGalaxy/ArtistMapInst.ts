import type { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import type { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer';
import * as Comlink from 'comlink';
import { UnimplementedError, UnreachableException } from 'ameo-utils';
import type { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass';
import type Stats from 'three/examples/jsm/libs/stats.module';

import { fetchPackedArtistPositions, getAllTopArtistInternalIDsForUser } from './api';
import {
  BASE_ARTIST_GEOMETRY_SIZE,
  getArtistSize,
  MOVEMENT_SPEED_UNITS_PER_SECOND,
  ARTIST_GEOMETRY_OPACITY,
  DEFAULT_FOV,
  BLOOM_PARAMS,
  SHIFT_SPEED_MULTIPLIER,
  MAX_ARTIST_PLAY_CLICK_DISTANCE,
  PLAYING_ARTIST_COLOR,
  CAMERA_PIVOT_COEFFICIENT,
  CAMERA_OVERRIDE_TARGET_TOLERANCE,
  AMBIENT_LIGHT_COLOR,
  getArtistFlyToDurationMs,
  HIGHLIGHTED_ARTIST_COLOR,
  getHighlightedArtistsIntraOpacity,
  INITIAL_ORBIT_POSITION,
  INITIAL_CAMERA_ROTATION,
  INITIAL_ORBIT_TARGET,
  FRAME_TIMING_BUFFER_SIZE,
  getSecondsBetweenPositionUpdates,
  DEFAULT_QUALITY,
  getBloomedConnectionOpacity,
  getHighlightedArtistsInterOpacity,
  BASE_ARTIST_COLOR,
} from './conf';
import DataFetchClient, { ArtistMapDataWithId, ArtistRelationshipData } from './DataFetchClient';
import { MovementInputHandler } from './MovementInputHandler';
import type { WasmClient } from './WasmClient/WasmClient.worker';
import { UIEventRegistry } from './OverlayUI/OverlayUI';
import MusicManager from './MusicManager';
import { clamp, delay } from 'src/util2';

interface ThreeExtra {
  PointerLockControls: typeof import('three/examples/jsm/controls/PointerLockControls')['PointerLockControls'];
  OrbitControls: typeof import('three/examples/jsm/controls/OrbitControls')['OrbitControls'];
  RenderPass: typeof import('three/examples/jsm/postprocessing/RenderPass')['RenderPass'];
  ShaderPass: typeof import('three/examples/jsm/postprocessing/ShaderPass')['ShaderPass'];
  UnrealBloomPass: typeof import('three/examples/jsm/postprocessing/UnrealBloomPass')['UnrealBloomPass'];
  EffectComposer: typeof import('three/examples/jsm/postprocessing/EffectComposer')['EffectComposer'];
  Stats: typeof import('three/examples/jsm/libs/stats.module');
}

const dataFetchClient = new DataFetchClient();

const wasmClient = Comlink.wrap<WasmClient>(
  new Worker(new URL('./WasmClient/WasmClient.worker', import.meta.url))
);

const waitForWasmClientInitialization = async () => {
  while (true) {
    const isReady = await Promise.race([wasmClient.isReady(), delay(50)] as const);
    if (isReady) {
      return;
    }
  }
};

export const getUserSpotifyID = (): string | null => {
  const searchParams = new URLSearchParams(window.location.search);
  const userSpotifyID = searchParams.get('spotifyID') || searchParams.get('spotifyId');
  if (userSpotifyID === 'x') {
    delete localStorage['userSpotifyID'];
    return null;
  } else if (userSpotifyID) {
    localStorage.setItem('userSpotifyID', userSpotifyID);
    return userSpotifyID;
  }

  return localStorage.getItem('userSpotifyID');
};

export const initArtistMapInst = async (canvas: HTMLCanvasElement): Promise<ArtistMapInst> => {
  const [
    artistColorsByID,
    {
      THREE,
      PointerLockControls,
      OrbitControls,
      RenderPass,
      ShaderPass,
      UnrealBloomPass,
      EffectComposer,
      Stats,
    },
  ] = await Promise.all([
    fetchPackedArtistPositions().then(async (packedArtistPositions) => {
      // The wasm client web worker needs to do some async initialization.  Wait for it to do that so we
      // don't leak our requests into the ether
      await waitForWasmClientInitialization();

      // Populate the wasm client running in a web worker with the fetched packed artist positions
      const packed = new Uint8Array(packedArtistPositions);
      return wasmClient.decodeAndRecordPackedArtistPositions(
        Comlink.transfer(packed, [packed.buffer]),
        getIsMobile()
      );
    }),
    import('./lazyThree').then((mod) => mod.default),
  ] as const);
  const THREE_EXTRA: ThreeExtra = {
    PointerLockControls,
    OrbitControls,
    RenderPass,
    ShaderPass,
    UnrealBloomPass,
    EffectComposer,
    Stats,
  };

  const allArtistData = await wasmClient.getAllArtistData();

  const inst = new ArtistMapInst(THREE, THREE_EXTRA, canvas, allArtistData, artistColorsByID);
  dataFetchClient.fetchArtistRelationships(0);

  // Set highlighted artists.
  const userSpotifyID = getUserSpotifyID();
  if (userSpotifyID) {
    getAllTopArtistInternalIDsForUser(userSpotifyID).then((artistIDs) =>
      inst.setHighlightedArtistIDs(artistIDs)
    );
  }

  return inst;
};

let VEC3_IDENTITY: THREE.Vector3;

enum DrawCommand {
  AddLabel = 0,
  RemoveLabel = 1,
  AddArtistGeometry = 2,
  RemoveArtistGeometry = 3,
  FetchArtistLabel = 4,
  StartPlayingMusic = 5,
  StopPlayingMusic = 6,
}

interface AutoFlyState {
  path: THREE.Curve<THREE.Vector3>;
  startTime: number;
  flightDurationMs: number;
  artistID: number | null;
  callback?: () => void;
}

interface LookAtState {
  target: THREE.Vector3;
  pivotCoefficient: number;
}

export type Quality = 11 | 10 | 9 | 8 | 7 | 6 | 5 | 4;

export const getIsMobile = () =>
  (window.innerWidth > 0 ? window.innerWidth : screen.width) < 768 ||
  (window.innerHeight > 0 ? window.innerHeight : screen.height) < 480 ||
  /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

export const getDevicePixelRatio = () => {
  // Force pixel ratio to be 1 if on Macs; many older-gen macs (2015 and older) and I'm sure mac minis etc. aren't
  // powerful enough to render performantly with large retina screens that have subpixel scaling.
  if (['MacIntel', 'iPad'].includes(navigator.platform)) {
    return 1;
  }

  return window.devicePixelRatio ?? 1;
};

export class ArtistMapInst {
  public THREE: typeof import('three');
  public THREE_EXTRA: ThreeExtra;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls:
    | { type: 'pointerlock'; controls: PointerLockControls }
    | { type: 'orbit'; controls: OrbitControls }
    | { type: 'flyorbit'; controls: OrbitControls };
  private isPointerLocked = false;
  private bloomPass: UnrealBloomPass;
  private bloomComposer: EffectComposer;
  private finalComposer: EffectComposer;
  private clock: THREE.Clock;
  private secondSinceLastPositionUpdate = 0;
  public isMobile = getIsMobile();
  private cachedCanvasWidth: number;
  private cachedCanvasHeight: number;
  private cachedDevicePixelRatio = getDevicePixelRatio();
  private quality: Quality = DEFAULT_QUALITY;
  private lastFrameTimings = new Array<number>(FRAME_TIMING_BUFFER_SIZE).fill(-1);
  private lastQualityChangeTime: number | null = null;
  private frameCount = 0;
  private isFocused = true;
  private stats: Stats | null = null;
  private artistSearchOpen = false;

  private renderedArtistBufferIndicesByArtistID: Map<number, number> = new Map();
  private artistIDByRenderedArtistBufferIndex: Map<number, number> = new Map();
  private bloomedConnectionsGeometry: THREE.BufferGeometry;
  private bloomedConnectionsMesh: THREE.Line;
  private highlightedArtistsIntraLines: THREE.LineSegments | null = null;
  private artistDataByID: Map<number, { pos: THREE.Vector3; popularity: number }> = new Map();
  private pendingDrawCommands: Uint32Array[] = [];
  private artistMeshes: THREE.InstancedMesh;
  private artistColorsByID: Map<number, readonly [number, number, number]> | null = null;
  private playingArtistScale = 1;
  private playingArtistGeometry: THREE.Mesh | null = null;
  private movementInputHandler: MovementInputHandler;
  private lastCameraDirection: THREE.Vector3;
  private lastCameraPosition: THREE.Vector3;
  private forceLabelsUpdate = false;
  private wasmPositionHandlerIsRunning = false;
  private highlightedArtistIDs: Set<number> = new Set();
  private raycaster: THREE.Raycaster;
  private isDevMode = false;
  private cameraOverrides: {
    movement: AutoFlyState | null;
    direction: LookAtState | null;
  } = {
    movement: null,
    direction: null,
  };

  private musicManager: MusicManager;

  public getLabelPosition(labelID: string | number) {
    if (typeof labelID === 'string') {
      throw new UnimplementedError();
    }

    const artistData = this.artistDataByID.get(labelID);
    if (!artistData) {
      throw new Error(`Artist ${labelID} is missing`);
    }

    // Check to see if it is in front of or behind the camera
    const offsetToCamera = this.camera.position.clone().sub(artistData.pos.clone()).normalize();
    const cameraDirection = this.camera.getWorldDirection(artistData.pos.clone()).clone();
    const angle = offsetToCamera.dot(cameraDirection);
    const isInFrontOfCamera = angle < 0;

    const point = artistData.pos.clone();
    point.project(this.camera);

    const devicePixelRatio = this.cachedDevicePixelRatio;
    return {
      x: (0.5 + point.x / 2) * (this.cachedCanvasWidth / devicePixelRatio),
      y: (0.5 - point.y / 2) * (this.cachedCanvasHeight / devicePixelRatio),
      isInFrontOfCamera,
      distance: this.camera.position.distanceTo(artistData.pos),
      popularity: artistData.popularity,
    };
  }

  public eventRegistry: UIEventRegistry = new UIEventRegistry({
    getLabelPosition: (labelID: string | number) => this.getLabelPosition(labelID),
    getShouldUpdate: () => {
      const curCameraDirection = this.camera.getWorldDirection(VEC3_IDENTITY).clone();
      const curPosition = this.camera.position.clone();

      const shouldUpdate =
        this.forceLabelsUpdate ||
        this.lastCameraDirection.x !== curCameraDirection.x ||
        this.lastCameraDirection.y !== curCameraDirection.y ||
        this.lastCameraDirection.z !== curCameraDirection.z ||
        this.lastCameraPosition.x !== curPosition.x ||
        this.lastCameraPosition.y !== curPosition.y ||
        this.lastCameraPosition.z !== curPosition.z;

      this.lastCameraDirection = curCameraDirection;
      this.lastCameraPosition = curPosition;
      this.forceLabelsUpdate = false;
      return shouldUpdate;
    },
    getArtistName: (artistID: number) => {
      const data = dataFetchClient.fetchedArtistDataByID.get(artistID);
      if (!data || data === 'FETCHING') {
        return '';
      }
      return data.name;
    },
    getShouldRenderCrosshair: () => false, // TODO: Just remove this
    getIfArtistIDsAreInEmbedding: (artistIDs: number[]) =>
      artistIDs.map((id) => this.artistDataByID.has(id)),
    lookAtArtistID: (artistID: number) => this.lookAtArtistID(artistID),
    flyToArtistID: (artistID: number) => this.flyToArtistID(artistID),
    lockPointer: () => {
      if (this.controls.type !== 'pointerlock') {
        return;
      }
      this.controls.controls.lock();
      this.isPointerLocked = true;
    },
    setVolume: (newVolume: number) => this.musicManager.setVolume(newVolume),
    setControlMode: (newControlMode: 'orbit' | 'flyorbit' | 'pointerlock') => {
      if (newControlMode === 'orbit') {
        this.cameraOverrides.movement = {
          path: new this.THREE.QuadraticBezierCurve3(
            this.camera.position.clone(),
            new this.THREE.Vector3(0, 0, 0),
            new this.THREE.Vector3(
              INITIAL_ORBIT_POSITION.x,
              INITIAL_ORBIT_POSITION.y,
              INITIAL_ORBIT_POSITION.z
            )
          ),
          startTime: new Date().getTime(),
          flightDurationMs: 2800,
          artistID: null,
          callback: () => {
            this.cameraOverrides.direction = {
              target: new this.THREE.Vector3(0, 0, 0),
              pivotCoefficient: 0.973,
            };
          },
        };
      }
      this.initControls(newControlMode);
    },
    setArtistSearchOpen: (isOpen: boolean) => {
      this.artistSearchOpen = isOpen;
    },
  });

  private lookAtArtistID(artistID: number) {
    const pos = this.artistDataByID.get(artistID)?.pos;
    if (!pos) {
      throw new UnreachableException();
    }

    if (this.controls.type === 'orbit') {
      wasmClient
        .forceRenderArtistLabel(artistID)
        .then((drawCommands) => this.pendingDrawCommands.push(drawCommands));
    }

    this.cameraOverrides.direction = { target: pos, pivotCoefficient: CAMERA_PIVOT_COEFFICIENT };
  }

  private flyToPosition(dstPos: THREE.Vector3, artistID: number | null) {
    const srcPos = this.camera.position.clone();

    // See written notes for this
    const midpoint = dstPos.clone().add(srcPos).multiplyScalar(0.5);
    const controlPoint1 = midpoint.clone().add(
      midpoint
        .clone()
        .normalize()
        .multiplyScalar(srcPos.distanceTo(dstPos) * 0.4 + 300_000)
    );
    const controlPoint2 = dstPos.clone().add(
      dstPos
        .clone()
        .sub(srcPos.clone())
        .normalize()
        .multiplyScalar(srcPos.distanceTo(dstPos) * 0.05 + 50_000)
    );

    const path = new this.THREE.CubicBezierCurve3(srcPos, controlPoint1, controlPoint2, dstPos);

    this.cameraOverrides.direction = { target: dstPos, pivotCoefficient: 0.937 };
    this.cameraOverrides.movement = {
      path,
      startTime: new Date().getTime(),
      flightDurationMs: getArtistFlyToDurationMs(dstPos.distanceTo(srcPos)),
      artistID,
    };
    if (artistID !== null) {
      console.log(`Flying to ${artistID}`, this.cameraOverrides.movement);
    }
  }

  private flyToArtistID(artistID: number) {
    if (this.isMobile) {
      this.eventRegistry.onPointerLocked();
    }

    const flyCameraMode = this.isMobile ? ('flyorbit' as const) : ('pointerlock' as const);

    if (this.controls.type !== flyCameraMode) {
      this.initControls(flyCameraMode);
      // TODO: Animate zoom
      this.camera.zoom = 1;
      this.camera.fov = DEFAULT_FOV;
      this.eventRegistry.currentZoom = 1;
      this.camera.updateProjectionMatrix();
    }

    const dstPos = this.artistDataByID.get(artistID)?.pos;
    if (!dstPos) {
      throw new UnreachableException();
    }

    this.flyToPosition(dstPos, artistID);
  }

  public handleScroll(deltaY: number) {
    // Orbit mode controls already intercept + handle wheel events
    if (this.controls.type === 'orbit') {
      return;
    }

    const newZoom = Math.max(0.45, Math.min(2, this.camera.zoom + -deltaY * 0.0005));
    this.camera.zoom = newZoom;
    this.camera.updateProjectionMatrix();
    this.eventRegistry.currentZoom = newZoom;

    this.forceLabelsUpdate = true;
  }

  public handlePointerDown(evt: { button: number }) {
    this.musicManager.startCtx();

    if (this.controls.type === 'pointerlock') {
      const wasLocked = this.isPointerLocked;
      this.isPointerLocked = true;
      this.controls.controls.lock();
      this.scene.add(this.controls.controls.getObject());

      if (!wasLocked) {
        return;
      }

      if (evt.button === 0) {
        if (this.musicManager.curPlaying) {
          const curPosition = this.camera.position.clone();
          wasmClient
            .onMusicFinishedPlaying(this.musicManager.curPlaying.artistID, [
              curPosition.x,
              curPosition.y,
              curPosition.z,
            ])
            .then((drawCommands) => this.pendingDrawCommands.push(drawCommands));
          this.musicManager.stopPlaying(this.musicManager.curPlaying.artistID);
        }
      } else if (evt.button === 2) {
        wasmClient
          .playLastArtist()
          .then((drawCommands) => this.pendingDrawCommands.push(drawCommands));
      }
    }
  }

  public setHighlightedArtistIDs(artistIDs: number[]) {
    // Wasm client is the source of truth for what artists are rendered.  We indicate to it that highlighted artists have changed
    // and let it deal with dispatching draw commands to re-render them and possibly de-render the old ones.
    const curPosition = this.camera.position.clone();
    wasmClient
      .setHighlightedArtists(
        new Uint32Array(artistIDs),
        curPosition.x,
        curPosition.y,
        curPosition.z,
        this.controls.type !== 'orbit'
      )
      .then((drawCommands) => this.pendingDrawCommands.push(drawCommands));

    // Setting these here allows us to know whether or not an artist is highlighted during rendering.  We don't do that now, but
    // will do it once the draw commands returned above are processed.
    this.highlightedArtistIDs = new Set(artistIDs);
  }

  private buildInstancedArtistMeshes() {
    const geometry = new this.THREE.SphereGeometry(BASE_ARTIST_GEOMETRY_SIZE, 12, 8);
    // Use 8-bit color channels because that seems to be faster.  This is technically not what three.js
    // is expecting and some methods break like `setColorAt`
    const instanceColorBuffer = new Uint8ClampedArray(70_000 * 3);
    const instanceColor = new this.THREE.InstancedBufferAttribute(instanceColorBuffer, 3, true);
    instanceColor.count = 0;
    geometry.setAttribute('instanceColor', instanceColor);

    const material = new this.THREE.MeshBasicMaterial({
      transparent: true,
      opacity: ARTIST_GEOMETRY_OPACITY,
    });
    const meshes = new this.THREE.InstancedMesh(geometry, material, 70_000);
    meshes.instanceColor = instanceColor;
    // These methods don't work with non-f32 instancecolor buffers; ensure that they aren't used
    meshes.getColorAt = () => {
      throw new UnreachableException();
    };
    meshes.setColorAt = () => {
      throw new UnreachableException();
    };

    meshes.count = 0;
    return meshes;
  }

  constructor(
    THREE: typeof import('three'),
    THREE_EXTRA: ThreeExtra,
    canvas: HTMLCanvasElement,
    allArtistData: Float32Array,
    artistColorsByID: Map<number, readonly [number, number, number]>
  ) {
    this.THREE = THREE;
    this.THREE_EXTRA = THREE_EXTRA;
    VEC3_IDENTITY = new THREE.Vector3();
    this.lastCameraDirection = VEC3_IDENTITY.clone();
    this.cachedCanvasWidth = canvas.width;
    this.cachedCanvasHeight = canvas.height;
    this.artistColorsByID = artistColorsByID;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      // precision: 'lowp',
      powerPreference: 'high-performance',
      alpha: true,
    });
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    this.renderer.setPixelRatio(getDevicePixelRatio());
    this.renderer.toneMapping = THREE.ReinhardToneMapping;
    this.renderer.toneMappingExposure = navigator.platform === 'MacIntel' ? 1.97 : 1.764;
    this.clock = new THREE.Clock();
    this.renderer.info.autoReset = false;
    (window as any).renderer = this.renderer;

    if (!this.isMobile) {
      this.stats = this.THREE_EXTRA.Stats.default();
      this.stats.domElement.style.position = 'absolute';
      this.stats.domElement.style.bottom = '0px';
      this.stats.domElement.style.left = '0px';
      this.stats.domElement.style.top = 'unset';
      canvas.parentNode!.appendChild(this.stats.dom);
    }

    window.addEventListener('keydown', (evt) => {
      if (!this.isDevMode) {
        return;
      }

      switch (evt.key) {
        case 'ArrowUp':
          this.renderer.toneMappingExposure += 0.01;
          console.log({ exposure: this.renderer.toneMappingExposure });
          break;
        case 'ArrowDown':
          this.renderer.toneMappingExposure -= 0.01;
          if (this.renderer.toneMappingExposure < 0) {
            this.renderer.toneMappingExposure = 0;
          }
          console.log({ exposure: this.renderer.toneMappingExposure });
          break;
        case '1':
          this.renderer.toneMapping = THREE.ReinhardToneMapping;
          this.renderer.toneMappingExposure = navigator.platform === 'MacIntel' ? 1.97 : 1.757;
          break;
        case '2':
          this.renderer.toneMapping = THREE.ReinhardToneMapping;
          this.renderer.toneMappingExposure = 1.9845;
          break;
        case '3':
          this.renderer.toneMapping = THREE.CineonToneMapping;
          this.renderer.toneMappingExposure = 0.99;
          break;
        case '4':
          this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
          this.renderer.toneMappingExposure = 1.4;
          break;
        case '5':
          this.renderer.toneMapping = THREE.NoToneMapping;
          this.renderer.toneMappingExposure = 0.625;
          break;
        case '6':
          this.renderer.toneMapping = THREE.CineonToneMapping;
          this.renderer.toneMappingExposure = 1.1;
          break;
        case '7':
          this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
          this.renderer.toneMappingExposure = 0.92;
          break;
        case '8':
          this.renderer.toneMapping = THREE.LinearToneMapping;
          this.renderer.toneMappingExposure = 0.85;
          break;
        case '9':
          this.renderer.toneMapping = THREE.ReinhardToneMapping;
          this.renderer.toneMappingExposure = 2.2;
          break;
        case 'Escape':
          if (this.controls.type === 'orbit') {
            this.eventRegistry.onPointerUnlocked();
          }
          break;
      }
    });

    window.addEventListener('focus', () => {
      this.isFocused = true;
      this.lastFrameTimings = new Array<number>(FRAME_TIMING_BUFFER_SIZE).fill(-1);
    });
    window.addEventListener('blur', () => {
      this.isFocused = false;
    });

    let touchStartPos: THREE.Vector2 | null = null;
    window.addEventListener('touchstart', (evt) => {
      if (evt.touches.length > 1) {
        touchStartPos = null;
      } else {
        touchStartPos = new THREE.Vector2(evt.touches[0].clientX, evt.touches[0].clientY);
      }
    });
    window.addEventListener('touchend', (evt) => {
      if (touchStartPos === null) {
        return;
      }
      const endPos = new THREE.Vector2(
        evt.changedTouches[0].clientX,
        evt.changedTouches[0].clientY
      );
      if (Math.abs(touchStartPos.x - endPos.x) > 20 || Math.abs(touchStartPos.y - endPos.y) > 20) {
        return;
      }
      if (this.controls.type !== 'flyorbit') {
        return;
      }

      const pixelRatio = getDevicePixelRatio();
      const intersection = (() => {
        for (let tolerancePx = 0; tolerancePx < 5; tolerancePx++) {
          for (const signum of [-1, 1]) {
            const srcX = endPos.x + signum * tolerancePx;
            const srcY = endPos.y + signum * tolerancePx;

            // Convert touch position to normalized device coordinates from -1 to 1
            const x = clamp(-1, 1, (srcX / (this.cachedCanvasWidth / pixelRatio)) * 2 - 1);
            const y = clamp(-1, 1, -(srcY / (this.cachedCanvasHeight / pixelRatio)) * 2 + 1);

            this.raycaster.setFromCamera(new this.THREE.Vector2(x, y), this.camera);
            const intersection = this.raycaster.intersectObject(this.artistMeshes, false)[0];
            if (
              intersection &&
              intersection.distance <= MAX_ARTIST_PLAY_CLICK_DISTANCE &&
              intersection.instanceId !== undefined
            ) {
              return intersection;
            }
          }
        }

        return undefined;
      })();

      if (!intersection || !intersection.instanceId) {
        return;
      }

      const artistID = this.artistIDByRenderedArtistBufferIndex.get(intersection.instanceId);
      if (!artistID) {
        console.error("Artist clicked but isn't tracked in `artistIDByRenderedArtistBufferIndex`");
        return;
      }

      wasmClient
        .handleArtistManualPlay(artistID)
        .then((drawCommands) => this.pendingDrawCommands.push(drawCommands));

      this.lookAtArtistID(artistID);
    });

    this.camera = new THREE.PerspectiveCamera(
      DEFAULT_FOV,
      canvas.width / canvas.height,
      0.1,
      1200_000
    );

    this.raycaster = new THREE.Raycaster();

    this.movementInputHandler = new MovementInputHandler((newRolloffFactor) =>
      this.musicManager.setRolloffFactor(newRolloffFactor)
    );

    this.scene = new THREE.Scene();
    this.scene.fog = null; // new this.THREE.Fog(0x000000, 1, 9_472_000);

    const light = new THREE.AmbientLight(AMBIENT_LIGHT_COLOR);
    this.scene.add(light);

    window.addEventListener('resize', () => this.handleResize());

    this.initControls('orbit');
    this.camera.position.set(
      INITIAL_ORBIT_POSITION.x * (this.isMobile ? 1.4 : 1),
      INITIAL_ORBIT_POSITION.y * (this.isMobile ? 1.4 : 1),
      INITIAL_ORBIT_POSITION.z * (this.isMobile ? 1.4 : 1)
    );
    this.camera.rotation.set(
      INITIAL_CAMERA_ROTATION.x,
      INITIAL_CAMERA_ROTATION.y,
      INITIAL_CAMERA_ROTATION.z
    );
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.renderer.domElement.addEventListener('mousedown', (evt) => this.handlePointerDown(evt));

    this.artistMeshes = this.buildInstancedArtistMeshes();
    this.scene.add(this.artistMeshes);

    this.bloomedConnectionsGeometry = new this.THREE.BufferGeometry();
    const bloomedLineMaterial = new this.THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      opacity: getBloomedConnectionOpacity(this.quality),
      // premultipliedAlpha: true,
      // precision: 'lowp',
    });
    this.bloomedConnectionsMesh = new this.THREE.LineSegments(
      this.bloomedConnectionsGeometry,
      bloomedLineMaterial
    );
    this.scene.add(this.bloomedConnectionsMesh);

    const artistCount = allArtistData.length / 5;

    const allArtistDataU32 = new Uint32Array(allArtistData.buffer);
    for (let i = 0; i < artistCount; i++) {
      const artistID = allArtistDataU32[i * 5];
      this.artistDataByID.set(artistID, {
        pos: new THREE.Vector3(
          allArtistData[i * 5 + 1],
          allArtistData[i * 5 + 2],
          allArtistData[i * 5 + 3]
        ),
        popularity: allArtistDataU32[i * 5 + 4],
      });
    }

    this.initBloomPass();

    this.musicManager = new MusicManager();

    dataFetchClient.registerCallbacks(
      (data) => this.handleArtistData(data),
      (data) => this.handleArtistRelationships(data)
    );

    this.animate();
    setTimeout(() => this.handleResize(), 50);
  }

  private handleResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.bloomPass.setSize(window.innerWidth, window.innerHeight);
    this.bloomComposer.setSize(window.innerWidth, window.innerHeight);
    this.forceLabelsUpdate = true;

    const canvas = this.renderer.domElement;
    this.cachedCanvasWidth = canvas.width;
    this.cachedCanvasHeight = canvas.height;
  }

  private initControls(controlMode: 'pointerlock' | 'orbit' | 'flyorbit') {
    if ((this.eventRegistry.controlMode !== 'orbit' && controlMode === 'orbit') || !this.controls) {
      this.eventRegistry.deleteAllLabels();
      wasmClient
        .transitionToOrbitMode()
        .then((drawCommands) => this.pendingDrawCommands.push(drawCommands));
    }
    this.eventRegistry.controlMode = controlMode;
    this.eventRegistry.onControlModeChange(controlMode);

    if (this.controls) {
      this.controls.controls.dispose();
    }

    if (this.highlightedArtistsIntraLines) {
      (this.highlightedArtistsIntraLines.material as THREE.LineBasicMaterial).opacity =
        getHighlightedArtistsIntraOpacity(controlMode, this.highlightedArtistIDs.size);
    }

    switch (controlMode) {
      case 'pointerlock': {
        const controls = new this.THREE_EXTRA.PointerLockControls(
          this.camera,
          this.renderer.domElement
        );
        this.controls = { type: controlMode, controls };
        this.controls.controls.addEventListener('unlock', () => {
          if (this.isPointerLocked) {
            this.isPointerLocked = false;
            this.scene.remove(controls.getObject());
          }

          this.eventRegistry.onPointerUnlocked();
        });
        this.controls.controls.addEventListener('lock', () => {
          this.eventRegistry.onPointerLocked();
        });
        break;
      }
      case 'orbit': {
        const controls = new this.THREE_EXTRA.OrbitControls(this.camera, this.renderer.domElement);
        controls.target.set(INITIAL_ORBIT_TARGET.x, INITIAL_ORBIT_TARGET.y, INITIAL_ORBIT_TARGET.z);
        controls.autoRotate = true;
        controls.autoRotateSpeed = 0.048;
        controls.enableDamping = true;
        controls.dampingFactor = 0.1;
        controls.enableKeys = false;
        controls.keyPanSpeed = 40;
        this.controls = { type: controlMode, controls };
        break;
      }
      case 'flyorbit': {
        const controls = new this.THREE_EXTRA.OrbitControls(this.camera, this.renderer.domElement);
        controls.enabled = true;
        this.controls = { type: controlMode, controls };
        break;
      }
      default: {
        console.error('Unknown control mode:', controlMode);
      }
    }
  }

  // Adapted from:
  // https://github.com/mrdoob/three.js/blob/master/examples/webgl_postprocessing_unreal_bloom_selective.html
  private initBloomPass() {
    const renderScene = new this.THREE_EXTRA.RenderPass(this.scene, this.camera);

    this.bloomPass = new this.THREE_EXTRA.UnrealBloomPass(
      new this.THREE.Vector2(this.renderer.domElement.width, this.renderer.domElement.height),
      BLOOM_PARAMS.bloomStrength,
      BLOOM_PARAMS.bloomRadius,
      BLOOM_PARAMS.bloomThreshold
    );
    this.bloomPass.threshold = BLOOM_PARAMS.bloomThreshold;
    this.bloomPass.strength = BLOOM_PARAMS.bloomStrength;
    this.bloomPass.radius = BLOOM_PARAMS.bloomRadius;

    this.bloomComposer = new this.THREE_EXTRA.EffectComposer(this.renderer);
    this.bloomComposer.renderToScreen = false;
    this.bloomComposer.addPass(renderScene);
    this.bloomComposer.addPass(this.bloomPass);

    const finalPass = new this.THREE_EXTRA.ShaderPass(
      new this.THREE.ShaderMaterial({
        uniforms: {
          baseTexture: { value: null },
          bloomTexture: { value: this.bloomComposer.renderTarget2.texture },
        },
        vertexShader: `
          varying vec2 vUv;

          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
          }
        `,
        fragmentShader: `
          uniform sampler2D baseTexture;
			    uniform sampler2D bloomTexture;

			    varying vec2 vUv;

			    void main() {
				    gl_FragColor = ( texture2D( baseTexture, vUv ) + vec4( 1.0 ) * texture2D( bloomTexture, vUv ) );
			    }
        `,
        defines: {},
      }),
      'baseTexture'
    );
    finalPass.needsSwap = true;

    this.finalComposer = new this.THREE_EXTRA.EffectComposer(this.renderer);
    this.finalComposer.addPass(renderScene);
    this.finalComposer.addPass(finalPass);
  }

  private async handleArtistData(artistData: ArtistMapDataWithId[]) {
    const curPos = this.camera.position;
    wasmClient
      .handleReceivedArtistNames(
        new Uint32Array(artistData.map(({ id }) => id)),
        curPos.x,
        curPos.y,
        curPos.z,
        this.controls.type !== 'orbit'
      )
      .then((drawCommands) => {
        if (drawCommands.length === 0) {
          return;
        }

        this.pendingDrawCommands.push(drawCommands);
      });
  }

  private async handleArtistRelationships(relationshipData: ArtistRelationshipData) {
    // Empty chunk; all chunks are fetched
    if (relationshipData.res.byteLength === 4) {
      // Render connections between highlighted artists
      if (this.highlightedArtistIDs.size > 0) {
        const { intra, inter } = await wasmClient.getHighlightedConnectionsBackbone(
          new Uint32Array([...this.highlightedArtistIDs])
        );
        const interLineCount = inter.length / 6;
        const intraLineCount = intra.length / 6;

        // Build more opaque lines between related highlighted artists and somewhat less opaque lines between
        // highlighted artists and non-highlighted artists they are connected to
        const intraBufferGeometry = new this.THREE.BufferGeometry();
        intraBufferGeometry.setAttribute('position', new this.THREE.BufferAttribute(intra, 3));
        const intraLines = new this.THREE.LineSegments(intraBufferGeometry);
        intraLines.material = new this.THREE.LineBasicMaterial({
          color: HIGHLIGHTED_ARTIST_COLOR,
          transparent: true,
          depthWrite: false,
          opacity: getHighlightedArtistsIntraOpacity(
            this.controls.type,
            this.highlightedArtistIDs.size
          ),
        });
        this.scene.add(intraLines);
        this.highlightedArtistsIntraLines = intraLines;

        const interBufferGeometry = new this.THREE.BufferGeometry();
        interBufferGeometry.setAttribute('position', new this.THREE.BufferAttribute(inter, 3));
        const interLines = new this.THREE.LineSegments(interBufferGeometry);
        interLines.material = new this.THREE.LineBasicMaterial({
          color: 0x914a07,
          transparent: true,
          depthWrite: false,
          opacity: getHighlightedArtistsInterOpacity(intraLineCount, interLineCount),
        });
        this.scene.add(interLines);
      }

      return;
    }

    const packedRelationshipData = new Uint8Array(relationshipData.res);

    wasmClient
      .handleArtistRelationshipData(
        Comlink.transfer(packedRelationshipData, [packedRelationshipData.buffer]),
        relationshipData.chunkSize,
        relationshipData.chunkIx
      )
      .then((connectionsDataBuffer) => this.updateConnectionsBuffer(connectionsDataBuffer));

    // Fetch the next chunk
    dataFetchClient.fetchArtistRelationships(relationshipData.chunkIx + 1);
  }

  private updateConnectionsBuffer({
    connectionsBuffer: connectionsDataBuffer,
    connectionsColorBuffer,
  }: {
    connectionsBuffer: Float32Array;
    connectionsColorBuffer: Uint8ClampedArray;
  }) {
    console.log(
      'Updating connections data buffer; new rendered connection count: ',
      connectionsDataBuffer.length / 6
    );
    this.bloomedConnectionsGeometry.setAttribute(
      'position',
      new this.THREE.BufferAttribute(connectionsDataBuffer, 3)
    );
    if (connectionsColorBuffer.length % 6 !== 0) {
      throw new UnreachableException('Expected multiple of 6 for colors buffer');
    }
    this.bloomedConnectionsGeometry.setAttribute(
      'color',
      new this.THREE.Uint8ClampedBufferAttribute(connectionsColorBuffer, 3, true)
    );
    this.bloomedConnectionsGeometry.computeBoundingSphere();
  }

  private getArtistColor(id: number, isHighlighted: boolean, isPlaying: boolean): THREE.Color {
    if (isPlaying) {
      return new this.THREE.Color(PLAYING_ARTIST_COLOR);
    }

    if (isHighlighted) {
      return new this.THREE.Color(HIGHLIGHTED_ARTIST_COLOR);
    }

    const color = this.artistColorsByID?.get(id);
    if (!color) {
      console.error('Missing artist color', { artistColorsByID: this.artistColorsByID, id });
      return new this.THREE.Color(BASE_ARTIST_COLOR);
    }

    const [r, g, b] = color;
    return new this.THREE.Color(r, g, b);
  }

  public renderArtists(artistsToRender: number[]) {
    let minUpdatedArtistIx = Infinity;
    let maxUpdatedArtistIx = 0;

    // Skip artists that are already rendered
    const newArtistCount = artistsToRender.filter(
      (id) => id !== null && id !== undefined && !this.renderedArtistBufferIndicesByArtistID.has(id)
    ).length;

    const startIx = this.artistMeshes.count;
    this.artistMeshes.count = startIx + newArtistCount;
    if (this.artistMeshes.instanceColor) {
      this.artistMeshes.instanceColor.count = startIx + newArtistCount;
      maxUpdatedArtistIx = this.artistMeshes.instanceColor.count;
    }

    const matrix = new this.THREE.Matrix4();

    let newRenderedArtistCount = 0;
    artistsToRender.forEach((id) => {
      const artistData = this.artistDataByID.get(id);
      if (!artistData) {
        throw new UnreachableException(`Artist ${id} has no pos`);
      }

      const isHighlighted = this.highlightedArtistIDs.has(id);
      const isPlaying = this.musicManager.curPlaying?.artistID === id;
      const size = getArtistSize(artistData.popularity, isHighlighted, isPlaying);
      matrix.makeScale(size, size, size);
      matrix.setPosition(artistData.pos);

      const existingBufferIndex = this.renderedArtistBufferIndicesByArtistID.get(id);
      const bufferIndex = existingBufferIndex ?? startIx + newRenderedArtistCount;
      minUpdatedArtistIx = Math.min(minUpdatedArtistIx, bufferIndex);
      maxUpdatedArtistIx = Math.max(maxUpdatedArtistIx, bufferIndex);
      if (existingBufferIndex === undefined) {
        newRenderedArtistCount += 1;
      }

      this.artistMeshes.setMatrixAt(bufferIndex, matrix);
      const color = this.getArtistColor(id, isHighlighted, isPlaying);
      // this.artistMeshes.setColorAt(bufferIndex, color);
      (this.artistMeshes.instanceColor!.array as Uint8ClampedArray)[bufferIndex * 3] =
        color.r * 255;
      (this.artistMeshes.instanceColor!.array as Uint8ClampedArray)[bufferIndex * 3 + 1] =
        color.g * 255;
      (this.artistMeshes.instanceColor!.array as Uint8ClampedArray)[bufferIndex * 3 + 2] =
        color.b * 255;

      this.renderedArtistBufferIndicesByArtistID.set(id, bufferIndex);
      this.artistIDByRenderedArtistBufferIndex.set(bufferIndex, id);
    });

    const existingUpdateStartIx =
      this.artistMeshes.instanceMatrix.updateRange.count === -1
        ? minUpdatedArtistIx
        : this.artistMeshes.instanceMatrix.updateRange.offset /
          this.artistMeshes.instanceMatrix.itemSize;
    if (existingUpdateStartIx < minUpdatedArtistIx) {
      minUpdatedArtistIx = existingUpdateStartIx;
    }
    const existingUpdateEndIx =
      this.artistMeshes.instanceMatrix.updateRange.count === -1
        ? maxUpdatedArtistIx
        : this.artistMeshes.instanceMatrix.updateRange.offset /
            this.artistMeshes.instanceMatrix.itemSize +
          this.artistMeshes.instanceMatrix.count / this.artistMeshes.instanceMatrix.itemSize;
    if (existingUpdateEndIx > maxUpdatedArtistIx) {
      maxUpdatedArtistIx = existingUpdateEndIx;
    }

    this.artistMeshes.instanceMatrix.needsUpdate = true;
    this.artistMeshes.instanceMatrix.updateRange.offset =
      minUpdatedArtistIx * this.artistMeshes.instanceMatrix.itemSize;
    this.artistMeshes.instanceMatrix.updateRange.count =
      (maxUpdatedArtistIx - minUpdatedArtistIx) * this.artistMeshes.instanceMatrix.itemSize;
    this.artistMeshes.instanceColor!.needsUpdate = true;
    this.artistMeshes.instanceColor!.updateRange.offset =
      minUpdatedArtistIx * this.artistMeshes.instanceColor!.itemSize;
    this.artistMeshes.instanceColor!.updateRange.count =
      (maxUpdatedArtistIx - minUpdatedArtistIx) * this.artistMeshes.instanceColor!.itemSize;
  }

  public removeArtists(artistInternalIDs: number[]) {
    let minUpdatedArtistIx = Infinity;
    let maxUpdatedArtistIx = this.artistMeshes.count - 1;

    const artistsToRemove = artistInternalIDs.filter((id) =>
      this.renderedArtistBufferIndicesByArtistID.has(id)
    );

    const matrix = new this.THREE.Matrix4();
    artistsToRemove.forEach((id) => {
      const targetBufferIndex = this.renderedArtistBufferIndicesByArtistID.get(id);
      const idOfLastArtist = this.artistIDByRenderedArtistBufferIndex.get(
        this.artistMeshes.count - 1
      );
      if (
        targetBufferIndex === null ||
        targetBufferIndex === undefined ||
        idOfLastArtist === null ||
        idOfLastArtist === undefined
      ) {
        throw new UnreachableException();
      }

      minUpdatedArtistIx = Math.min(minUpdatedArtistIx, targetBufferIndex);

      this.renderedArtistBufferIndicesByArtistID.delete(id);
      this.artistIDByRenderedArtistBufferIndex.delete(targetBufferIndex);

      if (idOfLastArtist !== id) {
        // Swap the last element into the position of the one that's being removed
        this.artistMeshes.getMatrixAt(this.artistMeshes.count - 1, matrix);
        this.artistMeshes.setMatrixAt(targetBufferIndex, matrix);
        // this.artistMeshes.getColorAt(this.artistMeshes.count - 1, color);
        // this.artistMeshes.setColorAt(targetBufferIndex, color);
        (this.artistMeshes.instanceColor!.array as Uint8ClampedArray)[targetBufferIndex * 3] = (
          this.artistMeshes.instanceColor!.array as Uint8ClampedArray
        )[(this.artistMeshes.count - 1) * 3];
        (this.artistMeshes.instanceColor!.array as Uint8ClampedArray)[targetBufferIndex * 3 + 1] = (
          this.artistMeshes.instanceColor!.array as Uint8ClampedArray
        )[(this.artistMeshes.count - 1) * 3 + 1];
        (this.artistMeshes.instanceColor!.array as Uint8ClampedArray)[targetBufferIndex * 3 + 2] = (
          this.artistMeshes.instanceColor!.array as Uint8ClampedArray
        )[(this.artistMeshes.count - 1) * 3 + 2];
        this.artistIDByRenderedArtistBufferIndex.set(targetBufferIndex, idOfLastArtist);
        this.renderedArtistBufferIndicesByArtistID.set(idOfLastArtist, targetBufferIndex);
      }

      this.artistMeshes.count -= 1;
    });

    const existingUpdateStartIx =
      this.artistMeshes.instanceMatrix.updateRange.count === -1
        ? minUpdatedArtistIx
        : this.artistMeshes.instanceMatrix.updateRange.offset /
          this.artistMeshes.instanceMatrix.itemSize;
    if (existingUpdateStartIx < minUpdatedArtistIx) {
      minUpdatedArtistIx = existingUpdateStartIx;
    }
    const existingUpdateEndIx =
      this.artistMeshes.instanceMatrix.updateRange.count === -1
        ? maxUpdatedArtistIx
        : this.artistMeshes.instanceMatrix.updateRange.offset /
            this.artistMeshes.instanceMatrix.itemSize +
          this.artistMeshes.instanceMatrix.count / this.artistMeshes.instanceMatrix.itemSize;
    if (existingUpdateEndIx > maxUpdatedArtistIx) {
      maxUpdatedArtistIx = existingUpdateEndIx;
    }

    this.artistMeshes.instanceMatrix.needsUpdate = true;
    this.artistMeshes.instanceMatrix.updateRange.offset =
      minUpdatedArtistIx * this.artistMeshes.instanceMatrix.itemSize;
    this.artistMeshes.instanceMatrix.updateRange.count =
      (maxUpdatedArtistIx - minUpdatedArtistIx) * this.artistMeshes.instanceMatrix.itemSize;
    this.artistMeshes.instanceColor!.needsUpdate = true;
    this.artistMeshes.instanceColor!.updateRange.offset =
      minUpdatedArtistIx * this.artistMeshes.instanceColor!.itemSize;
    this.artistMeshes.instanceColor!.updateRange.count =
      (maxUpdatedArtistIx - minUpdatedArtistIx) * this.artistMeshes.instanceColor!.itemSize;
  }

  private maybeAnimatePlayingArtist() {
    if (!this.playingArtistGeometry) {
      return;
    }

    const gain = this.musicManager.getCurPlayingMusicVolume();
    if (!Number.isFinite(gain)) {
      throw new UnreachableException('Bad gain returned from music manager: ' + gain);
    }
    const scale = Math.pow(2, gain * 7.4);
    // Low-pass filter the scale to avoid it flickering
    this.playingArtistScale = this.playingArtistScale * 0.7 + scale * 0.3;
    const newMatrix = new this.THREE.Matrix4();
    const pos = this.playingArtistGeometry.position.clone();
    newMatrix.makeScale(this.playingArtistScale, this.playingArtistScale, this.playingArtistScale);
    newMatrix.setPosition(pos);
    this.playingArtistGeometry.matrix.copy(newMatrix);
  }

  private render(forward: number) {
    this.renderer.info.reset();

    if (
      this.secondSinceLastPositionUpdate > getSecondsBetweenPositionUpdates(this.quality) &&
      !this.wasmPositionHandlerIsRunning
    ) {
      this.secondSinceLastPositionUpdate = 0;
      this.wasmPositionHandlerIsRunning = true;

      const curPos = (() => {
        if (this.controls.type === 'pointerlock') {
          return this.camera.position.clone();
        }

        // If we are close to the target point, we treat the target as the current position for label and music playing purposes.
        const distanceToTarget = this.camera.position.distanceTo(this.controls.controls.target);
        if (distanceToTarget < 30_000) {
          return this.controls.controls.target.clone();
        }

        // If we are a medium distance away from the target point, we treat the current position as between the camera and the target
        if (distanceToTarget < 60_000) {
          return this.camera.position.clone().lerp(this.controls.controls.target, 0.3);
        }

        // If we are very far away, we treat the camera position as the current position
        return this.camera.position.clone();
      })();
      const projectedNextPos =
        this.controls.type === 'pointerlock'
          ? curPos.clone().add(
              this.controls.controls
                .getDirection(VEC3_IDENTITY)
                .clone()
                .multiplyScalar(
                  MOVEMENT_SPEED_UNITS_PER_SECOND *
                    0.15 *
                    (this.movementInputHandler.isSpeedBoosted() ? SHIFT_SPEED_MULTIPLIER : 1) *
                    forward
                )
            )
          : curPos.clone();

      wasmClient
        .handleNewPosition(
          // Wasm doesn't run new position handler unless position changes.  If we're immobile in orbit camera, we
          // force it to run occasionally to prevent stuff from getting stuck
          curPos.x +
            (this.controls.type !== 'pointerlock' && Math.random() > 0.9 ? Math.random() / 2 : 0),
          curPos.y,
          curPos.z,
          projectedNextPos.x,
          projectedNextPos.y,
          projectedNextPos.z,
          this.controls.type !== 'orbit'
        )
        .then((commands) => {
          this.wasmPositionHandlerIsRunning = false;
          if (commands.length === 0) {
            return;
          }
          this.pendingDrawCommands.push(commands);
        });
    }

    const cameraDirection = this.camera.getWorldDirection(new this.THREE.Vector3());
    const cameraUp = this.camera.up;
    if (this.controls.type !== 'orbit' && this.playingArtistGeometry) {
      // If mobile, we set the listener position to the position of the playing artist
      //
      // But still preserve the spatialization effect when the camera is moving
      if (this.isMobile && !this.cameraOverrides.movement) {
        this.musicManager.setListenerPosition(
          this.playingArtistGeometry.position,
          new this.THREE.Vector3(),
          new this.THREE.Vector3()
        );
      } else {
        this.musicManager.setListenerPosition(
          this.camera.position.clone(),
          cameraDirection,
          cameraUp
        );
      }
    }

    this.maybeAnimatePlayingArtist();

    this.bloomComposer.render();
    this.finalComposer.render();
  }

  private removePlayingArtistGeometry(artistID: number) {
    if (!this.playingArtistGeometry) {
      // Trigger the old geometry to come back to normal size
      this.renderArtists([artistID]);
      return;
    }

    this.scene.remove(this.playingArtistGeometry);
    this.playingArtistGeometry.geometry.dispose();
    (this.playingArtistGeometry.material as THREE.MeshBasicMaterial).dispose();
    this.playingArtistGeometry = null;

    // Trigger the old geometry to come back to normal size
    this.renderArtists([artistID]);
  }

  private createPlayingArtistGeometry(artistID: number) {
    if (this.playingArtistGeometry) {
      console.error('A playing artist geometry already exists');
      this.scene.remove(this.playingArtistGeometry);
    }

    const artistData = this.artistDataByID.get(artistID)!;
    if (!artistData) {
      throw new UnreachableException(`Missing data for artist id=${artistID}`);
    }
    const size = getArtistSize(artistData.popularity, true, false) * 1.3;
    const geometry = new this.THREE.SphereGeometry(size, 26, 15);
    const material = new this.THREE.MeshBasicMaterial({
      color: new this.THREE.Color(PLAYING_ARTIST_COLOR),
      opacity: 0.7,
      transparent: true,
      // precision: 'lowp',
    });
    this.playingArtistGeometry = new this.THREE.Mesh(geometry, material);
    this.playingArtistGeometry.position.copy(artistData.pos);
    this.playingArtistGeometry.matrixAutoUpdate = false;
    this.scene.add(this.playingArtistGeometry);

    // Trigger the old geometry to have a very tiny size
    this.renderArtists([artistID]);
  }

  private processDrawCommands(commands: Uint32Array) {
    if (commands.length % 2 !== 0) {
      throw new UnreachableException('Invalid command count');
    }

    this.artistMeshes.instanceMatrix.updateRange.count = -1;
    this.artistMeshes.instanceMatrix.updateRange.offset = 0;
    this.artistMeshes.instanceMatrix.needsUpdate = false;
    this.artistMeshes.instanceColor!.updateRange.count = -1;
    this.artistMeshes.instanceColor!.updateRange.offset = 0;
    this.artistMeshes.instanceColor!.needsUpdate = false;

    const cmdCount = commands.length / 2;

    const artistIDsToRender = [];
    const artistIDsToRemove = [];
    const artistIDsToFetch = [];

    for (let i = 0; i < cmdCount; i++) {
      const command = commands[i * 2] as DrawCommand;
      const artistID = commands[i * 2 + 1];

      switch (command) {
        case DrawCommand.AddLabel: {
          const label = dataFetchClient.fetchedArtistDataByID.get(artistID);
          if (label === 'FETCHING' || label === undefined) {
            throw new UnreachableException('Must have fetched label by now');
          } else if (label === null) {
            console.warn('Missing artist name for id=', artistID);
            // Spotify API must have missing data for this artist
            break;
          }

          const artistData = this.artistDataByID.get(artistID);
          if (!artistData) {
            throw new UnreachableException(`Missing data for artist id=${artistID}`);
          }

          const nameData = dataFetchClient.fetchedArtistDataByID.get(artistID);
          if (!nameData || nameData === 'FETCHING') {
            throw new UnreachableException('Must have fetched name by now');
          }

          this.eventRegistry.createLabel(artistID, nameData.name);
          this.forceLabelsUpdate = true;

          break;
        }
        case DrawCommand.RemoveLabel: {
          this.eventRegistry.deleteLabel(artistID);
          break;
        }
        case DrawCommand.AddArtistGeometry: {
          artistIDsToRender.push(artistID);
          break;
        }
        case DrawCommand.RemoveArtistGeometry: {
          artistIDsToRemove.push(artistID);
          break;
        }
        case DrawCommand.FetchArtistLabel: {
          artistIDsToFetch.push(artistID);
          break;
        }
        case DrawCommand.StartPlayingMusic: {
          const artistPos = this.artistDataByID.get(artistID)!.pos;
          const onEnded = () => {
            this.removePlayingArtistGeometry(artistID);

            wasmClient
              .onMusicFinishedPlaying(artistID, [artistPos.x, artistPos.y, artistPos.z])
              .then((commands) => {
                this.pendingDrawCommands.push(commands);
              });
          };

          this.musicManager.startPlaying(artistID, artistPos, onEnded).then(() => {
            const isActuallyPlaying = this.musicManager.curPlaying?.artistID === artistID;
            if (!isActuallyPlaying) {
              return;
            }

            this.eventRegistry.curPlaying = artistID;

            // Playing has actually started; color the artist to indicate that it's playing
            this.createPlayingArtistGeometry(artistID);
          });
          break;
        }
        case DrawCommand.StopPlayingMusic: {
          this.eventRegistry.curPlaying = null;
          this.musicManager.stopPlaying(artistID);
          this.removePlayingArtistGeometry(artistID);
          break;
        }
        default: {
          throw new UnreachableException();
        }
      }
    }

    if (artistIDsToRemove.length > 0) {
      this.removeArtists(artistIDsToRemove);
    }

    if (artistIDsToRender.length > 0) {
      this.renderArtists(artistIDsToRender);
    }

    if (artistIDsToFetch.length > 0) {
      dataFetchClient.getOrFetchArtistData(artistIDsToFetch);
    }

    this.eventRegistry.flush();
  }

  private animate() {
    this.pendingDrawCommands.forEach((commands) => this.processDrawCommands(commands));
    this.pendingDrawCommands = [];
    this.frameCount += 1;

    if (this.cameraOverrides.direction) {
      const cameraDirection = this.camera.getWorldDirection(new this.THREE.Vector3());
      const pivotCoefficient = this.cameraOverrides.direction.pivotCoefficient;

      let totalDiff: number;
      if (this.controls.type === 'flyorbit' || this.controls.type === 'orbit') {
        const newOrbitTarget = this.controls.controls.target
          .clone()
          .multiplyScalar(pivotCoefficient)
          .add(this.cameraOverrides.direction!.target.clone().multiplyScalar(1 - pivotCoefficient));
        this.controls.controls.target.copy(newOrbitTarget);

        totalDiff =
          this.controls.controls.target.distanceTo(this.cameraOverrides.direction.target) / 10_000;
      } else {
        const targetDirection = this.cameraOverrides.direction.target
          .clone()
          .sub(this.camera.position.clone())
          .normalize();

        const newLookDirection = new this.THREE.Vector3(
          cameraDirection.x * pivotCoefficient + targetDirection.x * (1 - pivotCoefficient),
          cameraDirection.y * pivotCoefficient + targetDirection.y * (1 - pivotCoefficient),
          cameraDirection.z * pivotCoefficient + targetDirection.z * (1 - pivotCoefficient)
        );
        this.camera.lookAt(this.camera.position.clone().add(newLookDirection));

        totalDiff = newLookDirection.distanceTo(targetDirection);
      }

      // If we're close enough to the target and not currently flying, stop overriding the camera
      if (!this.cameraOverrides.movement) {
        if (totalDiff < CAMERA_OVERRIDE_TARGET_TOLERANCE) {
          this.cameraOverrides.direction = null;
        }
      }
    }

    if (this.cameraOverrides.movement) {
      const curTime = new Date().getTime();
      const progress =
        (curTime - this.cameraOverrides.movement.startTime) /
        this.cameraOverrides.movement.flightDurationMs;
      if (progress >= 1) {
        if (this.cameraOverrides.movement.artistID !== null) {
          wasmClient
            .handleArtistManualPlay(this.cameraOverrides.movement.artistID)
            .then((drawCommands) => this.pendingDrawCommands.push(drawCommands));
        }
        console.log('Camera movement finished');
        this.cameraOverrides.movement.callback?.();
        this.cameraOverrides.movement = null;

        // Force position update
        if (this.controls.type !== 'pointerlock') {
          this.controls.controls.target.x += Math.random() / 2;
        }
      } else {
        const newPos = this.cameraOverrides.movement.path.getPoint(progress);
        const endPoint = this.cameraOverrides.movement.path.getPoint(1);
        if (newPos.distanceTo(endPoint) > (this.isMobile ? 8700 : 1560)) {
          this.camera.position.set(newPos.x, newPos.y, newPos.z);
        } else if (this.controls.type !== 'pointerlock') {
          this.controls.controls.target.x += Math.random() / 2;
        }
      }
    }

    const timeDelta = this.clock.getDelta();
    this.secondSinceLastPositionUpdate += timeDelta;

    this.maybeChangeQuality(timeDelta);

    if (this.controls.type === 'pointerlock') {
      if (!this.artistSearchOpen) {
        const { forward, sideways, up } = this.movementInputHandler.getDirectionVector();
        this.controls.controls.moveRight(sideways * MOVEMENT_SPEED_UNITS_PER_SECOND * timeDelta);
        this.controls.controls
          .getObject()
          .position.add(
            this.controls.controls
              .getDirection(VEC3_IDENTITY)
              .clone()
              .multiplyScalar(MOVEMENT_SPEED_UNITS_PER_SECOND * timeDelta * forward)
          )
          .add(
            this.camera.up.clone().multiplyScalar(MOVEMENT_SPEED_UNITS_PER_SECOND * timeDelta * up)
          );
        this.render(forward);
      }

      this.render(0);
    } else if (this.controls.type === 'orbit') {
      this.controls.controls.update();

      this.render(0);
    } else {
      this.controls.controls.update();

      this.render(4);
    }

    this.stats?.update();

    requestAnimationFrame(() => this.animate());
  }

  private setQuality(newQuality: Quality) {
    this.quality = newQuality;
    this.lastQualityChangeTime = new Date().getTime();
    this.lastFrameTimings = new Array<number>(FRAME_TIMING_BUFFER_SIZE).fill(-1);

    wasmClient.setQuality(newQuality).then((connectionsDataBuffer) => {
      if (newQuality <= DEFAULT_QUALITY) {
        this.updateConnectionsBuffer(connectionsDataBuffer);
        (this.bloomedConnectionsMesh.material as THREE.LineBasicMaterial).opacity =
          getBloomedConnectionOpacity(newQuality);
      }
    });

    switch (newQuality) {
      case 11: {
        this.artistMeshes.geometry = new this.THREE.SphereGeometry(
          BASE_ARTIST_GEOMETRY_SIZE,
          15,
          9
        );
        break;
      }
      case 10: {
        this.artistMeshes.geometry = new this.THREE.SphereGeometry(
          BASE_ARTIST_GEOMETRY_SIZE,
          14,
          9
        );
        break;
      }
      case 9: {
        this.artistMeshes.geometry = new this.THREE.SphereGeometry(
          BASE_ARTIST_GEOMETRY_SIZE,
          13,
          8
        );
        break;
      }
      case 8: {
        this.artistMeshes.geometry = new this.THREE.SphereGeometry(
          BASE_ARTIST_GEOMETRY_SIZE,
          12,
          7
        );
        break;
      }
      case 7: {
        this.artistMeshes.geometry = new this.THREE.SphereGeometry(
          BASE_ARTIST_GEOMETRY_SIZE,
          11,
          7
        );
        break;
      }
      case 6: {
        this.artistMeshes.geometry = new this.THREE.SphereGeometry(BASE_ARTIST_GEOMETRY_SIZE, 9, 6);
        break;
      }
      case 5: {
        this.artistMeshes.geometry = new this.THREE.SphereGeometry(BASE_ARTIST_GEOMETRY_SIZE, 9, 5);
        break;
      }
      case 4: {
        this.artistMeshes.geometry = new this.THREE.SphereGeometry(BASE_ARTIST_GEOMETRY_SIZE, 9, 5);
        break;
      }
      default: {
        console.error('Tried to set invalid quality: ', newQuality);
      }
    }
  }

  private maybeChangeQuality(timeDelta: number) {
    if (!this.isFocused) {
      return;
    }

    this.lastFrameTimings.push(timeDelta);
    this.lastFrameTimings.shift();

    let frameCount = 0;
    const averageFrameTime =
      this.lastFrameTimings.reduce((acc, time) => {
        if (time < 0 || time > 1.3) {
          return acc;
        }
        frameCount += 1;
        return acc + time;
      }, 0) / frameCount;

    const averageFPS = 1 / averageFrameTime;

    if (frameCount < 2 * 60) {
      return;
    }
    const now = new Date().getTime();
    if (this.lastQualityChangeTime !== null && now - this.lastQualityChangeTime < 3_000) {
      return;
    }

    switch (this.quality) {
      case 11: {
        if (averageFPS < 20) {
          console.warn(
            'Reducing to quality 8 because average FPS is low over the measurement period',
            { curQuality: this.quality, averageFPS }
          );
          this.setQuality(8);
        } else if (averageFPS < 50) {
          console.warn(
            'Reducing to quality 9 because average FPS is low over the measurement period',
            { curQuality: this.quality, averageFPS }
          );
          this.setQuality(9);
        }
        break;
      }
      case 10: {
        if (averageFPS < 20) {
          console.warn(
            'Reducing to quality 8 because average FPS is low over the measurement period',
            { curQuality: this.quality, averageFPS }
          );
          this.setQuality(8);
        } else if (averageFPS < 50) {
          console.warn(
            'Reducing to quality 9 because average FPS is low over the measurement period',
            { curQuality: this.quality, averageFPS }
          );
          this.setQuality(9);
        } else if (averageFPS > 58) {
          console.warn(
            'Increasing to quality 11 because average FPS is high over the measurement period',
            { curQuality: this.quality, averageFPS }
          );
          this.setQuality(11);
        }
        break;
      }
      case 9: {
        if (averageFPS < 20) {
          console.warn(
            'Reducing to quality 5 because average FPS is low over the measurement period',
            { curQuality: this.quality, averageFPS }
          );
          this.setQuality(5);
        } else if (averageFPS < 50) {
          console.warn(
            'Reducing to quality 6 because average FPS is low over the measurement period',
            { curQuality: this.quality, averageFPS }
          );
          this.setQuality(6);
        } else if (averageFPS > 59) {
          console.warn(
            'Increasing to quality 10 because average FPS is high over the measurement period',
            { curQuality: this.quality, averageFPS }
          );
          this.setQuality(10);
        }
        break;
      }
      case 8: {
        if (averageFPS < 20) {
          console.warn(
            'Reducing to quality 5 because average FPS is low over the measurement period',
            { curQuality: this.quality, averageFPS }
          );
          this.setQuality(5);
        } else if (averageFPS < 40) {
          console.warn(
            'Reducing to quality 6 because average FPS is low over the measurement period',
            { curQuality: this.quality, averageFPS }
          );
          this.setQuality(6);
        } else if (averageFPS > 59) {
          console.warn(
            'Increasing to quality 9 because average FPS is high over the measurement period',
            { curQuality: this.quality, averageFPS }
          );
          this.setQuality(9);
        }
        break;
      }
      case 7: {
        if (averageFPS < 20) {
          console.warn(
            'Reducing to quality 5 because average FPS is low over the measurement period',
            { curQuality: this.quality, averageFPS }
          );
          this.setQuality(5);
        } else if (averageFPS < 40) {
          console.warn(
            'Reducing to quality 6 because average FPS is low over the measurement period',
            { curQuality: this.quality, averageFPS }
          );
          this.setQuality(6);
        } else if (averageFPS > 59) {
          console.warn(
            'Increasing to quality 8 because average FPS is high over the measurement period',
            { curQuality: this.quality, averageFPS }
          );
          this.setQuality(8);
        }
        break;
      }
      case 6: {
        if (averageFPS < 40) {
          console.warn(
            'Reducing to quality 5 because average FPS is low over the measurement period',
            { curQuality: this.quality, averageFPS }
          );
          this.setQuality(5);
        } else if (averageFPS > 59) {
          console.warn(
            'Increasing to quality 7 because average FPS is high over the measurement period',
            { curQuality: this.quality, averageFPS }
          );
          this.setQuality(7);
        }
        break;
      }
      case 5: {
        if (averageFPS < 40) {
          console.warn(
            'Reducing to quality 4 because average FPS is low over the measurement period',
            { curQuality: this.quality, averageFPS }
          );
          this.setQuality(4);
        } else if (averageFPS > 59) {
          console.warn(
            'Increasing to quality 6 because average FPS is high over the measurement period',
            { curQuality: this.quality, averageFPS }
          );
          this.setQuality(6);
        }
        break;
      }
      case 4: {
        if (averageFPS > 55) {
          console.warn(
            'Increasing to quality 5 because average FPS is high over the measurement period',
            { curQuality: this.quality, averageFPS }
          );
          this.setQuality(5);
        }
        break;
      }
      default: {
        console.error('Unhandled quality: ', this.quality);
      }
    }
  }
}
