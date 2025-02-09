// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as THREE from "three";

import { DynamicBufferGeometry } from "../DynamicBufferGeometry";
import { MaterialCache, PointsVertexColor } from "../MaterialCache";
import { Renderer } from "../Renderer";
import { Pose, PointCloud2, PointFieldType, rosTimeToNanoSec } from "../ros";
import { makePose } from "../transforms/geometry";
import { updatePose } from "../updatePose";
import { getColorConverter } from "./pointClouds/colors";
import { FieldReader, getReader } from "./pointClouds/fieldReaders";
import { PointCloudColorMode, PointCloudSettings } from "./pointClouds/settings";
import { missingTransformMessage, MISSING_TRANSFORM } from "./transforms";

type PointCloudRenderable = THREE.Object3D & {
  userData: {
    topic: string;
    settings: PointCloudSettings;
    pointCloud: PointCloud2;
    pose: Pose;
    srcTime: bigint;
    geometry: DynamicBufferGeometry<Float32Array, Float32ArrayConstructor>;
    points: THREE.Points;
  };
};

const DEFAULT_POINT_SIZE = 1.5;
const DEFAULT_POINT_SHAPE = "circle";
const DEFAULT_COLOR_MODE = PointCloudColorMode.Turbo;
const DEFAULT_FLAT_COLOR = { r: 1, g: 1, b: 1, a: 1 };
const DEFAULT_MIN_COLOR = { r: 0, g: 0, b: 1, a: 1 };
const DEFAULT_MAX_COLOR = { r: 1, g: 0, b: 0, a: 1 };
const DEFAULT_RGB_BYTE_ORDER = "rgba";

const COLOR_FIELDS = new Set<string>(["rgb", "rgba", "bgr", "bgra", "abgr", "color"]);
const INTENSITY_FIELDS = new Set<string>(["intensity", "i"]);

const INVALID_POINT_CLOUD = "INVALID_POINT_CLOUD";

const tempColor = { r: 0, g: 0, b: 0, a: 0 };

export class PointClouds extends THREE.Object3D {
  renderer: Renderer;
  pointCloudsByTopic = new Map<string, PointCloudRenderable>();

  constructor(renderer: Renderer) {
    super();
    this.renderer = renderer;
  }

  dispose(): void {
    for (const renderable of this.pointCloudsByTopic.values()) {
      releasePointsMaterial(renderable.userData.settings, this.renderer.materialCache);
      const points = renderable.userData.points;
      points.geometry.dispose();
      const pickingMaterial = points.userData.pickingMaterial as THREE.ShaderMaterial;
      pickingMaterial.dispose();
    }
    this.children.length = 0;
    this.pointCloudsByTopic.clear();
  }

  addPointCloud2Message(topic: string, pointCloud: PointCloud2): void {
    let renderable = this.pointCloudsByTopic.get(topic);
    if (!renderable) {
      renderable = new THREE.Object3D() as PointCloudRenderable;
      renderable.name = topic;
      renderable.userData.topic = topic;

      // TODO: How do we fetch the stored settings for this topic?
      renderable.userData.settings = {
        pointSize: DEFAULT_POINT_SIZE,
        pointShape: DEFAULT_POINT_SHAPE,
        decayTime: 0,
        colorMode: PointCloudColorMode.Flat,
        rgbByteOrder: DEFAULT_RGB_BYTE_ORDER,
        flatColor: DEFAULT_FLAT_COLOR,
        minColor: DEFAULT_MIN_COLOR,
        maxColor: DEFAULT_MAX_COLOR,
      };
      autoSelectColorField(renderable.userData.settings, pointCloud);

      renderable.userData.pointCloud = pointCloud;
      renderable.userData.pose = makePose();
      renderable.userData.srcTime = rosTimeToNanoSec(pointCloud.header.stamp);

      const geometry = new DynamicBufferGeometry(Float32Array);
      geometry.name = `${topic}:PointCloud2:geometry`;
      geometry.createAttribute("position", 3);
      geometry.createAttribute("color", 4);
      renderable.userData.geometry = geometry;

      const material = pointsMaterial(renderable.userData.settings, this.renderer.materialCache);
      const points = new THREE.Points(geometry, material);
      points.name = `${topic}:PointCloud2:points`;
      points.userData.pickingMaterial = createPickingMaterial(renderable.userData.settings);
      renderable.userData.points = points;
      renderable.add(renderable.userData.points);

      this.add(renderable);
      this.pointCloudsByTopic.set(topic, renderable);
    }

    this._updatePointCloudRenderable(renderable, pointCloud);
  }

  startFrame(currentTime: bigint): void {
    const renderFrameId = this.renderer.renderFrameId;
    const fixedFrameId = this.renderer.fixedFrameId;
    if (!renderFrameId || !fixedFrameId) {
      return;
    }

    for (const renderable of this.pointCloudsByTopic.values()) {
      const srcTime = renderable.userData.srcTime;
      const frameId = renderable.userData.pointCloud.header.frame_id;
      const updated = updatePose(
        renderable,
        this.renderer.transformTree,
        renderFrameId,
        fixedFrameId,
        frameId,
        currentTime,
        srcTime,
      );
      if (!updated) {
        const message = missingTransformMessage(renderFrameId, fixedFrameId, frameId);
        this.renderer.layerErrors.addToTopic(renderable.userData.topic, MISSING_TRANSFORM, message);
      }
    }
  }

