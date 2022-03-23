// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import EventEmitter from "eventemitter3";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";

import Logger from "@foxglove/log";

import { DetailLevel } from "./DetailLevel";
import { Input } from "./Input";
import { MaterialCache } from "./MaterialCache";
import { ModelCache } from "./ModelCache";
import { TopicErrors } from "./TopicErrors";
import { FrameAxes } from "./renderables/FrameAxes";
import { Markers } from "./renderables/Markers";
import { Marker, TF } from "./ros";
import { TransformTree } from "./transforms";

const log = Logger.getLogger(__filename);

export type RendererEvents = {
  startFrame: (currentTime: bigint, renderer: Renderer) => void;
  endFrame: (currentTime: bigint, renderer: Renderer) => void;
  renderableSelected: (renderable: THREE.Object3D, renderer: Renderer) => void;
  transformTreeUpdated: (renderer: Renderer) => void;
  showLabel: (labelId: string, labelMarker: Marker, renderer: Renderer) => void;
  removeLabel: (labelId: string, renderer: Renderer) => void;
};

// NOTE: These do not use .convertSRGBToLinear() since background color is not
// affected by gamma correction
const LIGHT_BACKDROP = new THREE.Color(0xececec);
const DARK_BACKDROP = new THREE.Color(0x121217);

const tempVec = new THREE.Vector3();

export class Renderer extends EventEmitter<RendererEvents> {
  canvas: HTMLCanvasElement;
  gl: THREE.WebGLRenderer;
  lod = DetailLevel.High;
  scene: THREE.Scene;
  dirLight: THREE.DirectionalLight;
  input: Input;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  materialCache = new MaterialCache();
  topicErrors = new TopicErrors();
  colorScheme: "dark" | "light" | undefined;
  modelCache: ModelCache;
  renderables = new Map<string, THREE.Object3D>();
  transformTree = new TransformTree();
  currentTime: bigint | undefined;
  fixedFrameId: string | undefined;
  renderFrameId: string | undefined;

  frameAxes = new FrameAxes(this);
  markers = new Markers(this);

  constructor(canvas: HTMLCanvasElement) {
    super();

    // NOTE: Global side effect
    THREE.Object3D.DefaultUp = new THREE.Vector3(0, 0, 1);

    this.canvas = canvas;
    this.gl = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      logarithmicDepthBuffer: true,
    });
    if (!this.gl.capabilities.isWebGL2) {
      throw new Error("WebGL2 is not supported");
    }
    this.gl.outputEncoding = THREE.sRGBEncoding;
    this.gl.toneMapping = THREE.NoToneMapping;
    this.gl.autoClear = false;
    this.gl.info.autoReset = false;
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.VSMShadowMap;
    this.gl.setPixelRatio(window.devicePixelRatio);

    let width = canvas.width;
    let height = canvas.height;
    if (canvas.parentElement) {
      width = canvas.parentElement.clientWidth;
      height = canvas.parentElement.clientHeight;
      this.gl.setSize(width, height);
    }

    log.debug(`Initialized ${width}x${height} renderer`);

    this.modelCache = new ModelCache({ ignoreColladaUpAxis: true });

    this.scene = new THREE.Scene();
    this.scene.add(this.frameAxes);
    this.scene.add(this.markers);

    this.dirLight = new THREE.DirectionalLight();
    this.dirLight.position.set(1, 1, 1);
    this.dirLight.castShadow = true;

    this.dirLight.shadow.mapSize.width = 2048;
    this.dirLight.shadow.mapSize.height = 2048;
    this.dirLight.shadow.camera.near = 0.5;
    this.dirLight.shadow.camera.far = 500;
    this.dirLight.shadow.bias = -0.00001;

    this.scene.add(this.dirLight);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xffffff, 0.5));

    this.input = new Input(canvas);
    this.input.on("resize", (size) => this.resizeHandler(size));
    this.input.on("click", (cursorCoords) => this.clickHandler(cursorCoords));

    const fov = 50;
    const near = 0.01; // 1cm
    const far = 10_000; // 10km
    this.camera = new THREE.PerspectiveCamera(fov, width / height, near, far);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(1, -3, 1);
    this.camera.lookAt(new THREE.Vector3(0, 0, 0));

    this.controls = new OrbitControls(this.camera, this.gl.domElement);

    this.animationFrame(performance.now());
  }

  dispose(): void {
    this.frameAxes.dispose();
    this.markers.dispose();
    this.gl.dispose();
    this.gl.forceContextLoss();
  }

  setColorScheme(colorScheme: "dark" | "light"): void {
    log.debug(`Setting color scheme to "${colorScheme}"`);
    this.colorScheme = colorScheme;
    this.gl.setClearColor(colorScheme === "dark" ? DARK_BACKDROP : LIGHT_BACKDROP, 1);
  }

  addTransformMessage(tf: TF): void {
    this.frameAxes.addTransformMessage(tf);
  }

  addMarkerMessage(topic: string, marker: Marker): void {
    this.markers.addMarkerMessage(topic, marker);
  }

  markerWorldPosition(markerId: string): Readonly<THREE.Vector3> | undefined {
    const renderable = this.renderables.get(markerId);
    if (!renderable) {
      return undefined;
    }

    tempVec.set(0, 0, 0);
    tempVec.applyMatrix4(renderable.matrixWorld);
    return tempVec;
  }

  // Callback handlers

  animationFrame = (_wallTime: DOMHighResTimeStamp): void => {
    requestAnimationFrame(this.animationFrame);
    if (this.currentTime != undefined) {
      this.frameHandler(this.currentTime);
    }
  };

  frameHandler = (currentTime: bigint): void => {
    this.emit("startFrame", currentTime, this);

    this.controls.update();

    // TODO: Remove this hack when the user can set the renderFrameId themselves
    this.fixedFrameId = "base_link";
    this.renderFrameId = "base_link";

    this.materialCache.update(this.input.canvasSize);

    this.frameAxes.startFrame(currentTime);
    this.markers.startFrame(currentTime);

    this.gl.clear();
    this.gl.render(this.scene, this.camera);

    this.emit("endFrame", currentTime, this);

    this.gl.info.reset();
  };

  resizeHandler = (size: THREE.Vector2): void => {
    log.debug(`Resizing to ${size.width}x${size.height}`);
    this.camera.aspect = size.width / size.height;
    this.camera.updateProjectionMatrix();

    this.gl.setPixelRatio(window.devicePixelRatio);
    this.gl.setSize(size.width, size.height);
  };

  clickHandler = (_cursorCoords: THREE.Vector2): void => {
    //
  };
}
