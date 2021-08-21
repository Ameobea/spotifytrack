import type { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls';
import type { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer';
import * as Comlink from 'comlink';

import { fetchPackedArtistPositions } from '../api';
import {
  ARTIST_GEOMETRY_SIZE,
  ARTIST_LABEL_TEXT_SIZE,
  BASE_ARTIST_COLOR,
  BASE_CONNECTION_COLOR,
  MOVEMENT_SPEED_UNITS_PER_SECOND,
} from './conf';
import DataFetchClient, {
  ArtistMapDataWithId,
  ArtistRelationshipDataWithId,
} from './DataFetchClient';
import { MovementInputHandler } from './MovementInputHandler';
import type { WasmClient } from './WasmClient/WasmClient.worker';
import { filterNils } from 'ameo-utils';
import type { Scale } from 'chroma-js';

interface ThreeExtra {
  PointerLockControls: typeof import('three/examples/jsm/controls/PointerLockControls')['PointerLockControls'];
  Stats: typeof import('three/examples/jsm/libs/stats.module.js')['default'];
  RenderPass: typeof import('three/examples/jsm/postprocessing/RenderPass')['RenderPass'];
  ShaderPass: typeof import('three/examples/jsm/postprocessing/ShaderPass')['ShaderPass'];
  UnrealBloomPass: typeof import('three/examples/jsm/postprocessing/UnrealBloomPass')['UnrealBloomPass'];
  EffectComposer: typeof import('three/examples/jsm/postprocessing/EffectComposer')['EffectComposer'];
}

const dataFetchClient = new DataFetchClient();

const getInitialArtistIDsToRender = async (): Promise<number[]> => {
  // This will eventually be fetched from the API or something, probably.
  // prettier-ignore
  return [912, 65, 643, 7801598, 57179651, 9318669, 248, 1339641, 515, 3723925, 486, 3323512, 3140393, 31, 725, 11, 170, 64, 14710, 634, 2, 132, 331787, 86, 93, 9241776, 68, 10176774, 331777, 108578, 110569, 110030, 817, 9301916, 137, 67, 85966964];
};

const wasmClient = Comlink.wrap<WasmClient>(
  new Worker(new URL('./WasmClient/WasmClient.worker', import.meta.url))
);

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const waitForWasmClientInitialization = async () => {
  while (true) {
    const success = await Promise.race([wasmClient.ping(), delay(50)] as const);
    if (success) {
      return;
    }
  }
};

export const initArtistMapInst = async (canvas: HTMLCanvasElement): Promise<ArtistMapInst> => {
  const [
    totalArtistCount,
    { THREE, PointerLockControls, Stats, RenderPass, ShaderPass, UnrealBloomPass, EffectComposer },
  ] = await Promise.all([
    fetchPackedArtistPositions().then(async (packedArtistPositions) => {
      // The wasm client web worker needs to do some async initialization.  Wait for it to do that so we
      // don't leak our requests into the ether
      await waitForWasmClientInitialization();

      // Populate the wasm client running in a web worker with the fetched packed artist positions
      const packed = new Uint8Array(packedArtistPositions);
      return wasmClient.decodeAndRecordPackedArtistPositions(
        Comlink.transfer(packed, [packed.buffer])
      );
    }),
    import('./lazyThree').then((mod) => mod.default),
  ] as const);
  const initialArtistIDsToRenderPromise = getInitialArtistIDsToRender();
  const THREE_EXTRA: ThreeExtra = {
    PointerLockControls,
    Stats,
    RenderPass,
    ShaderPass,
    UnrealBloomPass,
    EffectComposer,
  };

  const allArtistIDs = await wasmClient.getAllArtistPositions();

  const inst = new ArtistMapInst(THREE, THREE_EXTRA, totalArtistCount, canvas, allArtistIDs);
  // Render initial artists
  const initialArtistIDsToRender = await initialArtistIDsToRenderPromise.then((ids) => {
    // Optimization to allow us to start fetching artist data as soon as we have the IDs regardless of whether we've
    // finished fetching the wasm client, three, packed artist positions, etc.
    dataFetchClient.getOrFetchArtistData(ids);
    dataFetchClient.getOrFetchArtistRelationships(ids);

    return ids;
  });

  await inst.renderArtists(initialArtistIDsToRender);
  return inst;
};

let VEC3_IDENTITY: THREE.Vector3;

export class ArtistMapInst {
  public THREE: typeof import('three');
  public THREE_EXTRA: ThreeExtra;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: PointerLockControls;
  private isPointerLocked = false;
  private bloomComposer: EffectComposer;
  private finalComposer: EffectComposer;
  private font: THREE.Font;
  private clock: THREE.Clock;
  private timeElapsed = 0;
  private stats: ReturnType<ThreeExtra['Stats']>;
  private chroma: typeof import('chroma-js');
  private connectionColorScale: Scale;

  private totalArtistCount: number;
  private renderedArtistIDs: Set<number> = new Set();
  private renderedConnectionsBySrcID: Map<number, number[]> = new Map();
  private bloomedConnectionsGeometry: THREE.BufferGeometry;
  private bloomedConnectionsMesh: THREE.Line;
  private nonBloomedConnectionsGeometry: THREE.BufferGeometry;
  private nonBloomedConnectionsMesh: THREE.Line;
  private artistPointsGeometry: THREE.BufferGeometry;
  private renderedArtistLabelsByID: Map<
    number,
    { mesh: THREE.Mesh; pos: THREE.Vector3; width: number }
  > = new Map();
  private artistMeshes: THREE.InstancedMesh;
  private movementInputHandler: MovementInputHandler;

  constructor(
    THREE: typeof import('three'),
    THREE_EXTRA: ThreeExtra,
    totalArtistCount: number,
    canvas: HTMLCanvasElement,
    allArtistPositions: Float32Array
  ) {
    this.THREE = THREE;
    this.THREE_EXTRA = THREE_EXTRA;
    VEC3_IDENTITY = new THREE.Vector3();

    import('chroma-js').then((chroma) => {
      this.chroma = chroma.default;
      this.connectionColorScale = this.chroma.scale(['red', 'green', 'blue']).domain([0, 1]);
    });

    this.totalArtistCount = totalArtistCount;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap; // TODO: Remove
    this.renderer.toneMapping = THREE.ReinhardToneMapping;
    this.clock = new THREE.Clock();

    this.camera = new THREE.PerspectiveCamera(100, canvas.width / canvas.height, 0.1, 200_000);
    this.camera.position.set(1.4, -0.7, 1);
    this.camera.lookAt(0, 0, 0);

    this.movementInputHandler = new MovementInputHandler();

    this.scene = new THREE.Scene();
    this.scene.fog = new this.THREE.Fog(0x000000, 1, 92_000);

    const light = new THREE.AmbientLight(0x404040); // soft white light
    this.scene.add(light);

    this.controls = new THREE_EXTRA.PointerLockControls(this.camera, canvas);
    this.controls.addEventListener('unlock', () => {
      if (this.isPointerLocked) {
        this.isPointerLocked = false;
        this.scene.remove(this.controls.getObject());
      }
    });

    canvas.addEventListener('mousedown', () => {
      if (this.isPointerLocked) {
        return;
      }

      this.isPointerLocked = true;
      this.controls.lock();
      this.scene.add(this.controls.getObject());
    });

    // this.stats = THREE_EXTRA.Stats.default();
    // canvas.appendChild(this.stats.domElement);

    this.artistMeshes = (() => {
      const geometry = new this.THREE.IcosahedronGeometry(ARTIST_GEOMETRY_SIZE, 1);
      const material = new this.THREE.MeshBasicMaterial({
        color: BASE_ARTIST_COLOR,
        // wireframe: true,
        // shininess: 38,
        // fog: true,
        // specular: 0x996633,
        reflectivity: 0,
      });
      const meshes = new this.THREE.InstancedMesh(geometry, material, 100000);
      meshes.count = 0;
      return meshes;
    })();
    this.scene.add(this.artistMeshes);

    this.bloomedConnectionsGeometry = new this.THREE.BufferGeometry();
    const bloomedLineMaterial = new this.THREE.LineBasicMaterial({
      color: BASE_CONNECTION_COLOR,
      transparent: true,
      opacity: 0.01,
    });
    this.bloomedConnectionsMesh = new this.THREE.Line(
      this.bloomedConnectionsGeometry,
      bloomedLineMaterial
    );
    this.scene.add(this.bloomedConnectionsMesh);

    this.nonBloomedConnectionsGeometry = new this.THREE.BufferGeometry();
    const nonBloomedLineMaterial = new this.THREE.LineBasicMaterial({
      color: BASE_CONNECTION_COLOR,
      transparent: true,
      // opacity: 0.08,
      opacity: 0,
    });
    this.nonBloomedConnectionsMesh = new this.THREE.Line(
      this.nonBloomedConnectionsGeometry,
      nonBloomedLineMaterial
    );
    this.scene.add(this.nonBloomedConnectionsMesh);

    const artistCount = allArtistPositions.length / 4;
    const artistPointsPositionsAttribute = new this.THREE.BufferAttribute(
      new Float32Array(artistCount * 3),
      3
    );
    artistPointsPositionsAttribute.needsUpdate = true;

    for (let i = 0; i < artistCount; i++) {
      artistPointsPositionsAttribute.setXYZ(
        i * 4,
        allArtistPositions[i * 4 + 1],
        allArtistPositions[i * 4 + 2],
        allArtistPositions[i * 4 + 3]
      );
    }

    this.artistPointsGeometry = new this.THREE.BufferGeometry();
    // this.artistPointsGeometry.setAttribute('position', artistPointsPositionsAttribute);
    // const pointMaterial = new this.THREE.PointsMaterial({
    //   color: 0x11ee33,
    //   size: 1,
    //   sizeAttenuation: true,
    // });
    // const pointMesh = new this.THREE.Points(this.artistPointsGeometry, pointMaterial);
    // this.scene.add(pointMesh);

    this.initBloomPass();

    this.initAsync();

    this.animate();
  }

  // Adapted from:
  // https://github.com/mrdoob/three.js/blob/master/examples/webgl_postprocessing_unreal_bloom_selective.html
  private initBloomPass() {
    const params = {
      bloomStrength: 3.3,
      bloomThreshold: 0,
      bloomRadius: 0.45,
    };

    const renderScene = new this.THREE_EXTRA.RenderPass(this.scene, this.camera);

    const bloomPass = new this.THREE_EXTRA.UnrealBloomPass(
      new this.THREE.Vector2(this.renderer.domElement.width, this.renderer.domElement.height),
      params.bloomStrength,
      params.bloomRadius,
      params.bloomThreshold
    );
    bloomPass.threshold = params.bloomThreshold;
    bloomPass.strength = params.bloomStrength;
    bloomPass.radius = params.bloomRadius;

    this.bloomComposer = new this.THREE_EXTRA.EffectComposer(this.renderer);
    this.bloomComposer.renderToScreen = false;
    this.bloomComposer.addPass(renderScene);
    this.bloomComposer.addPass(bloomPass);

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

  private loadFont(): Promise<THREE.Font> {
    return new Promise((resolve) => {
      const fontLoader = new this.THREE.FontLoader();
      fontLoader.load('/optimer_regular.typeface.json', resolve);
    });
  }

  private async initAsync() {
    this.font = await this.loadFont();

    // We're now able to actually render artist labels, so register the data fetch client callbacks
    dataFetchClient.registerCallbacks(
      (data) => this.handleArtistData(data),
      (data) => this.handleArtistRelationships(data)
    );
  }

  private async handleArtistData(artistData: ArtistMapDataWithId[]) {
    // TODO: Decide if we actually want to render artist names or not based on distance or something

    const artistIDs = artistData.map((datum) => datum.id);
    const transferrableArtistIDs = new Uint32Array(artistIDs);
    const artistPositions = await wasmClient.getArtistPositions(
      Comlink.transfer(transferrableArtistIDs, [transferrableArtistIDs.buffer])
    );
    artistData.forEach(({ id: artistID, name }, i) => {
      if (Number.isNaN(artistPositions[i * 3])) {
        return;
      }

      const position = new this.THREE.Vector3(
        artistPositions[i * 3],
        artistPositions[i * 3 + 1],
        artistPositions[i * 3 + 2]
      );
      this.renderArtistLabel(artistID, name, position);
    });
    // dataFetchClient.getOrFetchArtistRelationships(artistIDs);
  }

  private async handleArtistRelationships(artistRelationships: ArtistRelationshipDataWithId[]) {
    // TODO: Decide if we actually want to render the artists or not based on distance or something

    // TODO: Render connections between artists

    const allArtistIDs = Array.from(
      new Set(artistRelationships.flatMap((datum) => [datum.id, ...datum.relatedArtists])).values()
    );
    this.renderArtists(allArtistIDs);
    const transferrableArtistIDs = new Uint32Array(allArtistIDs);
    const artistPositions = await wasmClient.getArtistPositions(
      Comlink.transfer(transferrableArtistIDs, [transferrableArtistIDs.buffer])
    );

    const connsToRender = artistRelationships.flatMap(({ id, relatedArtists }) => {
      const posIx = allArtistIDs.indexOf(id);
      if (Number.isNaN(artistPositions[posIx * 3])) {
        return [];
      }

      const artistPosition = new this.THREE.Vector3(
        artistPositions[posIx * 3],
        artistPositions[posIx * 3 + 1],
        artistPositions[posIx * 3 + 2]
      );

      return filterNils(
        relatedArtists.map((relatedID) => {
          const relatedPosIx = allArtistIDs.indexOf(relatedID);
          if (Number.isNaN(artistPositions[relatedPosIx * 3])) {
            return null;
          }
          const relatedPosition = new this.THREE.Vector3(
            artistPositions[relatedPosIx * 3],
            artistPositions[relatedPosIx * 3 + 1],
            artistPositions[relatedPosIx * 3 + 2]
          );

          return {
            artist1ID: id,
            artist2ID: relatedID,
            artist1Pos: artistPosition,
            artist2Pos: relatedPosition,
          };
        })
      );
    });
    this.renderConnections(connsToRender);

    // dataFetchClient.getOrFetchArtistData(allArtistIDs);
    dataFetchClient.getOrFetchArtistRelationships(allArtistIDs);
  }

  private async renderArtistLabel(
    artistID: number,
    artistName: string,
    artistPosition: THREE.Vector3
  ) {
    if (this.renderedArtistLabelsByID.has(artistID)) {
      return;
    }

    const textMaterial = new this.THREE.MeshBasicMaterial({ color: 0xff2333 });
    const textGeometry = new this.THREE.TextGeometry(artistName, {
      font: this.font,
      size: ARTIST_LABEL_TEXT_SIZE,
      height: 0.2,
      curveSegments: 1,
    });
    const textMesh = new this.THREE.Mesh(textGeometry, textMaterial);
    // Create a bounding box to measure the text so we can know how wide it is in order to
    // accurately center it
    const bbox = new this.THREE.Box3().setFromObject(textMesh);
    const dims = new this.THREE.Vector3();
    bbox.getSize(dims);
    const width = dims.x;

    // The label's position is set every frame in the render function
    this.scene.add(textMesh);

    this.renderedArtistLabelsByID.set(artistID, {
      mesh: textMesh,
      pos: artistPosition,
      width,
    });
  }

  public renderConnections(
    connections: {
      artist1ID: number;
      artist1Pos: THREE.Vector3;
      artist2ID: number;
      artist2Pos: THREE.Vector3;
    }[]
  ) {
    const existingBloomed = this.bloomedConnectionsGeometry.getAttribute('position') as
      | THREE.Float32BufferAttribute
      | undefined;
    const existingBloomedCount = existingBloomed?.array.length ?? 0;

    const existingNonBloomed = this.nonBloomedConnectionsGeometry.getAttribute('position') as
      | THREE.Float32BufferAttribute
      | undefined;
    const existingNonBloomedCount = existingNonBloomed?.array.length ?? 0;

    let bloomedUpdated = false;
    let nonBloomedUpdated = false;

    const allToRender = filterNils(
      connections.map(({ artist1ID, artist2ID, artist1Pos, artist2Pos }) => {
        if (
          this.renderedConnectionsBySrcID.get(artist1ID)?.includes(artist2ID) ||
          this.renderedConnectionsBySrcID.get(artist2ID)?.includes(artist1ID)
        ) {
          return null;
        }

        // Prune very long distance connections to de-clutter the universe
        const distance = artist1Pos.distanceTo(artist2Pos);
        // if (distance > 4000) {
        //   return null;
        // }

        if (!this.renderedConnectionsBySrcID.has(artist1ID)) {
          this.renderedConnectionsBySrcID.set(artist1ID, []);
        }
        this.renderedConnectionsBySrcID.get(artist1ID)!.push(artist2ID);

        const isBloomed = (() => {
          // TODO: Make this better
          if (distance < 2200) {
            return true;
          }

          return false; // TODO
        })();

        if (isBloomed) {
          bloomedUpdated = true;
        } else {
          nonBloomedUpdated = true;
        }

        return { artist1ID, artist2ID, artist1Pos, artist2Pos, isBloomed };
      })
    );

    if (bloomedUpdated) {
      const toRender = allToRender.filter(({ isBloomed }) => isBloomed);

      const newPositions = new Float32Array(existingBloomedCount + toRender.length * 6);
      if (existingBloomed) {
        newPositions.set(existingBloomed.array);
      }
      let startIx = existingBloomedCount;
      toRender.forEach((connection) => {
        newPositions[startIx + 0] = connection.artist1Pos.x;
        newPositions[startIx + 1] = connection.artist1Pos.y;
        newPositions[startIx + 2] = connection.artist1Pos.z;

        newPositions[startIx + 3] = connection.artist2Pos.x;
        newPositions[startIx + 4] = connection.artist2Pos.y;
        newPositions[startIx + 5] = connection.artist2Pos.z;

        startIx += 6;
      });

      const newAttr = new this.THREE.BufferAttribute(newPositions, 3);
      this.bloomedConnectionsGeometry.setAttribute('position', newAttr);
      this.bloomedConnectionsGeometry.computeBoundingSphere();
    }

    if (nonBloomedUpdated) {
      const toRender = allToRender.filter(({ isBloomed }) => !isBloomed);

      const newPositions = new Float32Array(existingNonBloomedCount + toRender.length * 6);
      if (existingNonBloomed) {
        newPositions.set(existingNonBloomed.array);
      }
      let startIx = existingNonBloomedCount;
      toRender.forEach((connection) => {
        newPositions[startIx + 0] = connection.artist1Pos.x;
        newPositions[startIx + 1] = connection.artist1Pos.y;
        newPositions[startIx + 2] = connection.artist1Pos.z;

        newPositions[startIx + 3] = connection.artist2Pos.x;
        newPositions[startIx + 4] = connection.artist2Pos.y;
        newPositions[startIx + 5] = connection.artist2Pos.z;

        startIx += 6;
      });

      const newAttr = new this.THREE.BufferAttribute(newPositions, 3);
      this.nonBloomedConnectionsGeometry.setAttribute('position', newAttr);
      this.nonBloomedConnectionsGeometry.computeBoundingSphere();
    }
  }

  public async renderArtists(artistInternalIDs: number[]) {
    // Skip artists that are already rendered
    const artistsToRender = artistInternalIDs.filter((id) => {
      if (!this.renderedArtistIDs.has(id)) {
        this.renderedArtistIDs.add(id);
        return true;
      }
      return false;
    });

    const startIx = this.artistMeshes.count;
    this.artistMeshes.count = startIx + artistsToRender.length;

    const transferrableArtistIDs = new Uint32Array(artistsToRender);
    const artistPositions = await wasmClient.getArtistPositions(
      Comlink.transfer(transferrableArtistIDs, [transferrableArtistIDs.buffer])
    );

    const matrix = new this.THREE.Matrix4();
    matrix.makeScale(5, 5, 5);
    const artistColor = new this.THREE.Color(/* BASE_ARTIST_COLOR */);
    artistsToRender.forEach((_id, i) => {
      if (Number.isNaN(artistPositions[i * 3])) {
        return;
      }

      const pos = [
        artistPositions[i * 3],
        artistPositions[i * 3 + 1],
        artistPositions[i * 3 + 2],
      ] as const;

      matrix.setPosition(...pos);
      this.artistMeshes.setMatrixAt(startIx + i, matrix);
      this.artistMeshes.setColorAt(startIx + i, artistColor);
    });
    this.artistMeshes.instanceMatrix.needsUpdate = true;
    this.artistMeshes.instanceColor!.needsUpdate = true;

    console.log('Total rendered artist count: ', this.artistMeshes.count);
  }

  private darkenNonBloomed() {
    this.renderedArtistLabelsByID.forEach(({ mesh }) => {
      (mesh as any).materialOld = mesh.material;
      mesh.material = new this.THREE.MeshBasicMaterial({ color: 0x000000 });
    });
    (this.nonBloomedConnectionsMesh.material as THREE.LineBasicMaterial).color.set(0);
  }

  private restoreNonBloomed() {
    this.renderedArtistLabelsByID.forEach(({ mesh }) => {
      mesh.material = (mesh as any).materialOld;
    });

    (this.nonBloomedConnectionsMesh
      .material as THREE.LineBasicMaterial).color = this.getConnectionColor();
    (this.nonBloomedConnectionsMesh.material as THREE.LineBasicMaterial).needsUpdate = true;
    (this.bloomedConnectionsMesh
      .material as THREE.LineBasicMaterial).color = this.getConnectionColor();
    (this.bloomedConnectionsMesh.material as THREE.LineBasicMaterial).needsUpdate = true;
  }

  private getConnectionColor(): THREE.Color {
    // if (!this.chroma || !this.connectionColorScale) {
    return new this.THREE.Color(BASE_CONNECTION_COLOR);
    // }

    const partial = this.timeElapsed / 20;
    const [r, g, b] = this.connectionColorScale(partial - Math.floor(partial)).gl();
    return new this.THREE.Color(r, g, b);
  }

  private render() {
    const timeDelta = this.clock.getDelta();
    this.timeElapsed += timeDelta;

    // this.stats.update();
    const { forward, sideways } = this.movementInputHandler.getDirectionVector();
    this.controls.moveRight(sideways * MOVEMENT_SPEED_UNITS_PER_SECOND);
    this.controls.getObject().position.add(
      this.controls
        .getDirection(VEC3_IDENTITY)
        .clone()
        .multiplyScalar(MOVEMENT_SPEED_UNITS_PER_SECOND * forward)
    );

    // Make all labels appear above their respective artists and face the camera
    this.renderedArtistLabelsByID.forEach(({ mesh, pos, width }) => {
      const cameraOffset = this.camera.position.clone().sub(pos);
      const inverseCameraPos = pos.clone().sub(cameraOffset.multiplyScalar(2));

      mesh.matrix.copy(mesh.matrix.lookAt(pos, inverseCameraPos, this.camera.up));
      mesh.matrix.setPosition(
        pos
          .clone()
          // Move the label up with respect to the camera, less distance the closer it is
          .add(this.camera.up.clone().multiplyScalar(8))
          // And move it left to center it
          .add(
            this.camera.up
              .clone()
              .cross(cameraOffset)
              .normalize()
              .multiplyScalar(-0.5 * width)
          )
      );
      mesh.matrixAutoUpdate = false;
    });

    this.darkenNonBloomed();
    this.bloomComposer.render();
    this.restoreNonBloomed();
    this.finalComposer.render();
  }

  private animate() {
    requestAnimationFrame(() => this.animate());
    this.render();
  }
}