  _updatePointCloudRenderable(renderable: PointCloudRenderable, pointCloud: PointCloud2): void {
    renderable.userData.pointCloud = pointCloud;
    renderable.userData.srcTime = rosTimeToNanoSec(pointCloud.header.stamp);

    const settings = renderable.userData.settings;
    const data = pointCloud.data;
    const pointCount = Math.trunc(data.length / pointCloud.point_step);

    // Invalid point cloud checks
    if (pointCloud.is_bigendian) {
      const message = `PointCloud2 is_bigendian=true is not supported`;
      invalidPointCloudError(this.renderer, renderable, message);
      return;
    } else if (data.length % pointCloud.point_step !== 0) {
      const message = `PointCloud2 data length ${data.length} is not a multiple of point_step ${pointCloud.point_step}`;
      invalidPointCloudError(this.renderer, renderable, message);
      return;
    } else if (pointCloud.fields.length === 0) {
      const message = `PointCloud2 has no fields`;
      invalidPointCloudError(this.renderer, renderable, message);
      return;
    } else if (data.length < pointCloud.height * pointCloud.row_step) {
      const message = `PointCloud2 data length ${data.length} is less than height ${pointCloud.height} * row_step ${pointCloud.row_step}`;
      invalidPointCloudError(this.renderer, renderable, message);
      return;
    } else if (pointCloud.width * pointCloud.point_step > pointCloud.row_step) {
      const message = `PointCloud2 width ${pointCloud.width} * point_step ${pointCloud.point_step} is greater than row_step ${pointCloud.row_step}`;
      invalidPointCloudError(this.renderer, renderable, message);
      return;
    }

    // Parse the fields and create typed readers for x/y/z and color
    let xReader: FieldReader | undefined;
    let yReader: FieldReader | undefined;
    let zReader: FieldReader | undefined;
    let colorReader: FieldReader | undefined;
    for (let i = 0; i < pointCloud.fields.length; i++) {
      const field = pointCloud.fields[i]!;
      if (field.name === "x") {
        xReader = getReader(field, pointCloud.point_step);
        if (!xReader) {
          const typeName = pointFieldTypeName(field.datatype);
          const message = `PointCloud2 field "x" is invalid. type=${typeName}, offset=${field.offset}, point_step=${pointCloud.point_step}`;
          invalidPointCloudError(this.renderer, renderable, message);
          return;
        }
      } else if (field.name === "y") {
        yReader = getReader(field, pointCloud.point_step);
        if (!yReader) {
          const typeName = pointFieldTypeName(field.datatype);
          const message = `PointCloud2 field "y" is invalid. type=${typeName}, offset=${field.offset}, point_step=${pointCloud.point_step}`;
          invalidPointCloudError(this.renderer, renderable, message);
          return;
        }
      } else if (field.name === "z") {
        zReader = getReader(field, pointCloud.point_step);
        if (!zReader) {
          const typeName = pointFieldTypeName(field.datatype);
          const message = `PointCloud2 field "z" is invalid. type=${typeName}, offset=${field.offset}, point_step=${pointCloud.point_step}`;
          invalidPointCloudError(this.renderer, renderable, message);
          return;
        }
      }

      if (field.name === settings.colorField) {
        colorReader = getReader(field, pointCloud.point_step);
        if (!colorReader) {
          const typeName = pointFieldTypeName(field.datatype);
          const message = `PointCloud2 field "${field.name}" is invalid. type=${typeName}, offset=${field.offset}, point_step=${pointCloud.point_step}`;
          invalidPointCloudError(this.renderer, renderable, message);
          return;
        }
      }

      if (xReader && yReader && zReader && colorReader) {
        break;
      }
    }

    const positionReaderCount = (xReader ? 1 : 0) + (yReader ? 1 : 0) + (zReader ? 1 : 0);
    if (positionReaderCount < 2) {
      const message = `PointCloud2 must contain at least two of x/y/z fields`;
      invalidPointCloudError(this.renderer, renderable, message);
      return;
    }

    colorReader ??= xReader ?? yReader ?? zReader ?? zeroReader;
    xReader ??= zeroReader;
    yReader ??= zeroReader;
    zReader ??= zeroReader;

    const geometry = renderable.userData.geometry;
    geometry.resize(pointCount);
    const positionAttribute = geometry.getAttribute("position") as THREE.BufferAttribute;
    const colorAttribute = geometry.getAttribute("color") as THREE.BufferAttribute;

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

    // Iterate the point cloud data to determine min/max color values (if needed)
    let minColorValue = settings.minValue ?? Number.POSITIVE_INFINITY;
    let maxColorValue = settings.maxValue ?? Number.NEGATIVE_INFINITY;
    if (settings.minValue == undefined || settings.maxValue == undefined) {
      for (let i = 0; i < pointCount; i++) {
        const pointOffset = i * pointCloud.point_step;
        const colorValue = colorReader!(view, pointOffset);
        minColorValue = Math.min(minColorValue, colorValue);
        maxColorValue = Math.max(maxColorValue, colorValue);
      }
      minColorValue = settings.minValue ?? minColorValue;
      maxColorValue = settings.maxValue ?? maxColorValue;
    }

    // Build a method to convert raw color field values to RGBA
    const colorConverter = getColorConverter(settings, minColorValue, maxColorValue);

    // Iterate the point cloud data to update position and color attributes
    for (let i = 0; i < pointCount; i++) {
      const pointOffset = i * pointCloud.point_step;

      // Update position attribute
      const x = xReader(view, pointOffset);
      const y = yReader(view, pointOffset);
      const z = zReader(view, pointOffset);
      positionAttribute.setXYZ(i, x, y, z);

      // Update color attribute
      const colorValue = colorReader!(view, pointOffset);
      colorConverter(tempColor, colorValue);
      colorAttribute.setXYZW(i, tempColor.r, tempColor.g, tempColor.b, tempColor.a);
    }

    positionAttribute.needsUpdate = true;
    colorAttribute.needsUpdate = true;

    // const material = renderable.userData.points.material;
    // renderable.remove(renderable.userData.points);
    // renderable.userData.points = new THREE.Points(geometry, material);
    // renderable.add(renderable.userData.points);
  }
}

