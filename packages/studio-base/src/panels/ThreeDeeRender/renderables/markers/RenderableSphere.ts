// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

/* eslint-disable no-underscore-dangle */

import * as THREE from "three";

import { DetailLevel } from "../../DetailLevel";
import type { Renderer } from "../../Renderer";
import { rgbaEqual } from "../../color";
import { Marker } from "../../ros";
import { RenderableMarker } from "./RenderableMarker";
import { releaseStandardMaterial, standardMaterial } from "./materials";

export class RenderableSphere extends RenderableMarker {
  private static _lod: DetailLevel | undefined;
  private static _geometry: THREE.SphereGeometry | undefined;

  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.Material>;

  constructor(topic: string, marker: Marker, renderer: Renderer) {
    super(topic, marker, renderer);

    // Sphere mesh
    const material = standardMaterial(marker, renderer.materialCache);
    this.mesh = new THREE.Mesh(RenderableSphere.geometry(renderer.lod), material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.add(this.mesh);

    this.update(marker);
  }

  override dispose(): void {
    releaseStandardMaterial(this.marker, this._renderer.materialCache);
  }

  override update(marker: Marker): void {
    super.update(marker);

    if (!rgbaEqual(marker.color, this.marker.color)) {
      releaseStandardMaterial(marker, this._renderer.materialCache);
      this.mesh.material = standardMaterial(marker, this._renderer.materialCache);
    }

    this.scale.set(marker.scale.x, marker.scale.y, marker.scale.z);
  }

  static geometry(lod: DetailLevel): THREE.SphereGeometry {
    if (!RenderableSphere._geometry || lod !== RenderableSphere._lod) {
      const subdivisions = sphereSubdivisions(lod);
      RenderableSphere._geometry = new THREE.SphereGeometry(0.5, subdivisions, subdivisions);
      RenderableSphere._geometry.computeBoundingSphere();
      RenderableSphere._lod = lod;
    }
    return RenderableSphere._geometry;
  }
}

function sphereSubdivisions(lod: DetailLevel) {
  switch (lod) {
    case DetailLevel.Low:
      return 10;
    case DetailLevel.Medium:
      return 24;
    case DetailLevel.High:
      return 32;
  }
}