function pointsMaterial(
  settings: PointCloudSettings,
  materialCache: MaterialCache,
): THREE.PointsMaterial {
  const transparent = pointCloudHasTransparency(settings);
  const scale = { x: settings.pointSize, y: settings.pointSize };
  return materialCache.acquire(
    PointsVertexColor.id(scale, transparent),
    () => PointsVertexColor.create(scale, transparent),
    PointsVertexColor.dispose,
  );
}

function releasePointsMaterial(settings: PointCloudSettings, materialCache: MaterialCache): void {
  const transparent = pointCloudHasTransparency(settings);
  const scale = { x: settings.pointSize, y: settings.pointSize };
  materialCache.release(PointsVertexColor.id(scale, transparent));
}

function createPickingMaterial(settings: PointCloudSettings): THREE.ShaderMaterial {
  const MIN_PICKING_POINT_SIZE = 8;

  const pointSize = Math.max(settings.pointSize, MIN_PICKING_POINT_SIZE);
  return new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      uniform float pointSize;
      void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = pointSize;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec4 objectId;
      void main() {
        gl_FragColor = objectId;
      }
    `,
    side: THREE.DoubleSide,
    uniforms: { pointSize: { value: pointSize }, objectId: { value: [NaN, NaN, NaN, NaN] } },
  });
}

function pointCloudHasTransparency(settings: PointCloudSettings): boolean {
  switch (settings.colorMode) {
    case PointCloudColorMode.Flat:
      return settings.flatColor.a < 1.0;
    case PointCloudColorMode.Gradient:
      return settings.minColor.a < 1.0 || settings.maxColor.a < 1.0;
    case PointCloudColorMode.Rainbow:
    case PointCloudColorMode.Turbo:
    case PointCloudColorMode.Rgb:
      return false;
    case PointCloudColorMode.Rgba:
      return true;
  }
}

function autoSelectColorField(output: PointCloudSettings, pointCloud: PointCloud2): void {
  for (const field of pointCloud.fields) {
    if (COLOR_FIELDS.has(field.name)) {
      output.colorField = field.name;
      switch (field.name) {
        case "rgb":
          output.colorMode = PointCloudColorMode.Rgb;
          output.rgbByteOrder = "rgba";
          break;
        default:
        case "rgba":
          output.colorMode = PointCloudColorMode.Rgba;
          output.rgbByteOrder = "rgba";
          break;
        case "bgr":
          output.colorMode = PointCloudColorMode.Rgb;
          output.rgbByteOrder = "bgra";
          break;
        case "bgra":
          output.colorMode = PointCloudColorMode.Rgba;
          output.rgbByteOrder = "bgra";
          break;
        case "abgr":
          output.colorMode = PointCloudColorMode.Rgba;
          output.rgbByteOrder = "abgr";
          break;
      }
      return;
    }
  }

  for (const field of pointCloud.fields) {
    if (INTENSITY_FIELDS.has(field.name)) {
      output.colorField = field.name;
      output.colorMode = DEFAULT_COLOR_MODE;
      return;
    }
  }

  if (pointCloud.fields.length > 0) {
    const firstField = pointCloud.fields[0]!;
    output.colorField = firstField.name;
    output.colorMode = DEFAULT_COLOR_MODE;
    return;
  }
}

function pointFieldTypeName(type: PointFieldType): string {
  return PointFieldType[type] ?? `${type}`;
}

function invalidPointCloudError(
  renderer: Renderer,
  renderable: PointCloudRenderable,
  message: string,
): void {
  renderer.layerErrors.addToTopic(renderable.userData.topic, INVALID_POINT_CLOUD, message);
  renderable.userData.positionAttribute.resize(0);
  renderable.userData.colorAttribute.resize(0);
}

function zeroReader(): number {
  return 0;
}
